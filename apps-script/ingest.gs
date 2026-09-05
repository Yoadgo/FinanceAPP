/* ============================================================================
   מנוע הקליטה — דרייב → גיליון
   ---------------------------------------------------------------------------
   שרשרת אחת: קובץ בתיקיית הקליטה → המרה לגיליון → פענוח → זיהוי כפילות →
   סיווג → כתיבה ל-Expenses + רישום ב-Imports.

   שלוש הכרעות שמעצבות את הקובץ הזה:

   1. **הקובץ נשאר בתיקייה** (החלטת יועד). לכן חייב להיות רישום, אחרת כל ריצה
      תסרוק מחדש. הרישום הוא **גיבוב תוכן**, לא שם ולא מזהה דרייב: קובץ שהורד
      פעמיים תחת שני שמות הוא אותו קובץ, וקובץ שהוחלף באותו שם הוא קובץ אחר.
      (אומת: אחד מארבעת קבצי האשראי היה כפילות בייט-לבייט של אחר.)

   2. **כפילות נבדקת ברמת השורה, לא הקובץ** — טביעת אצבע + מונה מופעים. שני
      חיובים זהים באותו יום אצל אותו סוחר הם עסקה כפולה לגיטימית; מה שמזהה
      כפילות הוא *המופע ה-N*. ספירה, לא סדר.

   3. **סיווג לא מנחש בשקט.** כלל שמתאים → מסווג. אין כלל → `pending`, ויועד
      מסווג **סוחר** (לא שורה), והאישור כותב כלל שמחיל את עצמו רטרואקטיבית.
      197 סוחרים במקום 574 שורות.

   ⚠️ תלוי ב-`creditParser.gs` (parseCreditSheet_, parseNote_, fingerprint_,
      withOccurrence_, diffAgainstExisting_).
   ============================================================================ */

var ING = {
  rootFolderId: '1o8n4O06olzgC7The8wqhsN0uJsx0Bq5L',   // FinanceAPP — קליטה
  inboxFolderId: '1HaRedYiImWkZdEyC9LVEM8gNJDG6f-xS',  // נכנס
  expensesSheet: 'Expenses',
  importsSheet:  'Imports',
  rulesSheet:    'Rules',
  maxFilesPerRun: 12
};

var EXPENSE_COLS = ['Id','Date','Card','Issuer','BillingMonth','Merchant','MerchantNorm',
  'Amount','Currency','Charge','ChargeCurrency','Note','NoteKind','Installment','Installments',
  'Category','Subcategory','Status','RuleId','Source','FileHash','SheetRow','Key','Occ',
  'CreatedAt','UpdatedAt'];

var IMPORT_COLS = ['Id','At','FileId','FileName','Hash','Kind','BillingMonth','Sections',
  'Balanced','RowsParsed','RowsAdded','RowsSkipped','Warnings','Status'];

var RULE_COLS = ['Id','Active','Priority','Field','Match','Pattern','Card','Category',
  'Subcategory','Source','Hits','CreatedAt','UpdatedAt'];

function expensesSheet_(ss) { return ensureSheetWithCols_(ss, ING.expensesSheet, EXPENSE_COLS); }
function importsSheet_(ss)  { return ensureSheetWithCols_(ss, ING.importsSheet,  IMPORT_COLS);  }
function rulesSheet_(ss)    { return ensureSheetWithCols_(ss, ING.rulesSheet,    RULE_COLS);    }

/* ── נירמול שם סוחר ──
   שם הסוחר בקובץ קטוע ל-20 תווים, לפעמים הפוך (RTL), ולפעמים מכיל ישויות
   HTML (`&amp;`). הנירמול חייב להיות **דטרמיניסטי ולא הרסני**: הוא מפתח
   התאמה, לא שם לתצוגה. השם המקורי נשמר לצד המנורמל.                      */
