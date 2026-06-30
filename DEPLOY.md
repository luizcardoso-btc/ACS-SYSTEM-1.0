# 🚀 Guia de Deploy — Alfa Cripto Sinais

Este guia parte do zero absoluto: você nunca fez deploy, e ao final deste
documento seu app vai estar **no ar, 24 horas por dia**, com login por
assinante e cobrança automática pela Eduzz.

Tempo estimado: 30-45 minutos na primeira vez.

---

## 📋 Visão geral do que vamos fazer

1. Colocar o código num repositório do GitHub (obrigatório pro Railway)
2. Criar conta no Railway e subir o projeto
3. Configurar as variáveis de ambiente (suas chaves secretas)
4. Criar um "Volume" para os dados dos assinantes não se perderem
5. Configurar o webhook na Eduzz pra apontar pro seu site no ar
6. Testar uma venda de verdade (ou simulada) e confirmar que tudo se conecta

---

## PARTE 1 — Subir o código pro GitHub

O Railway precisa puxar seu código de algum lugar. O jeito padrão é o GitHub.

1. Crie uma conta gratuita em [github.com](https://github.com) se ainda não tiver.
2. Clique em **"New repository"** (botão verde, ou o "+" no topo da página).
3. Dê um nome, ex: `alfa-cripto-sinais`. Deixe como **Private** (privado — é importante, já que isso é seu produto pago).
4. Não marque nenhuma opção de inicializar com README — deixe vazio.
5. Clique **Create repository**.

Agora, no seu computador, dentro da pasta do projeto (a mesma onde estão
`server.js`, `package.json`, etc.), abra o terminal e rode:

```bash
git init
git add .
git commit -m "Primeira versão do Alfa Cripto Sinais"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/alfa-cripto-sinais.git
git push -u origin main
```

(Troque `SEU-USUARIO` pelo seu nome de usuário do GitHub — essa URL exata
o GitHub mostra na tela depois que você cria o repositório, é só copiar
de lá.)

Se pedir login, o GitHub vai te guiar a criar um "token de acesso" — siga
as instruções na tela dele.

✅ **Checkpoint:** atualize a página do seu repositório no GitHub — você
deve ver todos os arquivos do projeto lá (server.js, public/, etc.), e
**não** deve ver a pasta `node_modules` nem nenhum arquivo `.env` (o
`.gitignore` que já está no projeto impede isso).

---

## PARTE 2 — Criar conta no Railway e subir o projeto

1. Acesse [railway.app](https://railway.app) e clique em **"Login"**.
2. Entre com sua conta do GitHub (mais simples — já conecta tudo).
3. No painel, clique **"New Project"**.
4. Escolha **"Deploy from GitHub repo"**.
5. Selecione o repositório `alfa-cripto-sinais` que você acabou de criar.
6. O Railway vai detectar que é um projeto Node.js automaticamente e
   começar a instalar e rodar. **Vai falhar nessa primeira tentativa** —
   é esperado, porque ainda faltam as variáveis de ambiente. Sem problema,
   continue para a Parte 3.

---

## PARTE 3 — Configurar as variáveis de ambiente

Dentro do seu projeto no Railway:

1. Clique no serviço (a caixinha com o nome do seu repositório).
2. Vá na aba **"Variables"**.
3. Clique **"+ New Variable"** e adicione, uma por uma:

| Nome | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | sua chave da Anthropic (começa com `sk-ant-`) |
| `ADMIN_KEY` | invente uma senha forte e longa, só você vai usar |
| `EDUZZ_WEBHOOK_SECRET` | deixe vazio por agora — voltamos nisso na Parte 6 |
| `NODE_ENV` | `production` |
| `DB_PATH` | `/data/alfa-db.json` (vamos criar esse volume na Parte 4) |

Depois de adicionar todas, o Railway reinicia o deploy automaticamente.

💡 **Dica:** existe também um botão **"Raw Editor"** nessa mesma tela —
você pode colar todas as variáveis de uma vez, no formato `NOME=valor`,
uma por linha. É mais rápido que adicionar uma por uma.

---

## PARTE 4 — Criar um Volume (pra não perder os assinantes)

Por padrão, qualquer arquivo criado pelo seu app no Railway é apagado
sempre que você faz um novo deploy. Isso destruiria sua lista de
assinantes! Para evitar isso, criamos um "Volume" — um espaço de disco
que persiste entre deploys.

1. Dentro do seu serviço no Railway, vá na aba **"Settings"**.
2. Procure a seção **"Volumes"**.
3. Clique **"+ New Volume"**.
4. Em **"Mount path"**, digite: `/data`
5. Salve.

Isso conecta a pasta `/data` dentro do servidor a um disco permanente.
Como você já configurou `DB_PATH=/data/alfa-db.json` na Parte 3, o banco
de assinantes vai morar lá e sobreviver a qualquer atualização futura do
código.

✅ **Checkpoint:** force um novo deploy (aba "Deployments" → "..." →
"Redeploy") e confira nos logs (aba "Deployments" → clique no deploy
mais recente → "View Logs") se aparece a mensagem:
```
🚀 ALFA CRIPTO SINAIS rodando na porta ...
```
Se aparecer isso, está tudo certo e seu app está no ar.

---

## PARTE 5 — Pegar sua URL pública e configurar um domínio (opcional)

1. Na aba **"Settings"** do serviço, procure **"Networking"** → **"Generate Domain"**.
2. O Railway te dá uma URL grátis, parecida com:
   `https://alfa-cripto-sinais-production.up.railway.app`
3. Acesse essa URL no navegador. Você deve ver a tela de login.

**Quer usar seu próprio domínio** (ex: `app.alfacriptosinais.com`)? Na
mesma tela de "Networking", clique **"+ Custom Domain"**, digite seu
domínio, e o Railway te mostra um registro DNS (tipo `CNAME`) pra você
cadastrar no painel onde comprou seu domínio (Registro.br, GoDaddy,
Hostinger, etc.). Isso pode levar algumas horas para propagar.

A partir daqui, vou usar `SEU-DOMINIO` no texto — substitua pela sua URL
real do Railway ou seu domínio próprio.

---

## PARTE 6 — Configurar o webhook na Eduzz

Agora vamos conectar a Eduzz ao seu app, pra que toda venda libere o
acesso automaticamente.

1. Acesse [integrations.eduzz.com/webhook/configs](https://integrations.eduzz.com/webhook/configs)
   (ou: dentro do Órbita, menu **"Avançado" → "Webhooks"**, que te
   redireciona pro Developer Hub).
2. Clique **"+ Nova configuração"**.
3. **Nome:** `Alfa Cripto Sinais` (qualquer nome ajuda a identificar depois)
4. **URL:** `https://SEU-DOMINIO/webhook/eduzz`
5. Em **"Quais eventos você deseja receber?"**, expanda o grupo **MyEduzz**
   e marque:
   - ✅ `myeduzz.invoice_paid` — fatura paga → **libera o acesso**
   - ✅ `myeduzz.invoice_refunded` — reembolso → **bloqueia**
   - ✅ `myeduzz.invoice_chargeback` — chargeback → **bloqueia**
   - ✅ `myeduzz.invoice_waiting_refund` — aguardando reembolso → **bloqueia**
   - ✅ `myeduzz.contract_canceled` — assinatura cancelada → **bloqueia**
   - ✅ `myeduzz.contract_overdue` — assinatura atrasada → **bloqueia**
6. Clique **"Verificar URL"**. Se seu app estiver no ar (Parte 4), isso
   deve passar com sucesso.
7. A Eduzz vai te mostrar um **Secret** (chave de origem) — copie esse valor.
8. Volte no Railway → Variables → edite `EDUZZ_WEBHOOK_SECRET` e cole o
   valor copiado. Salve (o Railway reinicia automaticamente).
9. Volte na Eduzz e clique **"Criar configuração"**, depois **ative** a
   integração.

✅ **Checkpoint:** na própria tela de Webhooks da Eduzz, existe um menu
**"Histórico de envios"**. Depois de uma venda de teste ou real, você
deve ver o evento aparecer ali com status de sucesso (200).

---

## PARTE 7 — Testar tudo (antes de anunciar pros assinantes)

### Teste A — Criar um assinante manualmente e logar

1. Acesse `https://SEU-DOMINIO/admin.html?key=SUA_ADMIN_KEY`
   (a `ADMIN_KEY` que você definiu na Parte 3).
2. Clique **"+ NOVO ASSINANTE"**, preencha com seu próprio email e uma
   senha de teste.
3. Abra uma aba anônima do navegador, acesse `https://SEU-DOMINIO/`,
   e faça login com esse email/senha.
4. Você deve ver o app completo (sinais, mercado, chat com a IA).

### Teste B — Simular uma compra (sem gastar dinheiro de verdade)

A Eduzz não tem um "modo sandbox" de teste de webhook fácil sem uma venda
real, mas você pode simular o efeito direto pelo terminal do seu
computador (isso *não* afeta sua conta real da Eduzz, só testa seu servidor):

```bash
curl -X POST https://SEU-DOMINIO/webhook/eduzz \
  -H "Content-Type: application/json" \
  -d '{"event":"myeduzz.invoice_paid","data":{"buyer":{"email":"teste-real@voce.com","name":"Teste"},"offer":{"name":"Plano Mensal"}}}'
```

Se você já tiver configurado o `EDUZZ_WEBHOOK_SECRET`, esse teste vai
falhar com `invalid_signature` — isso é o esperado e **bom sinal**
(significa que seu endpoint está protegido contra chamadas falsas). Pra
testar de verdade nesse caso, é melhor confiar no botão "Verificar URL"
da própria Eduzz, ou fazer uma venda real de baixo valor pra você mesmo.

### Teste C — Primeira venda real

Faça uma compra de teste de verdade (pode ser pra você mesmo, com algum
valor simbólico se o seu produto permitir). Depois:

1. Olhe os logs do Railway (aba Deployments → View Logs) — deve aparecer
   algo como:
   ```
   ✅ Nova conta criada: seuemail@x.com | senha temporária: a1b2c3d4e5f6
   ```
2. Use essa senha temporária pra logar em `https://SEU-DOMINIO/`.

---

## ⚠️ Importante: como o cliente recebe a senha?

Agora mesmo, o sistema **gera** uma senha temporária automaticamente a
cada venda, mas ela só aparece nos *logs do servidor* — ela não é enviada
por email pro cliente ainda. Você tem três opções:

**Opção 1 (mais simples, pra já começar a vender):** depois de cada
venda, você mesmo confere o email do comprador no painel da Eduzz, olha
os logs do Railway pra pegar a senha gerada (ou gera uma nova você mesmo
pelo painel admin em `/admin.html`), e manda manualmente por WhatsApp/email.

**Opção 2 (recomendada a médio prazo):** a Eduzz tem automações nativas
de email (ou você pode configurar isso na própria área de membros que
geralmente acompanha contas Eduzz) que avisam o comprador. Você pode
configurar lá uma mensagem padrão dizendo "acesse [seu site], se for seu
primeiro acesso, clique em 'esqueci minha senha'" — mas isso exige
adicionarmos uma função de "esqueci minha senha" ao sistema (posso
construir isso a seguir, se quiser).

**Opção 3 (mais robusta):** integrar um serviço de envio de email (ex:
Resend, que tem plano grátis generoso) direto no `eduzz.js`, pra mandar
a senha automaticamente assim que a conta é criada. Também posso
construir isso — é a forma mais profissional e o que recomendo fazer
logo que você validar que o resto do fluxo está funcionando bem.

---

## 🔁 Como atualizar o app depois (deploys futuros)

Sempre que você (ou eu, com sua ajuda) alterar algo no código:

```bash
git add .
git commit -m "descreva o que mudou"
git push
```

O Railway detecta o push automaticamente e refaz o deploy sozinho — você
não precisa fazer nada manual no painel dele depois da primeira vez.

---

## 🧯 Problemas comuns

**Deploy falha com "Cannot find module"** → confirme que `package.json`
está na raiz do repositório (não dentro de uma subpasta) e que você fez
commit dele.

**App carrega mas dá erro ao gerar sinais** → confira se `ANTHROPIC_API_KEY`
está certa nas Variables do Railway e se sua conta Anthropic tem créditos.

**Assinantes desaparecem depois de um deploy** → o Volume da Parte 4 não
foi configurado corretamente, ou `DB_PATH` não está apontando pra `/data`.

**Webhook da Eduzz falha o teste "Verificar URL"** → confirme que a URL
está exatamente `https://SEU-DOMINIO/webhook/eduzz` (sem barra final,
com `https`) e que o app está realmente no ar (acesse a URL base no
navegador pra confirmar).

**Erro `invalid_signature` em vendas reais** → o `EDUZZ_WEBHOOK_SECRET`
no Railway não é o mesmo que a Eduzz gerou. Volte na tela de configuração
do webhook na Eduzz e copie o secret de novo, com cuidado para não pegar
espaços extras.

---

## 📍 Onde estamos / próximos passos sugeridos

Com este guia, seu sistema já está **funcional e vendável**: login,
proteção por assinatura, webhook automático da Eduzz, e painel admin.

Sugestões de evolução, quando você quiser:
- ✉️ Envio automático de senha por email (Opção 3 acima)
- 🔑 Tela de "esqueci minha senha" self-service
- 📊 Dashboard de métricas (quantos assinantes ativos, churn, etc.)
- 🛡️ Página de termos de uso / política de privacidade (legalmente
  recomendável para qualquer produto pago)
