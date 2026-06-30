/* ══════════════════════════════════════════════
   eduzz.js — Integração com Webhook da Eduzz
   Cria/ativa/cancela contas automaticamente conforme pagamento
   ══════════════════════════════════════════════

   COMO CONFIGURAR NA EDUZZ (faça isso depois do deploy — passo a passo
   completo está no arquivo DEPLOY.md):

   1. Acesse https://integrations.eduzz.com/webhook/configs
   2. Clique "+ Nova configuração"
   3. Nome: "Alfa Cripto Sinais"
   4. URL: https://SEU-DOMINIO.up.railway.app/webhook/eduzz
   5. Em "Quais eventos você deseja receber", dentro do grupo MyEduzz, marque:
        - myeduzz.invoice_paid          (fatura paga → libera acesso)
        - myeduzz.invoice_refunded      (reembolso → bloqueia)
        - myeduzz.invoice_chargeback    (chargeback → bloqueia)
        - myeduzz.invoice_waiting_refund(aguardando reembolso → bloqueia)
        - myeduzz.contract_canceled     (assinatura cancelada → bloqueia)
        - myeduzz.contract_overdue      (assinatura atrasada → bloqueia)
   6. Clique "Verificar URL" — sua API precisa estar no ar pra esse teste passar.
   7. A Eduzz vai mostrar um "Secret" — copie e cole no seu .env como
      EDUZZ_WEBHOOK_SECRET (usado para confirmar que o evento é legítimo).
   8. Salve e ative a configuração.
   ══════════════════════════════════════════════ */

const crypto = require("crypto");
const db = require("./db");
const auth = require("./auth");

// Eventos que LIBERAM acesso
const GRANT_EVENTS = new Set([
  "myeduzz.invoice_paid",
]);

// Eventos que BLOQUEIAM acesso
const REVOKE_EVENTS = new Set([
  "myeduzz.invoice_refunded",
  "myeduzz.invoice_chargeback",
  "myeduzz.invoice_waiting_refund",
  "myeduzz.invoice_late",
  "myeduzz.contract_canceled",
  "myeduzz.contract_overdue",
]);

// ── Validação de assinatura (x-signature = HMAC SHA256 do corpo) ─────────────
function isValidSignature(rawBody, signatureHeader) {
  const secret = process.env.EDUZZ_WEBHOOK_SECRET;
  if (!secret) return true; // sem secret configurado ainda → não bloqueia (configure assim que tiver)
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signatureHeader, "hex"));
  } catch {
    return false;
  }
}

// ── Gera senha temporária aleatória para novas contas ────────────────────────
function generateTempPassword() {
  return crypto.randomBytes(6).toString("hex"); // ex: "a1b2c3d4e5f6"
}

// ── Processa o evento recebido ────────────────────────────────────────────────
function handleEvent(eventName, data) {
  const buyer = data?.buyer || data?.customer || {};
  const email = (buyer.email || "").toLowerCase().trim();
  const name  = buyer.name || "";
  const offerName = data?.offer?.name || "Alfa Cripto Sinais";
  const customerId = buyer.id || null;

  if (!email) {
    console.warn("Webhook Eduzz: evento sem email do comprador, ignorado.", eventName);
    return { ok: false, reason: "no_email" };
  }

  const existingUser = db.users.findByEmail(email);

  if (GRANT_EVENTS.has(eventName)) {
    if (!existingUser) {
      const tempPassword = generateTempPassword();
      const passwordHash = auth.hashPassword(tempPassword);
      db.users.create({ email, password_hash: passwordHash, name, eduzz_customer_id: customerId, plan: offerName });

      console.log(`✅ Nova conta criada: ${email} | senha temporária: ${tempPassword}`);
      // TODO: integrar envio de e-mail (ex: Resend, SendGrid) para mandar
      // a senha temporária pro cliente automaticamente. Por ora, confira
      // o terminal/logs do servidor após cada venda para pegar a senha,
      // ou gere uma nova com: node scripts/create-admin.js senha email novaSenha
      return { ok: true, action: "created", email, tempPassword };
    } else {
      db.users.updateByEmail(email, { status: "active", plan: offerName });
      console.log(`✅ Acesso reativado: ${email}`);
      return { ok: true, action: "reactivated", email };
    }
  }

  if (REVOKE_EVENTS.has(eventName)) {
    if (existingUser) {
      db.users.updateByEmail(email, { status: "inactive" });
      console.log(`⛔ Acesso bloqueado: ${email} (${eventName})`);
      return { ok: true, action: "revoked", email };
    }
    return { ok: true, action: "noop_not_found", email };
  }

  return { ok: true, action: "ignored_event", event: eventName };
}

// ── Express route handler ─────────────────────────────────────────────────────
function webhookHandler(req, res) {
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const signature = req.headers["x-signature"];

  if (!isValidSignature(rawBody, signature)) {
    console.warn("Webhook Eduzz: assinatura inválida, requisição rejeitada.");
    return res.status(401).json({ error: "invalid_signature" });
  }

  const { event, data } = req.body || {};

  db.webhookLog.add("eduzz", event || "unknown", req.body);

  try {
    const result = handleEvent(event, data);
    return res.status(200).json({ received: true, ...result });
  } catch (err) {
    console.error("Erro ao processar webhook Eduzz:", err);
    return res.status(500).json({ error: "processing_error" });
  }
}

module.exports = { webhookHandler, handleEvent };
