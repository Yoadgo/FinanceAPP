/**
 * Stock DB Builder (Google Sheets + Apps Script) — Integrated (v5)
 * - History sheets: Close + Volume + CleanDate (A:B:C:D)
 * - Web API: history endpoint (resource=history&symbol=XXX)
 * - Existing endpoints: transactions, realtime, usd_ils, health
 */

// =================== CONFIG ===================
const CFG = {
  transactionsSheet: "Transactions",
  realtimeSheet: "RealTimeData",
  symbolsSheet: "Symbols", // optional mapping: Symbol | GoogleSymbol
  historyPrefix: "H_",     // <-- IMPORTANT: set to "H_" if your tabs are H_XXX
  logSheet: "Log",

  headerRow: 1,

  // Header detection (supports Hebrew + English)
  symbolHeaderCandidates: ["סימבול", "Symbol", "Ticker", "טיקר"],
  dateHeaderCandidates: ["תאריך", "Date"],
  typeHeaderCandidates: ["פעולה", "Action", "Type"],

  // BUY detection
  buyKeywords: ["קניה", "קנייה", "BUY"],

  fallbackStartDate: new Date("2022-01-01"),
  endDateFormula: "=TODAY()",

  realtimeColumns: 5, // A:E

  // Triggers
  dbDailyHour: 6,          // 06:00 daily
  realtimeEveryMinutes: 5, // 1/5/10/15/30

  // ===== FX (USD/ILS) SHEET CONFIG =====
  fxSheetName: "USD_ILS",
  fxRateCell: "B2",
  fxAsOfCell: "A2",

  // ===== HISTORY EXPORT DEFAULTS =====
  historyDefaultLimit: 4000
};

// =================== אימות ומושבים ===================
/*
 * המצב לפני הבלוק הזה: הפריסה פתוחה ל"כולם", הלקוח שולח fetch בלי שום אסימון,
 * וכתובת ה-/exec יושבת בריפו ציבורי. כלומר כל מי שמחזיק בכתובת קורא את כל
 * התנועות. הבלוק הזה סוגר את זה ברמת האפליקציה ולא ברמת הפריסה — וזה מכוון:
 * הלקוח הוא אתר סטטי שקורא cross-origin בלי עוגיות, אז פריסה שדורשת חשבון
 * גוגל הייתה מחזירה דף התחברות במקום JSON ושוברת את האפליקציה. ההגנה חייבת
 * לשבת בתוך doGet.
 *
 * המושב: מחרוזת חתומה HMAC-SHA256 בצורה  base64(email|exp|epoch).signature
 *   • email  — מי התחבר.
 *   • exp    — מתי פג. אחרי זה הלקוח מתבקש להתחבר שוב.
 *   • epoch  — "דור" המושבים. העלאת הדור מבטלת בבת אחת את כל המושבים בכל
 *              המכשירים, בלי לגעת בסוד ובלי לשנות שום דבר אחר.
 * הסוד עצמו נוצר פעם אחת ונשמר ב-Script Properties. הוא לעולם לא בקוד —
 * הריפו ציבורי.
 *
 * המתג עצמו (AUTH_REQUIRED) יושב ב-Script Properties ולא בקוד. זה מכוון:
 * הדלקה וכיבוי שלו לא דורשים פריסה מחדש, ולכן אם משהו משתבש אפשר לכבות
 * אותו תוך שניות מהעורך במקום לעבור מחזור שלם של עריכה־שמירה־פריסה.
 * enableAuth() / disableAuth() עושים בדיוק את זה.
 */
var AUTH = {
  ttlDays: 30,
  pRequire: 'AUTH_REQUIRED',
  pSecret: 'SESSION_SECRET',
  pEpoch:  'SESSION_EPOCH',
  pPass:   'ACCESS_PASSPHRASE'
};

/* נקודות קצה שמותרות בלי מושב. health נשאר פתוח כדי שהלקוח יוכל לבדוק חיבור
   לפני שהוא בכלל יודע אם יש לו מושב — אבל הוא מחזיר פחות כשאין. */