function normMerchant_(s) {
  var t = String(s == null ? '' : s);
  t = t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
  t = t.replace(/[‎‏‪-‮⁦-⁩]/g, '');   // סימני כיוון
  t = t.replace(/[()\[\]{}"'`.,;:*]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function hexDigest_(bytes) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  var s = '';
  for (var i = 0; i < raw.length; i++) {
    var b = (raw[i] + 256) % 256;
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

function isoDay_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
  }
  return String(v == null ? '' : v);
}

/* ============================ כללי סיווג ============================ */

/* זרע הכללים. **רק מה שאינו שנוי במחלוקת.** כל דבר שדורש שיפוט — לאן שייכת
   "טעינות חבר", האם "פספורטכארד" ביטוח או נסיעות — הולך ל`pending` ויועד
   מכריע. כלל זרע מסומן `seed` ב-Source כדי שיהיה אפשר לראות מה בא ממני. */
var SEED_RULES_ = [
  // [pattern, category, subcategory]
  ['חניון',            'תחבורה', 'חניה'],
  ['פנגו',             'תחבורה', 'חניה'],
  ['חניונים',          'תחבורה', 'חניה'],
  ['סונול',            'תחבורה', 'דלק'],
  ['YELLOW',           'תחבורה', 'דלק'],
  ['פז בחן',           'תחבורה', 'דלק'],
  ['דלק מנטה',         'תחבורה', 'דלק'],
  ['מכון רישוי',       'תחבורה', 'רכב'],
  ['איתוראן',          'תחבורה', 'רכב'],
  ['רמי לוי',          'מזון', 'סופרמרקט'],
  ['שופרסל',           'מזון', 'סופרמרקט'],
  ['סטופ מרקט',        'מזון', 'סופרמרקט'],
  ['כלל מרקט',         'מזון', 'סופרמרקט'],
  ['פמילי מרקט',       'מזון', 'סופרמרקט'],
  ['מרכולית',          'מזון', 'סופרמרקט'],
  ['צרכניית',          'מזון', 'סופרמרקט'],
  ['סופר פארם',        'בריאות', 'פארם'],
  ['סופרפארם',         'בריאות', 'פארם'],
  ['WOLT',             'מזון', 'משלוחים'],
  ['SPOTIFY',          'מנויים', 'מדיה'],
  ['PRIME VIDEO',      'מנויים', 'מדיה'],
  ['YES',              'מנויים', 'מדיה'],
  ['ANTHROPIC',        'מנויים', 'תוכנה'],
  ['TRADINGVIEW',      'מנויים', 'תוכנה'],
  ['APPLECOM',         'מנויים', 'תוכנה'],
  ['RISEUP',           'מנויים', 'תוכנה'],
  ['PAYBOX',           'העברות', 'העברה אישית'],
  ['BIT העברה',        'העברות', 'העברה אישית'],
  ['ביטוח חיים',       'ביטוח',  'ביטוח חיים'],
  ['אוניברסיטת',       'חינוך',  'לימודים']
];

function seedRules() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var e = rulesSheet_(ss);
  var t = readTable_(e.sheet);
  var have = {};
  t.rows.forEach(function (r) { have[String(r.Pattern || '').trim()] = true; });

  var add = [], now = nowIso_(), n = t.rows.length;
  SEED_RULES_.forEach(function (s) {
    if (have[s[0]]) return;
    n++;
    add.push(objToLine_(e.headers, {
      Id: 'R' + ('000' + n).slice(-4), Active: true, Priority: 100, Field: 'merchant',
      Match: 'contains', Pattern: s[0], Card: '', Category: s[1], Subcategory: s[2],
      Source: 'seed', Hits: 0, CreatedAt: now, UpdatedAt: now
    }));
  });
  if (add.length) e.sheet.getRange(e.sheet.getLastRow() + 1, 1, add.length, e.headers.length).setValues(add);
  SpreadsheetApp.getUi().alert('נוספו ' + add.length + ' כללי זרע (מתוך ' + SEED_RULES_.length + ').');
}

function loadRules_(ss) {
  var e = rulesSheet_(ss);
  var rows = readTable_(e.sheet).rows.filter(function (r) {
    return String(r.Active).toLowerCase() !== 'false' && String(r.Pattern || '').trim() !== '';
  });
  rows.forEach(function (r) {
    r._pat = String(r.Pattern).trim();
    r._patU = r._pat.toUpperCase();
    r._field = String(r.Field || 'merchant').toLowerCase();
    r._match = String(r.Match || 'contains').toLowerCase();
    r._prio = Number(r.Priority) || 100;
  });
  rows.sort(function (a, b) { return a._prio - b._prio; });
  return rows;
}

function ruleHits_(rule, rec) {
  var hay = rule._field === 'note' ? String(rec.note || '') : String(rec.merchantNorm || '');
  if (rule.Card && String(rule.Card).trim() && String(rule.Card).trim() !== String(rec.card)) return false;
  var H = hay.toUpperCase(), P = rule._patU;
  if (rule._match === 'equals') return H === P;
  if (rule._match === 'starts') return H.indexOf(P) === 0;
  if (rule._match === 'regex')  { try { return new RegExp(rule._pat, 'i').test(hay); } catch (e) { return false; } }
  return H.indexOf(P) !== -1;
}

function applyRules_(rec, rules) {
  for (var i = 0; i < rules.length; i++) {
    if (ruleHits_(rules[i], rec)) {
      return { category: rules[i].Category, subcategory: rules[i].Subcategory, ruleId: rules[i].Id };
    }
  }
  return null;
}

/* ── הצעה ── לא כלל, לא נכתבת לשום מקום. משמשת **רק** למילוי מראש של מסך
   הסיווג. אם ההצעה שגויה יועד משנה אותה במקום, ומה שנכתב הוא בחירתו.       */
var SUGGEST_ = [
  ['בייקרי|רולדין|מאפ|לחם|קייזר|קונדיטור|לוליטה|בייקר|כהנים',  'מזון', 'מאפייה'],
  ['קפה|ארומה|אספרסו|CAFE|COFFEE|קפה',                          'מזון', 'בית קפה'],
  ['בורגר|פיצה|חומוס|מסעדת|בר |סושי|גריל|שווארמה|פלאפל',        'מזון', 'מסעדה'],
  ['גלידה|גלידת|ממתקים|סוויט|דלי קרים',                          'מזון', 'ממתקים'],
  ['מרקט|צרכניה|מכולת|סופר',                                     'מזון', 'סופרמרקט'],
  ['חניון|חניה|פנגו',                                            'תחבורה', 'חניה'],
  ['דלק|פז|סונול|YELLOW|מנטה',                                   'תחבורה', 'דלק'],
  ['רכבת|מוביט|תחבורה',                                          'תחבורה', 'תחבורה ציבורית'],
  ['ביטוח|פספורטכארד|דיירקט',                                    'ביטוח', 'ביטוח'],
  ['רפואי|מכבי|כללית|שיבא|איכילוב|רמבם|קופת',                    'בריאות', 'רפואה'],
  ['פארם|טבע בריא',                                              'בריאות', 'פארם'],
  ['שיער|עיצוב|ספר |קוסמט',                                      'טיפוח', 'טיפוח'],
  ['מלון|HOTEL|נופש|DUTY FREE|טרמינל|נתבג',                      'נסיעות', 'נסיעות'],
  ['משתלה|משתלות|גינון|משק |הום|טרלידור|אקסלר',                  'בית', 'בית וגינון'],
  ['זארה|אינטימה|גוטקס|VICTORIA|ביגוד|אופנה',                    'קניות', 'ביגוד'],
  ['KSP|באג |מחשב|אלקטרו',                                        'קניות', 'אלקטרוניקה'],
  ['טעינות|חבר |מועדון|הטבות',                                   'הטבות', 'טעינת כרטיס'],
  ['מים|שטראוס',                                                 'בית', 'שירותים לבית']
];

function suggestCategory_(merchantNorm) {
  var s = String(merchantNorm || '');
  for (var i = 0; i < SUGGEST_.length; i++) {
    try { if (new RegExp(SUGGEST_[i][0], 'i').test(s)) return { category: SUGGEST_[i][1], subcategory: SUGGEST_[i][2], via: 'keyword' }; }
    catch (e) {}
  }
  return { category: '', subcategory: '', via: '' };
}

/* מילים שחוזרות אצל כולם ולכן אינן מעידות על דבר. בלעדיהן "בעמ" היה מקשר
   כל חברה בישראל לכל חברה אחרת.                                          */
var STOP_TOKENS_ = { 'בעמ':1, 'בע':1, 'מ':1, 'בית':1, 'ה':1, 'של':1, 'רשת':1,
  'LTD':1, 'THE':1, 'AND':1, 'INC':1, 'CO':1 };

function tokens_(s) {
  return String(s || '').toUpperCase().split(/[\s\-\u2013\u2014\/]+/)
    .filter(function (t) { return t.length >= 3 && !STOP_TOKENS_[t]; });
}

/* הצעה מתוך מה שכבר סווג. **זה החלק שמצטבר**: כל סוחר שיועד מסווג הופך
   לעוגן שמושך אליו סוחרים דומים בפעם הבאה. "בבקה בייקרי" מסווג → "בבקה
   הבימה" מקבל הצעה, בלי שאף אחד כתב כלל ל"בבקה".
   דורש **חפיפת אסימון מובהק** ולא דמיון מחרוזות — דמיון מחרוזות היה מקשר
   "סופר פארם" ל"סופר מרקט".                                              */
function suggestFromNeighbors_(merchantNorm, anchors) {
  var t = tokens_(merchantNorm);
  if (!t.length) return null;
  var best = null;
  for (var i = 0; i < t.length; i++) {
    var a = anchors[t[i]];
    if (!a) continue;
    if (!best || a.n > best.n) best = a;
  }
  return best ? { category: best.category, subcategory: best.subcategory, via: 'neighbor:' + best.token } : null;
}

/* בונה את מפת העוגנים מהשורות שכבר סווגו. אסימון שמופיע בשתי קטגוריות
   שונות **נפסל** — הוא לא מבחין, ולכן הצעה שמבוססת עליו תזיק.            */
function buildAnchors_(rows) {
  var m = {};
  rows.forEach(function (r) {
    var cat = String(r.Category || '').trim();
    if (!cat) return;
    var sub = String(r.Subcategory || '').trim();
    tokens_(r.MerchantNorm || r.Merchant).forEach(function (t) {
      if (!m[t]) { m[t] = { token: t, category: cat, subcategory: sub, n: 0, conflict: false }; }
      if (m[t].category !== cat) m[t].conflict = true;
      m[t].n++;
    });
  });
  var out = {};
  Object.keys(m).forEach(function (k) { if (!m[k].conflict) out[k] = m[k]; });
  return out;
}

/* ====================== קריאת קובץ מדרייב ====================== */

/* המרה דרך Drive API v3 ולא דרך שירות מתקדם, כדי לא לחייב הפעלת שירות
   בעורך. האסימון מגיע מ-ScriptApp; ההרשאה עצמה נגררת מ-DriveApp שלמעלה.
   העותק המומר **נמחק לפח בסוף** — הוא זמני בלבד.                        */
function driveSheetValues_(fileId, name) {
  var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
            '/copy?supportsAllDrives=true&fields=id';
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ name: '~conv ' + name, mimeType: MimeType.GOOGLE_SHEETS }),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('המרה נכשלה (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  var tmpId = JSON.parse(res.getContentText()).id;
  try {
    var sh = SpreadsheetApp.openById(tmpId).getSheets()[0];
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    return (lr < 1 || lc < 1) ? [] : sh.getRange(1, 1, lr, lc).getValues();
  } finally {
    try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e) {}
  }
}

