import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch";

const app = express();

/* ======================================================
   🔑 CONFIGURAÇÕES PRINCIPAIS
====================================================== */
const SUPABASE_URL = process.env.SUPABASE_URL || "https://hbpekfnexdtnbahmmufm.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "INSIRA_SUA_CHAVE_AQUI";
const ORIGIN = process.env.ORIGIN || "https://catalogovirtual.app.br";

/* ======================================================
   🧠 CACHE DE DOMÍNIOS
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

    if (!res.ok) {
      console.error("❌ Erro Supabase:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const row = data[0];
      if (row.status === "active" || row.status === "verified") {
        domainCache.set(host, row);
        return row;
      }
    }
  } catch (err) {
    console.error("❌ Falha ao consultar Supabase:", err.message);
  }

  return null;
}

/* ======================================================
   🧩 ROTAS ESTÁTICAS
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

  console.log("🌐 Requisição:", { host: cleanHost, path });

  // Evita que acessos diretos à Railway quebrem
  if (!cleanHost || cleanHost.includes("railway.app")) {
    return res.status(200).send("✅ Proxy ativo e aguardando conexões Cloudflare");
  }

  // Busca domínio no Supabase
  const domainData = await getDomainData(cleanHost);

  if (!domainData) {
    console.warn(`⚠️ Domínio não configurado: ${cleanHost}`);
    return res
      .status(404)
      .send(`<h1>Domínio não configurado: ${cleanHost}</h1>`);
  }

  // Monta destino
  const { slug } = domainData;
  const isStaticFile = isStatic(path);
  const target = isStaticFile ? ORIGIN : `${ORIGIN}/s/${slug}`;

  console.log(`➡️ Proxy: ${cleanHost}${path} → ${target}`);

  // Cria proxy dinâmico
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    followRedirects: true,
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
const PORT = process.env.PORT || 3000; // Railway usa 8080
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Proxy reverso ativo na porta ${PORT}`);
});