var AUTH_PUBLIC = { health: true, login: true };

function props_() { return PropertiesService.getScriptProperties(); }

/* המתג נקרא פעם אחת לכל ריצה ונשמר בזיכרון — api_ בודק אותו כמה פעמים. */
var _authRequireCache = null;
function authRequired_() {
  if (_authRequireCache === null) {
    _authRequireCache = props_().getProperty(AUTH.pRequire) === '1';
  }
  return _authRequireCache;
}

function sessionSecret_() {
  var p = props_(), s = p.getProperty(AUTH.pSecret);
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty(AUTH.pSecret, s); }
  return s;
}

function sessionEpoch_() {
  var p = props_(), e = p.getProperty(AUTH.pEpoch);
  if (!e) { e = '1'; p.setProperty(AUTH.pEpoch, e); }
  return e;
}

function b64_(str) {
  return Utilities.base64EncodeWebSafe(str).replace(/=+$/, '');
}

function sign_(payload) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payload, sessionSecret_())
  ).replace(/=+$/, '');
}

function makeSession_(email) {
  var payload = [email, Date.now() + AUTH.ttlDays * 86400000, sessionEpoch_()].join('|');
  return b64_(payload) + '.' + sign_(payload);
}

/** מחזירה { email, exp } למושב תקין, או null. לא זורקת — הקורא מחליט. */
function verifySession_(token) {
  if (!token) return null;
  var parts = String(token).split('.');
  if (parts.length !== 2) return null;

  var payload;
  try {
    payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  } catch (e) { return null; }

  if (sign_(payload) !== parts[1]) return null;      // חתימה לא תואמת
  var f = payload.split('|');
  if (f.length !== 3) return null;
  if (Number(f[1]) < Date.now()) return null;        // פג תוקף
  if (f[2] !== sessionEpoch_()) return null;         // דור ישן — בוטל
  return { email: f[0], exp: Number(f[1]) };
}

/** התחברות בסיסמה. השהייה מכוונת בכישלון — מייקרת ניחוש בכוח גס. */
function handleLogin_(params) {
  var expected = props_().getProperty(AUTH.pPass);
  if (!expected) throw new Error('ACCESS_PASSPHRASE not set');
  if (String(params.pass || '') !== expected) {
    Utilities.sleep(700);
    throw new Error('unauthorized');
  }
  return { session: makeSession_('owner'), expiresInDays: AUTH.ttlDays };
}

/* ---------- להרצה ידנית מהעורך ---------- */

/** פעם אחת: יוצרת סוד, דור, וסיסמת גישה אם אין. הסיסמה נדפסת ליומן הביצוע. */
function setupAuth() {
  sessionSecret_();
  sessionEpoch_();
  var p = props_();
  if (!p.getProperty(AUTH.pPass)) {
    p.setProperty(AUTH.pPass, Utilities.getUuid().slice(0, 8));
  }
  if (p.getProperty(AUTH.pRequire) === null) p.setProperty(AUTH.pRequire, '0');
  Logger.log('ACCESS_PASSPHRASE: ' + p.getProperty(AUTH.pPass));
  Logger.log('SESSION_EPOCH: ' + p.getProperty(AUTH.pEpoch));
  Logger.log('AUTH_REQUIRED: ' + p.getProperty(AUTH.pRequire));
  return 'ok';
}

/** מדליק את השער. מרגע זה כל בקשת נתונים דורשת מושב. אין צורך בפריסה. */
function enableAuth() {
  props_().setProperty(AUTH.pRequire, '1');
  Logger.log('אימות נדרש: כן');
  return 'on';
}

/** מכבה את השער — חזרה מיידית למצב פתוח. זו רשת הביטחון אם משהו נשבר. */
function disableAuth() {
  props_().setProperty(AUTH.pRequire, '0');
  Logger.log('אימות נדרש: לא');
  return 'off';
}

