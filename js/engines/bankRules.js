/* ================================================================
   BANK RULES — דליים לתנועות עו"ש, היסק תדירות, והתאמת בנק–אשראי.
   הוסב מ-FinanceAPP v3 (apps-script/ingest.gs + js/modules/bank.js)
   ב-29.9.2026. הלוגיקה זהה.
   ================================================================ */

/* ארבעה דליים, והם קובעים דבר אחד: האם התנועה משנה כמה כסף יש.
   `הכנסה` ו-`צריכה` משנים; `העברה` ו-`הון` לא. בלי החלוקה הזו
   ₪317,546 שיצאו ברבעון היו נספרים כהוצאה, כשהצריכה בפועל היא
   ₪2,713. ר' ״מודל משק הבית״ ב-CLAUDE.md.                        */
var BUCKETS_ = { income: 'הכנסה', spend: 'צריכה', move: 'העברה', capital: 'הון' };

/* כל שורה: [סוג התאמה, ביטוי, דלי, קטגוריה, תת, תדירות].
   `op` בודק את קוד הפעולה של הבנק — הוא נותן את **המנגנון** (הלוואה,
   ריבית, שיק) ואמין לחלוטין. `re` בודק את התיאור — הוא נותן את
   **המטרה**. קוד לבדו לא מספיק: קוד 162 מכיל גם כרטיסי אשראי וגם
   שיכוני חי, וקוד 222 גם משכורת וגם החזר בביט. לכן התיאור קודם.  */
