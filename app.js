
const APP_VERSION = "v2.1";
const STORAGE_KEY = "stockRecordAppV1";
const DEFAULT_DATA = {
  trades: [], cashEntries: [], fxRates: [], exchanges: [], prices: {}, snapshots: [],
  ui: { holdingSort: "symbol", holdingSortDir: "asc", marketFilter: "all", chartRange: "all" },
  settings: { feeRate: 0.001425, minFee: 20, stockTaxRate: 0.003, etfTaxRate: 0.001, darkMode: false, fontSize: "medium", backupReminderDays: 14, lastBackupAt: "" }
};
let data = loadData();
const $ = id => document.getElementById(id);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const today = () => new Date().toISOString().slice(0,10);
const escapeHtml = (s="") => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = (n,d=2) => Number(n||0).toLocaleString("zh-TW",{maximumFractionDigits:d});
const money = (n,c="TWD") => new Intl.NumberFormat("zh-TW",{style:"currency",currency:c,maximumFractionDigits:c==="USD"?2:0}).format(Number(n||0));
const keyOf = (market,symbol) => `${market}:${String(symbol||"").trim().toUpperCase()}`;
const currencyOfMarket = market => market==="US" ? "USD" : "TWD";
const pnlClass = n => n===null||n===undefined||Number(n)===0 ? "pnl-neutral" : Number(n)>0 ? "pnl-positive" : "pnl-negative";
const formatDateTime = iso => !iso ? "尚未更新" : new Date(iso).toLocaleString("zh-TW",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});

const SYMBOL_CACHE_KEY = "stockRecordSymbolDbV20";
const BUILTIN_SYMBOL_VERSION = "2026-06-10";
let symbolDb = {TW:[],US:[]};
let symbolMeta = {loadedAt:"",source:"內建離線名單"};

function mergeSymbolLists(...lists){
  const map=new Map();
  lists.flat().filter(Boolean).forEach(item=>{
    if(!item?.symbol||!item?.name)return;
    const normalized={symbol:String(item.symbol).trim().toUpperCase(),name:String(item.name).trim(),market:item.market==="US"?"US":"TW",exchange:item.exchange||"",type:item.type==="etf"?"etf":"stock"};
    map.set(`${normalized.market}:${normalized.symbol}`,normalized);
  });
  return [...map.values()];
}
function readSymbolCache(){
  try{return JSON.parse(localStorage.getItem(SYMBOL_CACHE_KEY)||"null");}catch{return null;}
}
function saveSymbolCache(){
  localStorage.setItem(SYMBOL_CACHE_KEY,JSON.stringify({updatedAt:new Date().toISOString(),TW:symbolDb.TW,US:symbolDb.US}));
}
async function loadSymbolDb(){
  try{
    const [tw,us]=await Promise.all([
      fetch("./symbols-tw.json").then(r=>{if(!r.ok)throw new Error("TW symbols");return r.json();}),
      fetch("./symbols-us.json").then(r=>{if(!r.ok)throw new Error("US symbols");return r.json();})
    ]);
    const cache=readSymbolCache();
    symbolDb.TW=mergeSymbolLists(tw,cache?.TW||[]).filter(x=>x.market==="TW");
    symbolDb.US=mergeSymbolLists(us,cache?.US||[]).filter(x=>x.market==="US");
    symbolMeta={loadedAt:cache?.updatedAt||BUILTIN_SYMBOL_VERSION,source:cache?"內建名單＋已保存更新":"內建離線名單"};
  }catch{
    const cache=readSymbolCache();
    symbolDb={TW:cache?.TW||[],US:cache?.US||[]};
    symbolMeta={loadedAt:cache?.updatedAt||"",source:cache?"已保存名單":"載入失敗，可手動輸入"};
  }
  renderSymbolListStatus();
}
function renderSymbolListStatus(){
  const el=$("symbolListStatus");if(!el)return;
  el.textContent=`${symbolMeta.source} · 台股 ${symbolDb.TW.length.toLocaleString("zh-TW")} 筆 · 美股 ${symbolDb.US.length.toLocaleString("zh-TW")} 筆${symbolMeta.loadedAt?` · 更新：${String(symbolMeta.loadedAt).slice(0,10)}`:""}`;
}
function findSymbolMatches(query,market=$("market")?.value||"TW"){
  const q=String(query||"").trim().toUpperCase();
  if(!q)return [];
  const list=symbolDb[market]||[];
  return list.map(item=>{
    const symbol=item.symbol.toUpperCase(),name=item.name.toUpperCase();
    let score=99;
    if(symbol===q)score=0;
    else if(symbol.startsWith(q))score=1;
    else if(name===q)score=2;
    else if(name.includes(q))score=3;
    else if(symbol.includes(q))score=4;
    return {item,score};
  }).filter(x=>x.score<99).sort((a,b)=>a.score-b.score||a.item.symbol.localeCompare(b.item.symbol,undefined,{numeric:true})).slice(0,8).map(x=>x.item);
}
function symbolLabel(item){return `${item.exchange||item.market} · ${item.type==="etf"?"ETF":"股票"}`;}
function selectSymbol(market,symbol){
  const item=(symbolDb[market]||[]).find(x=>x.symbol===symbol);if(!item)return;
  $("market").value=item.market;$("symbol").value=item.symbol;$("name").value=item.name;$("assetType").value=item.type;
  $("symbolSuggestions").classList.add("hidden");updateTradeUI();
}
window.selectSymbol=selectSymbol;
function renderSymbolSuggestions(query){
  const box=$("symbolSuggestions");if(!box)return;
  const list=findSymbolMatches(query);
  if(!query.trim()){box.classList.add("hidden");box.innerHTML="";return;}
  if(!list.length){box.innerHTML='<div class="empty" style="padding:11px 12px">找不到符合項目，仍可手動輸入代號與名稱。</div>';box.classList.remove("hidden");return;}
  box.innerHTML=list.map(item=>`<button type="button" class="symbol-suggestion" onclick="selectSymbol('${item.market}','${escapeHtml(item.symbol)}')"><span class="symbol-suggestion-main"><span class="symbol-suggestion-symbol">${escapeHtml(item.symbol)}</span><div class="symbol-suggestion-name">${escapeHtml(item.name)}</div></span><span class="symbol-suggestion-meta">${escapeHtml(symbolLabel(item))}</span></button>`).join("");
  box.classList.remove("hidden");
}
function autoFillExactSymbol(value){
  const symbol=String(value||"").trim().toUpperCase();
  if(!symbol)return;
  const item=(symbolDb[$("market").value]||[]).find(x=>x.symbol===symbol);
  if(item){$("symbol").value=item.symbol;$("name").value=item.name;$("assetType").value=item.type;}
}
async function refreshOfficialSymbols(){
  const button=$("refreshSymbols");button.disabled=true;button.textContent="更新中…";
  let twAdded=0,usAdded=0,notes=[];
  try{
    const rows=await fetch("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL").then(r=>{if(!r.ok)throw new Error("TWSE");return r.json();});
    const official=rows.map(row=>({symbol:String(row.Code||row.code||"").trim(),name:String(row.Name||row.name||"").trim(),market:"TW",exchange:"TWSE",type:/^00/.test(String(row.Code||""))?"etf":"stock"})).filter(x=>x.symbol&&x.name);
    twAdded=official.length;symbolDb.TW=mergeSymbolLists(symbolDb.TW,official).filter(x=>x.market==="TW");
  }catch{notes.push("台股官方更新失敗，保留原名單");}
  try{
    const [nasdaq,other]=await Promise.all([
      fetch("https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt").then(r=>{if(!r.ok)throw new Error("NASDAQ");return r.text();}),
      fetch("https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt").then(r=>{if(!r.ok)throw new Error("OTHER");return r.text();})
    ]);
    const parsePipe=(text,isNasdaq)=>text.split(/\r?\n/).slice(1).map(line=>line.split("|")).filter(cols=>cols.length>5&&!String(cols[0]).startsWith("File Creation Time")).map(cols=>({symbol:String(cols[0]||"").trim(),name:String(cols[1]||"").trim(),market:"US",exchange:isNasdaq?"NASDAQ":String(cols[2]||"US"),type:String(isNasdaq?cols[6]:cols[4]).trim()==="Y"?"etf":"stock"})).filter(x=>x.symbol&&x.name);
    const official=mergeSymbolLists(parsePipe(nasdaq,true),parsePipe(other,false));usAdded=official.length;symbolDb.US=official.filter(x=>x.market==="US");
  }catch{notes.push("美股線上更新失敗，保留內建 Nasdaq 名單");}
  symbolMeta={loadedAt:new Date().toISOString(),source:"已嘗試官方更新"};saveSymbolCache();renderSymbolListStatus();button.disabled=false;button.textContent="更新股票名單";
  alert(`股票名單更新完成。\n台股官方資料：${twAdded.toLocaleString("zh-TW")} 筆\n美股官方資料：${usAdded.toLocaleString("zh-TW")} 筆${notes.length?`\n\n${notes.join("\n")}`:""}`);
}
function officialNameMismatch(t){
  const item=(symbolDb[t.market]||[]).find(x=>x.symbol===t.symbol);
  return item&&item.name!==t.name ? item : null;
}

