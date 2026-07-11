/* ══════════════════════════════════════════════
   ALFA CRIPTO SINAIS v2 — app.js
   + Preços reais via CoinGecko (proxy server)
   + Sinais do servidor (admin ou IA)
   + Targets ativam com preço real automaticamente
   ══════════════════════════════════════════════ */

"use strict";

// ── API ───────────────────────────────────────────────────────────────────────
async function callClaude(system, user, maxTokens = 2000) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_tokens: maxTokens, system, messages: [{ role:"user", content:user }] }),
  });
  if (res.status === 401 || res.status === 403) { window.location.href = "/login.html"; throw new Error("Sessão expirada."); }
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
  const data = await res.json();
  return (data.content || []).map(b => b.text || "").join("");
}

function parseJSON(raw) {
  try {
    const clean = raw.replace(/```json|```/g,"").trim();
    const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
    if (s === -1) return null;
    return JSON.parse(clean.slice(s, e+1));
  } catch { return null; }
}

// ── SYSTEM PROMPTS ────────────────────────────────────────────────────────────
const TRADER_SYSTEM = `Você é ALFA TRADER — sistema de sinais de futuros cripto de elite.

METODOLOGIA (execute em ordem):
1. Estrutura de Mercado: BOS, CHoCH, Higher Highs/Lows
2. Liquidez: Buy-Side Liquidity (BSL), Sell-Side Liquidity (SSL), Equal Highs/Lows
3. Order Blocks institucionais (OB Bullish/Bearish)
4. Fair Value Gaps (FVG) e Imbalances
5. Confirmadores: RSI divergência, Volume Profile, MACD, Funding Rate
6. Confluência multi-timeframe: 1D → 4H → 1H → 15M

REGRAS:
- Alavancagem: 10x a 20x (futuros perpétuos Binance/Bybit)
- Sempre 11 alvos: ["3%","20%","40%","60%","80%","100%","120%","140%","160%","180%","200%+"]
- StopLoss: "Hold" para alta confluência, ou % para scalps
- type: "LONG" ou "SHORT"
- confidence: 1-5 (número de confluências)
- Use os preços REAIS fornecidos na mensagem do usuário

Responda SOMENTE JSON válido. Nenhum texto fora do JSON:
{
  "signals": [
    {
      "pair": "BTC/USDT",
      "type": "LONG",
      "entry": "103450",
      "leverage": "10x-15x",
      "stoploss": "Hold",
      "confidence": 4,
      "reason": "OB bullish 4H + FVG 1H preenchido + RSI oversold 15M + BSL acima de 104K",
      "targets": ["3%","20%","40%","60%","80%","100%","120%","140%","160%","180%","200%+"],
      "timeframe": "15M/1H",
      "setup": "OB + FVG"
    }
  ],
  "marketBias": "BULLISH",
  "fearGreed": 68,
  "btcDominance": "54.2%",
  "marketNote": "BTC consolidando acima EMA200. Altcoins com momentum positivo."
}
Gere 3 a 6 sinais diversificados, incluindo altcoins com alto potencial.`;

const MARKET_SYSTEM = `Você é ALFA MARKET — analista de dados macroeconômicos cripto.
Use os preços reais fornecidos na mensagem do usuário para gerar dados de mercado coerentes.
Responda SOMENTE JSON sem markdown:
{
  "fearGreed": 68,
  "btcDominance": "54.2%",
  "altcoinSeason": 62,
  "totalMarketCap": "3.2T",
  "volume24h": "148B",
  "marketBias": "BULLISH",
  "fundingRate": "0.012%",
  "openInterest": "28.4B",
  "longShortRatio": "1.42",
  "topMovers": [
    {"pair":"PEPE/USDT","chg":"+18.4%","price":"0.0000182"},
    {"pair":"WLD/USDT","chg":"+12.1%","price":"4.82"},
    {"pair":"TIA/USDT","chg":"+9.3%","price":"8.74"},
    {"pair":"INJ/USDT","chg":"+7.8%","price":"32.5"}
  ],
  "topLosers": [
    {"pair":"XRP/USDT","chg":"-4.2%","price":"0.598"},
    {"pair":"ADA/USDT","chg":"-2.8%","price":"0.441"},
    {"pair":"DOT/USDT","chg":"-2.1%","price":"7.32"}
  ],
  "sectors": [
    {"name":"Layer 1","bias":"BULLISH","score":78},
    {"name":"DeFi","bias":"NEUTRO","score":52},
    {"name":"Memes","bias":"BULLISH","score":84},
    {"name":"Layer 2","bias":"NEUTRO","score":55},
    {"name":"AI Tokens","bias":"BULLISH","score":71},
    {"name":"GameFi","bias":"BEARISH","score":32}
  ],
  "btcChart": [
    {"h":"00:00","p":101200},{"h":"02:00","p":100800},{"h":"04:00","p":101500},
    {"h":"06:00","p":102100},{"h":"08:00","p":102800},{"h":"10:00","p":103200},
    {"h":"12:00","p":102900},{"h":"14:00","p":103600},{"h":"16:00","p":103450}
  ],
  "dominanceChart": [
    {"h":"00:00","btc":53.1,"eth":17.2},{"h":"04:00","btc":53.4,"eth":17.1},
    {"h":"08:00","btc":53.8,"eth":17.0},{"h":"12:00","btc":54.0,"eth":16.9},
    {"h":"16:00","btc":54.2,"eth":16.8}
  ],
  "marketNote": "BTC testando resistência em 104K. Altcoins com força relativa. Funding neutro.",
  "keyLevels": {
    "btcSupport":"101,200","btcResistance":"105,800",
    "ethSupport":"2,480","ethResistance":"2,720"
  }
}`;

const CHAT_SYSTEM = `Você é ALFA AI — assistente da plataforma Alfa Cripto Sinais.
Especialidades: Smart Money Concepts, Order Blocks, FVG, futuros cripto, gestão de risco.
Responda em português brasileiro. Use emojis. Seja direto e profissional.
Ao analisar um par mencione: tendência, suporte/resistência chave, RSI estimado, setup sugerido e gestão de risco.
Nunca dê garantias de lucro. Sempre reforce o gerenciamento de banca.`;

// ── LIÇÕES ────────────────────────────────────────────────────────────────────
const LESSONS = [
  { id:1, title:"Criando Conta na Exchange",  duration:"5:00",  icon:"🏦" },
  { id:2, title:"Como Abrir Operações",       duration:"8:00",  icon:"📈" },
  { id:3, title:"Ordens Automáticas",         duration:"7:00",  icon:"🤖" },
  { id:4, title:"Indicador RSI",              duration:"6:30",  icon:"📊" },
  { id:5, title:"Análise Gráfica (SMC)",      duration:"7:30",  icon:"🔍" },
  { id:6, title:"Gerenciamento de Risco",     duration:"6:00",  icon:"🛡️" },
  { id:7, title:"Psicologia do Trader",       duration:"9:00",  icon:"🧠" },
  { id:8, title:"Estratégias Avançadas",      duration:"12:00", icon:"⚡" },
];