/** מתג חירום. מנתק כל מכשיר, מיד. הסיסמה עצמה לא משתנה. */
function revokeAllSessions() {
  var p = props_();
  var next = String(Number(sessionEpoch_()) + 1);
  p.setProperty(AUTH.pEpoch, next);
  Logger.log('כל המושבים בוטלו. דור חדש: ' + next);
  return next;
}

/** מחליפה את סיסמת הגישה ומנתקת את כל המכשירים באותה פעולה. */
function rotatePassphrase() {
  var pass = Utilities.getUuid().slice(0, 8);
  props_().setProperty(AUTH.pPass, pass);
  revokeAllSessions();
  Logger.log('ACCESS_PASSPHRASE חדש: ' + pass);
  return pass;
}

// =================== MENU ===================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("StocksData")
    .addItem("Build/Refresh ALL (History + RealTime)", "buildRefreshAll")
    .addSeparator()
    .addItem("Refresh History Only", "refreshDatabaseDaily")
    .addItem("Refresh RealTime Only", "refreshRealtime")
    .addSeparator()
    .addItem("Install Auto Refresh Triggers", "installAutoRefreshTriggers")
    .addItem("Remove Auto Refresh Triggers", "removeAutoRefreshTriggers")
    .addSeparator()
    .addItem("Open Log Sheet", "openLogSheet")
    .addToUi();
}

function openLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ensureLogSheet_(ss);
  ss.setActiveSheet(sh);
}

// =================== MAIN ===================
function buildRefreshAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const runId = newRunId_();
  logRunStart_(ss, runId, "buildRefreshAll");

  try {
    const historyRes = buildOrUpdateHistoryOnly_(ss, runId);
    const rtRes = updateRealtimeOnly_(ss, runId);

    logRunEnd_(ss, runId, "OK", {
      historyCreated: historyRes.createdSheets.length,
      historyUpdated: historyRes.updatedSheets.length,
      realtimeAdded: rtRes.addedTickers.length
    });
  } catch (e) {
    logRunEnd_(ss, runId, "ERROR", { message: String(e?.message || e) });
    throw e;
  }
}

// =================== AUTO JOBS ===================
function refreshDatabaseDaily() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const runId = newRunId_();
  logRunStart_(ss, runId, "refreshDatabaseDaily");

  try {
    const historyRes = buildOrUpdateHistoryOnly_(ss, runId);
    logRunEnd_(ss, runId, "OK", {
      historyCreated: historyRes.createdSheets.length,
      historyUpdated: historyRes.updatedSheets.length
    });
  } catch (e) {
    logRunEnd_(ss, runId, "ERROR", { message: String(e?.message || e) });
    throw e;
  }
}

function refreshRealtime() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const runId = newRunId_();
  logRunStart_(ss, runId, "refreshRealtime");

  try {
    const rtRes = updateRealtimeOnly_(ss, runId);
    logRunEnd_(ss, runId, "OK", { realtimeAdded: rtRes.addedTickers.length });
  } catch (e) {
    logRunEnd_(ss, runId, "ERROR", { message: String(e?.message || e) });
    throw e;
  }
}

// =================== TRIGGERS ===================
function installAutoRefreshTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const runId = newRunId_();
  logRunStart_(ss, runId, "installAutoRefreshTriggers");

  try {
    const removedDb = deleteTriggersByHandler_("refreshDatabaseDaily");
    const removedRt = deleteTriggersByHandler_("refreshRealtime");

    ScriptApp.newTrigger("refreshDatabaseDaily")
      .timeBased()
      .everyDays(1)
      .atHour(CFG.dbDailyHour)
      .create();

    ScriptApp.newTrigger("refreshRealtime")
      .timeBased()
      .everyMinutes(CFG.realtimeEveryMinutes)
      .create();

    logEvent_(ss, runId, "TRIGGERS_INSTALLED", {
      dbDailyHour: CFG.dbDailyHour,
      realtimeEveryMinutes: CFG.realtimeEveryMinutes,
      removedDbTriggers: removedDb,
      removedRealtimeTriggers: removedRt
    });

    logRunEnd_(ss, runId, "OK", {});
  } catch (e) {
    logRunEnd_(ss, runId, "ERROR", { message: String(e?.message || e) });
    throw e;
  }
}

function removeAutoRefreshTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const runId = newRunId_();
  logRunStart_(ss, runId, "removeAutoRefreshTriggers");

  try {
    const removedDb = deleteTriggersByHandler_("refreshDatabaseDaily");
    const removedRt = deleteTriggersByHandler_("refreshRealtime");
    logEvent_(ss, runId, "TRIGGERS_REMOVED", { removedDbTriggers: removedDb, removedRealtimeTriggers: removedRt });
    logRunEnd_(ss, runId, "OK", {});
  } catch (e) {
    logRunEnd_(ss, runId, "ERROR", { message: String(e?.message || e) });
    throw e;
  }
}

function deleteTriggersByHandler_(handlerName) {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction && t.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  return removed;
}

// =================== CORE: HISTORY ONLY ===================
function buildOrUpdateHistoryOnly_(ss, runId) {
  const txSheet = ss.getSheetByName(CFG.transactionsSheet);
  if (!txSheet) throw new Error(`Missing sheet: ${CFG.transactionsSheet}`);

  const { symbols, firstBuyBySymbol } = getSymbolsAndFirstBuyDateFromTransactions_(txSheet);
  const map = getSymbolsMapIfExists_(ss);

  const createdSheets = [];
  const updatedSheets = [];

  symbols.forEach(symbol => {
    const googleSymbol = normalizeGoogleSymbol_(symbol, map[symbol]);
    const firstBuy = firstBuyBySymbol[symbol];
    const startDate = firstBuy ? subtractMonths_(firstBuy, 6) : CFG.fallbackStartDate;

    const res = ensureHistorySheetCloseVolume_(ss, symbol, googleSymbol, startDate);
    if (res.created) createdSheets.push(symbol);
    else updatedSheets.push(symbol);
  });

  if (createdSheets.length) logEvent_(ss, runId, "HISTORY_SHEETS_CREATED", { count: createdSheets.length, symbols: createdSheets.join(",") });
  if (updatedSheets.length) logEvent_(ss, runId, "HISTORY_SHEETS_UPDATED", { count: updatedSheets.length, symbols: updatedSheets.join(",") });

  return { createdSheets, updatedSheets };
}

// =================== CORE: REALTIME ONLY ===================
function updateRealtimeOnly_(ss, runId) {
  const txSheet = ss.getSheetByName(CFG.transactionsSheet);
  if (!txSheet) throw new Error(`Missing sheet: ${CFG.transactionsSheet}`);

  const { symbols } = getSymbolsAndFirstBuyDateFromTransactions_(txSheet);
  const map = getSymbolsMapIfExists_(ss);

  const res = ensureRealTimeDataDelta_(ss, symbols, map);

  if (res.addedTickers.length) {
    logEvent_(ss, runId, "REALTIME_TICKERS_ADDED", { count: res.addedTickers.length, symbols: res.addedTickers.join(",") });
  } else {
    logEvent_(ss, runId, "REALTIME_NO_CHANGES", {});
  }

  return res;
}

