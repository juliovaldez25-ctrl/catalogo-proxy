import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";

const app = express();

/* ======================================================
   🔧 CONFIGURAÇÕES PRINCIPAIS
====================================================== */
const CONFIG = {
  SUPABASE_URL: "https://hbpekfnexdtnbahmmufm.supabase.co",
  SUPABASE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODk4NTUxNywiZXhwIjoyMDc0NTYxNTE3fQ.cMiKA-_TqdgCNcuMzbu3qTRjiTPHZWH-dwVeEQ8lTtA",
  ORIGIN: "https://catalogovirtual.app.br",
  CACHE_TTL: 1000 * 60 * 10, // 10 min
  TIMEOUT: 7000,
  PORT: process.env.PORT || 8080,
};

/* ======================================================
   🔐 JWT TEMPORÁRIO PARA SUPABASE
====================================================== */
function generateJWT() {
  const payload = {
    role: "service_role",
    iss: "catalogo-proxy",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 5,
  };
  return jwt.sign(payload, CONFIG.SUPABASE_KEY, { algorithm: "HS256" });
}

/* ======================================================
   💾 CACHE DE DOMÍNIOS (com TTL)
====================================================== */
const domainCache = new Map();
function setCache(host, data) {
  domainCache.set(host, { data, expires: Date.now() + CONFIG.CACHE_TTL });
}
function getCache(host) {
  const cached = domainCache.get(host);
  if (!cached) return null;
  if (Date.now() > cached.expires) {
    domainCache.delete(host);
    return null;
  }
  return cached.data;
}

/* ======================================================
   🛰️ FUNÇÃO: BUSCA DOMÍNIO NO SUPABASE
====================================================== */
async function getDomainData(host) {
  if (!host) return null;

  const cached = getCache(host);
  if (cached) return cached;

  const token = generateJWT();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

  try {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=slug,status`,
      {
        headers: {
          apikey: CONFIG.SUPABASE_KEY,
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`❌ [Supabase ${res.status}] ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    const row = data?.[0];
    if (row && ["active", "verified"].includes(row.status)) {
      setCache(host, row);
      return row;
    }
  } catch (err) {
    console.error(`⚠️ Falha Supabase: ${err.name} | ${err.message}`);
  }

  return null;
}

/* ======================================================
   🌍 LIBERA CORS GLOBAL
====================================================== */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, DELETE"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  next();
});

/* ======================================================
   🚦 ROTAS ESTÁTICAS /assets
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
  const originalHost = req.headers.host?.trim().toLowerCase() || "";
  const cleanHost = originalHost.replace(/^www\./, "");
  const path = req.path;

  console.log(`🌐 ${cleanHost} → ${path}`);

  // Status
  if (!cleanHost || cleanHost.includes("railway.app")) {
    return res.status(200).send("✅ Proxy ativo e aguardando conexões Cloudflare");
  }

  const domainData = await getDomainData(cleanHost);

  if (!domainData) {
    console.warn(`⚠️ Domínio não configurado: ${cleanHost}`);
    return res.status(404).send(`
      <html><body style="font-family:sans-serif;text-align:center;margin-top:40px">
      <h2>⚠️ Domínio não configurado</h2>
      <p>${cleanHost} ainda não foi ativado no Catálogo Virtual.</p>
      </body></html>
    `);
  }

  // ✅ Para arquivos estáticos, usar o ORIGIN direto (com CORS)
  if (isStatic(path)) {
    const target = `${CONFIG.ORIGIN}${path}`;
    console.log(`📦 Asset → ${target}`);
    return createProxyMiddleware({
      target,
      changeOrigin: true,
      secure: true,
      followRedirects: true,
      xfwd: true,
    })(req, res, next);
  }

  // ✅ Para páginas, injetar slug no HTML
  const target = `${CONFIG.ORIGIN}/s/${domainData.slug}`;
  console.log(`➡️ Proxy: ${cleanHost}${path} → ${target}`);

  return createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    followRedirects: true,
    xfwd: true,
    selfHandleResponse: true,
    onProxyRes: async (proxyRes, req, res) => {
      let body = "";
      proxyRes.on("data", (chunk) => (body += chunk));
      proxyRes.on("end", () => {
        res.status(proxyRes.statusCode);
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (key.toLowerCase() !== "content-length") res.setHeader(key, value);
        }

        // 🧩 Se for HTML, injeta o STORE_SLUG
        if (
          proxyRes.headers["content-type"]?.includes("text/html") &&
          body.includes("<div id=\"root\"></div>")
        ) {
          body = body.replace(
            "</head>",
            `<script>window.STORE_SLUG="${domainData.slug}";</script>\n</head>`
          );
        }

        res.send(body);
      });
    },
    onError(err, req, res) {
      console.error(`❌ ProxyError [${cleanHost}]`, err.message);
      res.status(502).send(`
        <html><body style="font-family:sans-serif;text-align:center;margin-top:40px">
        <h2>❌ Erro temporário</h2>
        <p>Não foi possível carregar a loja de <b>${cleanHost}</b>.</p>
        <p>${err.message}</p>
        </body></html>
      `);
    },
  })(req, res, next);
});

/* ======================================================
   🚀 INICIALIZA SERVIDOR
====================================================== */
app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`);
});
