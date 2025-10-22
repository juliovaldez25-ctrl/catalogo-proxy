import express from "express";
import fetch from "node-fetch";

const app = express();

const SUPABASE_URL = "https://hbpekfnexdtnbahmmufm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5ODU1MTcsImV4cCI6MjA3NDU2MTUxN30.R2eMWKM9naCbNizHzB_W7Uvm8cNpEDukb9mf4wNLt5M";

async function getDomain(host) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=slug,status`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const data = await r.json();
  if (Array.isArray(data) && data.length > 0) {
    const row = data[0];
    if (row.status === "active") return row.slug;
  }
  return null;
}

app.use(async (req, res, next) => {
  const host = req.headers.host?.replace(/^www\./, "").trim();
  console.log("🌍 Host:", host);

  const slug = await getDomain(host);
  if (!slug) {
    console.log("⚠️ Domínio não configurado:", host);
    return res.status(404).send("<h1>Domínio não configurado</h1>");
  }

  const targetUrl = `https://catalogovirtual.app.br/s/${slug}${req.path === "/" ? "" : req.path}`;
  console.log("➡️ Redirecionando para:", targetUrl);
  return res.redirect(301, targetUrl);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy redirecionador ativo na porta ${PORT}`));
