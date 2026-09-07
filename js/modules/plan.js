/* ===== MODULE: plan — צפוי מול בפועל =====
   טהור. מקבל את `values` של טאב `Plan` ואת שורות העו״ש והאשראי,
   ומחזיר מספרים. אין DOM, אין fetch.

   ⚠️ **אינו מחשב מחדש מה נחשב הוצאה.** את הבפועל מספק `FlowEngine`
   בדיוק כמו למסך התזרים, כדי ששני המסכים לא יציגו שני מספרים
   שונים לאותו חודש. כאן רק **מפצלים** את אותו סכום בין שורות
   התוכנית — ובדיקה נועלת את השוויון: סך הפיצול = סך התזרים.

   ⚠️ **התאמה לפי מפתח ולא לפי שם מלא.** תיאור בעו״ש נושא מספרים
   שמשתנים כל חודש ("הלואה-תשלום 7"), ולכן ההשוואה רצה על תיאור
   שכל רצף ספרות בו הוחלף ב-#. בלי זה כל פריט קבוע היה נראה
   ״לא הגיע החודש״ בכל חודש.                                      */

const PlanEngine = (function () {

  var KIND   = { line: 'שורה', envelope: 'מעטפה' };
  var BUCKET = { income: 'הכנסה', spend: 'צריכה' };
  var PENDING = 'בהמתנה';

  function s(v) { return v == null ? '' : String(v).trim(); }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function round2(x) { return Math.round(x * 100) / 100; }
  function mk(d) {
    return (typeof ExpensesEngine !== 'undefined' && ExpensesEngine.monthKey)
      ? ExpensesEngine.monthKey(d) : '';
  }

  /* המפתח היציב של שורת עו״ש. */
  function descKey(d) {
    return s(d).replace(/[0-9]+/g, '#').replace(/\s+/g, ' ').trim();
  }

  /* ── קריאת הטאב ── */
  function parseRows(values) {
    if (!values || !values.length) return [];
    var H = values[0].map(s), idx = {};
    H.forEach(function (h, i) { if (h) idx[h] = i; });
    var g = function (r, k) { return idx[k] === undefined ? '' : r[idx[k]]; };

    return values.slice(1)
      .filter(function (r) { return s(g(r, 'PlanId')); })
      .map(function (r) {
        var a = s(g(r, 'Active')).toLowerCase();
        return {
          id: s(g(r, 'PlanId')),
          kind: s(g(r, 'Kind')),
          bucket: s(g(r, 'Bucket')),
          cat: s(g(r, 'Category')),
          sub: s(g(r, 'Subcategory')),
          label: s(g(r, 'Label')),
          key: s(g(r, 'Key')),
          amount: Math.abs(n(g(r, 'Amount'))),
          active: a !== 'false' && a !== '0' && a !== 'לא',
          notes: s(g(r, 'Notes'))
        };
      });
  }

  function live(plan) {
    return (plan || []).filter(function (p) { return p.active; });
  }

  /* ==============================================================
     הצעה מההיסטוריה
     תוכנית ריקה לא תמולא ידנית, ולכן המסך נפתח עם הצעה שנגזרת
     ממה שכבר קרה. **הצעה בלבד** — היא לא נשמרת עד אישור.
     ============================================================== */

  /* פריט נחשב קבוע אם הופיע בשני חודשים שונים לפחות. חודש אחד הוא
     אירוע, לא הרגל, ותוכנית שמלאה באירועים חד-פעמיים חסרת ערך. */
  function recurringBank(bankRows, minMonths) {
    var min = minMonths || 2, acc = {};
    (bankRows || []).forEach(function (r) {
      var b = r.bucket || '';
      if (b !== BUCKET.income && b !== BUCKET.spend) return;
      var m = mk(r.date); if (!m) return;
      var k = b + '|' + (r.cat || '') + '|' + descKey(r.desc);
      if (!acc[k]) acc[k] = { bucket: b, cat: r.cat || '', sub: r.sub || '',
                              key: descKey(r.desc), label: s(r.desc),
                              sum: 0, months: {}, rows: 0 };
      var o = acc[k];
      o.sum += Math.abs(n(r.amount)); o.rows++; o.months[m] = 1;
      if (r.freq === 'קבוע') o.freq = 'קבוע';
    });

    return Object.keys(acc).map(function (k) {
      var o = acc[k], nm = Object.keys(o.months).length;
      /* שקלים שלמים. ממוצע של 13,525.69 אינו מדויק יותר מ-13,526 —
         הוא רק נראה כמו מדידה במקום כמו החלטה.                   */
      return { kind: KIND.line, bucket: o.bucket, category: o.cat, subcategory: o.sub,
               label: o.label, key: o.key, months: nm, rows: o.rows,
               amount: Math.round(o.sum / nm) };
    }).filter(function (o) { return o.months >= min && o.amount > 0; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  /* מעטפות: ההוצאה החודשית הממוצעת בכל קטגוריה, **בניכוי** הפריטים
     הקבועים שכבר קיבלו שורה משלהם באותה קטגוריה. בלי הניכוי הזה
     הוראת קבע לדיור הייתה נספרת גם כשורה וגם בתוך המעטפה.        */
  function envelopes(bankRows, creditRows, fixedLines, opts) {
    opts = opts || {};
    var wash = opts.washPairs ||
      ((typeof ExpensesEngine !== 'undefined' && ExpensesEngine.washPairs)
        ? ExpensesEngine.washPairs(creditRows || []) : []);
    var months = FlowEngine.months(bankRows || [], creditRows || []);
    if (!months.length) return [];

    var acc = {};
    months.forEach(function (m) {
      FlowEngine.spendByCategory(bankRows || [], creditRows || [], { month: m, washPairs: wash })
        .forEach(function (c) { acc[c.cat] = round2((acc[c.cat] || 0) + c.sum); });
    });

    var fixedByCat = {};
    (fixedLines || []).forEach(function (f) {
      if (f.bucket !== BUCKET.spend) return;
      fixedByCat[f.category || ''] = round2((fixedByCat[f.category || ''] || 0) + f.amount);
    });

    return Object.keys(acc).map(function (cat) {
      var avg = Math.round(acc[cat] / months.length);
      return { kind: KIND.envelope, bucket: BUCKET.spend, category: cat,
               subcategory: '', label: '', key: '',
               months: months.length,
               gross: avg,
               fixed: fixedByCat[cat] || 0,
               amount: Math.round(avg - (fixedByCat[cat] || 0)) };
    /* ⛔ ״בהמתנה״ אינה קטגוריה אלא היעדר סיווג. מעטפה בשם הזה הייתה
       מקבעת את חוסר הידיעה כתקציב לגיטימי. היא נשארת בחוץ, ומדווחת
       למעלה כאזהרה.                                                */
    }).filter(function (e) { return e.category && e.category !== PENDING && e.amount > 0; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  function suggest(bankRows, creditRows, opts) {
    opts = opts || {};
    var all = recurringBank(bankRows, opts.minMonths);
    var income = all.filter(function (o) { return o.bucket === BUCKET.income; });
    var fixed  = all.filter(function (o) { return o.bucket === BUCKET.spend; });
    var env    = envelopes(bankRows, creditRows, fixed, opts);

    var months = FlowEngine.months(bankRows || [], creditRows || []);
    var wash = opts.washPairs ||
      ((typeof ExpensesEngine !== 'undefined' && ExpensesEngine.washPairs)
        ? ExpensesEngine.washPairs(creditRows || []) : []);

    /* מה שעוד לא סווג — הסכום שמכתיב עד כמה אפשר לסמוך על ההצעה. */
    var unsorted = 0;
    months.forEach(function (m) {
      FlowEngine.spendByCategory(bankRows || [], creditRows || [], { month: m, washPairs: wash })
        .forEach(function (c) { if (c.cat === PENDING) unsorted = round2(unsorted + c.sum); });
    });

    var sum = function (l) { return round2(l.reduce(function (a, o) { return a + o.amount; }, 0)); };
    return {
      months: months.length,
      income: income, fixed: fixed, envelopes: env,
      totalIncome: sum(income),
      totalSpend: round2(sum(fixed) + sum(env)),
      unsortedAvg: months.length ? round2(unsorted / months.length) : 0,
      items: income.concat(fixed).concat(env)
    };
  }

  /* ==============================================================
     צפוי מול בפועל
     ============================================================== */

  function matchBank(bankRows, month, bucket, key) {
    var sum = 0, cnt = 0;
    (bankRows || []).forEach(function (r) {
      if ((r.bucket || '') !== bucket) return;
      if (mk(r.date) !== month) return;
      if (descKey(r.desc) !== key) return;
      sum += Math.abs(n(r.amount)); cnt++;
    });
    return { actual: round2(sum), rows: cnt };
  }

  function row(p, actual, rows) {
    var diff = round2(actual - p.amount);
    return {
      id: p.id, kind: p.kind, bucket: p.bucket, cat: p.cat, sub: p.sub,
      label: p.label || p.cat, key: p.key,
      planned: p.amount, actual: actual, rows: rows || 0,
      diff: diff,
      left: round2(p.amount - actual),
      pct: p.amount > 0 ? Math.round(actual / p.amount * 100) : null,
      /* ⛔ רק שורה בשם יכולה ״לא להופיע״. מעטפה ריקה פירושה שלא
         הוצאנו בקטגוריה — חדשות טובות, לא אזהרה. סימון שלה כחסרה
         צבע ארבע שורות בכתום והפך את האזהרה האמיתית לרעש.       */
      missing: p.kind === KIND.line && (rows || 0) === 0,
      over: diff > 0
    };
  }

  function compare(plan, bankRows, creditRows, month, opts) {
    opts = opts || {};
    var wash = opts.washPairs ||
      ((typeof ExpensesEngine !== 'undefined' && ExpensesEngine.washPairs)
        ? ExpensesEngine.washPairs(creditRows || []) : []);

    var P = live(plan);
    var incomeP = P.filter(function (p) { return p.kind === KIND.line && p.bucket === BUCKET.income; });
    var fixedP  = P.filter(function (p) { return p.kind === KIND.line && p.bucket === BUCKET.spend; });
    var envP    = P.filter(function (p) { return p.kind === KIND.envelope; });

    /* ── הכנסה ── */
    var incomeRows = incomeP.map(function (p) {
      var m = matchBank(bankRows, month, BUCKET.income, p.key);
      return row(p, m.actual, m.rows);
    });
    var matchedIncome = round2(incomeRows.reduce(function (a, r) { return a + r.actual; }, 0));

    /* ── פריטים קבועים ── */
    var fixedRows = fixedP.map(function (p) {
      var m = matchBank(bankRows, month, BUCKET.spend, p.key);
      return row(p, m.actual, m.rows);
    });

    /* ── מעטפות ──
       הבפועל של מעטפה הוא כל ההוצאה בקטגוריה **פחות** הפריטים
       הקבועים שכבר נספרו בנפרד. אותו ניכוי כמו בהצעה, כדי ששני
       הצדדים של המסך ידברו באותה שפה.                            */
    var cats = {};
    FlowEngine.spendByCategory(bankRows || [], creditRows || [], { month: month, washPairs: wash })
      .forEach(function (c) { cats[c.cat] = c.sum; });

    var fixedByCat = {};
    fixedRows.forEach(function (r) {
      fixedByCat[r.cat || ''] = round2((fixedByCat[r.cat || ''] || 0) + r.actual);
    });

    var seenCat = {};
    var envRows = envP.map(function (p) {
      seenCat[p.cat] = 1;
      var gross = cats[p.cat] || 0;
      var net = round2(gross - (fixedByCat[p.cat] || 0));
      var r = row(p, net, net !== 0 ? 1 : 0);
      r.gross = gross; r.fixedPart = fixedByCat[p.cat] || 0;
      return r;
    });

    /* ── מה שיצא ולא היה בתוכנית ──
       קטגוריה בלי מעטפה, וכן החלק של פריטים קבועים בקטגוריה שאין
       לה מעטפה. בלי הסעיף הזה סך הפיצול לא היה שווה לסך התזרים,
       והמסך היה מציג ״נשאר״ אחר מהמסך שלידו.                     */
    var extra = [];
    Object.keys(cats).forEach(function (c) {
      if (seenCat[c]) return;
      var net = round2(cats[c] - (fixedByCat[c] || 0));
      if (Math.abs(net) < 0.005) return;
      extra.push({ cat: c, actual: net, pending: c === PENDING });
    });
    extra.sort(function (a, b) { return b.actual - a.actual; });

    /* ── הכנסה שלא הייתה בתוכנית ── */
    var totalIncome = 0;
    (bankRows || []).forEach(function (r) {
      if ((r.bucket || '') !== BUCKET.income) return;
      if (mk(r.date) !== month) return;
      totalIncome += n(r.amount);
    });
    totalIncome = round2(totalIncome);
    var extraIncome = round2(totalIncome - matchedIncome);

    var sum = function (l, k) { return round2(l.reduce(function (a, r) { return a + (r[k] || 0); }, 0)); };
    var plannedIncome = sum(incomeRows, 'planned');
    var plannedSpend  = round2(sum(fixedRows, 'planned') + sum(envRows, 'planned'));
    var actualSpend   = round2(sum(fixedRows, 'actual') + sum(envRows, 'actual')
                        + extra.reduce(function (a, e) { return a + e.actual; }, 0));

    return {
      month: month,
      income: incomeRows, fixed: fixedRows, envelopes: envRows,
      extraSpend: extra, extraIncome: extraIncome,
      totals: {
        plannedIncome: plannedIncome,
        actualIncome: totalIncome,
        plannedSpend: plannedSpend,
        actualSpend: actualSpend,
        plannedSaved: round2(plannedIncome - plannedSpend),
        actualSaved: round2(totalIncome - actualSpend),
        spendLeft: round2(plannedSpend - actualSpend),
        hasPlan: (incomeRows.length + fixedRows.length + envRows.length) > 0
      },
      missing: fixedRows.filter(function (r) { return r.missing; })
                 .concat(incomeRows.filter(function (r) { return r.missing; }))
    };
  }

  return { KIND: KIND, BUCKET: BUCKET, PENDING: PENDING,
           descKey: descKey, parseRows: parseRows, live: live,
           recurringBank: recurringBank, envelopes: envelopes,
           suggest: suggest, compare: compare };
})();

if (typeof module !== 'undefined') module.exports = PlanEngine;
