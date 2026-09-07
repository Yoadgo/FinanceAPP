global.ExpensesEngine = require('../js/modules/expenses.js');
global.BankEngine     = require('../js/modules/bank.js');
const G = require('../js/modules/goals.js');
const B = global.BankEngine;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('❌ ' + n + (x !== undefined ? '  → ' + x : '')); } };

const JUN='2026-05-31T21:00:00.000Z', JUL='2026-06-30T21:00:00.000Z', AUG='2026-07-31T21:00:00.000Z';
const NOW = new Date(2026, 7, 15);   // 15/08/2026

const BC = ['Id','Date','ValueDate','OpCode','Ref','Desc','Amount','Debit','Credit',
  'Bucket','Category','Subcategory','Freq','Tag','GoalId','SettlesCard','SettlesMonth',
  'Status','RuleId','Source','FileHash','SheetRow','Key','Occ','CreatedAt','UpdatedAt'];
let bn = 0;
const br = o => { bn++; const b = { Id:o.id||('B'+bn), Date:o.d, ValueDate:o.d, OpCode:'', Ref:'',
  Desc:o.desc, Amount:o.a, Debit:o.a<0?-o.a:0, Credit:o.a>0?o.a:0, Bucket:o.b||'',
  Category:o.c||'', Subcategory:'', Freq:'', Tag:'', GoalId:o.g||'', SettlesCard:o.sc||'',
  SettlesMonth:'', Status:'ok', RuleId:'', Source:'bank', FileHash:'h', SheetRow:bn+1,
  Key:'k'+bn, Occ:1, CreatedAt:'', UpdatedAt:'' }; return BC.map(c => b[c]); };

const bank = B.parseRows([BC,
  br({ id:'t1', d:JUN, desc:'העברה לאיביאי', a:-3000, b:'הון', c:'השקעות', g:'gA' }),
  br({ id:'t2', d:JUL, desc:'העברה לאיביאי', a:-3000, b:'הון', c:'השקעות', g:'gA' }),
  br({ id:'t3', d:AUG, desc:'העברה לאיביאי', a:-4000, b:'הון', c:'השקעות', g:'gA' }),
  br({ id:'t4', d:AUG, desc:'העברה לפיקדון', a:-1000, b:'הון', c:'חיסכון', g:'gB' }),
  /* מועמדים לסימון */
  br({ id:'c1', d:AUG, desc:'העברה למישהו',  a:-2500, b:'העברה', c:'העברה לאדם' }),
  br({ id:'c2', d:AUG, desc:'העברה לקרן',    a:-800,  b:'הון',   c:'השקעות' }),
  /* לא מועמדים */
  br({ id:'x1', d:AUG, desc:'ישראכרט',       a:-6000, b:'העברה', c:'סילוק אשראי', sc:'5519' }),
  br({ id:'x2', d:AUG, desc:'סופר',          a:-400,  b:'צריכה', c:'מזון' }),
  br({ id:'x3', d:AUG, desc:'משכורת',        a:20000, b:'הכנסה', c:'משכורת' }),
  br({ id:'x4', d:AUG, desc:'בלי דלי',       a:-900 }),
]);

const GC = ['GoalId','Name','Target','Monthly','Deadline','Priority','Source',
            'LinkedPortfolio','Opening','Active','Notes','UpdatedAt'];
const gr = o => GC.map(c => ({ GoalId:o.id, Name:o.n, Target:o.t, Monthly:o.m||0,
  Deadline:o.dl||'', Priority:o.p||0, Source:o.src||'תיוג', LinkedPortfolio:'',
  Opening:o.op||0, Active:o.act===undefined?true:o.act, Notes:'', UpdatedAt:'' })[c]);

const goals = G.parseRows([GC,
  gr({ id:'gA', n:'רכב',       t:80000, m:5000, op:10000, p:1 }),
  gr({ id:'gB', n:'קרן חירום', t:30000, m:2000, dl:'2026-12-31', p:2 }),
  gr({ id:'gC', n:'טיול',      t:15000, m:1000, p:3, act:false }),
]);

/* ══════════ קריאה ══════════ */
ok('נקראו שלושה יעדים', goals.length === 3, goals.length);
ok('לא-פעיל מסונן', G.live(goals).length === 2);
ok('מיון לפי עדיפות', G.live(goals).map(g=>g.name).join(',') === 'רכב,קרן חירום');
ok('סכום שלילי הופך לחיובי',
   G.parseRows([GC, gr({id:'x',n:'א',t:-500})])[0].target === 500);
