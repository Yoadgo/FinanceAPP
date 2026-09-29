/* בדיקות מנוע ההוצאות (spend.js) ומיגרציית ההוצאות (migrateSpend.js).
   הוסבו מ-v3 (tests/test_expenses.js) — אותם מספרים, על מסמכי v4.
   רצות על קבצי הבנק האמיתיים ב-tests/private (לא בריפו); בלעדיהם —
   רק הבדיקות הסינתטיות. */
import { readFileSync, existsSync } from 'node:fs';
import { section, ok, eq, info } from './lib.mjs';
import { privateJson, revive } from './private.mjs';
import { planImport } from '../js/engines/ingestPlan.js';
import { seedRuleDocs } from '../js/engines/merchants.js';
import * as S from '../js/engines/spend.js';
import { analyzeSpend } from '../js/engines/migrateSpend.js';
import { monthSavings } from '../js/engines/savings.js';
import { creditBucket } from '../js/engines/ingestPlan.js';

const sum = list => Math.round(list.reduce((a, r) => a + r.charge, 0) * 100) / 100;

section('הוצאות — מנוע (סינתטי)');
{
  const R = (id, o) => S.rowOf({ id, date: '2026-07-10', card: '5519', billingKey: '2026-08', merchant: 'x', merchantNorm: 'x', charge: 100, status: 'pending', ...o });
  const rows = [
    R('a', { merchantNorm: 'סופר פארם יבנה', charge: 50, category: 'בריאות', subcategory: 'פארם', status: 'ok' }),
    R('b', { merchantNorm: 'רמי לוי יבנה', charge: 300, category: 'מזון', status: 'auto' }),
    R('c', { merchantNorm: 'PAYBOX', charge: 200, category: 'העברות', status: 'ok' }),
    R('d', { merchantNorm: 'חנות מעילים', charge: 400, category: 'קניות', subcategory: 'ביגוד', status: 'ok' }),
    R('e', { merchantNorm: 'חנות מעילים', charge: -150, date: '2026-07-20', offsetOf: 'd' }),          // זיכוי מקושר
    R('f', { merchantNorm: 'תקון', charge: 135, date: '2026-07-21', card: '5701' }),
    R('g', { merchantNorm: 'תקון', charge: -135, date: '2026-07-22', card: '5701' }),                 // זוג מתקזז
    R('h', { merchantNorm: 'החזר לא ידוע', charge: -80 }),                                              // זיכוי צף
    R('i', { merchantNorm: 'בבקה הבימה', charge: 30 }),
  ];
  const w = S.washPairs(rows);
  eq(w.length, 1, 'זוג מתקזז אחד (אותו כרטיס, סכום הפוך, יום אחד)');
  ok(!w.some(p => p.credit.id === 'e'), 'זיכוי שקושר ידנית לא נחשב זוג');
  const s = S.summarize(rows, { washPairs: w });
  eq(s.transfer, 200, 'העברות מחוץ לצריכה');
  eq(s.byCat.find(c => c.cat === 'קניות').sum, 250, 'זיכוי מקושר מקטין את הקטגוריה של ההוצאה (400−150)');
  eq(s.washed, 270, 'הזוג המתקזז לא נספר (135+135)');
  eq(s.pending, -80 + 30, 'בהמתנה = שורות בלי קטגוריה (כולל הזיכוי הצף)');
  eq(S.unlinkedCredits(rows, w).map(r => r.id).join(), 'h', 'פאנל "נכנסו ולא שויכו" — רק הזיכוי הצף');
  S.summarize(rows, { washPairs: w }).byCat.forEach(c => eq(sum(S.rowsIn(rows, { cat: c.cat, washPairs: w })), c.sum, `rowsIn = summarize · ${c.cat}`));
  eq(S.rowsIn(rows, { cat: 'העברות', washPairs: w }).length, 1, 'העברות נפתחות רק כשמבקשים אותן בשמן');
  const p = S.progress(rows);
  eq(`${p.ok}/${p.auto}/${p.pending}`, '3/1/5', 'התקדמות: אושר / אוטומטי / בהמתנה');
  /* זיכוי מקושר (status ok) — מוכרע: לא בהמתנה ולא כרטיס לסיווג */
  const linked = rows.map(r => (r.id === 'e' ? { ...r, status: 'ok' } : r));
  eq(S.progress(linked).ok, 4, 'זיכוי מקושר נספר כמוכרע');
  ok(!S.decisions(linked).singles.concat(S.decisions(linked).groups.flatMap(g => g.members)).some(m => m.ids.includes('e')), 'זיכוי מקושר לא מופיע בכרטיסי "לסיווג"');
  /* תת-קטגוריה: הרשימה = הסכום, גם כשזיכוי יורש את התת של ההוצאה */
  const sm2 = S.summarize(rows, { washPairs: w });
  sm2.bySub.forEach(x => eq(sum(S.rowsIn(rows, { washPairs: w, cat: x.cat, sub: x.sub })), x.sum, `rowsIn(sub) = bySub · ${x.cat}·${x.sub || '—'}`));
  eq(S.autoReview(rows).length, 1, 'שורה אוטומטית מחכה לסקירה');
  eq(S.suggest('בבקה הבימה', { anchors: { 'בבקה': { cat: 'מזון', sub: 'מאפייה', n: 3 } }, keywords: [] }).cat, 'מזון', 'הצעה משכן');
  eq(S.suggest('x', { keywords: [['[', 'A', 'B']] }).cat, '', 'ביטוי שבור לא מפיל');
  ok(!S.buildAnchors([{ norm: 'סופר פארם', cat: 'בריאות' }, { norm: 'סופר מרקט', cat: 'מזון' }])['סופר'], 'אסימון סותר נפסל');
  eq(S.offsetCandidates(rows.find(r => r.id === 'h'), rows)[0].id, 'a', 'מועמד לקישור: אותו כרטיס, הקרוב בסכום (50 מול 80)');
  eq(S.catMap([], rows)['קניות'].includes('ביגוד'), true, 'בלי אוסף קטגוריות — ברירת המחדל + מה שבשימוש');
  const cm = S.catMap([{ category: 'מזון', subcategory: 'סופרמרקט', order: 1 }], [{ cat: 'חדשה', sub: '' }]);
  ok(cm['מזון'] && cm['חדשה'] && !cm['תחבורה'], 'אוסף קטגוריות קיים — הוא הרשימה, ומה שבשימוש מתווסף');

  /* תשלומים: אותה עסקה בשלושה חודשים נספרת פעם אחת — מהחיוב האחרון */
  const inst = ['2026-07', '2026-08', '2026-09'].map((b, i) => S.rowOf({ id: `t${i}`, card: '5519', billingKey: b, merchantNorm: 'שטראוס', amount: 4800, charge: 100, noteKind: 'installment', installment: 6 + i, installments: 48 }));
  const oi = S.openInstallments(inst);
  eq(oi.length, 1, 'עסקת תשלומים אחת גם כשנקלטה בשלושה חודשים');
  eq(oi[0].remaining, 100 * (48 - 8), 'נשאר = תשלום × מה שנותר אחרי החיוב האחרון');
}

