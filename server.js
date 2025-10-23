import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

// 🔑 Configuração
const SUPABASE_URL = "https://hbpekfnexdtnbahmmufm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5ODU1MTcsImV4cCI6MjA3NDU2MTUxN30.R2eMWKM9naCbNizHzB_W7Uvm8cNpEDukb9mf4wNLt5M";
const ORIGIN = "https://catalogovirtual.app.br"; // domínio original das lojas

// 🧠 Cache de domínios
const domainCache = new Map();
async function getDomainData(host) {
  if (domainCache.has(host)) return domainCache.get(host);

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=slug,status`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );

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

// ⚙️ Paths estáticos
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

// 🧭 Proxy principal (substituído pelo novo bloco)
app.use(async (req, res, next) => {
  const originalHost = req.headers.host?.trim() || "";
  const cleanHost = originalHost.replace(/^www\./, "");
  const path = req.path;

  // tenta domínio exatamente como chegou
  let domainData = await getDomainData(cleanHost);

  // se não encontrar, tenta com www.
  if (!domainData) {
    const wwwHost = `www.${cleanHost}`;
    domainData = await getDomainData(wwwHost);
    if (domainData) {
      console.log(`↪️ Redirecionando ${originalHost} → ${wwwHost}`);
      return res.redirect(301, `https://${wwwHost}${req.url}`);
    }
  }

  if (!domainData) {
    console.log(`⚠️ Domínio não configurado: ${originalHost}`);
    return res
      .status(404)
      .send("<h1>Domínio não configurado no Catálogo Virtual</h1>");
  }

  const { slug } = domainData;
  const isStaticFile = isStatic(path);
  const target = isStaticFile ? ORIGIN : `${ORIGIN}/s/${slug}`;

  console.log(`➡️ Proxy: ${originalHost}${path} → ${target}`);

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    followRedirects: true,
    headers: {
      "X-Forwarded-Host": originalHost,
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
