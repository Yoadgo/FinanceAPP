global.ExpensesEngine = require('../js/modules/expenses.js');
global.BankEngine = require('../js/modules/bank.js');
const F = require('../js/modules/flow.js');
const E = global.ExpensesEngine, B = global.BankEngine;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('❌ ' + n + (x !== undefined ? '  → ' + x : '')); } };

/* 21:00Z = חצות היום הבא בישראל, בדיוק כמו שהגיליון מחזיר */
const JUL = '2026-06-30T21:00:00.000Z';   // 01/07
const AUG = '2026-07-31T21:00:00.000Z';   // 01/08

/* ── עו״ש ── */
const BC = ['Id','Date','ValueDate','OpCode','Ref','Desc','Amount','Debit','Credit',
  'Bucket','Category','Subcategory','Freq','Tag','GoalId','SettlesCard','SettlesMonth',
  'Status','RuleId','Source','FileHash','SheetRow','Key','Occ','CreatedAt','UpdatedAt'];
let bn = 0;
const br = o => { bn++; const b = { Id:'B'+bn, Date:o.d, ValueDate:o.d, OpCode:'', Ref:'',
  Desc:o.desc, Amount:o.a, Debit:o.a<0?-o.a:0, Credit:o.a>0?o.a:0, Bucket:o.b||'',
  Category:o.c||'', Subcategory:'', Freq:'', Tag:'', GoalId:'', SettlesCard:o.sc||'',
  SettlesMonth:'', Status:'ok', RuleId:'', Source:'bank', FileHash:'h', SheetRow:bn+1,
  Key:'k'+bn, Occ:1, CreatedAt:'', UpdatedAt:'' }; return BC.map(c => b[c]); };

const bank = B.parseRows([BC,
  br({ d: JUL, desc: 'משכורת',        a: 20000, b: 'הכנסה', c: 'משכורת' }),
  br({ d: AUG, desc: 'משכורת',        a: 20000, b: 'הכנסה', c: 'משכורת' }),
  br({ d: JUL, desc: 'ועד בית',       a: -1000, b: 'צריכה', c: 'דיור' }),
  br({ d: AUG, desc: 'ועד בית',       a: -1000, b: 'צריכה', c: 'דיור' }),
  /* סילוק אשראי — בדלי העברה, ולכן אסור שייספר כהוצאה */
  br({ d: JUL, desc: 'ישראכרט - 5519', a: -3000, b: 'העברה', c: 'סילוק אשראי', sc: '5519' }),
  br({ d: JUL, desc: 'אלטשולר',        a: -5000, b: 'הון',   c: 'השקעות' }),
  br({ d: AUG, desc: 'העברה מהחשבון',  a: -80000 }),          // בלי דלי — לא ידוע
]);

/* ── אשראי ── */
const EC = ['Id','Date','Card','Issuer','BillingMonth','Merchant','MerchantNorm','Amount',
  'Currency','Charge','ChargeCurrency','Note','NoteKind','Installment','Installments',
  'Category','Subcategory','Status','RuleId','Source','FileHash','SheetRow','Key','Occ',
  'CreatedAt','UpdatedAt','Tag'];
let en = 0;
const er = o => { en++; const b = { Id:'E'+en, Date:o.d, Card:'5519', Issuer:'ישראכרט',
  BillingMonth:o.bm, Merchant:o.m, MerchantNorm:o.m, Amount:o.a, Currency:'ש"ח', Charge:o.a,
  ChargeCurrency:'ש"ח', Note:'', NoteKind:'plain', Installment:'', Installments:'',
  Category:o.c||'', Subcategory:'', Status:o.c?'ok':'pending', RuleId:'', Source:'credit',
  FileHash:'h', SheetRow:en+1, Key:'ck'+en, Occ:1, CreatedAt:'', UpdatedAt:'', Tag:'' };
  return EC.map(c => b[c]); };

const credit = E.parseRows([EC,
  er({ d: JUL, bm: JUL, m: 'סופר',   a: 2000, c: 'מזון' }),
  er({ d: JUL, bm: JUL, m: 'דלק',    a: 1000, c: 'תחבורה' }),
  er({ d: AUG, bm: AUG, m: 'סופר',   a: 1500, c: 'מזון' }),
  er({ d: AUG, bm: AUG, m: 'חנות',   a:  500 }),               // בלי קטגוריה — הכסף כן יצא
  /* העברה — דלי שאינו צריכה, לא נספר */
  er({ d: AUG, bm: AUG, m: 'ביט',    a:  700, c: 'העברות' }),
]);

ok('נטענו שני המקורות', bank.length === 7 && credit.length === 5,
   bank.length + '/' + credit.length);

const m = F.monthly(bank, credit);
ok('שני חודשים', m.length === 2, m.map(x => x.month).join(','));
const [jul, aug] = m;

