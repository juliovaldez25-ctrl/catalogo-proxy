import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";
import zlib from "zlib";

const app = express();

/* ======================================================
   🔧 CONFIGURAÇÕES PRINCIPAIS
====================================================== */
const CONFIG = {
  SUPABASE_URL: "https://hbpekfnexdtnbahmmufm.supabase.co",
  SUPABASE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODk4NTUxNywiZXhwIjoyMDc0NTYxNTE3fQ.cMiKA-_TqdgCNcuMzbu3qTRjiTPHZWH-dwVeEQ8lTtA",
  ORIGIN: "https://catalogovirtual.app.br",
  CACHE_TTL: 1000 * 60 * 10,
  TIMEOUT: 7000,
  PORT: process.env.PORT || 8080,
};

/* ======================================================
   🌐 CORS GLOBAL
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
   🧠 CACHE
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
   🛰️ SUPABASE
====================================================== */
async function getDomainData(host) {
  if (!host) return null;
  const cached = getCache(host);
  if (cached) return cached;

  try {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=slug,status`,
      {
        headers: {
          apikey: CONFIG.SUPABASE_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
        },
      }
    );
    if (!res.ok) {
      console.error(`❌ Supabase ${res.status}: ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    const row = data?.[0];
    if (row && ["active", "verified"].includes(row.status)) {
      setCache(host, row);
      return row;
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
   🧭 MIDDLEWARE PRINCIPAL
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

  const target = isStatic(path)
    ? CONFIG.ORIGIN
    : `${CONFIG.ORIGIN}/s/${domainData.slug}`;

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    xfwd: true,

    onProxyRes(proxyRes, req, res) {
      const enc = proxyRes.headers["content-encoding"];
      const chunks = [];

      proxyRes.on("data", (chunk) => chunks.push(chunk));

      proxyRes.on("end", () => {
        let buffer = Buffer.concat(chunks);
        const contentType = proxyRes.headers["content-type"] || "";

        // Remove encoding para evitar erro
        delete proxyRes.headers["content-encoding"];
        delete proxyRes.headers["content-length"];

        if (enc === "gzip") buffer = zlib.gunzipSync(buffer);
        else if (enc === "br") buffer = zlib.brotliDecompressSync(buffer);

        if (contentType.includes("text/html")) {
          let html = buffer.toString("utf8");
          html = html.replace(
            "</head>",
            `<script>window.STORE_SLUG="${domainData.slug}";</script>\n</head>`
          );
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          res.end(html);
        } else {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          res.end(buffer);
        }
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
app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`);
});