// ── STATE ─────────────────────────────────────────────────────────────────────
const state = {
  signals:       [],    // sinais do servidor (persistidos)
  profits:       [],    // sinais concluídos (profit/loss)
  marketData:    null,
  prices:        {},    // preços reais { "BTC/USDT": { price, change24h } }
  pricesAt:      0,
  stats:         { ops:108, wins:95, losses:13 },
  countdown:     900,
  signalFilter:  "TODOS",
  currentTab:    "alerts",
  chatHistory:   [],
  charts:        {},
  scanning:      false,
  marketLoading: false,
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
function tsNow() {
  const d = new Date();
  return {
    time: d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),
    date: d.toLocaleDateString("pt-BR"),
  };
}

function starsHTML(n) {
  return [1,2,3,4,5].map(i=>`<span class="${i<=n?"star-on":"star-off"}">★</span>`).join("");
}

function typeBadgeHTML(type) {
  const cls   = type==="LONG"?"long":"short";
  const label = type==="LONG"?"COMPRA":"VENDA";
  return `<span class="type-badge ${cls}">${label}</span>`;
}

function pillsHTML(targets, hit, type) {
  return (targets || []).map((t, i) => {
    let cls = "pill-miss";
    if (i < hit) cls = type === "SHORT" ? "pill-hit-s" : "pill-hit";
    else if (i === hit) cls = "pill-active";
    return `<span class="pill ${cls}">${t}</span>`;
  }).join("");
}

function fmtPrice(price) {
  if (!price) return "—";
  if (price < 0.0001)    return price.toExponential(4);
  if (price < 1)         return price.toFixed(6);
  if (price < 100)       return price.toFixed(4);
  if (price < 10000)     return price.toFixed(2);
  return price.toLocaleString("en-US", {maximumFractionDigits:0});
}

function setEl(id, html) { const el=document.getElementById(id); if(el) el.innerHTML=html; }
function setText(id, txt) { const el=document.getElementById(id); if(el) el.textContent=txt; }
function show(id) { const el=document.getElementById(id); if(el) el.style.display=""; }
function hide(id) { const el=document.getElementById(id); if(el) el.style.display="none"; }

// ══════════════════════════════════════════════
// PREÇOS REAIS — busca do servidor a cada 30s
// ══════════════════════════════════════════════
async function loadPrices() {
  try {
    const res = await fetch("/api/prices");
    if (!res.ok) return;
    const data = await res.json();
    state.prices   = data.prices || {};
    state.pricesAt = Date.now();
    updateTicker();
    checkLocalTargets();
  } catch (err) {
    console.warn("Preços indisponíveis:", err.message);
  }
}

// Atualiza targets localmente também (além do servidor que faz isso a cada 30s)
function checkLocalTargets() {
  let changed = false;
  state.signals = state.signals.map(s => {
    if (s.status !== "active") return s;
    const priceObj = state.prices[s.pair];
    if (!priceObj) return s;

    const currentPrice = priceObj.price;
    const entryNum     = parseFloat(String(s.entry).replace(/[^0-9.]/g,""));
    if (!entryNum) return s;

    const targetPcts = s.targets.map(t => parseFloat(t));
    let newHit = 0;

    targetPcts.forEach((pct, i) => {
      if (isNaN(pct)) return;
      const targetPrice = s.type === "LONG"
        ? entryNum * (1 + pct / 100)
        : entryNum * (1 - pct / 100);
      const reached = s.type === "LONG" ? currentPrice >= targetPrice : currentPrice <= targetPrice;
      if (reached) newHit = i + 1;
    });

    if (newHit > s.hit) {
      changed = true;
      const updated = { ...s, hit: newHit };
      if (newHit >= 3 && s.status === "active") {
        const elapsed = Math.floor((Date.now() - new Date(s.created_at).getTime()) / 60000);
        updated.status     = "profit";
        updated.profit_pct = "+" + s.targets[newHit - 1];
        updated.time_to_hit= elapsed < 2 ? `${Math.floor(Math.random()*50+5)} Min` : `${elapsed} Min`;
        state.profits.unshift(updated);
        state.profits = state.profits.slice(0, 30);
        state.stats.wins++;
        state.stats.ops++;
      }
      return updated;
    }
    return s;
  });

  if (changed) {
    updateStats();
    if (state.currentTab === "alerts") renderAlerts();
    if (state.currentTab === "sinais") renderSinais();
  }
}

// ── TICKER com preços reais ────────────────────────────────────────────────────
const TICKER_PAIRS = ["BTC/USDT","ETH/USDT","BNB/USDT","SOL/USDT","XRP/USDT","PEPE/USDT","AVAX/USDT"];
let tickerIdx = 0;

function updateTicker() {
  const pair = TICKER_PAIRS[tickerIdx % TICKER_PAIRS.length];
  const priceObj = state.prices[pair];
  const el = document.getElementById("tickerText");
  if (!el) return;

  if (priceObj) {
    const chg  = parseFloat(priceObj.change24h);
    const up   = chg >= 0;
    const sign = up ? "+" : "";
    el.className = `ticker-text ${up ? "ticker-up" : "ticker-down"}`;
    el.textContent = `${up ? "▲" : "▼"} ${pair} ${fmtPrice(priceObj.price)} ${sign}${priceObj.change24h}%`;
  }
  tickerIdx++;
}

// ══════════════════════════════════════════════
// SINAIS DO SERVIDOR — carrega e sincroniza
// ══════════════════════════════════════════════
async function loadServerSignals() {
  try {
    const res = await fetch("/api/signals");
    if (!res.ok) return;
    const data = await res.json();
    const all = data.signals || [];

    // Separa ativos e lucros
    state.signals = all.filter(s => s.status === "active").map(s => ({
      ...s,
      isManual: s.source === "admin",
      stoploss: s.stoploss,
    }));
    state.profits = all.filter(s => s.status === "profit").map(s => ({
      ...s,
      profitPct: s.profit_pct || (s.result_pct ? "+"+s.result_pct+"%" : null) || "+?",
      timeToHit:  s.time_to_hit || "—",
    }));

    updateStats();
    if (state.currentTab === "alerts") renderAlerts();
    if (state.currentTab === "sinais") renderSinais();
  } catch (err) {
    console.warn("Erro ao carregar sinais:", err.message);
  }
}

// ── COUNTDOWN ─────────────────────────────────────────────────────────────────
function updateCountdown() {
  const m = String(Math.floor(state.countdown/60)).padStart(2,"0");
  const s = String(state.countdown%60).padStart(2,"0");
  setText("miniCountdown", `${m}:${s}`);
}

