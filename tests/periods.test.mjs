/* רווח לפי תקופה. */
import { readFileSync, existsSync } from 'node:fs';
import { section, ok, eq, info } from './lib.mjs';
import { dailyPnl, aggregate, periodKey } from '../js/engines/periods.js';
import { Classifier } from '../js/engines/classifier.js';
import { makeFxSeries } from '../js/engines/fx.js';
import { analyzeTransactions } from '../js/engines/migration.js';
import { toEngineRow } from '../js/engines/model.js';
import { privateJson } from './private.mjs';

const R = o => ({ Portfolio: 'Y', Currency: '$', Commission: 0, Fees: 0, TotalFX: 0, TotalILS: 0, EstimatedTax: 0, ExecutionRate: 0, Qty: 0, Name: '', Symbol: '', ...o });
const fx = makeFxSeries(Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10), rate: 3 + (i >= 10 ? 0.5 : 0) })));
/* ספטמבר 2026: 1.9 = שלישי */
const rows = Classifier.enrichAll([
  R({ Date: '2026-09-01', Type: 'העברה מזומן בשח', Name: 'הפקדה', Symbol: '900', TotalILS: 50000, Currency: '₪' }),
  R({ Date: '2026-09-01', Type: 'קניה חול מטח', Symbol: 'ZS', Name: 'ZS US', Qty: 10, ExecutionRate: 100, TotalFX: -1006, Commission: 6 }),
  R({ Date: '2026-09-03', Type: 'הפקדה דיבידנד מטח', Symbol: '99028', Name: 'דיב/ ZS US', TotalFX: 20 }),
  R({ Date: '2026-09-08', Type: 'מכירה חול מטח', Symbol: 'ZS', Name: 'ZS US', Qty: 10, ExecutionRate: 130, TotalFX: 1294, Commission: 6 }),
  R({ Date: '2026-09-09', Type: 'משיכה', Name: 'מס לשלם', Symbol: '9993983', Qty: 300, Currency: '₪' }),
]);
const hist = { ZS: [{ date: '2026-09-01', close: 101 }, { date: '2026-09-02', close: 110 }, { date: '2026-09-03', close: 105 }, { date: '2026-09-04', close: 120 }, { date: '2026-09-07', close: 125 }, { date: '2026-09-08', close: 131 }, { date: '2026-09-09', close: 131 }] };

