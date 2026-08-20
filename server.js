/* ══════════════════════════════════════════════
   server.js — ALFA CRIPTO SINAIS v2.2
   + Preços reais via CoinGecko
   + Signals persistidos no banco (CRUD admin)
   + Targets ativam automaticamente com preço real
   + Auth por email/senha · Webhook Eduzz
   ── v2.1 ──
   + Comunidade autocontida (posts com aprovação)
   + Limite de body 4mb · Rota Earn com sessão persistida
   + Bloqueio de arquivos sensíveis no static
   ── v2.2 ──
   + Feed da Comunidade leve: imagens por URL com cache
     (/api/community/img/:id) — JSON do feed sem base64
   + 2FA TOTP nativo (Authy/Google/Microsoft Authenticator):
     login em 2 etapas quando ativo, ativação via QR,
     reset pelo admin por URL
   ══════════════════════════════════════════════ */

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

// ══════════════════════════════════════════════════════════════════
// SESSÕES PERSISTIDAS — substitui Map em memória do auth.js
// Garante que sessões sobrevivem a redeploys do Railway
// ══════════════════════════════════════════════════════════════════
const crypto  = require("crypto");
const SESSION_COOKIE = "acs_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function createSessionPersisted(userId) {
  const id      = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.sessions.create(id, userId, expires);
  return { id, expires };
}

function getSessionPersisted(sessionId) {
  if (!sessionId) return null;
  const session = db.sessions.find(sessionId);
  if (!session) return null;
  return db.users.findById(session.user_id) || null;
}

function destroySessionPersisted(sessionId) {
  if (sessionId) db.sessions.destroy(sessionId);
}

function setSessionCookiePersisted(res, sessionId) {
  res.setHeader("Set-Cookie",
    `${SESSION_COOKIE}=${sessionId}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS/1000}; SameSite=Lax`
  );
}

function clearSessionCookiePersisted(res) {
  res.setHeader("Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
  );
}

function parseCookiesPersisted(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(raw.split(";").map(c => {
    const [k, ...v] = c.trim().split("=");
    return [k?.trim(), v.join("=")?.trim()];
  }).filter(([k]) => k));
}

function requireAuthPersisted(req, res, next) {
  const cookies = parseCookiesPersisted(req);
  const user    = getSessionPersisted(cookies[SESSION_COOKIE]);
  if (!user || user.status !== "active")
    return res.status(401).json({ error:"not_authenticated", message:"Faça login para continuar." });
  res.locals.user = user;
  req.user        = user;
  next();
}

function requirePageAuthPersisted(req, res, next) {
  const cookies = parseCookiesPersisted(req);
  const user    = getSessionPersisted(cookies[SESSION_COOKIE]);
  if (!user || user.status !== "active")
    return res.redirect("/login.html");
  res.locals.user = user;
  req.user        = user;
  next();
}

// ══════════════════════════════════════════════
// SEGURANÇA — 2FA TOTP nativo (RFC 6238)
// Compatível com Authy, Google e Microsoft Authenticator
// ══════════════════════════════════════════════
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function b32encode(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

function b32decode(str) {
  str = String(str || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0; const out = [];
  for (const c of str) {
    val = (val << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(secretBuf, counter) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secretBuf).update(b).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6;
  return String(code).padStart(6, "0");
}

function totpVerify(secretB32, code, win = 1) {
  code = String(code || "").replace(/\D/g, "");
  if (!secretB32 || code.length !== 6) return false;
  const sec = b32decode(secretB32);
  const t = Math.floor(Date.now() / 30000);
  for (let i = -win; i <= win; i++) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(sec, t + i)), Buffer.from(code))) return true;
  }
  return false;
}


// ══════════════════════════════════════════════
// ONESIGNAL — Push Notifications
// ══════════════════════════════════════════════
const ONESIGNAL_APP_ID  = process.env.ONESIGNAL_APP_ID  || "";
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY || "";

async function sendPushNotification({ title, message, url = "/" }) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
    console.warn("⚠️  OneSignal não configurado — notificação ignorada");
    return;
  }
  try {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Key ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify({
        app_id:             ONESIGNAL_APP_ID,
        included_segments:  ["All"],          // envia para todos os assinantes
        headings:           { pt: title,   en: title   },
        contents:           { pt: message, en: message },
        url:                process.env.APP_URL ? process.env.APP_URL + url : url,
        chrome_web_icon:    process.env.APP_URL ? process.env.APP_URL + "/icon-192.png" : "",
        priority:           10,               // alta prioridade
      }),
    });
    const data = await res.json();
    if (data.errors) console.error("OneSignal erro:", data.errors);
    else console.log(`📲 Push enviado: "${title}" → ${data.recipients || 0} dispositivos`);
    return data;
  } catch (err) {
    console.error("OneSignal fetch erro:", err.message);
  }
}


if (!API_KEY) {
  console.warn("\n⚠️  ANTHROPIC_API_KEY não encontrada — chat IA desativado\n");
}

// ── Admin middleware ───────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(500).json({ error:"admin_not_configured" });
  const key = req.headers["x-admin-key"] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ error:"unauthorized" });
  next();
}

// ── Demo user em modo local ────────────────────────────────────────────────────
const DEMO_EMAIL    = "teste@local.com";
const DEMO_PASSWORD = "teste123";
if (process.env.NODE_ENV !== "production" && db.users.all().length === 0) {
  const hash = auth.hashPassword(DEMO_PASSWORD);
  db.users.create({ email: DEMO_EMAIL, password_hash: hash, name: "Conta de Teste", plan: "Demo Local" });
  console.log(`\n👤 Conta de teste criada automaticamente:`);
  console.log(`   Email: ${DEMO_EMAIL}`);
  console.log(`   Senha: ${DEMO_PASSWORD}\n`);
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, totp_secret, totp_pending_secret, ...rest } = user;
  return { ...rest, totp_enabled: !!user.totp_enabled, trial: db.users.getTrialInfo(user) };
}

// ── Body parsing ───────────────────────────────────────────────────────────────
// v2.1: limite 4mb para aceitar imagens da Comunidade (padrão era 100kb)
app.use(express.json({
  limit: "4mb",
  verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); },
}));

// ══════════════════════════════════════════════
// PREÇOS EM TEMPO REAL — CoinGecko (grátis, sem API key)
// Cache de 30s para não bater limite de rate
// ══════════════════════════════════════════════
let priceCache = { data: null, fetchedAt: 0 };

const COINGECKO_IDS = [
  "bitcoin", "ethereum", "binancecoin", "solana",
  "ripple", "cardano", "avalanche-2", "chainlink",
  "dogecoin", "arbitrum", "optimism", "injective-protocol",
  "toncoin", "sui", "pepe", "worldcoin-wld", "near",
  "fantom", "aptos"
].join(",");

