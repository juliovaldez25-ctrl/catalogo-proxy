/**
 * 🔥 Proxy Reverso - Catálogo Virtual (versão PRO)
 * ✅ Redirecionamento inteligente /s/slug
 * ✅ Suporte a subcaminhos e debug
 * ✅ Tolerante a falhas (fallback para ORIGIN base)
 */

import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

/* ======================================================
   ⚙️ CONFIGURAÇÕES PRINCIPAIS
====================================================== */
const CONFIG = {
  SUPABASE_URL: "https://hbpekfnexdtnbahmmufm.supabase.co",
  SUPABASE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODk4NTUxNywiZXhwIjoyMDc0NTYxNTE3fQ.cMiKA-_TqdgCNcuMzbu3qTRjiTPHZWH-dwVeEQ8lTtA",
  ORIGIN: "https://catalogovirtual.app.br",
  CACHE_TTL: 1000 * 60 * 10, // 10 minutos
  TIMEOUT: 7000, // 7 segundos
  PORT: process.env.PORT || 8080,
};

/* ======================================================
   🧠 CACHE DE DOMÍNIOS (com TTL)
====================================================== */
const domainCache = new Map();
const setCache = (h, d) => domainCache.set(h, { data: d, expires: Date.now() + CONFIG.CACHE_TTL });
const getCache = (h) => {
  const c = domainCache.get(h);
  if (!c || Date.now() > c.expires) return null;
  return c.data;
};

/* ======================================================
   🛰️ FUNÇÃO: BUSCA DOMÍNIO NO SUPABASE
====================================================== */
async function getDomainData(host) {
  if (!host) return null;

  const cached = getCache(host);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

  try {
    const headers = {
      apikey: CONFIG.SUPABASE_KEY.trim(),
      Authorization: `Bearer ${CONFIG.SUPABASE_KEY.trim()}`,
      Accept: "application/json",
    };

    const url = `${CONFIG.SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=slug,status`;
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

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

    console.warn(`⚠️ Domínio encontrado mas inativo: ${host}`);
  } catch (err) {
    console.error(`⚠️ Erro Supabase: ${err.message}`);
  }

  return null;
}

/* ======================================================
   🚦 ROTAS ESTÁTICAS
====================================================== */
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

/* ======================================================
   🧭 MIDDLEWARE PRINCIPAL
====================================================== */
app.use(async (req, res, next) => {
  const host = req.headers.host?.trim().toLowerCase() || "";
  const cleanHost = host.replace(/^www\./, "");
  const path = req.path;

  console.log(`🌐 ${cleanHost} → ${path}`);

  if (!cleanHost) return res.status(200).send("✅ Proxy ativo e aguardando domínios");

  if (path === "/__debug") {
    const info = await getDomainData(cleanHost);
    return res.json({ host: cleanHost, slug: info?.slug || null, status: info?.status || "unknown" });
  }

  const domainData = await getDomainData(cleanHost);
  if (!domainData) {
    console.warn(`⚠️ Domínio não configurado: ${cleanHost}`);
    return res.status(404).send(`<h1>Domínio não configurado: ${cleanHost}</h1>`);
  }

  const slug = domainData.slug;
  let target;

  // Roteamento inteligente
  if (isStatic(path)) {
    target = CONFIG.ORIGIN;
  } else if (path === "/" || path === "") {
    target = `${CONFIG.ORIGIN}/s/${slug}`;
  } else if (path.startsWith(`/s/${slug}`)) {
    target = CONFIG.ORIGIN;
  } else {
    target = `${CONFIG.ORIGIN}/s/${slug}${path}`;
  }

  console.log(`➡️ Proxy: ${cleanHost}${path} → ${target}`);

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    followRedirects: true,
    xfwd: true,
    proxyTimeout: 10000,
    headers: {
      "X-Forwarded-Host": host,
      "X-Forwarded-Proto": "https",
      "User-Agent": req.headers["user-agent"] || "CatalogoProxy",
    },
    onError(err, req, res) {
      console.error(`❌ ProxyError ${cleanHost}: ${err.message}`);
      res.status(502).send(`<h2>Erro temporário ao acessar ${cleanHost}</h2><p>${err.message}</p>`);
    },
  })(req, res, next);
});

/* ======================================================
   🚀 INICIALIZA SERVIDOR
====================================================== */
app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`);
});