/* זיהוי סוג לפי תוכן ולא לפי שם. שם קובץ הוא מוסכמה שנשברת. */
function detectKind_(values) {
  var lim = Math.min(values.length, 60);
  for (var r = 0; r < lim; r++) {
    for (var c = 0; c < values[r].length; c++) {
      var s = String(values[r][c] == null ? '' : values[r][c]);
      if (s.indexOf('כרטיס:') !== -1 && s.indexOf('חודש החיוב') !== -1) return 'credit';
    }
  }
  return 'unknown';
}

/* ====================== הקליטה עצמה ====================== */

function ingestInbox_(opts) {
  opts = opts || {};
  var dry = !!opts.dryRun;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var report = { files: [], added: 0, skipped: 0, warnings: [], dryRun: dry };

  var eImp = importsSheet_(ss);
  var seenHash = {};
  readTable_(eImp.sheet).rows.forEach(function (r) {
    if (String(r.Status) === 'ok' && r.Hash) seenHash[String(r.Hash)] = String(r.FileName || '');
  });

  var eExp = expensesSheet_(ss);
  var existing = readTable_(eExp.sheet).rows;
  var counts = {};
  existing.forEach(function (r) { var k = String(r.Key || ''); if (k) counts[k] = (counts[k] || 0) + 1; });

  var rules = loadRules_(ss);
  var nextId = existing.length;
  var toWrite = [], impRows = [], now = nowIso_();

  var it = DriveApp.getFolderById(ING.inboxFolderId).getFiles();
  var seenFiles = 0;
  while (it.hasNext() && seenFiles < ING.maxFilesPerRun) {
    var f = it.next();
    var name = f.getName();
    if (/^~conv /.test(name)) continue;
    seenFiles++;

    var hash, values;
    try {
      hash = hexDigest_(f.getBlob().getBytes());
    } catch (err) {
      report.files.push({ name: name, status: 'error', message: 'קריאת הקובץ נכשלה: ' + err });
      continue;
    }

    if (seenHash[hash]) {
      report.files.push({ name: name, status: 'duplicate-file', message: 'תוכן זהה ל-' + seenHash[hash] });
      continue;
    }

    try { values = driveSheetValues_(f.getId(), name); }
    catch (err) { report.files.push({ name: name, status: 'error', message: String(err) }); continue; }

    var kind = detectKind_(values);
    if (kind !== 'credit') {
      report.files.push({ name: name, status: 'unsupported', message: 'סוג לא מזוהה — לא נקלט' });
      continue;
    }

    var p = parseCreditSheet_(values);
    var rows = withOccurrence_(p.rows);
    var d = diffAgainstExisting_(rows, counts);
    var balanced = p.sections.filter(function (s) { return s.balanced !== false; }).length;

    var fileRec = {
      name: name, status: 'ok', kind: kind, billingMonth: p.billingMonth,
      sections: p.sections.length, balanced: balanced,
      parsed: rows.length, added: d.add.length, skipped: d.skipped,
      warnings: p.warnings.slice(0)
    };

    /* מקטע לא מאוזן פוסל את **הקובץ כולו**, לא רק את המקטע: אם סכום אחד
       לא נסגר אי אפשר לדעת אילו שורות חסרות, וקליטה חלקית גרועה מאי-קליטה. */
    if (balanced !== p.sections.length) {
      fileRec.status = 'rejected';
      fileRec.warnings.push('הקובץ נדחה — ' + (p.sections.length - balanced) + ' מקטעים לא מאוזנים.');
      report.files.push(fileRec);
      impRows.push(objToLine_(eImp.headers, {
        Id: 'I' + Utilities.getUuid().slice(0, 8), At: now, FileId: f.getId(), FileName: name,
        Hash: hash, Kind: kind, BillingMonth: p.billingMonth, Sections: p.sections.length,
        Balanced: balanced, RowsParsed: rows.length, RowsAdded: 0, RowsSkipped: 0,
        Warnings: fileRec.warnings.join(' | '), Status: 'rejected'
      }));
      continue;
    }

    d.add.forEach(function (rec) {
      var mn = normMerchant_(rec.merchantRaw);
      var note = parseNote_(rec.note);
      var m = { merchantNorm: mn, note: rec.note, card: rec.card };
      var hit = applyRules_(m, rules);
      nextId++;
      toWrite.push(objToLine_(eExp.headers, {
        Id: 'E' + ('00000' + nextId).slice(-6),
        Date: rec.date, Card: rec.card, Issuer: rec.issuer, BillingMonth: rec.billing,
        Merchant: rec.merchantRaw, MerchantNorm: mn,
        Amount: rec.amount === null ? '' : rec.amount, Currency: rec.origCurrency || 'ש"ח',
        Charge: rec.charge, ChargeCurrency: rec.chargeCurrency || 'ש"ח',
        Note: rec.note, NoteKind: note.kind,
        Installment: note.installment === null ? '' : note.installment,
        Installments: note.installments === null ? '' : note.installments,
        Category: hit ? hit.category : '', Subcategory: hit ? hit.subcategory : '',
        Status: hit ? 'ok' : 'pending', RuleId: hit ? hit.ruleId : '',
        Source: 'credit', FileHash: hash.slice(0, 12), SheetRow: rec.sheetRow,
        Key: rec.key, Occ: rec.occ, CreatedAt: now, UpdatedAt: now
      }));
      counts[rec.key] = (counts[rec.key] || 0) + 1;
    });

    report.added += d.add.length;
    report.skipped += d.skipped;
    report.files.push(fileRec);

    impRows.push(objToLine_(eImp.headers, {
      Id: 'I' + Utilities.getUuid().slice(0, 8), At: now, FileId: f.getId(), FileName: name,
      Hash: hash, Kind: kind, BillingMonth: p.billingMonth, Sections: p.sections.length,
      Balanced: balanced, RowsParsed: rows.length, RowsAdded: d.add.length, RowsSkipped: d.skipped,
      Warnings: fileRec.warnings.join(' | '), Status: 'ok'
    }));
    seenHash[hash] = name;
  }

  if (!dry) {
    if (toWrite.length) eExp.sheet.getRange(eExp.sheet.getLastRow() + 1, 1, toWrite.length, eExp.headers.length).setValues(toWrite);
    if (impRows.length) eImp.sheet.getRange(eImp.sheet.getLastRow() + 1, 1, impRows.length, eImp.headers.length).setValues(impRows);
  }
  return report;
}