ok('שורה בלי מזהה נזרקת', G.parseRows([GC, gr({id:'',n:'א',t:500})]).length === 0);
ok('ריק לא מתפוצץ', G.parseRows([]).length === 0 && G.parseRows(null).length === 0);
ok('דדליין נחתך ל-10 תווים', goals[1].deadline === '2026-12-31', goals[1].deadline);

/* ══════════ מועמדים לסימון ══════════ */
const cand = G.candidates(bank).map(r => r.id);
ok('שני מועמדים', cand.length === 2, cand.join(','));
ok('לפי סכום יורד', cand.join(',') === 'c1,c2', cand.join(','));
ok('שורה שכבר משויכת אינה מועמדת', cand.indexOf('t1') < 0);
ok('⛔ סילוק אשראי אינו חיסכון', cand.indexOf('x1') < 0);
ok('⛔ צריכה אינה חיסכון', cand.indexOf('x2') < 0);
ok('⛔ הכנסה אינה חיסכון', cand.indexOf('x3') < 0);
ok('⛔ שורה בלי דלי אינה מועמדת', cand.indexOf('x4') < 0);

/* ══════════ יעד עם הקצאה, בלי דדליין ══════════ */
const A = G.status(goals[0], bank, { now: NOW });
ok('רכב: מתויג 10,000', A.tagged === 10000, A.tagged);
ok('רכב: נחסך = פתיחה + מתויג', A.saved === 20000, A.saved);
ok('רכב: שלוש שורות', A.rows === 3, A.rows);
ok('רכב: נשאר 60,000', A.left === 60000, A.left);
ok('רכב: 25%', A.pct === 25, A.pct);
ok('רכב: לא הושלם', A.done === false);
ok('רכב: קצב שנמדד 3,333', A.paceAvg === 3333.33, A.paceAvg);
ok('רכב: שלושה חודשי תיוג', A.paceMonths === 3, A.paceMonths);
/* 60,000 / 5,000 = 12 חודשים מ-08/2026 → 08/2027 */
ok('רכב: 12 חודשים לסיום', A.etaMonths === 12, A.etaMonths);
ok('רכב: תאריך משוער', A.etaLabel === '08/2027', A.etaLabel);
ok('רכב: אין דדליין', A.deadlineMonths === null && A.late === false);

/* ⚠️ התחזית רצה על ההקצאה ולא על הקצב שנמדד. */
ok('⚠️ התחזית לפי ההקצאה ולא לפי הממוצע',
   A.etaMonths === Math.ceil(60000 / 5000) && A.paceAvg !== A.monthly,
   A.etaMonths + ' vs ' + Math.ceil(60000 / A.paceAvg));

/* ══════════ יעד עם דדליין — כאן המסך אומר ״לא״ ══════════ */
const Bg = G.status(goals[1], bank, { now: NOW });
ok('חירום: נחסך 1,000', Bg.saved === 1000, Bg.saved);
ok('חירום: נשאר 29,000', Bg.left === 29000, Bg.left);
/* 12/2026 מ-08/2026 = 4 חודשים; 29,000/4 = 7,250 */
ok('חירום: 4 חודשים לדדליין', Bg.deadlineMonths === 4, Bg.deadlineMonths);
ok('חירום: דורש 7,250 בחודש', Bg.needMonthly === 7250, Bg.needMonthly);
ok('חירום: חסר 5,250 מההקצאה', Bg.shortfall === 5250, Bg.shortfall);
ok('חירום: מסומן כלא-בקצב', Bg.late === true);

/* דדליין שכבר עבר */
const past = G.status(G.parseRows([GC, gr({id:'gB',n:'ח',t:30000,m:2000,dl:'2026-01-31'})])[0],
                      bank, { now: NOW });
ok('דדליין שעבר: מסומן', past.late === true && past.deadlineMonths < 0, past.deadlineMonths);
ok('דדליין שעבר: דורש את כל היתרה', past.needMonthly === past.left, past.needMonthly);

/* יעד שהושלם */
const doneG = G.status(G.parseRows([GC, gr({id:'gA',n:'רכב',t:5000,m:5000,op:0})])[0],
                       bank, { now: NOW });
