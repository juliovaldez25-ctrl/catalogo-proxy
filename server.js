import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

// 🔑 Configurações Supabase
const SUPABASE_URL = "https://hbpekfnexdtnbahmmufm.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5ODU1MTcsImV4cCI6MjA3NDU2MTUxN30.R2eMWKM9naCbNizHzB_W7Uvm8cNpEDukb9mf4wNLt5M";

// 🧠 Endpoint de debug
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

// 🚀 Middleware principal
app.use(async (req, res, next) => {
  const host = req.headers.host?.replace("www.", "").trim();
  console.log(`🌍 Novo acesso recebido: ${host}`);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    const data = await response.json();
    console.log("🔎 Supabase retornou:", data);

    if (Array.isArray(data) && data.length > 0) {
      const { slug, status } = data[0];

      if (status !== "active" && status !== "verified") {
        return res.status(403).send("<h2>⚠️ Domínio pendente de verificação</h2>");
      }

      const target = `https://catalogovirtual.app.br/${slug}`;
      console.log(`➡️ Redirecionando ${host} → ${target}`);

      // ✅ Proxy avançado com HTTPS e cabeçalhos completos
      return createProxyMiddleware({
        target,
        changeOrigin: true,
        followRedirects: true,
        secure: true,
        headers: {
          "X-Forwarded-Host": host,
          "X-Forwarded-Proto": "https",
          "User-Agent": req.headers["user-agent"] || "Render-Proxy",
        },
        onError: (err, req, res) => {
          console.error("❌ Erro no proxy:", err.message);
          res.status(500).send("<h1>Erro ao carregar a loja</h1>");
        },
      })(req, res, next);
    }

    res.status(404).send("<h1>Domínio não configurado</h1>");
  } catch (error) {
    console.error("💥 Erro geral:", error);
    res.status(500).send("<h1>Erro interno</h1>");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy ativo na porta ${PORT}`));
