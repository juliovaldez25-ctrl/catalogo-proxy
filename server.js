import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

/* ======================================================
   🔑 CONFIGURAÇÕES PRINCIPAIS
====================================================== */
const SUPABASE_URL = "https://hbpekfnexdtnbahmmufm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5ODU1MTcsImV4cCI6MjA3NDU2MTUxN30.R2eMWKM9naCbNizHzB_W7Uvm8cNpEDukb9mf4wNLt5M";
const ORIGIN = "https://catalogovirtual.app.br"; // domínio principal

/* ======================================================
   🧠 CACHE DE DOMÍNIOS (para reduzir consultas ao Supabase)
====================================================== */
const domainCache = new Map();

async function getDomainData(host) {
  if (!host) return null;
  if (domainCache.has(host)) return domainCache.get(host);

  try {
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
  } catch (err) {
    console.error("❌ Erro ao consultar Supabase:", err.message);
  }

  return null;
}

/* ======================================================
   🧩 ROTAS ESTÁTICAS (não devem passar pelo proxy)
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
   🧭 PROXY PRINCIPAL
====================================================== */
app.use(async (req, res, next) => {
  const originalHost = req.headers.host?.trim().toLowerCase() || "";
  const cleanHost = originalHost.replace(/^www\./, "");
  const path = req.path;

  console.log("🌐 Host recebido:", cleanHost, "| Caminho:", path);

  // Ignora chamadas internas de verificação
  if (!cleanHost || cleanHost.includes("railway.app")) {
    return res.status(200).send("✅ Proxy ativo e aguardando conexões Cloudflare");
  }

  // Busca no cache / Supabase
  let domainData = await getDomainData(cleanHost);

  // Tenta com www se não achar
  if (!domainData) {
    const wwwHost = `www.${cleanHost}`;
    domainData = await getDomainData(wwwHost);
    if (domainData) {
      console.log(`↪️ Redirecionando ${originalHost} → ${wwwHost}`);
      return res.redirect(301, `https://${wwwHost}${req.url}`);
    }
  }

  // Domínio não encontrado
  if (!domainData) {
    console.warn(`⚠️ Domínio não configurado: ${cleanHost}`);
    return res
      .status(404)
      .send(`<h1>Domínio não configurado: ${cleanHost}</h1>`);
  }

  // Define destino
  const { slug } = domainData;
  const isStaticFile = isStatic(path);
  const target = isStaticFile ? ORIGIN : `${ORIGIN}/s/${slug}`;

  console.log(`➡️ Proxy: ${cleanHost}${path} → ${target}`);

  // Cria proxy dinâmico
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    followRedirects: true,
    secure: true,
    headers: {
      "X-Forwarded-Host": originalHost,
      "X-Forwarded-Proto": "https",
      "User-Agent": req.headers["user-agent"] || "CatalogoProxy",
    },
    onError(err, req, res) {
      console.error("❌ Erro no proxy:", err.message);
      res
        .status(502)
        .send(`<h1>Erro ao carregar a loja (${cleanHost})</h1>`);
    },
  })(req, res, next);
});

/* ======================================================
   🚀 INICIALIZA SERVIDOR
====================================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Proxy reverso ativo na porta ${PORT}`);
});
