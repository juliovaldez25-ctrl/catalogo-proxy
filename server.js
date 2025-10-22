import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();

app.use((req, res, next) => {
  const host = req.headers.host?.replace("www.", "");
  console.log("🌍 Incoming request from:", host);

  const target = "https://catalogovirtual.app.br";

  createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
  })(req, res, next);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Proxy rodando na porta ${PORT}`));
