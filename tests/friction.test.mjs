/* מס ועמלות — מנוע החיכוך. סינתטי + (אם יש) הנתונים האמיתיים. */
import { readFileSync, existsSync } from 'node:fs';
import { section, ok, eq, info } from './lib.mjs';
import { friction, itemsOf } from '../js/engines/friction.js';
import { Classifier } from '../js/engines/classifier.js';
import { makeFxSeries } from '../js/engines/fx.js';
import { analyzeTransactions, analyzeFx } from '../js/engines/migration.js';
import { toEngineRow } from '../js/engines/model.js';
import { privateJson } from './private.mjs';

const R = (o) => Classifier.enrichAll([{ Portfolio: 'Y', Currency: '$', Commission: 0, Qty: 0, TotalFX: 0, TotalILS: 0, EstimatedTax: 0, ExecutionRate: 0, Name: '', Symbol: '', ...o }])[0];
const fx = makeFxSeries(Array.from({ length: 365 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), rate: 3 })));

section('חיכוך — דליים (סינתטי)');
{
  const rows = [
    R({ Date: '2026-02-01', Type: 'קניה חול מטח', Symbol: 'ZS', Name: 'ZS US', Qty: 10, ExecutionRate: 100, TotalFX: -1006, Commission: 6 }),
    R({ Date: '2026-03-01', Type: 'מכירה חול מטח', Symbol: 'ZS', Name: 'ZS US', Qty: 10, ExecutionRate: 150, TotalFX: 1494, Commission: 6, EstimatedTax: 375 }),
    R({ Date: '2026-03-03', Type: 'משיכה', Name: 'מס לשלם', Symbol: '9993983', Qty: 400, Currency: '₪' }),
    R({ Date: '2026-04-01', Type: 'הפקדה', Name: 'מגן מס', Symbol: '9993983', Qty: 25, Currency: '₪' }),
    R({ Date: '2026-04-02', Type: 'הפקדה', Name: 'מס עתידי', Symbol: '9992985', Qty: 99, Currency: '₪' }),
    R({ Date: '2026-04-03', Type: 'משיכה', Name: 'מס עתידי', Symbol: '9992985', Qty: 99, Currency: '₪' }),
    R({ Date: '2026-05-01', Type: 'ריבית מזומן בשח', Name: 'ר.חובה 04/26', Symbol: '900', TotalILS: -120, Currency: '₪' }),
    R({ Date: '2026-05-02', Type: 'הפקדה דיבידנד מטח', Name: 'דיב/ IVV US', Symbol: '99028', TotalFX: 40 }),
    R({ Date: '2026-05-02', Type: 'משיכת מס חול מטח', Name: 'מסח/ IVV US', Symbol: '99028', TotalFX: -10 }),
    R({ Date: '2026-06-01', Type: 'דמי טפול מזומן בשח', Name: 'דמי טיפול', Symbol: '900', TotalILS: -15, Currency: '₪' }),
  ];
  const f = friction(rows, { fx });
  const y = f.years[0];
  eq(y.costs.commission.usd, 12, 'עמלה מעמודת Commission של שורות העסקה');
  eq(y.costs.debitInterest.ils, 120, 'ריבית חובה');
  eq(y.costs.mgmtFee.ils, 15, 'דמי טיפול');
  eq(y.costs.divTax.usd, 10, 'מס במקור על דיבידנד');
  eq(y.tax.paid, 400, 'מס ששולם');
  eq(y.tax.credit, 25, 'זיכוי מגן מס');
  eq(y.costs.cgTax.total, 375, 'מס רווח הון נטו = 400 − 25 (= אומדן הברוקר)');
  ok(!itemsOf(rows[4]).length && !itemsOf(rows[5]).length, '"מס עתידי" לא נספר (זוג שמתקזז)');
  eq(y.income.dividend.usd, 40, 'דיבידנד ברוטו בצד ההכנסות');
  eq(y.frictionIls, 12 * 3 + 120 + 15 + 10 * 3 + 375, 'חיכוך בשקלים לפי שער יום העסקה');
  eq(y.realizedUsd, 500, 'רווח ממומש ברוטו (לפני עמלות)');
  eq(Math.round(y.shareOfProfit * 1000) / 1000, Math.round((576 / (1500 + 120)) * 1000) / 1000, 'אחוז מהרווח = חיכוך ÷ (רווח ממומש + הכנסות)');

  const noFx = friction(rows, { fx: null }).years[0];
  eq(noFx.frictionIls, null, 'בלי שער — הסכום המשולב הוא מקף, לא ניחוש');
  eq(noFx.costs.commission.usd, 12, 'אבל הסכום במטבע המקורי נשאר');

  const loss = friction([...rows.slice(0, 2), R({ Date: '2026-07-01', Type: 'הפקדה', Name: 'מגן מס', Symbol: '9993983', Qty: 700, Currency: '₪' })], { fx }).years[0];
  eq(loss.costs.cgTax.total, 0, 'זיכוי גדול מהתשלום → מס 0, לא "הכנסה"');
  eq(loss.tax.unusedCredit, 700, 'והזיכוי שלא נוצל מוצג בנפרד');
  /* ביקורת 30.9: מס רווח הון בדולר נכנס לדלי המס (לא רק לסך) */
  const usdTax = friction([R({ Date: '2026-08-01', Type: 'משיכת מס חול מטח', Name: 'מס רווח הון IVV', Symbol: '99028', TotalFX: -100 })], { fx }).years[0];
  eq(usdTax.costs.cgTax.total, 300, 'מס רווח הון בדולר מומר ונספר בדלי');
  eq(usdTax.frictionIls, 300, 'והחלקים מתלכדים לסך');
  const fees = friction([R({ Date: '2026-02-01', Type: 'קניה חול מטח', Symbol: 'ZS', Qty: 1, ExecutionRate: 1, TotalFX: -8, Commission: 6, Fees: 1 })], { fx }).years[0];
  eq(fees.costs.commission.usd, 7, 'עמלות נלוות נספרות עם עמלת הפעולה');
}