async function fetchPrices() {
  const now = Date.now();
  // Cache de 30 segundos
  if (priceCache.data && now - priceCache.fetchedAt < 30_000) {
    return priceCache.data;
  }

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${COINGECKO_IDS}&vs_currencies=usd&include_24hr_change=true`;
    const resp = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "alfa-cripto-sinais/2.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) throw new Error(`CoinGecko HTTP ${resp.status}`);
    const raw = await resp.json();

    // Normaliza para { "BTC/USDT": { price, change24h }, ... }
    const MAP = {
      "bitcoin":              "BTC/USDT",
      "ethereum":             "ETH/USDT",
      "binancecoin":          "BNB/USDT",
      "solana":               "SOL/USDT",
      "ripple":               "XRP/USDT",
      "cardano":              "ADA/USDT",
      "avalanche-2":          "AVAX/USDT",
      "chainlink":            "LINK/USDT",
      "dogecoin":             "DOGE/USDT",
      "arbitrum":             "ARB/USDT",
      "optimism":             "OP/USDT",
      "injective-protocol":   "INJ/USDT",
      "toncoin":              "TON/USDT",
      "sui":                  "SUI/USDT",
      "pepe":                 "PEPE/USDT",
      "worldcoin-wld":        "WLD/USDT",
      "near":                 "NEAR/USDT",
      "fantom":               "FTM/USDT",
      "aptos":                "APT/USDT",
    };

    const prices = {};
    for (const [id, pair] of Object.entries(MAP)) {
      if (raw[id]) {
        prices[pair] = {
          price:     raw[id].usd,
          change24h: raw[id].usd_24h_change?.toFixed(2) ?? "0",
        };
      }
    }

    priceCache = { data: prices, fetchedAt: Date.now() };
    return prices;
  } catch (err) {
    console.error("⚠️  CoinGecko erro:", err.message);
    // Retorna cache antigo se existir, ou null
    return priceCache.data || null;
  }
}

// ── Verifica targets automaticamente a cada 30s ────────────────────────────────
async function checkSignalTargets() {
  const active = db.signals.active();
  if (active.length === 0) return;
  const prices = await fetchPrices();
  if (!prices) return;

  for (const sig of active) {
    const priceObj = prices[sig.pair];
    if (!priceObj) continue;
    const hitBefore = sig.hit || 0;
    const updated   = db.signals.checkTargets(sig.id, priceObj.price);
    if (!updated) continue;

    // Novo alvo atingido
    if (updated.hit > hitBefore) {
      const alvoVal = (updated.targets || [])[updated.hit - 1] || "?";
      sendPushNotification({
        title:   `🎯 Alvo ${updated.hit} atingido — ${sig.pair}`,
        message: `Meta de ${alvoVal} alcançada! ${updated.hit}/${(updated.targets||[]).length} alvos concluídos.`,
        url:     "/",
      });
    }
    // Sinal fechou com lucro automático
    if (updated.status === "profit" && sig.status === "active") {
      sendPushNotification({
        title:   `✅ Lucro confirmado — ${sig.pair}`,
        message: `Resultado: ${updated.profit_pct || "—"} em ${updated.time_to_hit || "—"}. Parabéns! 🚀`,
        url:     "/",
      });
    }
  }
}

setInterval(checkSignalTargets, 30_000);

// ══════════════════════════════════════════════
// API PÚBLICA: Preços em tempo real
// ══════════════════════════════════════════════
app.get("/api/prices", requireAuthPersisted, async (req, res) => {
  const prices = await fetchPrices();
  if (!prices) return res.status(503).json({ error: "prices_unavailable", message: "CoinGecko indisponível. Tente em instantes." });
  res.json({ prices, fetchedAt: new Date(priceCache.fetchedAt).toISOString() });
});

// ══════════════════════════════════════════════
// API: Sinais (leitura — para usuários logados)
// ══════════════════════════════════════════════
app.get("/api/signals", requireAuthPersisted, (req, res) => {
  const user       = res.locals.user;
  const trial      = db.users.getTrialInfo(user);
  const allSignals = db.signals.all();

  // Sinais ativos — NUNCA limitados por trial (usuário precisa ver os sinais abertos)
  const activeSignals = allSignals.filter(s => s.status === "active");

  // Sinais fechados — limitados para trial expirado
  let closedSignals  = allSignals.filter(s => s.status !== "active");
  let limitApplied   = false;

  if (trial.isExpired && trial.signalLimit !== null) {
    // Trial expirado: limita apenas os sinais fechados visíveis
    // Os sinais ATIVOS sempre aparecem (são o coração do produto)
    closedSignals = closedSignals.slice(0, trial.signalLimit);
    limitApplied  = true;
  }

  const signals = [...activeSignals, ...closedSignals];

  res.json({
    signals,
    meta: {
      total:        allSignals.length,
      totalActive:  activeSignals.length,
      shown:        signals.length,
      limitApplied,
      trial,
    },
  });
});

// ══════════════════════════════════════════════════════════════════
// HISTÓRICO DE SINAIS — acessível por qualquer usuário autenticado
// ══════════════════════════════════════════════════════════════════
app.get("/api/signals/history", requireAuthPersisted, (req, res) => {
  const all = db.signals.all();

  const closed = all
    .filter(s => ["profit", "loss", "closed"].includes(s.status))
    .sort((a, b) => new Date(b.closed_at || b.updated_at || b.created_at)
                  - new Date(a.closed_at || a.updated_at || a.created_at));

  const now      = new Date();
  const thisMonth = closed.filter(s => {
    const d = new Date(s.closed_at || s.updated_at || s.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const profits   = thisMonth.filter(s => s.status === "profit");
  const losses    = thisMonth.filter(s => s.status === "loss");
  const pcts      = profits.map(s => parseFloat(s.result_pct || (s.profit_pct||"").replace(/[^0-9.-]/g,"")) || 0).filter(v => v > 0);
  const lucroMes  = pcts.length ? pcts.reduce((a,b) => a+b, 0) : 0;
  const winRate   = (profits.length + losses.length) > 0
    ? Math.round(profits.length / (profits.length + losses.length) * 100)
    : null;

  res.json({
    signals:   closed,
    thisMonth: thisMonth,
    metrics: {
      total:      closed.length,
      thisMonth:  thisMonth.length,
      wins:       profits.length,
      losses:     losses.length,
      winRate,
      lucroMes:   lucroMes.toFixed(1),
      maiorLucro: pcts.length ? Math.max(...pcts).toFixed(1) : null,
    },
  });
});



// ══════════════════════════════════════════════
// WEBHOOK Eduzz
// ══════════════════════════════════════════════
app.post("/webhook/eduzz", (req, res) => {
  try { if (global.__acsFinanceEduzz) global.__acsFinanceEduzz(req); } catch (_) {}
  return eduzz.webhookHandler(req, res);
});
// ══════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════
// ── ROTA DE DIAGNÓSTICO (protegida por admin key) ─────────────────────────────
app.get("/api/debug/signals", requireAdmin, (req, res) => {
  const all     = db.signals.all();
  const active  = all.filter(s => s.status === "active");
  const users   = db.users.all().map(u => ({ id:u.id, email:u.email, plan:u.plan, trial_ends_at:u.trial_ends_at }));
  res.json({
    signals:  { total: all.length, active: active.length, activeList: active.map(s=>({id:s.id,pair:s.pair,status:s.status,source:s.source})) },
    users:    { total: users.length, list: users },
    dbPath:   process.env.DB_PATH || "local",
    node:     process.version,
    uptime:   Math.floor(process.uptime()) + "s",
  });
});


app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error:"missing_fields", message:"Informe email e senha." });

  const user = db.users.findByEmail(email.toLowerCase().trim());
  if (!user || !auth.verifyPassword(password, user.password_hash))
    return res.status(401).json({ error:"invalid_credentials", message:"Email ou senha incorretos." });

  if (user.status !== "active")
    return res.status(403).json({ error:"subscription_inactive", message:"Assinatura não está ativa." });

  if (user.expires_at && new Date(user.expires_at) < new Date()) {
    db.users.update(user.id, { status:"inactive" });
    return res.status(403).json({ error:"subscription_expired", message:"Sua assinatura expirou." });
  }

  // v2.2 — 2FA: se ativo, exige código do autenticador antes de criar sessão
  if (user.totp_enabled) {
    const code = String((req.body || {}).totp || "").trim();
    if (!code)
      return res.status(403).json({ error:"totp_required", message:"Conta protegida por 2FA — digite o código do seu app autenticador." });
    if (!totpVerify(user.totp_secret, code))
      return res.status(401).json({ error:"totp_invalid", message:"Código 2FA inválido. Confira o app autenticador." });
  }

  const session = createSessionPersisted(user.id);
  setSessionCookiePersisted(res, session.id);
  res.json({ ok:true, user:{ email:user.email, name:user.name, plan:user.plan } });
});

app.post("/api/auth/logout", (req, res) => {
  const cookies = parseCookiesPersisted(req);
  if (cookies[SESSION_COOKIE]) destroySessionPersisted(cookies[SESSION_COOKIE]);
  clearSessionCookiePersisted(res);
  res.json({ ok:true });
});

app.get("/api/auth/me", (req, res) => {
  const cookies = parseCookiesPersisted(req);
  const user    = getSessionPersisted(cookies[SESSION_COOKIE]);
  if (!user || user.status !== "active")
    return res.status(401).json({ error:"not_authenticated" });
  res.json(sanitizeUser(user));
});

app.post("/api/auth/change-password", requireAuthPersisted, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error:"weak_password", message:"Senha precisa de ao menos 6 caracteres." });
  db.users.update(req.user.id, { password_hash: auth.hashPassword(newPassword) });
  res.json({ ok:true });
});

// ══════════════════════════════════════════════
// 2FA — ativação, confirmação e desativação (usuário logado)
// ══════════════════════════════════════════════
app.post("/api/auth/totp/setup", requireAuthPersisted, (req, res) => {
  const user = res.locals.user;
  if (user.totp_enabled)
    return res.status(400).json({ error:"already_enabled", message:"2FA já está ativo nesta conta." });
  const secret = b32encode(crypto.randomBytes(20));
  db.users.update(user.id, { totp_pending_secret: secret });
  const label = encodeURIComponent("ACS System:" + user.email);
  res.json({
    ok: true,
    secret,
    otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("ACS System")}&digits=6&period=30`,
  });
});

