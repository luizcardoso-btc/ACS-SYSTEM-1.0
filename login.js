/* ACS SYSTEM — login.js
   Login simples: email + senha gerada pelo admin
   Sem troca obrigatória de senha */

const form     = document.getElementById("loginForm");
const emailEl  = document.getElementById("email");
const passEl   = document.getElementById("password");
const submitEl = document.getElementById("submitBtn");
const alertEl  = document.getElementById("alertBox");

function showAlert(msg) {
  alertEl.textContent = msg;
  alertEl.style.display = "";
}
function hideAlert() { alertEl.style.display = "none"; }

function setLoading(v) {
  submitEl.disabled    = v;
  submitEl.textContent = v ? "Entrando..." : "ENTRAR";
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert();

  const email    = emailEl.value.trim();
  const password = passEl.value;
  if (!email || !password) { showAlert("Preencha email e senha."); return; }

  setLoading(true);
  try {
    const res  = await fetch("/api/auth/login", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      const msgs = {
        invalid_credentials:   "Email ou senha incorretos.",
        subscription_inactive: "Assinatura inativa. Entre em contato com o suporte.",
        subscription_pending:  "Pagamento em processamento. Aguarde alguns minutos.",
        subscription_expired:  "Sua assinatura expirou. Renove para continuar.",
      };
      showAlert(msgs[data.error] || data.message || "Erro ao fazer login.");
      return;
    }

    // Login OK — redireciona para o app
    window.location.href = "/";

  } catch (err) {
    showAlert("Erro de conexão. Verifique sua internet e tente novamente.");
  } finally {
    setLoading(false);
  }
});

// Se já estiver logado, vai direto para o app
(async () => {
  try {
    const res = await fetch("/api/auth/me");
    if (res.ok) window.location.href = "/";
  } catch {}
})();
/* ═══════════════════════════════════════════════════════════
   ACS SYSTEM — LOGIN+ v1.1 (auto-instalável)
   • "Fale com o suporte" → WhatsApp direto (com email digitado)
   • "Esqueci a senha" com redefinição assistida via WhatsApp
   (v1.1: removida a linha visível com o número)
   Colar no FINAL do login.js. Reverter = apagar o bloco.
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.__acsLoginPlus) return;
  window.__acsLoginPlus = true;

  var ZAP = "5575988209055";
  var wa = function (msg) {
    return "https://wa.me/" + ZAP + "?text=" + encodeURIComponent(msg);
  };

  function emailDigitado() {
    var inp = document.querySelector('input[type="email"]') ||
      document.querySelector('input[placeholder*="mail" i]') ||
      document.querySelector('#email, input[name*="mail" i], input[id*="mail" i]');
    return inp && inp.value ? inp.value.trim() : "";
  }

  function abrirZap(msg) { window.open(wa(msg), "_blank", "noopener"); }

  function boot() {
    /* ---------- 1) "Fale com o suporte" → WhatsApp ---------- */
    var suporteLink = null;
    Array.prototype.forEach.call(document.querySelectorAll("a"), function (a) {
      if (/suporte/i.test(a.textContent || "")) {
        suporteLink = a;
        a.setAttribute("href", "#");
        a.addEventListener("click", function (e) {
          e.preventDefault();
          var em = emailDigitado();
          abrirZap("Olá! Preciso de ajuda com meu acesso ao ACS System." +
                   (em ? " Meu email de cadastro: " + em : ""));
        });
      }
    });
    var anchorHost = suporteLink ? (suporteLink.closest("div,p") || suporteLink.parentElement) : null;

    /* ---------- 2) Link "Esqueci a senha" ---------- */
    var btnEntrar = Array.prototype.slice.call(document.querySelectorAll("button"))
      .filter(function (b) { return /entrar/i.test(b.textContent || ""); })[0];

    var esq = document.createElement("div");
    esq.style.cssText = "text-align:center;margin-top:12px;";
    esq.innerHTML =
      '<a href="#" id="acsEsqueci" style="color:#8fa3b8;font-size:13px;text-decoration:underline;cursor:pointer">Esqueci a senha</a>';
    if (btnEntrar) btnEntrar.insertAdjacentElement("afterend", esq);
    else if (anchorHost) anchorHost.insertAdjacentElement("beforebegin", esq);
    else document.body.appendChild(esq);

    /* ---------- 3) Modal de redefinição ---------- */
    var ov = document.createElement("div");
    ov.id = "acsResetOv";
    ov.style.cssText =
      "position:fixed;inset:0;background:rgba(4,8,14,.88);display:none;align-items:center;justify-content:center;z-index:9999;padding:16px;";
    ov.innerHTML =
      '<div style="background:#121821;border:1px solid #26303C;border-radius:16px;padding:24px;width:100%;max-width:380px;font-family:inherit;color:#E8EEF4">' +
        '<div style="font-size:17px;font-weight:800;margin-bottom:6px">🔑 Redefinir senha</div>' +
        '<div style="font-size:13px;color:#8fa3b8;line-height:1.6;margin-bottom:14px">' +
          "Informe o email da sua conta. Nossa equipe confirma seus dados e envia a nova senha pelo WhatsApp em poucos minutos." +
        "</div>" +
        '<input id="acsResetEmail" type="email" placeholder="seu@email.com" ' +
          'style="width:100%;background:#0C1218;border:1px solid #26303C;border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;margin-bottom:12px"/>' +
        '<button id="acsResetGo" style="width:100%;background:#25D366;color:#04240F;border:none;border-radius:10px;padding:13px;font-size:14px;font-weight:800;cursor:pointer">Continuar no WhatsApp</button>' +
        '<button id="acsResetCancel" style="width:100%;background:transparent;color:#8fa3b8;border:none;padding:12px 0 0;font-size:13px;cursor:pointer">Voltar</button>' +
      "</div>";
    document.body.appendChild(ov);

    function abrirModal() {
      var em = emailDigitado();
      var inp = document.getElementById("acsResetEmail");
      if (em) inp.value = em;
      ov.style.display = "flex";
      inp.focus();
    }
    function fecharModal() { ov.style.display = "none"; }

    document.getElementById("acsEsqueci").addEventListener("click", function (e) {
      e.preventDefault(); abrirModal();
    });
    document.getElementById("acsResetCancel").addEventListener("click", fecharModal);
    ov.addEventListener("click", function (e) { if (e.target === ov) fecharModal(); });

    document.getElementById("acsResetGo").addEventListener("click", function () {
      var em = (document.getElementById("acsResetEmail").value || "").trim();
      if (!em || em.indexOf("@") < 1) { alert("Digite o email da sua conta."); return; }
      abrirZap("Olá! Esqueci minha senha do ACS System. Meu email de cadastro é: " + em +
               ". Pode redefinir para mim, por favor?");
      fecharModal();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
