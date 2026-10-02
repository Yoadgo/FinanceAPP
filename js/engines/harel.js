/* ================================================================
   HAREL — קרן השתלמות ופנסיה בהראל. (אפיון 2.10.2026, זיכרון הפרויקט
   savings_funds.)

   שלושה דברים במנוע הזה:
   1. **פענוח אקסל ההפקדות** שמורידים מאתר הראל. יש שני פורמטים שונים,
      ושניהם נבדקו על קבצים אמיתיים:
        השתלמות — טאב "תנועות":          תאריך ערך (תאריך מלא) · תגמולי עמית
        פנסיה   — טאב "תנועות אחרונות": חודש הפקדה (טקסט MM/YYYY) · תגמולי עובד/עצמאי
      העמודות נמצאות לפי שם הכותרת, לא לפי מיקום.
   2. **מניעת כפילויות.** לשורה אין מזהה. המפתח הוא התוכן כולו (מועד
      הפקדה, חודש משכורת, ארבעת הסכומים), וההשוואה לפי ספירה: אם בקובץ
      יש שתי שורות זהות ובמסד אחת — נכנסת אחת. הייצוא של הראל חלקי
      (שני הקבצים מתחילים ב-1.2025), כך שכל קובץ חדש נפגש עם חפיפה.
   3. **הפקדה חודשית לפי חודש משכורת.** הראל מפזרת תיקונים רטרואקטיביים
      של אגורות עד עשרות שקלים על פני חודשים. לפי תאריך ההפקדה הם נראים
      כמו "הפקדה של ₪20" — לפי חודש המשכורת הם מתחברים להפקדה שלהם.

   ועוד: התאמת דוח ("מה הזיז את היתרה") — יתרה בתחילת השנה + הפקדות +
   רווחים − דמי ניהול − ביטוח − אחר = היתרה בדוח. פער = מוצג, לא מוסתר.

   הקופה היא נכס שקלי בפני עצמו. מקור האמת ליתרה ולתשואה = הראל.
   ================================================================ */

export const TAX_RATE = 0.25;   // מס רווחי הון ריאלי. התחזית ריאלית → אותו בסיס.

const COLS = {
  dep: ['תאריך ערך', 'חודש הפקדה'],
  sal: ['חודש משכורת'],
  employer: ['מעסיק'],
  me: ['תגמולי עמית', 'תגמולי עובד/עצמאי', 'תגמולי עובד'],
  er: ['תגמולי מעסיק'],
  sev: ['פיצויים'],
  tot: ['סכום ההפקדה'],
};
const REQUIRED = ['dep', 'sal', 'tot'];

const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const pad = n => String(n).padStart(2, '0');

function findHeader(values) {
  for (let i = 0; i < Math.min(values.length, 15); i++) {
    const row = (values[i] || []).map(clean);
    const idx = {};
    for (const [k, names] of Object.entries(COLS)) {
      const j = row.findIndex(c => names.includes(c));
      if (j >= 0) idx[k] = j;
    }
    if (REQUIRED.every(k => idx[k] !== undefined)) return { row: i, idx };
  }
  return null;
}

export const isHarelSheet = values => !!findHeader(values || []);

/* Date / 'MM/YYYY' / 'DD/MM/YYYY' / מספר סידורי של אקסל → { day?, month } */
function toPeriod(v) {
  if (v instanceof Date && !isNaN(v)) {
    const m = `${v.getFullYear()}-${pad(v.getMonth() + 1)}`;
    return { day: `${m}-${pad(v.getDate())}`, month: m };
  }
  const s = clean(v);
  let x = s.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (x) return { month: `${x[2]}-${pad(x[1])}` };
  x = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (x) { const m = `${x[3]}-${pad(x[2])}`; return { day: `${m}-${pad(x[1])}`, month: m }; }
  x = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (x) return { day: x[3] ? `${x[1]}-${x[2]}-${x[3]}` : undefined, month: `${x[1]}-${x[2]}` };
  return null;
}
const amount = v => {
  if (typeof v === 'number') return v;
  const s = clean(v).replace(/[₪,\s]/g, '');
  return s === '' || s === '-' ? 0 : Number(s);
};

/* גיליון → { format, rows, warnings }.
   row = { dep: 'YYYY-MM-DD' | 'YYYY-MM', depMonth, sal: 'YYYY-MM', employer, me, er, sev, tot } */
