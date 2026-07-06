/* ══════════════════════════════════════════════════════════════════
   ACS SYSTEM — server.js v5
   + Rota de primeiro acesso / troca obrigatória de senha
   + Admin: criar usuário manual com envio de email
   + Admin: deletar usuário
   + Admin: reenviar email de boas-vindas
   ══════════════════════════════════════════════════════════════════ */

require("dotenv").config();
const express = require("express");
const path    = require("path");
const db      = require("./db");
const auth    = require("./auth");
const eduzz   = require("./eduzz");

const app  = express();
const PORT = process.env.PORT || 3000;
const API_KEY   = process.env.ANTHROPIC_API_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!API_KEY) { console.error("❌ ANTHROPIC_API_KEY não encontrada"); process.exit(1); }

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(500).json({ error: "admin_not_configured" });
  const key = req.headers["x-admin-key"] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
}

function sanitizeUser(u) {
  if (!u) return u;
  const { password_hash, ...safe } = u;
  return safe;
}

// Demo user em modo local
if (process.env.NODE_ENV !== "production" && db.users.all().length === 0) {
  db.users.create({ email: "teste@local.com", password_hash: auth.hashPassword("teste123"), name: "Teste Local", plan: "Demo" });
  console.log("\n👤 Demo: teste@local.com / teste123\n");
}

app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); } }));

// ══════════════════════════════════════════════
// PREÇOS — CoinGecko
// ══════════════════════════════════════════════
let priceCache = { data: null, fetchedAt: 0 };
const CG_IDS   = "bitcoin,ethereum,binancecoin,solana,ripple,cardano,avalanche-2,chainlink,dogecoin,arbitrum,optimism,injective-protocol,toncoin,sui,pepe,worldcoin-wld,near,fantom,aptos";
const PAIR_MAP  = { bitcoin:"BTC/USDT",ethereum:"ETH/USDT",binancecoin:"BNB/USDT",solana:"SOL/USDT",ripple:"XRP/USDT",cardano:"ADA/USDT","avalanche-2":"AVAX/USDT",chainlink:"LINK/USDT",dogecoin:"DOGE/USDT",arbitrum:"ARB/USDT",optimism:"OP/USDT","injective-protocol":"INJ/USDT",toncoin:"TON/USDT",sui:"SUI/USDT",pepe:"PEPE/USDT","worldcoin-wld":"WLD/USDT",near:"NEAR/USDT",fantom:"FTM/USDT",aptos:"APT/USDT" };