const daysSince = iso => !iso ? null : Math.floor((Date.now()-new Date(iso).getTime())/86400000);
function renderBackupReminder(){
  const card=$("backupReminderCard"),days=Number(data.settings.backupReminderDays||0),elapsed=daysSince(data.settings.lastBackupAt);
  if(!days){card.classList.add("hidden");return;}
  if(elapsed===null||elapsed>=days){card.classList.remove("hidden");$("backupReminderText").textContent=elapsed===null?"尚未匯出過 JSON 備份，建議先建立備份。":`距離上次備份已經 ${elapsed} 天，建議重新匯出 JSON 備份。`;}
  else card.classList.add("hidden");
}

function cloneDefault(){return JSON.parse(JSON.stringify(DEFAULT_DATA));}
function deriveLegacyExchanges(saved){
  const entries=Array.isArray(saved?.cashEntries)?saved.cashEntries:[];
  const rates=Array.isArray(saved?.fxRates)?saved.fxRates:[];
  const groups=[...new Set(entries.map(e=>e.exchangeGroupId).filter(Boolean))];
  return groups.map(group=>{
    const linked=entries.filter(e=>e.exchangeGroupId===group);
    const expense=linked.find(e=>e.type==="otherExpense");
    const income=linked.find(e=>e.type==="otherIncome");
    if(!expense||!income)return null;
    const direction=expense.currency==="TWD"&&income.currency==="USD"?"TWD_TO_USD":"USD_TO_TWD";
    const rateRow=rates.find(x=>x.exchangeGroupId===group);
    const fromAmount=Number(expense.amount||0);
    const toAmount=Number(income.amount||0);
    const quotedRate=direction==="TWD_TO_USD"?(toAmount?fromAmount/toAmount:0):(fromAmount?toAmount/fromAmount:0);
    return {
      id:group,date:expense.date||income.date,direction,
      fromCurrency:expense.currency,toCurrency:income.currency,
      fromAmount,toAmount,fee:0,feeCurrency:expense.currency,
      quotedRate:Number(rateRow?.rate||quotedRate),
      effectiveRate:Number(rateRow?.rate||quotedRate),
      note:"由 v1.8 換匯紀錄升級（舊版未分離手續費）",
      createdAt:Number(expense.createdAt||income.createdAt||Date.now()),
      migratedFromV18:true
    };
  }).filter(Boolean);
}
function migrate(saved){
  const result = {
    trades: Array.isArray(saved?.trades) ? saved.trades.map(t=>({...t,market:t.market||"TW",currency:t.currency||currencyOfMarket(t.market||"TW"),symbol:String(t.symbol||"").toUpperCase()})) : [],
    cashEntries: Array.isArray(saved?.cashEntries) ? saved.cashEntries.map(e=>({...e,currency:e.currency||"TWD"})) : [],
    fxRates: Array.isArray(saved?.fxRates) ? saved.fxRates : [],
    exchanges: Array.isArray(saved?.exchanges) ? saved.exchanges : deriveLegacyExchanges(saved),
    prices: {}, snapshots: Array.isArray(saved?.snapshots) ? saved.snapshots : [],
    ui: {...DEFAULT_DATA.ui,...(saved?.ui||{})},
    settings:{...DEFAULT_DATA.settings,...(saved?.settings||{})}
  };
  Object.entries(saved?.prices||{}).forEach(([k,v])=>{
    const nk=k.includes(":")?k:`TW:${k}`;
    result.prices[nk]= typeof v==="object" ? v : {price:Number(v),updatedAt:saved?.priceUpdatedAt?.[k]||""};
  });
  return result;
}
function loadData(){try{return migrate(JSON.parse(localStorage.getItem(STORAGE_KEY))||cloneDefault());}catch{return cloneDefault();}}
function saveData(){localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}
function localDateKey(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function releaseFocus(){document.activeElement?.blur?.();window.scrollTo({top:0,left:0,behavior:"auto"});}
function navTo(page){releaseFocus();document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===page));document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.nav===page));}
document.querySelectorAll("[data-nav]").forEach(b=>b.addEventListener("click",()=>navTo(b.dataset.nav)));

