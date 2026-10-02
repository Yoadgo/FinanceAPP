/* אסטרטגיה: ארבע קבוצות, כל אחת מול המדד. */
import { readFileSync, existsSync } from 'node:fs';
import { section, ok, eq, info } from './lib.mjs';
import { dailyPnl } from '../js/engines/periods.js';
import { strategy, groupOf, verdictText, GROUPS } from '../js/engines/strategy.js';
import { Classifier } from '../js/engines/classifier.js';
import { analyzeTransactions } from '../js/engines/migration.js';
import { toEngineRow } from '../js/engines/model.js';
import { privateJson } from './private.mjs';

const R = o => ({ Portfolio: 'Y', Currency: '$', Commission: 0, Fees: 0, TotalFX: 0, TotalILS: 0, EstimatedTax: 0, ExecutionRate: 0, Qty: 0, Name: '', Symbol: '', ...o });
const near = (a, b, msg, tol = 1e-6) => ok(Math.abs(a - b) <= tol, `${msg} — קיבלתי ${a}, ציפיתי ${b}`);
const rows = Classifier.enrichAll([
  R({ Date: '2026-09-01', Type: 'קניה חול מטח', Symbol: 'IVV', Name: 'IVV US', Qty: 10, ExecutionRate: 100, TotalFX: -1000 }),
  R({ Date: '2026-09-01', Type: 'קניה חול מטח', Symbol: 'ZS', Name: 'ZS US', Qty: 10, ExecutionRate: 100, TotalFX: -1006, Commission: 6 }),
  R({ Date: '2026-09-03', Type: 'הפקדה דיבידנד מטח', Symbol: '99028', Name: 'דיב/ IVV US', TotalFX: 20 }),
  R({ Date: '2026-09-04', Type: 'קניה חול מטח', Symbol: 'NOW', Name: 'NOW US', Qty: 5, ExecutionRate: 100, TotalFX: -507, Commission: 7 }),
  R({ Date: '2026-09-04', Type: 'מכירה חול מטח', Symbol: 'NOW', Name: 'NOW US', Qty: 5, ExecutionRate: 102, TotalFX: 503, Commission: 7 }),
  R({ Date: '2026-09-08', Type: 'מכירה חול מטח', Symbol: 'ZS', Name: 'ZS US', Qty: 10, ExecutionRate: 130, TotalFX: 1294, Commission: 6 }),
]);
const D8 = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09'];
const series = a => a.map((close, i) => ({ date: D8[i], close }));
const ivv = [100, 102, 101, 103, 104, 105, 105], zs = [101, 110, 105, 120, 125, 131, 131];
const hist = { IVV: series(ivv), ZS: series(zs), NOW: series([100, 100, 100, 101, 101, 101, 101]) };

section('אסטרטגיה: שיוך לקבוצות');
{
  eq(groupOf('IVV'), 'core', 'IVV — ליבה');
  eq(groupOf('TSLA'), 'long', 'טסלה — טווח ארוך');
  eq(groupOf('ETHA'), 'crypto', 'ETHA — קריפטו');
  eq(groupOf('IREN'), 'active', 'IREN (קשורה לקריפטו, נסחרת) — מסחר אקטיבי');
  eq(groupOf('ZZZ'), 'active', 'נייר לא מוכר — מסחר אקטיבי');
  eq(groupOf('IREN', { IREN: 'crypto' }), 'crypto', 'שיוך שנשמר דורס את ברירת המחדל');
  eq(groupOf('IVV', { IVV: 'active' }), 'active', 'אפשר להוציא נייר מהליבה');
  eq(groupOf('IVV', { IVV: 'שטות' }), 'active', 'קבוצה לא מוכרת בהגדרות — מסחר אקטיבי, לא קריסה');
}