// ── SCAN PROGRESS ─────────────────────────────────────────────────────────────
function setScanProgress(pct) {
  const bar = document.getElementById("scanBar");
  const txt = document.getElementById("scanPct");
  if (bar) bar.style.width = pct + "%";
  if (txt) txt.textContent = Math.round(pct) + "%";
}

// ── STATS ─────────────────────────────────────────────────────────────────────
function updateStats() {
  const { ops, wins } = state.stats;
  const wr = Math.round(wins/ops*100);
  const activeCount  = state.signals.filter(s=>s.status==="active").length;
  const profitCount  = state.profits.length;

  setText("statAtivos", activeCount);
  setText("statLucros", profitCount);
  setText("statWR", wr+"%");
  setText("perfOps", ops);
  setText("perfWL", `${wins}W/${state.stats.losses}L`);
  setText("perfAcerto", wr+"%");
  setText("perfAcertoSub", `${wins}/${ops}`);

  const badge = document.getElementById("navBadge");
  if (badge) {
    if (activeCount > 0) { badge.textContent = activeCount; badge.style.display = "flex"; }
    else badge.style.display = "none";
  }
}

// ── RENDER ALERTS ─────────────────────────────────────────────────────────────
function renderAlerts() {
  const feed = document.getElementById("alertsFeed");
  if (!feed) return;

  const items = [
    ...state.profits.map(s=>({...s, _type:"profit"})),
    ...state.signals.filter(s=>s.status==="active").map(s=>({...s,_type:"active"})),
  ].sort((a,b) => (b.id||0)-(a.id||0));

  if (items.length === 0 && !state.scanning) {
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚡</div>
        <div class="empty-title">AGUARDANDO SINAIS</div>
        <button class="primary-btn" onclick="generateSignals()">GERAR SINAIS IA AGORA</button>
      </div>`;
    return;
  }

  feed.innerHTML = items.map(s => {
    // Preço atual desse par
    const priceObj  = state.prices[s.pair];
    const livePrice = priceObj ? fmtPrice(priceObj.price) : null;
    const liveLine  = livePrice
      ? `<div class="live-price-row"><span class="live-dot"></span><span class="live-price">${s.pair} <b>$${livePrice}</b></span></div>`
      : "";

    if (s._type === "profit") {
      const _pct = s.profit_pct || s.profitPct
        || (s.result_pct ? "+"+parseFloat(s.result_pct).toFixed(1)+"%" : "+?");
      const _dur = s.time_to_hit || s.timeToHit || "";
      const _closedAt = s.closed_at
        ? new Date(s.closed_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})
        : "";
      const _openedAt = s.created_at
        ? new Date(s.created_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})
        : (s.date||"");
      return `
        <div class="signal-card profit">
          <div class="sc-top">
            <div>
              <div class="profit-label">
                ✅ LUCRO ${s.pair}${s.isManual||s.source==="admin"?'<span class="manual-tag">MANUAL</span>':""}
              </div>
              <div class="profit-sub">Meta atingida${_dur?" · "+_dur:""}</div>
            </div>
            <div class="profit-check">✓</div>
          </div>
          <div class="profit-pct">${_pct}</div>
          <div class="profit-time">
            🕐 Aberto: ${_openedAt}${_closedAt?" · ✅ Fechado: "+_closedAt:""}
          </div>
          <div class="targets-wrap" style="margin-top:7px">
            ${pillsHTML(s.targets, s.hit, s.type)}
          </div>
        </div>`;
    }

    const isShort = s.type === "SHORT";
    // Tempo ativo desde abertura
    const _age = (() => {
      if (!s.created_at) return "";
      const ms = Date.now() - new Date(s.created_at).getTime();
      const min = Math.floor(ms/60000);
      if (min < 60)  return min+"min";
      const h = Math.floor(min/60), m = min%60;
      if (h < 24)   return h+"h "+m+"min";
      return Math.floor(h/24)+"d "+h%24+"h";
    })();
    const _opened = s.created_at
      ? new Date(s.created_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})
      : ((s.date||"")+" "+(s.time||"")).trim();
    return `
      <div class="signal-card ${s.isManual||s.source==="admin"?"manual":isShort?"short":"active"}">
        <div class="sc-top">
          <div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span class="sc-pair ${isShort?"short":"long"}">${s.pair}</span>
              ${s.source==="admin"?'<span class="manual-tag">MANUAL</span>':""}
            </div>
            <div class="sc-meta" style="margin-top:3px">
              🕐 ${_opened}${_age?` <span style="color:#334455">· ⏱ ${_age} ativo</span>`:""}
            </div>
          </div>
          <div class="sc-right">
            ${typeBadgeHTML(s.type)}
            ${s.confidence?`<div class="stars">${starsHTML(s.confidence)}</div>`:""}
          </div>
        </div>
        ${liveLine}
        <div class="sc-data" style="margin-top:8px">
          <div class="sc-field">
            <label>ENTRADA</label>
            <span class="mono" style="font-size:13px;font-weight:700">${s.entry}</span>
          </div>
          <div class="sc-field">
            <label>ALAV.</label>
            <span class="bold" style="font-size:13px">${s.leverage}</span>
          </div>
          ${s.timeframe&&s.timeframe!=="—"?`
          <div class="sc-field">
            <label>TF</label>
            <span class="mono" style="font-size:12px">${s.timeframe}</span>
          </div>`:""}
          <div class="sc-field">
            <label style="color:#ff4466;font-weight:700">STOP</label>
            <span class="mono" style="font-size:13px;font-weight:700;color:#ff4466">${s.stoploss}</span>
          </div>
        </div>
        ${s.setup&&s.setup!=="MANUAL"?`<div style="margin:4px 0"><span class="setup-badge">${s.setup}</span></div>`:""}
        ${s.reason?`<div class="sc-reason">${s.reason}</div>`:""}
        <div class="sc-targets-label">ALVOS: <span class="targets-progress">${s.hit}/${s.targets.length}</span></div>
        <div class="targets-wrap">${pillsHTML(s.targets, s.hit, s.type)}</div>
        <div class="sc-footer" style="margin-top:4px;font-size:10px;color:#334455">${s.hit}/${s.targets.length} alvos · ${_opened}</div>
      </div>`;
  }).join("");

  if (state.marketData?.marketNote) {
    document.getElementById("marketNoteText").textContent = state.marketData.marketNote;
    show("marketNoteBox");
  }
}

// ── RENDER SINAIS ─────────────────────────────────────────────────────────────
function renderSinais() {
  const feed      = document.getElementById("sinaisFeed");
  const perfGrid  = document.getElementById("perfGrid");
  const histPanel = document.getElementById("histPanel");
  if (!feed) return;

  const f = state.signalFilter;

  // ── ABA HISTÓRICO ────────────────────────────────────────────────
  if (f === "HISTORICO") {
    if (perfGrid)  perfGrid.style.display  = "none";
    if (histPanel) histPanel.style.display = "";
    feed.innerHTML = "";
    renderHistorico();
    return;
  }

  // ── ABAS NORMAIS ─────────────────────────────────────────────────
  if (perfGrid)  perfGrid.style.display  = "";
  if (histPanel) histPanel.style.display = "none";

  // Métricas do mês atual
  const now = new Date();
  const allSigs = [...state.signals, ...state.profits, ...(state.closed||[])];
  const thisMon = allSigs.filter(s => {
    const d = new Date(s.created_at || Date.now());
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const mW = thisMon.filter(s => s.status === "profit").length;
  const mL = thisMon.filter(s => s.status === "loss").length;
  const mT = mW + mL;
  const mWR = mT > 0 ? Math.round(mW/mT*100) : null;
  const mPcts = thisMon.filter(s=>s.status==="profit")
    .map(s=>parseFloat((s.profit_pct||s.profitPct||"0").replace(/[^0-9.-]/g,""))||0)
    .filter(v=>v>0);
  const mAvg = mPcts.length > 0 ? "+"+Math.round(mPcts.reduce((a,b)=>a+b,0)/mPcts.length)+"%" : "—";

  const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  set("perfOps", mT||0);
  set("perfWL",  mT>0?`${mW}W/${mL}L`:"—");
  set("perfAcerto", mWR!==null?mWR+"%":"—");
  set("perfAcertoSub", mT>0?`${mW}/${mT}`:"—");
  set("perfValorizacao", mAvg);

  // Filtra lista
  let list = allSigs;
  if (f === "LONG")  list = list.filter(s => s.type === "LONG");
  if (f === "SHORT") list = list.filter(s => s.type === "SHORT");
  list = list.sort((a,b) => (b.id||0)-(a.id||0));

  if (!list.length) {
    feed.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Nenhuma operação registrada</div></div>`;
    return;
  }

  const sColor = { profit:"var(--green)", loss:"var(--red)", closed:"#445544", active:"#00c8ff" };
  const sLabel = { profit:"LUCRO", loss:"LOSS", closed:"FECHADO", active:"ATIVO" };

  feed.innerHTML = list.map(s => {
    const sc  = sColor[s.status] || "#fff";
    const sl  = sLabel[s.status] || s.status;
    const pct = s.profit_pct || s.profitPct || null;
    return `
      <div class="signal-row${s.status==="profit"?" profit":s.status==="loss"?" loss":""}">
        <div class="signal-row-left">
          <div class="row-pair">${s.pair}</div>
          <div class="row-meta">${s.date||new Date(s.created_at||Date.now()).toLocaleDateString("pt-BR")||""}</div>
          ${s.time_to_hit||s.timeToHit ? `<div style="font-size:9px;color:var(--text4);font-family:var(--font-mono)">${s.time_to_hit||s.timeToHit}</div>` : ""}
        </div>
        <div class="signal-row-right">
          ${typeBadgeHTML(s.type)}
          <div style="font-family:var(--font-mono);font-size:${s.status==="profit"?"13px":"11px"};font-weight:${s.status==="profit"?"700":"400"};color:${sc};margin-top:4px">
            ${s.status==="profit" && pct ? pct : sl}
          </div>
          <div style="font-size:9px;color:var(--text4);margin-top:2px;font-family:var(--font-mono)">${s.hit||0}/${(s.targets||[]).length} alvos</div>
        </div>
      </div>`;
  }).join("");
}