section('עו"ש — ריבית לפי הלוואה, וסילוק בלי פירוט');
{
  const bank = [
    { id: 'b1', date: '2026-07-01', desc: 'ריבית על הלוואה 31/05 00111', amount: -40.5, bucket: 'הון', category: 'החזר הלוואה', subcategory: 'ריבית' },
    { id: 'b2', date: '2026-07-01', desc: 'ריבית על הלוואה 28/05 00222', amount: -250, bucket: 'הון', category: 'החזר הלוואה', subcategory: 'ריבית' },
    { id: 'b3', date: '2026-07-02', desc: 'אמריקן אקספרס - 5519', amount: -1000, bucket: 'העברה', category: 'סילוק אשראי', settlesCard: '5519' },
    { id: 'b4', date: '2026-07-02', desc: 'ישראכרט בע"מ - 7487', amount: -700, bucket: 'העברה', category: 'סילוק אשראי', settlesCard: '7487' },
    { id: 'b5', date: '2026-07-01', desc: 'מופ"ת קבע', amount: 13000, bucket: 'הכנסה', category: 'משכורת', freq: 'קבוע' },
  ];
  const exp = [{ card: '5519', billing: '02/07/2026', billingKey: '2026-07', charge: 1000, category: 'מזון' }];
  eq(S.loanKeyOf(bank[0].desc), '00111', 'מספר ההלוואה מהתיאור');
  let eff = S.bankEffective(bank, exp, null);
  eq(eff[0].effBucket, 'צריכה', 'ריבית — ברירת מחדל: הוצאה');
  eff = S.bankEffective(bank, exp, { items: { '00222': { interestIsExpense: false } } });
  eq(`${eff[0].effBucket}|${eff[1].effBucket}`, 'צריכה|הון', 'הגדרה לכל הלוואה בנפרד');
  eq(eff[2].effBucket, 'העברה', 'סילוק עם פירוט תואם → העברה');
  eq(eff[3].effBucket, 'צריכה', 'סילוק בלי פירוט → הוצאה מרוכזת');
  const m = monthSavings({ month: '2026-07', bank: eff, credit: exp, goal: 0, creditBucket });
  eq(m.spendActual, 40.5 + 700 + 1000, 'חיסכון: ריבית (הוצאה) + מרוכזת + פירוט; לא הסילוק התואם ולא ריבית שהוגדרה כהלוואה');
  const loans = S.loansOf(bank, { items: { '00222': { interestIsExpense: false, name: 'משכנתא' } } });
  eq(loans.length, 2, 'שתי הלוואות');
  eq(loans.find(l => l.key === '00222').name, 'משכנתא', 'שם ההלוואה מההגדרות');
  const cf = S.cashflow(eff);
  eq(cf[0].consume, 40.5 + 700, 'תזרים: צריכה בעו"ש לפי הדלי האפקטיבי');
  eq(cf[0].income, 13000, 'תזרים: הכנסה');
}

