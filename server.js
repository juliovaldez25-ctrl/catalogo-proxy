import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fetch from "node-fetch"; // Render já tem suporte nativo

const app = express();

// URL da sua API Supabase
const SUPABASE_URL = "https://hbpekfnexdtnbahmmufm.supabase.co";
const SUPABASE_KEY = "chave_anon_public"; // substitua pela sua chave pública anônima

app.use(async (req, res, next) => {
  const host = req.headers.host?.replace("www.", "").trim();
  console.log("🌍 Novo acesso:", host);

  try {
    // busca o slug do domínio
    const response = await fetch(`${SUPABASE_URL}/rest/v1/custom_domains?domain=eq.${host}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    const data = await response.json();

    // se achar domínio válido
    if (data?.length > 0) {
      const slug = data[0].slug;
      const target = `https://catalogovirtual.app.br/${slug}`;
      console.log(`➡️ Redirecionando ${host} -> ${target}`);

      return createProxyMiddleware({
        target,
        changeOrigin: true,
        secure: true,
      })(req, res, next);
    }

    // fallback padrão
    console.log(`⚠️ Domínio não encontrado: ${host}`);
    res.status(404).send(`<h1>Domínio não configurado</h1>`);
  } catch (err) {
    console.error("❌ Erro ao buscar domínio:", err);
    res.status(500).send("Erro interno no proxy");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy ativo na porta ${PORT}`));
