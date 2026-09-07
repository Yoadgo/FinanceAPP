/* ===== bankParser.gs — פענוח דוח תנועות עו״ש (הבינלאומי) =====

   פרסר טהור: מקבל מערך דו-ממדי, מחזיר שורות. אינו נוגע בגיליון, אינו
   כותב, ואינו יודע דבר על Apps Script — ולכן הוא נבדק ב-node על הקובץ
   האמיתי בלי להריץ שום דבר בענן.

   ⚠️ אין כאן בדיקת שרשור יתרות, ובכוונה. בדקתי על הקובץ האמיתי:
   עמודת `יתרה` ריקה ב-76 מתוך 76 המעברים. בדיקה שבנויה עליה הייתה
   נכשלת תמיד — או, גרוע יותר, מדווחת הצלחה בלי לרוץ. בדיקת השלמות
   האמיתית חיה במקום אחר: חיובי הכרטיסים בעו״ש חייבים להתלכד עם
   סכומי פירוט האשראי, וזה נבדק ב-reconcile שכבר קיים.

   מבנה הקובץ (אומת מול הייצוא מ-05.09.26):
     שורה 1  'תנועות בחשבון'
     שורה 2  'חשבון:305-15761 תאריך:...'
     שורה 3  'סוג חשבון: 105 עו"ש קרדיטורי'
     שורה 4  'מתאריך: ... עד תאריך: ...'
     שורה 6  כותרות — יתרה | תאריך ערך | זכות | חובה | תיאור | אסמכתא | סוג פעולה | תאריך
   הכותרות מאותרות לפי תוכן ולא לפי מספר שורה, כי ייצוא עתידי עלול
   להוסיף שורת כותרת אחת ולהזיז הכול.                                  */

var BANK_HEAD_ = ['תאריך', 'סוג פעולה', 'אסמכתא', 'תיאור', 'חובה', 'זכות', 'תאריך ערך', 'יתרה'];

/* יום ב-UTC ולא לפי אזור מקומי: הגיליון מחזיר Date שנבנה מחצות UTC,
   ובאזור שלילי getDate() היה מחזיר את היום הקודם. */
function bankIsoDay_(d) {
  return d.getUTCFullYear() + '-' +
         ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' +
         ('0' + d.getUTCDate()).slice(-2);
}

function bankStr_(v) {
  if (v == null) return '';
  if (v instanceof Date) return bankIsoDay_(v);
  return String(v).replace(/\u00A0/g, ' ').trim();
}

function bankNum_(v) {
  if (v == null || v === '') return 0;
  var t = String(v).replace(/[,\s₪]/g, '');
  var x = Number(t);
  return isFinite(x) ? x : 0;
}

/* תאריך מגיע כ-Date מהגיליון, או כ-'DD/MM/YYYY' מייצוא טקסטואלי.
   מחזיר 'YYYY-MM-DD' — צורה אחת, בלי תלות באזור זמן.               */
function bankDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return bankIsoDay_(v);
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

function isBankSheet_(values) {
  var lim = Math.min(values.length, 40);
  var seenTitle = false, seenAcct = false;
  for (var r = 0; r < lim; r++) {
    for (var c = 0; c < values[r].length; c++) {
      var s = bankStr_(values[r][c]);
      if (s.indexOf('תנועות בחשבון') !== -1) seenTitle = true;
      if (s.indexOf('סוג חשבון') !== -1 && s.indexOf('עו"ש') !== -1) seenAcct = true;
    }
  }
  return seenTitle && seenAcct;
}

function parseBankSheet_(values) {
  var out = { meta: {}, rows: [], warnings: [] };
  if (!values || !values.length) { out.warnings.push('קובץ ריק'); return out; }

  /* --- מטא: חשבון וטווח --- */
  for (var r = 0; r < Math.min(values.length, 12); r++) {
    for (var c = 0; c < values[r].length; c++) {
      var s = bankStr_(values[r][c]);
      var m = s.match(/חשבון:\s*([\d\-]+)/);
      if (m && !out.meta.account) out.meta.account = m[1];
      m = s.match(/מתאריך:\s*(\S+)\s*עד תאריך:\s*(\S+)/);
      if (m) { out.meta.from = bankDate_(m[1]); out.meta.to = bankDate_(m[2]); }
    }
  }

  /* --- איתור שורת הכותרות לפי תוכן --- */
  var hRow = -1, idx = {};
  for (var r2 = 0; r2 < Math.min(values.length, 30) && hRow < 0; r2++) {
    var map = {}, hits = 0;
    for (var c2 = 0; c2 < values[r2].length; c2++) {
      var h = bankStr_(values[r2][c2]);
      if (BANK_HEAD_.indexOf(h) !== -1) { map[h] = c2; hits++; }
    }
    if (hits >= 5 && map['תיאור'] !== undefined && map['תאריך'] !== undefined) { hRow = r2; idx = map; }
  }
  if (hRow < 0) { out.warnings.push('לא נמצאה שורת כותרות — ייתכן שזה לא דוח תנועות'); return out; }
  out.meta.headerRow = hRow + 1;

  /* --- השורות --- */
  for (var r3 = hRow + 1; r3 < values.length; r3++) {
    var v = values[r3];
    if (!v) continue;
    var desc = bankStr_(v[idx['תיאור']]);
    var date = bankDate_(v[idx['תאריך']]);
    if (!desc || !date) continue;

    var debit  = bankNum_(v[idx['חובה']]);
    var credit = bankNum_(v[idx['זכות']]);
    if (!debit && !credit) continue;            // שורות סיכום או ריקות

    out.rows.push({
      date: date,
      valueDate: idx['תאריך ערך'] !== undefined ? bankDate_(v[idx['תאריך ערך']]) : date,
      opCode: bankStr_(v[idx['סוג פעולה']]),
      ref: bankStr_(v[idx['אסמכתא']]),
      desc: desc,
      debit: debit,
      credit: credit,
      /* סימן אחד לכל התנועות: חיובי = נכנס, שלילי = יצא. כל חישוב
         במעלה הזרם עובד על שדה אחד ולא צריך לזכור שתי עמודות. */
      amount: Math.round((credit - debit) * 100) / 100,
      sheetRow: r3 + 1
    });
  }

  if (!out.rows.length) out.warnings.push('נמצאה כותרת אבל אין שורות תנועה');
  return out;
}

/* טביעת אצבע לזיהוי כפילויות בין קליטות. שני ייצוא חופפים (יוני–ספטמבר
   ויולי–אוקטובר) חולקים חודשיים שלמים, וזה המצב הרגיל ולא החריג.
   התאריך והאסמכתא לבדם אינם ייחודיים — שתי הוראות קבע באותו יום עם
   אותו סכום קיימות באמת — ולכן נוסף מונה מופעים, בדיוק כמו באשראי.  */
function bankFingerprint_(r) {
  return [r.date, r.ref, r.desc, r.amount.toFixed(2)].join('|');
}

function withBankOccurrence_(rows) {
  var seen = {};
  return rows.map(function (r) {
    var f = bankFingerprint_(r);
    seen[f] = (seen[f] || 0) + 1;
    var o = {};
    for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) o[k] = r[k];
    o.key = f;
    o.occ = seen[f];
    return o;
  });
}

if (typeof module !== 'undefined') module.exports = {
  parseBankSheet_: parseBankSheet_, isBankSheet_: isBankSheet_,
  bankFingerprint_: bankFingerprint_, withBankOccurrence_: withBankOccurrence_,
  bankDate_: bankDate_, bankNum_: bankNum_, bankIsoDay_: bankIsoDay_
};
