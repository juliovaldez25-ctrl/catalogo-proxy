/**
 * 🧱 Proxy Reverso - Catálogo Virtual
 * 🚀 Redirecionamento robusto + reescrita automática de rotas
 */

import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

/* ======================================================
   ⚙️ CONFIGURAÇÕES
====================================================== */
const CONFIG = {
  SUPABASE_URL: "https://hbpekfnexdtnbahmmufm.supabase.co",
  SUPABASE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODk4NTUxNywiZXhwIjoyMDc0NTYxNTE3fQ.cMiKA-_TqdgCNcuMzbu3qTRjiTPHZWH-dwVeEQ8lTtA",
  ORIGIN: "https://catalogovirtual.app.br",
  CACHE_TTL: 1000 * 60 * 10,
  TIMEOUT: 7000,
  PORT: process.env.PORT || 8080,
};

/* ======================================================
   🧠 CACHE
====================================================== */
const cache = new Map();
const setCache = (host, data) => cache.set(host, { data, exp: Date.now() + CONFIG.CACHE_TTL });
const getCache = (host) => {
  const c = cache.get(host);
  if (!c || Date.now() > c.exp) return null;
  return c.data;
};

/* ======================================================
   🔍 FUNÇÃO DE BUSCA SUPABASE
====================================================== */
async function getDomainData(host) {
  if (!host) return null;
  const cached = getCache(host);
  if (cached) return cached;

  try {
    const headers = {
      apikey: CONFIG.SUPABASE_KEY.trim(),
      Authorization: `Bearer ${CONFIG.SUPABASE_KEY.trim()}`,
    };

    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=slug,status`,
      { headers }
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

/* ======================================================
   🧭 MIDDLEWARE PRINCIPAL
====================================================== */
app.use(async (req, res, next) => {
  const host = req.headers.host?.trim().toLowerCase();
  const cleanHost = host?.replace(/^www\./, "");
  const path = req.path;

  if (!cleanHost) return res.status(200).send("✅ Proxy ativo e aguardando conexões");

  const domainData = await getDomainData(cleanHost);
  if (!domainData) {
    console.warn(`⚠️ Domínio não configurado: ${cleanHost}`);
    return res.status(404).send(`<h1>Domínio não configurado: ${cleanHost}</h1>`);
  }

  const slug = domainData.slug;

  console.log(`➡️ Proxy: ${cleanHost}${path} → ${CONFIG.ORIGIN}/s/${slug}`);

  return createProxyMiddleware({
    target: CONFIG.ORIGIN,
    changeOrigin: true,
    xfwd: true,
    followRedirects: true,
    proxyTimeout: 10000,
    pathRewrite: (path, req) => {
      if (path === "/" || path === "") return `/s/${slug}`;
      return path.startsWith(`/s/${slug}`) ? path : `/s/${slug}${path}`;
    },
    onError(err, req, res) {
      console.error(`❌ ProxyError: ${err.message}`);
      res.status(502).send(`<h2>Erro temporário</h2><p>${err.message}</p>`);
    },
  })(req, res, next);
});

/* ======================================================
   🚀 START
====================================================== */
app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`);
});