async function fetchPrices() {
  if (priceCache.data && Date.now()-priceCache.fetchedAt < 30_000) return priceCache.data;
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${CG_IDS}&vs_currencies=usd&include_24hr_change=true`, { headers:{"Accept":"application/json"}, signal:AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`CG ${r.status}`);
    const raw = await r.json();
    const prices = {};
    for (const [id, pair] of Object.entries(PAIR_MAP)) {
      if (raw[id]) prices[pair] = { price: raw[id].usd, change24h: raw[id].usd_24h_change?.toFixed(2)??"0" };
    }
    priceCache = { data: prices, fetchedAt: Date.now() };
    return prices;
  } catch(e) { console.error("CoinGecko:", e.message); return priceCache.data||null; }
}

async function checkSignalTargets() {
  const active = db.signals.active();
  if (!active.length) return;
  const prices = await fetchPrices();
  if (!prices) return;
  for (const sig of active) { const p = prices[sig.pair]; if (p) db.signals.checkTargets(sig.id, p.price); }
}
setInterval(checkSignalTargets, 30_000);

// ══════════════════════════════════════════════
// ROTAS PÚBLICAS
// ══════════════════════════════════════════════
app.get("/api/prices",  auth.requireAuth, async (req, res) => {
  const prices = await fetchPrices();
  if (!prices) return res.status(503).json({ error:"prices_unavailable" });
  res.json({ prices, fetchedAt: new Date(priceCache.fetchedAt).toISOString() });
});

app.get("/api/signals", auth.requireAuth, (req, res) => res.json({ signals: db.signals.all() }));

app.post("/webhook/eduzz", eduzz.webhookHandler);

// ══════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error:"missing_fields" });
  const user = db.users.findByEmail(email.toLowerCase().trim());
  if (!user || !auth.verifyPassword(password, user.password_hash))
    return res.status(401).json({ error:"invalid_credentials", message:"Email ou senha incorretos." });
  if (user.status === "inactive")
    return res.status(403).json({ error:"subscription_inactive", message:"Assinatura não está ativa. Entre em contato com o suporte." });
  if (user.status === "pending")
    return res.status(403).json({ error:"subscription_pending", message:"Seu pagamento está sendo processado. Aguarde alguns minutos." });
  if (user.expires_at && new Date(user.expires_at) < new Date()) {
    db.users.update(user.id, { status:"inactive" });
    return res.status(403).json({ error:"subscription_expired", message:"Sua assinatura expirou." });
  }
  const session = auth.createSession(user.id);
  auth.setSessionCookie(res, session.id);
  // Informa se precisa trocar senha
  res.json({ ok:true, user:{ email:user.email, name:user.name, plan:user.plan }, mustChangePassword: !!user.must_change_password });
});

app.post("/api/auth/logout", (req, res) => {
  const cookies = auth.parseCookies(req);
  if (cookies[auth.COOKIE_NAME]) auth.destroySession(cookies[auth.COOKIE_NAME]);
  auth.clearSessionCookie(res);
  res.json({ ok:true });
});

app.get("/api/auth/me", (req, res) => {
  const cookies = auth.parseCookies(req);
  const user = auth.getSession(cookies[auth.COOKIE_NAME]);
  if (!user || user.status !== "active") return res.status(401).json({ error:"not_authenticated" });
  res.json({ email:user.email, name:user.name, plan:user.plan, expires_at:user.expires_at, mustChangePassword: !!user.must_change_password });
});

// Trocar senha (autenticado — primeiro acesso ou voluntário)
app.post("/api/auth/change-password", auth.requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8)
    return res.status(400).json({ error:"weak_password", message:"A senha deve ter pelo menos 8 caracteres." });
  // Se não é primeiro acesso, verifica senha atual
  if (!req.user.must_change_password && currentPassword) {
    if (!auth.verifyPassword(currentPassword, req.user.password_hash))
      return res.status(401).json({ error:"wrong_password", message:"Senha atual incorreta." });
  }
  db.users.update(req.user.id, { password_hash: auth.hashPassword(newPassword), must_change_password: false });
  res.json({ ok:true });
});

// ══════════════════════════════════════════════
// ADMIN — Usuários
// ══════════════════════════════════════════════
app.get("/api/admin/users", requireAdmin, (req, res) => {
  const { status, search } = req.query;
  let list = db.users.all();
  if (status && status !== "all") list = list.filter(u => u.status === status);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(u => u.email.toLowerCase().includes(q) || (u.name||"").toLowerCase().includes(q));
  }
  res.json({ users: list.map(sanitizeUser), stats: db.users.stats() });
});

// Criar usuário manualmente (admin) + enviar email
app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const { email, password, name, plan, sendEmail, status } = req.body || {};
  if (!email) return res.status(400).json({ error:"missing_fields", message:"Email é obrigatório." });
  const norm = email.toLowerCase().trim();
  if (db.users.findByEmail(norm)) return res.status(409).json({ error:"already_exists", message:"Email já cadastrado." });

  let tempPassword = password;
  let mustChange   = false;

  if (!tempPassword) {
    // Gera senha temporária automática
    tempPassword = eduzz.generateTempPassword();
    mustChange   = true;
  }

  const user = db.users.create({
    email:                norm,
    password_hash:        auth.hashPassword(tempPassword),
    name, plan,
    status:               status || "active",
    must_change_password: mustChange,
  });

  // Envia email de boas-vindas se solicitado
  if (sendEmail !== false) {
    await eduzz.sendWelcomeEmail({ email: norm, name, tempPassword });
  }

  res.json({ ok:true, user:sanitizeUser(user), tempPassword: mustChange ? tempPassword : undefined });
});

app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status, plan, name, expires_at, newPassword } = req.body || {};
  const patch = {};
  if (status     !== undefined) patch.status     = status;
  if (plan       !== undefined) patch.plan       = plan;
  if (name       !== undefined) patch.name       = name;
  if (expires_at !== undefined) patch.expires_at = expires_at;
  if (newPassword) patch.password_hash = auth.hashPassword(newPassword);
  const user = db.users.update(id, patch);
  if (!user) return res.status(404).json({ error:"not_found" });
  res.json({ ok:true, user:sanitizeUser(user) });
});

// Deletar usuário
app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const ok = db.users.delete(id);
  if (!ok) return res.status(404).json({ error:"not_found" });
  res.json({ ok:true });
});

// Reenviar email de boas-vindas
app.post("/api/admin/users/:id/resend-email", requireAdmin, async (req, res) => {
  const id   = Number(req.params.id);
  const user = db.users.findById(id);
  if (!user) return res.status(404).json({ error:"not_found" });
  const tempPassword = eduzz.generateTempPassword();
  db.users.update(id, { password_hash: auth.hashPassword(tempPassword), must_change_password: true });
  await eduzz.sendWelcomeEmail({ email:user.email, name:user.name, tempPassword });
  res.json({ ok:true, message:`Email reenviado para ${user.email}` });
});

app.get("/api/admin/webhook-log", requireAdmin, (req, res) => res.json({ logs: db.webhookLog.recent(50) }));

// ══════════════════════════════════════════════
// ADMIN — Sinais
// ══════════════════════════════════════════════
app.get("/api/admin/signals", requireAdmin, (req, res) => res.json({ signals: db.signals.all() }));

app.post("/api/admin/signals/check-targets", requireAdmin, async (req, res) => {
  await checkSignalTargets();
  res.json({ ok:true, checked: db.signals.active().length });
});

app.post("/api/admin/signals", requireAdmin, (req, res) => {
  const { pair, type, entry, leverage, stoploss, targets, reason, timeframe, setup, confidence, source } = req.body || {};
  if (!pair || !entry) return res.status(400).json({ error:"missing_fields", message:"Par e entrada são obrigatórios." });
  const sig = db.signals.create({ pair, type, entry, leverage, stoploss, targets, reason, timeframe, setup, confidence, source:"admin" });
  res.json({ ok:true, signal:sig });
});

app.patch("/api/admin/signals/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const allowed = ["pair","type","entry","leverage","stoploss","targets","reason","timeframe","setup","confidence","status","hit","profit_pct","time_to_hit"];
  const patch = {};
  for (const k of allowed) { if (req.body[k] !== undefined) patch[k] = req.body[k]; }
  const sig = db.signals.update(id, patch);
  if (!sig) return res.status(404).json({ error:"not_found" });
  res.json({ ok:true, signal:sig });
});

app.delete("/api/admin/signals/:id", requireAdmin, (req, res) => {
  const ok = db.signals.delete(Number(req.params.id));
  if (!ok) return res.status(404).json({ error:"not_found" });
  res.json({ ok:true });
});

// ══════════════════════════════════════════════
// PROXY CLAUDE
// ══════════════════════════════════════════════
app.post("/api/claude", async (req, res) => {
  const cookies  = auth.parseCookies(req);
  const userSess = auth.getSession(cookies[auth.COOKIE_NAME]);
  const isAdmin  = ADMIN_KEY && req.headers["x-admin-key"] === ADMIN_KEY;
  const isUser   = userSess && userSess.status === "active";
  if (!isAdmin && !isUser) return res.status(401).json({ error:"unauthorized" });
  try {
    const { system, messages, max_tokens } = req.body;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-api-key":API_KEY, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:max_tokens||2000, system, messages }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch(e) { res.status(500).json({ error:"internal_error", details:e.message }); }
});

// ══════════════════════════════════════════════
// PÁGINAS
// ══════════════════════════════════════════════
const ROOT = path.join(__dirname);
app.get("/admin.html", (req, res) => res.sendFile(path.join(ROOT, "admin.html")));
app.get(["/","/index.html"], auth.requirePageAuth, (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/app.js",           auth.requirePageAuth, (req, res) => res.sendFile(path.join(ROOT, "app.js")));
app.get("/style.css",        auth.requirePageAuth, (req, res) => res.sendFile(path.join(ROOT, "style.css")));
app.use(express.static(ROOT));

app.listen(PORT, () => {
  console.log(`\n🚀 ACS SYSTEM v5 rodando na porta ${PORT}`);
  console.log(`   Admin: /admin.html`);
  console.log(`   Login: /login.html\n`);
});

setInterval(() => db.sessions.cleanExpired(), 60*60*1000).unref();