function estimatedFee(amount,market){return market==="TW"?Math.max(Number(data.settings.minFee||0),Math.round(amount*Number(data.settings.feeRate||0))):0;}
function estimatedTax(amount,market,assetType){if(market!=="TW")return 0;return Math.round(amount*Number(assetType==="etf"?data.settings.etfTaxRate:data.settings.stockTaxRate));}
function normalizeTrade(t){
  const market=t.market||"TW", currency=t.currency||currencyOfMarket(market), amount=Number(t.price||0)*Number(t.shares||0);
  return {...t,market,currency,symbol:String(t.symbol||"").toUpperCase(),price:Number(t.price||0),shares:Number(t.shares||0),
    fee:t.fee===""||t.fee===undefined||t.fee===null?estimatedFee(amount,market):Number(t.fee||0),
    tax:t.type==="sell"?(t.tax===""||t.tax===undefined||t.tax===null?estimatedTax(amount,market,t.assetType):Number(t.tax||0)):0};
}
function sortedTrades(list=data.trades){return [...list].sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.createdAt||0)-Number(b.createdAt||0));}
function latestFxRate(date=null){
  const list=[...data.fxRates].filter(x=>!date||x.date<=date).sort((a,b)=>b.date.localeCompare(a.date)||Number(b.createdAt||0)-Number(a.createdAt||0));
  if(list.length)return {rate:Number(list[0].rate),estimated:false,date:list[0].date};
  const fallback=[...data.fxRates].sort((a,b)=>b.date.localeCompare(a.date)||Number(b.createdAt||0)-Number(a.createdAt||0))[0];
  return fallback?{rate:Number(fallback.rate),estimated:true,date:fallback.date}:{rate:0,estimated:true,date:""};
}
function calculatePortfolio(trades=data.trades){
  const map={},realized={TWD:0,USD:0};
  for(const raw of sortedTrades(trades)){
    const t=normalizeTrade(raw),key=keyOf(t.market,t.symbol),amount=t.price*t.shares;
    if(!map[key])map[key]={key,market:t.market,currency:t.currency,symbol:t.symbol,name:t.name,assetType:t.assetType,shares:0,costNative:0,realizedNative:0};
    const h=map[key];h.name=t.name;h.assetType=t.assetType;
    if(t.type==="buy"){h.shares+=t.shares;h.costNative+=amount+t.fee;}
    else{const sell=Math.min(t.shares,h.shares),ratio=t.shares?sell/t.shares:0,avg=h.shares?h.costNative/h.shares:0,gain=amount*ratio-t.fee*ratio-t.tax*ratio-avg*sell;h.shares-=sell;h.costNative-=avg*sell;h.realizedNative+=gain;realized[t.currency]+=gain;if(h.shares<1e-9){h.shares=0;h.costNative=0;}}
  }
  const fx=latestFxRate();
  const holdings=Object.values(map).filter(h=>h.shares>0).map(h=>{
    const p=data.prices[h.key],has=!!p&&p.price!==""&&p.price!==null&&p.price!==undefined;
    const currentPrice=has?Number(p.price):null,avg=h.costNative/h.shares,marketValueNative=has?currentPrice*h.shares:null,estimatedMarketValueNative=has?marketValueNative:h.costNative,unrealizedNative=has?marketValueNative-h.costNative:null,returnRate=has&&h.costNative?unrealizedNative/h.costNative:null;
    return {...h,avgCostNative:avg,hasCurrentPrice:has,currentPrice,priceUpdatedAt:p?.updatedAt||"",marketValueNative,estimatedMarketValueNative,unrealizedNative,returnRate,marketValueTWD:(marketValueNative??estimatedMarketValueNative)*(h.currency==="USD"?fx.rate:1)};
  });
  return {holdings,map,realized,fx};
}
function validateInventoryTimeline(trades){
  const inv={};
  for(const raw of sortedTrades(trades)){const t=normalizeTrade(raw),k=keyOf(t.market,t.symbol);inv[k]=(inv[k]||0)+(t.type==="buy"?t.shares:-t.shares);if(inv[k]<-1e-9)return {ok:false,trade:t,available:inv[k]+t.shares};}
  return {ok:true};
}
function tradeCashSigned(raw){const t=normalizeTrade(raw),amount=t.price*t.shares;return t.type==="buy"?-(amount+t.fee):(amount-t.fee-t.tax);}
function manualCashSigned(e){return ["deposit","dividend","otherIncome"].includes(e.type)?Number(e.amount||0):-Number(e.amount||0);}
function calculateCash(){
  const result={TWD:0,USD:0};
  data.cashEntries.forEach(e=>result[e.currency||"TWD"]+=manualCashSigned(e));
  data.trades.forEach(t=>{const n=normalizeTrade(t);result[n.currency]+=tradeCashSigned(n);});
  return result;
}
function calculateDividends(){const r={TWD:0,USD:0};data.cashEntries.filter(e=>e.type==="dividend").forEach(e=>r[e.currency||"TWD"]+=Number(e.amount||0));return r;}


