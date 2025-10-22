import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://hbpekfnexdtnbahmmufm.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5ODU1MTcsImV4cCI6MjA3NDU2MTUxN30.R2eMWKM9naCbNizHzB_W7Uvm8cNpEDukb9mf4wNLt5M";

app.get("/test", (req, res) => {
  res.send("✅ Proxy ativo e respondendo normalmente.");
});

app.use(async (req, res, next) => {
  const host = req.headers.host?.replace("www.", "").trim();
  console.log(`🌍 Novo acesso: ${host}`);

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

      // só redireciona se o status for active
      if (status !== "active") {
        console.log(`⚠️ Domínio ${host} encontrado mas com status: ${status}`);
        return res.status(403).send(`<h2>Domínio pendente de verificação</h2>`);
      }

      const target = `https://catalogovirtual.app.br/${slug}`;
      console.log(`➡️ Redirecionando ${host} -> ${target}`);

      return createProxyMiddleware({
        target,
        changeOrigin: true,
        secure: true,
      })(req, res, next);
    }

    console.log(`❌ Domínio não encontrado no Supabase: ${host}`);
    res.status(404).send("<h1>Domínio não configurado</h1>");
  } catch (err) {
    console.error("💥 Erro ao consultar Supabase:", err);
    res.status(500).send("<h1>Erro interno no proxy</h1>");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy ativo na porta ${PORT}`));