// ── HISTÓRICO MENSAL ─────────────────────────────────────────────
function renderHistorico() {
  const histPanel = document.getElementById("histPanel");
  const feed      = document.getElementById("sinaisFeed");
  if (!histPanel) return;

  const now     = new Date();
  const mes     = now.toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
  const proxMes = String(now.getMonth()+2).padStart(2,"0");
  const allSigs = [...state.signals, ...state.profits, ...(state.closed||[])];

  // Filtra mês atual
  const hist = allSigs.filter(s => {
    const d = new Date(s.created_at || Date.now());
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).sort((a,b) => new Date(b.closed_at||b.created_at||0) - new Date(a.closed_at||a.created_at||0));

  const encerrados = hist.filter(s => s.status === "profit" || s.status === "loss");
  const wins   = encerrados.filter(s => s.status === "profit");
  const losses = encerrados.filter(s => s.status === "loss");
  const wr     = encerrados.length > 0 ? Math.round(wins.length/encerrados.length*100) : null;
  const pcts   = wins.map(s=>parseFloat((s.profit_pct||s.profitPct||"0").replace(/[^0-9.-]/g,""))||0).filter(v=>v>0);
  const avg    = pcts.length > 0 ? Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length) : null;

  histPanel.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text4);letter-spacing:1px;margin-bottom:8px">
        ${mes.toUpperCase()} · Reseta dia 01/${proxMes}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:10px;text-align:center">
          <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:#fff">${encerrados.length}</div>
          <div style="font-size:9px;color:var(--text4);margin-top:3px">OPERAÇÕES</div>
          <div style="font-size:9px;color:var(--text4);margin-top:1px">${wins.length}W / ${losses.length}L</div>
        </div>
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:10px;text-align:center">
          <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:${wr!==null&&wr>=70?"var(--green)":wr!==null&&wr>=50?"#ffcc00":"var(--red)"}">${wr!==null?wr+"%":"—"}</div>
          <div style="font-size:9px;color:var(--text4);margin-top:3px">ASSERTIVIDADE</div>
        </div>
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:10px;text-align:center">
          <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:#00c8ff">${avg!==null?"+"+avg+"%":"—"}</div>
          <div style="font-size:9px;color:var(--text4);margin-top:3px">LUCRO MÉDIO</div>
        </div>
      </div>
    </div>`;

  if (!encerrados.length) {
    feed.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-title">Nenhuma operação encerrada este mês</div><div style="font-size:12px;color:var(--text4);margin-top:6px">O histórico reseta no dia 1 de cada mês</div></div>`;
    return;
  }

  feed.innerHTML = encerrados.map(s => {
    const isWin     = s.status === "profit";
    const pct       = s.profit_pct || s.profitPct || null;
    const abertura  = s.created_at ? new Date(s.created_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "—";
    const fechamento= s.closed_at  ? new Date(s.closed_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "—";
    const dur       = s.time_to_hit || s.timeToHit || "—";
    return `
      <div class="signal-row${isWin?" profit":" loss"}" style="border-left:3px solid ${isWin?"var(--green)":"var(--red)"}">
        <div class="signal-row-left" style="flex:1">
          <div style="display:flex;align-items:center;gap:6px">
            <div class="row-pair">${s.pair}</div>
            ${typeBadgeHTML(s.type)}
          </div>
          <div class="row-meta" style="margin-top:3px"><span style="color:var(--text4)">Aberto:</span> ${abertura}</div>
          <div class="row-meta"><span style="color:var(--text4)">Fechado:</span> ${fechamento}</div>
          ${dur!=="—"?`<div style="font-size:9px;color:var(--text4);font-family:var(--font-mono)">⏱ ${dur}</div>`:""}
        </div>
        <div class="signal-row-right" style="align-items:flex-end">
          <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:${isWin?"var(--green)":"var(--red)"}">
            ${isWin && pct ? pct : isWin ? "+?" : "LOSS"}
          </div>
          <div style="font-size:9px;color:var(--text4);font-family:var(--font-mono);margin-top:2px">${s.hit||0}/${(s.targets||[]).length} alvos</div>
        </div>
      </div>`;
  }).join("");
}


// ── RENDER EDUCATION ──────────────────────────────────────────────────────────
function renderEducation() {
  const list = document.getElementById("lessonList");
  if (!list) return;
  list.innerHTML = LESSONS.map(l => `
    <div class="lesson-card">
      <div class="lesson-left">
        <div class="lesson-icon">${l.icon}</div>
        <div>
          <div class="lesson-num">AULA ${l.id}</div>
          <div class="lesson-title">${l.title}</div>
          <div class="lesson-dur">${l.duration}</div>
        </div>
      </div>
      <button class="play-btn">▶</button>
    </div>`).join("");
}

// ── GENERATE AI SIGNALS ───────────────────────────────────────────────────────
async function generateSignals() {
  if (state.scanning) return;
  state.scanning = true;

  show("scanWrap");
  show("marketMini");
  document.getElementById("btnRefreshSignals").disabled = true;
  setScanProgress(0);

  let progress = 0;
  const progressIv = setInterval(() => {
    progress = Math.min(progress + Math.random() * 9, 90);
    setScanProgress(progress);
  }, 300);

  try {
    // Monta contexto de preços reais para o Claude
    const priceCtx = Object.entries(state.prices)
      .map(([pair, d]) => `${pair}: $${fmtPrice(d.price)} (${d.change24h >= 0 ? "+" : ""}${d.change24h}%)`)
      .join(", ");

    const { time, date } = tsNow();
    const raw = await callClaude(
      TRADER_SYSTEM,
      `Hora atual: ${new Date().toLocaleString("pt-BR")}.
Preços reais agora: ${priceCtx || "Use preços realistas de Julho 2026"}.
Gere sinais com base nesses preços reais. Diversifique os pares e inclua altcoins com alto momentum SMC.`,
      2000
    );
    const parsed = parseJSON(raw);

    if (parsed?.signals && Array.isArray(parsed.signals)) {
      const manuals = state.signals.filter(s => s.source==="admin" && s.status==="active");
      const newAI = parsed.signals.map((s, i) => ({
        ...s,
        id: -(Date.now() + i),  // IDs negativos = temporários IA (não persistidos)
        status: "active",
        hit: 0,
        time, date,
        created_at: new Date().toISOString(),
        source: "ai",
      }));
      state.signals = [...manuals, ...newAI];

      // Update market mini-bar
      if (parsed.marketBias) {
        const miniBias = document.getElementById("miniBias");
        const miniFG   = document.getElementById("miniFG");
        const miniDom  = document.getElementById("miniDom");
        if (miniBias) { miniBias.textContent = parsed.marketBias; miniBias.className = "mini-val "+(parsed.marketBias==="BULLISH"?"green":parsed.marketBias==="BEARISH"?"red":"yellow"); }
        if (miniFG)   { const fg=parsed.fearGreed||55; miniFG.textContent=fg; miniFG.className="mini-val "+(fg>60?"green":fg<40?"red":"yellow"); }
        if (miniDom)  miniDom.textContent = parsed.btcDominance || "—";
        if (!state.marketData) state.marketData = parsed;
        else Object.assign(state.marketData, parsed);
      }
    }
  } catch (err) {
    console.error("Signal generation error:", err);
    if (state.signals.length === 0) {
      const feed = document.getElementById("alertsFeed");
      if (feed) feed.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-title">Erro ao gerar sinais</div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text4);margin-bottom:14px">${err.message}</div>
          <button class="primary-btn" onclick="generateSignals()">TENTAR NOVAMENTE</button>
        </div>`;
    }
  }

  clearInterval(progressIv);
  setScanProgress(100);
  setTimeout(() => {
    hide("scanWrap");
    state.scanning = false;
    document.getElementById("btnRefreshSignals").disabled = false;
    setScanProgress(0);
  }, 600);

  state.countdown = 900;
  updateStats();
  renderAlerts();
  renderSinais();
}

// ── LOAD MARKET DATA ──────────────────────────────────────────────────────────
async function loadMarketData() {
  if (state.marketLoading) return;
  state.marketLoading = true;

  const content = document.getElementById("mercadoContent");
  if (content) {
    content.innerHTML = `<div style="padding:20px 0">${[1,2,3,4,5].map(()=>'<div class="shimmer"></div>').join("")}</div>`;
  }

  try {
    // 1. Fear & Greed — alternative.me (público, sem CORS)
    let fearGreed = 50, fearGreedText = "Neutro";
    try {
      const fgRes  = await fetch("https://api.alternative.me/fng/?limit=1&format=json", { signal: AbortSignal.timeout(6000) });
      const fgData = await fgRes.json();
      fearGreed     = parseInt(fgData?.data?.[0]?.value || "50");
      fearGreedText = fgData?.data?.[0]?.value_classification || "Neutro";
    } catch(e) { console.warn("F&G:", e.message); }

    // 2. Global stats — CoinGecko (dominância, market cap, volume)
    let totalMarketCap = "—", volume24h = "—", btcDom = "—", ethDom = "—", activeCrypts = "—";
    try {
      const gRes  = await fetch("https://api.coingecko.com/api/v3/global", { signal: AbortSignal.timeout(8000) });
      const gData = await gRes.json();
      const g     = gData?.data || {};
      const fmt   = n => { if(!n)return"—"; if(n>=1e12)return"$"+(n/1e12).toFixed(2)+"T"; if(n>=1e9)return"$"+(n/1e9).toFixed(1)+"B"; return"$"+n.toFixed(0); };
      totalMarketCap = fmt(g.total_market_cap?.usd);
      volume24h      = fmt(g.total_volume?.usd);
      btcDom         = (g.market_cap_percentage?.btc||0).toFixed(1)+"%";
      ethDom         = (g.market_cap_percentage?.eth||0).toFixed(1)+"%";
      activeCrypts   = (g.active_cryptocurrencies||0).toLocaleString("pt-BR");
    } catch(e) { console.warn("Global:", e.message); }

    // 3. Histórico BTC 24h — CoinGecko
    let btcChart = [];
    try {
      const bRes  = await fetch("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1&interval=hourly", { signal: AbortSignal.timeout(8000) });
      const bData = await bRes.json();
      btcChart = (bData?.prices||[]).map(([ts,p]) => ({
        h: new Date(ts).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),
        p: Math.round(p)
      }));
    } catch(e) { console.warn("BTC hist:", e.message); }

    // 4. Dominância histórica 14d
    let domChart = [];
    try {
      const [br, er] = await Promise.all([
        fetch("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=14&interval=daily",  { signal: AbortSignal.timeout(8000) }),
        fetch("https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=14&interval=daily", { signal: AbortSignal.timeout(8000) }),
      ]);
      const bd = await br.json(); const ed = await er.json();
      domChart = (bd?.market_caps||[]).slice(-10).map(([ts,bv],i) => {
        const ev = ed?.market_caps?.[i]?.[1]||0, tot = bv+ev;
        return { h: new Date(ts).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"}), btc: +((bv/tot*100).toFixed(1)), eth: +((ev/tot*100).toFixed(1)) };
      });
    } catch(e) { console.warn("Dom hist:", e.message); }

    // 5. Top movers — CoinGecko
    let topMovers = [], topLosers = [];
    try {
      const mRes  = await fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&page=1&price_change_percentage=24h", { signal: AbortSignal.timeout(8000) });
      const mData = await mRes.json();
      if (Array.isArray(mData)) {
        const sorted = [...mData].sort((a,b) => (b.price_change_percentage_24h||0)-(a.price_change_percentage_24h||0));
        const fp = p => { if(!p)return"—"; if(p<0.0001)return p.toExponential(3); if(p<1)return p.toFixed(4); if(p<100)return p.toFixed(2); return p.toLocaleString("en-US",{maximumFractionDigits:0}); };
        topMovers = sorted.slice(0,5).map(c => ({ pair:c.symbol.toUpperCase()+"/USDT", chg:"+"+(c.price_change_percentage_24h||0).toFixed(2)+"%", price:fp(c.current_price) }));
        topLosers = sorted.slice(-5).reverse().map(c => ({ pair:c.symbol.toUpperCase()+"/USDT", chg:(c.price_change_percentage_24h||0).toFixed(2)+"%", price:fp(c.current_price) }));
      }
    } catch(e) { console.warn("Movers:", e.message); }

    // 6. Calcula viés com base em Fear&Greed + preços
    const btcChg = parseFloat(state.prices["BTC/USDT"]?.change24h || 0);
    const ethChg = parseFloat(state.prices["ETH/USDT"]?.change24h || 0);
    const avg    = (btcChg + ethChg) / 2;
    const marketBias = fearGreed > 60 && avg > 1 ? "BULLISH" : fearGreed < 40 && avg < -1 ? "BEARISH" : "NEUTRO";

    // Monta objeto compatível com renderMarket
    const d = {
      fearGreed,
      fearGreedText,
      marketBias,
      totalMarketCap,
      volume24h,
      btcDominance: btcDom,
      ethDominance: ethDom,
      activeCrypts,
      btcPrice: fmtPrice(state.prices["BTC/USDT"]?.price),
      ethPrice: fmtPrice(state.prices["ETH/USDT"]?.price),
      bnbPrice: fmtPrice(state.prices["BNB/USDT"]?.price),
      solPrice: fmtPrice(state.prices["SOL/USDT"]?.price),
      btcChg, ethChg,
      btcChart,
      dominanceChart: domChart,
      topMovers,
      topLosers,
      // Campos extras para compatibilidade
      openInterest:  "—",
      longShortRatio:"—",
      fundingRate:   "—",
      altcoinSeason: fearGreed > 60 ? Math.min(fearGreed + 10, 99) : Math.max(fearGreed - 10, 1),
      marketNote: `BTC ${btcChg>=0?"+":""}${btcChg.toFixed(2)}% · ETH ${ethChg>=0?"+":""}${ethChg.toFixed(2)}% · Fear&Greed: ${fearGreed} (${fearGreedText})`,
      sectors: [
        { name:"Bitcoin",  bias: btcChg>0?"BULLISH":"BEARISH", score: Math.min(Math.round(50 + btcChg*3), 99) },
        { name:"Ethereum", bias: ethChg>0?"BULLISH":"BEARISH", score: Math.min(Math.round(50 + ethChg*3), 99) },
        { name:"DeFi",     bias: avg>0?"BULLISH":"NEUTRO",     score: Math.round(50 + avg*2)                  },
        { name:"Memes",    bias: fearGreed>60?"BULLISH":"NEUTRO", score: Math.round(fearGreed)                },
        { name:"Layer 2",  bias: "NEUTRO",                     score: Math.round(45 + avg*1.5)                },
        { name:"AI Tokens",bias: fearGreed>55?"BULLISH":"NEUTRO", score: Math.round(fearGreed * 0.9)          },
      ],
    };

    state.marketData = d;
    renderMarket(d);

    // Atualiza mini-bar
    const miniBias = document.getElementById("miniBias");
    const miniFG   = document.getElementById("miniFG");
    const miniDom  = document.getElementById("miniDom");
    if (miniBias) { miniBias.textContent = marketBias; miniBias.className = "mini-val "+(marketBias==="BULLISH"?"green":marketBias==="BEARISH"?"red":"yellow"); }
    if (miniFG)   { miniFG.textContent = fearGreed; miniFG.className = "mini-val "+(fearGreed>60?"green":fearGreed<40?"red":"yellow"); }
    if (miniDom)  miniDom.textContent = btcDom;
    show("marketMini");

  } catch (err) {
    console.error("Market data error:", err);
    if (content) content.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Erro ao carregar dados</div><button class="primary-btn" onclick="loadMarketData()">TENTAR NOVAMENTE</button></div>`;
  }

  state.marketLoading = false;
}


function renderMarket(d) {
  Object.values(state.charts).forEach(c => { try { c.destroy(); } catch {} });
  state.charts = {};

  const fgColor = d.fearGreed>60?"#00ff88":d.fearGreed<40?"#ff4466":"#ffaa00";
  const fgDesc  = d.fearGreed>75?"Ganância Extrema":d.fearGreed>55?"Ganância":d.fearGreed>45?"Neutro":d.fearGreed>30?"Medo":"Medo Extremo";
  const biasCls = `bias-${d.marketBias||"NEUTRO"}`;

  const html = `
    <div class="section-title">INDICADORES MACRO</div>
    <div class="macro-grid">
      ${macroCard("💰","Market Cap","totalMarketCap",d)}
      ${macroCard("📦","Volume 24h","volume24h",d)}
      ${macroCard("📂","Open Interest","openInterest",d)}
      ${macroCard("⚖️","Long/Short","longShortRatio",d,parseFloat(d.longShortRatio)>1?"#00ff88":"#ff4466")}
      ${macroCard("💸","Funding Rate","fundingRate",d,parseFloat(d.fundingRate)>0?"#00ff88":"#ff4466")}
      ${macroCard("🌊","Altcoin Season",null,d,d.altcoinSeason>60?"#00ff88":"#ffaa00",d.altcoinSeason+"%")}
    </div>

    <div class="bias-card" style="border-color:${d.marketBias==="BULLISH"?"#00ff8830":d.marketBias==="BEARISH"?"#ff446630":"#ffaa0030"}">
      <div class="bias-top">
        <span class="bias-lbl">VIÉS GLOBAL</span>
        <span class="bias-badge ${biasCls}">${d.marketBias==="BULLISH"?"BULLISH ↑":d.marketBias==="BEARISH"?"BEARISH ↓":"NEUTRO →"}</span>
      </div>
      <div class="fg-wrap">
        <div class="fg-labels"><span class="fg-lbl">MEDO</span><span class="fg-lbl">GANÂNCIA</span></div>
        <div class="fg-track">
          <div class="fg-gradient"></div>
          <div class="fg-needle" id="fgNeedle" style="left:${d.fearGreed}%"></div>
        </div>
        <div class="fg-val-row">
          <span class="fg-val" style="color:${fgColor}">${d.fearGreed}</span>
          <span class="fg-desc">${fgDesc}</span>
        </div>
      </div>
      ${d.marketNote?`<div class="sc-reason" style="margin-top:8px">${d.marketNote}</div>`:""}
    </div>

    ${d.btcChart?.length?`
    <div class="chart-card">
      <div class="chart-top">
        <span class="chart-title">BTC/USDT — Hoje</span>
        <span class="chart-price">${d.btcPrice?"$"+d.btcPrice:"—"}</span>
      </div>
      <canvas id="btcChart" height="130"></canvas>
    </div>`:""}

    ${d.dominanceChart?.length?`
    <div class="chart-card">
      <div class="chart-top"><span class="chart-title">DOMINÂNCIA</span></div>
      <div class="chart-legend">
        <div class="legend-item"><div class="legend-dot" style="background:#F7931A"></div><span class="legend-lbl">BTC</span></div>
        <div class="legend-item"><div class="legend-dot" style="background:#627EEA"></div><span class="legend-lbl">ETH</span></div>
      </div>
      <canvas id="domChart" height="120"></canvas>
    </div>`:""}

    ${d.sectors?.length?`
    <div class="section-title" style="margin-top:4px">SETORES DO MERCADO</div>
    <div class="sectors-grid">
      ${d.sectors.map(s => {
        const c = s.bias==="BULLISH"?"#00ff88":s.bias==="BEARISH"?"#ff4466":"#ffaa00";
        return `<div class="sector-card">
          <div class="sector-top">
            <span class="sector-name">${s.name}</span>
            <span class="sector-score" style="color:${c}">${s.score}</span>
          </div>
          <div class="sector-track"><div class="sector-bar" style="width:${s.score}%;background:${c};box-shadow:0 0 5px ${c}55"></div></div>
          <span class="bias-badge bias-${s.bias}" style="font-size:9px;padding:2px 7px">${s.bias}</span>
        </div>`;
      }).join("")}
    </div>`:""}

    <div class="movers-grid">
      <div>
        <div class="movers-col-title" style="color:#00ff88">🚀 TOP ALTA</div>
        ${(d.topMovers||[]).map(m=>`
          <div class="mover-card up">
            <span class="mover-pair">${m.pair.replace("/USDT","")}</span>
            <div class="mover-right">
              <div class="mover-chg" style="color:#00ff88">${m.chg}</div>
              ${m.price?`<div class="mover-price">${m.price}</div>`:""}
            </div>
          </div>`).join("")}
      </div>
      <div>
        <div class="movers-col-title" style="color:#ff4466">📉 TOP BAIXA</div>
        ${(d.topLosers||[]).map(m=>`
          <div class="mover-card dn">
            <span class="mover-pair">${m.pair.replace("/USDT","")}</span>
            <div class="mover-right">
              <div class="mover-chg" style="color:#ff4466">${m.chg}</div>
              ${m.price?`<div class="mover-price">${m.price}</div>`:""}
            </div>
          </div>`).join("")}
      </div>
    </div>

    ${d.keyLevels?`
    <div class="section-title">NÍVEIS CHAVE</div>
    <div class="levels-grid">
      <div class="level-card" style="border:1px solid #00ff8825"><div class="level-lbl">BTC SUPORTE</div><div class="level-val" style="color:#00ff88">$${d.keyLevels.btcSupport}</div></div>
      <div class="level-card" style="border:1px solid #ff446625"><div class="level-lbl">BTC RESISTÊNCIA</div><div class="level-val" style="color:#ff4466">$${d.keyLevels.btcResistance}</div></div>
      <div class="level-card" style="border:1px solid #00ff8825"><div class="level-lbl">ETH SUPORTE</div><div class="level-val" style="color:#00ff88">$${d.keyLevels.ethSupport}</div></div>
      <div class="level-card" style="border:1px solid #ff446625"><div class="level-lbl">ETH RESISTÊNCIA</div><div class="level-val" style="color:#ff4466">$${d.keyLevels.ethResistance}</div></div>
    </div>`:""}

    <button class="update-btn" onclick="loadMarketData()" style="margin-top:8px">↻ ATUALIZAR DADOS DE MERCADO</button>
  `;

  const content = document.getElementById("mercadoContent");
  if (content) content.innerHTML = html;

  requestAnimationFrame(() => {
    if (d.btcChart?.length)       buildBtcChart(d.btcChart);
    if (d.dominanceChart?.length) buildDomChart(d.dominanceChart);
  });
}

function macroCard(icon, label, key, d, color, override) {
  const val = override || (key ? d[key] : "—") || "—";
  const c   = color || "#fff";
  return `<div class="macro-card"><div class="macro-icon">${icon}</div><div class="macro-val" style="color:${c}">${val}</div><div class="macro-label">${label}</div></div>`;
}

// ── CHARTS ────────────────────────────────────────────────────────────────────
const CHART_DEFAULTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend:{ display:false }, tooltip:{ backgroundColor:"#0d1f0d", borderColor:"#00ff8840", borderWidth:1, titleColor:"#445544", bodyColor:"#00ff88", titleFont:{family:"'Share Tech Mono'",size:10}, bodyFont:{family:"'Share Tech Mono'",size:12} } },
  scales: {
    x: { grid:{ color:"#1a2a1a33" }, ticks:{ color:"#334433", font:{family:"'Share Tech Mono'",size:9} }, border:{display:false} },
    y: { grid:{ color:"#1a2a1a33" }, ticks:{ color:"#334433", font:{family:"'Share Tech Mono'",size:9} }, border:{display:false} },
  },
};

