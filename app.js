
const APP_VERSION = "v1.3";
const STORAGE_KEY = "stockRecordAppV1";
const DEFAULT_DATA = {
  trades: [],
  prices: {},
  cashEntries: [],
  settings: {
    feeRate: 0.001425,
    minFee: 20,
    stockTaxRate: 0.003,
    etfTaxRate: 0.001,
    darkMode: false
  }
};

let data = loadData();

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}
function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ? {
      trades: Array.isArray(saved.trades) ? saved.trades : [],
      prices: saved.prices && typeof saved.prices === "object" ? saved.prices : {},
      cashEntries: Array.isArray(saved.cashEntries) ? saved.cashEntries : [],
      settings: { ...DEFAULT_DATA.settings, ...(saved.settings || {}) }
    } : cloneDefault();
  } catch {
    return cloneDefault();
  }
}
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(Number(n || 0));
const num = (n, digits = 2) => Number(n || 0).toLocaleString("zh-TW", { maximumFractionDigits: digits });
const today = () => new Date().toISOString().slice(0, 10);
const escapeHtml = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function releaseFocusAndResetView() {
  const active = document.activeElement;
  if (active && typeof active.blur === "function") active.blur();
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }), 80);
}
function navTo(page) {
  releaseFocusAndResetView();
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === page));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.nav === page));
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
}
document.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => navTo(b.dataset.nav)));

function estimatedFee(amount) {
  return Math.max(Number(data.settings.minFee || 0), Math.round(amount * Number(data.settings.feeRate || 0)));
}
function estimatedTax(amount, assetType) {
  const rate = assetType === "etf" ? data.settings.etfTaxRate : data.settings.stockTaxRate;
  return Math.round(amount * Number(rate || 0));
}
function normalizeTrade(t) {
  const amount = Number(t.price) * Number(t.shares);
  return {
    ...t,
    price: Number(t.price),
    shares: Number(t.shares),
    fee: t.fee === "" || t.fee === null || t.fee === undefined ? estimatedFee(amount) : Number(t.fee),
    tax: t.type === "sell"
      ? (t.tax === "" || t.tax === null || t.tax === undefined ? estimatedTax(amount, t.assetType) : Number(t.tax))
      : 0
  };
}
function sortedTrades(trades = data.trades) {
  return [...trades].sort((a, b) => (a.date.localeCompare(b.date) || Number(a.createdAt || 0) - Number(b.createdAt || 0)));
}
function calculatePortfolio(trades = data.trades) {
  const map = {};
  let realizedTotal = 0;
  for (const raw of sortedTrades(trades)) {
    const t = normalizeTrade(raw);
    const key = t.symbol.trim();
    if (!map[key]) map[key] = { symbol: key, name: t.name, assetType: t.assetType, shares: 0, cost: 0, realized: 0 };
    const h = map[key];
    h.name = t.name;
    h.assetType = t.assetType;
    const amount = t.price * t.shares;
    if (t.type === "buy") {
      h.cost += amount + t.fee;
      h.shares += t.shares;
    } else {
      const sellShares = Math.min(t.shares, h.shares);
      const ratio = t.shares > 0 ? sellShares / t.shares : 0;
      const avgCost = h.shares > 0 ? h.cost / h.shares : 0;
      const realized = (amount * ratio) - (t.fee * ratio) - (t.tax * ratio) - (avgCost * sellShares);
      h.cost -= avgCost * sellShares;
      h.shares -= sellShares;
      h.realized += realized;
      realizedTotal += realized;
      if (h.shares < 0.000001) { h.shares = 0; h.cost = 0; }
    }
  }
  const holdings = Object.values(map).filter(h => h.shares > 0);
  for (const h of holdings) {
    h.avgCost = h.shares ? h.cost / h.shares : 0;
    h.currentPrice = Number(data.prices[h.symbol] ?? h.avgCost);
    h.marketValue = h.currentPrice * h.shares;
    h.unrealized = h.marketValue - h.cost;
    h.returnRate = h.cost ? h.unrealized / h.cost : 0;
  }
  return { holdings, map, realizedTotal };
}
function manualCashSigned(entry) {
  const amount = Number(entry.amount || 0);
  return ["deposit", "dividend", "otherIncome"].includes(entry.type) ? amount : -amount;
}
function tradeCashSigned(raw) {
  const t = normalizeTrade(raw);
  const amount = t.price * t.shares;
  return t.type === "buy" ? -(amount + t.fee) : (amount - t.fee - t.tax);
}
function calculateCash({ excludeTradeId = "", excludeCashId = "" } = {}) {
  const manual = data.cashEntries.filter(e => e.id !== excludeCashId).reduce((sum, e) => sum + manualCashSigned(e), 0);
  const trading = data.trades.filter(t => t.id !== excludeTradeId).reduce((sum, t) => sum + tradeCashSigned(t), 0);
  return manual + trading;
}
function calculateCashSummary() {
  const available = calculateCash();
  const deposits = data.cashEntries.filter(e => e.type === "deposit").reduce((s, e) => s + Number(e.amount || 0), 0);
  const withdrawals = data.cashEntries.filter(e => e.type === "withdrawal").reduce((s, e) => s + Number(e.amount || 0), 0);
  const dividends = data.cashEntries.filter(e => e.type === "dividend").reduce((s, e) => s + Number(e.amount || 0), 0);
  return { available, deposits, withdrawals, dividends };
}
function validateSell(symbol, shares, editingId = "") {
  const trades = data.trades.filter(t => t.id !== editingId);
  const available = calculatePortfolio(trades).map[symbol]?.shares || 0;
  return { ok: Number(shares) <= available, available };
}
function pnlClass(n) { return Number(n) >= 0 ? "pnl-positive" : "pnl-negative"; }

