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

  SpreadsheetApp.getUi().createMenu('קליטה')
    .addItem('הרצה יבשה — בלי לכתוב כלום', 'ingestDryRun')
    .addItem('קליטה מהתיקייה', 'ingestRun')
    .addSeparator()
    .addItem('זריעת כללי סיווג', 'seedRules')
    .addItem('זריעת קטגוריות', 'seedCategories')
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

// =================== שכבת כתיבה (שלב 2) ===================
/*
  נתיב הכתיבה היחיד מהאפליקציה לגיליון.

  שלושה עקרונות שקובעים את כל מה שלמטה:

  1. **אותו שער, לא שער חדש.** `doPost` היא נקודת כניסה שנייה, ונקודת כניסה
     שנייה היא בדיוק איך נוצרת דלת אחורית. לכן היא קוראת ל-`verifySession_`
     — אותה פונקציה של הקריאה — ולא בודקת דבר בעצמה.
     **הבדל אחד מכוון מהקריאה:** מתג `AUTH_REQUIRED` פותח *קריאה* בלבד.
     כתיבה דורשת מושב תמיד, גם כשהמתג כבוי. הסיבה: המתג הוא רשת ביטחון
     שנועדה למנוע מהאפליקציה להישבר, ואילו כתובת כתיבה פתוחה על URL ציבורי
     היא איך שגיליון נמחק. `login` נשאר ציבורי גם כשהמתג כבוי, ולכן הלקוח
     תמיד יכול להשיג מושב.

  2. **מנעול על כל כתיבה.** ל-Apps Script אין טרנזקציות. שתי כתיבות
     שרצות במקביל על אותו טווח = נתון שנעלם בשקט.

  3. **אידמפוטנטיות.** כל כתיבה נושאת `writeId` שהלקוח מייצר. ניסיון חוזר
     אחרי שגיאת רשת — כשהכתיבה בעצם הצליחה — מחזיר את התוצאה המקורית
     במקום ליצור רשומה שנייה. הקבלה יושבת ב-CacheService (TTL טבעי,
     בלי טאב נוסף), והתיעוד הקבוע יושב בטאב `Log` שכבר עובד.
*/

var WRITE = {
  accountsSheet:  'Accounts',
  legacyAccounts: 'Protfolios',   // שם עם שגיאת כתיב. נשאר במקומו — CFG וקוד קיים מפנים אליו.
  researchSheet:  'ResearchNotes',
  fxHistorySheet: 'USD_ILS_History',
  lockMs: 20000,
  receiptTtlSec: 21600            // 6 שעות
};

/* חשבונות — הטבלה מתוכננת מהיום לכל הסוגים, גם אם הממשק בשלב 2 מציג רק
   תיקי השקעות. העלות היא עמודה אחת; החלופה היא מיגרציה על נתונים חיים בשלב 4. */
var ACCOUNT_COLS  = ['Id', 'Name', 'Type', 'Currency', 'Institution', 'Last4', 'Status', 'Notes', 'UpdatedAt'];
var ACCOUNT_TYPES = { brokerage: 1, bank: 1, card: 1, loan: 1, pension: 1 };

/* ניירות — נכתב לטאב `Symbols` שכבר מוגדר ב-CFG וכבר לא קיים.
   `getSymbolToGoogleMap_` מאתר עמודות לפי שם כותרת, ולכן עמודות נוספות
   אינן שוברות אותו, ושורה בלי GoogleSymbol פשוט לא נכנסת למפה. */
var INSTRUMENT_COLS = ['Symbol', 'GoogleSymbol', 'Name', 'Type', 'Currency', 'Sector', 'Status', 'Notes', 'UpdatedAt'];

var RESEARCH_COLS = ['Id', 'Date', 'Symbol', 'Kind', 'Title', 'Body', 'Tags', 'UpdatedAt'];

// ---------- תשתית ----------

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var body;
  try {
    /* הלקוח שולח `text/plain` בכוונה. `application/json` הופך את הבקשה
       ל-preflighted, הדפדפן שולח OPTIONS, ו-Apps Script לא יודע לענות
       על OPTIONS — הבקשה נכשלת לפני שהיא מגיעה לקוד הזה. */
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    body = JSON.parse(raw);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'bad request body' });
  }

  var action = String((body && body.action) || '').trim().toLowerCase();
  try {
    var payload = writeApi_(action, body) || {};
    payload.ok = true;
    payload.action = action;
    return jsonOut_(payload);
  } catch (err) {
    return jsonOut_({ ok: false, action: action, error: String(err && err.message ? err.message : err) });
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(WRITE.lockMs)) throw new Error('busy');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* חייבת להיקרא **בתוך** המנעול: אחרת שתי בקשות עם אותו writeId
   יפספסו שתיהן את המטמון ויכתבו פעמיים. */
function writeOnce_(writeId, fn) {
  if (!writeId) throw new Error('missing writeId');
  var cache = CacheService.getScriptCache();
  var key = 'w:' + String(writeId);
  var prior = null;
  try { prior = cache.get(key); } catch (e) { prior = null; }
  if (prior) {
    var p = JSON.parse(prior);
    p.replayed = true;
    return p;
  }
  var result = fn() || {};
  try { cache.put(key, JSON.stringify(result), WRITE.receiptTtlSec); } catch (e) {}
  return result;
}

/* יצירה אידמפוטנטית: טאב נוצר רק אם חסר, עמודה נוספת רק אם חסרה,
   וסדר העמודות הקיים לא משתנה. שורות נתונים לא נגעות לעולם. */
function ensureSheetWithCols_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  var created = false;
  if (!sh) { sh = ss.insertSheet(name); created = true; }

  var headers = [];
  if (sh.getLastRow() >= 1 && sh.getLastColumn() >= 1) {
    headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });
    while (headers.length && headers[headers.length - 1] === '') headers.pop();
  }

  var added = [];
  cols.forEach(function (c) {
    if (headers.indexOf(c) === -1) { headers.push(c); added.push(c); }
  });

  if (added.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return { sheet: sh, headers: headers, added: added, created: created };
}

/* קריאת טבלה לאובייקטים לפי שם כותרת — כך שסדר העמודות בגיליון
   לא מחייב את הקוד, וגם עמודה שיועד הוסיף ידנית שורדת. */
