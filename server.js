import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

// 🔑 Configurações do Supabase
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

// 🚀 Proxy principal
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

      // 🔥 Aqui está a correção principal:
      const target = `https://catalogovirtual.app.br/s/${slug}`;
      console.log(`➡️ Redirecionando ${host} → ${target}`);

      // Proxy avançado HTTPS
      return createProxyMiddleware({
        target,
        changeOrigin: true,
        secure: true,
        followRedirects: true,
        headers: {
          "X-Forwarded-Host": host,
          "X-Forwarded-Proto": "https",
          "User-Agent": req.headers["user-agent"] || "Render-Proxy",
        },
        onError: (err, req, res) => {
          console.err