function render() {
  document.body.classList.toggle("dark", !!data.settings.darkMode);
  $("themeToggle").textContent = data.settings.darkMode ? "☀" : "☾";
  renderDashboard();
  renderHoldings();
  renderHistory();
  renderFunds();
  syncSettings();
  updatePreview();
  toggleDividendFields();
}
function renderDashboard() {
  const p = calculatePortfolio();
  const c = calculateCashSummary();
  const totalCost = p.holdings.reduce((s, h) => s + h.cost, 0);
  const market = p.holdings.reduce((s, h) => s + h.marketValue, 0);
  const unrealized = market - totalCost;
  const assets = c.available + market;
  $("availableCash").textContent = money(c.available);
  $("availableCash").className = pnlClass(c.available);
  $("totalAssets").textContent = money(assets);
  $("totalAssets").className = pnlClass(assets);
  $("totalCost").textContent = money(totalCost);
  $("marketValue").textContent = money(market);
  $("unrealizedPnl").textContent = money(unrealized);
  $("unrealizedPnl").className = pnlClass(unrealized);
  $("realizedPnl").textContent = money(p.realizedTotal);
  $("realizedPnl").className = pnlClass(p.realizedTotal);
  $("dividendIncome").textContent = money(c.dividends);
  $("cashHint").innerHTML = c.available < 0
    ? `<span class="warning">目前可用資金為負數。請檢查是否尚未登錄存入資金，或交易資料是否完整。</span>`
    : `目前可用資金為 <strong>${money(c.available)}</strong>。股票買進、賣出與股利入帳會自動反映。`;
  $("dashboardHoldings").innerHTML = p.holdings.length ? p.holdings.slice(0, 4).map(holdingHtml).join("") : "尚無持股。請先新增一筆買進紀錄。";
  const latest = [...data.trades].sort((a, b) => b.date.localeCompare(a.date) || Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 5);
  $("recentTrades").innerHTML = latest.length ? latest.map(tradeHtml).join("") : "尚無交易紀錄。";
}
function holdingHtml(h) {
  return `<div class="list-item holding-clickable" onclick="openHoldingDetail('${escapeHtml(h.symbol)}')">
    <div class="item-top">
      <div><span class="symbol">${escapeHtml(h.symbol)} ${escapeHtml(h.name)}</span>
      <div class="meta">${num(h.shares, 0)} 股 · 平均成本 ${num(h.avgCost)} · 現價 ${num(h.currentPrice)}</div></div>
      <strong class="${pnlClass(h.unrealized)}">${money(h.unrealized)}</strong>
    </div>
    <div class="meta">市值 ${money(h.marketValue)} · 報酬率 ${(h.returnRate * 100).toFixed(2)}%</div>
    <div class="item-actions">
      <button onclick="event.stopPropagation(); openPriceDialog('${escapeHtml(h.symbol)}','${escapeHtml(h.name)}')">更新股價</button>
      <button onclick="event.stopPropagation(); openHoldingDetail('${escapeHtml(h.symbol)}')">查看明細</button>
    </div>
  </div>`;
}
function renderHoldings() {
  const holdings = calculatePortfolio().holdings.sort((a, b) => b.marketValue - a.marketValue);
  $("holdingsList").innerHTML = holdings.length ? holdings.map(holdingHtml).join("") : "尚無持股。";
}
function openHoldingDetail(symbol) {
  const h = calculatePortfolio().holdings.find(item => item.symbol === symbol);
  if (!h) return alert("找不到這檔股票的持股資料。");
  const relatedTrades = [...data.trades]
    .filter(t => t.symbol.trim() === symbol)
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
  $("holdingDetailContent").innerHTML = `
    <div class="detail-hero">
      <h2>${escapeHtml(h.symbol)} ${escapeHtml(h.name)}</h2>
      <div class="meta">${h.assetType === "etf" ? "ETF" : "股票"} · 目前持有中</div>
    </div>
    <div class="detail-grid">
      <div class="detail-stat"><span>目前持有</span><strong>${num(h.shares, 0)} 股</strong></div>
      <div class="detail-stat"><span>平均成本</span><strong>${num(h.avgCost)} 元</strong></div>
      <div class="detail-stat"><span>目前股價</span><strong>${num(h.currentPrice)} 元</strong></div>
      <div class="detail-stat"><span>未實現損益</span><strong class="${pnlClass(h.unrealized)}">${money(h.unrealized)}</strong></div>
      <div class="detail-stat"><span>報酬率</span><strong class="${pnlClass(h.returnRate)}">${(h.returnRate * 100).toFixed(2)}%</strong></div>
      <div class="detail-stat"><span>目前市值</span><strong>${money(h.marketValue)}</strong></div>
    </div>
    <div class="item-actions"><button onclick="openPriceDialog('${escapeHtml(h.symbol)}','${escapeHtml(h.name)}')">更新目前股價</button></div>
    <h3 class="detail-section-title">交易紀錄</h3>
    <div>${relatedTrades.length ? relatedTrades.map(t => tradeHtml(t, true)).join("") : '<div class="empty">尚無交易紀錄。</div>'}</div>`;
  navTo("holdingDetail");
}
window.openHoldingDetail = openHoldingDetail;

