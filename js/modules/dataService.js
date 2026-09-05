/* ===== DATA SERVICE — Google Apps Script / Sheets ===== */

const DataService = (() => {

  const API_URL = "https://script.google.com/macros/s/AKfycbz9uDnRY0UWQo1gSwAeW9Pfg0TmHxZVYlxBW389wcn54bnF7KK5L8MNfmUcdy196MMcyA/exec";

  const CACHE_TTL    = 5  * 60 * 1000; // 5 min  — in-memory
  const LS_TTL       = 30 * 60 * 1000; // 30 min — localStorage
  const LS_KEY_TXN   = 'fapp_txn_v1';  // bump version string to bust stale schema
  let _cache = {};
  let _lastFetch = {};
  /* נדלק פעם אחת אם השרת עוד לא מכיר את resource=histories. ר' getStockHistories. */
  let _noBatchHistories = false;
  /* נדלק פעם אחת אם המטמון היומי עוד לא נבנה. ר' getStockHistories. */
  let _noHistoryCache = false;
  /* { builtAt, symbols } מהקריאה האחרונה למטמון. ר' getHistoryCacheInfo. */
  let _cacheInfo = null;

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

  /* ---- כתיבה ----
     שלוש החלטות שנראות שרירותיות ואינן:

     1. **`text/plain` ולא `application/json`.** כותרת JSON הופכת את הבקשה
        ל-preflighted, הדפדפן שולח OPTIONS, ו-Apps Script לא יודע לענות על
        OPTIONS — הבקשה נכשלת לפני שהיא מגיעה לקוד. הגוף הוא JSON כמחרוזת.
     2. **`writeId` שנוצר כאן.** ניסיון חוזר אחרי שגיאת רשת — כשהכתיבה
        בעצם הצליחה — מחזיר את התוצאה המקורית במקום ליצור רשומה שנייה.
        המזהה נוצר פעם אחת לכל קריאה **מחוץ** ללולאת הניסיונות.
     3. **כתיבה תמיד דורשת מושב**, גם כשמתג האימות בשרת כבוי. `unauthorized`
        על כתיבה מעלה את שער הכניסה בדיוק כמו על קריאה.                    */
  function _writeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'w-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  async function post(action, payload = {}, opts = {}) {
    const body = {
      ...payload,
      action,
      writeId: opts.writeId || _writeId(),
      session: (window.FA && FA.session) ? FA.session.get() : null
    };

    const res = await fetch(API_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("Received HTML — check Apps Script permissions.");
    const data = JSON.parse(text);

    if (data.ok === false) {
      const msg = data.error || "API Error";
      if (/unauthorized/i.test(msg)) {
        if (window.FA && FA.session) {
          FA.session.clear();
          if (!FA.session.isOpen()) FA.session.open(function () {});
        }
        const e = new Error("unauthorized"); e.unauthorized = true; e.writeId = body.writeId; throw e;
      }
      const e = new Error(msg); e.writeId = body.writeId; throw e;
    }
    // כתיבה משנה נתונים בשרת — המטמון המקומי כבר לא נאמן.
    if (action.indexOf(".list") === -1) clearCache();
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

  /* ---- היסטוריה מרובה ----
     **הנחה שנבדקה בייצור והתבררה כשגויה, ולכן היא מתועדת כאן.**
     ההנחה הייתה שמספר הקריאות הוא המדד ולכן קריאה מרוכזת אחת תוריד את
     הגרף מ-30 שניות ל-3. המדידה בפועל:
       • 4 ניירות  → 6.0 שניות, עובד
       • 10 ניירות → 18.3 שניות, **נכשל** — גוגל מחזירה דף שגיאה
       • 27 ניירות → נכשל
     כלומר לקריאה יש גם עלות **לפי כמות** (~1.5–1.8 שניות לנייר: קריאת
     ~1,250 שורות מכל טאב H_ ועיבודן), ומעליה מגבלת זמן לבקשת web app.
     צוואר הבקבוק האמיתי הוא מבנה טאב-לכל-נייר — בדיוק מה שהאפיון סימן
     כשורש הבעיה. תיקון אמיתי דורש מטמון מחושב מראש, לא איגוד קריאות.

     לכן: הקריאה המרוכזת משמשת רק לקבוצות קטנות, ובכל כישלון — מכל סוג —
     נופלים לקריאות בודדות. לוח הבקרה (27 ניירות) עובר בנתיב הבודד
     המוכח, ולא מקבל רגרסיה.                                              */
  var BATCH_MAX = 6;
  async function getStockHistories(symbols) {
    const now = Date.now();
    const want = [...new Set((symbols || [])
      .map(s => String(s || "").trim().toUpperCase())
      .filter(Boolean))];

    const out = {};
    let missing = [];
    want.forEach(sym => {
      const k = `history_${sym}`;
      if (_cache[k] && (now - _lastFetch[k]) < CACHE_TTL) out[sym] = _cache[k];
      else missing.push(sym);
    });
    if (!missing.length) return out;

    /* המטמון קודם. קריאה אחת מחזירה את כל הניירות מתוך מחרוזת שנבנתה
       בעבודה לילית, במקום לקרוא 27 טאבים בזמן אמת.
       נייר שנסחר לראשונה אחרי הבנייה האחרונה פשוט לא יהיה שם — הוא נשאר
       ב-missing ויימשך בנתיב הרגיל, כך שנייר חדש אף פעם לא "נעלם".      */
    if (!_noHistoryCache) {
      try {
        const cache = await _fetch({ resource: "history_cache" });
        /* נשמר בצד כדי שמנהל הניירות יוכל לדעת למי יש היסטוריה ולמי אין,
           בלי לשלם עוד קריאה. ר' getHistoryCacheInfo. */
        _cacheInfo = { builtAt: cache.builtAt || null, symbols: cache.symbols || [] };
        const series = cache.series || {};
        const still = [];
        missing.forEach(sym => {
          const e = series[sym];
          if (!e || !Array.isArray(e.d) || !Array.isArray(e.c)) { still.push(sym); return; }
          const rows = new Array(e.d.length);
          for (let i = 0; i < e.d.length; i++) {
            rows[i] = { date: new Date(e.d[i] * 86400000).toISOString().slice(0, 10), close: e.c[i] };
          }
          out[sym] = rows;
          _cache[`history_${sym}`] = rows;
          _lastFetch[`history_${sym}`] = now;
        });
        if (!still.length) return out;
        missing = still;              // רק מה שלא היה במטמון ממשיך הלאה
      } catch (err) {
        if (err && err.unauthorized) throw err;
        _noHistoryCache = true;       // מטמון שלא נבנה עדיין — לא מנסים שוב בכל טעינה
      }
    }

    /* הקריאה המרוכזת נוסתה רק כשהיא בטוחה. כישלון **מכל סוג** מפיל אותה
       לנתיב הבודד: שרת שעוד לא נפרס עונה "Unknown resource", ושרת עמוס
       מחזיר דף HTML של גוגל — שניהם חייבים להיגמר בגרף מצויר ולא בשגיאה.
       `unauthorized` הוא היוצא מן הכלל היחיד: הוא חייב להמשיך למעלה,
       אחרת שער הכניסה לא יעלה.
       הדגל נשמר, כך שאחרי כישלון אחד לא מנסים שוב בכל טעינה.            */
    if (!_noBatchHistories && missing.length <= BATCH_MAX) {
      try {
        const data = await _fetch({ resource: "histories", symbols: missing.join(",") });
        const series = data.series || {};
        missing.forEach(sym => {
          const entry = series[sym];
          const rows = entry && Array.isArray(entry.rows) ? entry.rows : [];
          out[sym] = rows;
          _cache[`history_${sym}`] = rows;
          _lastFetch[`history_${sym}`] = now;
        });
        return out;
      } catch (err) {
        if (err && err.unauthorized) throw err;
        _noBatchHistories = true;
      }
    }

    await Promise.all(missing.map(async sym => {
      try { out[sym] = await getStockHistory(sym); } catch (_) { out[sym] = []; }
    }));
    return out;
  }

  /* ---- מי נמצא במטמון ומי לא ----
     מנהל הניירות משתמש בזה כדי לסמן נייר שאין לו היסטוריה. אם המידע כבר
     הגיע אגב טעינת הגרף — מחזירים אותו בחינם; אחרת קריאה אחת.
     נייר שנסחר אך חסר כאן פירושו שהגרף מעריך אותו לפי עלות ולא לפי שווי,
     וזה עיוות שקט שאי אפשר לראות בלי לחפש אותו.                          */
  async function getHistoryCacheInfo() {
    if (_cacheInfo) return _cacheInfo;
    try {
      const c = await _fetch({ resource: "history_cache" });
      _cacheInfo = { builtAt: c.builtAt || null, symbols: c.symbols || [] };
    } catch (e) {
      if (e && e.unauthorized) throw e;
      _cacheInfo = { builtAt: null, symbols: null };   // null = לא ידוע, לא "ריק"
    }
    return _cacheInfo;
  }

  /* ---- Public: clear cache ---- */
  function clearCache(key) {
    if (key) {
      delete _cache[key]; delete _lastFetch[key];
      if (key === 'transactions') try { localStorage.removeItem(LS_KEY_TXN); } catch (_) {}
    } else {
      _cache = {}; _lastFetch = {}; _cacheInfo = null; _noHistoryCache = false; _fxHist = null;
      try { localStorage.removeItem(LS_KEY_TXN); } catch (_) {}
    }
  }

  /* ---- Public: current USD/ILS rate ---- */
  async function getFxRate() {
    const health = await getHealth();
    return health?.fx?.rate ?? null;
  }

  /* ---- היסטוריית שער דולר/שקל ----
     1,606 שערים יומיים מ-2022, ~22KB, נקראים פעם אחת לכל טעינה.
     **נכשל בשקט בכוונה:** שרת שעוד לא נפרס עם `fx_history` יחזיר שגיאה,
     והחזרת סדרה ריקה מחזירה את המנוע לשער היום — בדיוק ההתנהגות הקודמת.
     גרף שמצויר לפי שער היום גרוע מגרף מדויק, אבל טוב לאין ערוך ממסך שגיאה.
     `unauthorized` הוא היוצא מן הכלל היחיד שממשיך למעלה.                 */
  let _fxHist = null;
  async function getFxHistory() {
    if (_fxHist) return _fxHist;
    try {
      const d = await _fetch({ resource: "fx_history" });
      _fxHist = (d && Array.isArray(d.d) && Array.isArray(d.r) && d.d.length)
        ? { d: d.d, r: d.r } : { d: [], r: [] };
    } catch (e) {
      if (e && e.unauthorized) throw e;
      _fxHist = { d: [], r: [] };
    }
    return _fxHist;
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

  return { getHealth, getTransactions, getStockHistory, getStockHistories,
           getHistoryCacheInfo, getFxRate, getFxHistory, getRealTimeData, clearCache, login, post };
})();