app.post("/api/auth/totp/confirm", requireAuthPersisted, (req, res) => {
  const user = db.users.findById(res.locals.user.id);
  if (!user.totp_pending_secret)
    return res.status(400).json({ error:"no_setup", message:"Gere o código primeiro." });
  if (!totpVerify(user.totp_pending_secret, (req.body || {}).code))
    return res.status(401).json({ error:"invalid_code", message:"Código inválido. Confira o app autenticador." });
  db.users.update(user.id, {
    totp_secret: user.totp_pending_secret,
    totp_enabled: true,
    totp_pending_secret: null,
  });
  res.json({ ok: true });
});

app.post("/api/auth/totp/disable", requireAuthPersisted, (req, res) => {
  const user = db.users.findById(res.locals.user.id);
  if (!user.totp_enabled)
    return res.status(400).json({ error:"not_enabled", message:"2FA não está ativo." });
  if (!totpVerify(user.totp_secret, (req.body || {}).code))
    return res.status(401).json({ error:"invalid_code", message:"Código inválido." });
  db.users.update(user.id, { totp_enabled:false, totp_secret:null, totp_pending_secret:null });
  res.json({ ok: true });
});

// ADMIN — reset de 2FA por URL (quem perdeu o celular):
// abra no navegador: /api/admin/users/ID/totp-reset?key=SUA_ADMIN_KEY
app.get("/api/admin/users/:id/totp-reset", requireAdmin, (req, res) => {
  const u = db.users.update(Number(req.params.id), {
    totp_enabled:false, totp_secret:null, totp_pending_secret:null,
  });
  if (!u) return res.status(404).json({ error:"not_found" });
  res.json({ ok:true, message:"2FA desativado para " + u.email });
});

// ══════════════════════════════════════════════
// ADMIN — Usuários
// ══════════════════════════════════════════════

// Rota pública que valida admin key — sem requireAdmin middleware
app.get("/api/admin/ping", (req, res) => {
  const key = req.headers["x-admin-key"] || req.query.key || "";
  const ok  = key && key === process.env.ADMIN_KEY;
  res.json({ ok, ts: Date.now() });
});

// Rota pública de health check
app.get("/health", (req, res) => res.json({ status:"ok", ts: Date.now() }));


// ── PLANOS E TRIAL ────────────────────────────────────────────────
const PLANS = [
  {
    id:       "semestral",
    name:     "Semestral",
    price:    497,
    period:   "6 meses",
    parcel:   "12x de R$ 41,42",
    checkout: "https://chk.eduzz.com/Q9N2NOVB01",
    features: [
      "Todos os sinais sem limite",
      "App ACS System completo",
      "Scanner 200+ pares",
      "Análise IA ilimitada",
      "Academia com 8 aulas",
      "Suporte via WhatsApp",
    ],
  },
  {
    id:       "anual",
    name:     "Anual",
    price:    697,
    period:   "12 meses",
    parcel:   "12x de R$ 58,08",
    checkout: "https://chk.eduzz.com/1488759",
    badge:    "MAIS ESCOLHIDO",
    features: [
      "Tudo do plano Semestral",
      "12 meses garantidos",
      "Bônus: Guia de gestão de risco",
      "Bônus: Planilha de controle de banca",
      "Prioridade nos sinais manuais",
      "Suporte prioritário",
    ],
  },
];

// Info dos planos — pública (usada pelo modal de upgrade no app)
app.get("/api/plans", (req, res) => {
  res.json({
    trial: {
      days:         db.TRIAL_DAYS,
      signal_limit: db.TRIAL_SIGNAL_LIMIT,
    },
    plans: PLANS,
  });
});

// Status do trial do usuário logado
app.get("/api/trial/status", requireAuthPersisted, (req, res) => {
  res.json(db.users.getTrialInfo(res.locals.user));
});


