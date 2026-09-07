/* ===== MODULE: goals — יעדי חיסכון =====
   טהור. מקבל את `values` של טאב `Goals`, את שורות העו״ש, ואת העודף
   החודשי מהתוכנית — ומחזיר מספרים.

   ⚠️ **מקור אמת אחד ליתרה.** `נחסך = Opening + סכום השורות המתויגות`.
   אין כאן חיבור של שווי תיק, ובכוונה: העברה לתיק שמסומנת ליעד ושווי
   התיק הם אותו כסף, וחיבור שלהם היה מציג פי שניים.

   ⚠️ **הקצאה ותחזית הן שני מספרים שונים.** `Monthly` הוא מה שיועד
   *החליט* להפנות; הקצב בפועל נמדד מהתיוגים. הפער ביניהם הוא בדיוק
   מה שהמסך אמור לצעוק — לא משהו להחליק בממוצע אחד.               */

const GoalsEngine = (function () {

  var SOURCE = { tagged: 'תיוג', portfolio: 'תיק' };
  /* דלי שממנו כסף באמת עובר לחיסכון. `צריכה` אינה חיסכון, ו`הכנסה`
     היא הכיוון ההפוך. */
  var MOVES = { 'הון': 1, 'העברה': 1 };

  function s(v) { return v == null ? '' : String(v).trim(); }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function round2(x) { return Math.round(x * 100) / 100; }
  function mk(d) {
    return (typeof ExpensesEngine !== 'undefined' && ExpensesEngine.monthKey)
      ? ExpensesEngine.monthKey(d) : '';
  }

  function parseRows(values) {
    if (!values || !values.length) return [];
    var H = values[0].map(s), idx = {};
    H.forEach(function (h, i) { if (h) idx[h] = i; });
    var g = function (r, k) { return idx[k] === undefined ? '' : r[idx[k]]; };

    return values.slice(1)
      .filter(function (r) { return s(g(r, 'GoalId')); })
      .map(function (r) {
        var a = s(g(r, 'Active')).toLowerCase();
        return {
          id: s(g(r, 'GoalId')),
          name: s(g(r, 'Name')),
          target: Math.abs(n(g(r, 'Target'))),
          monthly: Math.abs(n(g(r, 'Monthly'))),
          deadline: s(g(r, 'Deadline')).slice(0, 10),
          priority: n(g(r, 'Priority')),
          source: s(g(r, 'Source')) || SOURCE.tagged,
          opening: Math.abs(n(g(r, 'Opening'))),
          active: a !== 'false' && a !== '0' && a !== 'לא',
          notes: s(g(r, 'Notes'))
        };
      });
  }

  function live(goals) {
    return (goals || []).filter(function (g) { return g.active; })
      .sort(function (a, b) { return (a.priority || 0) - (b.priority || 0); });
  }

  /* ── שורות שסומנו ליעד ── */
  function taggedRows(bankRows, goalId) {
    return (bankRows || []).filter(function (r) { return s(r.goalId) === goalId; });
  }

  /* ── שורות שאפשר לסמן ──
     תנועה יוצאת בדלי שמזיז כסף, שעוד לא שויכה. שורת סילוק אשראי
     נשארת בחוץ: היא תשלום על מה שכבר הוצאנו, לא חיסכון.          */
  function candidates(bankRows) {
    return (bankRows || []).filter(function (r) {
      if (s(r.goalId)) return false;
      if (!MOVES[r.bucket || '']) return false;
      if (n(r.amount) >= 0) return false;
      if (s(r.settlesCard)) return false;
      return true;
    }).sort(function (a, b) { return Math.abs(b.amount) - Math.abs(a.amount); });
  }

  /* ── חודשים שיש בהם תיוג, כדי למדוד קצב בפועל ── */
  function pace(rows) {
    var m = {};
    rows.forEach(function (r) { var k = mk(r.date); if (k) m[k] = round2((m[k] || 0) + Math.abs(n(r.amount))); });
    var keys = Object.keys(m);
    if (!keys.length) return { months: 0, avg: 0, byMonth: [] };
    var sum = keys.reduce(function (a, k) { return a + m[k]; }, 0);
    return {
      months: keys.length,
      avg: round2(sum / keys.length),
      byMonth: keys.sort().map(function (k) { return { month: k, sum: m[k] }; })
    };
  }

  function monthsBetween(fromDate, iso) {
    if (!iso) return null;
    var p = String(iso).slice(0, 10).split('-');
    if (p.length < 2) return null;
    var y = Number(p[0]), mo = Number(p[1]);
    if (!isFinite(y) || !isFinite(mo)) return null;
    var d = fromDate || new Date();
    var diff = (y - d.getFullYear()) * 12 + (mo - (d.getMonth() + 1));
    return diff;
  }

  function addMonths(d, k) {
    var x = new Date(d.getFullYear(), d.getMonth() + k, 1);
    return ('0' + (x.getMonth() + 1)).slice(-2) + '/' + x.getFullYear();
  }

  /* ── יעד אחד ── */
  function status(goal, bankRows, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var rows = taggedRows(bankRows, goal.id);
    var tagged = round2(rows.reduce(function (a, r) { return a + Math.abs(n(r.amount)); }, 0));
    var saved = round2(goal.opening + tagged);
    var left = round2(Math.max(0, goal.target - saved));
    var p = pace(rows);

    var out = {
      id: goal.id, name: goal.name, target: goal.target,
      opening: goal.opening, tagged: tagged, rows: rows.length,
      saved: saved, left: left,
      pct: goal.target > 0 ? Math.min(100, Math.round(saved / goal.target * 100)) : 0,
      done: saved >= goal.target,
      monthly: goal.monthly,
      paceMonths: p.months, paceAvg: p.avg,
      deadline: goal.deadline || '',
      etaMonths: null, etaLabel: '', needMonthly: null, shortfall: 0,
      deadlineMonths: null, late: false
    };

    /* ⛔ הקצב לתחזית הוא **ההקצאה**, לא הממוצע שנמדד. הממוצע רץ על
       חודשים שכבר קרו, וחודש שבו לא הפרשנו היה מותח את התחזית
       לנצח. ההקצאה היא ההחלטה, והמסך משווה אליה את הביצוע.      */
    if (!out.done && goal.monthly > 0) {
      out.etaMonths = Math.ceil(left / goal.monthly);
      out.etaLabel = addMonths(now, out.etaMonths);
    }

    var dm = monthsBetween(now, goal.deadline);
    if (dm !== null) {
      out.deadlineMonths = dm;
      if (!out.done) {
        if (dm <= 0) { out.late = true; out.needMonthly = left; }
        else {
          out.needMonthly = round2(left / dm);
          out.shortfall = round2(Math.max(0, out.needMonthly - goal.monthly));
          out.late = out.shortfall > 0;
        }
      }
    }
    return out;
  }

  /* ── כל היעדים מול העודף החודשי ──
     `surplus` מגיע מהתוכנית (`plannedSaved`). זו כל הסיבה שהמסך הזה
     נבנה אחרי התוכנית: בלי מכנה, ״הקצאה״ היא מספר בלי משמעות.   */
  function summarize(goals, bankRows, surplus, opts) {
    var list = live(goals).map(function (g) { return status(g, bankRows, opts); });
    var allocated = round2(list.reduce(function (a, g) { return a + (g.done ? 0 : g.monthly); }, 0));
    var sup = n(surplus);
    return {
      goals: list,
      count: list.length,
      target: round2(list.reduce(function (a, g) { return a + g.target; }, 0)),
      saved: round2(list.reduce(function (a, g) { return a + g.saved; }, 0)),
      allocated: allocated,
      surplus: round2(sup),
      /* ⚠️ המספר שהמסך קיים בשבילו. חיובי = הקצאנו יותר ממה שיש. */
      over: round2(Math.max(0, allocated - sup)),
      free: round2(Math.max(0, sup - allocated)),
      hasSurplus: surplus !== null && surplus !== undefined && isFinite(sup),
      late: list.filter(function (g) { return g.late && !g.done; }),
      done: list.filter(function (g) { return g.done; })
    };
  }

  return { SOURCE: SOURCE, MOVES: MOVES,
           parseRows: parseRows, live: live, taggedRows: taggedRows,
           candidates: candidates, pace: pace, status: status, summarize: summarize };
})();

if (typeof module !== 'undefined') module.exports = GoalsEngine;