function calculateUsdFxCostSummary(){
  const pool={trackedUsd:0,untrackedUsd:0,twdCost:0};
  const consumeUsd=amount=>{
    amount=Math.max(0,Number(amount||0));
    const total=pool.trackedUsd+pool.untrackedUsd;
    if(!(amount>0)||!(total>0))return;
    const trackedConsume=Math.min(pool.trackedUsd,amount*(pool.trackedUsd/total));
    const untrackedConsume=Math.min(pool.untrackedUsd,amount-trackedConsume);
    const avg=pool.trackedUsd>0?pool.twdCost/pool.trackedUsd:0;
    pool.trackedUsd=Math.max(0,pool.trackedUsd-trackedConsume);
    pool.untrackedUsd=Math.max(0,pool.untrackedUsd-untrackedConsume);
    pool.twdCost=Math.max(0,pool.twdCost-avg*trackedConsume);
    const remainder=amount-trackedConsume-untrackedConsume;
    if(remainder>0&&pool.trackedUsd>0){
      const extra=Math.min(pool.trackedUsd,remainder);
      const nextAvg=pool.trackedUsd>0?pool.twdCost/pool.trackedUsd:0;
      pool.trackedUsd-=extra;pool.twdCost=Math.max(0,pool.twdCost-nextAvg*extra);
    }
  };
  const events=[];
  data.exchanges.forEach((x,index)=>events.push({kind:"exchange",date:x.date,createdAt:Number(x.createdAt||0),order:index,payload:x}));
  data.cashEntries.filter(e=>(e.currency||"TWD")==="USD"&&!e.exchangeGroupId).forEach((e,index)=>events.push({kind:"cash",date:e.date,createdAt:Number(e.createdAt||0),order:100000+index,payload:e}));
  data.trades.filter(t=>(t.currency||currencyOfMarket(t.market||"TW"))==="USD").forEach((t,index)=>events.push({kind:"trade",date:t.date,createdAt:Number(t.createdAt||0),order:200000+index,payload:t}));
  events.sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.createdAt-b.createdAt||a.order-b.order);
  for(const event of events){
    if(event.kind==="exchange"){
      const x=event.payload;
      if(x.direction==="TWD_TO_USD"){
        pool.trackedUsd+=Number(x.toAmount||0);
        pool.twdCost+=Number(x.fromAmount||0)+Number(x.fee||0);
      }else{
        consumeUsd(Number(x.fromAmount||0)+Number(x.fee||0));
      }
    }else if(event.kind==="cash"){
      const e=event.payload,amount=Number(e.amount||0);
      if(["deposit","dividend","otherIncome"].includes(e.type))pool.untrackedUsd+=amount;
      else consumeUsd(amount);
    }else{
      const t=normalizeTrade(event.payload),amount=t.price*t.shares;
      if(t.type==="buy")consumeUsd(amount+t.fee);
      else pool.untrackedUsd+=Math.max(0,amount-t.fee-t.tax);
    }
  }
  const actualUsd=calculateCash().USD;
  const calculated=pool.trackedUsd+pool.untrackedUsd;
  const diff=actualUsd-calculated;
  if(diff>0)pool.untrackedUsd+=diff;
  else if(diff<0)consumeUsd(-diff);
  return {
    trackedUsd:pool.trackedUsd,
    untrackedUsd:pool.untrackedUsd,
    twdCost:pool.twdCost,
    averageRate:pool.trackedUsd>0?pool.twdCost/pool.trackedUsd:null,
    actualUsd
  };
}
function currentSnapshot(){
  const p=calculatePortfolio(),cash=calculateCash(),fx=p.fx,tw=p.holdings.filter(h=>h.currency==="TWD").reduce((s,h)=>s+h.estimatedMarketValueNative,0),us=p.holdings.filter(h=>h.currency==="USD").reduce((s,h)=>s+h.estimatedMarketValueNative,0);
  return {date:localDateKey(),capturedAt:new Date().toISOString(),availableTWD:cash.TWD,availableUSD:cash.USD,marketTWD:tw,marketUSD:us,fxRate:fx.rate,totalTWD:cash.TWD+tw+(cash.USD+us)*fx.rate,isEstimated:p.holdings.some(h=>!h.hasCurrentPrice)||fx.estimated,source:"snapshot"};
}
function upsertTodaySnapshot(){const s=currentSnapshot(),i=data.snapshots.findIndex(x=>x.date===s.date);if(i>=0)data.snapshots[i]=s;else data.snapshots.push(s);data.snapshots.sort((a,b)=>a.date.localeCompare(b.date));saveData();}
function buildHistoricalPoints(){
  const events=new Map(),add=(date,obj,kind)=>{if(!date)return;if(!events.has(date))events.set(date,[]);events.get(date).push({kind,obj,createdAt:Number(obj.createdAt||0)});};
  data.cashEntries.forEach(e=>add(e.date,e,"cash"));data.trades.forEach(t=>add(t.date,t,"trade"));data.fxRates.forEach(x=>add(x.date,x,"fx"));
  const snap=new Map((data.snapshots||[]).map(x=>[x.date,x]));
  const dates=[...new Set([...events.keys(),...snap.keys()])].sort(),state={cash:{TWD:0,USD:0},holdings:{}},points=[];
  for(const date of dates){
    for(const e of (events.get(date)||[]).sort((a,b)=>a.createdAt-b.createdAt)){
      if(e.kind==="cash")state.cash[e.obj.currency||"TWD"]+=manualCashSigned(e.obj);
      if(e.kind==="trade"){const t=normalizeTrade(e.obj),k=keyOf(t.market,t.symbol),amt=t.price*t.shares;if(!state.holdings[k])state.holdings[k]={shares:0,cost:0,currency:t.currency};const h=state.holdings[k];state.cash[t.currency]+=tradeCashSigned(t);if(t.type==="buy"){h.shares+=t.shares;h.cost+=amt+t.fee;}else{const sell=Math.min(t.shares,h.shares),avg=h.shares?h.cost/h.shares:0;h.shares-=sell;h.cost-=avg*sell;if(h.shares<1e-9){h.shares=0;h.cost=0;}}}
    }
    const s=snap.get(date),fx=latestFxRate(date),holdingTWD=Object.values(state.holdings).filter(h=>h.currency==="TWD").reduce((a,h)=>a+h.cost,0),holdingUSD=Object.values(state.holdings).filter(h=>h.currency==="USD").reduce((a,h)=>a+h.cost,0);
    if(s)points.push({...s,date,totalTWD:Number(s.totalTWD??(s.availableTWD+s.marketTWD+(s.availableUSD+s.marketUSD)*Number(s.fxRate||fx.rate))),fxRate:Number(s.fxRate||fx.rate),source:"snapshot"});
    else points.push({date,availableTWD:state.cash.TWD,availableUSD:state.cash.USD,marketTWD:holdingTWD,marketUSD:holdingUSD,fxRate:fx.rate,totalTWD:state.cash.TWD+holdingTWD+(state.cash.USD+holdingUSD)*fx.rate,isEstimated:true,fxEstimated:fx.estimated,source:"reconstructed"});
  }
  return points;
}
function rangeStart(r){if(r==="all")return null;const n=new Date();if(r==="ytd")return `${n.getFullYear()}-01-01`;n.setDate(n.getDate()-Number(r)+1);return localDateKey(n);}
function filteredPoints(){const start=rangeStart(data.ui.chartRange||"all");return buildHistoricalPoints().filter(x=>!start||x.date>=start);}
function compact(n){const a=Math.abs(Number(n||0));return a>=1e8?`${(n/1e8).toFixed(a>=1e9?0:1)} 億`:a>=1e4?`${(n/1e4).toFixed(a>=1e5?0:1)} 萬`:Math.round(n).toLocaleString("zh-TW");}
function shortDate(d){const [y,m,day]=d.split("-");return ["1825","3650","all"].includes(String(data.ui.chartRange))?`${y}/${Number(m)}`:`${Number(m)}/${Number(day)}`;}
function showPoint(i){const p=(window.chartPoints||[])[i];if(!p)return;$("assetChartDetail").innerHTML=`<strong>${p.date}</strong><br>折合台幣總資產：${money(p.totalTWD)}<br>台幣資金：${money(p.availableTWD)}<br>美元資金：${money(p.availableUSD,"USD")}<br>美元匯率：${p.fxRate?`1 USD = NT$${fmt(p.fxRate,4)}`:"尚未設定"}<br>資料狀態：<span class="${p.isEstimated?"chart-estimate-note":""}">${p.isEstimated?"部分估算":"已記錄"}</span>`;}
window.showPoint=showPoint;
function renderChart(){
  const all=filteredPoints(),pts=all.length>100?all.filter((_,i)=>i===0||i===all.length-1||i%Math.ceil(all.length/100)===0):all;window.chartPoints=pts;
  document.querySelectorAll(".chart-range").forEach(b=>b.classList.toggle("active",b.dataset.range===String(data.ui.chartRange||"all")));
  if(!pts.length){$("assetChartSvg").innerHTML="";$("assetChartEmpty").classList.remove("hidden");return;}
  $("assetChartEmpty").classList.add("hidden");const w=720,h=280,pad={l:18,r:88,t:26,b:42},vals=pts.map(p=>Number(p.totalTWD||0));let min=Math.min(...vals),max=Math.max(...vals);if(min===max){min-=Math.max(1,Math.abs(min)*.05);max+=Math.max(1,Math.abs(max)*.05);}
  const x=i=>pad.l+(pts.length===1?(w-pad.l-pad.r)/2:i*(w-pad.l-pad.r)/(pts.length-1)),y=v=>pad.t+(max-v)*(h-pad.t-pad.b)/(max-min),coords=pts.map((p,i)=>[x(i),y(p.totalTWD)]),line=coords.map(([a,b],i)=>`${i?"L":"M"} ${a.toFixed(1)} ${b.toFixed(1)}`).join(" "),area=`${line} L ${coords.at(-1)[0]} ${h-pad.b} L ${coords[0][0]} ${h-pad.b} Z`;
  const grids=Array.from({length:5},(_,i)=>{const r=i/4,v=max-(max-min)*r,gy=pad.t+(h-pad.t-pad.b)*r;return `<line class="chart-grid" x1="${pad.l}" y1="${gy}" x2="${w-pad.r}" y2="${gy}"/><text class="chart-y-label" text-anchor="end" x="${w-5}" y="${gy+5}">${compact(v)}</text>`}).join("");
  const labelIdx=[0,Math.round((pts.length-1)/2),pts.length-1].filter((v,i,a)=>a.indexOf(v)===i),labels=labelIdx.map((i,pos)=>`<text class="chart-axis-label" text-anchor="${pos===0?"start":pos===labelIdx.length-1?"end":"middle"}" x="${x(i)}" y="${h-10}">${shortDate(pts[i].date)}</text>`).join("");
  const dots=coords.map(([a,b],i)=>`<circle class="${pts[i].isEstimated?"chart-dot-estimated":"chart-dot"}" cx="${a}" cy="${b}" r="${i===pts.length-1?6:4}" onclick="showPoint(${i})"/>`).join("");
  $("assetChartSvg").innerHTML=`${grids}<line class="chart-axis-line" x1="${w-pad.r}" y1="${pad.t}" x2="${w-pad.r}" y2="${h-pad.b}"/><path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/>${dots}${labels}`;
  const first=all[0].totalTWD,last=all.at(-1).totalTWD,chg=last-first;$("assetChartSummary").innerHTML=`目前 ${money(last)} · 區間變化 <strong class="${pnlClass(chg)}">${chg>=0?"+":""}${money(chg)}</strong>`;showPoint(pts.length-1);
}