app.get("/api/admin/users", requireAdmin, (req, res) => {
  res.json({ users: db.users.all().map(sanitizeUser) });
});

app.post("/api/admin/users", requireAdmin, (req, res) => {
  const { email, password, name, plan } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error:"missing_fields", message:"Email e senha são obrigatórios." });
  const norm = email.toLowerCase().trim();
  if (db.users.findByEmail(norm))
    return res.status(409).json({ error:"already_exists", message:"Já existe assinante com este email." });
  const hash = auth.hashPassword(password);
  // Admin cria com plano definido — trial não se aplica
  const user = db.users.create({ email:norm, password_hash:hash, name, plan: plan || "trial" });
  // Se veio com plano pago, limpa campos de trial
  if (plan && plan !== "trial") {
    db.users.update(user.id, { trial_started_at: null, trial_ends_at: null, trial_expired: false });
  }
  res.json({ ok:true, user:sanitizeUser(user) });
});

app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status, plan, name, expires_at, newPassword } = req.body || {};
  const patch = {};
  if (status      !== undefined) patch.status      = status;
  if (plan        !== undefined) {
    patch.plan = plan;
    // Se admin definindo plano pago, limpa trial
    if (plan && plan !== "trial") {
      patch.trial_ends_at  = null;
      patch.trial_expired  = false;
    }
  }
  if (name        !== undefined) patch.name        = name;
  if (expires_at  !== undefined) patch.expires_at  = expires_at;
  if (newPassword)               patch.password_hash = auth.hashPassword(newPassword);
  const user = db.users.update(id, patch);
  if (!user) return res.status(404).json({ error:"not_found" });
  res.json({ ok:true, user:sanitizeUser(user) });
});

app.get("/api/admin/webhook-log", requireAdmin, (req, res) => {
  res.json({ logs: db.webhookLog.recent(50) });
});

// ══════════════════════════════════════════════
// ADMIN — Sinais (CRUD completo)
// ══════════════════════════════════════════════

// Listar todos
app.get("/api/admin/signals", requireAdmin, (req, res) => {
  res.json({ signals: db.signals.all() });
});

// Criar sinal
app.post("/api/admin/signals", requireAdmin, (req, res) => {
  const { pair, type, entry, leverage, stoploss, targets, reason, timeframe, setup, confidence, source } = req.body || {};
  if (!pair || !entry)
    return res.status(400).json({ error:"missing_fields", message:"Par e entrada são obrigatórios." });

  const sig = db.signals.create({ pair, type, entry, leverage, stoploss, targets, reason, timeframe, setup, confidence, source: source || "admin" });

  // 📲 Push notification para todos os membros
  const tipoBr   = (type === "SHORT") ? "🔴 VENDA" : "🟢 COMPRA";
  const alvosStr = (targets || []).slice(0, 3).join(" · ");
  sendPushNotification({
    title:   `📡 Novo Sinal — ${pair}`,
    message: `${tipoBr} · Entrada: ${entry} · Alav: ${leverage} · Alvos: ${alvosStr}`,
    url:     "/",
  });

  res.json({ ok:true, signal:sig });
});

// Editar sinal
app.patch("/api/admin/signals/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const allowed = ["pair","type","entry","leverage","stoploss","targets","reason","timeframe","setup","confidence","status","hit","profit_pct","result_pct","time_to_hit","closed_at"];
  const patch = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  // Grava closed_at automaticamente se status muda para fechado
  if (patch.status && ["profit","loss","closed"].includes(patch.status) && !patch.closed_at) {
    patch.closed_at = new Date().toISOString();
  }
  const sig = db.signals.update(id, patch);
  if (!sig) return res.status(404).json({ error:"not_found" });
  res.json({ ok:true, signal:sig });
});

// Deletar sinal
app.delete("/api/admin/signals/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const ok = db.signals.delete(id);
  if (!ok) return res.status(404).json({ error:"not_found" });
  res.json({ ok:true });
});

// Forçar checagem de targets agora
app.post("/api/admin/signals/check-targets", requireAdmin, async (req, res) => {
  await checkSignalTargets();
  res.json({ ok:true, checked: db.signals.active().length });
});


// ══════════════════════════════════════════════
// RELATÓRIOS (admin)
// ══════════════════════════════════════════════

// Meses disponíveis
app.get("/api/admin/reports/months", requireAdmin, (req, res) => {
  const months = db.reports ? db.reports.availableMonths() : [];
  res.json({ months });
});

// Relatório por mês: /api/admin/reports/2026-07
app.get("/api/admin/reports/:period", requireAdmin, (req, res) => {
  const period = req.params.period; // "2026-07" ou "2026-07-01/2026-07-31"

  let sigs;
  if (period.includes("/")) {
    const [from, to] = period.split("/");
    sigs = db.reports ? db.reports.byRange(from, to) : [];
  } else {
    const [year, month] = period.split("-").map(Number);
    sigs = db.reports ? db.reports.byMonth(year, month) : [];
  }

  const metrics = db.reports ? db.reports.metrics(sigs) : {};
  const sorted  = [...sigs].sort((a,b) => new Date(b.created_at)-new Date(a.created_at));

  res.json({ period, metrics, signals: sorted });
});

// Relatório geral (todos os tempos)
app.get("/api/admin/reports", requireAdmin, (req, res) => {
  const all     = db.signals.all();
  const metrics = db.reports ? db.reports.metrics(all) : {};
  const months  = db.reports ? db.reports.availableMonths() : [];
  res.json({ metrics, months, total: all.length });
});


// ══════════════════════════════════════════════
// BYBIT API PROXY (privado — só admin)
// ══════════════════════════════════════════════
const crypto_mod = require("crypto");

function bybitSign(queryString, secret, timestamp, recvWindow = "5000") {
  // Bybit v5: timestamp + apiKey + recvWindow + queryString
  const paramStr = timestamp + (process.env.BYBIT_API_KEY||"") + recvWindow + queryString;
  return require("crypto").createHmac("sha256", secret).update(paramStr).digest("hex");
}