function readTable_(sh) {
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h || '').trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1 };
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      o[headers[c]] = values[r][c];
      if (String(values[r][c] || '').trim() !== '') empty = false;
    }
    if (!empty) rows.push(o);
  }
  return { headers: headers, rows: rows };
}

function writeRow_(sh, headers, rowIndex, obj) {
  var line = headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : '';
  });
  sh.getRange(rowIndex, 1, 1, headers.length).setValues([line]);
}

function nowIso_() { return new Date().toISOString(); }

// ---------- הנתב ----------

function writeApi_(action, body) {
  if (!action) throw new Error('missing action');

  /* אותה בדיקה של הקריאה, בלי רשימת היתר. אין פעולת כתיבה ציבורית. */
  if (!verifySession_(body.session)) throw new Error('unauthorized');

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // קריאה בלבד — בלי מנעול ובלי writeId
  if (action === 'accounts.list')    return { accounts:    listAccounts_(ss) };
  if (action === 'instruments.list') return { instruments: listInstruments_(ss) };

  return withLock_(function () {
    return writeOnce_(body.writeId, function () {
      var out;
      if (action === 'accounts.upsert')       out = upsertAccount_(ss, body);
      else if (action === 'accounts.rename')  out = renameAccount_(ss, body);
      else if (action === 'accounts.archive') out = archiveAccount_(ss, body);
      else if (action === 'instruments.upsert') out = upsertInstrument_(ss, body);
      else if (action === 'instruments.archive') out = archiveInstrument_(ss, body);
      else {
        out = (typeof ingestApiWrite_ === 'function') ? ingestApiWrite_(ss, action, body) : null;
        if (!out) throw new Error('Unknown action: ' + action);
      }

      try { logEvent_(ss, 'write', 'WRITE', { action: action, writeId: body.writeId, result: out }, 'OK'); } catch (e) {}
      return out;
    });
  });
}

// ---------- חשבונות ----------

function accountsSheet_(ss) {
  var e = ensureSheetWithCols_(ss, WRITE.accountsSheet, ACCOUNT_COLS);
  migrateLegacyAccounts_(ss, e);
  return e;
}

/* קליטה חד־פעמית מ-`Protfolios`. אידמפוטנטית: שם שכבר קיים ב-Accounts
   לא נוצר שוב ולא נדרס. הטאב המקורי נשאר במקומו. */
function migrateLegacyAccounts_(ss, e) {
  var legacy = ss.getSheetByName(WRITE.legacyAccounts);
  if (!legacy) return 0;

  var have = {};
  readTable_(e.sheet).rows.forEach(function (r) {
    have[String(r.Name || '').trim().toLowerCase()] = true;
  });

  var added = 0;
  readTable_(legacy).rows.forEach(function (r) {
    var name = String(r.Portfolio || r.Name || '').trim();
    if (!name || have[name.toLowerCase()]) return;
    e.sheet.appendRow(objToLine_(e.headers, {
      Id: Utilities.getUuid(),
      Name: name,
      Type: 'brokerage',
      Currency: '',
      Institution: '',
      Last4: '',
      Status: 'active',
      Notes: 'נקלט אוטומטית מ-' + WRITE.legacyAccounts,
      UpdatedAt: nowIso_()
    }));
    have[name.toLowerCase()] = true;
    added++;
  });
  return added;
}

function objToLine_(headers, obj) {
  return headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : '';
  });
}

function listAccounts_(ss) {
  var e = accountsSheet_(ss);
  return readTable_(e.sheet).rows.map(function (r) {
    return {
      id: String(r.Id || ''), name: String(r.Name || ''), type: String(r.Type || ''),
      currency: String(r.Currency || ''), institution: String(r.Institution || ''),
      last4: String(r.Last4 || ''), status: String(r.Status || 'active'),
      notes: String(r.Notes || '')
    };
  });
}

function upsertAccount_(ss, body) {
  var e = accountsSheet_(ss);
  var t = readTable_(e.sheet);

  var name = String(body.name || '').trim();
  var type = String(body.type || '').trim().toLowerCase();
  if (!name) throw new Error('שם חשבון הוא שדה חובה');
  if (!ACCOUNT_TYPES[type]) throw new Error('סוג חשבון לא מוכר: ' + type);

  /* ארבע ספרות בלבד. מספר כרטיס מלא לא נשמר, גם אם נשלח. */
  var last4 = String(body.last4 || '').replace(/\D/g, '');
  if (last4.length > 4) last4 = last4.slice(-4);

  var id = String(body.id || '').trim();
  var existing = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (id && String(t.rows[i].Id || '') === id) { existing = t.rows[i]; break; }
  }

  // שם כפול נדחה — הוא המפתח שהתנועות מפנות אליו.
  for (var j = 0; j < t.rows.length; j++) {
    var other = t.rows[j];
    if (existing && other._row === existing._row) continue;
    if (String(other.Name || '').trim().toLowerCase() === name.toLowerCase()) {
      throw new Error('כבר קיים חשבון בשם "' + name + '"');
    }
  }

  /* שינוי שם דרך upsert חסום בכוונה: השם הוא המפתח שאליו מפנות 1,326
     שורות תנועות, ומפתח מנוע ה-FIFO הוא (portfolio, symbol). שינוי שם
     בלי לכתוב מחדש את התנועות מוחק את ההיסטוריה בשקט. יש לזה פעולה
     ייעודית — `accounts.rename` — שמראה מראש כמה שורות ישתנו. */
  if (existing && String(existing.Name || '').trim() !== name) {
    throw new Error('שינוי שם חשבון נעשה דרך accounts.rename בלבד');
  }

  var rec = {
    Id: existing ? existing.Id : (id || Utilities.getUuid()),
    Name: name,
    Type: type,
    Currency: String(body.currency || (existing ? existing.Currency : '') || ''),
    Institution: String(body.institution || (existing ? existing.Institution : '') || ''),
    Last4: last4 || (existing ? String(existing.Last4 || '') : ''),
    Status: String(body.status || (existing ? existing.Status : '') || 'active'),
    Notes: String(body.notes != null ? body.notes : (existing ? existing.Notes : '') || ''),
    UpdatedAt: nowIso_()
  };

  if (existing) writeRow_(e.sheet, e.headers, existing._row, rec);
  else e.sheet.appendRow(objToLine_(e.headers, rec));

  return { id: rec.Id, created: !existing };
}