// =================== TRANSACTIONS PARSING ===================
function getSymbolsAndFirstBuyDateFromTransactions_(sheet) {
  const headerRow = CFG.headerRow;
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= headerRow) return { symbols: [], firstBuyBySymbol: {} };

  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());

  const idxSym = findHeaderIndex_(headers, CFG.symbolHeaderCandidates);
  const idxDate = findHeaderIndex_(headers, CFG.dateHeaderCandidates);
  const idxType = findHeaderIndex_(headers, CFG.typeHeaderCandidates);

  if (idxSym === -1) throw new Error(`Could not find symbol column in ${CFG.transactionsSheet}. Expected: ${CFG.symbolHeaderCandidates.join(", ")}`);
  if (idxDate === -1) throw new Error(`Could not find date column in ${CFG.transactionsSheet}. Expected: ${CFG.dateHeaderCandidates.join(", ")}`);
  if (idxType === -1) throw new Error(`Could not find type/action column in ${CFG.transactionsSheet}. Expected: ${CFG.typeHeaderCandidates.join(", ")}`);

  const data = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();

  const set = new Set();
  const firstBuyBySymbol = {};

  data.forEach(row => {
    const rawSym = row[idxSym];
    if (!rawSym) return;

    const sym = String(rawSym).trim().toUpperCase();
    if (!isValidTicker_(sym)) return;

    set.add(sym);

    const rawType = row[idxType] ? String(row[idxType]).trim().toUpperCase() : "";
    const isBuy = CFG.buyKeywords.some(k => rawType.includes(String(k).toUpperCase()));
    if (!isBuy) return;

    const d = toDate_(row[idxDate]);
    if (!d) return;

    if (!firstBuyBySymbol[sym] || d.getTime() < firstBuyBySymbol[sym].getTime()) {
      firstBuyBySymbol[sym] = d;
    }
  });

  return { symbols: [...set].sort(), firstBuyBySymbol };
}

// =================== SYMBOLS MAP (OPTIONAL) ===================
function getSymbolsMapIfExists_(ss) {
  const symSheet = ss.getSheetByName(CFG.symbolsSheet);
  if (!symSheet) return {};
  return getSymbolToGoogleMap_(symSheet);
}

function getSymbolToGoogleMap_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};

  const headers = values[0].map(h => String(h || "").trim());
  const idxS = headers.indexOf("Symbol");
  const idxG = headers.indexOf("GoogleSymbol");
  if (idxS === -1 || idxG === -1) return {};

  const map = {};
  for (let r = 1; r < values.length; r++) {
    const s = values[r][idxS];
    if (!s) continue;
    const key = String(s).trim().toUpperCase();
    const g = values[r][idxG] ? String(values[r][idxG]).trim() : "";
    if (g) map[key] = g;
  }
  return map;
}

function normalizeGoogleSymbol_(symbol, googleSymbolFromMap) {
  if (googleSymbolFromMap && String(googleSymbolFromMap).trim()) {
    return String(googleSymbolFromMap).trim();
  }
  return symbol;
}

// =================== HISTORY SHEETS (CLOSE + VOLUME) ===================
function ensureHistorySheetCloseVolume_(ss, symbol, googleSymbol, startDate) {
  const sheetName = safeSheetName_(`${CFG.historyPrefix}${symbol}`);
  let sh = ss.getSheetByName(sheetName);
  const created = !sh;
  if (!sh) sh = ss.insertSheet(sheetName);

  // Metadata
  sh.getRange("A1").setValue("Symbol").setFontWeight("bold");
  sh.getRange("B1").setValue(symbol);

  sh.getRange("A2").setValue("GoogleSymbol").setFontWeight("bold");
  sh.getRange("B2").setValue(googleSymbol);

  sh.getRange("A3").setValue("StartDate").setFontWeight("bold");
  sh.getRange("B3").setValue(startDate || CFG.fallbackStartDate).setNumberFormat("yyyy-mm-dd");

  sh.getRange("A4").setValue("EndDate").setFontWeight("bold");
  sh.getRange("B4").setFormula(CFG.endDateFormula);

  // Table headers (Row 6)
  sh.getRange("A6").setValue("Date").setFontWeight("bold");
  sh.getRange("B6").setValue("Close").setFontWeight("bold");
  sh.getRange("C6").setValue("Volume").setFontWeight("bold");
  sh.getRange("D6").setValue("CleanDate").setFontWeight("bold");

  // Clear existing table area (A:D)
  const lastRow = sh.getLastRow();
  if (lastRow > 6) sh.getRange(7, 1, lastRow - 6, 4).clearContent();

  // Close table (Date + Close)
  sh.getRange("A7").setFormula(`=GOOGLEFINANCE($B$2,"close",$B$3,$B$4,"DAILY")`);

  // Volume aligned to Close dates by VLOOKUP (Date+Volume table returned by GOOGLEFINANCE)
  sh.getRange("C7").setFormula(
    `=ARRAYFORMULA(IF(A7:A="",,IFERROR(VLOOKUP(A7:A,GOOGLEFINANCE($B$2,"volume",$B$3,$B$4,"DAILY"),2,FALSE),)))`
  );

  // CleanDate stays in D (as yyyy-mm-dd)
  sh.getRange("D7").setFormula(`=ARRAYFORMULA(IF(A7:A="",,INT(A7:A)))`);
  sh.getRange("D7:D").setNumberFormat("yyyy-mm-dd");

  sh.setFrozenRows(6);
  sh.autoResizeColumns(1, 4);

  return { created };
}

