import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

// 🚀 Configurações do Supabase
const SUPABASE_URL = "https://hbpekfnexdtnbahmmufm.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5ODU1MTcsImV4cCI6MjA3NDU2MTUxN30.R2eMWKM9naCbNizHzB_W7Uvm8cNpEDukb9mf4wNLt5M";

// 🔍 Endpoint de debug opcional
app.get("/debug", async (req, res) => {
  const host = req.headers.host?.replace("www.", "").trim();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  const data = await response.json();
  res.json({ host, data });
});

// 🌐 Proxy principal
app.use(async (req, res, next) => {
  const host = req.headers.host?.replace("www.", "").trim();
  console.log(`🌍 Acesso recebido: ${host}`);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    const data = await response.json();
    console.log("🔎 Retorno Supabase:", data);

    if (Array.isArray(data) && data.length > 0) {
      const { slug, status } = data[0];

      if (status !== "active" && status !== "verified") {
        return res.status(403).send("<h2>Domínio ainda não verificado</h2>");
      }

      const target = `https://catalogovirtual.app.br/${slug}`;
      console.log(`➡️ Redirecionando para: ${target}`);

      // Proxy avançado
      return createProxyMiddleware({
        target,
        changeOrigin: true,
        secure: false,
        followRedirects: true,
        onProxyReq: (proxyReq) => {
          proxyReq.setHeader("x-forwarded-host", host);
        },
        onError: (err, req, res) => {
          console.error("❌ Erro no proxy:", err.message);
          res.status(500).send("<h1>Erro ao carregar destino</h1>");
        },
      })(req, res, next);
    }

    res.status(404).send("<h1>Domínio não configurado</h1>");
  } catch (error) {
    console.error("💥 Erro no servidor:", error);
    res.status(500).send("<h1>Erro interno</h1>");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy ativo na porta ${PORT}`));