function ingestDryRun() {
  var rep = withLock_(function () { return ingestInbox_({ dryRun: true }); });
  SpreadsheetApp.getUi().alert('הרצה יבשה — לא נכתב דבר\n\n' + formatReport_(rep));
}

function ingestRun() {
  var rep = withLock_(function () { return ingestInbox_({ dryRun: false }); });
  SpreadsheetApp.getUi().alert('קליטה הושלמה\n\n' + formatReport_(rep));
}

function formatReport_(rep) {
  var L = [];
  rep.files.forEach(function (f) {
    if (f.status === 'ok') {
      L.push('✅ ' + f.name + ' · חודש ' + f.billingMonth + ' · ' + f.sections + ' מקטעים · ' +
             f.parsed + ' שורות → נוספו ' + f.added + ', דולגו ' + f.skipped);
    } else {
      L.push('⚠️ ' + f.name + ' · ' + f.status + (f.message ? ' · ' + f.message : ''));
    }
    (f.warnings || []).forEach(function (w) { L.push('     ' + w); });
  });
  if (!L.length) L.push('לא נמצאו קבצים חדשים.');
  L.push('');
  L.push('סה"כ נוספו ' + rep.added + ' שורות, דולגו ' + rep.skipped + '.');
  return L.join('\n');
}