app.get("/api/bybit/proxy", requireAdmin, async (req, res) => {
  const BYBIT_KEY    = process.env.BYBIT_API_KEY;
  const BYBIT_SECRET = process.env.BYBIT_API_SECRET;

  if (!BYBIT_KEY || !BYBIT_SECRET) {
    return res.status(503).json({ error: "Credenciais Bybit não configuradas no Railway" });
  }

  const { endpoint, ...params } = req.query;
  if (!endpoint) return res.status(400).json({ error: "endpoint obrigatório" });

  const timestamp  = String(Date.now());
  const recvWindow = "5000";

  // Monta query string preservando ordem original
  const queryString = Object.keys(params).length
    ? Object.keys(params).map(k => k + "=" + encodeURIComponent(params[k])).join("&")
    : "";

  const signature = bybitSign(queryString, BYBIT_SECRET, timestamp, recvWindow);
  const url = "https://api.bybit.com" + endpoint + (queryString ? "?" + queryString : "");

  try {
    const r = await fetch(url, {
      headers: {
        "X-BAPI-API-KEY":     BYBIT_KEY,
        "X-BAPI-SIGN":        signature,
        "X-BAPI-TIMESTAMP":   timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type":       "application/json",
      },
      signal: AbortSignal.timeout(12000),
    });
    const data = await r.json();
    // Log de debug em caso de erro da Bybit
    if (data.retCode && data.retCode !== 0) {
      console.warn("Bybit API erro:", data.retCode, data.retMsg, "| endpoint:", endpoint);
    }
    res.json(data);
  } catch(err) {
    console.error("Bybit proxy erro:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve a página de análise Bybit

app.get('/acs-scanner-pro.html', (req, res) => serveFile('acs-scanner-pro.html', res));

// ══════════════════════════════════════════════════════════
// COMUNIDADE v2.2 — feed leve (imagens por URL com cache)
// ══════════════════════════════════════════════════════════
const fsCm = require("fs");
const CM_DIR = process.env.DATA_DIR ||
  (process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : __dirname);
const CM_FILE = path.join(CM_DIR, "community_data.json");

let cmState = { posts: [], nextPost: 1 };
try { cmState = Object.assign(cmState, JSON.parse(fsCm.readFileSync(CM_FILE, "utf8"))); } catch (_) {}

let cmSaveTimer = null;
function cmSave() {
  clearTimeout(cmSaveTimer);
  cmSaveTimer = setTimeout(() => {
    fsCm.writeFile(CM_FILE, JSON.stringify(cmState), (err) => {
      if (err) console.error("[comunidade] save:", err.message);
    });
  }, 400);
}

const CM_IMG_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;
const CM_PAGE   = 20;

// v2.2: feed devolve metadados + URL da imagem (nunca o base64)
function cmMeta(p, imgQS) {
  const { image, ...meta } = p;
  return { ...meta, image: "/api/community/img/" + p.id + (imgQS || "") };
}

// Lista posts aprovados + pendentes do próprio usuário (leve)
app.get("/api/community/posts", requireAuthPersisted, (req, res) => {
  const user = res.locals.user;
  const all  = [...cmState.posts].sort((a, b) => b.id - a.id);
  res.json({
    posts:     all.filter(p => p.status === "approved").slice(0, CM_PAGE).map(p => cmMeta(p)),
    myPending: all.filter(p => p.status === "pending" && p.user_id === user.id).map(p => cmMeta(p)),
  });
});

// v2.2: serve a imagem de um post com cache do navegador
app.get("/api/community/img/:id", (req, res) => {
  const post = cmState.posts.find(p => p.id === Number(req.params.id));
  if (!post) return res.status(404).send("not found");

  const cookies = parseCookiesPersisted(req);
  const user    = getSessionPersisted(cookies[SESSION_COOKIE]);
  const isAdmin = !!ADMIN_KEY &&
    (req.query.key === ADMIN_KEY || req.headers["x-admin-key"] === ADMIN_KEY);
  const ok = isAdmin ||
    (user && user.status === "active" && (post.status === "approved" || post.user_id === user.id));
  if (!ok) return res.status(401).send("unauthorized");

  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(post.image || "");
  if (!m) return res.status(404).send("no image");
  const buf = Buffer.from(m[2], "base64");
  res.setHeader("Content-Type", m[1]);
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Cache-Control", "private, max-age=2592000, immutable");
  res.send(buf);
});

// Envia novo post — vai para fila de aprovação
app.post("/api/community/posts", requireAuthPersisted, (req, res) => {
  const user = res.locals.user;
  const { image, caption } = req.body || {};
  if (!image || typeof image !== "string")
    return res.status(400).json({ error: "missing_image", message: "Envie uma imagem." });
  if (image.length > 3_000_000)
    return res.status(413).json({ error: "too_large", message: "Imagem muito grande." });
  if (!CM_IMG_RE.test(image))
    return res.status(400).json({ error: "invalid_image", message: "Formato de imagem inválido." });

  const fila = cmState.posts.filter(p => p.status === "pending" && p.user_id === user.id).length;
  if (fila >= 3)
    return res.status(429).json({ error: "queue_full", message: "Você já tem 3 posts aguardando aprovação." });

  const post = {
    id:         cmState.nextPost++,
    user_id:    user.id,
    user_name:  user.name || user.email.split("@")[0],
    image,
    caption:    String(caption || "").slice(0, 200),
    status:     "pending",
    created_at: new Date().toISOString(),
  };
  cmState.posts.push(post);
  cmSave();
  res.json({ ok: true, post: { id: post.id, status: post.status } });
});

// ADMIN — lista todos os posts (URLs de imagem já com a key)
app.get("/api/admin/community", requireAdmin, (req, res) => {
  const k = req.headers["x-admin-key"] || req.query.key;
  res.json({
    posts: [...cmState.posts].sort((a, b) => b.id - a.id)
      .map(p => cmMeta(p, "?key=" + encodeURIComponent(k))),
  });
});

// ADMIN — aprova ou rejeita post
app.patch("/api/admin/community/:id", requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!["approved", "rejected"].includes(status))
    return res.status(400).json({ error: "invalid_status", message: "Status deve ser approved ou rejected." });
  const post = cmState.posts.find(p => p.id === Number(req.params.id));
  if (!post) return res.status(404).json({ error: "not_found" });
  post.status = status;
  cmSave();
  res.json({ ok: true, post: cmMeta(post) });
});

// ADMIN — deleta post
app.delete("/api/admin/community/:id", requireAdmin, (req, res) => {
  const before = cmState.posts.length;
  cmState.posts = cmState.posts.filter(p => p.id !== Number(req.params.id));
  cmSave();
  res.json({ ok: cmState.posts.length < before });
});


app.get('/acs-meta-ads.html', (req, res) => serveFile('acs-meta-ads.html', res));

app.get("/acs-bybit.html", (req, res) => serveFile("acs-bybit.html", res));

app.get("/bybit-analise.html", (req, res) => {
  // Serve sempre o scanner pro mais recente
  const f = findFile("acs-scanner-pro.html");
  if (f) return res.sendFile(f);
  serveFile("bybit-analise.html", res);
});

// ══════════════════════════════════════════════
// PROXY CLAUDE (protegido por sessão)
// ══════════════════════════════════════════════
app.post("/api/claude", requireAuthPersisted, async (req, res) => {
  try {
    const { system, messages, max_tokens } = req.body;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model:"claude-sonnet-4-5", max_tokens:max_tokens||2000, system, messages }),
    });
    const data = await response.json();
    if (!response.ok) { console.error("Anthropic erro:", data); return res.status(response.status).json(data); }
    res.json(data);
  } catch (err) {
    console.error("Proxy Claude erro:", err);
    res.status(500).json({ error:"internal_error", details:err.message });
  }
});

// ══════════════════════════════════════════════
// PÁGINAS — detecta paths automaticamente
// ══════════════════════════════════════════════
const fs2 = require("fs");

