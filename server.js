import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";
import zlib from "zlib";

const app = express();

/* ======================================================
   ⚙️ CONFIGURAÇÕES
====================================================== */
const CONFIG = {
  SUPABASE_URL: "https://hbpekfnexdtnbahmmufm.supabase.co",
  SUPABASE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhicGVrZm5leGR0bmJhaG1tdWZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODk4NTUxNywiZXhwIjoyMDc0NTYxNTE3fQ.cMiKA-_TqdgCNcuMzbu3qTRjiTPHZWH-dwVeEQ8lTtA",
  EDGE_FUNCTION: "https://hbpekfnexdtnbahmmufm.supabase.co/functions/v1/get-domain",
  ORIGIN: "https://catalogovirtual.app.br",
  CACHE_TTL: 1000 * 60 * 10,
  TIMEOUT: 7000,
  PORT: process.env.PORT || 8080,
};

/* ======================================================
   🌐 LIBERA CORS
====================================================== */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
  const c = cache.get(host);
  if (!c) return null;
  if (Date.now() > c.expires) {
    cache.delete(host);
    return null;
  }
  return c.data;
}

/* ======================================================
   🛰️ BUSCA DOMÍNIO NO SUPABASE
====================================================== */
async function getDomainData(host) {
  const cached = getCache(host);
  if (cached) return cached;

  try {
    const edge = await fetch(`${CONFIG.EDGE_FUNCTION}?domain=${host}`, {
      headers: { Authorization: `Bearer ${CONFIG.SUPABASE_KEY}` },
    });
    if (edge.ok) {
      const data = await edge.json();
      if (data?.slug) {
        setCache(host, data);
        return data;
      }
    }

    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}&select=slug,status`,
      {
        headers: {
          apikey: CONFIG.SUPABASE_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
        },
      }
    );

    const data = await res.json();
    const row = data?.[0];
    if (row && ["active", "verified"].includes(row.status)) {
      setCache(host, row);
      return row;
    }
  } catch (err) {
    console.error("⚠️ Supabase Error:", err.message);
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
  /^\/~api\//,
];
const isStatic = (p) => STATIC_PATHS.some((rx) => rx.test(p));

/* ======================================================
   🧭 MIDDLEWARE PRINCIPAL
====================================================== */
app.use(async (req, res, next) => {
  const host = req.headers.host?.toLowerCase().replace(/^www\./, "");
  const path = req.path;

  if (!host || host.includes("railway.app")) {
    return res.send("✅ Proxy ativo e aguardando conexões Cloudflare");
  }

  const domain = await getDomainData(host);
  if (!domain) {
    return res.status(404).send(`<h3>⚠️ Domínio não configurado: ${host}</h3>`);
  }

  const target = CONFIG.ORIGIN;
  let rewrittenPath = path;
  if (!isStatic(path) && !path.startsWith("/s/")) {
    rewrittenPath = `/s/${domain.slug}${path}`;
  }

  console.log(`➡️ Proxy: ${host}${path} → ${target}${rewrittenPath}`);

  const proxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    xfwd: true,
    selfHandleResponse: true,
    pathRewrite: () => rewrittenPath,

    async onProxyRes(proxyRes, req, res) {
      let body = Buffer.from([]);

      proxyRes.on("data", (chunk) => (body = Buffer.concat([body, chunk])));
      proxyRes.on("end", async () => {
        let buffer = body;
        const contentType = proxyRes.headers["content-type"] || "";
        const enc = proxyRes.headers["content-encoding"];

        try {
          if (enc === "gzip") buffer = zlib.gunzipSync(buffer);
          else if (enc === "br") buffer = zlib.brotliDecompressSync(buffer);
        } catch {}

        // 🔄 Se não for HTML (JS, CSS etc.)
        if (!contentType.includes("text/html")) {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          return res.end(buffer);
        }

        let html = buffer.toString("utf8");

        // ⚠️ Caso o backend devolva 404 → busca index.html real
        if (proxyRes.statusCode === 404 || !html.includes("<div id=\"root\"")) {
          try {
            const fallback = await fetch(`${CONFIG.ORIGIN}/s/${domain.slug}/index.html`);
            html = await fallback.text();
            console.log("🔁 Fallback index.html carregado");
          } catch {
            console.log("❌ Falha no fallback index.html");
          }
        }

        // 💉 Injeta o slug no HTML
        html = html.replace(
          "</head>",
          `<script>window.STORE_SLUG="${domain.slug}";</script>\n</head>`
        );

        res.writeHead(200, {
          ...proxyRes.headers,
          "Access-Control-Allow-Origin": "*",
          "Content-Encoding": "identity",
        });
        res.end(html);
      });
    },
  });

  proxy(req, res, next);
});

/* ======================================================
   🚀 INICIALIZA
====================================================== */
app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🚀 Proxy reverso ativo na porta ${CONFIG.PORT}`);
});