function tradeHtml(raw, showActions = false) {
  const t = normalizeTrade(raw);
  const total = t.price * t.shares;
  return `<div class="list-item">
    <div class="item-top">
      <div><span class="symbol">${escapeHtml(t.symbol)} ${escapeHtml(t.name)}</span>
      <div class="meta">${escapeHtml(t.date)} · ${t.type === "buy" ? "買進" : "賣出"} · ${num(t.shares, 0)} 股</div></div>
      <strong>${money(total)}</strong>
    </div>
    <div class="meta">成交價 ${num(t.price)} · 手續費 ${money(t.fee)}${t.type === "sell" ? ` · 證交稅 ${money(t.tax)}` : ""}${t.note ? `<br>備註：${escapeHtml(t.note)}` : ""}</div>
    ${showActions ? `<div class="item-actions"><button onclick="editTrade('${t.id}')">編輯</button><button onclick="deleteTrade('${t.id}')">刪除</button></div>` : ""}
  </div>`;
}
function renderHistory() {
  const q = $("search").value.trim().toLowerCase();
  const type = $("historyType").value;
  const list = [...data.trades]
    .filter(t => type === "all" || t.type === type)
    .filter(t => !q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
  $("historyList").innerHTML = list.length ? list.map(t => tradeHtml(t, true)).join("") : "找不到符合條件的交易紀錄。";
}
function updatePreview() {
  const price = Number($("price").value || 0);
  const shares = Number($("shares").value || 0);
  const amount = price * shares;
  const fee = $("fee").value === "" ? estimatedFee(amount) : Number($("fee").value);
  const tax = $("type").value === "sell" ? ($("tax").value === "" ? estimatedTax(amount, $("assetType").value) : Number($("tax").value)) : 0;
  const net = $("type").value === "buy" ? amount + fee : amount - fee - tax;
  $("taxField").classList.toggle("hidden", $("type").value !== "sell");
  $("tradePreview").innerHTML = `${$("type").value === "buy" ? "預估總成本" : "預估賣出淨收入"}：<strong>${money(net)}</strong><br>成交金額：${money(amount)} · 手續費：${money(fee)}${$("type").value === "sell" ? ` · 證交稅：${money(tax)}` : ""}`;
}
function resetTradeForm() {
  $("tradeForm").reset();
  $("date").value = today();
  $("editId").value = "";
  $("tradeFormTitle").textContent = "新增交易";
  $("cancelEdit").classList.add("hidden");
  updatePreview();
}
$("tradeForm").addEventListener("input", updatePreview);
$("tradeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const editingId = $("editId").value;
  const trade = {
    id: editingId || uid(),
    type: $("type").value,
    assetType: $("assetType").value,
    symbol: $("symbol").value.trim(),
    name: $("name").value.trim(),
    date: $("date").value,
    price: Number($("price").value),
    shares: Number($("shares").value),
    fee: $("fee").value,
    tax: $("tax").value,
    note: $("note").value.trim(),
    createdAt: editingId ? (data.trades.find(t => t.id === editingId)?.createdAt || Date.now()) : Date.now()
  };
  const normalized = normalizeTrade(trade);
  if (trade.type === "sell") {
    const result = validateSell(trade.symbol, trade.shares, editingId);
    if (!result.ok) return alert(`賣出股數超過目前庫存。目前可賣出 ${num(result.available, 0)} 股。`);
  } else {
    const needed = normalized.price * normalized.shares + normalized.fee;
    const cashBefore = calculateCash({ excludeTradeId: editingId });
    if (needed > cashBefore && !confirm(`可用資金不足。\n\n本次買進需要：${money(needed)}\n目前可用資金：${money(cashBefore)}\n不足金額：${money(needed - cashBefore)}\n\n仍然允許儲存嗎？`)) return;
  }
  if (editingId) data.trades = data.trades.map(t => t.id === editingId ? trade : t);
  else data.trades.push(trade);
  saveData();
  resetTradeForm();
  releaseFocusAndResetView();
  render();
  navTo("holdings");
});
window.editTrade = (id) => {
  const t = data.trades.find(x => x.id === id);
  if (!t) return;
  navTo("trade");
  $("editId").value = t.id;
  $("type").value = t.type;
  $("assetType").value = t.assetType;
  $("symbol").value = t.symbol;
  $("name").value = t.name;
  $("date").value = t.date;
  $("price").value = t.price;
  $("shares").value = t.shares;
  $("fee").value = t.fee;
  $("tax").value = t.tax;
  $("note").value = t.note || "";
  $("tradeFormTitle").textContent = "編輯交易";
  $("cancelEdit").classList.remove("hidden");
  updatePreview();
};
window.deleteTrade = (id) => {
  if (!confirm("確定要刪除這筆交易嗎？刪除後會重新計算持股、損益與可用資金。")) return;
  data.trades = data.trades.filter(t => t.id !== id);
  saveData(); render();
};
$("cancelEdit").addEventListener("click", resetTradeForm);
$("search").addEventListener("input", renderHistory);
$("historyType").addEventListener("change", renderHistory);

