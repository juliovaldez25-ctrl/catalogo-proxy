import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

const SUPABASE_URL = "https://hbpekfnexdtnbahmmufm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5ODU1MTcsImV4cCI6MjA3NDU2MTUxN30.R2eMWKM9naCbNizHzB_W7Uvm8cNpEDukb9mf4wNLt5M"; // ou use process.env.SUPABASE_KEY

// Endpoints úteis
app.get("/debug", async (req, res) => {
  const host = req.headers.host?.replace("www.", "").trim();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  res.json({ host, data: await r.json(), path: req.path, originalUrl: req.originalUrl });
});

// Quais paths NÃO devem ir para /s/{slug}
const STATIC_MATCHERS = [
  /^\/assets\//,
  /^\/favicon\.ico$/,
  /^\/site\.webmanifest$/,
  /^\/robots\.txt$/,
  /^\/sitemap\.xml$/,
  /^\/~flock\.js$/,
  /^\/~api\//,
];

function isStaticPath(pathname) {
  return STATIC_MATCHERS.some((rx) => rx.test(pathname));
}

app.use(async (req, res, next) => {
  const host = req.headers.host?.replace("www.", "").trim();
  if (!host) return res.status(400).send("Host header missing");

  // Busca o slug no Supabase
  let slug = null;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0) {
      const row = data[0];
      if (row.status !== "active" && row.status !== "verified") {
        return res.status(403).send("<h2>Domínio pendente de verificação</h2>");
      }
      slug = row.slug;
    } else {
      return res.status(404).send("<h1>Domínio não configurado</h1>");
    }
  } catch (e) {
    console.error("Erro consultando Supabase:", e);
    return res.status(500).send("Erro interno");
  }

  // Define destino e reescrita de path
  const TARGET_ORIGIN = "https://catalogovirtual.app.br";
  const isStatic = isStaticPath(req.path);

  // Para assets: mantém o path exato (/assets/..., /~api/..., favicon, etc.)
  // Para rotas do app: prefixa /s/{slug}
  const proxy = createProxyMiddleware({
    target: TARGET_ORIGIN,
    changeOrigin: true,
    secure: true,
    followRedirects: true,
    headers: {
      "X-Forwarded-Host": host,
      "X-Forwarded-Proto": "https",
      "User-Agent": req.headers["user-agent"] || "Render-Proxy",
    },
    pathRewrite: (path) => {
      if (isStatic) return path; // ex.: /assets/xxx.js → /assets/xxx.js
      // ex.: "/" → /s/slug
      // ex.: "/produto/123" → /s/slug/produto/123
      if (path === "/") return `/s/${slug}`;
      return `/s/${slug}${path}`;
    },
    onError(err, rq, rs) {
      console.error("Proxy error:", err.message);
      rs.status(502).send("<h1>Erro ao carregar a loja</h1>");
    },
  });

  return proxy(req, res, next);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy ativo na porta ${PORT}`));
