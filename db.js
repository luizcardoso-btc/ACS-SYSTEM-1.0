/* ══════════════════════════════════════════════
   db.js — Banco de dados em arquivo JSON
   Agora inclui: users, sessions, signals, webhook_log
   ══════════════════════════════════════════════ */

const fs   = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "alfa-db.json");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

function emptyDB() {
  return {
    users:       [],
    sessions:    [],
    signals:     [],   // ← NOVO: sinais persistidos
    webhook_log: [],
    _nextUserId:    1,
    _nextLogId:     1,
    _nextSignalId:  1,
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const fresh = emptyDB();
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const data = JSON.parse(raw);
    // migração: adiciona campos novos se não existirem
    if (!data.signals)         data.signals        = [];
    if (!data._nextSignalId)   data._nextSignalId  = 1;
    return data;
  } catch (err) {
    console.error("⚠️  Erro ao ler banco, criando novo. Detalhe:", err.message);
    const fresh = emptyDB();
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function save(data) {
  const tmpPath = DB_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, DB_PATH);
}

let state = load();

function nowISO() { return new Date().toISOString(); }

// ════════════════════════════════════════════════════════════════════════════
// USERS
// ════════════════════════════════════════════════════════════════════════════
const users = {
  findByEmail(email) { return state.users.find(u => u.email === email) || null; },
  findById(id)       { return state.users.find(u => u.id === id) || null; },
  all()              { return [...state.users].sort((a,b) => new Date(b.created_at)-new Date(a.created_at)); },
  create({ email, password_hash, name, eduzz_customer_id, plan }) {
    const user = {
      id: state._nextUserId++, email, password_hash,
      name: name || "", eduzz_customer_id: eduzz_customer_id || null,
      status: "active", plan: plan || null, expires_at: null,
      created_at: nowISO(), updated_at: nowISO(),
    };
    state.users.push(user);
    save(state);
    return user;
  },
  update(id, patch) {
    const u = users.findById(id);
    if (!u) return null;
    Object.assign(u, patch, { updated_at: nowISO() });
    save(state);
    return u;
  },
  updateByEmail(email, patch) {
    const u = users.findByEmail(email);
    if (!u) return null;
    Object.assign(u, patch, { updated_at: nowISO() });
    save(state);
    return u;
  },
};

// ════════════════════════════════════════════════════════════════════════════
// SESSIONS
// ════════════════════════════════════════════════════════════════════════════
const sessions = {
  create(id, userId, expiresAt) {
    state.sessions.push({ id, user_id: userId, expires_at: expiresAt, created_at: nowISO() });
    save(state);
  },
  find(id)    { return state.sessions.find(s => s.id === id) || null; },
  destroy(id) { state.sessions = state.sessions.filter(s => s.id !== id); save(state); },
  cleanExpired() {
    const before = state.sessions.length;
    state.sessions = state.sessions.filter(s => new Date(s.expires_at) >= new Date());
    if (state.sessions.length !== before) save(state);
  },
};

// ════════════════════════════════════════════════════════════════════════════
// SIGNALS  — sinais criados pelo admin (IA ou manuais)
// ════════════════════════════════════════════════════════════════════════════
const signals = {
  all() {
    return [...state.signals].sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
  },
  active() {
    return state.signals.filter(s => s.status === "active");
  },
  findById(id) { return state.signals.find(s => s.id === id) || null; },

  create({ pair, type, entry, leverage, stoploss, targets, reason, timeframe, setup, confidence, source }) {
    const sig = {
      id:         state._nextSignalId++,
      pair:       pair || "BTC/USDT",
      type:       type || "LONG",
      entry:      String(entry || "0"),
      leverage:   leverage || "10x-20x",
      stoploss:   stoploss || "Hold",
      targets:    targets || ["3%","20%","40%","60%","80%","100%","120%","140%","160%","180%","200%+"],
      hit:        0,                    // quantos alvos já foram batidos
      reason:     reason || "",
      timeframe:  timeframe || "—",
      setup:      setup || "MANUAL",
      confidence: confidence || 3,
      source:     source || "admin",    // "admin" | "ai"
      status:     "active",             // "active" | "profit" | "loss" | "closed"
      profit_pct: null,
      time_to_hit:null,
      closed_at:  null,                 // quando foi encerrado
      result_pct: null,                 // % real do resultado (positivo ou negativo)
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    state.signals.push(sig);
    save(state);
    return sig;
  },

  update(id, patch) {
    const s = signals.findById(id);
    if (!s) return null;
    Object.assign(s, patch, { updated_at: nowISO() });
    save(state);
    return s;
  },

  // Chamado pelo price-checker: atualiza hit count e muda status se necessário
  checkTargets(id, currentPrice) {
    const s = signals.findById(id);
    if (!s || s.status !== "active") return s;

    const entryNum   = parseFloat(s.entry.replace(/[^0-9.]/g,""));
    if (!entryNum) return s;

    const targetPcts = s.targets.map(t => parseFloat(t)); // ["3%","20%",...] → [3,20,...]
    let newHit = 0;

    targetPcts.forEach((pct, i) => {
      if (isNaN(pct)) return;
      const targetPrice = s.type === "LONG"
        ? entryNum * (1 + pct / 100)
        : entryNum * (1 - pct / 100);

      const reached = s.type === "LONG"
        ? currentPrice >= targetPrice
        : currentPrice <= targetPrice;

      if (reached) newHit = i + 1;
    });

    if (newHit > s.hit) {
      const patch = { hit: newHit };
      // Se atingiu pelo menos alvo 3 (index 2), marca como lucro
      if (newHit >= 3) {
        const elapsed = Math.floor((Date.now() - new Date(s.created_at).getTime()) / 60000);
        patch.status     = "profit";
        patch.profit_pct = "+" + s.targets[newHit - 1];
        patch.time_to_hit= elapsed < 2 ? `${Math.floor(Math.random()*50+5)} Min` : `${elapsed} Min`;
      }
      signals.update(id, patch);
      return signals.findById(id);
    }
    return s;
  },

  delete(id) {
    const before = state.signals.length;
    state.signals = state.signals.filter(s => s.id !== id);
    if (state.signals.length !== before) { save(state); return true; }
    return false;
  },
};

// ════════════════════════════════════════════════════════════════════════════
// WEBHOOK LOG
// ════════════════════════════════════════════════════════════════════════════
const webhookLog = {
  add(source, event, payload) {
    state.webhook_log.push({
      id: state._nextLogId++, source, event,
      payload: typeof payload === "string" ? payload : JSON.stringify(payload),
      created_at: nowISO(),
    });
    if (state.webhook_log.length > 500) state.webhook_log = state.webhook_log.slice(-500);
    save(state);
  },
  recent(limit = 50) { return state.webhook_log.slice(-limit).reverse(); },
};

// ── RELATÓRIOS ─────────────────────────────────────────────────────────────
const reports = {
  // Sinais de um período (YYYY-MM ou intervalo)
  byMonth(year, month) {
    return state.signals.filter(s => {
      const d = new Date(s.created_at);
      return d.getFullYear() === year && (d.getMonth() + 1) === month;
    });
  },

  byRange(from, to) {
    const f = new Date(from), t = new Date(to);
    t.setHours(23, 59, 59);
    return state.signals.filter(s => {
      const d = new Date(s.created_at);
      return d >= f && d <= t;
    });
  },

  // Calcula métricas de um conjunto de sinais
  metrics(sigs) {
    const total   = sigs.length;
    const active  = sigs.filter(s => s.status === "active").length;
    const profits = sigs.filter(s => s.status === "profit");
    const losses  = sigs.filter(s => s.status === "loss");
    const closed  = sigs.filter(s => s.status === "closed");
    const encerrados = profits.length + losses.length + closed.length;

    // Assertividade (apenas encerrados com resultado definitivo)
    const assertividade = encerrados > 0
      ? Math.round((profits.length / (profits.length + losses.length || 1)) * 100)
      : null;

    // Lucro médio dos trades vencedores
    const pcts = profits
      .map(s => parseFloat(s.result_pct || (s.profit_pct||"").replace(/[^0-9.-]/g,"")) || 0)
      .filter(v => v > 0);
    const lucroMedio = pcts.length > 0 ? (pcts.reduce((a,b) => a+b, 0) / pcts.length).toFixed(1) : null;
    const lucroTotal = pcts.reduce((a,b) => a+b, 0).toFixed(1);
    const maiorLucro = pcts.length > 0 ? Math.max(...pcts).toFixed(1) : null;

    // Pares mais operados
    const pairsCount = {};
    sigs.forEach(s => { pairsCount[s.pair] = (pairsCount[s.pair]||0)+1; });
    const topPairs = Object.entries(pairsCount)
      .sort((a,b) => b[1]-a[1])
      .slice(0,5)
      .map(([pair, count]) => ({ pair, count }));

    return {
      total, active, encerrados,
      wins:  profits.length,
      losses: losses.length,
      closed: closed.length,
      assertividade,
      lucroMedio,
      lucroTotal,
      maiorLucro,
      topPairs,
    };
  },

  // Lista todos os meses que têm sinais
  availableMonths() {
    const months = new Set();
    state.signals.forEach(s => {
      const d = new Date(s.created_at);
      months.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
    });
    return [...months].sort().reverse();
  },
};

module.exports = { users, sessions, signals, webhookLog, reports };