function cashTypeLabel(type) {
  return ({ deposit: "資金存入", withdrawal: "資金提領", dividend: "現金股利", otherIncome: "其他收入", otherExpense: "其他支出" })[type] || "資金異動";
}
function toggleDividendFields() {
  document.querySelectorAll(".dividend-only").forEach(el => el.classList.toggle("hidden", $("cashType").value !== "dividend"));
}
function resetCashForm() {
  $("cashForm").reset();
  $("cashDate").value = today();
  $("cashEditId").value = "";
  $("cashFormTitle").textContent = "新增資金異動";
  $("cancelCashEdit").classList.add("hidden");
  toggleDividendFields();
}
function manualCashHtml(entry) {
  const signed = manualCashSigned(entry);
  return `<div class="list-item">
    <div class="item-top">
      <div><span class="symbol">${cashTypeLabel(entry.type)}${entry.symbol ? ` · ${escapeHtml(entry.symbol)} ${escapeHtml(entry.name || "")}` : ""}</span>
      <div class="meta">${escapeHtml(entry.date)}${entry.note ? ` · ${escapeHtml(entry.note)}` : ""}</div></div>
      <strong class="${pnlClass(signed)}">${signed >= 0 ? "+" : ""}${money(signed)}</strong>
    </div>
    <div class="item-actions"><button onclick="editCashEntry('${entry.id}')">編輯</button><button onclick="deleteCashEntry('${entry.id}')">刪除</button></div>
  </div>`;
}
function tradeCashHtml(raw) {
  const t = normalizeTrade(raw);
  const signed = tradeCashSigned(t);
  return `<div class="list-item">
    <div class="item-top">
      <div><span class="symbol">${t.type === "buy" ? "股票買進" : "股票賣出"} · ${escapeHtml(t.symbol)} ${escapeHtml(t.name)}</span>
      <div class="meta">${escapeHtml(t.date)} · ${num(t.shares, 0)} 股 · 成交價 ${num(t.price)}</div></div>
      <strong class="${pnlClass(signed)}">${signed >= 0 ? "+" : ""}${money(signed)}</strong>
    </div>
    <div class="meta">${t.type === "buy" ? "已包含手續費" : "已扣除手續費與證交稅"}</div>
  </div>`;
}
function renderFunds() {
  const c = calculateCashSummary();
  $("fundsAvailableCash").textContent = money(c.available);
  $("fundsAvailableCash").className = pnlClass(c.available);
  $("totalDeposits").textContent = money(c.deposits);
  $("totalWithdrawals").textContent = money(c.withdrawals);
  $("fundsDividendIncome").textContent = money(c.dividends);
  const combined = [
    ...data.cashEntries.map(e => ({ date: e.date, createdAt: Number(e.createdAt || 0), html: () => manualCashHtml(e) })),
    ...data.trades.map(t => ({ date: t.date, createdAt: Number(t.createdAt || 0), html: () => tradeCashHtml(t) }))
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  $("cashLedgerList").innerHTML = combined.length ? combined.map(e => e.html()).join("") : "尚無資金異動。";
}
$("cashType").addEventListener("change", toggleDividendFields);
$("cashForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const editingId = $("cashEditId").value;
  const entry = {
    id: editingId || uid(),
    type: $("cashType").value,
    date: $("cashDate").value,
    amount: Number($("cashAmount").value),
    symbol: $("cashSymbol").value.trim(),
    name: $("cashName").value.trim(),
    note: $("cashNote").value.trim(),
    createdAt: editingId ? (data.cashEntries.find(x => x.id === editingId)?.createdAt || Date.now()) : Date.now()
  };
  const signed = manualCashSigned(entry);
  const cashBefore = calculateCash({ excludeCashId: editingId });
  if (signed < 0 && Math.abs(signed) > cashBefore && !confirm(`本次支出或提領後，可用資金將成為負數。\n\n目前可用資金：${money(cashBefore)}\n本次扣除：${money(Math.abs(signed))}\n\n仍然允許儲存嗎？`)) return;
  if (editingId) data.cashEntries = data.cashEntries.map(x => x.id === editingId ? entry : x);
  else data.cashEntries.push(entry);
  saveData();
  resetCashForm();
  releaseFocusAndResetView();
  render();
  navTo("funds");
});
window.editCashEntry = (id) => {
  const entry = data.cashEntries.find(x => x.id === id);
  if (!entry) return;
  navTo("funds");
  $("cashEditId").value = entry.id;
  $("cashType").value = entry.type;
  $("cashDate").value = entry.date;
  $("cashAmount").value = entry.amount;
  $("cashSymbol").value = entry.symbol || "";
  $("cashName").value = entry.name || "";
  $("cashNote").value = entry.note || "";
  $("cashFormTitle").textContent = "編輯資金異動";
  $("cancelCashEdit").classList.remove("hidden");
  toggleDividendFields();
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
};
window.deleteCashEntry = (id) => {
  if (!confirm("確定要刪除這筆資金異動嗎？刪除後會重新計算可用資金。")) return;
  data.cashEntries = data.cashEntries.filter(x => x.id !== id);
  saveData(); render();
};
$("cancelCashEdit").addEventListener("click", resetCashForm);