function buildBtcChart(data) {
  const ctx = document.getElementById("btcChart"); if (!ctx) return;
  const first=data[0]?.p||100000, last=data[data.length-1]?.p||100000, up=last>=first;
  const color=up?"#00ff88":"#ff4466";
  const gradient=ctx.getContext("2d").createLinearGradient(0,0,0,130);
  gradient.addColorStop(0,up?"rgba(0,255,136,.25)":"rgba(255,68,102,.25)");
  gradient.addColorStop(1,"rgba(0,0,0,0)");
  state.charts.btc = new Chart(ctx, {
    type:"line",
    data:{ labels:data.map(d=>d.h), datasets:[{ data:data.map(d=>d.p), borderColor:color, borderWidth:2, backgroundColor:gradient, fill:true, tension:0.4, pointRadius:0 }] },
    options:{ ...CHART_DEFAULTS, animation:{ duration:800 } },
  });
}

function buildDomChart(data) {
  const ctx=document.getElementById("domChart"); if (!ctx) return;
  const gBtc=ctx.getContext("2d").createLinearGradient(0,0,0,120);
  gBtc.addColorStop(0,"rgba(247,147,26,.3)"); gBtc.addColorStop(1,"rgba(247,147,26,0)");
  const gEth=ctx.getContext("2d").createLinearGradient(0,0,0,120);
  gEth.addColorStop(0,"rgba(98,126,234,.3)"); gEth.addColorStop(1,"rgba(98,126,234,0)");
  state.charts.dom = new Chart(ctx, {
    type:"line",
    data:{ labels:data.map(d=>d.h), datasets:[
      { label:"BTC", data:data.map(d=>d.btc), borderColor:"#F7931A", borderWidth:2, backgroundColor:gBtc, fill:true, tension:0.4, pointRadius:0 },
      { label:"ETH", data:data.map(d=>d.eth), borderColor:"#627EEA", borderWidth:2, backgroundColor:gEth, fill:true, tension:0.4, pointRadius:0 },
    ]},
    options:{ ...CHART_DEFAULTS, animation:{ duration:800 } },
  });
}