// =================== REALTIME DATA (DELTA ONLY) ===================
function ensureRealTimeDataDelta_(ss, symbols, map) {
  const sheetName = CFG.realtimeSheet;
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);

  sh.getRange(1, 1, 1, CFG.realtimeColumns)
    .setValues([["Symbol", "GoogleSymbol", "Price", "ChangePct", "UpdatedAt"]]);
  sh.getRange(1, 1, 1, CFG.realtimeColumns).setFontWeight("bold");

  const lastRow = sh.getLastRow();

  const existing = (lastRow >= 2)
    ? sh.getRange(2, 1, lastRow - 1, 1).getValues().flat()
    : [];

  const rowBySymbol = new Map();
  existing.forEach((v, i) => {
    const s = String(v || "").trim().toUpperCase();
    if (s) rowBySymbol.set(s, i + 2);
  });

  const toAppend = [];
  const addedTickers = [];

  symbols.forEach(symRaw => {
    const sym = String(symRaw || "").trim().toUpperCase();
    if (!sym || !isValidTicker_(sym)) return;
    if (!rowBySymbol.has(sym)) {
      const googleSymbol = normalizeGoogleSymbol_(sym, map[sym]);
      toAppend.push([sym, googleSymbol, "", "", ""]);
      addedTickers.push(sym);
    }
  });

  if (toAppend.length > 0) {
    const startAppendRow = Math.max(sh.getLastRow() + 1, 2);
    sh.getRange(startAppendRow, 1, toAppend.length, CFG.realtimeColumns).setValues(toAppend);
  }

  const finalLastRow = sh.getLastRow();
  if (finalLastRow < 2) return { addedTickers };

  const table = sh.getRange(2, 1, finalLastRow - 1, CFG.realtimeColumns);
  const vals = table.getValues();

  for (let i = 0; i < vals.length; i++) {
    const row = i + 2;
    const sym = String(vals[i][0] || "").trim().toUpperCase();
    if (!sym || !isValidTicker_(sym)) continue;

    if (!vals[i][1]) {
      sh.getRange(row, 2).setValue(normalizeGoogleSymbol_(sym, map[sym]));
    }

    const priceCell = sh.getRange(row, 3);
    if (!vals[i][2] && !priceCell.getFormula()) {
      priceCell.setFormula(`=GOOGLEFINANCE(B${row},"price")`);
    }

    const chgCell = sh.getRange(row, 4);
    if (!vals[i][3] && !chgCell.getFormula()) {
      chgCell.setFormula(`=GOOGLEFINANCE(B${row},"changepct")`);
    }

    const updCell = sh.getRange(row, 5);
    if (!vals[i][4] && !updCell.getFormula()) {
      updCell.setFormula(`=NOW()`);
    }
  }

  sh.getRange(2, 5, Math.max(finalLastRow - 1, 1), 1).setNumberFormat("yyyy-mm-dd hh:mm");
  sh.autoResizeColumns(1, CFG.realtimeColumns);

  return { addedTickers };
}