function render(){
  document.documentElement.classList.toggle("dark",!!data.settings.darkMode);document.body.classList.toggle("dark",!!data.settings.darkMode);document.documentElement.dataset.fontSize=data.settings.fontSize||"medium";$("themeToggle").textContent=data.settings.darkMode?"☀":"☾";
  const p=calculatePortfolio(),cash=calculateCash(),div=calculateDividends(),fx=p.fx,tw=p.holdings.filter(h=>h.currency==="TWD").reduce((s,h)=>s+h.estimatedMarketValueNative,0),us=p.holdings.filter(h=>h.currency==="USD").reduce((s,h)=>s+h.estimatedMarketValueNative,0),total=cash.TWD+tw+(cash.USD+us)*fx.rate;
  $("homeFxRate").textContent=fx.rate?`1 USD = NT$${fmt(fx.rate,4)}`:"1 USD = NT$—";$("homeFxUpdated").textContent=fx.date?`最近匯率日期：${fx.date}${fx.estimated?"（估算使用）":""}`:"尚未設定匯率";
  const usdCost=calculateUsdFxCostSummary();
  $("totalAssetsTWD").textContent=money(total);$("availableTWD").textContent=money(cash.TWD);$("availableUSD").textContent=money(cash.USD,"USD");$("availableUSDConverted").textContent=`折合 ${money(cash.USD*fx.rate)}`;$("marketTWD").textContent=money(tw);$("marketUSD").textContent=money(us,"USD");$("marketUSDConverted").textContent=`折合 ${money(us*fx.rate)}`;$("dividendTWD").textContent=money(div.TWD);$("dividendUSD").textContent=money(div.USD,"USD");$("fundsTWD").textContent=money(cash.TWD);$("fundsUSD").textContent=money(cash.USD,"USD");
  $("avgUsdFxCost").textContent=usdCost.averageRate===null?"尚無資料":`1 USD = NT$${fmt(usdCost.averageRate,4)}`;
  $("trackedUsdAmount").textContent=money(usdCost.trackedUsd,"USD");
  $("untrackedUsdAmount").textContent=money(usdCost.untrackedUsd,"USD");
  const updated=p.holdings.filter(h=>h.hasCurrentPrice).length;$("completenessText").innerHTML=p.holdings.length?`已更新 <strong>${updated}/${p.holdings.length}</strong> 檔股價。${fx.rate?"":"<span class='warning'>尚未設定美元匯率。</span>"}`:"尚無持股。";
  $("dashboardHoldings").innerHTML=p.holdings.length?p.holdings.slice(0,4).map(holdingRow).join(""):"尚無持股。";renderHoldings();renderHistory();renderFunds();renderChart();syncSettings();renderBackupReminder();
}
function holdingRow(h){const cur=h.currency,price=h.hasCurrentPrice?fmt(h.currentPrice,4):'<span class="price-missing">尚未更新</span>',mv=h.hasCurrentPrice?money(h.marketValueNative,cur):"—",pnl=h.hasCurrentPrice?money(h.unrealizedNative,cur):"—",rate=h.hasCurrentPrice?`${(h.returnRate*100).toFixed(2)}%`:"—";return `<div class="holding-table-row" onclick="openDetail('${h.key}')"><div><div class="stock-name">${escapeHtml(h.name)}</div><div class="stock-code">${escapeHtml(h.symbol)} · ${h.market}</div><button class="update-price-mini" onclick="event.stopPropagation();openPrice('${h.key}')">更新股價</button></div><div class="number-cell"><div class="cell-main">${fmt(h.shares,6)}</div><div class="cell-sub">${money(h.avgCostNative,cur)}</div></div><div class="number-cell"><div class="cell-main">${mv}</div><div class="cell-sub">${price}</div></div><div class="number-cell"><div class="cell-main ${pnlClass(h.unrealizedNative)}">${pnl}</div><div class="cell-sub ${pnlClass(h.returnRate)}">${rate}</div></div></div>`;}
function renderHoldings(){const p=calculatePortfolio(),m=data.ui.marketFilter||"all",sort=data.ui.holdingSort||"symbol",dir=data.ui.holdingSortDir==="desc"?-1:1,list=p.holdings.filter(h=>m==="all"||h.market===m).sort((a,b)=>sort==="symbol"?a.symbol.localeCompare(b.symbol)*dir:(Number(a[sort]??-Infinity)-Number(b[sort]??-Infinity))*dir);$("holdingsList").innerHTML=list.length?list.map(holdingRow).join(""):"尚無持股。";document.querySelectorAll(".table-sort").forEach(b=>b.classList.toggle("active",b.dataset.sort===sort));}
window.openDetail=k=>{const h=calculatePortfolio().holdings.find(x=>x.key===k);if(!h)return;$("holdingDetailContent").innerHTML=`<h2>${escapeHtml(h.name)} ${escapeHtml(h.symbol)}</h2><p class="helper">${h.market==="US"?"美股 · 美元":"台股 · 台幣"}</p><div class="detail-grid"><div class="detail-stat"><span>目前持有</span><strong>${fmt(h.shares,6)}</strong></div><div class="detail-stat"><span>平均成本</span><strong>${money(h.avgCostNative,h.currency)}</strong></div><div class="detail-stat"><span>目前股價</span><strong>${h.hasCurrentPrice?money(h.currentPrice,h.currency):"尚未更新"}</strong></div><div class="detail-stat"><span>市值</span><strong>${h.hasCurrentPrice?money(h.marketValueNative,h.currency):"—"}</strong></div></div>`;navTo("holdingDetail");};
window.openPrice=k=>{const h=calculatePortfolio().holdings.find(x=>x.key===k);if(!h)return;$("priceKey").value=k;$("currentPrice").value=data.prices[k]?.price??"";$("priceDialogTitle").textContent=`更新 ${h.symbol} ${h.name} 現價（${h.currency}）`;$("priceDialog").showModal();};
function renderHistory(){
  const q=$("search").value.trim().toLowerCase(),m=$("historyMarket").value;
  const list=[...data.trades].filter(t=>(m==="all"||(t.market||"TW")===m)&&(!q||String(t.symbol).toLowerCase().includes(q)||String(t.name).toLowerCase().includes(q))).sort((a,b)=>b.date.localeCompare(a.date));
  $("historyList").innerHTML=list.length?list.map(t=>{const n=normalizeTrade(t);return `<div class="list-item"><div class="item-top"><span class="symbol">${n.market} · ${escapeHtml(n.symbol)} ${escapeHtml(n.name)}</span><strong>${n.type==="buy"?"買進":"賣出"}</strong></div><div class="meta">${n.date} · ${fmt(n.shares,6)} 股 · ${money(n.price,n.currency)} · 手續費 ${money(n.fee,n.currency)}${n.tax?` · 稅 ${money(n.tax,n.currency)}`:""}</div><div class="item-actions"><button onclick="editTrade('${n.id}')">編輯</button><button onclick="deleteTrade('${n.id}')">刪除</button></div></div>`}).join(""):"尚無交易紀錄。";
}
window.editTrade=id=>{
  const t=data.trades.find(x=>x.id===id);if(!t)return;navTo("trade");$("editId").value=t.id;$("market").value=t.market||"TW";$("type").value=t.type;$("assetType").value=t.assetType;$("symbol").value=t.symbol;$("name").value=t.name;$("date").value=t.date;$("price").value=t.price;$("shares").value=t.shares;$("fee").value=t.fee;$("tax").value=t.tax;$("note").value=t.note||"";$("tradeFormTitle").textContent="編輯交易";$("cancelEdit").classList.remove("hidden");updateTradeUI();
};
window.deleteTrade=id=>{
  if(!confirm("確定刪除這筆交易嗎？"))return;
  const candidate=data.trades.filter(x=>x.id!==id),check=validateInventoryTimeline(candidate);
  if(!check.ok)return alert("刪除後會造成後續賣出超過庫存，無法刪除。");
  data.trades=candidate;saveData();upsertTodaySnapshot();render();
};
function cashTypeLabel(t){return ({deposit:"資金存入",withdrawal:"資金提領",dividend:"現金股利",otherIncome:"其他收入",otherExpense:"其他支出"})[t]||t;}
function exchangeDirectionLabel(direction){return direction==="TWD_TO_USD"?"台幣換美元":"美元換台幣";}
function exchangeByGroup(group){return data.exchanges.find(x=>x.id===group);}
function renderFunds(){
  const manual=data.cashEntries.map(e=>{
    const linked=e.exchangeGroupId?exchangeByGroup(e.exchangeGroupId):null;
    const rateLine=linked?`<div class="exchange-rate-line">換匯匯率：${fmt(linked.effectiveRate,4)} · ${exchangeDirectionLabel(linked.direction)}</div>`:"";
    const actions=linked?`<div class="item-actions"><button onclick="deleteExchange('${linked.id}')">刪除整筆換匯</button></div>`:`<div class="item-actions"><button onclick="editCash('${e.id}')">編輯</button><button onclick="deleteCash('${e.id}')">刪除</button></div>`;
    return {date:e.date,createdAt:Number(e.createdAt||0),html:`<div class="list-item"><div class="item-top"><span>${e.date} · ${e.currency} · ${cashTypeLabel(e.type)}</span><strong class="${pnlClass(manualCashSigned(e))}">${money(manualCashSigned(e),e.currency)}</strong></div><div class="meta">${escapeHtml(e.note||"")}</div>${rateLine}${actions}</div>`};
  });
  const trades=data.trades.map(r=>{const t=normalizeTrade(r),signed=tradeCashSigned(t);return {date:t.date,createdAt:Number(t.createdAt||0),html:`<div class="list-item"><div class="item-top"><span>${t.date} · ${t.currency} · ${t.type==="buy"?"股票買進":"股票賣出"} · ${escapeHtml(t.symbol)}</span><strong class="${pnlClass(signed)}">${money(signed,t.currency)}</strong></div><div class="meta">由交易紀錄自動產生</div></div>`}});
  const list=[...manual,...trades].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);
  $("cashLedgerList").innerHTML=list.length?list.map(x=>x.html).join(""):"尚無資金異動。";
  const fx=[...data.fxRates].sort((a,b)=>b.date.localeCompare(a.date)||Number(b.createdAt||0)-Number(a.createdAt||0));
  $("fxList").innerHTML=fx.length?fx.slice(0,12).map(x=>`<div class="list-item"><div class="item-top"><span>${x.date}</span><strong>1 USD = NT$${fmt(x.rate,4)}</strong></div><div class="meta">${escapeHtml(x.note||"")}</div><div class="item-actions">${x.exchangeGroupId?`<button onclick="deleteExchange('${x.exchangeGroupId}')">刪除整筆換匯</button>`:`<button onclick="deleteFx('${x.id}')">刪除</button>`}</div></div>`).join(""):"尚未設定匯率。";
  const exchanges=[...data.exchanges].sort((a,b)=>b.date.localeCompare(a.date)||Number(b.createdAt||0)-Number(a.createdAt||0));
  $("exchangeList").innerHTML=exchanges.length?exchanges.map(x=>`<div class="list-item"><div class="exchange-list-grid"><span><strong>${x.date} · ${exchangeDirectionLabel(x.direction)}</strong><br><span class="meta">${x.direction==="TWD_TO_USD"?`${money(x.fromAmount,"TWD")} → ${money(x.toAmount,"USD")}`:`${money(x.fromAmount,"USD")} → ${money(x.toAmount,"TWD")}`}</span></span><strong>${fmt(x.effectiveRate,4)}</strong></div><div class="exchange-rate-line">成交匯率：${fmt(x.quotedRate,4)} · ${x.direction==="TWD_TO_USD"?"含手續費成本":"扣除支出幣別手續費後實收"}：${fmt(x.effectiveRate,4)}</div><div class="meta">${escapeHtml(x.note||"")}</div><div class="item-actions"><button onclick="deleteExchange('${x.id}')">刪除整筆換匯</button></div></div>`).join(""):"尚無換匯紀錄。";
}
window.editCash=id=>{
  const e=data.cashEntries.find(x=>x.id===id);if(!e)return;if(e.exchangeGroupId)return alert("換匯產生的資金異動請在換匯明細中刪除整筆後重建。");navTo("funds");$("cashEditId").value=e.id;$("cashCurrency").value=e.currency||"TWD";$("cashType").value=e.type;$("cashDate").value=e.date;$("cashAmount").value=e.amount;$("cashSymbol").value=e.symbol||"";$("cashName").value=e.name||"";$("cashNote").value=e.note||"";$("cashFormTitle").textContent="編輯資金異動";$("cancelCashEdit").classList.remove("hidden");toggleDividend();
};
window.deleteCash=id=>{const e=data.cashEntries.find(x=>x.id===id);if(e?.exchangeGroupId)return deleteExchange(e.exchangeGroupId);if(!confirm("確定刪除這筆資金異動嗎？"))return;data.cashEntries=data.cashEntries.filter(x=>x.id!==id);saveData();upsertTodaySnapshot();render();};
window.deleteFx=id=>{const x=data.fxRates.find(x=>x.id===id);if(x?.exchangeGroupId)return deleteExchange(x.exchangeGroupId);if(!confirm("確定刪除這筆匯率嗎？"))return;data.fxRates=data.fxRates.filter(x=>x.id!==id);saveData();upsertTodaySnapshot();render();};
window.deleteExchange=id=>{if(!confirm("確定刪除整筆換匯嗎？對應的資金異動與匯率快照也會一起刪除。"))return;data.exchanges=data.exchanges.filter(x=>x.id!==id);data.cashEntries=data.cashEntries.filter(x=>x.exchangeGroupId!==id);data.fxRates=data.fxRates.filter(x=>x.exchangeGroupId!==id);saveData();upsertTodaySnapshot();render();};
function syncSettings(){$("feeRate").value=data.settings.feeRate;$("minFee").value=data.settings.minFee;$("stockTaxRate").value=data.settings.stockTaxRate;$("etfTaxRate").value=data.settings.etfTaxRate;$("fontSize").value=data.settings.fontSize;$("backupReminderDays").value=String(data.settings.backupReminderDays);$("lastBackupText").textContent=`上次備份：${formatDateTime(data.settings.lastBackupAt)}`;}
function updateTradeUI(){const market=$("market").value,c=currencyOfMarket(market),amount=Number($("price").value||0)*Number($("shares").value||0),fee=$("fee").value===""?estimatedFee(amount,market):Number($("fee").value||0),tax=$("type").value==="sell"?($("tax").value===""?estimatedTax(amount,market,$("assetType").value):Number($("tax").value||0)):0;$("tradeCurrency").value=c;$("taxField").classList.toggle("hidden",market==="US"||$("type").value!=="sell");$("tradePreview").innerHTML=`${$("type").value==="buy"?"預估總成本":"預估賣出淨收入"}：<strong>${money($("type").value==="buy"?amount+fee:amount-fee-tax,c)}</strong>`;}
function resetTrade(){$("tradeForm").reset();$("date").value=today();$("editId").value="";$("tradeFormTitle").textContent="新增交易";$("cancelEdit").classList.add("hidden");$("symbolSuggestions").classList.add("hidden");updateTradeUI();}
$("tradeForm").addEventListener("input",updateTradeUI);$("market").addEventListener("change",updateTradeUI);
$("tradeForm").addEventListener("submit",e=>{e.preventDefault();const editId=$("editId").value,market=$("market").value,old=data.trades.find(x=>x.id===editId),t={id:editId||uid(),market,currency:currencyOfMarket(market),type:$("type").value,assetType:$("assetType").value,symbol:$("symbol").value.trim().toUpperCase(),name:$("name").value.trim(),date:$("date").value,price:Number($("price").value),shares:Number($("shares").value),fee:$("fee").value,tax:$("tax").value,note:$("note").value.trim(),createdAt:old?.createdAt||Date.now()};const mismatch=officialNameMismatch(t);if(mismatch&&!confirm(`股票代號與名單名稱可能不一致。\n\n名單：${mismatch.symbol} ${mismatch.name}\n目前輸入：${t.symbol} ${t.name}\n\n仍然儲存嗎？`))return;const cand=editId?data.trades.map(x=>x.id===editId?t:x):[...data.trades,t],check=validateInventoryTimeline(cand);if(!check.ok)return alert("賣出股數超過當時庫存。");data.trades=cand;saveData();upsertTodaySnapshot();resetTrade();render();navTo("holdings");});
function toggleDividend(){document.querySelectorAll(".dividend-only").forEach(x=>x.classList.toggle("hidden",$("cashType").value!=="dividend"));}
$("cashType").addEventListener("change",toggleDividend);
function resetCash(){$("cashForm").reset();$("cashDate").value=today();$("cashEditId").value="";$("cashFormTitle").textContent="新增資金異動";$("cancelCashEdit").classList.add("hidden");toggleDividend();}
$("cashForm").addEventListener("submit",e=>{e.preventDefault();const editId=$("cashEditId").value,old=data.cashEntries.find(x=>x.id===editId),entry={id:editId||uid(),currency:$("cashCurrency").value,type:$("cashType").value,date:$("cashDate").value,amount:Number($("cashAmount").value),symbol:$("cashSymbol").value.trim().toUpperCase(),name:$("cashName").value.trim(),note:$("cashNote").value.trim(),createdAt:old?.createdAt||Date.now()};data.cashEntries=editId?data.cashEntries.map(x=>x.id===editId?entry:x):[...data.cashEntries,entry];saveData();upsertTodaySnapshot();resetCash();render();});
$("fxForm").addEventListener("submit",e=>{e.preventDefault();data.fxRates.push({id:uid(),date:$("fxDate").value,rate:Number($("fxRate").value),note:$("fxNote").value.trim(),createdAt:Date.now()});saveData();upsertTodaySnapshot();$("fxForm").reset();$("fxDate").value=today();render();});

