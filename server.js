import express from "express";
import { createProxyMiddleware, responseInterceptor } from "http-proxy-middleware";
import fetch from "node-fetch";
import zlib from "zlib";

const app = express();

const CONFIG = {
  EDGE_DOMAIN_API: "https://hbpekfnexdtnbahmmufm.supabase.co/functions/v1/cors-allow",
  ORIGIN: "https://catalogovirtual.app.br",
  CACHE_TTL: 1000 * 60 * 10, // 10 minutos
  TIMEOUT: 7000,
  PORT: process.env.PORT || 8080,
};

const domainCache = new Map();

function setCache(host, data) {
  domainCache.set(host, { data, expires: Date.now() + CONFIG.CACHE_TTL });
}
function getCache(host) {
  const cached = domainCache.get(host);
  if (!cached) return null;
  if (Date.now() > cached.expires) {
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
    const res = await fetch(`${CONFIG.EDGE_DOMAIN_API}?test=supabase&domain=${encodeURIComponent(host)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const row = data?.sample || data;
    if (row && row.slug) {
      setCache(host, row);
      return row;
    }
  } catch (err) {
    console.error(`⚠️ Erro Edge Function: ${err.message}`);
  }
  return null;
}

/* ======================================================
   🌍 LIBERA CORS GLOBAL
====================================================== */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  next();
});

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
   🚀 MIDDLEWARE PRINCIPAL
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
    ? `${CONFIG.ORIGIN}${path}`
    : `${CONFIG.ORIGIN}/s/${domainData.slug}`;

  console.log(`➡️ Proxy: ${cleanHost}${path} → ${target}`);

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    followRedirects: true,
    selfHandleResponse: true, // ⚙️ intercepta resposta para tratar gzip e injetar slug

    onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
      let body = responseBuffer;

      // 🔧 Descompacta caso venha gzip ou br
      const encoding = proxyRes.headers["content-encoding"];
      if (encoding === "gzip") {
        body = zlib.gunzipSync(body);
        delete proxyRes.headers["content-encoding"];
      } else if (encoding === "br") {
        body = zlib.brotliDecompressSync(body);
        delete proxyRes.headers["content-encoding"];
      }

      const contentType = proxyRes.headers["content-type"] || "";
      const isHtml = contentType.includes("text/html");

      if (isHtml) {
        let html = body.toString("utf8");
        if (html.includes('<div id="root"></div>')) {
          html = html.replace(
            "</head>",
            `<script>window.STORE_SLUG="${domainData.slug}";</script>\n</head>`
          );
        }
        return html;
      }

      return body;
    }),

    onError(err, req, res) {
      console.error(`❌ ProxyError [${cleanHost}]`, err.message);
      res.status(502).send(`
        <html><body style="font-family:sans-serif;text-align:center;margin-top:40px">
        <h2>❌ Erro temporário</h2>
        <p>Não foi possível carregar a loja de <b>${cleanHost}</b>.</p>
        <p>${err.message}</p>
        </body></html>
      `);
    },
  })(req, res, next);
});

/* ======================================================
   🟢 INICIALIZA SERVIDOR
====================================================== */
app.listen(CONFIG.PORT, "0.0.0.0", () =>
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`)
);
