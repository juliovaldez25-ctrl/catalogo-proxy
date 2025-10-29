import express from "express";
import { createProxyMiddleware, responseInterceptor } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

/* ======================================================
   CONFIG PRINCIPAL
====================================================== */
const CONFIG = {
  SUPABASE_URL: "https://hbpekfnexdtnbahmmufm.supabase.co",
  SUPABASE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODk4NTUxNywiZXhwIjoyMDc0NTYxNTE3fQ.cMiKA-_TqdgCNcuMzbu3qTRjiTPHZWH-dwVeEQ8lTtA",
  ORIGIN: "https://catalogovirtual.app.br",
  CACHE_TTL: 1000 * 60 * 10,
  PORT: process.env.PORT || 8080,
};

/* ======================================================
   CACHE LOCAL
====================================================== */
const cache = new Map();
const setCache = (h, d) => cache.set(h, { data: d, exp: Date.now() + CONFIG.CACHE_TTL });
const getCache = (h) => {
  const c = cache.get(h);
  if (!c || Date.now() > c.exp) return null;
  return c.data;
};

/* ======================================================
   CONSULTA AO SUPABASE
====================================================== */
async function getDomainData(host) {
  if (!host) return null;
  const cached = getCache(host);
  if (cached) return cached;

  try {
    const headers = {
      apikey: CONFIG.SUPABASE_KEY.trim(),
      Authorization: `Bearer ${CONFIG.SUPABASE_KEY.trim()}`,
    };

    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=slug,status`,
      { headers }
    );

    if (!res.ok) {
      console.error(`❌ Supabase ${res.status}: ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    const row = data?.[0];
    if (row && ["active", "verified"].includes(row.status)) {
      setCache(host, row);
      console.log(`✅ Domínio ativo: ${host} → slug "${row.slug}"`);
      return row;
    }
  } catch (err) {
    console.error(`⚠️ Erro Supabase: ${err.message}`);
  }

  return null;
}

/* ======================================================
   DETECTA ASSETS
====================================================== */
function isAsset(path) {
  return /\.(js|css|png|jpg|jpeg|gif|svg|ico|webp|json|woff2?)$/i.test(path);
}

/* ======================================================
   PROXY PRINCIPAL
====================================================== */
app.use(async (req, res, next) => {
  const host = req.headers.host?.trim().toLowerCase();
  const cleanHost = host?.replace(/^www\./, "");
  const path = req.path;

  if (!cleanHost) return res.status(200).send("✅ Proxy ativo e aguardando conexões");

  const domainData = await getDomainData(cleanHost);
  if (!domainData) {
    return res.status(404).send(`<h1>Domínio não configurado: ${cleanHost}</h1>`);
  }

  const slug = domainData.slug;
  const target = CONFIG.ORIGIN;
  const asset = isAsset(path);

  console.log(`➡️ Proxy: ${cleanHost}${path} → ${target}/s/${slug}${asset ? path : ""}`);

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    selfHandleResponse: !asset,
    onProxyRes: !asset
      ? responseInterceptor(async (buffer, proxyRes, req, res) => {
          const contentType = proxyRes.headers["content-type"];
          if (contentType && contentType.includes("text/html")) {
            let html = buffer.toString("utf8");
            // Corrige assets e injeta meta
            html = html
              .replaceAll(`/s/${slug}/assets/`, `/assets/`)
              .replaceAll(`href="/s/${slug}`, `href="/"`)
              .replaceAll(`src="/s/${slug}`, `src="/"`)
              .replace(
                "<head>",
                `<head>
                   <base href="/" />
                   <meta name="store-slug" content="${slug}" />
                   <script>window.STORE_SLUG="${slug}";</script>`
              );
            return html;
          }
          return buffer;
        })
      : undefined,
    pathRewrite: (path) => {
      // ✅ Corrige caminhos dos assets
      if (asset) return `/s/${slug}${path}`;
      if (path === "/" || path === "") return `/s/${slug}`;
      return `/s/${slug}${path}`;
    },
    headers: {
      "X-Forwarded-Host": host,
      "X-Store-Slug": slug,
    },
  })(req, res, next);
});

/* ======================================================
   INICIA SERVIDOR
====================================================== */
app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`);
});