/* המלכודת המרכזית של השלב. בלי `confirm` זו תצוגה מקדימה בלבד. */
function renameAccount_(ss, body) {
  var e = accountsSheet_(ss);
  var t = readTable_(e.sheet);

  var id = String(body.id || '').trim();
  var newName = String(body.newName || '').trim();
  if (!id) throw new Error('missing id');
  if (!newName) throw new Error('שם חדש הוא שדה חובה');

  var row = null;
  for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i].Id || '') === id) { row = t.rows[i]; break; }
  if (!row) throw new Error('חשבון לא נמצא');

  var oldName = String(row.Name || '').trim();
  if (oldName === newName) return { changed: 0, renamed: false, note: 'השם זהה' };

  for (var j = 0; j < t.rows.length; j++) {
    if (t.rows[j]._row === row._row) continue;
    if (String(t.rows[j].Name || '').trim().toLowerCase() === newName.toLowerCase()) {
      throw new Error('כבר קיים חשבון בשם "' + newName + '"');
    }
  }

  var tx = ss.getSheetByName(CFG.transactionsSheet);
  if (!tx) throw new Error('Missing sheet: ' + CFG.transactionsSheet);
  var lastRow = tx.getLastRow(), lastCol = tx.getLastColumn();
  var headers = tx.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
  var pIdx = headers.indexOf('Portfolio');
  if (pIdx === -1) throw new Error('Transactions has no Portfolio column');

  var colVals = lastRow > 1 ? tx.getRange(2, pIdx + 1, lastRow - 1, 1).getValues() : [];
  var hits = [];
  for (var k = 0; k < colVals.length; k++) {
    if (String(colVals[k][0] || '').trim() === oldName) hits.push(k);
  }

  if (!body.confirm) {
    return { preview: true, renamed: false, oldName: oldName, newName: newName, rowsAffected: hits.length };
  }

  // כתיבה אחת לכל העמודה, בתוך אותו מנעול שבו נכתבת שורת החשבון.
  for (var m = 0; m < hits.length; m++) colVals[hits[m]][0] = newName;
  if (colVals.length) tx.getRange(2, pIdx + 1, colVals.length, 1).setValues(colVals);

  row.Name = newName;
  row.UpdatedAt = nowIso_();
  writeRow_(e.sheet, e.headers, row._row, row);

  return { renamed: true, oldName: oldName, newName: newName, rowsAffected: hits.length };
}

/* אין מחיקה קשה לחשבון שיש לו תנועות — היא הופכת אותן ליתומות.
   חשבון בלי תנועות נמחק; חשבון עם תנועות עובר לארכיון. */
function archiveAccount_(ss, body) {
  var e = accountsSheet_(ss);
  var t = readTable_(e.sheet);
  var id = String(body.id || '').trim();
  if (!id) throw new Error('missing id');

  var row = null;
  for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i].Id || '') === id) { row = t.rows[i]; break; }
  if (!row) throw new Error('חשבון לא נמצא');

  var name = String(row.Name || '').trim();
  var refs = countPortfolioRefs_(ss, name);

  if (refs === 0 && body.hard) {
    e.sheet.deleteRow(row._row);
    return { deleted: true, archived: false, rowsReferencing: 0 };
  }

  row.Status = 'archived';
  row.UpdatedAt = nowIso_();
  writeRow_(e.sheet, e.headers, row._row, row);
  return { deleted: false, archived: true, rowsReferencing: refs };
}

function countPortfolioRefs_(ss, name) {
  var tx = ss.getSheetByName(CFG.transactionsSheet);
  if (!tx || tx.getLastRow() < 2) return 0;
  var headers = tx.getRange(1, 1, 1, tx.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
  var pIdx = headers.indexOf('Portfolio');
  if (pIdx === -1) return 0;
  var vals = tx.getRange(2, pIdx + 1, tx.getLastRow() - 1, 1).getValues();
  var n = 0;
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0] || '').trim() === name) n++;
  return n;
}

// ---------- ניירות ----------

function instrumentsSheet_(ss) {
  return ensureSheetWithCols_(ss, CFG.symbolsSheet, INSTRUMENT_COLS);
}

function listInstruments_(ss) {
  var e = instrumentsSheet_(ss);
  return readTable_(e.sheet).rows.map(function (r) {
    return {
      symbol: String(r.Symbol || ''), googleSymbol: String(r.GoogleSymbol || ''),
      name: String(r.Name || ''), type: String(r.Type || ''),
      currency: String(r.Currency || ''), sector: String(r.Sector || ''),
      status: String(r.Status || 'active'), notes: String(r.Notes || '')
    };
  });
}

function upsertInstrument_(ss, body) {
  var e = instrumentsSheet_(ss);
  var t = readTable_(e.sheet);

  var symbol = String(body.symbol || '').trim().toUpperCase();
  if (!symbol) throw new Error('סימבול הוא שדה חובה');
  if (!isValidTicker_(symbol)) throw new Error('סימבול לא חוקי: ' + symbol);

  /* GoogleSymbol שגוי גורם ל-buildRefreshAll למשוך היסטוריה של נייר אחר,
     והתוצאה נראית תקינה לגמרי. לכן הוא נבדק כאן ולא רק בממשק. */
  var google = String(body.googleSymbol || '').trim();
  if (google && !/^[A-Za-z0-9.:\-]+$/.test(google)) throw new Error('GoogleSymbol לא חוקי: ' + google);

  var existing = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i].Symbol || '').trim().toUpperCase() === symbol) { existing = t.rows[i]; break; }
  }

  var rec = {
    Symbol: symbol,
    GoogleSymbol: google || (existing ? String(existing.GoogleSymbol || '') : ''),
    Name: String(body.name != null ? body.name : (existing ? existing.Name : '') || ''),
    Type: String(body.type != null ? body.type : (existing ? existing.Type : '') || ''),
    Currency: String(body.currency != null ? body.currency : (existing ? existing.Currency : '') || ''),
    Sector: String(body.sector != null ? body.sector : (existing ? existing.Sector : '') || ''),
    Status: String(body.status || (existing ? existing.Status : '') || 'active'),
    Notes: String(body.notes != null ? body.notes : (existing ? existing.Notes : '') || ''),
    UpdatedAt: nowIso_()
  };

  if (existing) writeRow_(e.sheet, e.headers, existing._row, rec);
  else e.sheet.appendRow(objToLine_(e.headers, rec));

  return { symbol: symbol, created: !existing };
}