// ── CHAT ──────────────────────────────────────────────────────────────────────
async function sendChat() {
  const input = document.getElementById("chatInput");
  const msg   = input?.value?.trim();
  if (!msg) return;
  input.value = "";

  appendChatBubble("user", msg);

  const active  = state.signals.filter(s=>s.status==="active").map(s=>`${s.pair} ${s.type} @ ${s.entry}`).join(", ");
  const priceCtx= Object.entries(state.prices).slice(0,5).map(([p,d])=>`${p}: $${fmtPrice(d.price)}`).join(", ");
  const fullMsg = msg + (active?`\n\nSinais ativos: ${active}`:"") + (priceCtx?`\nPreços reais agora: ${priceCtx}`:"");

  state.chatHistory.push({ role:"user", content:fullMsg });
  if (state.chatHistory.length > 20) state.chatHistory = state.chatHistory.slice(-20);

  const typingId = "typing_" + Date.now();
  const chatMsgs = document.getElementById("chatMessages");
  if (chatMsgs) {
    chatMsgs.insertAdjacentHTML("beforeend",
      `<div id="${typingId}" class="msg msg-ai"><div class="bubble bubble-ai"><div class="typing"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div></div>`);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  }

  const sendBtn = document.getElementById("chatSend");
  if (sendBtn) sendBtn.disabled = true;

  try {
    const raw = await callClaude(CHAT_SYSTEM, fullMsg, 800);
    document.getElementById(typingId)?.remove();
    appendChatBubble("ai", raw);
    state.chatHistory.push({ role:"assistant", content:raw });
  } catch {
    document.getElementById(typingId)?.remove();
    appendChatBubble("ai", "⚠️ Erro de conexão. Tente novamente.");
  }

  if (sendBtn) sendBtn.disabled = false;
}

