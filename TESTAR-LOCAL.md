# 🧪 Testar agora, na sua máquina

Guia rápido — só pra rodar e testar local. Pra colocar no ar de verdade
pra assinantes, depois leia o `DEPLOY.md`.

## 1. Instale o Node.js (se ainda não tiver)

Baixe em [nodejs.org](https://nodejs.org) — pegue a versão **LTS**.

Confirme no terminal:
```bash
node -v
```
Precisa mostrar `v18` ou mais novo.

## 2. Instale as dependências

Abra o terminal **dentro da pasta do projeto** (onde está o `server.js`) e rode:
```bash
npm install
```

## 3. Configure sua chave da Anthropic

Copie o arquivo `.env.example` e renomeie a cópia pra `.env` (sem ".example").

Abra o `.env` num editor de texto e cole sua chave real:
```
ANTHROPIC_API_KEY=sk-ant-sua-chave-de-verdade-aqui
ADMIN_KEY=admin123
PORT=3000
```

Pegue sua chave em [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
(precisa ter créditos na conta pra IA funcionar).

## 4. Rode o servidor

```bash
npm start
```

Você vai ver algo assim no terminal:
```
👤 Conta de teste criada automaticamente:
   Email: teste@local.com
   Senha: teste123

🚀 ALFA CRIPTO SINAIS rodando na porta 3000
   Webhook Eduzz:  /webhook/eduzz
   Login:          /login.html
```

**Essa conta de teste (`teste@local.com` / `teste123`) é criada
automaticamente só localmente**, pra você não precisar configurar nada
extra pra começar a testar. Ela nunca é criada em produção real (no
Railway), nem se você esquecer de remover esse comportamento depois —
o código verifica isso sozinho.

## 5. Abra no navegador

Acesse **http://localhost:3000**

Você cai na tela de login. Entre com:
- **Email:** `teste@local.com`
- **Senha:** `teste123`

E pronto — o app completo abre, com o motor de sinais IA, painel de
mercado, chat com a IA, tudo funcionando de verdade (chamando sua API
da Anthropic).

## 🛠️ Painel admin (opcional, pra já ir se acostumando)

Acesse: `http://localhost:3000/admin.html?key=admin123`

(o `admin123` é o valor que você colocou em `ADMIN_KEY` no `.env` — troque
por algo mais seguro quando for pra produção de verdade)

Lá você pode criar outros assinantes de teste, bloquear, editar.

## 🔁 Próximas vezes

Depois dessa primeira vez, pra rodar de novo é só:
```bash
npm start
```
(não precisa repetir `npm install` nem reconfigurar nada — os dados
ficam salvos em `data/alfa-db.json`)

## 🧯 Problemas comuns

**"Cannot find module 'express'"** → esqueceu o `npm install`.

**"ANTHROPIC_API_KEY não encontrada"** → o arquivo `.env` não existe ou
tem nome errado. Confirme que é exatamente `.env` (não `.env.txt`).

**Login dá "email ou senha incorretos"** → confirme que está digitando
exatamente `teste@local.com` e `teste123` (tudo minúsculo).

**Tela de sinais mostra "Erro ao gerar sinais"** → sua `ANTHROPIC_API_KEY`
pode estar errada ou sem créditos. Verifique em
[console.anthropic.com](https://console.anthropic.com).

**Quero recomeçar do zero (apagar a conta de teste e tudo mais)** →
delete o arquivo `data/alfa-db.json` e rode `npm start` de novo.

---

Quando estiver satisfeito com os testes locais e quiser vender de
verdade pra assinantes, o próximo passo é o **`DEPLOY.md`** — ele te
leva do zero até o app no ar 24h, conectado à Eduzz.
