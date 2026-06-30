/* ══════════════════════════════════════════════
   db.js — "Banco de dados" simples em arquivo JSON
   ══════════════════════════════════════════════
   Por que não SQL? Pra evitar dependências nativas (better-sqlite3 etc.)
   que exigem compilação C++ e podem falhar no build de algumas hospedagens.
   Isso aqui é só JavaScript puro — funciona em qualquer lugar, sem drama.

   Para o volume de um produto de sinais (centenas/poucos milhares de
   assinantes), isso é mais que suficiente e extremamente confiável.

   IMPORTANTE SOBRE PERSISTÊNCIA NO RAILWAY:
   Por padrão, o sistema de arquivos do Railway é efêmero (se perde a cada
   novo deploy). Para os dados dos assinantes não se perderem, é necessário
   criar um "Volume" no Railway e apontar DB_PATH pra ele. Isso está
   detalhado no DEPLOY.md.
   ══════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "alfa-db.json");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// ── Estrutura inicial ──────────────────────────────────────────────────────────
function emptyDB() {
  return { users: [], sessions: [], webhook_log: [], _nextUserId: 1, _nextLogId: 1 };
}

// ── Carrega do disco (cria arquivo se não existir) ────────────────────────────
function load() {
  if (!fs.existsSync(DB_PATH)) {
    const fresh = emptyDB();
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("⚠️  Erro ao ler banco de dados, criando um novo. Detalhe:", err.message);
    const fresh = emptyDB();
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

// ── Salva no disco (escrita atômica: grava em tmp e renomeia) ────────────────
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
  findByEmail(email) {
    return state.users.find(u => u.email === email) || null;
  },
  findById(id) {
    return state.users.find(u => u.id === id) || null;
  },
  all() {
    return [...state.users].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },
  create({ email, password_hash, name, eduzz_customer_id, plan }) {
    const user = {
      id: state._nextUserId++,
      email,
      password_hash,
      name: name || "",
      eduzz_customer_id: eduzz_customer_id || null,
      status: "active",
      plan: plan || null,
      expires_at: null,
      created_at: nowISO(),
      updated_at: nowISO(),
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
  find(id) {
    return state.sessions.find(s => s.id === id) || null;
  },
  destroy(id) {
    state.sessions = state.sessions.filter(s => s.id !== id);
    save(state);
  },
  // Limpa sessões expiradas periodicamente (evita arquivo crescer infinito)
  cleanExpired() {
    const before = state.sessions.length;
    state.sessions = state.sessions.filter(s => new Date(s.expires_at) >= new Date());
    if (state.sessions.length !== before) save(state);
  },
};

// ════════════════════════════════════════════════════════════════════════════
// WEBHOOK LOG (auditoria)
// ════════════════════════════════════════════════════════════════════════════
const webhookLog = {
  add(source, event, payload) {
    state.webhook_log.push({
      id: state._nextLogId++,
      source, event,
      payload: typeof payload === "string" ? payload : JSON.stringify(payload),
      created_at: nowISO(),
    });
    // Mantém só os últimos 500 eventos para o arquivo não crescer sem limite
    if (state.webhook_log.length > 500) state.webhook_log = state.webhook_log.slice(-500);
    save(state);
  },
  recent(limit = 50) {
    return state.webhook_log.slice(-limit).reverse();
  },
};

module.exports = { users, sessions, webhookLog };

