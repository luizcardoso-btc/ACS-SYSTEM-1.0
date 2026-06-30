/* ══════════════════════════════════════════════
   auth.js — Autenticação por email/senha + sessões
   ══════════════════════════════════════════════ */

const crypto = require("crypto");
const db = require("./db");

const SESSION_DAYS = 30;
const COOKIE_NAME = "alfa_session";

// ── Senha: hash com PBKDF2 (nativo do Node, sem dependências extras) ──────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(check, "hex"));
  } catch {
    return false;
  }
}

// ── Sessões ────────────────────────────────────────────────────────────────────
function createSession(userId) {
  const id = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.sessions.create(id, userId, expiresAt);
  return { id, expiresAt };
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const session = db.sessions.find(sessionId);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    db.sessions.destroy(sessionId);
    return null;
  }
  const user = db.users.findById(session.user_id);
  if (!user) return null;
  return user;
}

function destroySession(sessionId) {
  db.sessions.destroy(sessionId);
}

// ── Cookie helpers (sem dependências externas) ────────────────────────────────
function setSessionCookie(res, sessionId) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === "production" ? "Secure; " : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${sessionId}; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAge}; Path=/`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return acc;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    acc[k] = decodeURIComponent(v);
    return acc;
  }, {});
}

// ── Verifica se a assinatura do usuário está realmente ativa agora ───────────
function isActiveUser(user) {
  if (!user) return false;
  if (user.status !== "active") return false;
  if (user.expires_at && new Date(user.expires_at) < new Date()) {
    db.users.update(user.id, { status: "inactive" });
    return false;
  }
  return true;
}

// ── Middleware: exige login + assinatura ativa (para rotas de API/JSON) ──────
function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const user = getSession(cookies[COOKIE_NAME]);

  if (!user) {
    return res.status(401).json({ error: "not_authenticated", message: "Faça login para continuar." });
  }
  if (!isActiveUser(user)) {
    return res.status(403).json({ error: "subscription_inactive", message: "Sua assinatura não está ativa." });
  }

  req.user = user;
  next();
}

// ── Middleware: serve a página, mas redireciona pro /login se não logado ─────
function requirePageAuth(req, res, next) {
  const cookies = parseCookies(req);
  const user = getSession(cookies[COOKIE_NAME]);
  if (!user || !isActiveUser(user)) {
    return res.redirect("/login.html");
  }
  req.user = user;
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  isActiveUser,
  requireAuth,
  requirePageAuth,
  COOKIE_NAME,
};
