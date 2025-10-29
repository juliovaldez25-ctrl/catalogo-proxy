import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";
import zlib from "zlib";

const app = express();

/* ======================================================
   ⚙️ CONFIGURAÇÕES PRINCIPAIS
====================================================== */
const CONFIG = {
  SUPABASE_URL: "https://hbpekfnexdtnbahmmufm.supabase.co",
  SUPABASE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODk4NTUxNywiZXhwIjoyMDc0NTYxNTE3fQ.cMiKA-_TqdgCNcuMzbu3qTRjiTPHZWH-dwVeEQ8lTtA",
  EDGE_FUNCTION: "https://hbpekfnexdtnbahmmufm.supabase.co/functions/v1/get-domain",
  ORIGIN: "https://catalogovirtual.app.br",
  CACHE_TTL: 1000 * 60 * 10,
  TIMEOUT: 7000,
  PORT: process.env.PORT || 8080,
};

/* ======================================================
   🌐 LIBERA CORS GLOBALMENTE
====================================================== */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, DELETE"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

/* ======================================================
   🧠 CACHE DE DOMÍNIOS
====================================================== */
const domainCache = new Map();
function setCache(host, data) {
  domainCache.set(host, { data, expires: Date.now() + CONFIG.CACHE_TTL });
}
function getCache(host) {
  const cached = domainCache.get(host);
  if (!cached || Date.now() > cached.expires) {
    domainCache.delete(host);
    return null;
  }
  return cached.data;
}

/* ======================================================
   🛰️ FUNÇÃO: BUSCA DOMÍNIO NO SUPABASE (Edge → REST)
====================================================== */
async function getDomainData(host) {
  if (!host) return null;

  const cached = getCache(host);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

  try {
    // 1️⃣ Tenta Edge Function
    const edge = await fetch(`${CONFIG.EDGE_FUNCTION}?domain=${host}`, {
      headers: { Authorization: `Bearer ${CONFIG.SUPABASE_KEY}` },
      signal: controller.signal,
    });

    if (edge.ok) {
      const json = await edge.json();
      if (json?.slug) {
        setCache(host, json);
        clearTimeout(timeout);
        return json;
      }
    }

    // 2️⃣ Fallback REST Supabase
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=slug,status`,
      {
        headers: {
          apikey: CONFIG.SUPABASE_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    const data = await res.json();
    const row = data?.[0];
    if (row && ["active", "verified"].includes(row.status)) {
      setCache(host, row);
      return row;
    }
  } catch (err) {
    console.error(`⚠️ Erro Supabase: ${err.message}`);
  }
  return null;
}

/* ======================================================
   🚦 ROTAS ESTÁTICAS
====================================================== */
const STATIC_PATHS = [
  /^\/assets\//,
  /^\/favicon\.ico$/,
  /^\/robots\.txt$/,
  /^\/sitemap\.xml$/,
  /^\/site\.webmanifest$/,
  /^\/~flock\.js$/,
  /^\/~api\//,
];
const isStatic = (path) => STATIC_PATHS.some((rx) => rx.test(path));

/* ======================================================
   🧭 MIDDLEWARE PRINCIPAL (PROXY SPA)
====================================================== */
app.use(async (req, res, next) => {
  const originalHost = req.headers.host?.trim().toLowerCase() || "";
  const cleanHost = originalHost.replace(/^www\./, "");
  const path = req.path;

  console.log(`🌐 ${cleanHost} → ${path}`);

  if (!cleanHost || cleanHost.includes("railway.app")) {
    return res.status(200).send("✅ Proxy ativo e aguardando conexões Cloudflare");
  }

  const domainData = await getDomainData(cleanHost);
  if (!domainData) {
    return res.status(404).send(`
      <html><body style="font-family:sans-serif;text-align:center;margin-top:40px">
      <h2>⚠️ Domínio não configurado</h2>
      <p>${cleanHost} ainda não foi ativado no Catálogo Virtual.</p>
      </body></html>
    `);
  }

  // 🔁 Caminho de destino
  let rewrittenPath = path;
  if (!isStatic(path) && !path.startsWith("/s/") && !path.startsWith("/~")) {
    rewrittenPath = `/s/${domainData.slug}${path}`;
  }

  const target = CONFIG.ORIGIN;
  console.log(`➡️ Proxy: ${cleanHost}${path} → ${target}${rewrittenPath}`);

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    xfwd: true,
    pathRewrite: () => rewrittenPath,
    selfHandleResponse: true,

    onProxyRes(proxyRes, req, res) {
      const chunks = [];
      proxyRes.on("data", (chunk) => chunks.push(chunk));
      proxyRes.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const contentType = proxyRes.headers["content-type"] || "";

        // Se não for HTML, retorna direto
        if (!contentType.includes("text/html")) {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          return res.end(buffer);
        }

        // Tenta decodificar gzip ou br
        let html;
        try {
          const enc = proxyRes.headers["content-encoding"];
          let decoded = buffer;
          if (enc === "gzip") decoded = zlib.gunzipSync(buffer);
          else if (enc === "br") decoded = zlib.brotliDecompressSync(buffer);
          html = decoded.toString("utf8");
        } catch {
          html = buffer.toString("utf8");
        }

        // Injeção segura
        if (html.includes("<div id=\"root\"></div>")) {
          html = html.replace(
            "</head>",
            `<script>window.STORE_SLUG="${domainData.slug}";</script>\n</head>`
          );
        }

        res.writeHead(proxyRes.statusCode, {
          ...proxyRes.headers,
          "Access-Control-Allow-Origin": "*",
          "Content-Encoding": "identity",
        });
        res.end(html);
      });
    },

    onError(err, req, res) {
      console.error("❌ ProxyError", err.message);
      res.status(502).send(`<h2>Erro 502</h2><p>${err.message}</p>`);
    },
  })(req, res, next);
});

/* ======================================================
   🚀 INICIALIZA SERVIDOR
====================================================== */
app.listen(CONFIG.PORT, "0.0.0.0", () =>
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`)
);
