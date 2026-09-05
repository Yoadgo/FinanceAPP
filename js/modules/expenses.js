/* ================================================================
   EXPENSES ENGINE — קיבוץ, הצעות, קיזוזים וסיכומים (לוגיקה טהורה)
   ----------------------------------------------------------------
   עונה על שאלה אחת: **על מה הוצאנו כסף.**

   ⚠️ מה שהמודול הזה במפורש *אינו* עושה: הוא **לא מנרמל שמות סוחרים**.
   הנירמול חי בשרת (`ingest.gs → normMerchant_`) והתוצאה נכתבת לעמודה
   `MerchantNorm`. אם היה כאן עותק שני של הנירמול, שתי הגרסאות היו
   נפרדות בשקט ברגע שאחת מהן משתנה. הלקוח **קורא** את מה שהשרת כתב.

   למה הקיבוץ רץ בלקוח ולא בשרת: 574 שורות זה כלום, השרת כבר מחזיר את
   כולן, וכל כוונון של הקיבוץ כאן **לא דורש פריסה מחדש** של Apps Script.

   ארבעת הדליים — ההבחנה שבלעדיה כל סיכום שגוי בסדר גודל:
     צריכה  · מה שבאמת נקנה. זו התשובה.
     העברות · כסף שזז בין יועד לאנשים. **מקוזז**, לא צריכה.
     סילוק  · בנק↔אשראי. אותו כסף פעמיים.
     הון    · תיקי השקעות, קרן הלוואות.
   ================================================================ */
