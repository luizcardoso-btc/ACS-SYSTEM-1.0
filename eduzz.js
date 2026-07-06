/* ══════════════════════════════════════════════════════════════════
   eduzz.js — Integração Webhook Eduzz v2
   - Cria conta automaticamente ao comprar
   - Envia email com senha temporária via Resend (resend.com)
   - Bloqueia acesso em cancelamento/reembolso/chargeback
   - Marca usuário como "pending" enquanto aguarda pagamento
   ══════════════════════════════════════════════════════════════════

   CONFIGURAÇÃO NO .env:
   EDUZZ_WEBHOOK_SECRET=seu_secret_da_eduzz
   RESEND_API_KEY=re_xxxxxxxxxxxx   ← crie grátis em resend.com
   EMAIL_FROM=noreply@acssystem.com.br
   APP_URL=https://acs-system-production.up.railway.app

   CONFIGURAÇÃO NA EDUZZ:
   1. integrations.eduzz.com/webhook/configs → Nova configuração
   2. URL: https://SEU-APP.up.railway.app/webhook/eduzz
   3. Eventos: myeduzz.invoice_paid, myeduzz.invoice_refunded,
               myeduzz.invoice_chargeback, myeduzz.contract_canceled,
               myeduzz.contract_overdue
   4. Copie o Secret gerado → EDUZZ_WEBHOOK_SECRET no Railway
   ══════════════════════════════════════════════════════════════════ */

const crypto = require("crypto");
const db     = require("./db");
const auth   = require("./auth");

const GRANT_EVENTS = new Set([
  "myeduzz.invoice_paid",
  "myeduzz.sale_approved",
]);

const REVOKE_EVENTS = new Set([
  "myeduzz.invoice_refunded",
  "myeduzz.invoice_chargeback",
  "myeduzz.invoice_waiting_refund",
  "myeduzz.contract_canceled",
  "myeduzz.contract_overdue",
  "myeduzz.invoice_late",
]);

// ── Gera senha temporária legível (evita chars confusos) ─────────────────────
function generateTempPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let pass = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) pass += chars[bytes[i] % chars.length];
  return pass; // ex: "k3mxp9qr"
}