function archiveInstrument_(ss, body) {
  var e = instrumentsSheet_(ss);
  var t = readTable_(e.sheet);
  var symbol = String(body.symbol || '').trim().toUpperCase();
  if (!symbol) throw new Error('missing symbol');

  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i].Symbol || '').trim().toUpperCase() === symbol) {
      var row = t.rows[i];
      row.Status = 'archived';
      row.UpdatedAt = nowIso_();
      writeRow_(e.sheet, e.headers, row._row, row);
      return { symbol: symbol, archived: true };
    }
  }
  throw new Error('נייר לא נמצא: ' + symbol);
}

// ---------- הרצה חד־פעמית מהעורך ----------

/* יוצר את כל הטאבים של שלב 2 ומריץ את הקליטה מ-Protfolios.
   בטוח להרצה חוזרת: שום שורה קיימת לא נדרסת ושום עמודה לא נמחקת. */
function setupPhase2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var a = accountsSheet_(ss);
  var i = instrumentsSheet_(ss);
  var r = ensureSheetWithCols_(ss, WRITE.researchSheet, RESEARCH_COLS);
  var out = {
    accounts:    { created: a.created, colsAdded: a.added, rows: readTable_(a.sheet).rows.length },
    instruments: { created: i.created, colsAdded: i.added, rows: readTable_(i.sheet).rows.length },
    research:    { created: r.created, colsAdded: r.added }
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/* היסטוריית שער דולר בנוסחה אחת, לטאב **נפרד**.
   הטאב `USD_ILS` הקיים לא נגע: `getFxUsdIls_` קורא ממנו B2/A2, וכתיבה
   לתוכו הייתה שוברת את שער החליפין החי בכל האפליקציה. */
function importFxHistory() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(WRITE.fxHistorySheet);
  if (!sh) sh = ss.insertSheet(WRITE.fxHistorySheet);
  if (sh.getLastRow() > 2) { Logger.log('כבר מאוכלס — לא נגעתי. שורות: ' + sh.getLastRow()); return { skipped: true, rows: sh.getLastRow() }; }
  sh.getRange('A1').setFormula('=GOOGLEFINANCE("CURRENCY:USDILS","close",DATE(2020,1,1),TODAY(),"DAILY")');
  SpreadsheetApp.flush();
  Utilities.sleep(3000);
  Logger.log('נכתב. שורות: ' + sh.getLastRow());
  return { skipped: false, rows: sh.getLastRow() };
}


// =================== מטמון היסטוריה ===================
/*
  למה זה קיים — הממצא שהוביל לכאן, כדי שלא נחזור עליו:

  ההנחה הייתה ש"מספר הקריאות הוא המדד" ולכן קריאה מרוכזת תפתור את 30
  השניות של הגרף. נמדד מול הייצור והתברר כחלקי בלבד:
      4 ניירות  →  6.0 שניות, עובד
     10 ניירות  → 18.3 שניות, **נכשל**
     27 ניירות  → נכשל
  כלומר לקריאה יש גם עלות **לפי כמות**: ~1.5–1.8 שניות לנייר, כי כל טאב
  H_ מכיל ~1,250 שורות שנקראות ומעובדות מחדש בכל טעינה. איגוד קריאות לא
  נוגע בזה בכלל.

  התיקון האמיתי הוא להזיז את העלות מנתיב הבקשה לעבודה לילית:
  `buildHistoryCache` קוראת את כל הטאבים **פעם ביום** ומייצרת מחרוזת JSON
  אחת מוכנה. הבקשה עצמה כבר לא קוראת 27 טאבים ולא מסדרת כלום — היא
  מדביקה מחרוזות ומחזירה. זו הסיבה שהתשובה נמסרת גולמית ב-doGet ולא
  עוברת דרך api_: רגע שבו מפרקים ומרכיבים מחדש 470 אלף תווים מחזיר בדיוק
  את העלות שניסינו להעיף.

  הפורמט דחוס בכוונה: { "AAPL": { "d":[ימים מאז 1.1.1970], "c":[מחירים] } }.
  תאריך כמספר במקום "YYYY-MM-DD" חוסך שליש מהגודל, והלקוח ממיר בחזרה.
*/

var HCACHE = {
  sheet: 'HistoryCache',
  chunkChars: 45000,        // תא בגיליון מוגבל ל-50,000 תווים
  pBuiltAt: 'HISTORY_CACHE_BUILT_AT',
  pSymbols: 'HISTORY_CACHE_SYMBOLS',
  pPoints:  'HISTORY_CACHE_POINTS',
  budgetMs: 270000          // 4.5 דקות מתוך 6 — משאיר מקום לכתיבה
};

/* בונה את המטמון. מיועדת לטריגר יומי, ובטוחה גם להרצה ידנית.
   אם הזמן נגמר לפני שכל הניירות עובדו — כותבת את מה שיש ומדווחת מי חסר,
   כי מטמון חלקי עם רשימה כנה עדיף על כישלון שמשאיר מטמון ישן בלי שאיש ידע. */
