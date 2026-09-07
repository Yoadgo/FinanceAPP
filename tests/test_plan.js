global.ExpensesEngine = require('../js/modules/expenses.js');
global.BankEngine     = require('../js/modules/bank.js');
global.FlowEngine     = require('../js/modules/flow.js');
const P = require('../js/modules/plan.js');
const E = global.ExpensesEngine, B = global.BankEngine, F = global.FlowEngine;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('❌ ' + n + (x !== undefined ? '  → ' + x : '')); } };
const near = (a, b) => Math.abs(a - b) < 0.02;

/* 21:00Z = חצות היום הבא בישראל — בדיוק כמו שהגיליון מחזיר */
const JUN = '2026-05-31T21:00:00.000Z';   // 01/06
const JUL = '2026-06-30T21:00:00.000Z';   // 01/07
const AUG = '2026-07-31T21:00:00.000Z';   // 01/08

const BC = ['Id','Date','ValueDate','OpCode','Ref','Desc','Amount','Debit','Credit',
  'Bucket','Category','Subcategory','Freq','Tag','GoalId','SettlesCard','SettlesMonth',
  'Status','RuleId','Source','FileHash','SheetRow','Key','Occ','CreatedAt','UpdatedAt'];
let bn = 0;
const br = o => { bn++; const b = { Id:'B'+bn, Date:o.d, ValueDate:o.d, OpCode:'', Ref:'',
  Desc:o.desc, Amount:o.a, Debit:o.a<0?-o.a:0, Credit:o.a>0?o.a:0, Bucket:o.b||'',
  Category:o.c||'', Subcategory:'', Freq:o.f||'', Tag:'', GoalId:'', SettlesCard:'',
  SettlesMonth:'', Status:'ok', RuleId:'', Source:'bank', FileHash:'h', SheetRow:bn+1,
  Key:'k'+bn, Occ:1, CreatedAt:'', UpdatedAt:'' }; return BC.map(c => b[c]); };

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

/* ══════════════ 1. descKey ══════════════ */
ok('מפתח: ספרות → #', P.descKey('הלואה-תשלום 7') === 'הלואה-תשלום #', P.descKey('הלואה-תשלום 7'));
ok('מפתח: שני חודשים שונים מתלכדים',
   P.descKey('אמריקן אקספרס - 4821') === P.descKey('אמריקן אקספרס - 9034'));
ok('מפתח: רווחים כפולים מתכווצים',
   P.descKey('ריבית  על   הלוואה 3/12  45') === 'ריבית על הלוואה #/# #',
   P.descKey('ריבית  על   הלוואה 3/12  45'));
ok('מפתח: ריק', P.descKey('') === '' && P.descKey(null) === '');
ok('מפתח: שמות שונים לא מתלכדים', P.descKey('מופ"ת קבע') !== P.descKey('קסלמן'));

/* ══════════════ 2. זיהוי פריטים קבועים ══════════════ */
const bank = B.parseRows([BC,
  br({ d: JUN, desc: 'מופ"ת קבע',      a: 12000, b: 'הכנסה', c: 'משכורת', f: 'קבוע' }),
  br({ d: JUL, desc: 'מופ"ת קבע',      a: 12000, b: 'הכנסה', c: 'משכורת', f: 'קבוע' }),
  br({ d: AUG, desc: 'מופ"ת קבע',      a: 12000, b: 'הכנסה', c: 'משכורת', f: 'קבוע' }),
  br({ d: AUG, desc: 'בונוס',          a:  5000, b: 'הכנסה', c: 'משכורת' }),   // חודש אחד
  br({ d: JUN, desc: 'עמותת שיכוני',   a:  -800, b: 'צריכה', c: 'דיור' }),
  br({ d: JUL, desc: 'עמותת שיכוני',   a:  -800, b: 'צריכה', c: 'דיור' }),
  br({ d: AUG, desc: 'עמותת שיכוני',   a:  -800, b: 'צריכה', c: 'דיור' }),
  br({ d: JUN, desc: 'הלואה-תשלום 4',  a: -2700, b: 'הון',   c: 'החזר הלוואה' }),
  br({ d: JUL, desc: 'הלואה-תשלום 5',  a: -2700, b: 'הון',   c: 'החזר הלוואה' }),
  br({ d: JUL, desc: 'ישראכרט - 5519', a: -6000, b: 'העברה', c: 'סילוק אשראי' }),
  br({ d: AUG, desc: 'העברה לא ידועה', a: -1500 }),                            // בלי דלי
  /* הוראת קבע **בתוך** קטגוריה שיש לה גם מעטפה. זה המקרה היחיד שבו
     הניכוי באמת עובד, ובלעדיו ה-800 האלה נספרים פעמיים.          */
  br({ d: JUN, desc: 'מנוי סופר', a: -400, b: 'צריכה', c: 'מזון' }),
  br({ d: JUL, desc: 'מנוי סופר', a: -400, b: 'צריכה', c: 'מזון' }),
  br({ d: AUG, desc: 'מנוי סופר', a: -400, b: 'צריכה', c: 'מזון' }),
]);