const csv = new URL('./private/stocksdata/Transactions.csv', import.meta.url);
const fxCsv = new URL('./private/stocksdata/USD_ILS.csv', import.meta.url);
if (!existsSync(csv) || !existsSync(fxCsv)) info('נתוני הגיליון חסרים — מדלג על בדיקת החיכוך האמיתית');
else {
  section('חיכוך — הנתונים האמיתיים (1,735 שורות)');
  const mig = analyzeTransactions(readFileSync(csv, 'utf8'));
  const rows = Classifier.enrichAll(mig.ok.map(p => toEngineRow(p.doc)));
  const series = makeFxSeries(analyzeFx(readFileSync(fxCsv, 'utf8')).series);
  const f = friction(rows, { fx: series });
  eq(f.missingFx.length, 0, 'לכל שורה יש שער יומי');
  const Y = Object.fromEntries(f.years.map(y => [y.year, y]));
  /* סכומים שחושבו בנפרד (Python על ה-CSV, 30.9.2026). הערכים עצמם ב-tests/private
     (הריפו ציבורי — אין בו סכומים אמיתיים). */
  const X = privateJson('expected-friction.json') || [];
  X.forEach(x => eq(Math.round(Y[x.year].costs[x.bucket][x.cur] * 100) / 100, x.value, `${x.bucket} ${x.year} תואם לחישוב הנפרד`));
  ok(X.length > 0, 'יש ערכים צפויים לבדיקה');
  /* זהות מגן המס: לכל תיק ושנה, מס ששולם − זיכויים = Σ אומדן הברוקר */
  const est = {}, net = {};
  rows.forEach(r => {
    const k = `${r.Portfolio}|${String(r.Date).slice(0, 4)}`;
    if (r.subCategory === 'SELL_STOCK') est[k] = (est[k] || 0) + (Number(r.EstimatedTax) || 0);
    if (r.subCategory === 'TAX_PAYMENT') net[k] = (net[k] || 0) + Number(r.Qty);
    if (r.subCategory === 'TAX_PROVISION') net[k] = (net[k] || 0) - Number(r.Qty);
  });
  const worst = Object.keys(net).reduce((m, k) => Math.max(m, Math.abs(net[k] - (est[k] || 0))), 0);
  /* הסטייה הגדולה (עשרות שקלים): זיכוי מגן מס בשנה בלי מכירה באותה שנה, שאופס בשנה שאחריה. */
  ok(worst < 40, 'מס ששולם − זיכויי מגן מס = אומדן הברוקר, בכל תיק ושנה');
}