export function parseHarelSheet(values) {
  const hdr = findHeader(values || []);
  if (!hdr) return { format: null, rows: [], warnings: ['לא נמצאה שורת כותרת של הראל (חודש משכורת · סכום ההפקדה).'] };
  const { idx } = hdr;
  const rows = [], warnings = [];
  let badSum = 0, skipped = 0, hasDay = false;
  for (let i = hdr.row + 1; i < values.length; i++) {
    const r = values[i] || [];
    if (r.every(c => clean(c) === '')) continue;
    const dep = toPeriod(r[idx.dep]), sal = toPeriod(r[idx.sal]);
    const tot = amount(r[idx.tot]);
    if (!dep || !sal || !isFinite(tot)) { skipped++; continue; }
    const me = idx.me !== undefined ? amount(r[idx.me]) : 0;
    const er = idx.er !== undefined ? amount(r[idx.er]) : 0;
    const sev = idx.sev !== undefined ? amount(r[idx.sev]) : 0;
    if (Math.abs(r2(me + er + sev) - r2(tot)) > 0.02) badSum++;
    if (dep.day) hasDay = true;
    rows.push({ dep: dep.day || dep.month, depMonth: dep.month, sal: sal.month, employer: idx.employer !== undefined ? clean(r[idx.employer]) : '', me: r2(me), er: r2(er), sev: r2(sev), tot: r2(tot) });
  }
  if (skipped) warnings.push(`${skipped} שורות בלי תאריך או סכום תקינים — דולגו.`);
  if (badSum) warnings.push(`${badSum} שורות שבהן עמית + מעסיק + פיצויים ≠ סכום ההפקדה.`);
  const sevTotal = rows.reduce((s, x) => s + x.sev, 0);
  return { format: hasDay ? 'value-date' : 'deposit-month', rows, warnings, hasSeverance: sevTotal > 0 };
}

/* מפתח תוכן. אותה שורה בשני ייצואים → אותו מפתח. */
export const depositKey = d => [d.dep, d.sal, r2(d.me).toFixed(2), r2(d.er).toFixed(2), r2(d.sev).toFixed(2), r2(d.tot).toFixed(2)].join('|');

/* השוואה לפי ספירה. existing = ההפקדות שכבר שמורות בקופה.
   מחזיר { add, already, merged } — merged ממוין לפי מועד הפקדה. */
export function planDeposits(existing, incoming) {
  const have = new Map();
  (existing || []).forEach(d => { const k = depositKey(d); have.set(k, (have.get(k) || 0) + 1); });
  const seen = new Map(), add = [];
  let already = 0;
  for (const d of incoming) {
    const k = depositKey(d);
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    if (n <= (have.get(k) || 0)) already++;
    else add.push(d);
  }
  const merged = [...(existing || []), ...add].sort((a, b) => (a.dep < b.dep ? -1 : a.dep > b.dep ? 1 : a.sal < b.sal ? -1 : a.sal > b.sal ? 1 : 0));
  return { add, already, merged };
}

/* ההפקדות לפי חודש משכורת: [{ month, me, er, sev, tot, rows }] ממוין. */
export function bySalaryMonth(deposits) {
  const m = new Map();
  for (const d of deposits || []) {
    const x = m.get(d.sal) || { month: d.sal, me: 0, er: 0, sev: 0, tot: 0, rows: 0 };
    x.me += d.me; x.er += d.er; x.sev += d.sev; x.tot += d.tot; x.rows++;
    m.set(d.sal, x);
  }
  return [...m.values()].map(x => ({ ...x, me: r2(x.me), er: r2(x.er), sev: r2(x.sev), tot: r2(x.tot) })).sort((a, b) => (a.month < b.month ? -1 : 1));
}

const addMonths = (ym, k) => { const [y, m] = ym.split('-').map(Number); const t = y * 12 + m - 1 + k; return `${Math.floor(t / 12)}-${pad(t % 12 + 1)}`; };

/* קצב ההפקדה. "החודש האחרון" = חודש המשכורת האחרון שיש לו הפקדה אמיתית
   (לפחות חצי מהחציון), לא חודש שיש בו רק תיקון של אגורות.
   avg12 = ממוצע 12 חודשי משכורת עד אליו, כולל תוספות ותיקונים. */