const rec = P.recurringBank(bank);
ok('קבועים: נמצאו שלושה', rec.length === 3, rec.map(r => r.label).join(','));
ok('קבועים: בונוס של חודש אחד לא נכנס', !rec.some(r => r.label === 'בונוס'));
ok('קבועים: הון לא נכנס לתוכנית', !rec.some(r => r.category === 'החזר הלוואה'));
ok('קבועים: העברה לא נכנסת', !rec.some(r => r.category === 'סילוק אשראי'));
ok('קבועים: שורה בלי דלי לא נכנסת', !rec.some(r => /לא ידועה/.test(r.label)));

const sal = rec.find(r => r.bucket === 'הכנסה');
ok('קבועים: משכורת 12,000', sal && sal.amount === 12000, sal && sal.amount);
ok('קבועים: שלושה חודשים', sal && sal.months === 3, sal && sal.months);
const rent = rec.find(r => r.label === 'עמותת שיכוני');
ok('קבועים: סכום ההוצאה חיובי', rent && rent.amount === 800, rent && rent.amount);

ok('קבועים: סף של 3 חודשים מסנן', P.recurringBank(bank, 4).length === 0);

/* פריט שהופיע פעמיים מתוך שלושה — הממוצע רץ על החודשים שלו */
const bank2 = B.parseRows([BC,
  br({ d: JUN, desc: 'חוג', a: -300, b: 'צריכה', c: 'חינוך' }),
  br({ d: AUG, desc: 'חוג', a: -300, b: 'צריכה', c: 'חינוך' }),
]);
ok('קבועים: ממוצע לפי חודשי הפריט ולא לפי הטווח',
   P.recurringBank(bank2)[0].amount === 300, P.recurringBank(bank2)[0].amount);

/* ══════════════ 3. מעטפות וניכוי ══════════════ */
const credit = E.parseRows([EC,
  er({ d: JUN, bm: JUN, m: 'סופר',  a: 2000, c: 'מזון' }),
  er({ d: JUL, bm: JUL, m: 'סופר',  a: 2000, c: 'מזון' }),
  er({ d: AUG, bm: AUG, m: 'סופר',  a: 2000, c: 'מזון' }),
  er({ d: AUG, bm: AUG, m: 'חנות',  a:  900 }),                    // בלי קטגוריה
]);

const sug = P.suggest(bank, credit);
ok('הצעה: שלושה חודשים', sug.months === 3, sug.months);
ok('הצעה: הכנסה אחת', sug.income.length === 1, sug.income.length);
ok('הצעה: שני קבועים', sug.fixed.length === 2, sug.fixed.length);

/* ── הניכוי ──
   בקטגוריית מזון יוצאים 2,400 בחודש: 2,000 באשראי ו-400 בהוראת קבע.
   ההוראה כבר קיבלה שורה משלה, ולכן המעטפה חייבת להיות 2,000 ולא
   2,400 — אחרת אותם 400 מתוקצבים פעמיים והתוכנית מנופחת בשקט.   */
const envFood = sug.envelopes.find(e => e.category === 'מזון');
ok('הצעה: מזון ברוטו 2,400', envFood && envFood.gross === 2400, envFood && envFood.gross);
ok('הצעה: הקבוע נוכה מהמעטפה', envFood && envFood.fixed === 400, envFood && envFood.fixed);
ok('הצעה: מעטפת מזון 2,000 ולא 2,400', envFood && envFood.amount === 2000, envFood && envFood.amount);

/* דיור: 800 בחודש כולו מהוראת הקבע — אחרי הניכוי לא נשארת מעטפה */
ok('הצעה: אין מעטפה כפולה לדיור', !sug.envelopes.some(e => e.category === 'דיור'),
   JSON.stringify(sug.envelopes.map(e => e.category)));
ok('הצעה: ״בהמתנה״ אינה מעטפה', !sug.envelopes.some(e => e.category === 'בהמתנה'));
ok('הצעה: הלא-מסווג מדווח כאזהרה', near(sug.unsortedAvg, 300), sug.unsortedAvg);
ok('הצעה: סך ההכנסה', sug.totalIncome === 12000, sug.totalIncome);
/* 800 דיור + 400 מזון קבוע + 2,000 מעטפה = 3,200 — בדיוק סך ההוצאה
   החודשית הממוצעת המסווגת, בלי כפילות.                          */
