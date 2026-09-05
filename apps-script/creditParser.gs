/* ================================================================
   CREDIT PARSER — פירוט אשראי של הבינלאומי → שורות הוצאה
   ----------------------------------------------------------------
   פונקציה טהורה: מקבלת מערך דו-ממדי בדיוק כפי ש-`getValues()` מחזירה,
   ומחזירה שורות מפוענחות + אזהרות. אין כאן קריאה לגיליון ואין כתיבה,
   כדי שאפשר יהיה להריץ אותה על קבצים אמיתיים מחוץ ל-Apps Script.

   המבנה (אומת מול שלושה קבצים אמיתיים, 5.9.2026):
     קובץ = חודש חיוב אחד → כמה כרטיסים → לכל כרטיס כמה מקטעים.
     **עמודה 0 ריקה לגמרי; הנתונים מתחילים בעמודה 1.**

   שלושה כללים שנלמדו בדם:
   1. **לזהות לפי טיפוס תא וצורה, לא לפי מחרוזות עברית.** שורת עסקה היא
      שורה שבעמודה 1 שלה יש Date. זה עמיד לשינויי נוסח.
   2. **מיקום `סכום חיוב` נקרא מכותרת המקטע** — הוא בעמודה 4 במקטע שקלי
      ובעמודה 5 במקטע מט"ח. קיבוע המיקום שובר את המט"ח בשקט.
   3. **הסכום בשורת `סה"כ` הוא התא המספרי האחרון**, לא עמודה קבועה.

   כל מקטע מצהיר על הסכום שלו, ולכן לכל מקטע יש **עוגן אימות מובנה**:
   סכום השורות חייב להתלכד עם המוצהר. מקטע שלא מתלכד — נכנס לאזהרות
   ולא נקלט. עדיף לעצור מקטע מאשר לכתוב לספר החשבונות מספר שגוי.
   ================================================================ */
function parseCreditSheet_(values) {
  var out = { billingMonth: null, rows: [], sections: [], warnings: [] };
  if (!values || !values.length) { out.warnings.push('גיליון ריק'); return out; }

  var card = null, issuer = null, billing = null;
  var hdr = null, kind = null, chgIdx = -1;
  var secRows = [], secStart = 0;

  function txt(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
  function isDate(v) { return v instanceof Date && !isNaN(v.getTime()); }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

  function closeSection(statedTotal, atRow) {
    if (!hdr) return;
    var sum = 0;
    for (var i = 0; i < secRows.length; i++) sum += secRows[i].charge;
    sum = Math.round(sum * 100) / 100;
    var st = (statedTotal === null || statedTotal === undefined) ? null : Math.round(statedTotal * 100) / 100;
    var sec = { card: card, issuer: issuer, billing: billing, kind: kind,
                n: secRows.length, computed: sum, stated: st,
                balanced: st === null ? null : Math.abs(sum - st) < 0.02,
                fromRow: secStart, toRow: atRow };
    out.sections.push(sec);
    if (sec.balanced === false) {
      out.warnings.push('מקטע לא מאוזן — כרטיס ' + card + ' ' + kind +
        ': חושב ' + sum + ' מול מוצהר ' + st + '. השורות לא נקלטו.');
    } else {
      for (var j = 0; j < secRows.length; j++) out.rows.push(secRows[j]);
    }
    secRows = []; hdr = null; chgIdx = -1;
  }

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var filled = [];
    for (var c = 0; c < row.length; c++) if (txt(row[c]) !== '') filled.push(c);
    if (!filled.length) continue;

    var c1 = row[1];

    /* ── שורת עסקה ── */
    if (isDate(c1) && hdr) {
      var charge = num(row[chgIdx]);
      if (charge === null) { out.warnings.push('שורה ' + (r + 1) + ': אין סכום חיוב'); continue; }
      var rec = {
        card: card, issuer: issuer, billing: billing, kind: kind,
        date: c1,
        merchantRaw: txt(row[hdr['שם  העסק'] !== undefined ? hdr['שם  העסק'] : hdr['שם העסק']]),
        amount: num(row[hdr['סכום עסקה'] !== undefined ? hdr['סכום עסקה'] : hdr['סכום מקורי']]),
        charge: charge,
        origCurrency: hdr['מטבע מקורי'] !== undefined ? txt(row[hdr['מטבע מקורי']]) : '',
        chargeCurrency: hdr['מטבע חיוב'] !== undefined ? txt(row[hdr['מטבע חיוב']]) : 'ש"ח',
        note: hdr['פירוט'] !== undefined ? txt(row[hdr['פירוט']]) : '',
        sheetRow: r + 1
      };
      secRows.push(rec);
      continue;
    }

    var s1 = txt(c1);

    /* ── שורת סה"כ: הסכום הוא התא המספרי האחרון ── */
    if (s1.indexOf('סה') === 0) {
      var last = null;
      for (var k = 0; k < row.length; k++) if (num(row[k]) !== null) last = num(row[k]);
      closeSection(last, r + 1);
      continue;
    }

    /* ── שורת כותרות ── */
    if (s1.indexOf('תאריך') === 0) {
      hdr = {}; secStart = r + 1;
      for (var m = 0; m < row.length; m++) { var h = txt(row[m]); if (h) hdr[h] = m; }
      chgIdx = hdr['סכום חיוב'];
      kind = (hdr['מטבע חיוב'] !== undefined) ? 'fx' : 'ils';
      if (chgIdx === undefined) { out.warnings.push('שורה ' + (r + 1) + ': כותרת בלי "סכום חיוב"'); hdr = null; }
      continue;
    }

    /* ── כותרת כרטיס / מקטע: טקסט בעמודה 1 בלבד ── */
    if (filled.length === 1 && filled[0] === 1) {
      var mc = s1.match(/(\d{4})\s*-\s*(\S+)/);
      if (mc && s1.indexOf('כרטיס') !== -1) {
        closeSection(null, r);                       // כרטיס חדש סוגר מקטע פתוח
        card = mc[1]; issuer = mc[2];
        var mb = s1.match(/(\d{2}\/\d{2}\/\d{4})/);
        billing = mb ? mb[1] : null;
        if (!out.billingMonth) out.billingMonth = billing;
        else if (billing && billing !== out.billingMonth)
          out.warnings.push('הקובץ מכיל יותר מחודש חיוב אחד: ' + out.billingMonth + ' ו-' + billing);
      }
      continue;
    }
  }
  closeSection(null, values.length);
  return out;
}

