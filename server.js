/* ══════════════════════════════════════════════
   server.js — ALFA CRIPTO SINAIS (produção)
   Auth por email/senha · Webhook Eduzz · Proxy seguro Claude
   ══════════════════════════════════════════════ */

require("dotenv").config();
const express = require("express");
const path = require("path");
const db = require("./db");
const auth = require("./auth");
const eduzz = require("./eduzz");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error("\n❌ ANTHROPIC_API_KEY não encontrada no .env\n");
  process.exit(1);
}

const ADMIN_KEY = process.env.ADMIN_KEY; // chave separada, só pra você, pro painel admin

// ── Middleware simples para proteger o painel admin ───────────────────────────
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: "admin_not_configured", message: "Defina ADMIN_KEY no .env para usar o painel admin." });
  }
  const key = req.headers["x-admin-key"] || req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// ── Modo de teste local: cria um assinante de demonstração automaticamente ───
// Só acontece se NODE_ENV não for "production" E ainda não existir nenhum
// usuário no banco. Isso nunca roda em produção de verdade (Railway define
// NODE_ENV=production), e existe só para facilitar o primeiro teste local
// sem precisar rodar nenhum comando manual.
const DEMO_EMAIL = "teste@local.com";
const DEMO_PASSWORD = "teste123";
if (process.env.NODE_ENV !== "production" && db.users.all().length === 0) {
  const hash = auth.hashPassword(DEMO_PASSWORD);
  db.users.create({ email: DEMO_EMAIL, password_hash: hash, name: "Conta de Teste", plan: "Demo Local" });
  console.log(`\n👤 Conta de teste criada automaticamente:`);
  console.log(`   Email: ${DEMO_EMAIL}`);
  console.log(`   Senha: ${DEMO_PASSWORD}\n`);
}


// Nunca devolver o hash da senha em respostas JSON, nem pro painel admin.
function sanitizeUser(user) {
  if (!user) return user;
  const { password_hash, ...safe } = user;
  return safe;
}


// ── Body parsing ──────────────────────────────────────────────────────────────
// Para o webhook da Eduzz, guardamos o corpo "crú" também, pois a validação
// de assinatura HMAC precisa do texto exato recebido (antes de virar JSON).
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); },
}));

// ══════════════════════════════════════════════
// ROTA: Webhook da Eduzz (pública, mas validada por assinatura)
// ══════════════════════════════════════════════
app.post("/webhook/eduzz", eduzz.webhookHandler);

// ══════════════════════════════════════════════
// ROTAS DE AUTENTICAÇÃO
// ══════════════════════════════════════════════

// Login
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "missing_fields", message: "Informe email e senha." });
  }

  const user = db.users.findByEmail(email.toLowerCase().trim());
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "invalid_credentials", message: "Email ou senha incorretos." });
  }

  if (user.status !== "active") {
    return res.status(403).json({ error: "subscription_inactive", message: "Sua assinatura não está ativa. Verifique seu pagamento na Eduzz ou contate o suporte." });
  }

  if (user.expires_at && new Date(user.expires_at) < new Date()) {
    db.users.update(user.id, { status: "inactive" });
    return res.status(403).json({ error: "subscription_expired", message: "Sua assinatura expirou." });
  }

  const session = auth.createSession(user.id);
  auth.setSessionCookie(res, session.id);
  res.json({ ok: true, user: { email: user.email, name: user.name, plan: user.plan } });
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  const cookies = auth.parseCookies(req);
  if (cookies[auth.COOKIE_NAME]) auth.destroySession(cookies[auth.COOKIE_NAME]);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

// Quem sou eu (usado pelo front pra saber se está logado)
app.get("/api/auth/me", (req, res) => {
  const cookies = auth.parseCookies(req);
  const user = auth.getSession(cookies[auth.COOKIE_NAME]);
  if (!user || user.status !== "active") {
    return res.status(401).json({ error: "not_authenticated" });
  }
  res.json({ email: user.email, name: user.name, plan: user.plan, expires_at: user.expires_at });
});

