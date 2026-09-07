global.ExpensesEngine = require('../js/modules/expenses.js');
const B = require('../js/modules/bank.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('❌ ' + n + (x !== undefined ? '  → ' + x : '')); } };

const COLS = ['Id','Date','ValueDate','OpCode','Ref','Desc','Amount','Debit','Credit',
  'Bucket','Category','Subcategory','Freq','Tag','GoalId','SettlesCard','SettlesMonth',
  'Status','RuleId','Source','FileHash','SheetRow','Key','Occ','CreatedAt','UpdatedAt'];
let n = 0;
const row = o => {
  n++;
  const b = { Id: 'B' + String(n).padStart(6,'0'), Date: o.d, ValueDate: o.d, OpCode: o.op || '',
    Ref: o.ref || '', Desc: o.desc, Amount: o.a, Debit: o.a < 0 ? -o.a : 0, Credit: o.a > 0 ? o.a : 0,
    Bucket: o.b || '', Category: o.c || '', Subcategory: '', Freq: o.f || '', Tag: '',
    GoalId: '', SettlesCard: o.sc || '', SettlesMonth: o.sm || '',
    Status: o.b ? 'auto' : 'pending', RuleId: '', Source: 'bank', FileHash: 'h',
    SheetRow: n + 1, Key: 'k' + n, Occ: 1, CreatedAt: '', UpdatedAt: '' };
  return COLS.map(c => b[c]);
};

/* ⚠️ התאריך הקריטי: 21:00Z ב-31.5 הוא חצות 1.6 בישראל. אם המנוע
   יקרא אותו כ-UTC, כל תנועה בתחילת חודש תיפול לחודש הקודם.        */
const JUN1 = '2026-05-31T21:00:00.000Z';
const JUN2 = '2026-06-01T21:00:00.000Z';
const JUL1 = '2026-06-30T21:00:00.000Z';

const values = [COLS,
  row({ d: JUN1, desc: 'מופ"ת קבע',           a: 13451.38, b: 'הכנסה', c: 'משכורת',       f: 'קבוע' }),
  row({ d: JUN2, desc: 'זיכוי מביט הלפרין',    a: 1900,     b: 'הכנסה', c: 'העברה מאדם',   f: 'קבוע' }),
  row({ d: JUL1, desc: 'זיכוי מביט נדלבאום',   a: 2300,     b: 'הכנסה', c: 'העברה מאדם',   f: 'חד-פעמי' }),
  row({ d: JUN2, desc: 'עמותת שיכוני חי',      a: -942,     b: 'צריכה', c: 'דיור',         f: 'קבוע' }),
  row({ d: JUL1, desc: 'הרשאה כאל',            a: -58,      b: 'צריכה', c: 'כללי' }),
  row({ d: JUN2, desc: 'ישראכרט בע"מ - 7487',  a: -745.67,  b: 'העברה', c: 'סילוק אשראי',
        sc: '7487', sm: '06/2026' }),
  row({ d: JUL1, desc: 'אמריקן אקספרס - 5701', a: -5466.54, b: 'העברה', c: 'סילוק אשראי',
        sc: '5701', sm: '07/2026' }),
  row({ d: JUN2, desc: 'אלטשולר שחם',          a: -30741,   b: 'הון',   c: 'השקעות' }),
  row({ d: JUN2, desc: 'העברה מהחשבון',        a: -50000 }),      // בלי דלי
  row({ d: JUN2, desc: 'העברה מהחשבון',        a: -100000 }),     // בלי דלי
];

const rows = B.parseRows(values);
ok('נטענו כל השורות', rows.length === 10, rows.length);
ok('סימן אחיד', rows[0].amount === 13451.38 && rows[3].amount === -942);
ok('שדות ההחלטה נקראו', rows[0].bucket === 'הכנסה' && rows[0].freq === 'קבוע');
ok('שורה בלי דלי נשארת ריקה', rows[8].bucket === '');
ok('כותרת בלי Id נשמטת', B.parseRows([COLS]).length === 0);
ok('קלט ריק', B.parseRows([]).length === 0 && B.parseRows(null).length === 0);

/* ── גבול החודש ── */
ok('21:00Z ב-31.5 נספר ביוני', B.monthKey(JUN1) === B.monthKey(JUN2),
   B.monthKey(JUN1) + ' vs ' + B.monthKey(JUN2));
ok('21:00Z ב-30.6 נספר ביולי', B.monthKey(JUL1) !== B.monthKey(JUN1),
   B.monthKey(JUL1) + ' vs ' + B.monthKey(JUN1));
ok('שני חודשים בלבד', B.monthsOf(rows).length === 2, B.monthsOf(rows).join(','));

/* ── דליים ── */
const s = B.summarize(rows);
ok('הכנסה מסתכמת', s.income === 17651.38, s.income);
ok('צריכה מסתכמת (חיובי)', s.spend === 1000, s.spend);
ok('נטו', s.net === 16651.38, s.net);
ok('העברה והון אינם משנים נטו',
   s.net === Math.round((s.income - s.spend) * 100) / 100);
ok('דלי העברה נספר בנפרד', Math.round(s.byBucket['העברה']) === -6212,
   s.byBucket['העברה']);
ok('דלי הון נספר בנפרד', s.byBucket['הון'] === -30741, s.byBucket['הון']);
ok('שתי שורות בהמתנה', s.pending.length === 2, s.pending.length);
ok('הבהמתנה הוא דלי ריק', s.byBucket[''] === -150000, s.byBucket['']);

/* ── תדירות: הלפרין מול נדלבאום ── */
ok('הכנסה קבועה', s.incomeByFreq['קבוע'] === 15351.38, s.incomeByFreq['קבוע']);
ok('הכנסה חד-פעמית', s.incomeByFreq['חד-פעמי'] === 2300, s.incomeByFreq['חד-פעמי']);
ok('הקבוע והחד-פעמי מרכיבים את הכול',
   Math.round((s.incomeByFreq['קבוע'] + s.incomeByFreq['חד-פעמי']) * 100) / 100 === s.income);

/* ── סינון חודשי מסכים עם הרשימה ── */
B.monthsOf(rows).forEach(m => {
  const sm = B.summarize(rows, { month: m });
  const list = B.rowsIn(rows, { month: m }).filter(r => r.bucket === 'הכנסה');
  const sum = Math.round(list.reduce((a, r) => a + r.amount, 0) * 100) / 100;
  ok('summarize=rowsIn · הכנסה ' + m, sum === sm.income, sum + ' ≠ ' + sm.income);
});
ok('סכום החודשים = הסכום הכולל',
   Math.round(s.months.reduce((a, m) => a + m.income, 0) * 100) / 100 === s.income);

/* ── קיזוז מול האשראי ── */
const credit = [
  { card: '7487', billing: JUN2, charge: 745.67 },
  { card: '5701', billing: JUL1, charge: 5000 },      // פער מכוון
];
const rec = B.reconcile(rows, credit);
ok('שתי שורות סילוק', rec.length === 2, rec.length);
ok('התלכדות מדויקת', rec[0].status === 'match' && rec[0].gap === 0, JSON.stringify(rec[0]));
ok('פער מזוהה', rec[1].status === 'gap' && rec[1].gap === 466.54, rec[1].gap);
ok('בלי פירוט → no-detail',
   B.reconcile(rows, []).every(r => r.status === 'no-detail' && r.detail === null));
ok('שורה שאינה סילוק אינה ברשימה', !rec.some(r => /מופ/.test(r.desc)));
ok('הקיזוז לא משנה סכומים', B.summarize(rows).spend === s.spend);


/* ── סינון לפי דלי ──
   הדלי הריק הוא ערך אמיתי ("בהמתנה"), לא היעדר סינון. */
ok('דלי ריק מחזיר רק את מה שבהמתנה',
   B.rowsIn(rows, { bucket: '' }).length === 2, B.rowsIn(rows, { bucket: '' }).length);
ok('דלי ריק מחזיר את השורות הנכונות',
   B.rowsIn(rows, { bucket: '' }).every(r => !r.bucket));
ok('בלי המפתח כלל → כל השורות', B.rowsIn(rows, {}).length === rows.length);
ok('all → כל השורות', B.rowsIn(rows, { bucket: 'all' }).length === rows.length);
ok('דלי מלא מסנן נכון', B.rowsIn(rows, { bucket: 'הכנסה' }).length === 3,
   B.rowsIn(rows, { bucket: 'הכנסה' }).length);
ok('סכום כל הדליים = כל השורות',
   ['הכנסה','צריכה','העברה','הון',''].reduce((a,b)=>a+B.rowsIn(rows,{bucket:b}).length,0) === rows.length);

console.log('\n' + (fail ? '❌ ' + fail + ' נכשלו מתוך ' + (pass + fail) : '✅ כל ' + pass + ' הבדיקות עברו'));
process.exit(fail ? 1 : 0);
