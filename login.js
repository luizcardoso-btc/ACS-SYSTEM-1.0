/* ══════════════════════════════════════════════
   login.js — ACS SYSTEM v3
   + Detecta primeiro acesso (must_change_password)
   + Força criação de senha pessoal antes de entrar
   + Mensagens de erro claras por tipo
   ══════════════════════════════════════════════ */

const form    = document.getElementById("loginForm");
const emailEl = document.getElementById("email");
const passEl  = document.getElementById("password");
const submitEl= document.getElementById("submitBtn");
const alertEl = document.getElementById("alertBox");
const titleEl = document.getElementById("formTitle");
const subEl   = document.getElementById("formSubtitle");

// ── Tela de troca de senha (primeiro acesso) ──────────────────────
const newPassWrap  = document.getElementById("newPassWrap");
const newPassEl    = document.getElementById("newPassword");
const confirmPassEl= document.getElementById("confirmPassword");
const passStrength = document.getElementById("passStrength");

let step = "login"; // "login" | "change"

// ── Helpers ───────────────────────────────────────────────────────
function showAlert(msg, type = "error") {
  alertEl.textContent = msg;
  alertEl.style.display = "";
  alertEl.className = "alert alert-" + type;
}
function hideAlert() { alertEl.style.display = "none"; }
function setLoading(v) {
  submitEl.disabled = v;
  submitEl.textContent = v ? (step === "login" ? "Entrando..." : "Salvando...") : (step === "login" ? "ENTRAR" : "SALVAR SENHA E ENTRAR");
}

// Força de senha
function checkStrength(pw) {
  if (!passStrength) return;
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["","Muito fraca","Fraca","Média","Forte","Muito forte"];
  const colors = ["","#ef4444","#f97316","#eab308","#22c55e","#3b82f6"];
  passStrength.textContent = pw ? labels[score] : "";
  passStrength.style.color = pw ? colors[score] : "";
}

if (newPassEl) newPassEl.addEventListener("input", () => checkStrength(newPassEl.value));

// ── STEP 1: Login normal ──────────────────────────────────────────
async function doLogin(e) {
  e.preventDefault();
  hideAlert();

  const email    = emailEl.value.trim();
  const password = passEl.value;
  if (!email || !password) { showAlert("Preencha email e senha."); return; }

  setLoading(true);
  try {
    const res  = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      const msgs = {
        invalid_credentials:   "Email ou senha incorretos.",
        subscription_inactive: data.message || "Assinatura inativa. Entre em contato com o suporte.",
        subscription_pending:  "Pagamento em processamento. Aguarde alguns minutos.",
        subscription_expired:  "Sua assinatura expirou. Renove para continuar.",
      };
      showAlert(msgs[data.error] || data.message || "Erro ao fazer login.");
      return;
    }

    if (data.mustChangePassword) {
      // Vai para tela de troca de senha
      switchToChangePassword(email);
    } else {
      // Login completo — vai para o app
      window.location.href = "/";
    }

  } catch (err) {
    showAlert("Erro de conexão. Verifique sua internet e tente novamente.");
  } finally {
    setLoading(false);
  }
}

// ── STEP 2: Troca de senha obrigatória ───────────────────────────
function switchToChangePassword(email) {
  step = "change";

  // Muda o visual do formulário
  titleEl.textContent = "Crie sua senha";
  if (subEl) subEl.textContent = "Este é seu primeiro acesso. Crie uma senha pessoal para continuar.";

  // Esconde campos de login
  document.getElementById("emailField").style.display = "none";
  document.getElementById("passField").style.display  = "none";

  // Mostra campos de nova senha
  if (newPassWrap) newPassWrap.style.display = "";

  submitEl.textContent = "SALVAR SENHA E ENTRAR";

  // Guarda email para usar na troca
  submitEl.dataset.email = email;

  hideAlert();
  showAlert("Sua senha temporária foi confirmada. Agora crie uma senha pessoal.", "info");
}

async function doChangePassword(e) {
  e.preventDefault();
  hideAlert();

  const newPassword     = newPassEl?.value || "";
  const confirmPassword = confirmPassEl?.value || "";

  if (newPassword.length < 8) {
    showAlert("A senha deve ter pelo menos 8 caracteres.");
    return;
  }
  if (newPassword !== confirmPassword) {
    showAlert("As senhas não coincidem. Tente novamente.");
    return;
  }

  setLoading(true);
  try {
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
    const data = await res.json();

    if (!res.ok) {
      showAlert(data.message || "Erro ao salvar senha.");
      return;
    }

    showAlert("Senha salva com sucesso! Redirecionando...", "success");
    setTimeout(() => { window.location.href = "/"; }, 1200);

  } catch(err) {
    showAlert("Erro de conexão. Tente novamente.");
  } finally {
    setLoading(false);
  }
}

// ── Event listener principal ─────────────────────────────────────
form?.addEventListener("submit", (e) => {
  if (step === "login")  doLogin(e);
  else                   doChangePassword(e);
});

// ── Verifica se já está logado ───────────────────────────────────
(async () => {
  try {
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      const data = await res.json();
      if (data.mustChangePassword) {
        switchToChangePassword(data.email);
      } else {
        window.location.href = "/";
      }
    }
  } catch {}
})();
