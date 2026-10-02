/* השוואה לטיקר ופירוק "ממה מורכב השינוי" (engines/compare.js),
   ויישור קו השווי ליום הנכון (באג 2.10.2026 ב-series.js). */
import { readFileSync, existsSync } from 'node:fs';
import { section, ok, eq, info } from './lib.mjs';
import { Classifier } from '../js/engines/classifier.js';
import { makeFxSeries } from '../js/engines/fx.js';
import { investSeries, depositsUsd, benchmarkSeries } from '../js/engines/series.js';
import { dailyPnl } from '../js/engines/periods.js';
import { analyzeTransactions, analyzeFx } from '../js/engines/migration.js';
import { toEngineRow } from '../js/engines/model.js';
import { rebasePct, rangeReturn, periodReturns, flowEvents, decompose, compareSymbols, closeBefore, MAX_COMPARE } from '../js/engines/compare.js';

const near = (a, b, msg, tol = 1e-6) => ok(a !== null && Math.abs(a - b) <= tol, `${msg} — קיבלתי ${a}, ציפיתי ${b}`);
const R = o => ({ Portfolio: 'Y', Currency: '$', Commission: 0, Fees: 0, TotalFX: 0, TotalILS: 0, EstimatedTax: 0, ExecutionRate: 0, Qty: 0, Name: '', Symbol: '', CashBalanceILS: 0, ...o });
const fx = makeFxSeries(Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.UTC(2026, 7, 20 + i)).toISOString().slice(0, 10), rate: 4 })));
const rows = Classifier.enrichAll([
  R({ Date: '2026-09-01', Type: 'העברה מזומן בשח', Currency: '₪', TotalILS: 4000, CashBalanceILS: 4000 }),           // +$1,000
  R({ Date: '2026-09-01', Type: 'קניה חול מטח', Symbol: 'XX', Name: 'XX US', Qty: 10, ExecutionRate: 100, TotalFX: -1000 }),
  R({ Date: '2026-09-03', Type: 'העברה מזומן בשח', Currency: '₪', TotalILS: -800, CashBalanceILS: 3200 }),           // −$200
]);
const hist = { XX: [['2026-09-01', 100], ['2026-09-02', 110], ['2026-09-03', 110], ['2026-09-04', 99]].map(([date, close]) => ({ date, close })) };
const S = investSeries(rows, hist, fx, 'XX');
const at = d => (S.value.find(p => p.time === d) || {}).value ?? null;

section('קו השווי מיושר ליום שלו (באג היום-באיחור)');
{
  info(`אזור זמן: ${process.env.TZ}`);
  near(at('2026-09-01'), 1000, '1.9: הפקדה $1,000, קנייה ב-$1,000 — שווה $1,000');
  near(at('2026-09-02'), 1100, '2.9: המחיר עלה ל-110 — השווי באותו יום, לא למחרת');
  near(at('2026-09-03'), 900, '3.9: משיכה של $200 נראית ביום שלה');
  near(at('2026-09-04'), 790, '4.9: ירידה ל-99');
  const B = benchmarkSeries(depositsUsd(rows, fx), hist.XX, S.days);
  near((B.find(p => p.time === '2026-09-02') || {}).value ?? null, 1100, 'קו "אותו כסף" בנייר שנקנה = קו השווי באותו יום (שניהם מיושרים)');
}

section('השוואה: אחוזים מתחילת הטווח');
{
  const c = hist.XX;
  eq(closeBefore(c, '2026-09-02'), 100, 'הסגירה שלפני 2.9');
  eq(closeBefore(c, '2026-09-01'), null, 'אין סגירה לפני הראשונה');
  const p = rebasePct(c, '2026-09-02');
  near(p[0].value, 10, 'מ-2.9: הבסיס הוא 1.9 (100), אז 2.9 = +10%');
  near(p[p.length - 1].value, -1, '4.9: 99 מול 100 = −1%');
  near(rebasePct(c)[0].value, 0, 'בלי טווח: הנקודה הראשונה היא 0%');
  eq(rebasePct(c, '2027-01-01').length, 0, 'טווח בלי נתונים — ריק, לא קריסה');
  near(rangeReturn(c, '2026-09-03', '2026-09-04'), 99 / 110 - 1, 'תשואת טווח: 110 → 99');
  eq(rangeReturn(c, '2027-01-01', '2027-02-01'), null, 'אין נתונים — null, לא 0');
  const pr = periodReturns(c, [{ from: '2026-09-01', to: '2026-09-02' }, { from: '2026-09-03', to: '2026-09-04' }]);
  near(pr[0].value, 10, 'תקופה ראשונה: הבסיס הוא הסגירה הראשונה (אין לפניה)');
  near(pr[1].value, -10, 'תקופה שנייה: 110 → 99');
  const syms = compareSymbols({ IVV: Array(250).fill({}), TSLA: Array(250).fill({}), NEW: [{}], USDILS: Array(300).fill({}) }, { exclude: ['ivv'] });
  eq(syms.join(','), 'TSLA', 'רשימת ההשוואה: רק ניירות עם היסטוריה, בלי השער ובלי מה שכבר בגרף');
  eq(MAX_COMPARE, 3, 'עד 3 ניירות לגרף (יועד, 2.10.2026)');
}

