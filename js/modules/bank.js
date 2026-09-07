/* ===== MODULE: bank — מנוע העו״ש =====
   טהור: מקבל את `values` של טאב `Bank` ומחזיר מספרים. אין כאן DOM,
   אין fetch, ואין ידע על המסך.

   ⚠️ **תלוי ב-`ExpensesEngine.monthKey` בכוונה.** תאריך בגיליון חוזר
   מה-API כ-`2026-05-31T21:00:00.000Z` — כלומר חצות 1.6 בישראל. המרה
   נאיבית ל-UTC הייתה מזיזה כל תנועה בתחילת חודש לחודש הקודם. הלקח
   הזה כבר נלמד ונבדק במנוע ההוצאות, ושכפול שלו כאן היה מבטיח שיום
   אחד השניים יתפצלו בשקט. לכן: מקור אחד.                          */

const BankEngine = (function () {

  var BUCKET = { income: 'הכנסה', spend: 'צריכה', move: 'העברה', capital: 'הון' };
  var ORDER  = [BUCKET.income, BUCKET.spend, BUCKET.move, BUCKET.capital];

  /* רק שני הדליים הראשונים משנים כמה כסף יש. השאר מזיזים אותו. */
  var CHANGES_NET = {}; CHANGES_NET[BUCKET.income] = 1; CHANGES_NET[BUCKET.spend] = 1;

  function s(v) { return v == null ? '' : String(v).trim(); }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function round2(x) { return Math.round(x * 100) / 100; }

  function monthKey(d) {
    return (typeof ExpensesEngine !== 'undefined' && ExpensesEngine.monthKey)
      ? ExpensesEngine.monthKey(d) : '';
  }

  function parseRows(values) {
    if (!values || !values.length) return [];
    var H = values[0].map(s), idx = {};
    H.forEach(function (h, i) { if (h) idx[h] = i; });
    var g = function (r, k) { return idx[k] === undefined ? '' : r[idx[k]]; };

    return values.slice(1)
      .filter(function (r) { return s(g(r, 'Id')); })
      .map(function (r) {
        return {
          id: s(g(r, 'Id')),
          date: g(r, 'Date'),
          opCode: s(g(r, 'OpCode')),
          ref: s(g(r, 'Ref')),
          desc: s(g(r, 'Desc')),
          amount: n(g(r, 'Amount')),
          bucket: s(g(r, 'Bucket')),
          cat: s(g(r, 'Category')),
          sub: s(g(r, 'Subcategory')),
          freq: s(g(r, 'Freq')),
          tag: s(g(r, 'Tag')),
          settlesCard: s(g(r, 'SettlesCard')),
          settlesMonth: s(g(r, 'SettlesMonth')),
          status: s(g(r, 'Status')),
          why: s(g(r, 'RuleId'))
        };
      });
  }

  /* סינון אחד לכל התצוגות, כדי שהסכום למעלה והרשימה מתחתיו לא ייפרדו. */
  function rowsIn(rows, opts) {
    opts = opts || {};
    return (rows || []).filter(function (r) {
      if (opts.month && opts.month !== 'all' && monthKey(r.date) !== opts.month) return false;
      /* ⛔ `opts.bucket` ריק הוא **סינון לשורות בלי דלי**, לא "בלי סינון".
         בדיקת אמת פשוטה החזירה את כל השורות תחת ״בהמתנה״ — 13 במקום 3.
         היעדר סינון מסומן ב-undefined, וזה ההבדל היחיד שסופר.        */
      if (opts.bucket !== undefined && opts.bucket !== 'all'
          && (r.bucket || '') !== opts.bucket) return false;
      return true;
    });
  }

  function summarize(rows, opts) {
    opts = opts || {};
    var list = rowsIn(rows, { month: opts.month });

    var byBucket = {}, months = {}, pending = [];
    var incCat = {}, spendCat = {}, incFreq = { 'קבוע': 0, 'חד-פעמי': 0, '': 0 };
    var income = 0, spend = 0;

    list.forEach(function (r) {
      var b = r.bucket || '';
      byBucket[b] = round2((byBucket[b] || 0) + r.amount);
      if (!b) { pending.push(r); return; }

      var mk = monthKey(r.date);
      months[mk] = months[mk] || { month: mk, income: 0, spend: 0 };

      if (b === BUCKET.income) {
        income += r.amount;
        months[mk].income = round2(months[mk].income + r.amount);
        incCat[r.cat || '—'] = round2((incCat[r.cat || '—'] || 0) + r.amount);
        /* התדירות היא הציר שמבדיל בין הכנסה שאפשר לסמוך עליה לבין
           כזו שהגיעה פעם אחת — ולכן היא נספרת בנפרד ולא כקטגוריה. */
        incFreq[r.freq || ''] = round2((incFreq[r.freq || ''] || 0) + r.amount);
      } else if (b === BUCKET.spend) {
        spend += Math.abs(r.amount);
        months[mk].spend = round2(months[mk].spend + Math.abs(r.amount));
        spendCat[r.cat || '—'] = round2((spendCat[r.cat || '—'] || 0) + Math.abs(r.amount));
      }
    });

    var mList = Object.keys(months).map(function (k) {
      var m = months[k]; m.net = round2(m.income - m.spend); return m;
    }).sort(function (a, b) { return String(a.month).localeCompare(String(b.month)); });

    var sortMap = function (m) {
      return Object.keys(m).map(function (k) { return { cat: k, sum: m[k] }; })
              .sort(function (a, b) { return Math.abs(b.sum) - Math.abs(a.sum); });
    };

    return {
      rows: list.length,
      byBucket: byBucket,
      buckets: ORDER.concat(['']).filter(function (b) { return byBucket[b] !== undefined; })
                 .map(function (b) { return { bucket: b, sum: byBucket[b] }; }),
      income: round2(income), spend: round2(spend), net: round2(income - spend),
      incomeByCat: sortMap(incCat), spendByCat: sortMap(spendCat),
      incomeByFreq: incFreq,
      months: mList,
      pending: pending,
      allMonths: monthsOf(rows)
    };
  }

  function monthsOf(rows) {
    var seen = {};
    (rows || []).forEach(function (r) { var k = monthKey(r.date); if (k) seen[k] = 1; });
    return Object.keys(seen).sort(function (a, b) { return String(a).localeCompare(String(b)); });
  }

  /* ── קיזוז מול פירוט האשראי ──
     שורת סילוק בעו״ש היא **אותו כסף** כמו פירוט האשראי של אותו חודש,
     ולכן היא יושבת בדלי `העברה` ואינה נספרת בצריכה. הפאנל הזה לא
     משנה שום סכום — הוא רק מראה שהשניים מתלכדים, וכמה חסר אם לא. */
  function reconcile(bankRows, creditRows) {
    var settle = (bankRows || []).filter(function (r) { return r.settlesCard; });
    var byKey = {};
    (creditRows || []).forEach(function (c) {
      var card = String(c.card || '').slice(-4);
      var k = card + '|' + monthKey(c.billing);
      byKey[k] = round2((byKey[k] || 0) + c.charge);
    });
    return settle.map(function (r) {
      var card = String(r.settlesCard).slice(-4);
      var k = card + '|' + (r.settlesMonth || monthKey(r.date));
      var detail = byKey[k];
      var bank = Math.abs(r.amount);
      return {
        id: r.id, date: r.date, desc: r.desc, card: card,
        month: r.settlesMonth || monthKey(r.date),
        bank: bank,
        detail: detail === undefined ? null : round2(detail),
        gap: detail === undefined ? null : round2(bank - detail),
        status: detail === undefined ? 'no-detail'
              : Math.abs(bank - detail) < 0.5 ? 'match' : 'gap'
      };
    });
  }

  return { BUCKET: BUCKET, ORDER: ORDER, CHANGES_NET: CHANGES_NET,
           parseRows: parseRows, rowsIn: rowsIn, summarize: summarize,
           monthsOf: monthsOf, reconcile: reconcile, monthKey: monthKey };
})();

if (typeof module !== 'undefined') module.exports = BankEngine;