ok('הושלם: done', doneG.done === true, doneG.saved);
ok('הושלם: נשאר 0 ולא שלילי', doneG.left === 0, doneG.left);
ok('הושלם: 100% ולא יותר', doneG.pct === 100, doneG.pct);
ok('הושלם: בלי תחזית', doneG.etaMonths === null);

/* יעד בלי הקצאה — אי אפשר לחזות, וזה לא שגיאה */
const noAlloc = G.status(G.parseRows([GC, gr({id:'gA',n:'רכב',t:80000,m:0})])[0], bank, { now: NOW });
ok('בלי הקצאה: אין תחזית', noAlloc.etaMonths === null && noAlloc.etaLabel === '');

/* יעד בלי תיוגים בכלל */
const empty = G.status(G.parseRows([GC, gr({id:'gZ',n:'חדש',t:10000,m:500})])[0], bank, { now: NOW });
ok('יעד חדש: 0 נחסך', empty.saved === 0 && empty.rows === 0);
ok('יעד חדש: 20 חודשים', empty.etaMonths === 20, empty.etaMonths);
ok('יעד חדש: קצב נמדד 0', empty.paceAvg === 0 && empty.paceMonths === 0);

/* ══════════ המכנה: העודף החודשי ══════════ */
/* הקצאה 5,000 + 2,000 = 7,000 מול עודף 10,900 */
let S = G.summarize(goals, bank, 10900, { now: NOW });
ok('סיכום: שני יעדים פעילים', S.count === 2, S.count);
ok('סיכום: סך הקצאה 7,000', S.allocated === 7000, S.allocated);
ok('סיכום: לא חרגנו', S.over === 0, S.over);
ok('סיכום: פנוי 3,900', S.free === 3900, S.free);
ok('סיכום: סך יעדים 110,000', S.target === 110000, S.target);
ok('סיכום: סך נחסך 21,000', S.saved === 21000, S.saved);
ok('סיכום: אחד לא בקצב', S.late.length === 1 && S.late[0].name === 'קרן חירום');

/* ⚠️ **המנגנון שיכול להגיד ״לא״.** בלי הבדיקה הזו המסך הוא קישוט. */
S = G.summarize(goals, bank, 6000, { now: NOW });
ok('⚠️ חריגה: הקצאנו 1,000 מעל העודף', S.over === 1000, S.over);
ok('חריגה: אין פנוי', S.free === 0, S.free);

S = G.summarize(goals, bank, 7000, { now: NOW });
ok('בדיוק על הקו: לא חריגה ולא פנוי', S.over === 0 && S.free === 0);

/* יעד שהושלם אינו צורך עוד מהעודף */
const withDone = G.parseRows([GC,
  gr({ id:'gA', n:'רכב', t:5000,  m:5000, op:0, p:1 }),
  gr({ id:'gB', n:'חירום', t:30000, m:2000, p:2 })]);
S = G.summarize(withDone, bank, 3000, { now: NOW });
ok('⚠️ יעד שהושלם משחרר את ההקצאה שלו', S.allocated === 2000 && S.over === 0,
   S.allocated + '/' + S.over);
ok('סיכום: יעד אחד הושלם', S.done.length === 1);

/* בלי תוכנית אין מכנה — וזה מצב מוצהר, לא אפס שקרי */
S = G.summarize(goals, bank, null, { now: NOW });
ok('בלי עודף: מסומן במפורש', S.hasSurplus === false);
ok('בלי עודף: ההקצאה עדיין נספרת', S.allocated === 7000);

/* בלי יעדים */
S = G.summarize([], bank, 10900, { now: NOW });
ok('בלי יעדים: לא מתפוצץ', S.count === 0 && S.allocated === 0 && S.over === 0);
ok('בלי יעדים: כל העודף פנוי', S.free === 10900, S.free);

/* בלי שורות עו״ש */
ok('בלי עו״ש: 0 נחסך', G.summarize(goals, [], 10900, { now: NOW }).saved === 10000,
   G.summarize(goals, [], 10900, { now: NOW }).saved);

console.log('\n' + (fail ? '❌ ' + fail + ' נכשלו מתוך ' + (pass + fail) : '✅ כל ' + pass + ' הבדיקות עברו'));
process.exit(fail ? 1 : 0);
