/* ===== DATA SERVICE — Google Apps Script / Sheets ===== */

const DataService = (() => {

  const API_URL = "https://script.google.com/macros/s/AKfycbz9uDnRY0UWQo1gSwAeW9Pfg0TmHxZVYlxBW389wcn54bnF7KK5L8MNfmUcdy196MMcyA/exec";

  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  let _cache = {};
  let _lastFetch = {};

  /* ---- Core fetch (follows Google's redirect) ---- */
  async function _fetch(params = {}) {
    const url = new URL(API_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));

    const res = await fetch(url.toString(), { method: "GET", redirect: "follow" });
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("Received HTML — check Apps Script permissions.");
    const data = JSON.parse(text);
    if (data.status === "error") throw new Error(data.message || "API Error");
    return data;
  }

  /* ---- Convert 2D array → array of objects ---- */
  function _toObjects(values) {
    if (!values || values.length < 2) return [];
    const headers = values[0];
    return values.slice(1).map(row =>
      Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]))
    );
  }

  /* ---- Public: health check + FX rate ---- */
  async function getHealth() {
    const cacheKey = "health";
    const now = Date.now();
    if (_cache[cacheKey] && (now - _lastFetch[cacheKey]) < CACHE_TTL) return _cache[cacheKey];
    const data = await _fetch();
    _cache[cacheKey] = data;
    _lastFetch[cacheKey] = now;
    return data;
  }

  /* ---- Public: transactions ---- */
  async function getTransactions() {
    const cacheKey = "transactions";
    const now = Date.now();
    if (_cache[cacheKey] && (now - _lastFetch[cacheKey]) < CACHE_TTL) return _cache[cacheKey];
    // Apps Script converts resource name to lowercase automatically — "transactions" and "Transactions" are identical.
    // getDataRange().getValues() returns ALL rows (no server-side limit).
    const data = await _fetch({ resource: "transactions" });
    const rows = _toObjects(data.values);
    _cache[cacheKey] = rows;
    _lastFetch[cacheKey] = now;
    return rows;
  }

  /* ---- Public: stock price history (e.g. "TSLA") ---- */
  async function getStockHistory(symbol) {
    const cacheKey = `history_${symbol}`;
    const now = Date.now();
    if (_cache[cacheKey] && (now - _lastFetch[cacheKey]) < CACHE_TTL) return _cache[cacheKey];
    const data = await _fetch({ resource: "history", symbol });
    const rows = _toObjects(data.values);
    _cache[cacheKey] = rows;
    _lastFetch[cacheKey] = now;
    return rows;
  }

  /* ---- Public: clear cache ---- */
  function clearCache(key) {
    if (key) { delete _cache[key]; delete _lastFetch[key]; }
    else { _cache = {}; _lastFetch = {}; }
  }

  /* ---- Public: current USD/ILS rate ---- */
  async function getFxRate() {
    const health = await getHealth();
    return health?.fx?.rate ?? null;
  }

  return { getHealth, getTransactions, getStockHistory, getFxRate, clearCache };
})();
