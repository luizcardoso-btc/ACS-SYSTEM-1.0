# Alfa Cripto Sinais 🚀

Plataforma de sinais de trading cripto com IA (Smart Money Concepts),
painel de mercado, chat com IA, login por assinatura e integração com
a Eduzz para liberar/bloquear acesso automaticamente conforme pagamento.

## 📁 Estrutura do projeto

```
alfa-cripto-sinais/
├── server.js              ← servidor principal (rotas, auth, proxy Claude)
├── db.js                   ← "banco de dados" (arquivo JSON, sem dependências nativas)
├── auth.js                 ← login, sessões, senhas
├── eduzz.js                ← processa webhooks da Eduzz (libera/bloqueia acesso)
├── package.json
├── .env.example             ← copie para .env e preencha suas chaves
├── scripts/
│   └── create-admin.js     ← cria/gerencia assinantes via terminal
├── admin-pages/
│   └── admin.html           ← painel admin web (gerenciar assinantes)
├── public/
│   ├── index.html           ← app principal (protegido por login)
│   ├── style.css
│   ├── app.js
│   ├── login.html           ← tela de login (pública)
│   ├── login.css
│   └── login.js
└── DEPLOY.md                ← guia completo passo a passo de deploy + Eduzz
```

## 🚀 Deploy em produção

**Leia o `DEPLOY.md`** — guia completo, do zero, para colocar isso no
ar com Railway e conectar à Eduzz. Nunca fez deploy antes? Está tudo
explicado lá, sem pular nenhum passo.

## 💻 Rodando localmente (para testar antes do deploy)

```bash
npm install
cp .env.example .env
# edite o .env e cole sua ANTHROPIC_API_KEY e defina uma ADMIN_KEY
npm start
```

Acesse `http://localhost:3000` — você será redirecionado para o login.

Para criar seu primeiro assinante de teste:
```bash
node scripts/create-admin.js criar seu@email.com senha123 "Seu Nome" "Teste"
```

Ou use o painel visual: `http://localhost:3000/admin.html?key=SUA_ADMIN_KEY`

## 🔑 Conceitos importantes

- **Cada assinante tem login (email + senha).** Contas são criadas
  automaticamente quando alguém compra pela Eduzz (via webhook), ou
  manualmente por você pelo painel admin / terminal.
- **A API key da Anthropic nunca é exposta ao navegador.** Todo o
  motor de IA passa pelo seu servidor (`/api/claude`), que exige sessão
  ativa de assinante antes de repassar a chamada.
- **O banco de dados é um arquivo JSON simples** (`data/alfa-db.json`),
  sem dependências nativas — funciona em qualquer hospedagem sem
  complicação de build. Para não perder os dados entre deploys, é
  necessário configurar um "Volume" no Railway (detalhado no DEPLOY.md).
- **Webhook da Eduzz** (`/webhook/eduzz`) processa eventos de
  pagamento/reembolso/cancelamento automaticamente, criando ou
  bloqueando contas de assinantes.

## 🛠️ Comandos úteis do painel admin (terminal)

```bash
node scripts/create-admin.js criar email@x.com senha123 "Nome" "Plano"
node scripts/create-admin.js ativar email@x.com
node scripts/create-admin.js bloquear email@x.com
node scripts/create-admin.js senha email@x.com novaSenha
node scripts/create-admin.js listar
```