/* ── יולי ── */
ok('יולי: הכנסה', jul.income === 20000, jul.income);
ok('יולי: צריכה מהעו״ש', jul.spendBank === 1000, jul.spendBank);
ok('יולי: צריכה באשראי', jul.spendCredit === 3000, jul.spendCredit);
ok('יולי: סה״כ יצא', jul.spend === 4000, jul.spend);
ok('יולי: נשאר', jul.saved === 16000, jul.saved);
ok('יולי: שיעור חיסכון', jul.rate === 80, jul.rate);

/* הלב של החישוב: סילוק אשראי והון אינם הוצאה */
ok('סילוק האשראי לא נספר פעמיים', jul.spend === 1000 + 3000, jul.spend);
ok('העברה להשקעות אינה הוצאה', jul.spend < 5000 + 4000);

/* ── אוגוסט ── */
ok('אוגוסט: צריכה באשראי כוללת שורה לא מסווגת',
   aug.spendCredit === 2000, aug.spendCredit);
ok('אוגוסט: העברה בכרטיס אינה הוצאה', aug.spendCredit === 1500 + 500, aug.spendCredit);
ok('אוגוסט: נשאר', aug.saved === 20000 - 3000, aug.saved);

/* ── שורת עו״ש בלי דלי: מוצגת, לא נספרת ── */
ok('הלא-ידוע נספר בנפרד', aug.unknownCount === 1, aug.unknownCount);
ok('סכום הלא-ידוע', aug.unknownSum === -80000, aug.unknownSum);
ok('⛔ הלא-ידוע אינו מנופח להוצאה', aug.spend === 3000, aug.spend);
ok('יולי בלי לא-ידוע', jul.unknownCount === 0);

/* ── סיכום ── */
const s = F.summary(m);
ok('סיכום: הכנסה', s.income === 40000, s.income);
ok('סיכום: יצא', s.spend === 7000, s.spend);
ok('סיכום: נשאר', s.saved === 33000, s.saved);
ok('סיכום: נשאר = סכום החודשים',
   s.saved === m.reduce((a, x) => a + x.saved, 0));
ok('סיכום: פיצול עו״ש/אשראי מסתכם לסך', s.spendBank + s.spendCredit === s.spend,
   s.spendBank + '+' + s.spendCredit);
ok('ממוצע רץ על חודשים עם הכנסה', s.basedOn === 2 && s.avgSaved === 16500, s.avgSaved);
/* אוגוסט חסך 17,000 ויולי 16,000 — הטוב הוא אוגוסט, וזה גם מה
   שמוודא שהמיון רץ על `saved` ולא על סדר החודשים. */
ok('החודש הטוב', s.best.month === aug.month && s.best.saved === 17000,
   s.best.month + ' ' + s.best.saved);
ok('החודש הגרוע', s.worst.month === jul.month && s.worst.saved === 16000,
   s.worst.month + ' ' + s.worst.saved);

/* חודש בלי הכנסה לא מושך את הממוצע */
const s2 = F.summary(m.concat([{ month:'09/2026', income:0, spend:500, spendBank:500,
  spendCredit:0, saved:-500, rate:null, unknownCount:0, unknownSum:0 }]));
ok('חודש בלי הכנסה אינו בממוצע', s2.basedOn === 2, s2.basedOn);
ok('אבל כן בסך הכולל', s2.spend === 7500, s2.spend);

/* ── לאן הלך הכסף ── */
const cats = F.spendByCategory(bank, credit);
const byCat = {}; cats.forEach(c => { byCat[c.cat] = c; });
ok('קטגוריות משני המקורות', cats.length >= 3, cats.map(c => c.cat).join(','));
ok('דיור מגיע מהעו״ש', byCat['דיור'].bank === 2000 && byCat['דיור'].credit === 0,
   JSON.stringify(byCat['דיור']));
ok('מזון מגיע מהאשראי', byCat['מזון'].credit === 3500 && byCat['מזון'].bank === 0,
   JSON.stringify(byCat['מזון']));
ok('סכום הקטגוריות = סך ההוצאה',
   Math.round(cats.reduce((a, c) => a + c.sum, 0)) === s.spend,
   cats.reduce((a, c) => a + c.sum, 0) + ' vs ' + s.spend);
ok('סילוק אשראי אינו קטגוריה כאן', !byCat['סילוק אשראי']);
ok('השקעות אינן קטגוריה כאן', !byCat['השקעות']);

/* ── קלט ריק ── */
ok('בלי נתונים כלל', F.monthly([], []).length === 0);
ok('סיכום ריק לא מתפוצץ', F.summary([]).income === 0 && F.summary([]).rate === null);
ok('רק עו״ש', F.monthly(bank, []).length === 2);
ok('רק אשראי', F.monthly([], credit).length === 2);

console.log('\n' + (fail ? '❌ ' + fail + ' נכשלו מתוך ' + (pass + fail) : '✅ כל ' + pass + ' הבדיקות עברו'));
process.exit(fail ? 1 : 0);