/* ── על הנתונים האמיתיים ── */
const credit = privateJson('fixtures.json');
if (!credit) info('tests/private/fixtures.json חסר — מדלג על בדיקות ההוצאות האמיתיות');
else {
  section('הוצאות — 574 השורות האמיתיות (כמו ב-v3)');
  const counts = {};
  const docs = [];
  for (const [name, grid] of Object.entries(credit)) {
    const p = await planImport(revive(grid), { fileName: name, hash: `h-${name}`, importedHashes: new Set(), creditCounts: counts, rules: seedRuleDocs() });
    p.add.forEach(a => docs.push({ id: a.id, ...a.data }));
  }
  const rows = docs.map(S.rowOf);
  eq(rows.length, 574, '574 שורות');
  const w = S.washPairs(rows);
  eq(w.length, 2, '2 זוגות מתקזזים (כמו שנמדד ב-v3)');
  const all = S.summarize(rows, {});
  eq(Math.round((all.spend + all.transfer + all.capital + all.washed) * 100) / 100, 80972.76, 'סה"כ ₪80,972.76');
  const BANK = { '2026-07': 34694.41, '2026-08': 23363.59, '2026-09': 22914.76 };
  Object.entries(BANK).forEach(([mo, v]) => {
    const sm = S.summarize(rows, { month: mo });
    eq(Math.round((sm.spend + sm.transfer + sm.capital + sm.washed) * 100) / 100, v, `חודש ${mo} = החיוב בבנק`);
  });
  const opt = { washPairs: w };
  S.summarize(rows, opt).byCat.forEach(c => eq(sum(S.rowsIn(rows, { ...opt, cat: c.cat })), c.sum, `rowsIn = summarize · ${c.cat}`));
  const g = S.decisions(rows);
  ok(g.groups.length >= 20, `קבוצות נוצרו (${g.groups.length})`);
  ok(!g.groups.find(x => x.token === 'יבנה'), '"יבנה" נוטרל במילות העצירה');
  const members = g.groups.reduce((a, x) => a + x.members.length, 0) + g.singles.length;
  eq(members, S.byMerchant(rows.filter(r => !r.cat)).length, 'כל סוחר ממתין — בקבוצה אחת או כבודד');
  ok(g.groups.filter(x => x.confident).length / g.groups.length > 0.7, 'רוב הקבוצות בביטחון גבוה');
  const byDate = S.summarize(rows, { basis: 'date' });
  eq(byDate.spend, all.spend, 'ציר עסקה: אותו סה"כ, חודשים אחרים');
  info(`צריכה ₪${all.consume} · בהמתנה ₪${all.pending} · העברות ₪${all.transfer} · ${g.groups.length} קבוצות + ${g.singles.length} בודדים · ${S.openInstallments(rows).length} תשלומים פתוחים`);
}

const D = new URL('./private/stocksdata/', import.meta.url);
if (!existsSync(new URL('Expenses.csv', D))) info('tests/private/stocksdata חסר — מדלג על מיגרציית ההוצאות');
else {
  section('מיגרציית הוצאות ועו"ש מהגיליון');
  const t = f => readFileSync(new URL(f, D), 'utf8');
  const r = await analyzeSpend({ expenses: t('Expenses.csv'), bank: t('Bank.csv'), categories: t('Categories.csv'), imports: t('Imports.csv') });
  r.checks.forEach(c => ok(c.pass, `בדיקה: ${c.text}`));
  eq(r.expenses.length, 574, '574 שורות אשראי');
  eq(r.bank.length, 77, '77 שורות עו"ש');
  ok(r.reconcile.filter(x => x.status === 'match').length >= 6, 'חיובי כרטיס מתלכדים עם הפירוט');
  if (credit) {
    /* אותו מזהה ואותם שדות כמו בקליטה רגילה של אותם קבצים */
    const ids = new Map(r.expenses.map(e => [e.id, e.data]));
    const counts = {};
    let same = 0, total = 0;
    for (const [name, grid] of Object.entries(credit)) {
      const p = await planImport(revive(grid), { fileName: name, hash: `m-${name}`, importedHashes: new Set(), creditCounts: counts, rules: [] });
      p.add.forEach(a => {
        total++;
        const m = ids.get(a.id);
        if (m && ['date', 'card', 'billing', 'billingKey', 'merchantNorm', 'amount', 'charge', 'note', 'noteKind', 'installment', 'installments', 'kindSection'].every(k => JSON.stringify(m[k]) === JSON.stringify(a.data[k]))) same++;
      });
    }
    eq(same, total, `כל ${total} השורות: אותו מזהה ואותם שדות כמו קליטה מחדש של הקבצים`);
  }
  const eff = S.bankEffective(r.bank.map(b => ({ id: b.id, ...b.data })), r.expenses.map(e => e.data), null);
  eq(eff.filter(x => x.effWhy.startsWith('חיוב כרטיס בלי פירוט')).length, 3, 'יוני 2026: 3 חיובי כרטיס בלי פירוט → הוצאה מרוכזת');
}