// Trocar senha (depois do primeiro login com senha temporária)
app.post("/api/auth/change-password", auth.requireAuth, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "weak_password", message: "A senha precisa ter ao menos 6 caracteres." });
  }
  const hash = auth.hashPassword(newPassword);
  db.users.update(req.user.id, { password_hash: hash });
  res.json({ ok: true });
});

// ══════════════════════════════════════════════
// PAINEL ADMIN — gerenciar assinantes pelo navegador
// Protegido por uma chave separada (ADMIN_KEY no .env), não pela sessão
// de assinante. Acesse: /admin.html?key=SUA_ADMIN_KEY
// ══════════════════════════════════════════════
app.get("/api/admin/users", requireAdmin, (req, res) => {
  res.json({ users: db.users.all().map(sanitizeUser) });
});

app.post("/api/admin/users", requireAdmin, (req, res) => {
  const { email, password, name, plan } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "missing_fields", message: "Email e senha são obrigatórios." });
  }
  const normalizedEmail = email.toLowerCase().trim();
  if (db.users.findByEmail(normalizedEmail)) {
    return res.status(409).json({ error: "already_exists", message: "Já existe um assinante com este email." });
  }
  const hash = auth.hashPassword(password);
  const user = db.users.create({ email: normalizedEmail, password_hash: hash, name, plan });
  res.json({ ok: true, user: sanitizeUser(user) });
});

app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status, plan, name, expires_at, newPassword } = req.body || {};
  const patch = {};
  if (status !== undefined) patch.status = status;
  if (plan !== undefined) patch.plan = plan;
  if (name !== undefined) patch.name = name;
  if (expires_at !== undefined) patch.expires_at = expires_at;
  if (newPassword) patch.password_hash = auth.hashPassword(newPassword);

  const user = db.users.update(id, patch);
  if (!user) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true, user: sanitizeUser(user) });
});

app.get("/api/admin/webhook-log", requireAdmin, (req, res) => {
  res.json({ logs: db.webhookLog.recent(50) });
});

// ══════════════════════════════════════════════
// ROTA: Proxy seguro para a API da Anthropic (Claude)
// Protegida — só assinantes ativos e logados podem chamar a IA.
// ══════════════════════════════════════════════
app.post("/api/claude", auth.requireAuth, async (req, res) => {
  try {
    const { system, messages, max_tokens } = req.body;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: max_tokens || 2000,
        system,
        messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Erro da API Anthropic:", data);
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error("Erro no proxy Claude:", err);
    res.status(500).json({ error: "internal_error", details: err.message });
  }
});

// ══════════════════════════════════════════════
// PAINEL ADMIN — página HTML (fora da pasta public, nunca servida publicamente)
// Acesse em: https://seudominio.com/admin.html?key=SUA_ADMIN_KEY
// A própria página pede a chave de novo se você não passar na URL.
// ══════════════════════════════════════════════
app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin-pages", "admin.html"));
});

// ══════════════════════════════════════════════
// ARQUIVOS ESTÁTICOS — login.html é sempre público;
// index.html, app.js e style.css exigem sessão ativa (assinante logado).
// ══════════════════════════════════════════════
const PUBLIC_DIR = path.join(__dirname, "public");

// Página principal e seus assets — protegidos
app.get("/", auth.requirePageAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});
app.get("/index.html", auth.requirePageAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});
app.get("/app.js", auth.requirePageAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "app.js"));
});
app.get("/style.css", auth.requirePageAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "style.css"));
});

// Tudo o resto (login.html, login.css, login.js, imagens, fontes) é público
app.use(express.static(PUBLIC_DIR));

// ══════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n🚀 ALFA CRIPTO SINAIS rodando na porta ${PORT}`);
  console.log(`   Webhook Eduzz:  /webhook/eduzz`);
  console.log(`   Login:          /login.html\n`);
});

// Limpa sessões expiradas a cada 1h. .unref() garante que esse timer nunca
// impede o processo de terminar (relevante sobretudo para scripts/CLI que
// importam db.js sem rodar um servidor — aqui no server.js seria seguro de
// qualquer forma, mas a prática é a mesma em ambos os lugares).
setInterval(() => db.sessions.cleanExpired(), 60 * 60 * 1000).unref();
