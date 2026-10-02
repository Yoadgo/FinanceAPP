/* קרן השתלמות ופנסיה בהראל — פענוח שני פורמטי האקסל, מניעת כפילויות,
   הפקדה לפי חודש משכורת, והתאמת דוח.
   חלק א' סינתטי (רץ תמיד). חלק ב' על הקבצים האמיתיים (tests/private/harel,
   לא בריפו), מול הסכומים שבדוחות ה-PDF של הראל (29.9.2026). */
import { section, ok, eq, info } from './lib.mjs';
import { privateJson, revive } from './private.mjs';
import { isHarelSheet, parseHarelSheet, depositKey, planDeposits, bySalaryMonth, depositRate, yearTotals, effectiveMonthly, reconcile, upsertReport, latestReport, isLiquid, feesPerYear, taxSaved, gainOf } from '../js/engines/harel.js';
import { projectPot } from '../js/engines/forecast.js';

const D = (y, m, d) => new Date(y, m - 1, d);
const STUDY_H = ['תאריך ערך', 'חודש משכורת', 'מעסיק', 'תגמולי עמית', 'תגמולי מעסיק', 'פיצויים', 'סכום ההפקדה'];
const PENS_H = ['חודש הפקדה', 'חודש משכורת', 'מעסיק', 'תגמולי עובד/עצמאי', 'תגמולי מעסיק', 'פיצויים', 'סכום ההפקדה'];

section('הראל — זיהוי ופענוח');
{
  ok(isHarelSheet([STUDY_H]), 'כותרת השתלמות מזוהה');
  ok(isHarelSheet([['', ''], PENS_H]), 'כותרת פנסיה מזוהה גם כשהיא לא בשורה הראשונה');
  ok(!isHarelSheet([['תאריך', 'סוג פעולה', 'שם נייר']]), 'קובץ איביאי לא מזוהה כהראל');
  const s = parseHarelSheet([STUDY_H, [D(2026, 9, 1), D(2026, 8, 1), 'צה"ל', 444.23, 1332.68, 0, 1776.91], [D(2026, 9, 1), D(2025, 10, 1), 'צה"ל', 5, 15.02, 0, 20.02], ['', '', '', '', '', '', '']]);
  eq(s.format, 'value-date', 'השתלמות: תאריך ערך מלא');
  eq(s.rows.length, 2, 'שתי שורות, השורה הריקה דולגה');
  eq(s.rows[0].dep, '2026-09-01', 'תאריך ערך → ISO');
  eq(s.rows[1].sal, '2025-10', 'חודש משכורת → YYYY-MM');
  eq(s.hasSeverance, false, 'אין פיצויים');
  const p = parseHarelSheet([PENS_H, ['09/2026', '08/2026', 'צה"ל', 1219.67, 1306.79, 1045.43, 3571.89], ['09/2026', '10/2025', 'צה"ל', '14.37', '15.40', '12.32', '42.09']]);
  eq(p.format, 'deposit-month', 'פנסיה: חודש הפקדה בלי יום');
  eq(p.rows[0].dep, '2026-09', 'חודש הפקדה MM/YYYY → YYYY-MM');
  eq(p.rows[1].me, 14.37, 'סכום כטקסט → מספר');
  eq(p.hasSeverance, true, 'יש פיצויים → כנראה פנסיה');
  eq(p.warnings.length, 0, 'בלי אזהרות');
  const bad = parseHarelSheet([PENS_H, ['09/2026', '08/2026', 'x', 1, 1, 1, 5]]);
  ok(bad.warnings.some(w => w.includes('≠')), 'סכום שלא מתיישב → אזהרה');
}