window.openPriceDialog = (symbol, name) => {
  $("priceSymbol").value = symbol;
  $("currentPrice").value = data.prices[symbol] ?? "";
  $("priceDialogTitle").textContent = `更新 ${symbol} ${name} 目前股價`;
  $("priceDialog").showModal();
};
$("priceForm").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  e.preventDefault();
  data.prices[$("priceSymbol").value] = Number($("currentPrice").value);
  saveData(); $("priceDialog").close(); releaseFocusAndResetView(); render();
});
$("backToHoldings").addEventListener("click", () => navTo("holdings"));
$("themeToggle").addEventListener("click", () => { data.settings.darkMode = !data.settings.darkMode; saveData(); render(); });

function syncSettings() {
  $("feeRate").value = data.settings.feeRate;
  $("minFee").value = data.settings.minFee;
  $("stockTaxRate").value = data.settings.stockTaxRate;
  $("etfTaxRate").value = data.settings.etfTaxRate;
}
$("settingsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  data.settings.feeRate = Number($("feeRate").value);
  data.settings.minFee = Number($("minFee").value);
  data.settings.stockTaxRate = Number($("stockTaxRate").value);
  data.settings.etfTaxRate = Number($("etfTaxRate").value);
  saveData(); releaseFocusAndResetView(); render(); alert("設定已儲存。");
});
function download(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("exportJson").addEventListener("click", () => download(JSON.stringify({ ...data, appVersion: APP_VERSION }, null, 2), `stock_record_backup_${today()}.json`, "application/json"));
$("importJson").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.trades) || typeof imported.prices !== "object") throw new Error("格式不符");
    if (!confirm("匯入後會取代目前資料。確定要繼續嗎？")) return;
    data = {
      trades: imported.trades,
      prices: imported.prices || {},
      cashEntries: Array.isArray(imported.cashEntries) ? imported.cashEntries : [],
      settings: { ...DEFAULT_DATA.settings, ...(imported.settings || {}) }
    };
    saveData(); releaseFocusAndResetView(); render(); alert("匯入完成。");
  } catch { alert("無法匯入：檔案格式不正確。"); }
  e.target.value = "";
});
$("exportCsv").addEventListener("click", () => {
  const rows = [["交易日期","股票代號","股票名稱","商品類型","交易類型","成交價","股數","成交金額","手續費","證交稅","備註"]];
  [...data.trades].sort((a,b) => a.date.localeCompare(b.date)).forEach(raw => {
    const t = normalizeTrade(raw);
    rows.push([t.date,t.symbol,t.name,t.assetType === "etf" ? "ETF" : "股票",t.type === "buy" ? "買進" : "賣出",t.price,t.shares,t.price*t.shares,t.fee,t.tax,t.note || ""]);
  });
  rows.push([]);
  rows.push(["資金異動日期","類型","金額","股票代號","股票名稱","備註"]);
  [...data.cashEntries].sort((a,b) => a.date.localeCompare(b.date)).forEach(e => rows.push([e.date,cashTypeLabel(e.type),e.amount,e.symbol || "",e.name || "",e.note || ""]));
  const csv = "\ufeff" + rows.map(row => row.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\n");
  download(csv, `stock_record_${today()}.csv`, "text/csv;charset=utf-8");
});
$("clearData").addEventListener("click", () => {
  if (!confirm("確定要清除全部資料嗎？此動作無法復原，建議先匯出備份。")) return;
  if (!confirm("再次確認：真的要刪除全部交易與資金紀錄嗎？")) return;
  data = cloneDefault(); saveData(); resetTradeForm(); resetCashForm(); releaseFocusAndResetView(); render();
});
resetTradeForm();
resetCashForm();
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