// =================== LOGGING ===================
function ensureLogSheet_(ss) {
  let sh = ss.getSheetByName(CFG.logSheet);
  if (!sh) sh = ss.insertSheet(CFG.logSheet);

  const needsHeader = sh.getLastRow() === 0 || String(sh.getRange(1, 1).getValue() || "").trim() !== "Timestamp";
  if (needsHeader) {
    sh.clear();
    sh.getRange(1, 1, 1, 6).setValues([["Timestamp", "RunId", "Function", "Event", "Status", "Details"]]);
    sh.getRange(1, 1, 1, 6).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, 6);
  }
  return sh;
}

function newRunId_() {
  return Utilities.getUuid();
}

function logRunStart_(ss, runId, fnName) {
  logEvent_(ss, runId, "RUN_START", { function: fnName });
}

function logRunEnd_(ss, runId, status, detailsObj) {
  logEvent_(ss, runId, "RUN_END", detailsObj || {}, status);
}

function logEvent_(ss, runId, eventName, detailsObj, statusOpt) {
  const sh = ensureLogSheet_(ss);
  const ts = new Date();
  const status = statusOpt || "INFO";
  const details = detailsObj ? JSON.stringify(detailsObj) : "";
  sh.appendRow([ts, runId, "AppsScript", eventName, status, details]);
}

// =================== HELPERS ===================
function findHeaderIndex_(headers, candidates) {
  for (const c of candidates) {
    const i = headers.indexOf(c);
    if (i !== -1) return i;
  }
  for (let i = 0; i < headers.length; i++) {
    for (const c of candidates) {
      if (headers[i] && headers[i].includes(c)) return i;
    }
  }
  return -1;
}

function isValidTicker_(s) {
  if (!s) return false;
  const t = String(s).trim().toUpperCase();
  if (!/[A-Z]/.test(t)) return false;
  return /^[A-Z0-9.\-]+$/.test(t);
}

function toDate_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;

  if (typeof value === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + value * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }

  const s = String(value).trim();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function subtractMonths_(dateObj, months) {
  const d = new Date(dateObj.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() - months);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

function safeSheetName_(name) {
  return String(name)
    .replace(/[\[\]\*\/\\\?\:]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

// =================== FX (USD/ILS) READER ===================
function getFxUsdIls_(ss) {
  const sh = ss.getSheetByName(CFG.fxSheetName);
  if (!sh) throw new Error(`Missing FX sheet: ${CFG.fxSheetName}`);

  const rateRaw = sh.getRange(CFG.fxRateCell).getValue();
  const rate = Number(rateRaw);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`FX rate invalid in ${CFG.fxSheetName}!${CFG.fxRateCell} (value=${rateRaw})`);
  }

  const asOf = sh.getRange(CFG.fxAsOfCell).getDisplayValue();
  return {
    status: "ok",
    rate,
    asOf,
    source: `${CFG.fxSheetName}!${CFG.fxRateCell}`,
    updatedAt: new Date().toISOString()
  };
}

// =================== HISTORY EXPORT (API) ===================
function getHistorySeries_(ss, symbol, opts) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) throw new Error("history requires symbol");

  const sheetName = safeSheetName_(`${CFG.historyPrefix}${sym}`);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error(`Missing history sheet: ${sheetName}`);

  const from = (opts && opts.from) ? String(opts.from).trim() : "";
  const to = (opts && opts.to) ? String(opts.to).trim() : "";
  const limit = (opts && Number.isFinite(opts.limit)) ? opts.limit : CFG.historyDefaultLimit;

  // Read A:D from row 7 downwards (Date, Close, Volume, CleanDate)
  const lastRow = sh.getLastRow();
  if (lastRow < 8) return { symbol: sym, count: 0, rows: [] };

  const numRows = lastRow - 6;
  const values = sh.getRange(7, 1, numRows, 4).getValues(); // A:D

  const rows = [];
  for (let i = 0; i < values.length; i++) {
    const r = values[i];

    const closeRaw = r[1];
    const volumeRaw = r[2];
    const cleanDateRaw = r[3];

    // We trust CleanDate (D) to be the normalized date.
    // In Sheets, CleanDate is usually a Date object or number; use display value if needed.
    let dateStr = "";
    if (cleanDateRaw instanceof Date && !isNaN(cleanDateRaw.getTime())) {
      dateStr = Utilities.formatDate(cleanDateRaw, "UTC", "yyyy-MM-dd");
    } else if (typeof cleanDateRaw === "number") {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + cleanDateRaw * 86400 * 1000);
      dateStr = isNaN(d.getTime()) ? "" : Utilities.formatDate(d, "UTC", "yyyy-MM-dd");
    } else {
      dateStr = String(cleanDateRaw || "").trim();
    }

    const close = Number(closeRaw);
    const volume = Number(volumeRaw);

    if (!dateStr || !Number.isFinite(close)) continue;

    // range filter
    if (from && dateStr < from) continue;
    if (to && dateStr > to) continue;

    rows.push({
      date: dateStr,
      close,
      volume: Number.isFinite(volume) ? volume : null
    });
  }

  // Keep chronological order (the sheet is already chronological, but just in case)
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Apply limit from the end (most recent)
  const finalRows = (limit && rows.length > limit) ? rows.slice(rows.length - limit) : rows;

  return { symbol: sym, count: finalRows.length, rows: finalRows };
}

