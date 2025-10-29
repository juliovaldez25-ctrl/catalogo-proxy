import express from "express";
import { createProxyMiddleware, responseInterceptor } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

const CONFIG = {
  SUPABASE_URL: "https://hbpekfnexdtnbahmmufm.supabase.co",
  SUPABASE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODk4NTUxNywiZXhwIjoyMDc0NTYxNTE3fQ.cMiKA-_TqdgCNcuMzbu3qTRjiTPHZWH-dwVeEQ8lTtA",
  ORIGIN: "https://catalogovirtual.app.br",
  CACHE_TTL: 1000 * 60 * 10,
  PORT: process.env.PORT || 8080,
};

// Cache simples
const cache = new Map();
const setCache = (h, d) => cache.set(h, { data: d, exp: Date.now() + CONFIG.CACHE_TTL });
const getCache = (h) => {
  const c = cache.get(h);
  if (!c || Date.now() > c.exp) return null;
  return c.data;
};

// Consulta domínio no Supabase
async function getDomainData(host) {
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
      console.log(`✅ Domínio ativo: ${host} → slug "${row.slug}"`);
      return row;
    }
  } catch (err) {
    console.error(`⚠️ Erro Supabase: ${err.message}`);
  }
  return null;
}

// Middleware principal
app.use(async (req, res, next) => {
  const host = req.headers.host?.trim().toLowerCase();
  const path = req.path;

  if (!host) return res.status(200).send("✅ Proxy ativo");

  const domainData = await getDomainData(host);
  if (!domainData)
    return res
      .status(404)
      .send(`<h1>⚠️ Domínio não configurado: ${host}</h1>`);

  const slug = domainData.slug;

// 🔹 Proxy completo para assets (resolve CORS e MIME)
if (path.startsWith("/assets/")) {
  console.log(`🪄 Proxy interno de asset: ${path}`);
  return createProxyMiddleware({
    target: CONFIG.ORIGIN,
    changeOrigin: true,
    followRedirects: true,
    secure: false,
    onProxyReq(proxyReq, req, res) {
      // Remove cabeçalhos de origem que causam CORS
      proxyReq.removeHeader("origin");
      proxyReq.removeHeader("referer");
    },
    onProxyRes(proxyRes, req, res) {
      // Injeta cabeçalhos corretos
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Origin, Content-Type, Accept");

      // Corrige MIME
      const url = req.url;
      if (url.endsWith(".css")) res.setHeader("Content-Type", "text/css");
      if (url.endsWith(".js")) res.setHeader("Content-Type", "application/javascript");
      if (url.endsWith(".jpg") || url.endsWith(".jpeg")) res.setHeader("Content-Type", "image/jpeg");
      if (url.endsWith(".png")) res.setHeader("Content-Type", "image/png");
      if (url.endsWith(".svg")) res.setHeader("Content-Type", "image/svg+xml");
    },
  })(req, res, next);
}


  // Proxy para API
  if (path.startsWith("/api") || path.startsWith("/~api")) {
    return createProxyMiddleware({
      target: CONFIG.ORIGIN,
      changeOrigin: true,
      onProxyRes(proxyRes, req, res) {
        res.setHeader("Access-Control-Allow-Origin", "*");
      },
    })(req, res, next);
  }

  // Proxy principal - intercepta HTML
  return createProxyMiddleware({
    target: CONFIG.ORIGIN,
    changeOrigin: true,
    selfHandleResponse: true,
    onProxyRes: responseInterceptor(async (buffer, proxyRes, req, res) => {
      const contentType = proxyRes.headers["content-type"];
      if (contentType && contentType.includes("text/html")) {
        let html = buffer.toString("utf8");

        // Reescreve caminhos relativos
        html = html.replaceAll('href="/assets', 'href="https://catalogovirtual.app.br/assets');
        html = html.replaceAll('src="/assets', 'src="https://catalogovirtual.app.br/assets');

        // Injeta slug para renderizar a loja certa
        html = html.replace(
          "<head>",
          `<head>
             <base href="/" />
             <meta name="store-slug" content="${slug}" />
             <script>window.STORE_SLUG="${slug}"</script>`
        );

        return html;
      }
      return buffer;
    }),
    pathRewrite: (path) => `/s/${slug}`,
  })(req, res, next);
});

// Inicia servidor
app.listen(CONFIG.PORT, "0.0.0.0", () =>
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`)
);
