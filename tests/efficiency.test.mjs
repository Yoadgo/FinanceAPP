/* "שווה או לא שווה" — הדוגמה של יועד, בנויה כנתונים, ועוד מקרי קצה. */
import { section, ok, eq, info } from './lib.mjs';
import { Classifier } from '../js/engines/classifier.js';
import { efficiency, verdictText } from '../js/engines/efficiency.js';
import { historyFromDocs, docsFromHistory, benchmarkSeries, closeAt } from '../js/engines/series.js';

/* מחירים: GOOGL זז לפי התסריט, IVV עולה 0.03% ביום (≈11% בשנה) */
const days = [];
for (let d = new Date('2024-01-01T00:00:00Z'); d <= new Date('2025-12-31T00:00:00Z'); d = new Date(d.getTime() + 86400000)) days.push(d.toISOString().slice(0, 10));
const ivv = days.map((date, i) => ({ date, close: 400 * Math.pow(1.0003, i) }));

const T = (Date, Type, Qty, px, extra = {}) => ({ Date, Type, Name: 'GOOGL', Symbol: 'GOOGL', Qty, ExecutionRate: px, Commission: 5, Currency: '$', TotalFX: Qty * px, Portfolio: 'איביאי-יועד', ...extra });

section('יעילות — הדוגמה של גוגל');
{
  /* 10 כניסות ויציאות: 8 הפסדים של $125 (=−$1,000), 2 רווחים של $600 (=+$1,200),
     עמלה $5 לכל פעולה → 20 פעולות = $100. נטו: 1,200 − 1,000 − 100 = $100.
     כל עסקה מחזיקה 30 יום על $10,000. */
  const rows = [];
  const googl = [];
  let day = 0;
  const outcomes = [-125, -125, 600, -125, -125, -125, 600, -125, -125, -125];
  outcomes.forEach((pnl, i) => {
    const buy = days[day], sell = days[day + 30];
    rows.push(T(buy, 'קניה חול מטח', 100, 100));
    rows.push(T(sell, 'מכירה חול מטח', -100, 100 + pnl / 100));
    googl.push({ date: buy, close: 100 }, { date: sell, close: 100 + pnl / 100 });
    day += 45;
  });
  const hist = { GOOGL: googl, IVV: ivv };
  const e = efficiency(Classifier.enrichAll(rows), hist, { bench: 'IVV' });
  const g = e.bySymbol.find(s => s.symbol === 'GOOGL');
  eq(g.entries, 10, '10 כניסות');
  eq(g.exits, 10, '10 יציאות');
  eq(g.wins, 2, '2 רווחים'); eq(g.losses, 8, '8 הפסדים');
  eq(Math.round(g.grossWin), 1200, 'רווח גולמי $1,200');
  eq(Math.round(g.grossLoss), 1000, 'הפסד גולמי $1,000');
  eq(g.commissions, 100, 'עמלות $100');
  eq(Math.round(g.net), 100, 'נטו $100 — כמו שיועד חישב');
  const expectBench = 10 * 10000 * (Math.pow(1.0003, 30) - 1);
  eq(Math.round(g.benchPnl), Math.round(expectBench), `IVV על אותו כסף באותם ימים: ~$${Math.round(expectBench)}`);
  ok(!g.worth, 'פסק הדין: לא שווה');
  info(verdictText(g));
  ok(verdictText(g).startsWith('לא שווה'), 'המשפט אומר "לא שווה"');
  eq(Math.round(g.feeShare * 100), 8, 'העמלות אכלו 8% מהרווח הגולמי');
}

section('יעילות — נייר שהכה את המדד');
{
  const rows = [T('2024-01-02', 'קניה חול מטח', 10, 100), T('2024-12-30', 'מכירה חול מטח', -10, 150)];
  const hist = { GOOGL: [{ date: '2024-01-02', close: 100 }, { date: '2024-12-30', close: 150 }], IVV: ivv };
  const g = efficiency(Classifier.enrichAll(rows), hist).bySymbol[0];
  ok(g.worth, '+50% מול ~11% → שווה');
  ok(g.annualPct > g.benchAnnualPct, 'תשואה שנתית על ההון גבוהה מזו של המדד');
}

section('יעילות — בלי היסטוריית מדד');
{
  const rows = [T('2024-01-02', 'קניה חול מטח', 10, 100)];
  const e = efficiency(Classifier.enrichAll(rows), { GOOGL: [{ date: '2024-01-02', close: 100 }] });
  eq(e.covered, false, 'אין IVV → covered=false (המסך אומר "אין נתוני מדד", לא מנחש)');
}

section('סדרות — מחירים ו"אותו כסף במדד"');
{
  const docs = docsFromHistory('ivv', [['2024-12-31', 500], ['2025-01-02', 505]]);
  eq(docs.length, 2, 'מסמך לכל שנה');
  eq(docs[0].id, 'px_IVV_2024', 'מזהה px_SYM_YEAR');
  const h = historyFromDocs(docs.map(d => d.data));
  eq(h.IVV.length, 2, 'הלוך-חזור');
  eq(closeAt(h.IVV, '2025-01-01'), 500, 'חג → הסגירה האחרונה שלפניו');
  const b = benchmarkSeries([{ date: '2024-12-31', usd: 1000 }], h.IVV, ['2024-12-31', '2025-01-02']);
  eq(b[1].value, 1010, '$1,000 ב-IVV ב-500 → 2 יחידות → $1,010 ב-505');
}

section('גיליון המחירים — פענוח');
{
  const { parseCsv } = await import('../js/ingest/csv.js');
  const { parsePricesSheet, detectDayFirst } = await import('../js/engines/pricesSheet.js');
  /* בדיוק המבנה שנבנה בדרייב ב-29.9 (ערכים אמיתיים מאותו ערב) */
  const csv = [
    'IVV,IVV,QQQ,QQQ,USDILS,USDILS',
    'price,767.52,price,737.93,price,3.06706',
    'changepct,-0.18,changepct,0.19,changepct,',
    'Date,Close,Date,Close,Date,Close',
    '03/01/2022 16:00:00,479.84,03/01/2022 16:00:00,401.68,01/01/2022 23:58:00,3.11333',
    '04/01/2022 16:00:00,479.68,04/01/2022 16:00:00,396.47,02/01/2022 23:58:00,3.10899',
    '28/09/2026 16:00:00,768.9,28/09/2026 16:00:00,736.5,03/01/2022 23:58:00,3.10969',
  ].join('\n');
  const p = parsePricesSheet(parseCsv(csv));
  eq(p.latest.IVV.price, 767.52, 'מחיר IVV');
  eq(p.latest.QQQ.changePct, 0.19, 'שינוי יומי QQQ');
  eq(p.fx.USDILS.rate, 3.06706, 'שער דולר');
  eq(p.dayFirst, true, 'זוהה פורמט יום/חודש (28/09)');
  eq(p.history.IVV[0][0], '2022-01-03', '03/01/2022 = 3 בינואר');
  eq(p.history.IVV[2][0], '2026-09-28', 'תאריך אחרון');
  eq(p.history.USDILS.length, 3, 'היסטוריית שער');
  eq(detectDayFirst(['1/3/2022', '1/28/2022']), false, 'חודש/יום מזוהה');
  eq(detectDayFirst(['01/02/2022']), null, 'דו-משמעי → null (לא מנחשים)');
  const bad = parsePricesSheet(parseCsv('IVV,IVV\nprice,#N/A\nchangepct,\n'));
  ok(bad.problems.some(x => x.includes('IVV')), 'מחיר חסר → בעיה מדווחת, לא אפס');
}