// =================== WEB API (for HTML) ===================
// URL usage examples:
// .../exec?resource=realtime
// .../exec?resource=transactions
// .../exec?resource=usd_ils
// .../exec?resource=history&symbol=AMD&from=2023-01-01&to=2024-12-31&limit=2000
// .../exec?resource=health

function doGet(e) {
  try {
    const resource = (e && e.parameter && e.parameter.resource) ? String(e.parameter.resource) : "health";
    const payload = api_(resource, e && e.parameter ? e.parameter : {});
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, resource, ...payload }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function api_(resource, params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = String(resource || "").trim().toLowerCase();

  // ── שער האימות ──
  // כל מה שאינו ב-AUTH_PUBLIC דורש מושב תקין. המתג נקרא מ-Script Properties,
  // כך שאפשר לפתוח ולסגור בלי פריסה מחדש.
  const gate = authRequired_() && !AUTH_PUBLIC[r];
  if (gate && !verifySession_(params.session)) throw new Error("unauthorized");

  if (r === "login") return handleLogin_(params);

  if (r === "health") {
    let fx = null;
    try { fx = getFxUsdIls_(ss); } catch (e) { fx = { status: "error", message: String(e?.message || e) }; }

    // רשימת הטאבים היא מידע על המבנה. כשהשער סגור היא נמסרת רק למי שמחובר.
    const known = !authRequired_() || !!verifySession_(params.session);
    return {
      spreadsheetId: known ? ss.getId() : undefined,
      sheets: known ? ss.getSheets().map(s => s.getName()) : undefined,
      authRequired: authRequired_(),
      authenticated: known,
      now: new Date().toISOString(),
      fx
    };
  }

  if (r === "realtime") {
    const sh = ss.getSheetByName(CFG.realtimeSheet);
    if (!sh) throw new Error("Missing sheet: " + CFG.realtimeSheet);
    const values = sh.getDataRange().getValues();
    return { values };
  }

  if (r === "transactions") {
    const sh = ss.getSheetByName(CFG.transactionsSheet);
    if (!sh) throw new Error("Missing sheet: " + CFG.transactionsSheet);
    const values = sh.getDataRange().getValues();
    return { values };
  }

  if (r === "usd_ils" || r === "usdils") {
    const fx = getFxUsdIls_(ss);
    return fx;
  }

  // ===== HISTORY ENDPOINT (NEW) =====
  if (r === "history") {
    const symbol = params.symbol || params.ticker || params.sym;
    const from = params.from ? String(params.from) : "";
    const to = params.to ? String(params.to) : "";
    const limit = params.limit ? Number(params.limit) : CFG.historyDefaultLimit;

    const series = getHistorySeries_(ss, symbol, { from, to, limit });
    return { ...series };
  }

  throw new Error("Unknown resource: " + resource);
}
