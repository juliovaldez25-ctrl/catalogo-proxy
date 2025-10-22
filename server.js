import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

// ⚙️ Configurações principais
const SUPABASE_URL = "https://hbpekfnexdtnbahmmufm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5ODU1MTcsImV4cCI6MjA3NDU2MTUxN30.R2eMWKM9naCbNizHzB_W7Uvm8cNpEDukb9mf4wNLt5M";
const BASE_TARGET = "https://catalogovirtual.app.br";

// ⚡ Cache simples em memória
const domainCache = new Map();

// 🔍 Função para buscar domínio no Supabase
async function getDomainData(host) {
  if (domainCache.has(host)) return domainCache.get(host);

  const response = await fetch(`${SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=*`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });

  const data = await response.json();

  if (data?.length > 0 && data[0].status === "active") {
    domainCache.set(host, data[0]);
    return data[0];
  }

  return null;
}

// 🧭 Middleware principal
app.use(async (req, res, next) => {
  const host = req.headers.host?.replace("www.", "").trim();
  const path = req.path;
  console.log(`🌐 Acesso detectado: ${host}${path}`);

  try {
    const domainData = await getDomainData(host);

    if (domainData) {
      const slug = domainData.slug;
      const target = BASE_TARGET;

      console.log(`➡️ Redirecionando domínio ${host} -> /s/${slug}${path}`);

      return createProxyMiddleware({
        target,
        changeOrigin: true,
        secure: true,
        pathRewrite: (p) => {
          if (p.startsWith(`/s/${slug}`)) return p; // já correto
          if (p === "/") return `/s/${slug}`;
          return `/s/${slug}${p}`;
        },
        onProxyReq: (proxyReq, req) => {
          console.log(`🛰️ Proxy -> ${target}${req.path}`);
        },
      })(req, res, next);
    }

    console.log(`⚠️ Domínio não configurado: ${host}`);
    res.status(404).send(`<h1>Domínio não configurado no catálogo virtual</h1>`);
  } catch (err) {
    console.error("❌ Erro ao processar proxy:", err);
    res.status(500).send("Erro interno no servidor proxy");
  }
});

// 🧠 Endpoint de debug opcional
app.get("/debug", async (req, res) => {
  const host = req.headers.host?.replace("www.", "").trim();
  const data = await getDomainData(host);
  res.json({ host, data });
});

// 🚀 Inicialização
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy ativo na porta ${PORT}`));