/* ================= סיווג סוחרים ממתינים ================= */

/* מקבץ את `pending` **לפי סוחר** ולא לפי שורה, ומצרף הצעה. זה מה שהמסך מציג. */
function pendingMerchants_(ss) {
  var e = expensesSheet_(ss);
  var allRows = readTable_(e.sheet).rows;
  var anchors = buildAnchors_(allRows.filter(function (r) { return String(r.Status) === 'ok'; }));
  var rows = allRows.filter(function (r) { return String(r.Status) === 'pending'; });
  var g = {};
  rows.forEach(function (r) {
    var k = String(r.MerchantNorm || r.Merchant || '');
    if (!g[k]) g[k] = { merchant: k, sample: String(r.Merchant || ''), n: 0, total: 0, cards: {}, first: null, last: null };
    var o = g[k];
    o.n++;
    o.total += Number(r.Charge) || 0;
    o.cards[String(r.Card)] = 1;
    var d = isoDay_(r.Date);
    if (!o.first || d < o.first) o.first = d;
    if (!o.last || d > o.last) o.last = d;
  });
  var out = Object.keys(g).map(function (k) {
    var o = g[k];
    var s = suggestCategory_(k);
    if (!s.category) s = suggestFromNeighbors_(k, anchors) || s;
    o.cards = Object.keys(o.cards);
    o.total = Math.round(o.total * 100) / 100;
    o.suggestCategory = s.category;
    o.suggestSubcategory = s.subcategory;
    o.suggestVia = s.via || '';
    return o;
  });
  out.sort(function (a, b) { return b.total - a.total; });
  return out;
}

