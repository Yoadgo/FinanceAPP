/* ===== PLAN — התוכנית החודשית =====
   טאב `Plan` מחזיק **חודש טיפוסי אחד** שחוזר על עצמו, ולא שורה
   לכל חודש. הסיבה פשוטה: תוכנית שצריך למלא מחדש כל 30 יום לא
   תמולא, והמסך היה מציג ריק בכל ראשון לחודש.

   שני סוגי שורות בלבד:
     • `שורה`   — פריט קבוע בשם מלא ("מופ״ת קבע", "עמותת שיכוני חי").
                  ערכו: **פריט שלא הגיע החודש בולט לעין.** זו כל
                  הסיבה שהוא לא מעטפה.
     • `מעטפה`  — תקציב חודשי לקטגוריה שלמה ("מזון", "תחבורה").
                  הוצאה משתנה אין טעם לנקוב בה שם.

   ⚠️ **רק `הכנסה` ו`צריכה` נכנסים לתוכנית.** `העברה` ו`הון` מזיזים
   כסף בלי לשנות את השווי נטו, ומסך התזרים כבר לא סופר אותם. תוכנית
   שהייתה סופרת אותם הייתה מודדת משהו אחר מהמסך שמעליה — וזה בדיוק
   סוג הפער שגורם להפסיק להאמין לשני המספרים.

   ⚠️ **הסכום נשמר תמיד חיובי.** הכיוון חי בדלי. שמירת מינוס הייתה
   מייצרת שתי אמיתות לאותה שורה ביום שבו מישהו יקליד ידנית בגיליון. */

var PLAN_COLS = ['PlanId', 'Kind', 'Bucket', 'Category', 'Subcategory',
                 'Label', 'Key', 'Amount', 'Active', 'Notes', 'UpdatedAt'];

var PLAN_KIND_   = { line: 'שורה', envelope: 'מעטפה' };
var PLAN_BUCKET_ = { income: 'הכנסה', spend: 'צריכה' };

function planSheet_(ss) { return ensureSheetWithCols_(ss, 'Plan', PLAN_COLS); }

function planStr_(v) { return v == null ? '' : String(v).trim(); }

/* המפתח הטבעי — ממנו נגזר המזהה כשהלקוח שולח שורה חדשה. */
function planNatural_(o) {
  return [planStr_(o.kind), planStr_(o.bucket), planStr_(o.category),
          planStr_(o.subcategory), planStr_(o.key), planStr_(o.label)].join('|');
}

/* FNV-1a. **מחושב רק כאן.** הלקוח לעולם לא מחשב מזהה — הוא מחזיר
   את זה שקיבל, או שולח שורה בלי מזהה והשרת נותן לה אחד. כך אין
   שני מימושים של אותו גיבוב בשתי שפות שיכולים להיפרד בשקט.      */
function planId_(o) {
  var s = planNatural_(o), h = 2166136261;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return 'p' + h.toString(36);
}

/* ---------------------------------------------------------------
   טהור: מקבל את השורות הקיימות ואת מה שנשלח, ומחזיר מה לכתוב.
   בלי גיליון — כדי שאפשר יהיה לבדוק את ההחלטה עצמה.
   --------------------------------------------------------------- */
function planSaveItems_(rows, items, now) {
  var out = { updates: [], appends: [], skipped: [] };
  if (!items || !items.length) return out;

  var byId = {};
  (rows || []).forEach(function (r) {
    var id = planStr_(r.PlanId);
    if (id) byId[id] = r;
  });

  var seen = {};
  items.forEach(function (it) {
    var kind = planStr_(it.kind);
    if (kind !== PLAN_KIND_.line && kind !== PLAN_KIND_.envelope) {
      out.skipped.push({ label: planStr_(it.label), why: 'סוג לא מוכר' }); return;
    }

    var bucket = planStr_(it.bucket);
    if (bucket !== PLAN_BUCKET_.income && bucket !== PLAN_BUCKET_.spend) {
      out.skipped.push({ label: planStr_(it.label), why: 'רק הכנסה או צריכה נכנסות לתוכנית' }); return;
    }

    var cat = planStr_(it.category), label = planStr_(it.label);
    if (kind === PLAN_KIND_.envelope && !cat) {
      out.skipped.push({ label: label, why: 'מעטפה בלי קטגוריה' }); return;
    }
    if (kind === PLAN_KIND_.line && !label) {
      out.skipped.push({ label: cat, why: 'שורה בלי שם' }); return;
    }

    var amount = Number(it.amount);
    if (!isFinite(amount)) amount = 0;
    amount = Math.abs(amount);

    var nat = { kind: kind, bucket: bucket, category: cat,
                subcategory: planStr_(it.subcategory),
                label: label, key: planStr_(it.key) };

    /* מזהה קיים מנצח את המפתח הטבעי: ברגע שיועד משנה שם לשורה
       קיימת, המפתח הטבעי משתנה — ובלי הכלל הזה היינו יוצרים שורה
       שנייה ומשאירים את הישנה יתומה בגיליון.                     */
    var id = planStr_(it.id) || planId_(nat);
    if (seen[id]) { out.skipped.push({ label: label || cat, why: 'כפול באותה שליחה' }); return; }
    seen[id] = 1;

    var prev = byId[id];
    var obj = {
      PlanId: id, Kind: kind, Bucket: bucket, Category: cat,
      Subcategory: nat.subcategory, Label: label, Key: nat.key,
      Amount: amount,
      Active: it.active === undefined ? true : !!it.active,
      Notes: it.notes === undefined ? (prev ? (prev.Notes || '') : '') : planStr_(it.notes),
      UpdatedAt: now
    };

    if (prev) out.updates.push({ _row: prev._row, obj: obj });
    else out.appends.push(obj);
  });

  return out;
}

/* ---------------------------------------------------------------
   שמירה. **אין כאן מחיקה.** ביטול שורה הוא `Active=false`, כדי
   ששינוי בתוכנית לא ימחק היסטוריה ולא ישבור השוואה לחודש קודם.
   --------------------------------------------------------------- */
function savePlan_(ss, body) {
  var e = planSheet_(ss);
  var t = readTable_(e.sheet);
  var headers = t.headers && t.headers.length ? t.headers : e.headers;
  var now = nowIso_();

  var p = planSaveItems_(t.rows, body && body.items, now);

  p.updates.forEach(function (u) { writeRow_(e.sheet, headers, u._row, u.obj); });

  if (p.appends.length) {
    var start = e.sheet.getLastRow() + 1;
    var lines = p.appends.map(function (o) { return objToLine_(headers, o); });
    e.sheet.getRange(start, 1, lines.length, headers.length).setValues(lines);
  }

  return { updated: p.updates.length, created: p.appends.length,
           skipped: p.skipped, requested: (body && body.items ? body.items.length : 0) };
}

/* ---------------------- נקודות קצה ---------------------- */

function planApiRead_(ss, r) {
  if (r !== 'plan') return null;
  var sh = ss.getSheetByName('Plan');
  return { values: sh ? sh.getDataRange().getValues() : [PLAN_COLS] };
}

function planApiWrite_(ss, action, body) {
  if (action === 'plan.save') return savePlan_(ss, body);
  return null;
}

if (typeof module !== 'undefined') module.exports = {
  PLAN_COLS: PLAN_COLS, PLAN_KIND_: PLAN_KIND_, PLAN_BUCKET_: PLAN_BUCKET_,
  planId_: planId_, planNatural_: planNatural_, planSaveItems_: planSaveItems_
};