/* ── פירוק שדה `פירוט` ──
   השדה הזה הוא מה שמכריע איך לקרוא את השורה, ולכן הוא מפורק ולא נשמר
   כטקסט חופשי בלבד. נצפו בפועל: "תשלום 6 מתוך 48" · "קרדיט - תשלום 7
   מתוך 9" · "הנחה 2.52 ש\"ח חבר" · "זיכוי" · שם מקבל בהעברת BIT.       */
function parseNote_(note) {
  var o = { kind: 'plain', installment: null, installments: null, credit: false, discount: null, payee: null };
  var s = String(note || '').trim();
  if (!s) return o;
  var mi = s.match(/תשלום\s+(\d+)\s+מתוך\s+(\d+)/);
  if (mi) { o.kind = 'installment'; o.installment = +mi[1]; o.installments = +mi[2]; }
  else {
    var mp = s.match(/תשלום\s+(\d+)\s+מתוך/);
    if (mp) { o.kind = 'installment'; o.installment = +mp[1]; }
  }
  if (s.indexOf('קרדיט') !== -1) o.credit = true;
  var md = s.match(/הנחה\s+([\d.]+)/);
  if (md) { o.discount = parseFloat(md[1]); if (o.kind === 'plain') o.kind = 'discount'; }
  if (s.indexOf('זיכוי') !== -1) o.kind = 'refund';
  if (o.kind === 'plain' && /[א-ת]/.test(s) && s.split(/\s+/).length <= 4 &&
      !mi && !md && s.indexOf('תשלום') === -1) { o.kind = 'payee'; o.payee = s; }
  return o;
}

/* ── טביעת אצבע + מונה מופעים ──
   נבדק אמפירית שאין צירוף עמודות שנותן ייחודיות: יש בנתונים שורות זהות
   לחלוטין שהן עסקאות אמיתיות (אותו בית קפה, אותו סכום, אותו יום).
   לכן המפתח אינו "מה השורה" אלא **"המופע ה-N של השורה הזו"**.
   ספירה ולא סדר — כדי שהמפתח לא ישתנה אם הייצוא יסדר אחרת.         */
function fingerprint_(rec) {
  function d2(v) {
    return v instanceof Date
      ? v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2)
      : String(v);
  }
  return [rec.card, d2(rec.date), rec.merchantRaw,
          rec.amount === null ? '' : rec.amount, rec.charge,
          rec.origCurrency, rec.note].join('|');
}

function withOccurrence_(rows) {
  var seen = {}, out = [];
  for (var i = 0; i < rows.length; i++) {
    var k = fingerprint_(rows[i]);
    seen[k] = (seen[k] || 0) + 1;
    var r = rows[i];
    r.key = k; r.occ = seen[k];
    out.push(r);
  }
  return out;
}

/* ── מיזוג מול מה שכבר בגיליון ──
   existingCounts: { key: כמה מופעים כבר קיימים }
   מחזיר רק את השורות שחסרות. הרצה חוזרת על אותו קובץ מחזירה רשימה
   ריקה; הרצה על טווח חופף מחזירה בדיוק את החדש.                      */
function diffAgainstExisting_(rows, existingCounts) {
  var have = {}, add = [], skipped = 0;
  for (var k in existingCounts) have[k] = existingCounts[k];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], n = have[r.key] || 0;
    if (r.occ <= n) { skipped++; continue; }
    add.push(r);
  }
  return { add: add, skipped: skipped };
}

if (typeof module !== 'undefined') module.exports =
  { parseCreditSheet_: parseCreditSheet_, parseNote_: parseNote_,
    fingerprint_: fingerprint_, withOccurrence_: withOccurrence_,
    diffAgainstExisting_: diffAgainstExisting_ };