/* אישור סיווג: כותב כלל **וגם** מחיל אותו על מה שכבר בגיליון. שני הדברים
   בעסקה אחת — אחרת נוצר מצב שבו יש כלל ויש שורות ממתינות שהוא מתאים להן. */
function classifyMerchant_(ss, body) {
  var pattern = String(body.pattern || body.merchant || '').trim();
  var category = String(body.category || '').trim();
  if (!pattern) throw new Error('חסר סוחר');
  if (!category) throw new Error('חסרה קטגוריה');
  var sub = String(body.subcategory || '').trim();
  var match = String(body.match || 'equals').toLowerCase();
  var card = String(body.card || '').trim();

  var eR = rulesSheet_(ss);
  var tR = readTable_(eR.sheet);
  var now = nowIso_();
  var ruleId = null;

  for (var i = 0; i < tR.rows.length; i++) {
    var r = tR.rows[i];
    if (String(r.Pattern || '').trim() === pattern && String(r.Field || 'merchant') === 'merchant' &&
        String(r.Card || '').trim() === card) {
      ruleId = String(r.Id);
      writeRow_(eR.sheet, tR.headers, r._row, {
        Id: r.Id, Active: true, Priority: r.Priority || 50, Field: 'merchant', Match: match,
        Pattern: pattern, Card: card, Category: category, Subcategory: sub,
        Source: 'user', Hits: r.Hits || 0, CreatedAt: r.CreatedAt || now, UpdatedAt: now
      });
      break;
    }
  }
  if (!ruleId) {
    ruleId = 'R' + ('000' + (tR.rows.length + 1)).slice(-4);
    eR.sheet.appendRow(objToLine_(eR.headers, {
      Id: ruleId, Active: true, Priority: 50, Field: 'merchant', Match: match, Pattern: pattern,
      Card: card, Category: category, Subcategory: sub, Source: 'user', Hits: 0,
      CreatedAt: now, UpdatedAt: now
    }));
  }

  var applied = recategorize_(ss, { onlyPending: true });
  return { ruleId: ruleId, pattern: pattern, category: category, subcategory: sub, applied: applied.changed };
}