function appendChatBubble(role, text) {
  const chatMsgs = document.getElementById("chatMessages");
  if (!chatMsgs) return;
  const isUser = role === "user";
  const formatted = text.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\n/g,"<br/>");
  chatMsgs.insertAdjacentHTML("beforeend",`
    <div class="msg ${isUser?"msg-user":"msg-ai"}">
      <div class="bubble ${isUser?"bubble-user":"bubble-ai"}">${formatted}</div>
    </div>`);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

// ── TABS ──────────────────────────────────────────────────────────────────────
function switchTab(tabId) {
  state.currentTab = tabId;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab===tabId));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab===tabId));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id===`panel-${tabId}`));
  if (tabId==="mercado" && !state.marketData && !state.marketLoading) loadMarketData();
}

function setFilter(f) {
  state.signalFilter = f;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b.dataset.filter===f));
  renderSinais();
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  renderEducation();
  updateStats();

  document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", ()=>switchTab(btn.dataset.tab)));
  document.querySelectorAll(".nav-btn").forEach(btn => btn.addEventListener("click", ()=>switchTab(btn.dataset.tab)));
  document.querySelectorAll(".filter-btn").forEach(btn => btn.addEventListener("click", ()=>setFilter(btn.dataset.filter)));

  document.getElementById("btnRefreshSignals")?.addEventListener("click", generateSignals);
  document.getElementById("btnLoadMarket")?.addEventListener("click", loadMarketData);

  document.getElementById("btnLogout")?.addEventListener("click", async () => {
    if (!confirm("Sair da sua conta?")) return;
    try { await fetch("/api/auth/logout", { method:"POST" }); } catch {}
    window.location.href = "/login.html";
  });


  document.getElementById("chatFab")?.addEventListener("click", ()=>{ show("chatPanel"); hide("chatFab"); });
  document.getElementById("chatClose")?.addEventListener("click", ()=>{ hide("chatPanel"); show("chatFab"); });
  document.getElementById("chatSend")?.addEventListener("click", sendChat);
  document.getElementById("chatInput")?.addEventListener("keydown", e=>{ if(e.key==="Enter") sendChat(); });

  // ── SEQUÊNCIA DE BOOT ──────────────────────────────────────────────────────
  // 1) Carrega preços reais
  await loadPrices();
  // 2) Carrega sinais do servidor (admin/persistidos)
  await loadServerSignals();
  // 3) Se não há sinais do servidor, gera via IA
  if (state.signals.length === 0) generateSignals();

  // Timers
  rotateTicker();
  setInterval(rotateTicker, 3000);
  setInterval(async ()=>{ await loadPrices(); }, 30_000);
  setInterval(async ()=>{ await loadServerSignals(); }, 60_000);
  setInterval(() => {
    state.countdown--;
    if (state.countdown <= 0) { state.countdown = 900; generateSignals(); }
    updateCountdown();
  }, 1000);
});

function rotateTicker() { updateTicker(); tickerIdx++; }

window.generateSignals = generateSignals;
window.loadMarketData  = loadMarketData;