const ExpensesEngine = (function () {

  var BUCKET = { consume: 'צריכה', transfer: 'העברות', settle: 'סילוק', capital: 'הון' };

  /* קטגוריות שאינן צריכה. נשמר כרשימה ולא כדגל בשורה — כדי שיועד יוכל
     לשנות דעה על קטגוריה שלמה בלי לגעת ב-574 שורות.                  */
  var NON_CONSUME = { 'העברות': BUCKET.transfer, 'הון': BUCKET.capital, 'סילוק': BUCKET.settle };

  /* מילות עצירה בסיסיות. **הרשימה המלאה מגיעה מהגיליון** — ערים וסיומות
     מסלקה הן ידע של יועד, לא של הקוד. `יבנה` קישרה 13 סוחרים שונים.   */
  var STOP = ['בעמ','בע','מ','בית','ה','של','רשת','LTD','THE','AND','INC','CO'];

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function s(v) { return v == null ? '' : String(v).trim(); }

  /* ── קריאת טאב Expenses לפי שמות כותרות ──
     לא לפי אינדקס: עמודה שיועד יוסיף ידנית באמצע לא תשבור כלום.       */
  function parseRows(values) {
    if (!values || values.length < 2) return [];
    var H = values[0].map(function (h) { return s(h); });
    var idx = {};
    H.forEach(function (h, i) { if (h) idx[h] = i; });
    var out = [];
    for (var r = 1; r < values.length; r++) {
      var v = values[r];
      if (!v || s(v[idx.Id]) === '') continue;
      out.push({
        id: s(v[idx.Id]), date: v[idx.Date], card: s(v[idx.Card]),
        billing: s(v[idx.BillingMonth]),
        merchant: s(v[idx.Merchant]), norm: s(v[idx.MerchantNorm]) || s(v[idx.Merchant]),
        amount: n(v[idx.Amount]), charge: n(v[idx.Charge]),
        note: s(v[idx.Note]), noteKind: s(v[idx.NoteKind]),
        installment: n(v[idx.Installment]), installments: n(v[idx.Installments]),
        cat: s(v[idx.Category]), sub: s(v[idx.Subcategory]),
        status: s(v[idx.Status]) || 'pending',
        row: r + 1
      });
    }
    return out;
  }

  /* ── אסימונים ──
     ≥3 תווים, לא במילות העצירה. פחות מ-3 תווים בעברית כמעט תמיד מילת
     קישור, ואסימון כזה מקבץ הכול עם הכול.                              */
  function tokens(str, stop) {
    var block = {};
    (stop || STOP).forEach(function (t) { block[String(t).toUpperCase()] = 1; });
    return String(str || '').toUpperCase().split(/[\s\-–—\/.,()]+/)
      .filter(function (t) { return t.length >= 3 && !block[t]; });
  }

  /* ── קיבוץ סוחרים ──
     חמדני: בכל סבב נבחר האסימון עם הציון הגבוה ביותר, והחברים שלו יוצאים
     מהמאגר. הציון אינו רק גודל הקבוצה אלא גודל × ביטחון, כי קבוצה גדולה
     סביב שם עיר גרועה מקבוצה קטנה סביב שם עסק.

     **הביטחון = באיזה שיעור האסימון *פותח* את שם הסוחר.** שם עסק פותח
     ("סופר פארם"), שם עיר יושב בסוף ("רמי לוי - יבנה"). נמדד: `סופר`
     פותח ב-100%, `יבנה` ב-15%. ההיוריסטיקה נכונה בכיוון אך **אינה
     חותכת** — `פארם` פותח ב-0% ובכל זאת משמעותי. ולכן היא קובעת רק
     **מה מסומן מראש**, לעולם לא מה נכתב.                               */
  function group(merchants, opts) {
    opts = opts || {};
    var stop = (opts.stopwords && opts.stopwords.length) ? opts.stopwords : STOP;
    var minLead = opts.minLead == null ? 0.5 : opts.minLead;

    var stat = {};
    merchants.forEach(function (o) {
      var t = tokens(o.norm, stop), seen = {};
      t.forEach(function (x, i) {
        if (seen[x]) return; seen[x] = 1;
        if (!stat[x]) stat[x] = { token: x, ms: [], first: 0 };
        stat[x].ms.push(o);
        if (i === 0) stat[x].first++;
      });
    });

    var taken = {}, groups = [];
    for (;;) {
      var best = null;
      for (var k in stat) {
        var free = stat[k].ms.filter(function (o) { return !taken[o.norm]; });
        if (free.length < 2) continue;
        var lead = stat[k].first / stat[k].ms.length;
        var score = free.length * (0.4 + lead);
        if (!best || score > best.score) best = { token: k, free: free, lead: lead, score: score };
      }
      if (!best) break;
      best.free.forEach(function (o) { taken[o.norm] = 1; });
      groups.push({
        token: best.token, lead: Math.round(best.lead * 100),
        confident: best.lead >= minLead,
        members: best.free.slice().sort(function (a, b) { return b.total - a.total; }),
        rows: best.free.reduce(function (a, o) { return a + o.rows; }, 0),
        total: round2(best.free.reduce(function (a, o) { return a + o.total; }, 0))
      });
    }
    groups.sort(function (a, b) { return b.total - a.total; });
    var singles = merchants.filter(function (o) { return !taken[o.norm]; })
      .sort(function (a, b) { return b.total - a.total; });
    return { groups: groups, singles: singles };
  }

  /* ── צבירת שורות לסוחרים ── */
  function byMerchant(rows) {
    var m = {};
    rows.forEach(function (r) {
      if (!m[r.norm]) m[r.norm] = { norm: r.norm, sample: r.merchant, rows: 0, total: 0, mo: {}, cards: {}, ids: [] };
      var o = m[r.norm];
      o.rows++; o.total += r.charge; o.ids.push(r.id);
      o.mo[r.billing] = round2((o.mo[r.billing] || 0) + r.charge);
      o.cards[r.card] = 1;
    });
    return Object.keys(m).map(function (k) {
      m[k].total = round2(m[k].total);
      m[k].cards = Object.keys(m[k].cards);
      return m[k];
    });
  }

  /* ── עוגנים להצעה משכן ──
     אסימון שמופיע בשתי קטגוריות שונות **נפסל**. אחרת `סופר` היה מקשר
     סופר-פארם (בריאות) לסופרמרקט (מזון) ומייצר הצעה מזיקה.            */
  function buildAnchors(rows, stop) {
    var m = {};
    rows.forEach(function (r) {
      if (!r.cat) return;
      tokens(r.norm, stop).forEach(function (t) {
        if (!m[t]) m[t] = { token: t, cat: r.cat, sub: r.sub, n: 0, conflict: false };
        if (m[t].cat !== r.cat) m[t].conflict = true;
        m[t].n++;
      });
    });
    var out = {};
    Object.keys(m).forEach(function (k) { if (!m[k].conflict) out[k] = m[k]; });
    return out;
  }

  function suggest(name, ctx) {
    ctx = ctx || {};
    var kw = ctx.keywords || [];
    for (var i = 0; i < kw.length; i++) {
      try { if (new RegExp(kw[i][0], 'i').test(name)) return { cat: kw[i][1], sub: kw[i][2], via: 'keyword' }; }
      catch (e) {}
    }
    var a = ctx.anchors || {}, t = tokens(name, ctx.stopwords), best = null;
    for (var j = 0; j < t.length; j++) {
      var h = a[t[j]];
      if (h && (!best || h.n > best.n)) best = h;
    }
    return best ? { cat: best.cat, sub: best.sub, via: 'neighbor:' + best.token } : { cat: '', sub: '', via: '' };
  }

  /* ── זוגות מתקזזים ──
     עסקה והיפוכה. אותו כרטיס, סכום הפוך בדיוק, בטווח ימים קצר.
     **רק ההתאמה המדויקת ננעלת אוטומטית.** נמדד על הנתונים: 2 זוגות בלבד
     מתוך 574 שורות. כל היתר — זיכויים אמיתיים או קיזוזים שדורשים אדם.  */
  function washPairs(rows, days) {
    var win = (days == null ? 3 : days) * 86400000;
    var neg = rows.filter(function (r) { return r.charge < 0; });
    var pos = rows.filter(function (r) { return r.charge > 0; });
    var used = {}, pairs = [];
    neg.forEach(function (a) {
      for (var i = 0; i < pos.length; i++) {
        var b = pos[i];
        if (used[b.id]) continue;
        if (b.card !== a.card) continue;
        if (Math.abs(b.charge + a.charge) > 0.01) continue;
        if (Math.abs(dateMs(b.date) - dateMs(a.date)) > win) continue;
        used[b.id] = 1;
        pairs.push({ credit: a, debit: b, amount: Math.abs(a.charge) });
        return;
      }
    });
    return pairs;
  }

  /* ── התאמת פירוט אשראי מול חיוב בעו"ש ──
     זו הבדיקה שמונעת ספירה כפולה, והיא **מותנית בכוונה**:
       תואם   → סילוק, לא נספר. ההוצאה היא הפירוט.
       חסר    → **הוצאה מרוכזת, נספרת במלואה.** בלי זה חיוב 02/06 בסך
                ₪16,938 היה נעלם, וכן כאל שאין לו דוח כלל.
       פער    → דגל אדום עם הסכום. בדיקה שלא יכולה להיכשל אינה בדיקה.  */
  function reconcile(creditRows, bankCharges) {
    var det = {};
    creditRows.forEach(function (r) {
      var k = r.card + '|' + r.billing;
      det[k] = round2((det[k] || 0) + r.charge);
    });
    return (bankCharges || []).map(function (b) {
      var k = b.card + '|' + b.billing;
      var d = det[k];
      if (d === undefined) return { card: b.card, billing: b.billing, bank: b.amount, detail: null, status: 'lump', gap: 0 };
      var gap = round2(d - b.amount);
      return { card: b.card, billing: b.billing, bank: b.amount, detail: d,
               status: Math.abs(gap) < 0.02 ? 'settled' : 'gap', gap: gap };
    });
  }

  /* ── סיכום ──
     `basis` בוחר את ציר הזמן: 'billing' מתלכד עם הבנק לאגורה, 'date'
     משקף מתי באמת קנית. שני התאריכים כבר בגיליון, ולכן זה מתג ולא פרויקט.
     שורות בזוג מתקזז ושורות שאינן צריכה יוצאות מ`consume`.             */
  function summarize(rows, opts) {
    opts = opts || {};
    var basis = opts.basis === 'date' ? 'date' : 'billing';
    var wash = {};
    (opts.washPairs || []).forEach(function (p) { wash[p.credit.id] = 1; wash[p.debit.id] = 1; });

    var byCat = {}, byMonth = {}, buckets = {};
    var consume = 0, transfer = 0, pending = 0, washed = 0, rowsUsed = 0;

    rows.forEach(function (r) {
      if (wash[r.id]) { washed += Math.abs(r.charge); return; }
      var key = monthKey(basis === 'billing' ? r.billing : r.date);
      if (opts.month && opts.month !== 'all' && key !== opts.month) return;
      rowsUsed++;
      byMonth[key] = round2((byMonth[key] || 0) + r.charge);

      var b = NON_CONSUME[r.cat] || BUCKET.consume;
      buckets[b] = round2((buckets[b] || 0) + r.charge);
      if (b === BUCKET.transfer) { transfer += r.charge; return; }
      if (b !== BUCKET.consume) return;

      if (!r.cat) { pending += r.charge; byCat['בהמתנה'] = round2((byCat['בהמתנה'] || 0) + r.charge); }
      else { consume += r.charge; byCat[r.cat] = round2((byCat[r.cat] || 0) + r.charge); }
    });

    return {
      rows: rowsUsed, consume: round2(consume), transfer: round2(transfer),
      pending: round2(pending), washed: round2(washed),
      total: round2(consume + pending + transfer),
      byCat: Object.keys(byCat).map(function (k) { return { cat: k, sum: byCat[k] }; })
               .sort(function (a, b) { return b.sum - a.sum; }),
      byMonth: Object.keys(byMonth).map(function (k) { return { month: k, sum: byMonth[k] }; }),
      buckets: buckets
    };
  }

  /* ── תשלומים פתוחים ──
     "כמה עוד נשאר לשלם" היא שאלה אחרת מ"כמה הוצאתי החודש", ולכן פאנל
     נפרד. `Amount` הוא הסכום המלא, `Charge` הוא מה שחויב הפעם.        */
  function openInstallments(rows) {
    var out = [];
    rows.forEach(function (r) {
      if (r.noteKind !== 'installment' || !r.installments || !r.installment) return;
      var left = r.installments - r.installment;
      if (left <= 0) return;
      out.push({ merchant: r.norm, per: r.charge, left: left,
                 remaining: round2(r.charge * left), of: r.installments, at: r.installment,
                 full: r.amount, date: r.date });
    });
    return out.sort(function (a, b) { return b.remaining - a.remaining; });
  }

  function dateMs(d) { return (d instanceof Date) ? d.getTime() : Date.parse(d) || 0; }
  function monthKey(d) {
    /* שלושה מקורות לאותו שדה, ולכל אחד כלל אחר:
       תאריך בלי שעה נקרא כ-UTC ולכן נחתך כטקסט; ISO עם שעה הוא Date
       שהגיליון סידר, ודווקא אותו צריך לקרוא באזור המקומי.            */
    if (typeof d === 'string') {
      var ymd = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);              // 2026-07-02 — תאריך בלי שעה
      if (ymd) return ymd[2] + '/' + ymd[1];
      var il = d.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);   // 02/07/2026 — פלט הפרסר
      if (il) return ('0' + il[2]).slice(-2) + '/' + il[3];
      /* ISO עם שעה ('2026-09-01T21:00:00.000Z') הוא Date שהגיליון סידר,
         והוא כבר מוסט ל-UTC. כאן דווקא **חייבים** את האזור המקומי —
         21:00 ב-1 בספטמבר UTC הוא ה-2 בספטמבר בישראל.               */
    }
    var x = (d instanceof Date) ? d : new Date(d);
    if (isNaN(x.getTime())) return '—';
    return ('0' + (x.getMonth() + 1)).slice(-2) + '/' + x.getFullYear();
  }
  function round2(v) { return Math.round(v * 100) / 100; }

  return { BUCKET: BUCKET, NON_CONSUME: NON_CONSUME, STOP: STOP,
           parseRows: parseRows, tokens: tokens, byMerchant: byMerchant, group: group,
           buildAnchors: buildAnchors, suggest: suggest, washPairs: washPairs,
           reconcile: reconcile, summarize: summarize, openInstallments: openInstallments };
})();

if (typeof module !== 'undefined') module.exports = ExpensesEngine;