/* הרצה חוזרת של כל הכללים. `onlyPending` מגן על סיווג ידני שיועד עשה בגיליון:
   שורה שכבר `ok` לא נוגעים בה אלא אם ביקשו במפורש.                        */
function recategorize_(ss, opts) {
  opts = opts || {};
  var rules = loadRules_(ss);
  var e = expensesSheet_(ss);
  var t = readTable_(e.sheet);
  if (!t.rows.length) return { changed: 0, scanned: 0 };

  var iCat = t.headers.indexOf('Category'), iSub = t.headers.indexOf('Subcategory');
  var iSt = t.headers.indexOf('Status'), iRid = t.headers.indexOf('RuleId'), iUp = t.headers.indexOf('UpdatedAt');
  var now = nowIso_(), changed = 0;

  var first = t.rows[0]._row, last = t.rows[t.rows.length - 1]._row;
  var block = e.sheet.getRange(first, 1, last - first + 1, t.headers.length);
  var vals = block.getValues();

  t.rows.forEach(function (r) {
    if (opts.onlyPending && String(r.Status) !== 'pending') return;
    var hit = applyRules_({ merchantNorm: r.MerchantNorm, note: r.Note, card: r.Card }, rules);
    if (!hit) return;
    var i = r._row - first;
    if (String(vals[i][iCat]) === String(hit.category) && String(vals[i][iSub]) === String(hit.subcategory) &&
        String(vals[i][iSt]) === 'ok') return;
    vals[i][iCat] = hit.category; vals[i][iSub] = hit.subcategory;
    vals[i][iSt] = 'ok'; vals[i][iRid] = hit.ruleId; vals[i][iUp] = now;
    changed++;
  });

  if (changed) block.setValues(vals);
  return { changed: changed, scanned: t.rows.length };
}

/* ====================== נקודות קצה ====================== */

function ingestApiRead_(ss, r, params) {
  if (r === 'expenses') {
    var sh = ss.getSheetByName(ING.expensesSheet);
    if (!sh) return { values: [EXPENSE_COLS] };
    return { values: sh.getDataRange().getValues() };
  }
  if (r === 'imports') {
    var si = ss.getSheetByName(ING.importsSheet);
    return { values: si ? si.getDataRange().getValues() : [IMPORT_COLS] };
  }
  if (r === 'rules') {
    var sr = ss.getSheetByName(ING.rulesSheet);
    return { values: sr ? sr.getDataRange().getValues() : [RULE_COLS] };
  }
  if (r === 'pending') return { merchants: pendingMerchants_(ss) };
  return null;
}

function ingestApiWrite_(ss, action, body) {
  if (action === 'expenses.classify')     return classifyMerchant_(ss, body);
  if (action === 'expenses.recategorize') return recategorize_(ss, { onlyPending: !body.all });
  if (action === 'ingest.run')            return ingestInbox_({ dryRun: !!body.dryRun });
  return null;
}

if (typeof module !== 'undefined') module.exports = {
  normMerchant_: normMerchant_, suggestCategory_: suggestCategory_,
  ruleHits_: ruleHits_, applyRules_: applyRules_, detectKind_: detectKind_,
  isoDay_: isoDay_, SEED_RULES_: SEED_RULES_, SUGGEST_: SUGGEST_,
  tokens_: tokens_, buildAnchors_: buildAnchors_, suggestFromNeighbors_: suggestFromNeighbors_
};