function calculateExchangePreview(){
  const direction=$("exchangeDirection").value,from=Number($("exchangeFromAmount").value||0),to=Number($("exchangeToAmount").value||0),fee=Number($("exchangeFee").value||0);
  if(!(from>0&&to>0)){$("exchangePreview").textContent="請輸入換匯金額。";return null;}
  const twdToUsd=direction==="TWD_TO_USD";
  const quoted=twdToUsd?from/to:to/from;
  const effective=twdToUsd?(from+fee)/to:to/(from+fee);
  $("exchangePreview").innerHTML=`成交匯率：<strong>${fmt(quoted,4)}</strong><br>${twdToUsd?"含手續費實際換匯成本":"扣除支出幣別手續費後實收匯率"}：<strong>${fmt(effective,4)}</strong>`;
  return {direction,from,to,fee,quoted,effective,twdToUsd};
}
["exchangeDirection","exchangeFromAmount","exchangeToAmount","exchangeFee"].forEach(id=>$(id).addEventListener("input",calculateExchangePreview));
$("exchangeDirection").addEventListener("change",calculateExchangePreview);
$("exchangeForm").addEventListener("submit",e=>{
  e.preventDefault();
  const calc=calculateExchangePreview();if(!calc)return alert("換匯金額必須大於 0。");
  const group=uid(),date=$("exchangeDate").value,note=$("exchangeNote").value.trim(),fromCurrency=calc.twdToUsd?"TWD":"USD",toCurrency=calc.twdToUsd?"USD":"TWD";
  const exchange={id:group,date,direction:calc.direction,fromCurrency,toCurrency,fromAmount:calc.from,toAmount:calc.to,fee:calc.fee,feeCurrency:fromCurrency,quotedRate:calc.quoted,effectiveRate:calc.effective,note,createdAt:Date.now()};
  data.exchanges.push(exchange);
  data.cashEntries.push({id:uid(),exchangeGroupId:group,currency:fromCurrency,type:"otherExpense",date,amount:calc.from+calc.fee,note:`換匯支出${calc.fee?`（含手續費 ${money(calc.fee,fromCurrency)}）`:""} ${note}`.trim(),createdAt:Date.now()+1});
  data.cashEntries.push({id:uid(),exchangeGroupId:group,currency:toCurrency,type:"otherIncome",date,amount:calc.to,note:`換匯收入 ${note}`.trim(),createdAt:Date.now()+2});
  data.fxRates.push({id:uid(),exchangeGroupId:group,date,rate:calc.quoted,note:`實際換匯匯率 ${note}`.trim(),createdAt:Date.now()+3});
  saveData();upsertTodaySnapshot();$("exchangeForm").reset();$("exchangeDate").value=today();$("exchangeFee").value="0";calculateExchangePreview();render();
});
$("priceForm").addEventListener("submit",e=>{if(e.submitter?.value!=="save")return;e.preventDefault();data.prices[$("priceKey").value]={price:Number($("currentPrice").value),updatedAt:new Date().toISOString()};saveData();upsertTodaySnapshot();$("priceDialog").close();render();});
$("backToHoldings").addEventListener("click",()=>navTo("holdings"));$("themeToggle").addEventListener("click",()=>{data.settings.darkMode=!data.settings.darkMode;saveData();render();});
document.querySelectorAll(".segment").forEach(b=>b.addEventListener("click",()=>{data.ui.marketFilter=b.dataset.market;document.querySelectorAll(".segment").forEach(x=>x.classList.toggle("active",x===b));saveData();renderHoldings();}));
document.querySelectorAll(".table-sort").forEach(b=>b.addEventListener("click",()=>{data.ui.holdingSort===b.dataset.sort?data.ui.holdingSortDir=data.ui.holdingSortDir==="asc"?"desc":"asc":(data.ui.holdingSort=b.dataset.sort,data.ui.holdingSortDir=b.dataset.sort==="symbol"?"asc":"desc");saveData();renderHoldings();}));
document.querySelectorAll(".chart-range").forEach(b=>b.addEventListener("click",()=>{data.ui.chartRange=b.dataset.range;saveData();renderChart();}));
$("search").addEventListener("input",renderHistory);$("historyMarket").addEventListener("change",renderHistory);
$("displaySettingsForm").addEventListener("submit",e=>{e.preventDefault();data.settings.fontSize=$("fontSize").value;data.settings.backupReminderDays=Number($("backupReminderDays").value);saveData();render();alert("顯示設定已儲存。");});
$("settingsForm").addEventListener("submit",e=>{e.preventDefault();data.settings.feeRate=Number($("feeRate").value);data.settings.minFee=Number($("minFee").value);data.settings.stockTaxRate=Number($("stockTaxRate").value);data.settings.etfTaxRate=Number($("etfTaxRate").value);saveData();render();alert("台股費率已儲存。");});
function download(content,name,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$("exportJson").addEventListener("click",()=>{data.settings.lastBackupAt=new Date().toISOString();saveData();download(JSON.stringify({...data,appVersion:APP_VERSION,historicalAssetPoints:buildHistoricalPoints()},null,2),`stock_record_backup_${today()}.json`,"application/json");render();});
$("exportCsv").addEventListener("click",()=>{const rows=[["市場","幣別","日期","代號","名稱","類型","價格","股數","手續費","證交稅"]];data.trades.forEach(r=>{const t=normalizeTrade(r);rows.push([t.market,t.currency,t.date,t.symbol,t.name,t.type,t.price,t.shares,t.fee,t.tax]);});rows.push([]);rows.push(["換匯日期","方向","支出幣別","支出金額","取得幣別","取得金額","手續費","成交匯率","含費實際匯率","備註"]);data.exchanges.forEach(x=>rows.push([x.date,exchangeDirectionLabel(x.direction),x.fromCurrency,x.fromAmount,x.toCurrency,x.toAmount,x.fee,x.quotedRate,x.effectiveRate,x.note||""]));const csv="\ufeff"+rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");download(csv,`stock_record_${today()}.csv`,"text/csv;charset=utf-8");});
$("importJson").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;try{data=migrate(JSON.parse(await f.text()));saveData();upsertTodaySnapshot();render();alert("匯入完成。");}catch{alert("匯入失敗。");}e.target.value="";});
$("clearData").addEventListener("click",()=>{if(confirm("確定清除全部資料嗎？")){data=cloneDefault();saveData();upsertTodaySnapshot();render();}});

$("symbol").addEventListener("input",e=>{
  e.target.value=e.target.value.toUpperCase();
  renderSymbolSuggestions(e.target.value);
  autoFillExactSymbol(e.target.value);
});
$("symbol").addEventListener("focus",e=>{if(e.target.value.trim())renderSymbolSuggestions(e.target.value);});
$("symbol").addEventListener("blur",()=>setTimeout(()=>{if(!$("symbol").value.trim())$("symbolSuggestions").classList.add("hidden");},120));
$("market").addEventListener("change",()=>{renderSymbolSuggestions($("symbol").value);autoFillExactSymbol($("symbol").value);});
document.addEventListener("click",e=>{if(!e.target.closest(".symbol-search-field"))$("symbolSuggestions").classList.add("hidden");});
$("refreshSymbols").addEventListener("click",refreshOfficialSymbols);

$("fxDate").value=today();$("exchangeDate").value=today();resetTrade();resetCash();calculateExchangePreview();upsertTodaySnapshot();render();
loadSymbolDb();
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));

$("cancelEdit").addEventListener("click",resetTrade);

$("cancelCashEdit").addEventListener("click",resetCash);
