import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

/* ======================================================
   🔧 CONFIGURAÇÕES PRINCIPAIS
====================================================== */
const CONFIG = {
  EDGE_FUNCTION: "https://hbpekfnexdtnbahmmufm.supabase.co/functions/v1/cors-allow",
  ORIGIN: "https://catalogovirtual.app.br",
  CACHE_TTL: 1000 * 60 * 10, // 10 min
  TIMEOUT: 8000, // 8s
  PORT: process.env.PORT || 8080,
};

/* ======================================================
   🧠 CACHE LOCAL
====================================================== */
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
   🌐 FUNÇÃO: BUSCA DOMÍNIO VIA EDGE FUNCTION (Supabase)
====================================================== */
async function getDomainData(host) {
  if (!host) return null;

  const cached = getCache(host);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

  try {
    const url = `${CONFIG.EDGE_FUNCTION}?domain=${encodeURIComponent(host)}`;
    const res = await fetch(url, { signal: controller.signal });

    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`❌ Edge retornou ${res.status}: ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    if (data?.slug && ["active", "verified"].includes(data.status)) {
      setCache(host, data);
      return data;
    }
  } catch (err) {
    console.error(`⚠️ Erro ao consultar Edge Function: ${err.message}`);
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

  console.log(`🌐 Host: ${cleanHost} | ${path}`);

  // Página de status
  if (!cleanHost || cleanHost.includes("railway.app")) {
    return res.status(200).send("✅ Proxy ativo e aguardando conexões Cloudflare");
  }

  const domainData = await getDomainData(cleanHost);

  if (!domainData) {
    console.warn(`⚠️ Domínio não encontrado: ${cleanHost}`);
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

  console.log(`➡️ Proxy → ${target}${path}`);

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    xfwd: true,
    followRedirects: true,
    proxyTimeout: 10000,

    onProxyRes(proxyRes, req, res) {
      delete proxyRes.headers["content-encoding"]; // evita erro gzip
    },

    onError(err, req, res) {
      console.error(`❌ ProxyError [${cleanHost}]`, err.message);
      res.status(502).send(`
        <html><body style="font-family:sans-serif;text-align:center;margin-top:40px">
        <h2>❌ Erro 502 - Bad Gateway</h2>
        <p>Falha ao conectar com a loja <b>${cleanHost}</b>.</p>
        <p>${err.message}</p>
        </body></html>
      `);
    },
  })(req, res, next);
});

/* ======================================================
   🚀 INICIALIZA SERVIDOR
====================================================== */
app.listen(CONFIG.PORT, "0.0.0.0", () =>
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`)
);
