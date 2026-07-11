/* ══════════════════════════════════════════════
   server.js — ALFA CRIPTO SINAIS v2
   + Preços reais via CoinGecko
   + Signals persistidos no banco (CRUD admin)
   + Targets ativam automaticamente com preço real
   + Auth por email/senha · Webhook Eduzz
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
  if (!user) return user;
  const { password_hash, ...safe } = user;
  return safe;
}

// ── Body parsing ───────────────────────────────────────────────────────────────
app.use(express.json({
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
app.get("/api/prices", auth.requireAuth, async (req, res) => {
  const prices = await fetchPrices();
  if (!prices) return res.status(503).json({ error: "prices_unavailable", message: "CoinGecko indisponível. Tente em instantes." });
  res.json({ prices, fetchedAt: new Date(priceCache.fetchedAt).toISOString() });
});

// ══════════════════════════════════════════════
// API: Sinais (leitura — para usuários logados)
// ══════════════════════════════════════════════
app.get("/api/signals", auth.requireAuth, (req, res) => {
  const all = db.signals.all();
  res.json({ signals: all });
});

// ══════════════════════════════════════════════
// WEBHOOK Eduzz
// ══════════════════════════════════════════════
app.post("/webhook/eduzz", eduzz.webhookHandler);

// ══════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════
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

  const session = auth.createSession(user.id);
  auth.setSessionCookie(res, session.id);
  res.json({ ok:true, user:{ email:user.email, name:user.name, plan:user.plan } });
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
  if (!user || user.status !== "active")
    return res.status(401).json({ error:"not_authenticated" });
  res.json({ email:user.email, name:user.name, plan:user.plan, expires_at:user.expires_at });
});

app.post("/api/auth/change-password", auth.requireAuth, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error:"weak_password", message:"Senha precisa de ao menos 6 caracteres." });
  db.users.update(req.user.id, { password_hash: auth.hashPassword(newPassword) });
  res.json({ ok:true });
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
  const user = db.users.create({ email:norm, password_hash:hash, name, plan });
  res.json({ ok:true, user:sanitizeUser(user) });
});

app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status, plan, name, expires_at, newPassword } = req.body || {};
  const patch = {};
  if (status      !== undefined) patch.status      = status;
  if (plan        !== undefined) patch.plan        = plan;
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
app.get("/bybit-analise.html", (req, res) => serveFile("bybit-analise.html", res)); // auth feita via JS interno

// ══════════════════════════════════════════════
// PROXY CLAUDE (protegido por sessão)
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
app.get(["/","/index.html"], auth.requirePageAuth, (req, res) => serveFile("index.html", res));
app.get("/app.js",       auth.requirePageAuth, (req, res) => serveFile("app.js", res));
app.get("/style.css",    auth.requirePageAuth, (req, res) => serveFile("style.css", res));
app.get("/login.css",    (req, res) => serveFile("login.css", res));
app.get("/login.js",     (req, res) => serveFile("login.js", res));

// Serve estáticos da raiz + subpastas
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, "public")));

// ══════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n🚀 ALFA CRIPTO SINAIS v2 rodando na porta ${PORT}`);
  console.log(`   Preços reais:    /api/prices  (CoinGecko 30s cache)`);
  console.log(`   Sinais admin:    /admin.html`);
  console.log(`   Login:           /login.html\n`);
});

setInterval(() => db.sessions.cleanExpired(), 60 * 60 * 1000).unref();