var SEED_BANK_RULES_ = [
  /* ⚠️ `תיקונים` קודם, ובכוונה. `תיקונים ישראכרט - 5701` הוא **זיכוי
     של ₪135 שנכנס לחשבון**, לא חיוב — הוא לא מסלק חודש חיוב, ולכן אסור
     לו לקבל SettlesCard. בלי הכלל הזה הוא היה נכנס לסילוק ומקלקל את
     ההתלכדות המדויקת מול פירוט האשראי.                              */
  ['re', /^תיקונים\s+\S+\s*-\s*\d{4}/,   BUCKETS_.spend,  'זיכוי אשראי', '', ''],
  ['re', /^(אמריקן אקספרס|ישראכרט בע"מ|ויזה|מאסטרקארד)\s*-\s*\d{4}/,
        BUCKETS_.move, 'סילוק אשראי', '', 'קבוע'],
  ['re', /^מופ"ת|^-?קסלמן/,                BUCKETS_.income,  'משכורת', '', 'קבוע'],
  ['re', /^זיכוי מביט מיועד גולן|^זיכוי מפייבוקס/,
                                            BUCKETS_.move,   'כסף שחוזר אליי', '', ''],
  ['re', /^זיכוי מביט |^זיכוי מב\.פועלים מ/, BUCKETS_.income, 'העברה מאדם', '', ''],
  ['re', /^עמותת שיכוני חי/,                BUCKETS_.spend,   'דיור', 'ועד ושירותים', 'קבוע'],
  ['re', /הרשאה כאל/,                       BUCKETS_.spend,   'כללי', '', 'קבוע'],
  ['re', /^ריבית זכות/,                     BUCKETS_.income,  'ריבית', '', ''],
  ['re', /אלטשולר|מיטב|ילין|פסגות|אקסלנס/,   BUCKETS_.capital,'השקעות', '', ''],
  ['re', /^משיכת שיק|^החזרת שיק/,           BUCKETS_.move,    'שיק', '', ''],
  ['re', /^העברה לח\.נוסף/,                 BUCKETS_.move,    'בין חשבונות שלי', '', ''],
  ['op', '240', BUCKETS_.capital, 'הלוואה שהתקבלה', '', 'חד-פעמי'],
  ['op', '293', BUCKETS_.capital, 'החזר הלוואה', 'קרן', 'קבוע'],
  ['op', '290', BUCKETS_.capital, 'החזר הלוואה', 'קרן', 'קבוע'],
  ['op', '495', BUCKETS_.capital, 'החזר הלוואה', 'ריבית', 'קבוע'],
  ['op', '212', BUCKETS_.capital, 'הלוואה בניכוי שכר', '', 'קבוע'],
  ['op', '262', BUCKETS_.capital, 'הלוואה בניכוי שכר', '', 'קבוע'],
  ['op', '19',  BUCKETS_.move,    'שיק', '', '']
];

/* מחזיר הצעה, לא הכרעה. `hit=false` פירושו ״לא יודע״ — והשורה נשארת
   pending עד שיועד יחליט. ⛔ אין ברירת מחדל לדלי: ניחוש שקט הוא בדיוק
   מה שהופך ₪216,554 של בית להוצאה.                                 */
function suggestBankBucket_(row, rules) {
  var list = rules || SEED_BANK_RULES_;
  var desc = String(row.desc || '');
  var op = String(row.opCode || '');

  for (var i = 0; i < list.length; i++) {
    var r = list[i], match = false;
    if (r[0] === 're') match = r[1].test(desc);
    else if (r[0] === 'op') match = (op === String(r[1]));
    if (!match) continue;

    var out = { hit: true, bucket: r[2], category: r[3], subcategory: r[4], freq: r[5],
                why: r[0] === 'op' ? 'קוד ' + r[1] : 'תיאור', settlesCard: '' };
    if (out.category === 'סילוק אשראי') {
      var c = desc.match(/(\d{4})\s*$/);
      out.settlesCard = c ? c[1] : '';
    }
    return out;
  }
  return { hit: false, bucket: '', category: '', subcategory: '', freq: '',
           why: 'אין כלל מתאים', settlesCard: '' };
}

/* קבוע או חד-פעמי, נגזר מהנתונים ולא מהניחוש: תיאור שחוזר בשני חודשים
   שונים לפחות הוא קבוע. עם שלושה חודשי נתונים זו אינדיקציה ולא הוכחה,
   ולכן היא נכתבת כהצעה ויועד מאשר.                                  */
function inferFreq_(rows) {
  var months = {};
  rows.forEach(function (r) {
    var k = String(r.desc || '').replace(/\d+/g, '#').trim();
    (months[k] = months[k] || {})[String(r.date).slice(0, 7)] = 1;
  });
  var out = {};
  Object.keys(months).forEach(function (k) {
    out[k] = Object.keys(months[k]).length >= 2 ? 'קבוע' : 'חד-פעמי';
  });
  return out;
}

/* ====================== קטגוריות ====================== */

/* מקור אמת יחיד לכל בורר קטגוריה במסך. לולא הטאב הזה הרשימה הייתה חיה

/* ── התאמת בנק–אשראי ──
   שורת סילוק בעו"ש היא **אותו כסף** כמו פירוט האשראי של אותו חודש חיוב,
   ולכן היא בדלי `העברה` ואינה נספרת בצריכה. ההתאמה לא משנה אף סכום —
   היא רק מראה שהשניים מתלכדים, או כמה חסר. זה המנגנון שיודע להגיד "לא".
   (הוסב מ-BankEngine.reconcile. ההבדל היחיד: המפתח לחודש הוא 'YYYY-MM'
   מתוך מחרוזת יום, בלי Date ובלי אזור זמן.)

   bankRows:   [{ id, date:'YYYY-MM-DD', desc, amount, settlesCard, settlesMonth? }]
   creditRows: [{ card, billing:'DD/MM/YYYY', charge }]                 */
function billingMonthKey(billing) {
  var m = String(billing || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? m[3] + '-' + m[2] : String(billing || '').slice(0, 7);
}

function reconcile(bankRows, creditRows) {
  function round2(x) { return Math.round(x * 100) / 100; }
  var byKey = {};
  (creditRows || []).forEach(function (c) {
    var k = String(c.card || '').slice(-4) + '|' + billingMonthKey(c.billing);
    byKey[k] = round2((byKey[k] || 0) + Number(c.charge || 0));
  });
  return (bankRows || []).filter(function (r) { return r.settlesCard; }).map(function (r) {
    var card = String(r.settlesCard).slice(-4);
    var month = r.settlesMonth || String(r.date).slice(0, 7);
    var detail = byKey[card + '|' + month];
    var bank = Math.abs(r.amount);
    return {
      id: r.id, date: r.date, desc: r.desc, card: card, month: month, bank: bank,
      detail: detail === undefined ? null : round2(detail),
      gap: detail === undefined ? null : round2(bank - detail),
      status: detail === undefined ? 'no-detail' : Math.abs(bank - detail) < 0.005 ? 'match' : 'gap'
    };
  });
}

export { BUCKETS_ as BUCKETS, SEED_BANK_RULES_, suggestBankBucket_ as suggestBankBucket, inferFreq_ as inferFreq,
  billingMonthKey, reconcile };
