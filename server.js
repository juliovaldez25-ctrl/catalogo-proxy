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
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9zZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODk4NTUxNywiZXhwIjoyMDc0NTYxNTE3fQ.cMiKA-_TqdgCNcuMzbu3qTRjiTPHZWH-dwVeEQ8lTtA",
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
   🛰️ BUSCA DOMÍNIO NO SUPABASE (Edge Function)
====================================================== */
async function getDomainData(host) {
  if (!host) return null;
  const cached = getCache(host);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

  try {
    const edge = await fetch(`${CONFIG.EDGE_FUNCTION}?domain=${host}`, {
      headers: {
        Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
      },
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

  // 🔧 Define destino (origem Lovable)
  const target = isStatic(path)
    ? CONFIG.ORIGIN
    : `${CONFIG.ORIGIN}/s/${domainData.slug}`;

  console.log(`➡️ Proxy: ${cleanHost}${path} → ${target}`);

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    xfwd: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "X-Forwarded-Host": originalHost,
      "X-Forwarded-Proto": "https",
      "User-Agent": req.headers["user-agent"] || "CatalogoProxy",
    },

    onProxyRes(proxyRes, req, res) {
      const enc = proxyRes.headers["content-encoding"];
      const chunks = [];

      proxyRes.on("data", (chunk) => chunks.push(chunk));
      proxyRes.on("end", () => {
        let buffer = Buffer.concat(chunks);
        const contentType = proxyRes.headers["content-type"] || "";

        delete proxyRes.headers["content-encoding"];
        delete proxyRes.headers["content-length"];

        if (enc === "gzip") buffer = zlib.gunzipSync(buffer);
        else if (enc === "br") buffer = zlib.brotliDecompressSync(buffer);

        if (contentType.includes("text/html")) {
          let html = buffer.toString("utf8");

          // ✅ Injeta script de redirecionamento automático
          html = html.replace(
            "</head>",
            `<script>
              (function() {
                const slug = "${domainData.slug}";
                const pathname = window.location.pathname;
                if (!pathname.startsWith('/s/' + slug)) {
                  if (!pathname.startsWith('/assets') && !pathname.startsWith('/~') && pathname !== '/favicon.ico') {
                    const novaUrl = '/s/' + slug + pathname;
                    console.log('🔁 Redirecionando automaticamente para:', novaUrl);
                    window.location.replace(novaUrl);
                  }
                }
              })();
            </script>\n</head>`
          );

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
      });
    },

    onError(err, req, res) {
      console.error("❌ ProxyError", err.message);
      res
        .status(502)
        .send(`<h2>Erro 502</h2><p>${err.message}</p>`);
    },
  })(req, res, next);
});

/* ======================================================
   🚀 INICIALIZA SERVIDOR
====================================================== */
app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`);
});