section('רווח לפי תקופה (סינתטי)');
{
  const D = dailyPnl(rows, hist, { fx, to: '2026-09-09' });
  const by = Object.fromEntries(D.days.map(d => [d.date, d]));
  eq(by['2026-09-01'].pnlUsd, 1010 - 1006, 'יום הקנייה: שווי 10×101 פחות 1,006 ששולמו = +4 (העמלה כבר בפנים)');
  eq(by['2026-09-02'].pnlUsd, 90, 'יום 2: עלייה 101 → 110');
  eq(by['2026-09-03'].pnlUsd, -50 + 20, 'יום 3: ירידה + דיבידנד');
  ok(!by['2026-09-05'] && !by['2026-09-06'], 'סוף שבוע בלי תנועות — לא יום');
  eq(by['2026-09-08'].pnlUsd, -1250 + 1294, 'יום המכירה: השווי יורד ל-0, התמורה נכנסת');
  eq(by['2026-09-09'].pnlUsd, -300 / 3, 'מס ששולם — הפסד באותו יום (בשער היום)');
  const total = D.days.reduce((s, d) => s + d.pnlUsd, 0);
  eq(Math.round(total * 100) / 100, Math.round((1294 - 1006 + 20 - 300 / 3) * 100) / 100, 'סך הכול = תמורה − עלות + דיבידנד − מס; ההפקדה לא רווח');
  const w = aggregate(D.days, { res: 'week' }), m = aggregate(D.days, { res: 'month' }), d = aggregate(D.days, { res: 'day' });
  ok(Math.abs(w.total - d.total) < 1e-9 && Math.abs(m.total - d.total) < 1e-9, 'יום, שבוע וחודש מסתכמים לאותו דבר');
  eq(w.count, 2, 'שני שבועות');
  eq(periodKey('2026-09-06', 'week'), '2026-08-31', 'שבוע מתחיל בשני');
  eq(d.best.key, '2026-09-04', 'היום הטוב ביותר (+150)');
  eq(d.periods.find(p => p.key === '2026-09-02').pct, 90 / 1010, 'אחוז יומי: רווח חלקי השווי בתחילת היום');
  const di = aggregate(D.days, { res: 'day', cur: 'ils' });
  eq(Math.round(di.periods.find(p => p.key === '2026-09-02').pct * 1e6), Math.round((90 / 1010) * 1e6), 'אחוז בשקלים, שער קבוע = אותו אחוז');
  ok(di.periods.every(p => p.pnl === null || p.pct === null || isFinite(p.pct)), 'אחוז בשקלים — מספר או חסר');
  ok(d.periods.find(p => p.key === '2026-09-02').contrib.ZS === 90, 'תרומה לפי נייר');
  eq(d.periods.find(p => p.key === '2026-09-03').otherUsd, 20, 'דיבידנד בשורת "הכנסות והוצאות"');
  const ils = aggregate(D.days, { res: 'day', cur: 'ils' });
  eq(Math.round(ils.periods.find(p => p.key === '2026-09-02').pnl * 100) / 100, 270, 'בשקלים: 90$ × 3');
  const noFx = aggregate(dailyPnl(rows, hist, { fx: null, to: '2026-09-09' }).days, { res: 'day', cur: 'ils' });
  eq(noFx.total, null, 'בלי שער — אין סך בשקלים, לא ניחוש');
  const range = aggregate(D.days, { res: 'day', from: '2026-09-02', to: '2026-09-03' });
  eq(range.total, 90 - 30, 'טווח תאריכים');

  /* פיצול: ההיסטוריה מותאמת לאחור, הכמות לפני הפיצול לא */
  const sp = Classifier.enrichAll([
    R({ Date: '2026-09-01', Type: 'קניה חול מטח', Symbol: 'XX', Name: 'XX US', Qty: 1, ExecutionRate: 2000, TotalFX: -2000 }),
    R({ Date: '2026-09-03', Type: 'הטבה', Symbol: 'XX', Name: 'XX US', Qty: 19 }),
  ]);
  const SD = dailyPnl(sp, { XX: [{ date: '2026-09-01', close: 100 }, { date: '2026-09-02', close: 100 }, { date: '2026-09-03', close: 100 }] }, { fx, to: '2026-09-03' });
  ok(SD.days.every(x => Math.abs(x.pnlUsd) < 1e-9), 'פיצול 1:20 — אפס רווח בכל יום, לא קפיצה של פי 20');
}

const csv = new URL('./private/stocksdata/Transactions.csv', import.meta.url);
const h = privateJson('googl-ivv-history.json');
if (!existsSync(csv) || !h) info('נתוני הגיליון חסרים — מדלג');
else {
  section('רווח לפי תקופה — נייר אמיתי (כולל פיצול 2022)');
  const real = Classifier.enrichAll(analyzeTransactions(readFileSync(csv, 'utf8')).ok.map(p => toEngineRow(p.doc)));
  const X = privateJson('expected-stock.json');
  const g = real.filter(r => String(r.Symbol).toUpperCase() === X.symbol && (r.category === 'STOCKS' || r.subCategory === 'SPLIT'));
  const a = aggregate(dailyPnl(g, { [X.symbol]: h[X.symbol] }, { to: '2026-09-29' }).days, { res: 'month' });
  ok(Math.abs(a.total - X.expect.net) < 0.5, 'סך כל החודשים = הנטו של כרטיס הנייר (הפרש אגורות: עיגול בתמורה של הברוקר)');
  ok(a.periods.every(p => Math.abs(p.pnl) < 3000), 'אין חודש עם קפיצה מלאכותית סביב הפיצול');
}