function buildHistoryCache() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var runId = newRunId_();
  logRunStart_(ss, runId, 'buildHistoryCache');
  var t0 = Date.now();

  try {
    var txSheet = ss.getSheetByName(CFG.transactionsSheet);
    if (!txSheet) throw new Error('Missing sheet: ' + CFG.transactionsSheet);
    var symbols = getSymbolsAndFirstBuyDateFromTransactions_(txSheet).symbols;

    var parts = [], done = [], skipped = [], points = 0;
    for (var i = 0; i < symbols.length; i++) {
      if (Date.now() - t0 > HCACHE.budgetMs) { skipped = symbols.slice(i); break; }
      var sym = symbols[i];
      var series;
      try { series = getHistorySeries_(ss, sym, { from: '', to: '', limit: CFG.historyDefaultLimit }); }
      catch (e) { skipped.push(sym); continue; }

      var rows = series.rows || [];
      if (!rows.length) { skipped.push(sym); continue; }

      /* כל נקודה נבדקת לפני שהיא נכנסת. הסיבה מעשית: המחרוזת הזו נמסרת
         ללקוח **בלי parse בצד השרת**, ולכן ערך אחד לא תקין (NaN מתאריך
         חריג, למשל) הופך את כל המטמון ל-JSON פסול — והתקלה תתגלה רק
         אצל המשתמש. עדיף לדלג על נקודה מאשר להרעיל את הקובץ כולו. */
      var d = [], c = [];
      for (var k = 0; k < rows.length; k++) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(rows[k].date || ''));
        if (!m) continue;
        var day = Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
        var close = Number(rows[k].close);
        if (!isFinite(day) || !isFinite(close)) continue;
        d.push(day); c.push(close);
      }
      if (!d.length) { skipped.push(sym); continue; }

      parts.push(JSON.stringify(sym) + ':{"d":[' + d.join(',') + '],"c":[' + c.join(',') + ']}');
      done.push(sym);
      points += d.length;
    }

    var blob = '{' + parts.join(',') + '}';

    var sh = ss.getSheetByName(HCACHE.sheet);
    if (!sh) sh = ss.insertSheet(HCACHE.sheet);
    sh.clear();
    sh.getRange(1, 1, 1, 2).setValues([['Idx', 'Chunk']]).setFontWeight('bold');
    var chunks = [];
    for (var o = 0; o < blob.length; o += HCACHE.chunkChars) {
      chunks.push([chunks.length + 1, blob.substr(o, HCACHE.chunkChars)]);
    }
    if (chunks.length) sh.getRange(2, 1, chunks.length, 2).setValues(chunks);
    sh.setFrozenRows(1);

    var p = props_();
    p.setProperty(HCACHE.pBuiltAt, new Date().toISOString());
    p.setProperty(HCACHE.pSymbols, done.join(','));
    p.setProperty(HCACHE.pPoints, String(points));

    var out = { symbols: done.length, skipped: skipped, points: points, chars: blob.length, chunks: chunks.length, ms: Date.now() - t0 };
    logRunEnd_(ss, runId, 'OK', out);
    Logger.log(JSON.stringify(out, null, 2));
    return out;
  } catch (e) {
    logRunEnd_(ss, runId, 'ERROR', { message: String(e && e.message ? e.message : e) });
    throw e;
  }
}

/* מחזירה את המחרוזת השמורה בלי לפרק אותה. */
function readHistoryCacheBlob_(ss) {
  var sh = ss.getSheetByName(HCACHE.sheet);
  if (!sh || sh.getLastRow() < 2) return null;
  var vals = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues();
  var out = '';
  for (var i = 0; i < vals.length; i++) out += String(vals[i][0] || '');
  return out || null;
}

/* טריגר יומי. רץ אחרי refreshDatabaseDaily כדי שהמטמון ישקף את ההיסטוריה
   המעודכנת ולא את זו של אתמול. */
