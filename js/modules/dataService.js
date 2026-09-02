/* ===== DATA SERVICE — Google Apps Script / Sheets ===== */

const DataService = (() => {

  const API_URL = "https://script.google.com/macros/s/AKfycbz9uDnRY0UWQo1gSwAeW9Pfg0TmHxZVYlxBW389wcn54bnF7KK5L8MNfmUcdy196MMcyA/exec";

  const CACHE_TTL    = 5  * 60 * 1000; // 5 min  — in-memory
  const LS_TTL       = 30 * 60 * 1000; // 30 min — localStorage
  const LS_KEY_TXN   = 'fapp_txn_v1';  // bump version string to bust stale schema
  let _cache = {};
  let _lastFetch = {};

  /* ---- Core fetch (follows Google's redirect) ----
     כל בקשה נושאת את המושב אם יש. השרת מתעלם ממנו כל עוד המתג שם כבוי,
     ולכן אפשר להעלות את הצד הזה לייצור לפני שסוגרים את השער.
     תשובת "unauthorized" מנקה את המושב ומסמנת את השגיאה, כדי שהקורא
     יוכל להעלות את שער הכניסה במקום להציג הודעת שגיאה סתמית.            */
  async function _fetch(params = {}) {
    const url = new URL(API_URL);
    const sess = (window.FA && FA.session) ? FA.session.get() : null;
    if (sess && !params.session) params = { ...params, session: sess };
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));

    const res = await fetch(url.toString(), { method: "GET", redirect: "follow" });
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("Received HTML — check Apps Script permissions.");
    const data = JSON.parse(text);
    // Handle both {status:"error", message:"..."} and {ok:false, error:"..."}
    if (data.status === "error" || data.ok === false) {
      const msg = data.message || data.error || "API Error";
      if (/unauthorized/i.test(msg)) {
        // מטפלים כאן ולא רק זורקים: חלק מהקריאות עטופות ב-catch משלהן
        // (מחירים חיים, היסטוריה), ואם נסתפק בזריקה — המושב יתנקה בשקט
        // והמשתמש יישאר מול נתוני מטמון בלי לדעת שהוא כבר לא מחובר.
        if (window.FA && FA.session) {
          FA.session.clear();
          clearCache();                       // לא להגיש מטמון למי שאינו מורשה
          if (!FA.session.isOpen()) {
            FA.session.open(function () {
              // App מוגדר ב-const ברמת הסקריפט, ולכן הוא **לא** נעשה מאפיין
              // של window. הבדיקה חייבת להיות typeof ולא window.App —
              // אחרת הקריאה החוזרת אחרי התחברות לא רצה בכלל.
              if (typeof App !== "undefined" && App.refreshData) App.refreshData();
            });
          }
        }
        const e = new Error("unauthorized");
        e.unauthorized = true;
        throw e;
      }
      throw new Error(msg);
    }
    return data;
  }

  /* ---- התחברות ----
     עוקפת את המטמון ואת צירוף המושב: זו הבקשה שמייצרת אותו.            */
  async function login(pass) {
    const url = new URL(API_URL);
    url.searchParams.append("resource", "login");
    url.searchParams.append("pass", pass);
    const res = await fetch(url.toString(), { method: "GET", redirect: "follow" });
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("Received HTML — check Apps Script permissions.");
    const data = JSON.parse(text);
    if (data.ok === false) throw new Error(data.error || "unauthorized");
    return data;
  }

  /* ---- Convert 2D array → array of objects ----
     Google Sheets returns numeric cells as JS numbers and date cells as
     JS Date objects. Stringify everything so downstream code never gets
     a non-string where it expects one (.trim / .toLowerCase / etc.). */
  function _toObjects(values) {
    if (!values || values.length < 2) return [];
    const headers = values[0];
    return values.slice(1).map(row =>
      Object.fromEntries(headers.map((h, i) => {
        const v = row[i] ?? "";
        if (v instanceof Date) {
          // Format as YYYY-MM-DD so new Date(str) parses reliably
          const y = v.getFullYear();
          const m = String(v.getMonth() + 1).padStart(2, '0');
          const d = String(v.getDate()).padStart(2, '0');
          return [h, `${y}-${m}-${d}`];
        }
        return [h, String(v)];
      }))
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

  /* ---- Persist rows to localStorage ---- */
  function _lsSave(rows) {
    try { localStorage.setItem(LS_KEY_TXN, JSON.stringify({ ts: Date.now(), rows })); } catch (_) {}
  }

  /* ---- Background refresh (silent — updates cache only, no UI change) ---- */
  async function _bgRefresh() {
    try {
      const data = await _fetch({ resource: "transactions" });
      const rows = _toObjects(data.values);
      _cache["transactions"]    = rows;
      _lastFetch["transactions"] = Date.now();
      _lsSave(rows);
    } catch (_) { /* ignore — user has cached data */ }
  }

  /* ---- Public: transactions ----
     Layer 1 (fastest) : in-memory cache   — valid for 5 min
     Layer 2 (fast)    : localStorage      — valid for 30 min; triggers bg refresh if >5 min old
     Layer 3 (slow)    : network fetch     — falls back if both caches miss or expired          */
  async function getTransactions() {
    const cacheKey = "transactions";
    const now = Date.now();

    // Layer 1: in-memory
    if (_cache[cacheKey] && (now - _lastFetch[cacheKey]) < CACHE_TTL) {
      return _cache[cacheKey];
    }

    // Layer 2: localStorage (instant — data from previous session / page refresh)
    try {
      const stored = localStorage.getItem(LS_KEY_TXN);
      if (stored) {
        const { ts, rows } = JSON.parse(stored);
        if (rows && Array.isArray(rows) && (now - ts) < LS_TTL) {
          _cache[cacheKey]    = rows;
          _lastFetch[cacheKey] = ts;
          // If older than in-memory TTL, silently refresh behind the scenes
          if (now - ts > CACHE_TTL) _bgRefresh();
          return rows;
        }
      }
    } catch (_) { /* localStorage unavailable or data corrupt — fall through to network */ }

    // Layer 3: network fetch
    const data = await _fetch({ resource: "transactions" });
    const rows = _toObjects(data.values);
    _cache[cacheKey]    = rows;
    _lastFetch[cacheKey] = Date.now();
    _lsSave(rows);
    return rows;
  }

  /* ---- Public: stock price history (e.g. "TSLA") ----
     The history endpoint returns { rows: [{date, close, volume}, ...] }
     (already split-adjusted), NOT a { values: [[...]] } 2D array like the
     other resources — so we read data.rows directly, no _toObjects.        */
  async function getStockHistory(symbol) {
    const cacheKey = `history_${symbol}`;
    const now = Date.now();
    if (_cache[cacheKey] && (now - _lastFetch[cacheKey]) < CACHE_TTL) return _cache[cacheKey];
    const data = await _fetch({ resource: "history", symbol });
    const rows = Array.isArray(data.rows) ? data.rows
               : (data.values ? _toObjects(data.values) : []);  // fallback for older shape
    _cache[cacheKey] = rows;
    _lastFetch[cacheKey] = now;
    return rows;
  }

  /* ---- Public: clear cache ---- */
  function clearCache(key) {
    if (key) {
      delete _cache[key]; delete _lastFetch[key];
      if (key === 'transactions') try { localStorage.removeItem(LS_KEY_TXN); } catch (_) {}
    } else {
      _cache = {}; _lastFetch = {};
      try { localStorage.removeItem(LS_KEY_TXN); } catch (_) {}
    }
  }

  /* ---- Public: current USD/ILS rate ---- */
  async function getFxRate() {
    const health = await getHealth();
    return health?.fx?.rate ?? null;
  }

  /* ---- Public: real-time stock prices (from REALTIMEDATA sheet) ----
     Returns the raw API response { values: [[header,...], [row,...], ...] }
     so callers can do index-based header scanning (like New1.html) instead
     of relying on exact column-name matches.                               */
  async function getRealTimeData(force = false) {
    const cacheKey = "realtime";
    const now = Date.now();
    const RT_TTL = 60 * 1000; // 1 min
    // force=true bypasses the cache — used by the live-price polling loop.
    if (!force && _cache[cacheKey] && (now - _lastFetch[cacheKey]) < RT_TTL) return _cache[cacheKey];
    const data = await _fetch({ resource: "realtime" });
    _cache[cacheKey]     = data;   // cache raw { values: [[...]] }
    _lastFetch[cacheKey] = now;
    return data;
  }

  return { getHealth, getTransactions, getStockHistory, getFxRate, getRealTimeData, clearCache, login };
})();
