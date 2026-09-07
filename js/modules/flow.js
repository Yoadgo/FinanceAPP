/* ===== MODULE: flow — כמה נשאר בסוף החודש =====
   מחבר את שני החצאים: מה שקרה בעו״ש ומה שקרה באשראי. טהור, בלי DOM.

   ⚠️ **אינו מחשב מחדש מה נחשב הוצאה.** את זה כבר יודעים שני המנועים
   הקיימים, וכל חישוב שני היה סוטה מהם בשקט ביום שבו אחד מהם ישתנה:
   `ExpensesEngine.summarize` יודע מה יוצא מהצריכה באשראי (העברות,
   הון, זוגות מתקזזים), ו-`BankEngine.summarize` יודע את אותו דבר
   בעו״ש. כאן רק מחברים.

   ⚠️ **שורות סילוק האשראי אינן נספרות פעמיים, וזה לא במקרה:** בעו״ש
   הן בדלי `העברה` ולכן מחוץ לצריכה, והכסף נספר פעם אחת — בפירוט
   האשראי, שם באמת רואים על מה הוא הלך.                              */

const FlowEngine = (function () {

  function round2(x) { return Math.round(x * 100) / 100; }
  var mk = function (d) {
    return (typeof ExpensesEngine !== 'undefined' && ExpensesEngine.monthKey)
      ? ExpensesEngine.monthKey(d) : '';
  };

  /* בסיס החיוב ולא תאריך העסקה. השאלה כאן היא ״כמה כסף נשאר בחשבון
     בסוף החודש״, והכסף עוזב בחיוב — לא ביום שבו העברנו את הכרטיס. */
  var BASIS = 'billing';

  function months(bankRows, creditRows) {
    var seen = {};
    (bankRows || []).forEach(function (r) { var k = mk(r.date); if (k) seen[k] = 1; });
    (creditRows || []).forEach(function (r) { var k = mk(r.billing); if (k) seen[k] = 1; });
    return Object.keys(seen).sort(function (a, b) {
      return (a.slice(3) + a.slice(0, 2)).localeCompare(b.slice(3) + b.slice(0, 2));
    });
  }

  function monthly(bankRows, creditRows, opts) {
    opts = opts || {};
    var wash = opts.washPairs ||
      ((typeof ExpensesEngine !== 'undefined' && ExpensesEngine.washPairs)
        ? ExpensesEngine.washPairs(creditRows || []) : []);

    return months(bankRows, creditRows).map(function (m) {
      var b = BankEngine.summarize(bankRows || [], { month: m });
      var c = ExpensesEngine.summarize(creditRows || [],
              { basis: BASIS, month: m, washPairs: wash });

      /* `pending` הן שורות אשראי שעוד לא סווגו — הכסף שלהן **כן** יצא,
         ולכן הן נספרות בהוצאה. זה ההבדל מהעו״ש: שם שורה בלי דלי היא
         בכלל לא ידועה (העברה? הוצאה? הון?) ואסור להניח עליה דבר.   */
      var spendCredit = round2(c.consume + c.pending);
      var spend = round2(b.spend + spendCredit);
      var income = b.income;

      return {
        month: m,
        income: income,
        spendBank: b.spend,
        spendCredit: spendCredit,
        spend: spend,
        saved: round2(income - spend),
        rate: income > 0 ? round2((income - spend) / income * 100) : null,
        unknownCount: b.pending.length,
        unknownSum: round2(b.pending.reduce(function (a, r) { return a + r.amount; }, 0))
      };
    });
  }

  /* סיכום התקופה. הממוצע רץ על חודשים שיש בהם הכנסה בפועל — חודש
     שנקלט חלקית היה מושך אותו למטה ומציג תמונה שגויה של הרגילות. */
  function summary(rows) {
    var list = rows || [];
    var withIncome = list.filter(function (r) { return r.income > 0; });
    var sum = function (k) {
      return round2(list.reduce(function (a, r) { return a + (r[k] || 0); }, 0));
    };
    var income = sum('income'), spend = sum('spend'), saved = round2(income - spend);
    return {
      months: list.length,
      income: income, spend: spend,
      spendBank: sum('spendBank'), spendCredit: sum('spendCredit'),
      saved: saved,
      rate: income > 0 ? round2(saved / income * 100) : null,
      avgIncome: withIncome.length ? round2(income / withIncome.length) : 0,
      avgSpend: withIncome.length ? round2(spend / withIncome.length) : 0,
      avgSaved: withIncome.length ? round2(saved / withIncome.length) : 0,
      basedOn: withIncome.length,
      unknownCount: list.reduce(function (a, r) { return a + r.unknownCount; }, 0),
      unknownSum: sum('unknownSum'),
      best: list.slice().sort(function (a, b) { return b.saved - a.saved; })[0] || null,
      worst: list.slice().sort(function (a, b) { return a.saved - b.saved; })[0] || null
    };
  }

  /* לאן הלך הכסף — שני המקורות באותה רשימה, מסומנים במקורם. אותה
     קטגוריה משני מקורות מתאחדת: ״דיור״ בהוראת קבע ו״דיור״ בכרטיס
     הן אותה שאלה.                                                   */
  function spendByCategory(bankRows, creditRows, opts) {
    opts = opts || {};
    var m = opts.month || 'all';
    var wash = opts.washPairs ||
      ((typeof ExpensesEngine !== 'undefined' && ExpensesEngine.washPairs)
        ? ExpensesEngine.washPairs(creditRows || []) : []);
    var acc = {};
    var add = function (cat, sum, src) {
      var k = cat || 'בהמתנה';
      acc[k] = acc[k] || { cat: k, sum: 0, bank: 0, credit: 0 };
      acc[k].sum = round2(acc[k].sum + sum);
      acc[k][src] = round2(acc[k][src] + sum);
    };
    BankEngine.summarize(bankRows || [], { month: m }).spendByCat
      .forEach(function (c) { add(c.cat, c.sum, 'bank'); });
    ExpensesEngine.summarize(creditRows || [], { basis: BASIS, month: m, washPairs: wash })
      .byCat.forEach(function (c) { add(c.cat, c.sum, 'credit'); });
    return Object.keys(acc).map(function (k) { return acc[k]; })
      .sort(function (a, b) { return b.sum - a.sum; });
  }

  return { BASIS: BASIS, months: months, monthly: monthly,
           summary: summary, spendByCategory: spendByCategory };
})();

if (typeof module !== 'undefined') module.exports = FlowEngine;