function installHistoryCacheTrigger() {
  var removed = deleteTriggersByHandler_('buildHistoryCache');
  ScriptApp.newTrigger('buildHistoryCache')
    .timeBased().everyDays(1).atHour(CFG.dbDailyHour + 1).create();
  Logger.log('טריגר יומי הותקן לשעה ' + (CFG.dbDailyHour + 1) + ':00. ישנים שהוסרו: ' + removed);
  return 'ok';
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
    const params = e && e.parameter ? e.parameter : {};

    /* מסלול גולמי למטמון ההיסטוריה. הוא **לא** עובר דרך api_ בכוונה:
       api_ מחזירה אובייקט ש-JSON.stringify מסדר מחדש, ופירוק והרכבה של
       ~470 אלף תווים מחזירים בדיוק את העלות שהמטמון נועד להעיף. כאן
       המחרוזת השמורה נדחפת לתוך המעטפת בהדבקה, בלי parse ובלי stringify.
       השער נאכף לפני — אותה בדיקה, בלי קיצור דרך. */
    if (String(resource).trim().toLowerCase() === "history_cache") {
      if (authRequired_() && !verifySession_(params.session)) throw new Error("unauthorized");
      const ss2 = SpreadsheetApp.getActiveSpreadsheet();
      const blob = readHistoryCacheBlob_(ss2);
      if (!blob) throw new Error("history cache not built");
      const pr = props_();
      return ContentService.createTextOutput(
        '{"ok":true,"resource":"history_cache","builtAt":' + JSON.stringify(pr.getProperty(HCACHE.pBuiltAt) || '') +
        ',"symbols":' + JSON.stringify(String(pr.getProperty(HCACHE.pSymbols) || '').split(',').filter(Boolean)) +
        ',"series":' + blob + '}'
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const payload = api_(resource, params);
    return jsonOut_({ ok: true, resource, ...payload });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) });
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

  /* מנוע הקליטה (Ingest.gs) מוסיף נקודות קצה משלו. השער כבר נאכף
     למעלה; משאב שלו אינו ב-AUTH_PUBLIC ולכן דורש מושב. הבדיקה typeof
     מאפשרת ל-Code.gs לעבוד גם בלעדיו — וזה מכוון. */
  if (typeof ingestApiRead_ === 'function') {
    var _ing = ingestApiRead_(ss, r, params);
    if (_ing) return _ing;
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

  if (r === "fx_history" || r === "fxhistory") {
    return getFxHistory_(ss);
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

  // ===== BATCH ENDPOINTS =====
  /* שתי הנקודות האלה קיימות מסיבה אחת: **מספר הקריאות הוא המדד, לא גודל
     הנתונים.** נמדד בייצור — כל קריאה ל-Apps Script עולה ~2.5–3.4 שניות של
     הלוך־חזור בלי קשר לכמות. לכן 27 קריאות היסטוריה = 30 שניות, ו-Promise.all
     כמעט לא עוזר כי הבקשות מסודרות בתור. קריאה אחת מחזירה את כולן ב-~3. */

  if (r === "histories") {
    const raw = String(params.symbols || params.syms || "").trim();
    if (!raw) throw new Error("histories requires symbols");
    const list = raw.split(",")
      .map(x => String(x || "").trim().toUpperCase())
      .filter(x => x && isValidTicker_(x));
    if (!list.length) throw new Error("histories: no valid symbols");
    if (list.length > 60) throw new Error("histories: too many symbols (max 60)");

    const from = params.from ? String(params.from) : "";
    const to = params.to ? String(params.to) : "";
    const limit = params.limit ? Number(params.limit) : CFG.historyDefaultLimit;

    const series = {}, missing = [];
    const seen = {};
    list.forEach(sym => {
      if (seen[sym]) return;
      seen[sym] = true;
      // נייר בלי טאב היסטוריה אינו שגיאה — הוא מדווח ב-missing והשאר נמסר.
      try { series[sym] = getHistorySeries_(ss, sym, { from, to, limit }); }
      catch (e) { missing.push(sym); }
    });
    return { series, missing, count: Object.keys(series).length };
  }

  if (r === "bootstrap") {
    const out = {};
    const txSh = ss.getSheetByName(CFG.transactionsSheet);
    if (!txSh) throw new Error("Missing sheet: " + CFG.transactionsSheet);
    out.transactions = { values: txSh.getDataRange().getValues() };

    // מחירים חיים ושער — נחמדים אבל לא קריטיים. כישלון בהם לא מפיל את הטעינה.
    try {
      const rtSh = ss.getSheetByName(CFG.realtimeSheet);
      out.realtime = rtSh ? { values: rtSh.getDataRange().getValues() } : null;
    } catch (e) { out.realtime = null; }
    try { out.fx = getFxUsdIls_(ss); } catch (e) { out.fx = null; }

    return out;
  }

  // history_cache מטופל ב-doGet לפני הקריאה לכאן. אם הגענו — זו טעות תכנות.
  if (r === "history_cache") throw new Error("history_cache is handled in doGet");

  throw new Error("Unknown resource: " + resource);
}


/* ================================================================
   ייבוא חד-פעמי — תיק אלטשולר שחם טרייד, חשבון 59560
   ----------------------------------------------------------------
   מקור: שלושה דוחות תקופתיים (PDF) 09/2025, 12/2025, 03/2026.
   37 שורות מקור → 37 שורות כאן, יחס 1:1. אף שורה לא נזרקה.

   אומת לפני הכתיבה מול הדוחות עצמם:
     • החזקות ועלות רכישה — 16/16 התאמות מדויקות בשלושה צילומי
       יתרות בלתי-תלויים (30/09/25, 31/12/25, 31/03/26).
     • סגירת מזומן — ₪1,110.11 מול 1,110.10 בדוח, $428.93 מול 428.91.
       הפרש עיגול לשתי ספרות, לא שורה חסרה.

   מוסכמות שנבחרו (ר' tax_presentation_model.md):
     • דיבידנד נכתב **נטו** — כך אלטשולר מציגה, וכך גם נכנס לחשבון.
     • המס בשקלים יושב ב-EstimatedTax כי הוא **אינו תנועת מזומן**
       (נוכה במקור). שום מספר לא נגזר; הברוטו לא נכתב.
     • המרת מט"ח → "קניה שח" עם סימבול 99028, כמו באיביאי.
     • "מתנה" → "שונות מזומן בשח" (אושר ע"י יועד).

   אידמפוטנטית: מסרבת לרוץ אם כבר קיימת ולו שורה אחת של אלטשולר.
   ================================================================ */
var ALT_PORTFOLIO = 'אלטשולר';

function importAltshuler() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('לא הצלחתי לתפוס מנעול');
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(CFG.transactionsSheet);
    if (!sh) throw new Error('אין טאב Transactions');

    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var pIdx = headers.indexOf('Portfolio');
    if (pIdx === -1) throw new Error('אין עמודת Portfolio');

    var last = sh.getLastRow();
    if (last > 1) {
      var existing = sh.getRange(2, pIdx + 1, last - 1, 1).getValues();
      for (var i = 0; i < existing.length; i++) {
        if (String(existing[i][0]).trim() === ALT_PORTFOLIO) {
          var msg = 'אלטשולר כבר קיים בגיליון (שורה ' + (i + 2) + '). לא נכתב כלום.';
          Logger.log(msg);
          return msg;
        }
      }
    }

    var data = ALT_ROWS_();
    if (data.length !== 37) throw new Error('צפויות 37 שורות, יש ' + data.length);

    sh.getRange(last + 1, 1, data.length, 14).setValues(data);
    SpreadsheetApp.flush();

    var out = 'נכתבו ' + data.length + ' שורות אלטשולר, שורות ' +
              (last + 1) + '-' + (last + data.length);
    Logger.log(out);
    try { logEvent_(newRunId_(), 'importAltshuler', 'WRITE', 'OK', out); } catch (e) {}
    return out;
  } finally {
    lock.releaseLock();
  }
}