section('הראל — מניעת כפילויות לפי ספירה');
{
  const a = { dep: '2026-09', sal: '2026-01', me: 0.25, er: 0.27, sev: 0.22, tot: 0.74 };
  const b = { dep: '2026-09', sal: '2026-02', me: 1, er: 1, sev: 1, tot: 3 };
  eq(depositKey(a), depositKey({ ...a, me: 0.250000001 }), 'רעש עשרוני לא משנה מפתח');
  let pl = planDeposits([], [a, b]);
  eq(pl.add.length, 2, 'מסד ריק → הכול נכנס');
  pl = planDeposits(pl.merged, [a, b]);
  eq(pl.add.length, 0, 'אותו קובץ שוב → כלום');
  eq(pl.already, 2, '...ושתיים מזוהות כקיימות');
  pl = planDeposits([a], [a, a, b]);
  eq(pl.add.length, 2, 'שתי שורות זהות בקובץ ואחת במסד → נכנסת אחת (ועוד b)');
  eq(pl.merged.length, 3, 'סך הכול 3');
}

section('הראל — הפקדה לפי חודש משכורת');
{
  const rows = [
    { dep: '2026-07-01', depMonth: '2026-07', sal: '2026-06', me: 400, er: 1200, sev: 0, tot: 1600 },
    { dep: '2026-08-01', depMonth: '2026-08', sal: '2026-07', me: 400, er: 1200, sev: 0, tot: 1600 },
    { dep: '2026-09-01', depMonth: '2026-09', sal: '2026-06', me: 5, er: 15, sev: 0, tot: 20 },
    { dep: '2026-09-01', depMonth: '2026-09', sal: '2026-08', me: 0.1, er: 0.2, sev: 0, tot: 0.3 },
  ];
  const by = bySalaryMonth(rows);
  eq(by.length, 3, 'שלושה חודשי משכורת');
  eq(by.find(x => x.month === '2026-06').tot, 1620, 'התיקון מתחבר לחודש שלו');
  const r = depositRate(rows);
  eq(r.lastMonth, '2026-07', 'חודש עם תיקון של 30 אגורות בלבד אינו "החודש האחרון"');
  eq(r.corrections, 1, 'שורת תיקון אחת (שורה נוספת לחודש שכבר יש לו הפקדה)');
  eq(effectiveMonthly({ monthly: 999, deposits: rows }).source, 'deposits', 'כשיש הפקדות — מהן');
  eq(effectiveMonthly({ monthly: 999 }).value, 999, 'בלי הפקדות — מה שהוזן');
}

section('הראל — דוח, נזילות, מס');
{
  const rep = { asOf: '2026-09-29', balance: 384538, startBalance: 325405, depositsYtd: 33438, gainsYtd: 27200, feesYtd: 3, insuranceYtd: 1105, otherYtd: 395 };
  const rc = reconcile(rep);
  eq(rc.gap, -2, 'פנסיה (מהדוח האמיתי): פער ₪2');
  ok(rc.ok, '...בתוך הסבולת');
  const st = reconcile({ asOf: '2026-09-29', balance: 146339, startBalance: 117359, depositsYtd: 17954, gainsYtd: 11200, feesYtd: 130 });
  eq(st.gap, -44, 'השתלמות (מהדוח האמיתי): פער ₪44 — הרווחים בדוח מעוגלים');
  ok(!st.ok, '...ומסומן, לא מוסתר');
  eq(reconcile({ balance: 1 }), null, 'בלי יתרת פתיחה — אין התאמה (לא אפס)');
  let reps = upsertReport([], { asOf: '2026-08-31', balance: 1 });
  reps = upsertReport(reps, { asOf: '2026-09-29', balance: 2 });
  reps = upsertReport(reps, { asOf: '2026-08-31', balance: 3 });
  eq(reps.length, 2, 'דוח באותו תאריך מחליף');
  eq(latestReport({ reports: reps }).balance, 2, 'האחרון לפי תאריך');
  eq(isLiquid({ kind: 'pension' }, '2030-01-01'), false, 'פנסיה לא נזילה');
  eq(isLiquid({ kind: 'study', liquidFrom: '2025-05-31' }, '2026-10-02'), true, 'השתלמות אחרי מועד הנזילות');
  eq(isLiquid({ kind: 'study', liquidFrom: '2027-01-01' }, '2026-10-02'), false, 'השתלמות לפני מועד הנזילות');
  eq(feesPerYear({ balance: 146339, feeBalancePct: 0.18 }), 263.41, 'דמי ניהול בשקלים לשנה');
  eq(taxSaved(11200), 2800, 'מס שנחסך: 25% מהרווח');
  eq(taxSaved(-500), 0, 'הפסד → אין חיסכון במס');
  const s = projectPot({ balance: 1000, asOf: '2026-01-01', monthly: 100, returns: [0, 0, 0] }, { scenario: 1, until: '2027-01' });
  eq(gainOf(s, 1000), 0, 'תשואה 0 → רווח 0 (רק הפקדות)');
}

