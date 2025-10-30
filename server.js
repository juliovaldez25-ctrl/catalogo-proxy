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
  res.setHeader("Access-Control-Allow-Headers", "*");
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
   🛰️ BUSCA DOMÍNIO VIA EDGE FUNCTION
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

    clearTimeout(timeout);

    if (edge.ok) {
      const json = await edge.json();
      if (json?.slug) {
        setCache(host, json);
        return json;
      }
    } else {
      console.warn(`⚠️ Edge Function falhou: ${edge.status}`);
    }
  } catch (err) {
    console.error(`⚠️ Erro ao buscar domínio via Edge: ${err.message}`);
  }

  return null;
}

/* ======================================================
   🚦 MAPEAMENTO DE ROTAS ESTÁTICAS
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

  // ⚡ Reescreve rotas (assets, API e HTML)
  const target = CONFIG.ORIGIN;
  const injectSlug = !isStatic(path) && !path.startsWith("/~");

  console.log(`➡️ Proxy: ${cleanHost}${path} → ${target}${path}`);

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    xfwd: true,
    selfHandleResponse: injectSlug,
    pathRewrite: (p) =>
      isStatic(p) || p.startsWith("/~") ? p : `/s/${domainData.slug}${p}`,

    onProxyRes: injectSlug
      ? async (proxyRes, req, res) => {
          const enc = proxyRes.headers["content-encoding"];
          const chunks = [];

          proxyRes.on("data", (chunk) => chunks.push(chunk));
          proxyRes.on("end", () => {
            try {
              let buffer = Buffer.concat(chunks);
              const contentType = proxyRes.headers["content-type"] || "";

              delete proxyRes.headers["content-encoding"];
              delete proxyRes.headers["content-length"];

              if (enc === "gzip") buffer = zlib.gunzipSync(buffer);
              else if (enc === "br") buffer = zlib.brotliDecompressSync(buffer);

              if (contentType.includes("text/html")) {
                let html = buffer.toString("utf8");

                // 🧩 Corrige URLs absolutas → relativas (para evitar CORS)
                html = html
                  .replace(/https:\/\/catalogovirtual\.app\.br\/assets\//g, "/assets/")
                  .replace(/https:\/\/catalogovirtual\.app\.br\/~flock\.js/g, "/~flock.js")
                  .replace(/https:\/\/catalogovirtual\.app\.br\/~api\//g, "/~api/")
                  .replace("</head>", `<script>window.STORE_SLUG="${domainData.slug}";</script>\n</head>`);

                res.writeHead(proxyRes.statusCode, {
                  ...proxyRes.headers,
                  "Access-Control-Allow-Origin": "*",
                });
                res.end(html);
              } else {
                res.writeHead(proxyRes.statusCode, {
                  ...proxyRes.headers,
                  "Access-Control-Allow-Origin": "*",
                });
                res.end(buffer);
              }
            } catch (e) {
              console.error("⚠️ Falha ao processar HTML:", e.message);
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.end("Erro ao processar resposta");
            }
          });
        }
      : (proxyRes) => {
          proxyRes.headers["Access-Control-Allow-Origin"] = "*";
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