function ALT_ROWS_() {
  return [
  [new Date(2025,7,21),"העברה מזומן בשח","העברה","",5000,0,"₪ ",0,0,0,5000,5000,0,"אלטשולר"],
  [new Date(2025,7,22),"קניה חול מטח","iShares Bitcoin Trust","IBIT",10,63.54,"$ ",5,0,-640.4,0,5000,0,"אלטשולר"],
  [new Date(2025,7,22),"קניה שח","המרת מט\"ח","99028",640.4,3.398,"₪ ",0,0,0,-2176.48,2823.52,0,"אלטשולר"],
  [new Date(2025,7,25),"קניה חול מטח","iShares Ethereum Trust","ETHA",15,34.88,"$ ",5.05,0,-528.25,0,2823.52,0,"אלטשולר"],
  [new Date(2025,7,25),"קניה שח","המרת מט\"ח","99028",528.25,3.406,"₪ ",0,0,0,-1799.42,1024.1,0,"אלטשולר"],
  [new Date(2025,7,28),"העברה מזומן בשח","העברה","",50000,0,"₪ ",0,0,0,50000,51024.1,0,"אלטשולר"],
  [new Date(2025,7,28),"קניה חול מטח","iShares Bitcoin Trust","IBIT",45,64.23,"$ ",5.35,0,-2895.7,0,51024.1,0,"אלטשולר"],
  [new Date(2025,7,28),"קניה חול מטח","iShares Ethereum Trust","ETHA",40,34.84,"$ ",5.3,0,-1398.9,0,51024.1,0,"אלטשולר"],
  [new Date(2025,7,28),"קניה חול מטח","Invesco QQQ Trust","QQQ",10,573.56,"$ ",5,0,-5740.6,0,51024.1,0,"אלטשולר"],
  [new Date(2025,7,28),"קניה חול מטח","NVIDIA Corporation","NVDA",5,178.12,"$ ",4.95,0,-895.55,0,51024.1,0,"אלטשולר"],
  [new Date(2025,7,28),"קניה חול מטח","Palantir Technologies","PLTR",10,156.31,"$ ",5,0,-1568.1,0,51024.1,0,"אלטשולר"],
  [new Date(2025,7,28),"קניה חול מטח","iShares Core S&P 500 ETF","IVV",4,650.55,"$ ",4.94,0,-2607.14,0,51024.1,0,"אלטשולר"],
  [new Date(2025,7,28),"קניה שח","המרת מט\"ח","99028",15105.99,3.352,"₪ ",0,0,0,-50636.81,387.29,0,"אלטשולר"],
  [new Date(2025,8,8),"שונות מזומן בשח","מתנה","900",800,0,"₪ ",0,0,0,800,1187.29,0,"אלטשולר"],
  [new Date(2025,8,19),"הפקדה דיבידנד מטח","דיב/ IVV US","99028",4,0,"$ ",0,0,5.98,0,1187.29,-6.66,"אלטשולר"],
  [new Date(2025,9,2),"הפקדה דיבידנד מטח","דיב/ NVDA US","99028",5,0,"$ ",0,0,0.04,0,1187.29,-0.04,"אלטשולר"],
  [new Date(2025,9,31),"הפקדה דיבידנד מטח","דיב/ QQQ US","99028",10,0,"$ ",0,0,5.21,0,1187.29,-5.63,"אלטשולר"],
  [new Date(2025,11,19),"הפקדה דיבידנד מטח","דיב/ IVV US","99028",4,0,"$ ",0,0,7.24,0,1187.29,-7.74,"אלטשולר"],
  [new Date(2025,11,26),"הפקדה דיבידנד מטח","דיב/ NVDA US","99028",5,0,"$ ",0,0,-42.42,0,1187.29,-135.32,"אלטשולר"],
  [new Date(2025,11,26),"הפקדה דיבידנד מטח","דיב/ NVDA US","99028",5,0,"$ ",0,0,42.42,0,1187.29,135.32,"אלטשולר"],
  [new Date(2025,11,26),"קניה שח","המרת מט\"ח","99028",23.95,3.223,"₪ ",0,0,0,-77.18,1110.11,0,"אלטשולר"],
  [new Date(2025,11,28),"הפקדה דיבידנד מטח","דיב/ NVDA US","99028",5,0,"$ ",0,0,0.04,0,1110.11,-0.04,"אלטשולר"],
  [new Date(2025,11,28),"הפקדה דיבידנד מטח","דיב/ NVDA US","99028",5,0,"$ ",0,0,-0.04,0,1110.11,0.04,"אלטשולר"],
  [new Date(2025,11,26),"הפקדה דיבידנד מטח","דיב/ NVDA US","99028",5,0,"$ ",0,0,0.04,0,1110.11,-0.04,"אלטשולר"],
  [new Date(2025,11,26),"הפקדה דיבידנד מטח","דיב/ NVDA US","99028",5,0,"$ ",0,0,-0.04,0,1110.11,0.04,"אלטשולר"],
  [new Date(2025,11,26),"הפקדה דיבידנד מטח","דיב/ NVDA US","99028",5,0,"$ ",0,0,0.04,0,1110.11,-0.04,"אלטשולר"],
  [new Date(2025,11,26),"הפקדה דיבידנד מטח","דיב/ NVDA US","99028",5,0,"$ ",0,0,-0.04,0,1110.11,0.04,"אלטשולר"],
  [new Date(2025,11,26),"הפקדה דיבידנד מטח","דיב/ NVDA US","99028",5,0,"$ ",0,0,0.04,0,1110.11,-0.04,"אלטשולר"],
  [new Date(2025,11,31),"הפקדה דיבידנד מטח","דיב/ QQQ US","99028",10,0,"$ ",0,0,5.95,0,1110.11,-6.34,"אלטשולר"],
  [new Date(2026,1,12),"מכירה חול מטח","Palantir Technologies","PLTR",10,129.72,"$ ",4.9,0,1292.3,0,1110.11,0,"אלטשולר"],
  [new Date(2026,1,12),"מכירה חול מטח","NVIDIA Corporation","NVDA",5,188.2,"$ ",4.9,0,936.1,0,1110.11,0,"אלטשולר"],
  [new Date(2026,1,12),"קניה חול מטח","iShares Ethereum Trust","ETHA",50,14.545,"$ ",4.9,0,-732.15,0,1110.11,0,"אלטשולר"],
  [new Date(2026,1,12),"קניה חול מטח","iShares Bitcoin Trust","IBIT",30,37.3891,"$ ",4.9,0,-1126.57,0,1110.11,0,"אלטשולר"],
  [new Date(2026,2,20),"הפקדה דיבידנד מטח","דיב/ IVV US","99028",4,0,"$ ",0,0,5.35,0,1110.11,-5.54,"אלטשולר"],
  [new Date(2026,2,20),"הפקדה דיבידנד מטח","דיב/ IVV US","99028",4,0,"$ ",0,0,-5.35,0,1110.11,5.54,"אלטשולר"],
  [new Date(2026,2,20),"הפקדה דיבידנד מטח","דיב/ IVV US","99028",4,0,"$ ",0,0,5.34,0,1110.11,-5.54,"אלטשולר"],
  [new Date(2026,2,27),"הפקדה דיבידנד מטח","דיב/ QQQ US","99028",10,0,"$ ",0,0,5.5,0,1110.11,-5.77,"אלטשולר"]
  ];
}


/* ================================================================
   מחיקה מוגנת — 9 השורות הכפולות בתיק איביאי-דר (שורות 33–41)
   ----------------------------------------------------------------
   הרקע (אומת 3.9.2026): שורות 2–41 הן בלוק רצוף של 40 שורות דר
   שהודבק בראש הגיליון, בעוד שבכל שאר הגיליון שורות דר משולבות
   בין שורות יועד ברצפים של 1–2 (151 רצפים). הגוף מכיל נתוני דר
   עד 18/05/2026 בדיוק. מתוך 40 שורות הבלוק, 9 בדיוק מתוארכות
   18/05/2026 או לפניה — והן בדיוק ה-9 שיש להן תאום בגוף.
   31 השורות האחרות (19/05–17/08) חדשות ואסור לגעת בהן.

   הפונקציה לא סומכת על מספרי שורות. לפני כל מחיקה היא מאמתת:
     1. התיק הוא איביאי-דר
     2. התאריך ‎<= 18/05/2026
     3. קיים תאום זהה **מחוץ** לטווח 33–41 שיישאר בגיליון
   אם ולו בדיקה אחת נכשלת — לא נמחק כלום.

   לפני המחיקה השורות מועתקות לטאב 'DeletedRows' כדי שיישאר תיעוד.
   (ובנוסף, היסטוריית הגרסאות של Google Sheets מאפשרת שחזור מלא.)
   ================================================================ */