// ── Envia email via Resend ────────────────────────────────────────────────────
async function sendWelcomeEmail({ email, name, tempPassword }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM       = process.env.EMAIL_FROM || "ACS SYSTEM <noreply@acssystem.com.br>";
  const APP_URL    = process.env.APP_URL || "https://acs-system-production.up.railway.app";

  if (!RESEND_KEY) {
    // Sem chave Resend — loga senha no terminal para o admin copiar manualmente
    console.log(`\n📧 EMAIL NÃO ENVIADO (sem RESEND_API_KEY)`);
    console.log(`   Para: ${email}`);
    console.log(`   Senha temporária: ${tempPassword}`);
    console.log(`   Acesso: ${APP_URL}/login.html\n`);
    return { ok: false, reason: "no_resend_key" };
  }

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#060810;font-family:'Inter',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#060810;padding:40px 20px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#090C18;border:1px solid #1a2a4a;border-radius:16px;overflow:hidden;max-width:100%">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#0f1a2e,#0d1526);padding:36px 40px;text-align:center;border-bottom:1px solid #1a2a4a">
        <div style="width:52px;height:52px;margin:0 auto 16px;background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;">
          <svg width="32" height="32" viewBox="0 0 400 400" fill="none"><circle cx="200" cy="200" r="155" stroke="#60A5FA" stroke-width="18" fill="none"/><rect x="155" y="28" width="22" height="46" rx="11" fill="#60A5FA"/><rect x="223" y="28" width="22" height="46" rx="11" fill="#60A5FA"/><rect x="155" y="326" width="22" height="46" rx="11" fill="#60A5FA"/><rect x="223" y="326" width="22" height="46" rx="11" fill="#60A5FA"/><path d="M200 100 L310 290 H90 Z" stroke="#60A5FA" stroke-width="18" stroke-linejoin="round" fill="none"/></svg>
        </div>
        <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0;letter-spacing:-.5px">ACS SYSTEM</h1>
        <p style="color:#60A5FA;font-size:11px;letter-spacing:2px;margin:4px 0 0;font-family:monospace">SINAIS INTELIGENTES</p>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:40px 40px 32px">
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 8px;letter-spacing:-.3px">
          Bem-vindo${name ? ", " + name.split(" ")[0] : ""}! 🎉
        </h2>
        <p style="color:#94A3B8;font-size:15px;line-height:1.7;margin:0 0 28px">
          Sua compra foi confirmada. Seu acesso ao ACS SYSTEM está ativo. Abaixo estão seus dados de acesso — <strong style="color:#fff">guarde em lugar seguro.</strong>
        </p>

        <!-- Credenciais -->
        <div style="background:#060810;border:1px solid #1a2a4a;border-radius:12px;padding:24px;margin-bottom:28px">
          <div style="margin-bottom:16px">
            <div style="font-size:11px;color:#475569;letter-spacing:1px;font-family:monospace;margin-bottom:6px">EMAIL DE ACESSO</div>
            <div style="font-size:15px;color:#fff;font-weight:500">${email}</div>
          </div>
          <div>
            <div style="font-size:11px;color:#475569;letter-spacing:1px;font-family:monospace;margin-bottom:6px">SENHA TEMPORÁRIA</div>
            <div style="font-size:22px;color:#60A5FA;font-weight:700;font-family:monospace;letter-spacing:2px">${tempPassword}</div>
          </div>
        </div>

        <div style="background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.15);border-radius:10px;padding:16px;margin-bottom:28px">
          <p style="color:#93C5FD;font-size:13px;margin:0;line-height:1.6">
            ⚠️ <strong>Importante:</strong> No seu primeiro acesso você será solicitado a criar uma nova senha pessoal. Use uma senha forte que só você saiba.
          </p>
        </div>

        <!-- CTA -->
        <div style="text-align:center;margin-bottom:24px">
          <a href="${APP_URL}/login.html" style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;border-radius:10px;padding:14px 36px;font-size:15px;font-weight:600;letter-spacing:-.2px">
            Acessar o ACS SYSTEM →
          </a>
        </div>

        <p style="color:#475569;font-size:13px;text-align:center;line-height:1.6;margin:0">
          Dúvidas? Fale com o suporte:<br/>
          <a href="mailto:suporte@acssystem.com.br" style="color:#60A5FA">suporte@acssystem.com.br</a>
        </p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#060810;padding:20px 40px;text-align:center;border-top:1px solid #0f1a2e">
        <p style="color:#334155;font-size:11px;font-family:monospace;margin:0">
          ACS SYSTEM · ${APP_URL} · Você recebeu este email pois realizou uma compra.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_KEY}`,
      },
      body: JSON.stringify({
        from:    FROM,
        to:      [email],
        subject: "🔑 Seu acesso ao ACS SYSTEM — Dados de login",
        html,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("Resend erro:", data);
      return { ok: false, error: data };
    }
    console.log(`📧 Email enviado para ${email} (id: ${data.id})`);
    return { ok: true, id: data.id };
  } catch (err) {
    console.error("Resend fetch erro:", err.message);
    return { ok: false, error: err.message };
  }
}

async function sendBlockedEmail({ email, name, reason }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM       = process.env.EMAIL_FROM || "ACS SYSTEM <noreply@acssystem.com.br>";
  const APP_URL    = process.env.APP_URL || "https://acs-system-production.up.railway.app";
  if (!RESEND_KEY) return;

  const reasonText = {
    "myeduzz.invoice_refunded":       "reembolso processado",
    "myeduzz.invoice_chargeback":     "contestação de pagamento",
    "myeduzz.contract_canceled":      "cancelamento da assinatura",
    "myeduzz.contract_overdue":       "pagamento em atraso",
    "myeduzz.invoice_late":           "pagamento em atraso",
  }[reason] || "alteração no pagamento";

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: FROM, to: [email],
        subject: "ACS SYSTEM — Acesso suspenso",
        html: `<div style="font-family:Arial,sans-serif;background:#060810;color:#94A3B8;padding:40px;border-radius:12px;max-width:500px;margin:0 auto">
          <h2 style="color:#fff">Acesso suspenso</h2>
          <p>Seu acesso ao ACS SYSTEM foi suspenso devido a <strong style="color:#F87171">${reasonText}</strong>.</p>
          <p>Se achar que é um engano, entre em contato: <a href="mailto:suporte@acssystem.com.br" style="color:#60A5FA">suporte@acssystem.com.br</a></p>
        </div>`,
      }),
    });
  } catch {}
}

// ── Valida assinatura Eduzz ───────────────────────────────────────────────────
function isValidSignature(rawBody, signatureHeader) {
  const secret = process.env.EDUZZ_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signatureHeader, "hex"));
  } catch { return false; }
}

// ── Processa evento ───────────────────────────────────────────────────────────
async function handleEvent(eventName, data) {
  const buyer = data?.buyer || data?.customer || data?.client || {};
  const email  = (buyer.email || data?.email || "").toLowerCase().trim();
  const name   = buyer.name || data?.name || "";
  const plan   = data?.offer?.name || data?.product?.name || "ACS SYSTEM";
  const custId = buyer.id || null;

  if (!email) {
    console.warn("Webhook: sem email, evento ignorado.", eventName);
    return { ok: false, reason: "no_email" };
  }

  const existing = db.users.findByEmail(email);

  if (GRANT_EVENTS.has(eventName)) {
    if (!existing) {
      const tempPassword = generateTempPassword();
      const passwordHash = auth.hashPassword(tempPassword);
      const user = db.users.create({
        email,
        password_hash:    passwordHash,
        name,
        eduzz_customer_id: custId,
        plan,
        must_change_password: true,  // força troca no primeiro login
      });
      console.log(`✅ Nova conta criada via Eduzz: ${email}`);
      await sendWelcomeEmail({ email, name, tempPassword });
      return { ok: true, action: "created", email };
    } else {
      db.users.update(existing.id, { status: "active", plan });
      console.log(`✅ Acesso reativado: ${email}`);
      return { ok: true, action: "reactivated", email };
    }
  }

  if (REVOKE_EVENTS.has(eventName)) {
    if (existing) {
      db.users.update(existing.id, { status: "inactive" });
      console.log(`⛔ Acesso bloqueado: ${email} (${eventName})`);
      await sendBlockedEmail({ email, name, reason: eventName });
      return { ok: true, action: "revoked", email };
    }
    return { ok: true, action: "noop", email };
  }

  return { ok: true, action: "ignored", event: eventName };
}

// ── Route handler ─────────────────────────────────────────────────────────────
async function webhookHandler(req, res) {
  const rawBody   = req.rawBody || JSON.stringify(req.body);
  const signature = req.headers["x-signature"] || req.headers["x-eduzz-signature"];

  if (!isValidSignature(rawBody, signature)) {
    console.warn("Webhook: assinatura inválida.");
    return res.status(401).json({ error: "invalid_signature" });
  }

  const event = req.body?.event || req.body?.type || "unknown";
  const data  = req.body?.data  || req.body || {};

  db.webhookLog.add("eduzz", event, req.body);

  try {
    const result = await handleEvent(event, data);
    return res.status(200).json({ received: true, ...result });
  } catch (err) {
    console.error("Webhook erro:", err);
    return res.status(500).json({ error: "processing_error" });
  }
}

module.exports = { webhookHandler, handleEvent, generateTempPassword, sendWelcomeEmail };
