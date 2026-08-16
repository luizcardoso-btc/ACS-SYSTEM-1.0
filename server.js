/* ══════════════════════════════════════════════
   server.js — ALFA CRIPTO SINAIS v2.1
   + Preços reais via CoinGecko
   + Signals persistidos no banco (CRUD admin)
   + Targets ativam automaticamente com preço real
   + Auth por email/senha · Webhook Eduzz
   ── v2.1 ──
   + Comunidade autocontida (posts com aprovação)
   + Limite de body 4mb (upload de imagens)
   + Rota Earn usando sessão persistida
   + Bloqueio de arquivos sensíveis no static
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
    else console.log(
