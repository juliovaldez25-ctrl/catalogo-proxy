
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

const SUPABASE_URL = "https://hbpekfnexdtnbahmmufm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5ODU1MTcsImV4cCI6MjA3NDU2MTUxN30.R2eMWKM9naCbNizHzB_W7Uvm8cNpEDukb9mf4wNLt5M";
const ORIGIN = "https://catalogovirtual.app.br";

// --- helpers ----------------------------------------------------
const STATIC_RX = [
  /^\/assets\//,
  /^\/favicon\.ico$/i,
  /^\/site\.webmanifest$/i,
  /^\/robots\.txt$/i,
  /^\/sitemap\.xml$/i,
  /^\/~flock\.js$/i,
  /^\/~api\//i,
];

const isStatic = (p) => STATIC_RX.some((rx) => rx.test(p));

const domainCache = new Map();
async function getDomain(host) {
  if (!host) return null;
  if (domainCache.has(host)) return domainCache.get(host);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const data = await r.json();
  const row = Array.isArray(data) && data.length ? data[0] : null;
  if (row && (row.status === "active" || row.status === "verified")) {
    domainCache.set(host, row);
    return row;
  }
  return null;
}

// --- rota de debug (antes do proxy!) ----------------------------
app.get("/debug", async (req, res) => {
  try {
    const host = req.headers.host?.replace(/^www\./, "").trim();
    const row = await getDomain(host);
    res.json({ host, row, path: req.path, url: req.originalUrl });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// --- proxy principal -------------------------------------------
app.use(async (req, res, next) => {
  const host = req.headers.host?.replace(/^www\./, "").trim();
  const path = req.path;

  let row;
  try {
    row = await getDomain(host);
  } catch (e) {
    console.error("❌ Supabase error:", e);
    return res.status(500).send("Erro interno");
  }

  if (!row) {
    console.log(`⚠️ Domínio não configurado: ${host}`);
    return res.status(404).send("<h1>Domínio não configurado</h1>");
  }

  const { slug } = row;
  const targetForThisRequest = isStatic(path)
    ? ORIGIN                    // assets, ~api etc. vão direto
    : `${ORIGIN}/s/${slug}`;   // todas as rotas da app vão para /s/{slug}

  console.log(`➡️ ${host}${path}  ->  ${targetForThisRequest}${req.url === "/" ? "/" : ""}`);

  return createProxyMiddleware({
    target: targetForThisRequest,
    changeOrigin: true,
    secure: true,
    followRedirects: true,
    // Não reescrevemos path: o 'router' (target dinâmico) já resolve
    headers: {
      "X-Forwarded-Host": host,
      "X-Forwarded-Proto": "https",
      "User-Agent": req.headers["user-agent"] || "Render-Proxy",
    },
    onError(err, rq, rs) {
      console.error("❌ Proxy error:", err?.message || err);
      rs.status(502).send("<h1>Erro ao carregar a loja</h1>");
    },
  })(req, res, next);
});

// --- start ------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy ativo na porta ${PORT}`));