ok('הצעה: סך ההוצאה = קבוע + מעטפות', sug.totalSpend === 3200, sug.totalSpend);
ok('הצעה: items מאחד את השלושה', sug.items.length === 3 + sug.envelopes.length, sug.items.length);
ok('הצעה: בלי נתונים לא מתפוצצת', P.suggest([], []).items.length === 0);

/* ══════════════ 4. קריאת הטאב ══════════════ */
const PC = ['PlanId','Kind','Bucket','Category','Subcategory','Label','Key','Amount',
            'Active','Notes','UpdatedAt'];
const pr = o => PC.map(c => ({ PlanId:o.id, Kind:o.k, Bucket:o.b, Category:o.c||'',
  Subcategory:'', Label:o.l||'', Key:o.key||'', Amount:o.a, Active:o.act===undefined?true:o.act,
  Notes:'', UpdatedAt:'' })[c]);

const planRows = P.parseRows([PC,
  pr({ id:'p1', k:'שורה',  b:'הכנסה', c:'משכורת', l:'מופ"ת קבע',    key:P.descKey('מופ"ת קבע'), a:12000 }),
  pr({ id:'p2', k:'שורה',  b:'צריכה', c:'דיור',   l:'עמותת שיכוני', key:P.descKey('עמותת שיכוני'), a:800 }),
  pr({ id:'p3', k:'מעטפה', b:'צריכה', c:'מזון',   a:1800 }),
  pr({ id:'p4', k:'מעטפה', b:'צריכה', c:'תחבורה', a:500, act:false }),
  pr({ id:'p5', k:'שורה',  b:'צריכה', c:'מזון',   l:'מנוי סופר',   key:P.descKey('מנוי סופר'), a:400 }),
]);
ok('טאב: נקראו חמש שורות', planRows.length === 5, planRows.length);
ok('טאב: Active=false נקרא כלא-פעיל', planRows[3].active === false);
ok('טאב: פעילות מסננת לארבע', P.live(planRows).length === 4);
ok('טאב: סכום תמיד חיובי',
   P.parseRows([PC, pr({ id:'x', k:'מעטפה', b:'צריכה', c:'מזון', a:-500 })])[0].amount === 500);
ok('טאב: שורה בלי מזהה נזרקת',
   P.parseRows([PC, pr({ id:'', k:'מעטפה', b:'צריכה', c:'מזון', a:500 })]).length === 0);
ok('טאב: ריק', P.parseRows([]).length === 0 && P.parseRows(null).length === 0);

/* ══════════════ 5. צפוי מול בפועל ══════════════ */
const cmp = P.compare(planRows, bank, credit, '08/2026');

ok('השוואה: משכורת התקבלה', cmp.income[0].actual === 12000, cmp.income[0].actual);
ok('השוואה: משכורת אינה חסרה', cmp.income[0].missing === false);
ok('השוואה: בונוס הוא הכנסה שלא בתוכנית', cmp.extraIncome === 5000, cmp.extraIncome);
ok('השוואה: סך ההכנסה בפועל', cmp.totals.actualIncome === 17000, cmp.totals.actualIncome);

const fx = cmp.fixed.find(r => r.label === 'עמותת שיכוני');
ok('השוואה: הוראת קבע זוהתה', fx.actual === 800, fx.actual);
ok('השוואה: נשאר 0 בשורה שהתממשה', fx.left === 0, fx.left);

/* בקטגוריית מזון יצאו החודש 2,400 — 2,000 באשראי ו-400 בהוראת הקבע
   שכבר יש לה שורה. הבפועל של המעטפה חייב להיות 2,000. ספירה כפולה
   כאן הייתה מציגה חריגה של 600 שלא קרתה.                        */
const ef = cmp.envelopes.find(e => e.cat === 'מזון');
ok('השוואה: מזון ברוטו 2,400', ef.gross === 2400, ef.gross);
ok('השוואה: החלק הקבוע נוכה', ef.fixedPart === 400, ef.fixedPart);
ok('השוואה: מזון בפועל 2,000 ולא 2,400', ef.actual === 2000, ef.actual);
ok('השוואה: מזון חרג ב-200', ef.diff === 200 && ef.over === true, ef.diff);
ok('השוואה: נשאר במעטפה שלילי בחריגה', ef.left === -200, ef.left);
ok('השוואה: אחוז ניצול', ef.pct === 111, ef.pct);

ok('השוואה: ״בהמתנה״ מופיע כלא-בתוכנית',
   cmp.extraSpend.some(e => e.cat === 'בהמתנה' && e.actual === 900),
   JSON.stringify(cmp.extraSpend));
ok('השוואה: הלא-מסווג מסומן', cmp.extraSpend.find(e => e.cat === 'בהמתנה').pending === true);

/* ── ההשוואה חייבת להסתכם בדיוק כמו מסך התזרים ──
   זו הבדיקה שמונעת ששני מסכים שכנים יציגו שני מספרים לאותו חודש. */
