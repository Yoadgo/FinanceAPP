/* כרטיס נייר — מנוע. */
import { readFileSync, existsSync } from 'node:fs';
import { section, ok, eq, info } from './lib.mjs';
import { stockSummary, tradeMarkers, TAX_RATE } from '../js/engines/stock.js';
import { Classifier } from '../js/engines/classifier.js';
import { privateJson } from './private.mjs';
import { analyzeTransactions } from '../js/engines/migration.js';
import { toEngineRow } from '../js/engines/model.js';

const T = (o) => ({ Portfolio: 'Y', Currency: '$', Fees: 0, TotalILS: 0, EstimatedTax: 0, Name: `${o.Symbol} US`, ...o });
const rows = Classifier.enrichAll([
  T({ Date: '2026-01-02', Type: 'קניה חול מטח', Symbol: 'ZS', Qty: 10, ExecutionRate: 100, TotalFX: -1006, Commission: 6 }),
  T({ Date: '2026-02-02', Type: 'קניה חול מטח', Symbol: 'ZS', Qty: 10, ExecutionRate: 120, TotalFX: -1206, Commission: 6 }),
  T({ Date: '2026-03-02', Type: 'מכירה חול מטח', Symbol: 'ZS', Qty: 10, ExecutionRate: 130, TotalFX: 1294, Commission: 6 }),
  T({ Date: '2026-03-02', Type: 'קניה חול מטח', Symbol: 'ZS', Qty: 5, ExecutionRate: 100, TotalFX: -506, Commission: 6, Portfolio: 'D' }),
  T({ Date: '2026-01-02', Type: 'קניה חול מטח', Symbol: 'NVDA', Qty: 1, ExecutionRate: 100, TotalFX: -106, Commission: 6 }),
]);

section('כרטיס נייר (סינתטי)');
{
  const s = stockSummary('ZS', rows, { price: 150, creditsUsd: { Y: 50 } });
  eq(s.entries, 3, 'שלוש קניות');
  eq(s.exits, 1, 'מכירה אחת');
  eq(s.realized, 300, 'ממומש: 10 × (130 − 100) — FIFO, הקנייה הראשונה');
  eq(s.commissions, 24, 'כל העמלות על הנייר');
  eq(s.qty, 15, 'פתוח: 10 ביועד + 5 בדר');
  eq(s.unrealized, 10 * 30 + 5 * 50, 'לא ממומש');
  eq(s.net, 300 + 550 - 24, 'נטו = ממומש + לא ממומש − עמלות');
  eq(s.avgBuy, (10 * 100 + 10 * 120 + 5 * 100) / 25, 'מחיר קנייה ממוצע מהפרוסות');
  eq(s.avgSell, 130, 'מחיר מכירה ממוצע');
  eq(s.winRate, 1, 'עסקה סגורה אחת, מרוויחה');
  const n = s.sellNow;
  eq(n.fee, 12, 'עמלה משוערת פעם אחת לכל תיק (שתי מכירות)');
  const y = n.perPortfolio.find(p => p.portfolio === 'Y'), d = n.perPortfolio.find(p => p.portfolio === 'D');
  eq(y.gain, 300 - 6, 'רווח ביועד אחרי עמלה');
  eq(y.taxBefore, 294 * TAX_RATE, '25% על הרווח');
  eq(y.tax, 294 * TAX_RATE - 50, 'פחות זיכוי המס הפתוח של אותו תיק');
  eq(d.tax, (250 - 6) * TAX_RATE, 'הזיכוי של יועד לא מקזז את דר');
  eq(n.cashOut, 15 * 150 - 12 - n.tax, 'נשאר ביד = שווי − עמלה − מס');
  eq(n.lifetimeAfterTax, 300 + 550 - 24 - 12 - n.tax, 'כל החיים של הנייר, אם אמכור עכשיו');
  const loss = stockSummary('ZS', rows, { price: 90 }).sellNow;
  eq(loss.tax, 0, 'הפסד → אין מס');
  eq(stockSummary('ZS', rows, { price: null }).sellNow, null, 'בלי מחיר → אין "אם מוכר עכשיו"');
  const m = tradeMarkers('ZS', rows);
  eq(m.map(x => `${x.date}:${x.side}:${x.qty}`).join(' '), '2026-01-02:buy:10 2026-02-02:buy:10 2026-03-02:buy:5 2026-03-02:sell:10', 'נקודות: קנייה ומכירה לפי יום');
}

const csv = new URL('./private/stocksdata/Transactions.csv', import.meta.url);
const X = privateJson('expected-stock.json');
if (!existsSync(csv) || !X) info('נתוני הגיליון חסרים — מדלג על כרטיס הנייר האמיתי');
else {
  section('כרטיס נייר — נייר אמיתי מול החישוב הידני');
  const real = Classifier.enrichAll(analyzeTransactions(readFileSync(csv, 'utf8')).ok.map(p => toEngineRow(p.doc)));
  const s = stockSummary(X.symbol, real, { price: X.price });
  Object.entries(X.expect).forEach(([k, v]) => eq(Math.round(s[k] * 100) / 100, v, `${k} תואם לחישוב הידני`));
  const m = tradeMarkers(X.symbol, real);
  ok(m.length > 0 && m.every(x => x.price > 0), 'לכל נקודה מחיר (מותאם פיצול)');
}
