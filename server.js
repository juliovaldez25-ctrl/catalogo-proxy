import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

// 🔑 Configuração
const SUPABASE_URL = "https://hbpekfnexdtnbahmmufm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5ODU1MTcsImV4cCI6MjA3NDU2MTUxN30.R2eMWKM9naCbNizHzB_W7Uvm8cNpEDukb9mf4wNLt5M";
const ORIGIN = "https://catalogovirtual.app.br"; // domínio original das lojas

// 🧠 Cache de domínios para performance
const domainCache = new Map();
async function getDomainData(host) {
  if (domainCache.has(host)) return domainCache.get(host);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=slug,status`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });

  const data = await res.json();
  if (Array.isArray(data) && data.length > 0) {
    const row = data[0];
    if (row.status === "active" || row.status === "verified") {
      domainCache.set(host, row);
      return row;
    }
  }
  return null;
}

// ⚙️ Identifica paths estáticos (não precisam de slug)
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

// 🧭 Proxy principal
app.use(async (req, res, next) => {
  const host = req.headers.host?.replace(/^www\./, "").trim();
  const path = req.path;

  // Busca slug no Supabase
  const domainData = await getDomainData(host);
  if (!domainData) {
    console.log(`⚠️ Domínio não configurado: ${host}`);
    return res.status(404).send("<h1>Domínio não configurado no Catálogo Virtual</h1>");
  }

  const { slug } = domainData;
  const isStaticFile = isStatic(path);

  // Define alvo dinâmico
  const target = isStaticFile
    ? ORIGIN // assets e arquivos estáticos
    : `${ORIGIN}/s/${slug}`; // conteúdo da loja

  console.log(`➡️ Proxy: ${host}${path} → ${target}`);

  // Proxy sem pathRewrite, apenas com roteamento dinâmico
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    followRedirects: true,
    headers: {
      "X-Forwarded-Host": host,
      "X-Forwarded-Proto": "https",
      "User-Agent": req.headers["user-agent"] || "CatalogoProxy",
    },
    onError(err, req, res) {
      console.error("❌ Erro no proxy:", err.message);
      res.status(502).send("<h1>Erro ao carregar a loja</h1>");
    },
  })(req, res, next);
});

// 🚀 Inicializa servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy reverso ativo na porta ${PORT}`));