section('פירוק: ממה מורכב השינוי');
{
  const dep = depositsUsd(rows, fx);
  const F = flowEvents(dep);
  eq(F.length, 2, 'שני ימי תזרים');
  near(F[1].usd, -200, 'משיכה = מספר שלילי');
  const D = dailyPnl(rows, hist, { fx, to: '2026-09-04' });
  const X = decompose({ value: S.value, deposits: dep, days: D.days }, { from: '2026-09-02', to: '2026-09-04' });
  near(X.startValue, 1000, 'הבסיס: השווי בסוף 1.9');
  near(X.change, -210, 'שינוי: 1,000 → 790');
  near(X.flows, -200, 'מתוכו משיכה $200');
  near(X.gain, -10, 'ומתוכו שוק: XX 100 → 99 על 10 יחידות');
  near(X.bySym[0].usd, -10, 'תרומת XX');
  near(X.residual, 0, 'שארית אפס — המספרים מתיישבים');
  eq(X.reconciled, true, 'מתיישב');
  /* הבדיקה יודעת להגיד "לא": שווי שקפץ בלי סיבה */
  const bad = S.value.map(p => (p.time === '2026-09-04' ? { ...p, value: p.value + 5000 } : p));
  eq(decompose({ value: bad, deposits: dep, days: D.days }, { from: '2026-09-02', to: '2026-09-04' }).reconciled, false, 'קפיצה לא מוסברת → "לא מתיישב"');
  eq(decompose({ value: S.value, deposits: dep, days: D.days }, { from: '2030-01-01' }), null, 'טווח אחרי הנתונים — null');
  const all = decompose({ value: S.value, deposits: dep, days: D.days }, { from: '0000', to: '2026-09-04' });
  near(all.flows, 800, 'מההתחלה: הבסיס 0, וכל ההפקדות נכנסות');
  near(all.residual, 0, 'מההתחלה: מתיישב');
}

section('פירוק: נתונים אמיתיים (תנועות + מחירים שבועיים 2026)');
{
  const tp = new URL('./private/stocksdata/Transactions.csv', import.meta.url), pp = new URL('./private/px-weekly-2026.txt', import.meta.url), fp = new URL('./private/stocksdata/USD_ILS.csv', import.meta.url);
  if (!existsSync(tp) || !existsSync(pp) || !existsSync(fp)) info('מדלג — אין tests/private');
  else {
    const real = Classifier.enrichAll(analyzeTransactions(readFileSync(tp, 'utf8')).ok.map(p => toEngineRow(p.doc)));
    const rfx = makeFxSeries(analyzeFx(readFileSync(fp, 'utf8')).series);
    const H = {}; let dates = [];
    readFileSync(pp, 'utf8').trim().split('\n').forEach(l => { const [k, v] = l.split(':'); if (k === 'DATES') dates = v.split(','); else if (k !== 'USDILS') H[k] = v.split(',').map((c, i) => ({ date: dates[i], close: Number(c) })).filter(x => x.close > 0); });
    const RS = investSeries(real, H, rfx, 'IVV'), dep = depositsUsd(real, rfx), D = dailyPnl(real, H, { fx: rfx, to: '2026-09-18' });
    for (let m = 1; m <= 9; m++) {
      const mm = String(m).padStart(2, '0');
      const X = decompose({ value: RS.value, deposits: dep, days: D.days }, { from: `2026-${mm}-01`, to: `2026-${mm}-${m === 9 ? '18' : '31'}` });
      ok(X.reconciled, `חודש ${mm}: השינוי בשווי = תזרים + רווח (שארית ${Math.round(X.residual)}, סבולת ${Math.round(X.tolerance)})`);
    }
    const J = decompose({ value: RS.value, deposits: dep, days: D.days }, { from: '2026-06-01', to: '2026-06-30' });
    info(`יוני: שינוי ${Math.round(J.change)} = משיכות ${Math.round(J.flowsOut)} + הפקדות ${Math.round(J.flowsIn)} + שוק ${Math.round(J.gain)} + שארית ${Math.round(J.residual)} · מוביל: ${J.bySym[0].symbol} ${Math.round(J.bySym[0].usd)}`);
  }
}
