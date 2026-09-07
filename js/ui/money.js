/* money.js — פורמט כסף אחד לכל האפליקציה.
   ============================================================================
   נבנה אחרי ששלושה מסכים — הוצאות, עו״ש ותזרים — כתבו כל אחד `money()` משלו
   באותה שורה בדיוק. שכפול של פורמט הוא לא רק כפילות: ביום שבו נחליט להציג
   אגורות, או להחליף את סימן המינוס, שלושה מקומות ישתנו ואחד יישכח.

   שני עולמות ושני צרכים, ולכן שתי משפחות:

   • **משק הבית** (`ils`, `signed`) — תמיד שקלים, תמיד מעוגל לשקל שלם.
     סכומי תזרים הם עשרות אלפים; אגורות שם הן רעש שמסתיר את הסדר-גודל.

   • **השקעות** (`disp`, `dispSigned`) — הסכום מגיע בדולר, מוצג במטבע שיועד
     בחר בסרגל, ועם שתי ספרות. שער ההמרה מגיע מבחוץ ולא נקרא כאן, כדי
     שהפורמט יישאר טהור ובר-בדיקה.

   ⚠️ **המינוס הוא U+2212 ולא מקף.** מקף רגיל נראה קצר מדי לצד ספרות, ובעברית
   RTL הוא גם נדבק למספר. כל בדיקה שמסכמת כסף מהמסך חייבת לכבד את התו הזה —
   בדיקה שחילצה `[^\d]` הפכה פעם חודש שלילי לחיובי ואישרה סכום שגוי.
   ========================================================================== */

/* `var` ולא רק `window.FA`: כך הקובץ נטען גם ב-Node לבדיקות, שם `window`
   הוא אובייקט רגיל ולא הגלובל. בדפדפן שתי הצורות מצביעות על אותו אובייקט. */
var FA = (typeof window !== "undefined" ? (window.FA = window.FA || {}) : {});

FA.money = (function () {
  "use strict";

  var MINUS = "−";
  var LOCALE = "he-IL";

  /* ⚠️ `Number(null)` הוא 0, ו-`Number("")` גם. בלי הבדיקה המפורשת תא ריק
     בגיליון היה מוצג כ-₪0 — כלומר "בדקנו ואין כסף" במקום "אין נתון".
     באפליקציה פיננסית זה בדיוק סוג השקר שאסור. */
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var x = Number(v);
    return isFinite(x) ? x : null;
  }

  /* ── משק הבית ── */

  /* סכום בשקלים, ללא סימן. `digits` רק אם באמת צריך אגורות. */
  function ils(v, digits) {
    var x = num(v);
    if (x === null) return "—";
    var d = digits || 0;
    return "₪" + Math.abs(x).toLocaleString(LOCALE,
      { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /* סכום עם מינוס כשהוא שלילי. אפס אינו שלילי. */
  function signed(v, digits) {
    var x = num(v);
    if (x === null) return "—";
    return (x < 0 ? MINUS : "") + ils(x, digits);
  }

  /* עם פלוס מפורש גם על חיובי — לשימוש שבו הכיוון הוא העיקר. */
  function delta(v, digits) {
    var x = num(v);
    if (x === null) return "—";
    return (x < 0 ? MINUS : "+") + ils(x, digits);
  }

  /* ── השקעות ── */

  /* מספר בלבד, בלי סימן מטבע — למקומות שמדביקים סימן משלהם. */
  function plain(v, digits) {
    var x = num(v);
    if (x === null) return "—";
    var d = digits === undefined ? 2 : digits;
    return Math.abs(x).toLocaleString(LOCALE,
      { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /* סכום דולרי המוצג במטבע התצוגה.
     `opts.rate` הוא שער הדולר-שקל; בלעדיו מוצג הדולר כמות שהוא.
     `opts.currency` הוא 'ILS' או 'USD'. שניהם מגיעים מבחוץ בכוונה. */
  function disp(usd, opts) {
    opts = opts || {};
    var x = num(usd);
    if (x === null) return "—";
    var toIls = opts.currency === "ILS" && opts.rate;
    var v = toIls ? x * opts.rate : x;
    var sym = opts.currency === "ILS" ? "₪" : "$";
    return sym + plain(v, opts.digits);
  }

  function dispSigned(usd, opts) {
    var x = num(usd);
    if (x === null) return "—";
    return (x < 0 ? MINUS : "") + disp(x, opts);
  }

  /* ── עזר ── */

  function pct(v, digits) {
    var x = num(v);
    if (x === null) return "—";
    var d = digits === undefined ? 1 : digits;
    return x.toFixed(d) + "%";
  }

  function sym(currency) { return currency === "ILS" ? "₪" : "$"; }

  return { MINUS: MINUS, ils: ils, signed: signed, delta: delta,
           plain: plain, disp: disp, dispSigned: dispSigned,
           pct: pct, sym: sym };
})();

if (typeof module !== "undefined") module.exports = FA.money;