function findFile(filename) {
  const candidates = [
    path.join(__dirname, filename),
    path.join(__dirname, "public", filename),
    path.join(__dirname, "admin-pages", filename),
    path.join(process.cwd(), filename),
    path.join(process.cwd(), "public", filename),
    path.join("/app", filename),
    path.join("/app/public", filename),
  ];
  for (const p of candidates) {
    try { if (fs2.existsSync(p)) return p; } catch {}
  }
  return null;
}

// Log de diagnóstico no boot
["index.html","login.html","app.js","style.css","login.css","login.js","admin.html"].forEach(f => {
  const found = findFile(f);
  console.log(`   ${f}: ${found ? "✅ "+found : "❌ NÃO ENCONTRADO"}`);
});

function serveFile(filename, res) {
  const filePath = findFile(filename);
  if (!filePath) {
    return res.status(404).send(`Arquivo ${filename} não encontrado. Verifique se está na raiz do repositório GitHub.`);
  }
  res.sendFile(filePath);
}

// PWA — arquivos públicos (sem autenticação)
app.get("/manifest.json",        (req, res) => { res.setHeader("Content-Type","application/manifest+json"); serveFile("manifest.json", res); });
app.get("/icon-192.png",         (req, res) => serveFile("icon-192.png", res));
app.get("/icon-512.png",         (req, res) => serveFile("icon-512.png", res));
app.get("/OneSignalSDKWorker.js", (req, res) => {
  // Service Worker deve ser público e servido como JS
  const filePath = findFile("OneSignalSDKWorker.js");
  if (!filePath) return res.status(404).send("OneSignalSDKWorker.js não encontrado");
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Service-Worker-Allowed", "/");
  res.sendFile(filePath);
});
app.get("/admin.html",   (req, res) => serveFile("admin.html", res));
app.get(["/","/index.html"], requirePageAuthPersisted, (req, res) => serveFile("index.html", res));
app.get("/app.js",       requirePageAuthPersisted, (req, res) => serveFile("app.js", res));
app.get("/style.css",    requirePageAuthPersisted, (req, res) => serveFile("style.css", res));
app.get("/login.css",    (req, res) => serveFile("login.css", res));
app.get("/login.js",     (req, res) => serveFile("login.js", res));

// v2.1: bloqueia arquivos sensíveis antes do static
const CM_BLOCKED = new Set([
  "/server.js", "/db.js", "/auth.js", "/eduzz.js",
  "/database.json", "/community_data.json",
  "/package.json", "/package-lock.json", "/.env",
]);
app.use((req, res, next) => {
  if (CM_BLOCKED.has(req.path)) return res.status(404).send("Not found");
  next();
});

// Serve estáticos da raiz + subpastas
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, "public")));

// ══════════════════════════════════════════════
/* ═══════════════════════════════════════════════
   RENDA PASSIVA — rotas Earn (versão embutida)
   ═══════════════════════════════════════════════ */
(function () {
  const PROVIDERS = {
    bybit: {
      nome: "Bybit",
      baseUrl: process.env.BYBIT_BASE_URL || "https://api.bybit.com",
      refUrl: process.env.EARN_BYBIT_REF_URL || "https://www.bybit.com/earn",
      categorias: ["FlexibleSaving", "OnChain"],
    },
  };
  const TTL = 10 * 60 * 1000;
  let cache = { at: 0, data: null };

  const parseApr = (v) => {
    if (v == null) return null;
    const n = parseFloat(String(v).replace("%", "").trim());
    if (!Number.isFinite(n)) return null;
    return n <= 1 ? +(n * 100).toFixed(2) : +n.toFixed(2);
  };

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.retCode !== 0) throw new Error(data.retMsg || "retCode != 0");
    return data.result;
  }

  async function fetchBybit(p) {
    const out = [];
    for (const categoria of p.categorias) {
      try {
        const result = await getJson(`${p.baseUrl}/v5/earn/product?category=${categoria}`);
        for (const item of result?.list || []) {
          if (item.status && item.status !== "Available") continue;
          const apr = parseApr(item.estimateApr);
          if (!apr || apr <= 0) continue;
          out.push({
            provider: "bybit",
            providerNome: p.nome,
            coin: String(item.coin || "").toUpperCase(),
            tipo: categoria === "FlexibleSaving" ? "flexivel" : "onchain",
            apr,
            minimo: item.minStakeAmount ?? null,
            prazoDias: item.duration ? Number(item.duration) : null,
          });
        }
      } catch (_) { /* categoria falhou — segue */ }
    }
    return out;
  }

  function dedup(products) {
    const best = new Map();
    for (const pr of products) {
      const k = `${pr.provider}:${pr.coin}:${pr.tipo}`;
      if (!best.has(k) || best.get(k).apr < pr.apr) best.set(k, pr);
    }
    return [...best.values()].sort((a, b) => b.apr - a.apr);
  }

  app.get("/api/earn/products", requireAuthPersisted, async (_req, res) => {
    try {
      if (cache.data && Date.now() - cache.at < TTL) return res.json(cache.data);
      const products = dedup(await fetchBybit(PROVIDERS.bybit));
      if (!products.length && cache.data) return res.json(cache.data);
      if (!products.length)
        return res.status(502).json({ error: "upstream", message: "Não consegui consultar os produtos agora." });
      const payload = {
        updatedAt: new Date().toISOString(),
        providers: Object.fromEntries(
          Object.entries(PROVIDERS).map(([k, v]) => [k, { nome: v.nome, refUrl: v.refUrl }])
        ),
        products,
      };
      cache = { at: Date.now(), data: payload };
      res.json(payload);
    } catch (e) {
      if (cache.data) return res.json(cache.data);
      res.status(502).json({ error: "upstream", message: "Não consegui consultar os produtos agora." });
    }
  });
})();
/* ══════════════════════════════════════════════
   FINANCEIRO v1 — ledger unificado Eduzz + Cakto
   Webhook Cakto, sincronização de assinantes e
   resumo de vendas/pagamentos para o admin.
   ══════════════════════════════════════════════ */