section('אסטרטגיה: נטו מול המדד (סינתטי)');
{
  const D = dailyPnl(rows, hist, { to: '2026-09-09' });
  const A = strategy(D.days, hist, rows, {});
  const g = id => A.groups.find(x => x.id === id);
  eq(A.groups.length, GROUPS.length, 'ארבע קבוצות, תמיד');
  /* ZS: 1,294 − 1,006 = 288 אחרי עמלות. המדד: השווי בתחילת כל יום × תשואת IVV באותו יום. */
  const zsStart = [1010, 1100, 1050, 1200, 1250];                       // שווי ZS בסוף 1.9, 2.9, 3.9, 4.9, 7.9
  const zsBench = zsStart.reduce((s, v, i) => s + v * (ivv[i + 1] / ivv[i] - 1), 0);
  const act = g('active');
  near(act.pnl, 288 - 4, 'מסחר אקטיבי: ZS +288, ו-NOW ביום אחד −4 (503 − 507)');
  near(act.bench, zsBench, 'המדד: רק על ZS — עסקת יום אחד לא ישנה במדד');
  near(act.edge, 284 - zsBench, 'יתרון = נטו − המדד');
  eq(act.worth, true, 'שווה: היתרון חיובי');
  eq(act.trades, 4, 'ארבע עסקאות (2 ב-ZS, 2 ב-NOW)');
  eq(act.fees, 26, 'עמלות: 6+6+7+7');
  const now = act.symbols.find(s => s.symbol === 'NOW');
  near(now.pnl, -4, 'NOW: קנייה ומכירה באותו יום = הפסד העמלות פחות הרווח');
  eq(now.bench, 0, 'NOW: לא החזיק לילה — המדד 0');
  eq(now.worth, false, 'NOW: לא שווה (המנגנון יודע להגיד לא)');
  /* המדד מול עצמו: היתרון חייב להיות אפס. */
  near(g('core').pnl, 50, 'ליבה: IVV 100 → 105 על 10 יחידות');
  near(g('core').edge, 0, 'המדד מול עצמו — יתרון אפס');
  eq(g('long').symbols.length + g('crypto').symbols.length, 0, 'קבוצות ריקות — קיימות, בלי ניירות');
  near(A.total.other, 20, 'הדיבידנד לא מיוחס לנייר — בשורה נפרדת');
  near(A.total.net, D.days.reduce((s, d) => s + d.pnlUsd, 0), 'סך הקבוצות + הכנסות והוצאות = הרווח של "רווח לפי תקופה"');
  near(act.months.reduce((s, m) => s + m.edge, 0), act.edge, 'החודשים מסתכמים ליתרון של הקבוצה');
  near(g('core').weight, 1, 'משקל היום: רק IVV נשאר בתיק');
  ok(/יתרון/.test(verdictText(act)) && /פער/.test(verdictText(now)), 'המשפט במילים: יתרון / פער');

  /* טווח חלקי: מ-3.9. הבסיס הוא השווי בסוף 2.9. */
  const P = strategy(D.days, hist, rows, { from: '2026-09-03' });
  const pz = P.groups.find(x => x.id === 'active').symbols.find(s => s.symbol === 'ZS');
  near(pz.pnl, 288 - 4 - 90, 'מ-3.9: בלי שני הימים הראשונים');
  near(pz.mvStart, 1100, 'שווי בתחילת הטווח = הסגירה של היום שלפניו');
  eq(pz.buys, 0, 'הקנייה מ-1.9 מחוץ לטווח — לא נספרת');
  eq(P.from, '2026-09-03', 'הטווח בפועל מדווח');

  /* שיוך שנשמר */
  const M = strategy(D.days, hist, rows, { map: { ZS: 'core' } });
  ok(M.groups.find(x => x.id === 'core').symbols.some(s => s.symbol === 'ZS'), 'ZS הועבר לליבה לפי ההגדרה');
  near(M.total.pnl, A.total.pnl, 'שיוך לא משנה את הסך');

  /* בלי היסטוריית מדד: לא ממציאים — מדווחים. */
  const N = strategy(D.days, { ZS: hist.ZS }, rows, {});
  ok(N.benchMissing > 0, 'מדד חסר — נספר ומדווח');
  eq(N.groups.find(x => x.id === 'active').bench, 0, 'מדד חסר — לא מנחשים תשואה');
  eq(strategy([], hist, [], {}).days, 0, 'בלי ימים — תוצאה ריקה, לא קריסה');
}

section('אסטרטגיה: מול חישוב עצמאי (נתונים אמיתיים)');
{
  const tp = new URL('./private/stocksdata/Transactions.csv', import.meta.url), pp = new URL('./private/px-weekly-2026.txt', import.meta.url);
  const exp = privateJson('expected-strategy.json');
  if (!existsSync(tp) || !existsSync(pp) || !exp) info('מדלג — אין tests/private (תנועות, מחירים שבועיים, expected-strategy.json)');
  else {
    const real = Classifier.enrichAll(analyzeTransactions(readFileSync(tp, 'utf8')).ok.map(p => toEngineRow(p.doc)));
    const H = {}; let dates = [];
    readFileSync(pp, 'utf8').trim().split('\n').forEach(l => { const [k, v] = l.split(':'); if (k === 'DATES') dates = v.split(','); else if (k !== 'USDILS') H[k] = v.split(',').map((c, i) => ({ date: dates[i], close: Number(c) })); });
    const D = dailyPnl(real, H, { to: exp.to });
    const A = strategy(D.days, H, real, { from: exp.from, to: exp.to });
    A.groups.forEach(g => ok(Math.abs(g.pnl - exp.pnl[g.id]) <= exp.tolerance, `${g.label}: הרווח תואם לחישוב העצמאי — קיבלתי ${Math.round(g.pnl)}, ציפיתי ${exp.pnl[g.id]}`));
    info(A.groups.map(g => `${g.label}: נטו ${Math.round(g.pnl)} · מדד ${Math.round(g.bench)} · יתרון ${Math.round(g.edge)} · ${g.trades} עסקאות · עמלות ${Math.round(g.fees)}`).join('\n  · '));
  }
}
