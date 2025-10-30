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
  EDGE_FUNCTION:
    "https://hbpekfnexdtnbahmmufm.supabase.co/functions/v1/get-domain",
  ORIGIN: "https://catalogovirtual.app.br",
  CACHE_TTL: 1000 * 60 * 10, // 10 minutos
  TIMEOUT: 7000,
  PORT: process.env.PORT || 8080,
};

/* ======================================================
   🌐 LIBERA CORS GLOBALMENTE
====================================================== */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
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
   🛰️ FUNÇÃO: BUSCA DOMÍNIO NO SUPABASE
====================================================== */
async function getDomainData(host) {
  if (!host) return null;
  const cached = getCache(host);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

  try {
    const edge = await fetch(`${CONFIG.EDGE_FUNCTION}?domain=${host}`, {
      headers: { Authorization: `Bearer ${CONFIG.SUPABASE_KEY}` },
      signal: controller.signal,
    });

    if (edge.ok) {
      const json = await edge.json();
      if (json?.slug) {
        setCache(host, json);
        return json;
      }
    }

    // fallback direto no Supabase REST
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

    if (res.ok) {
      const data = await res.json();
      const row = data?.[0];
      if (row && ["active", "verified"].includes(row.status)) {
        setCache(host, row);
        return row;
      }
    }
  } catch (err) {
    console.error("⚠️ Erro Supabase:", err.message);
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
   🧭 MIDDLEWARE PRINCIPAL (PROXY)
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

  const target = CONFIG.ORIGIN;
  let rewrittenPath = path;
 
rewrittenPath = `/s/${domainData.slug}${path}`;


  console.log(`➡️ Proxy: ${cleanHost}${path} → ${target}${rewrittenPath}`);

  const proxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    xfwd: true,
    selfHandleResponse: true,
    pathRewrite: () => rewrittenPath,

    /* ======================================================
       🧩 TRATAMENTO DE RESPOSTA
    ======================================================= */
    onProxyRes(proxyRes, req, res) {
      const chunks = [];
      proxyRes.on("data", (chunk) => chunks.push(chunk));
      proxyRes.on("end", async () => {
        let buffer = Buffer.concat(chunks);
        const contentType = proxyRes.headers["content-type"] || "";

        // ✅ 1. Se não for HTML, devolve direto
        if (!contentType.includes("text/html")) {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          return res.end(buffer);
        }

        // ✅ 2. Decodifica HTML (gzip/br)
        try {
          const enc = proxyRes.headers["content-encoding"];
          if (enc === "gzip") buffer = zlib.gunzipSync(buffer);
          else if (enc === "br") buffer = zlib.brotliDecompressSync(buffer);
        } catch {}

        let html = buffer.toString("utf8");

        // ✅ 3. SPA Fallback: se 404 ou sem root, busca index.html
        if (proxyRes.statusCode === 404 || !html.includes("<div id=\"root\"")) {
          try {
            const fallback = await fetch(`${CONFIG.ORIGIN}/s/${domainData.slug}/index.html`);
            html = await fallback.text();
            console.log("🔁 SPA fallback ativado:", req.path);
          } catch (e) {
            console.error("❌ Falha ao carregar fallback index.html:", e.message);
          }
        }

        // ✅ 4. Injeta slug e ajusta URLs
        html = html
          .replace("</head>", `<script>window.STORE_SLUG="${domainData.slug}";</script>\n</head>`)
          .replaceAll("https://catalogovirtual.app.br/assets/", "/assets/")
          .replaceAll("https://catalogovirtual.app.br/~flock.js", "/~flock.js");

        // ✅ 5. Remove compressão duplicada
        const headers = { ...proxyRes.headers };
        delete headers["content-encoding"];
        delete headers["content-length"];

        res.writeHead(200, {
          ...headers,
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
  });

  proxy(req, res, next);
});

/* ======================================================
   🚀 INICIALIZA SERVIDOR
====================================================== */
app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`);
});