const flowAug = F.monthly(bank, credit).find(m => m.month === '08/2026');
ok('נעילה: סך היצא = מסך התזרים',
   near(cmp.totals.actualSpend, flowAug.spend), cmp.totals.actualSpend + ' vs ' + flowAug.spend);
ok('נעילה: סך הנכנס = מסך התזרים',
   near(cmp.totals.actualIncome, flowAug.income), cmp.totals.actualIncome + ' vs ' + flowAug.income);
ok('נעילה: נשאר = מסך התזרים',
   near(cmp.totals.actualSaved, flowAug.saved), cmp.totals.actualSaved + ' vs ' + flowAug.saved);

/* ── חודש שבו פריט קבוע לא הגיע ── */
const cmpJul = P.compare(planRows, bank, credit, '07/2026');
ok('חודש קודם: הכל הגיע', cmpJul.missing.length === 0,
   JSON.stringify(cmpJul.missing.map(m => m.label)));

const bankNoRent = B.parseRows([BC,
  br({ d: AUG, desc: 'מופ"ת קבע', a: 12000, b: 'הכנסה', c: 'משכורת' }),
]);
const cmpMiss = P.compare(planRows, bankNoRent, [], '08/2026');
ok('חסר: שתי הוראות הקבע שלא הגיעו מסומנות',
   cmpMiss.missing.length === 2,
   JSON.stringify(cmpMiss.missing.map(m => m.label)));
const missRent = cmpMiss.fixed.find(r => r.label === 'עמותת שיכוני');
ok('חסר: הבפועל שלה 0', missRent.actual === 0);
ok('חסר: נשאר = כל הסכום', missRent.left === 800, missRent.left);

/* ⛔ מעטפה ריקה אינה ״פריט שנעלם״. סימון שלה כחסרה היה צובע כל
   קטגוריה שלא הוצאנו בה בכתום, והופך את האזהרה האמיתית לרעש.   */
const cmpNoFood = P.compare(planRows, bankNoRent, [], '08/2026');
ok('מעטפה ריקה אינה מסומנת כחסרה',
   cmpNoFood.envelopes.every(e => e.missing === false),
   JSON.stringify(cmpNoFood.envelopes.map(e => [e.cat, e.missing])));
ok('רק שורות נספרות כחסרות',
   cmpNoFood.missing.every(m => m.kind === 'שורה'),
   JSON.stringify(cmpNoFood.missing.map(m => m.kind)));

/* ── סכומי ההצעה בשקלים שלמים ── */
ok('הצעה: אין אגורות', sug.items.every(o => o.amount === Math.round(o.amount)),
   JSON.stringify(sug.items.map(o => o.amount)));

const bankOdd = B.parseRows([BC,
  br({ d: JUN, desc: 'שכר', a: 10000.34, b: 'הכנסה', c: 'משכורת' }),
  br({ d: JUL, desc: 'שכר', a: 10001.01, b: 'הכנסה', c: 'משכורת' }),
]);
ok('הצעה: ממוצע מעוגל', P.recurringBank(bankOdd)[0].amount === 10001,
   P.recurringBank(bankOdd)[0].amount);

/* ── תוכנית ריקה ── */
const empty = P.compare([], bank, credit, '08/2026');
ok('ריק: אין תוכנית', empty.totals.hasPlan === false);
ok('ריק: כל ההוצאה נופלת ל״לא בתוכנית״',
   near(empty.totals.actualSpend, flowAug.spend), empty.totals.actualSpend);
ok('ריק: הצפוי אפס', empty.totals.plannedSpend === 0 && empty.totals.plannedIncome === 0);

/* ── שורה לא פעילה לא נספרת ── */
ok('לא-פעיל: מעטפת תחבורה מחוץ להשוואה',
   !cmp.envelopes.some(e => e.cat === 'תחבורה'));

/* ── יתרת התוכנית ── */
ok('יתרה: צפוי לחיסכון', cmp.totals.plannedSaved === 12000 - 3000, cmp.totals.plannedSaved);
ok('יתרה: נשאר בתקציב', near(cmp.totals.spendLeft, 3000 - flowAug.spend), cmp.totals.spendLeft);

/* ── חודש בלי שום תנועה ── */
const none = P.compare(planRows, bank, credit, '01/2020');
ok('חודש ריק: הכל חסר', none.missing.length === 3, none.missing.length);
ok('חודש ריק: בפועל אפס', none.totals.actualSpend === 0 && none.totals.actualIncome === 0);

console.log('\n' + (fail ? '❌ ' + fail + ' נכשלו מתוך ' + (pass + fail) : '✅ כל ' + pass + ' הבדיקות עברו'));
process.exit(fail ? 1 : 0);