export function depositRate(deposits) {
  const months = bySalaryMonth(deposits);
  if (!months.length) return null;
  const sorted = months.map(x => x.tot).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const real = months.filter(x => x.tot >= median / 2);
  if (!real.length) return null;
  const last = real[real.length - 1];
  const from = addMonths(last.month, -11);
  const window = months.filter(x => x.month >= from && x.month <= last.month);
  const covered = window.length;
  const sum = window.reduce((s, x) => s + x.tot, 0);
  return {
    lastMonth: last.month, last: last.tot,
    avg12: r2(sum / 12), months12: covered, from,
    split: window.reduce((s, x) => ({ me: s.me + x.me, er: s.er + x.er, sev: s.sev + x.sev }), { me: 0, er: 0, sev: 0 }),
    /* שורות תיקון = כל שורה שאינה ההפקדה הראשית של חודש המשכורת שלה. */
    corrections: (deposits || []).length - months.length,
  };
}

/* סכומים לפי שנת ההפקדה — מה שהדוח של הראל קורא "הפקדות השנה". */
export function yearTotals(deposits, year) {
  const y = String(year);
  return (deposits || []).filter(d => d.depMonth.startsWith(y)).reduce((s, d) => ({ me: r2(s.me + d.me), er: r2(s.er + d.er), sev: r2(s.sev + d.sev), tot: r2(s.tot + d.tot), rows: s.rows + 1 }), { me: 0, er: 0, sev: 0, tot: 0, rows: 0 });
}

/* ההפקדה שהתחזית משתמשת בה: מההפקדות בפועל אם נקלטו, אחרת מה שהוזן. */
export function effectiveMonthly(pot) {
  const rate = pot && pot.deposits && pot.deposits.length ? depositRate(pot.deposits) : null;
  return rate ? { value: rate.avg12, source: 'deposits', rate } : { value: Number(pot && pot.monthly) || 0, source: 'manual', rate: null };
}

/* ---------------- דוח תקופתי (מוזן ידנית מה-PDF) ----------------
   report = { asOf, balance, startBalance, depositsYtd, gainsYtd, feesYtd,
              insuranceYtd, otherYtd, ytdPct, ytdThrough: 'YYYY-MM',
              harelPension?, harelPensionBalanceOnly? }
   (fees/insurance/other — כסכום חיובי שירד מהיתרה.)                   */
export function reconcile(rep) {
  if (!rep || rep.startBalance == null || rep.balance == null) return null;
  const n = k => Number(rep[k]) || 0;
  const computed = n('startBalance') + n('depositsYtd') + n('gainsYtd') - n('feesYtd') - n('insuranceYtd') - n('otherYtd');
  const gap = r2(n('balance') - computed);
  return { computed: r2(computed), gap, ok: Math.abs(gap) <= 5 };
}

export const latestReport = pot => {
  const reps = (pot && pot.reports) || [];
  return reps.length ? [...reps].sort((a, b) => (a.asOf < b.asOf ? -1 : 1))[reps.length - 1] : null;
};

/* הוספת דוח: דוח באותו תאריך מחליף את הקודם (עריכה), אחרת נוסף. */
export function upsertReport(reports, rep) {
  const out = (reports || []).filter(r => r.asOf !== rep.asOf);
  out.push(rep);
  return out.sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
}

/* נזילות: פנסיה — לא. השתלמות — מתאריך הנזילות (אם הוזן). */
export function isLiquid(pot, today) {
  if (!pot || pot.kind === 'pension') return false;
  return !pot.liquidFrom || pot.liquidFrom <= today;
}

/* דמי ניהול בשקלים לשנה, לפי היתרה הנוכחית. */
export const feesPerYear = pot => r2((Number(pot.balance) || 0) * (Number(pot.feeBalancePct) || 0) / 100 + effectiveMonthly(pot).value * 12 * (Number(pot.feeDepositPct) || 0) / 100);

/* מס שנחסך בהשתלמות: רווח × 25%. ההנחה: הכסף היה מושקע אותו דבר בתיק
   רגיל. התחזית ריאלית, והמס בישראל על רווח ריאלי — אותו בסיס. */
export const taxSaved = gains => r2(Math.max(0, Number(gains) || 0) * TAX_RATE);

/* כמה מהצבירה בתחזית הוא רווח (ולא הפקדות): ערך סופי − יתרה היום − הפקדות. */
export const gainOf = (series, startBalance) => {
  const last = series[series.length - 1];
  return r2(last.value - (Number(startBalance) || 0) - last.deposited);
};