section('הראל — הקבצים האמיתיים מול ה-PDF (tests/private)');
{
  const study = privateJson('harel/study-deposits.json');
  const pens = privateJson('harel/pension-deposits.json');
  if (!study || !pens) info('דילוג — אין tests/private/harel (לא בריפו).');
  else {
    const s = parseHarelSheet(revive(study.sheets[0].values));
    const p = parseHarelSheet(revive(pens.sheets[0].values));
    eq(s.format, 'value-date', 'השתלמות: פורמט תאריך ערך');
    eq(p.format, 'deposit-month', 'פנסיה: פורמט חודש הפקדה');
    eq(s.rows.length, 51, 'השתלמות: 51 שורות');
    eq(p.rows.length, 52, 'פנסיה: 52 שורות');
    eq(s.warnings.length + p.warnings.length, 0, 'בלי אזהרות');
    eq(s.hasSeverance, false, 'השתלמות בלי פיצויים');
    eq(p.hasSeverance, true, 'פנסיה עם פיצויים');
    const ys = yearTotals(s.rows, 2026), yp = yearTotals(p.rows, 2026);
    eq(Math.round(ys.me), 4489, 'השתלמות 2026 עמית = הדוח');
    eq(Math.round(ys.er), 13466, 'השתלמות 2026 מעסיק = הדוח');
    eq(Math.round(ys.tot), 17954, 'השתלמות 2026 סה"כ = הדוח');
    eq(Math.round(yp.me), 11418, 'פנסיה 2026 עובד = הדוח');
    eq(Math.round(yp.er), 12233, 'פנסיה 2026 מעסיק = הדוח');
    eq(Math.round(yp.sev), 9787, 'פנסיה 2026 פיצויים = הדוח');
    eq(Math.round(yp.tot), 33438, 'פנסיה 2026 סה"כ = הדוח');
    const rs = depositRate(s.rows), rp = depositRate(p.rows);
    eq(rs.lastMonth, '2026-08', 'השתלמות: חודש המשכורת האחרון');
    eq(Math.round(rs.avg12), 1894, 'השתלמות: ממוצע 12 חודשים');
    eq(rs.months12, 12, '...על 12 חודשים מלאים');
    eq(rp.last, 3571.89, 'פנסיה: הפקדת אוגוסט');
    eq(Math.round(rp.avg12), 3624, 'פנסיה: ממוצע 12 חודשים');
    ok(Math.abs(rs.split.er / rs.split.me - 3) < 0.01, 'השתלמות: המעסיק מפקיד פי 3');
    let pl = planDeposits([], s.rows);
    eq(pl.add.length, 51, 'קליטה ראשונה: הכול');
    pl = planDeposits(pl.merged, s.rows);
    eq(pl.add.length, 0, 'קליטה חוזרת של אותו קובץ: כלום');
    const half = planDeposits(s.rows.slice(0, 30), s.rows);
    eq(half.add.length, 21, 'קובץ חופף חלקית: רק מה שחסר');
  }
}