(function () {
  const FIN_FILE = path.join(CM_DIR, "finance_data.json");
  let fin = { payments: [], raw: [], nextId: 1 };
  try { fin = Object.assign(fin, JSON.parse(fsCm.readFileSync(FIN_FILE, "utf8"))); } catch (_) {}
  let finT = null;
  const finSave = () => {
    clearTimeout(finT);
    finT = setTimeout(() => fsCm.writeFile(FIN_FILE, JSON.stringify(fin),
      (e) => e && console.error("[financeiro] save:", e.message)), 400);
  };

  const pick = (o, paths) => {
    for (const p of paths) {
      const v = p.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), o);
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return null;
  };

  const toNum = (v) => {
    if (v == null) return null;
    const s = String(v);
    let n = parseFloat(s.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    if (!Number.isFinite(n)) return null;
    // heurística: valor inteiro alto sem separador = centavos (ex: 49700 → 497.00)
    if (n >= 3000 && Number.isInteger(n) && !/[.,]/.test(s)) n = n / 100;
    return +n.toFixed(2);
  };

  function classify(evt) {
    const e = String(evt ?? "").toLowerCase();
    if (/aprov|paid|pag[oa]|renew|renov|complet/.test(e)) return "approved";
    if (/reembol|refund|estorn/.test(e))                  return "refunded";
    if (/chargeback|disputa/.test(e))                     return "chargeback";
    if (/cancel/.test(e))                                 return "canceled";
    if (/atras|overdue|past_due|late|vencid|inadimpl/.test(e)) return "overdue";
    if (/pend|aguard|wait|gerad|created/.test(e))         return "pending";
    return "other";
  }

  function planoDe(produto, amount) {
    const p = String(produto ?? "").toLowerCase();
    if (/anual|annual|12 ?m/.test(p))        return { plan: "Anual",     days: 365 };
    if (/semestr|6 ?m/.test(p))              return { plan: "Semestral", days: 180 };
    if (/trimestr|3 ?m/.test(p))             return { plan: "Trimestral", days: 90 };
    if (/mensal|m[eê]s|month/.test(p))       return { plan: "Mensal",    days: 30 };
    if (amount != null) {
      if (amount >= 600) return { plan: "Anual",     days: 365 };
      if (amount >= 400) return { plan: "Semestral", days: 180 };
      return { plan: "Mensal", days: 30 };
    }
    return { plan: produto || "Assinatura", days: 365 };
  }

  function registrar({ source, event, email, name, product, amount, raw }) {
    const status = classify(event);
    email = String(email || "").toLowerCase().trim();
    const { plan, days } = planoDe(product, amount);

    const pay = {
      id: fin.nextId++, source, event: String(event ?? ""), status,
      email, name: name || "", plan, amount: amount ?? null,
      at: new Date().toISOString(), note: "",
    };

    // espelho bruto p/ calibragem do adaptador (últimos 100)
    try {
      fin.raw.unshift({ at: pay.at, source, body: JSON.stringify(raw).slice(0, 3000) });
      fin.raw = fin.raw.slice(0, 100);
    } catch (_) {}

    // sincroniza assinante
    try {
      if (email) {
        let user = db.users.findByEmail(email);
        if (status === "approved") {
          const expires = new Date(Date.now() + (days + 3) * 864e5).toISOString(); // +3d carência
          if (!user) {
            const tempPass = crypto.randomBytes(4).toString("hex");
            user = db.users.create({
              email, name: name || email.split("@")[0],
              password_hash: auth.hashPassword(tempPass), plan,
            });
            db.users.update(user.id, {
              status: "active", expires_at: expires, payment_status: "em_dia",
              origem: source, trial_started_at: null, trial_ends_at: null, trial_expired: false,
            });
            pay.note = "Conta criada — senha temporária: " + tempPass + " (envie ao cliente)";
          } else {
            db.users.update(user.id, {
              status: "active", plan, expires_at: expires,
              payment_status: "em_dia", origem: user.origem || source,
            });
          }
        } else if (status === "overdue" && user) {
          db.users.update(user.id, { payment_status: "atrasado" });
        } else if (["canceled", "refunded", "chargeback"].includes(status) && user) {
          db.users.update(user.id, { status: "inactive", payment_status: status });
        }
      }
    } catch (e) { console.error("[financeiro] sync:", e.message); }

    fin.payments.push(pay);
    if (fin.payments.length > 5000) fin.payments = fin.payments.slice(-5000);
    finSave();
    return pay;
  }

  /* ---- WEBHOOK CAKTO ---- */
  app.post("/webhook/cakto", (req, res) => {
    const sec = process.env.CAKTO_WEBHOOK_SECRET;
    const b = req.body || {};
    if (sec && req.query.key !== sec && pick(b, ["secret", "token", "key"]) !== sec)
      return res.status(401).json({ error: "unauthorized" });

    registrar({
      source: "cakto",
      event: pick(b, ["event", "type", "event_type", "status", "data.status", "data.event"]),
      email: pick(b, ["customer.email", "data.customer.email", "client.email", "buyer.email", "subscriber.email", "email"]),
      name:  pick(b, ["customer.name", "data.customer.name", "client.name", "buyer.name", "subscriber.name", "name"]),
      product: pick(b, ["product.name", "data.product.name", "offer.name", "data.offer.name", "item.name", "product_name", "plan.name"]),
      amount: toNum(pick(b, ["amount", "data.amount", "value", "total", "price", "offer.price", "data.offer.price", "purchase.price"])),
      raw: b,
    });
    res.json({ ok: true });
  });

  /* ---- GRAMPO EDUZZ (chamado pelo wrapper da rota) ---- */
  global.__acsFinanceEduzz = function (req) {
    let b = req.body;
    if (!b || !Object.keys(b).length) {
      try { b = JSON.parse(req.rawBody); }
      catch (_) { b = require("querystring").parse(req.rawBody || ""); }
    }
    const stMap = { 1: "pending", 2: "pending", 3: "approved", 4: "refunded", 6: "canceled", 7: "chargeback" };
    const rawSt = pick(b, ["trans_status", "status", "event", "type", "event_name"]);
    const event = stMap[Number(rawSt)] || rawSt;
    registrar({
      source: "eduzz",
      event,
      email: pick(b, ["cus_email", "customer.email", "buyer_email", "email"]),
      name:  pick(b, ["cus_name", "customer.name", "buyer_name", "name"]),
      product: pick(b, ["product_name", "prod_name", "content_title", "product.name", "item_name"]),
      amount: toNum(pick(b, ["trans_value", "trans_paid", "value", "amount", "price", "sale_value"])),
      raw: b,
    });
  };

  /* ---- RESUMO PARA O ADMIN ---- */
  app.get("/api/admin/finance/summary", requireAdmin, (_req, res) => {
    const now = new Date();
    const mes = now.toISOString().slice(0, 7);
    const doMes = fin.payments.filter((p) => p.at.slice(0, 7) === mes);
    const soma = (arr) => +arr.reduce((a, p) => a + (p.amount || 0), 0).toFixed(2);

    const aprovMes = doMes.filter((p) => p.status === "approved");
    const reembMes = doMes.filter((p) => ["refunded", "chargeback"].includes(p.status));

    const porFonte = {};
    const porPlano = {};
    for (const p of aprovMes) {
      porFonte[p.source] = porFonte[p.source] || { qtd: 0, receita: 0 };
      porFonte[p.source].qtd++; porFonte[p.source].receita = +(porFonte[p.source].receita + (p.amount || 0)).toFixed(2);
      porPlano[p.plan] = porPlano[p.plan] || { qtd: 0, receita: 0 };
      porPlano[p.plan].qtd++; porPlano[p.plan].receita = +(porPlano[p.plan].receita + (p.amount || 0)).toFixed(2);
    }

    const users = db.users.all().filter((u) => u.status !== "deleted");
    const ativos = users.filter((u) => u.status === "active");
    const vencido = (u) => u.expires_at && new Date(u.expires_at) < now;
    const atrasados = ativos.filter((u) => u.payment_status === "atrasado" || vencido(u));
    const venc7 = ativos.filter((u) => u.expires_at &&
      new Date(u.expires_at) > now && new Date(u.expires_at) < new Date(Date.now() + 7 * 864e5));

    res.json({
      mes,
      kpis: {
        receitaMes: soma(aprovMes), vendasMes: aprovMes.length,
        reembolsosMes: soma(reembMes), qtdReembolsosMes: reembMes.length,
        receitaTotal: soma(fin.payments.filter((p) => p.status === "approved")),
        ativos: ativos.length, atrasados: atrasados.length, vencendo7d: venc7.length,
      },
      porFonte, porPlano,
      atrasadosList: atrasados.slice(0, 100).map((u) => ({
        id: u.id, email: u.email, plan: u.plan, origem: u.origem || "—",
        expires_at: u.expires_at || null,
      })),
      ultimos: fin.payments.slice(-40).reverse(),
    });
  });

  // Espelho bruto p/ calibrar o adaptador: /api/admin/finance/raw?key=ADMIN_KEY
  app.get("/api/admin/finance/raw", requireAdmin, (_req, res) => res.json({ raw: fin.raw }));
})();/* ══════════════════════════════════════════════
   PAPER TRADING v1 — livro virtual do Comitê
   Banca fictícia, risco 1% por ideia, rastreio
   automático via fetchPrices (CoinGecko) a cada 60s,
   expiração em 30 dias. Zero custo externo.
   ══════════════════════════════════════════════ */
