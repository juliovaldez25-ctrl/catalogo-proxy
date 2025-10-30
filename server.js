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
  EDGE_FUNCTION:
    "https://hbpekfnexdtnbahmmufm.supabase.co/functions/v1/get-domain",
  ORIGIN: "https://catalogovirtual.app.br",
  CACHE_TTL: 1000 * 60 * 10,
  PORT: process.env.PORT || 8080,
};

/* ======================================================
   🌐 CORS GLOBAL
====================================================== */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

/* ======================================================
   🧠 CACHE
====================================================== */
const cache = new Map();
function setCache(host, data) {
  cache.set(host, { data, expires: Date.now() + CONFIG.CACHE_TTL });
}
function getCache(host) {
  const cached = cache.get(host);
  if (!cached || Date.now() > cached.expires) {
    cache.delete(host);
    return null;
  }
  return cached.data;
}

/* ======================================================
   🛰️ BUSCA DOMÍNIO
====================================================== */
async function getDomainData(host) {
  if (!host) return null;
  const cached = getCache(host);
  if (cached) return cached;

  try {
    const res = await fetch(`${CONFIG.EDGE_FUNCTION}?domain=${host}`, {
      headers: { Authorization: `Bearer ${CONFIG.SUPABASE_KEY}` },
    });

    if (res.ok) {
      const json = await res.json();
      if (json?.slug) {
        setCache(host, json);
        return json;
      }
    }

    // fallback
    const rest = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=slug,status`,
      {
        headers: {
          apikey: CONFIG.SUPABASE_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
        },
      }
    );
    if (rest.ok) {
      const data = await rest.json();
      const row = data?.[0];
      if (row && ["active", "verified"].includes(row.status)) {
        setCache(host, row);
        return row;
      }
    }
  } catch (err) {
    console.error("⚠️ Erro Supabase:", err.message);
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
  /^\/site\.webmanifest$/,
  /^\/~flock\.js$/,
  /^\/~api\//,
];
const isStatic = (path) => STATIC_PATHS.some((rx) => rx.test(path));

/* ======================================================
   🧭 MIDDLEWARE PRINCIPAL
====================================================== */
app.use(async (req, res, next) => {
  const host = req.headers.host?.trim().toLowerCase();
  const path = req.path;

  if (!host) return res.status(400).send("Host inválido");

  console.log(`🌎 ${host} → ${path}`);

  if (host.includes("railway.app")) {
    return res.status(200).send("✅ Proxy ativo e aguardando conexões Cloudflare");
  }

  const domainData = await getDomainData(host);
  if (!domainData) {
    return res.status(404).send(`<h3>⚠️ Domínio não configurado: ${host}</h3>`);
  }

  const slug = domainData.slug;
  const target = CONFIG.ORIGIN;

  // ======================================================
  // 📄 Se for asset ou API → proxy direto
  // ======================================================
  if (isStatic(path) || path.startsWith("/~")) {
    return createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: () => path,
      headers: { "Access-Control-Allow-Origin": "*" },
    })(req, res, next);
  }

  // ======================================================
  // 🧠 Caso contrário, busca o index.html da loja
  // ======================================================
  try {
    const resp = await fetch(`${target}/s/${slug}/index.html`);
    const html = await resp.text();

    if (!resp.ok) throw new Error(`Erro ao buscar index.html: ${resp.status}`);

    const fixed = html
      .replace("</head>", `<script>window.STORE_SLUG="${slug}";</script>\n</head>`)
      .replaceAll("https://catalogovirtual.app.br/assets/", "/assets/")
      .replaceAll("https://catalogovirtual.app.br/~flock.js", "/~flock.js");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(fixed);
  } catch (err) {
    console.error("❌ Fallback erro:", err.message);
    res.status(500).send(`<h3>Erro ao carregar loja: ${err.message}</h3>`);
  }
});

/* ======================================================
   🚀 INICIALIZA SERVIDOR
====================================================== */
app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`);
});