var DEL = { from: 33, to: 41, portfolio: 'איביאי-דר', cutoffY: 2026, cutoffM: 5, cutoffD: 18 };

function deleteDarDuplicates() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('לא הצלחתי לתפוס מנעול');
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(CFG.transactionsSheet);
    var lastRow = sh.getLastRow(), nCols = 14;
    var all = sh.getRange(1, 1, lastRow, nCols).getValues();
    var hdr = all[0];
    var iDate = hdr.indexOf('Date'), iPort = hdr.indexOf('Portfolio');

    function fp(row) {
      var d = row[iDate];
      var ds = (d instanceof Date)
        ? [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-')
        : String(d);
      // כל העמודות פרט ל-CashBalanceILS ו-EstimatedTax
      return [ds, row[1], row[2], row[3], row[4], row[5], row[6],
              row[7], row[8], row[9], row[10], row[13]].join('|');
    }

    // מפה של כל טביעות האצבע מחוץ לטווח המחיקה
    var outside = {};
    for (var i = 1; i < all.length; i++) {
      var sheetRow = i + 1;
      if (sheetRow >= DEL.from && sheetRow <= DEL.to) continue;
      var k = fp(all[i]);
      outside[k] = (outside[k] || 0) + 1;
    }

    var plan = [], problems = [];
    for (var r = DEL.from; r <= DEL.to; r++) {
      var row = all[r - 1];
      var port = String(row[iPort]).trim();
      var d = row[iDate];
      if (port !== DEL.portfolio) { problems.push('שורה ' + r + ': תיק ' + port); continue; }
      if (!(d instanceof Date)) { problems.push('שורה ' + r + ': תאריך אינו תאריך'); continue; }
      var afterCutoff = (d.getFullYear() > DEL.cutoffY) ||
        (d.getFullYear() === DEL.cutoffY && (d.getMonth() + 1 > DEL.cutoffM ||
         (d.getMonth() + 1 === DEL.cutoffM && d.getDate() > DEL.cutoffD)));
      if (afterCutoff) { problems.push('שורה ' + r + ': תאריך אחרי 18/05/2026'); continue; }
      var k = fp(row);
      if (!outside[k]) { problems.push('שורה ' + r + ': אין תאום מחוץ לטווח'); continue; }
      plan.push({ row: r, key: k, values: row });
    }

    if (problems.length) throw new Error('בוטל, לא נמחק כלום. בעיות: ' + problems.join(' ; '));
    if (plan.length !== 9) throw new Error('בוטל: צפויות 9 שורות, נמצאו ' + plan.length);

    // תיעוד לפני מחיקה
    var log = ss.getSheetByName('DeletedRows') || ss.insertSheet('DeletedRows');
    if (log.getLastRow() === 0) log.appendRow(['DeletedAt', 'SheetRow', 'Reason'].concat(hdr));
    var stamp = new Date();
    plan.forEach(function (p) {
      log.appendRow([stamp, p.row, 'כפילות מהדבקת טווח חופף (בלוק 2–41)'].concat(p.values));
    });

    // מוחקים מלמטה למעלה כדי שהאינדקסים לא יזוזו
    for (var j = plan.length - 1; j >= 0; j--) sh.deleteRow(plan[j].row);
    SpreadsheetApp.flush();

    var out = 'נמחקו ' + plan.length + ' שורות (' + DEL.from + '–' + DEL.to +
              '), גובו ל-DeletedRows. שורות בגיליון: ' + sh.getLastRow();
    Logger.log(out);
    try { logEvent_(newRunId_(), 'deleteDarDuplicates', 'DELETE', 'OK', out); } catch (e) {}
    return out;
  } finally {
    lock.releaseLock();
  }
}


/* ================================================================
   fx_history — היסטוריית שער דולר/שקל
   ----------------------------------------------------------------
   למה זה נדרש: `getFxUsdIls_` מחזירה **תא בודד** — השער של היום.
   לכן גרף ההתפתחות המיר הפקדות שקליות היסטוריות לפי שער היום,
   בזמן שהשער נע בין 2.8005 ל-4.07615 בתקופה שהנתונים מכסים —
   תנודה של 46%. זה לא עיגול, זה עיוות בקו שכל תשואה נמדדת מולו.

   הנתונים כבר בגיליון: `USD_ILS` מכיל 1,604 שורות יומיות
   מ-01/01/2022. (`CFG.fxHistorySheet` מצביע על 'USD_ILS_History'
   שאינו קיים — לכן קוראים משם אם הוא קיים, ואחרת מ-`fxSheetName`.)

   הפלט דחוס: `d` ימים מאז 1970 ו-`r` שערים, שני מערכים מקבילים
   ממוינים עולה — ~22KB במקום ~60KB של אובייקטים.
   ================================================================ */
function getFxHistory_(ss) {
  var sh = (CFG.fxHistorySheet && ss.getSheetByName(CFG.fxHistorySheet)) ||
           ss.getSheetByName(CFG.fxSheetName);
  if (!sh) throw new Error('Missing FX sheet');

  var last = sh.getLastRow();
  if (last < 1) throw new Error('FX sheet is empty');
  var vals = sh.getRange(1, 1, last, 2).getValues();

  // מפתח לפי יום — רשומה מאוחרת דורסת מוקדמת, כך ששורת "היום"
  // בראש הגיליון לא יוצרת כפילות מול אותו תאריך בהיסטוריה.
  var byDay = {};
  for (var i = 0; i < vals.length; i++) {
    var d = vals[i][0], v = Number(vals[i][1]);
    if (!(d instanceof Date)) continue;
    if (!isFinite(v) || v <= 0) continue;
    var day = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    if (!isFinite(day)) continue;
    byDay[day] = v;
  }

  var days = [];
  for (var k in byDay) days.push(Number(k));
  days.sort(function (a, b) { return a - b; });
  if (!days.length) throw new Error('No usable FX rows');

  var rates = new Array(days.length);
  for (var j = 0; j < days.length; j++) rates[j] = byDay[days[j]];

  return {
    status: 'ok',
    resource: 'fx_history',
    n: days.length,
    from: days[0],
    to: days[days.length - 1],
    d: days,
    r: rates,
    updatedAt: new Date().toISOString()
  };
}