(function () {
  const PT_FILE = path.join(CM_DIR, "paper_data.json");
  let pt = { positions: [], nextId: 1, bank: 10000, riskPct: 1 };
  try { pt = Object.assign(pt, JSON.parse(fsCm.readFileSync(PT_FILE, "utf8"))); } catch (_) {}
  let ptT = null;
  const ptSave = () => {
    clearTimeout(ptT);
    ptT = setTimeout(() => fsCm.writeFile(PT_FILE, JSON.stringify(pt),
      (e) => e && console.error("[paper] save:", e.message)), 400);
  };

  const rMult = (p, exit) => {
    const risk = Math.abs(p.entry - p.stop);
    if (!risk) return 0;
    const raw = (exit - p.entry) / risk;
    return +( (p.side === "SHORT" ? -raw : raw) ).toFixed(2);
  };

  function fechar(p, exit, motivo) {
    p.status = "closed";
    p.closed_at = new Date().toISOString();
    p.exit = exit;
    p.result_r = rMult(p, exit);
    p.result_pct = +(((exit - p.entry) / p.entry) * 100 * (p.side === "SHORT" ? -1 : 1)).toFixed(2);
    p.motivo = motivo;
  }

  async function ptTrack() {
    const abertas = pt.positions.filter((p) => p.status === "open");
    if (!abertas.length) return;
    const prices = await fetchPrices();
    if (!prices) return;
    let mudou = false;

    for (const p of abertas) {
      const px = prices[p.pair]?.price;
      if (!px) continue;
      const dias = (Date.now() - new Date(p.opened_at)) / 864e5;
      const stopHit = p.side === "LONG" ? px <= p.stop : px >= p.stop;
      const alvo = p.targets[p.hit];
      const alvoHit = alvo != null && (p.side === "LONG" ? px >= alvo : px <= alvo);

      if (stopHit) { fechar(p, p.stop, "stop"); mudou = true; }
      else if (alvoHit) {
        p.hit++;
        // trailing simples: no 1º alvo, stop vai pro empate
        if (p.hit === 1) p.stop = p.entry;
        if (p.hit >= p.targets.length) { fechar(p, alvo, "alvo_final"); }
        mudou = true;
      } else if (dias >= 30) { fechar(p, px, "expirou_30d"); mudou = true; }
      else { p.last_price = px; }
    }
    if (mudou) ptSave();
  }
  setInterval(ptTrack, 60_000);

  app.post("/api/admin/paper/open", requireAdmin, (req, res) => {
    const { pair, side, entry, stop, targets, score, setup, ata } = req.body || {};
    if (!pair || !entry || !stop || !Array.isArray(targets) || !targets.length)
      return res.status(400).json({ error: "missing_fields" });
    if (pt.positions.filter((p) => p.status === "open" && p.pair === pair).length)
      return res.status(409).json({ error: "duplicada", message: "Já existe posição aberta neste par." });
    const pos = {
      id: pt.nextId++, pair, side: side === "SHORT" ? "SHORT" : "LONG",
      entry: +entry, stop: +stop, targets: targets.map(Number),
      score: score ?? null, setup: setup || "comite",
      ata: String(ata || "").slice(0, 8000),
      status: "open", hit: 0, opened_at: new Date().toISOString(),
    };
    pt.positions.push(pos);
    ptSave();
    res.json({ ok: true, position: pos });
  });

  app.get("/api/admin/paper/book", requireAdmin, async (_req, res) => {
    await ptTrack().catch(() => {});
    const closed = pt.positions.filter((p) => p.status === "closed");
    const wins = closed.filter((p) => p.result_r > 0);
    const somaR = +closed.reduce((a, p) => a + (p.result_r || 0), 0).toFixed(2);
    res.json({
      bank: pt.bank, riskPct: pt.riskPct,
      equity: +(pt.bank * (1 + (pt.riskPct / 100) * somaR)).toFixed(2),
      stats: {
        abertas: pt.positions.filter((p) => p.status === "open").length,
        fechadas: closed.length, wins: wins.length,
        winRate: closed.length ? Math.round((wins.length / closed.length) * 100) : null,
        somaR, mediaR: closed.length ? +(somaR / closed.length).toFixed(2) : null,
      },
      positions: [...pt.positions].sort((a, b) => b.id - a.id).slice(0, 200),
    });
  });

  app.post("/api/admin/paper/close/:id", requireAdmin, async (req, res) => {
    const p = pt.positions.find((x) => x.id === Number(req.params.id) && x.status === "open");
    if (!p) return res.status(404).json({ error: "not_found" });
    const prices = await fetchPrices();
    fechar(p, prices?.[p.pair]?.price ?? p.entry, "manual");
    ptSave();
    res.json({ ok: true, position: p });
  });

  app.delete("/api/admin/paper/:id", requireAdmin, (req, res) => {
    const before = pt.positions.length;
    pt.positions = pt.positions.filter((x) => x.id !== Number(req.params.id));
    ptSave();
    res.json({ ok: pt.positions.length < before });
  });
})();
app.listen(PORT, () => {
  console.log(`\n🚀 ALFA CRIPTO SINAIS v2.2 rodando na porta ${PORT}`);
  console.log(`   Feed Comunidade: imagens por URL com cache`);
  console.log(`   2FA TOTP:        ativo (Authy/Google Authenticator)`);
  console.log(`   Login:           /login.html\n`);
});

setInterval(() => db.sessions.cleanExpired(), 60 * 60 * 1000).unref();
