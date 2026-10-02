/* סדרות הגרף הראשי — מזומן בדולרים נספר בשווי התיק (2.10.2026). */
import { readFileSync, existsSync } from 'node:fs';
import { section, ok, eq, info } from './lib.mjs';
import { investSeries, usdCashDeltas, ilsCashByDay } from '../js/engines/series.js';
import { Classifier } from '../js/engines/classifier.js';
import { makeFxSeries } from '../js/engines/fx.js';
import { analyzeTransactions, analyzeFx } from '../js/engines/migration.js';
import { toEngineRow } from '../js/engines/model.js';

const R = o => ({ Portfolio: 'Y', Currency: '$', Commission: 0, Fees: 0, TotalFX: 0, TotalILS: 0, CashBalanceILS: 0, EstimatedTax: 0, ExecutionRate: 0, Qty: 0, Name: '', Symbol: '', ...o });
const fx = makeFxSeries(Array.from({ length: 4000 }, (_, i) => ({ date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), rate: 4 })));

section('סדרות: מזומן בדולרים (סינתטי)');
{
  /* ₪40,000 הופקדו; הומרו ל-$10,000; נקנו 10 ZS ב-$100; נמכרו ב-$100.
     מחיר שטוח ושער קבוע → שווי התיק חייב להישאר $10,000 בכל יום. */
  const rows = Classifier.enrichAll([
    R({ Date: '2020-03-02', Type: 'העברה מזומן בשח', Name: 'העברה רגילה', Symbol: '900', TotalILS: 40000, CashBalanceILS: 40000, Currency: '₪' }),
    R({ Date: '2020-03-03', Type: 'קניה שח', Name: 'B USD/ILS 4.000', Symbol: '99028', Qty: 10000, ExecutionRate: 400, TotalILS: -40000, CashBalanceILS: 0.01, Currency: '₪' }),
    R({ Date: '2020-03-04', Type: 'קניה חול מטח', Symbol: 'ZS', Name: 'ZS US', Qty: 10, ExecutionRate: 100, TotalFX: -1000 }),
    R({ Date: '2020-03-06', Type: 'מכירה חול מטח', Symbol: 'ZS', Name: 'ZS US', Qty: 10, ExecutionRate: 100, TotalFX: 1000 }),
    R({ Date: '2020-03-09', Type: 'מכירה שח', Name: 'S USD/ILS 4.000', Symbol: '99028', Qty: 4000, ExecutionRate: 400, TotalILS: 16000, CashBalanceILS: 16000, Currency: '₪' }),
  ]);
  const hist = { ZS: Array.from({ length: 30 }, (_, i) => ({ date: `2020-03-${String(i + 1).padStart(2, '0')}`, close: 100 })) };
  eq(rows[1].subCategory, 'FX_CONVERSION', 'המרה מסווגת כהמרה');
  const d = usdCashDeltas(rows);
  eq(d.length, 4, 'ארבע תנועות מזיזות את יתרת הדולרים (ההפקדה בשקלים לא)');
  eq(d.reduce((s, x) => s + x.usd, 0), 6000, 'יתרת הדולרים בסוף: 10,000 − 1,000 + 1,000 − 4,000');
  const S = investSeries(rows, hist, fx, 'IVV');
  const at = day => S.value.find(p => p.time === day);
  const from = S.value.filter(p => p.time >= '2020-03-12' && p.time <= '2020-03-25');
  ok(from.length > 5, 'יש נקודות בטווח');
  ok(from.every(p => Math.abs(p.value - 10000) < 0.01), 'אחרי כל התנועות השווי הוא $10,000 (₪16,000 + $6,000)');
  /* הימים שבין ההמרה לקנייה ובין המכירה להמרה — שם היה הבור */
  const mid = S.value.filter(p => p.time >= '2020-03-05' && p.time <= '2020-03-11');
  ok(mid.every(p => Math.abs(p.value - 10000) < 0.01), `אין בור בין מכירה לקנייה — קיבלתי ${JSON.stringify(mid.map(p => Math.round(p.value)))}`);
  eq(S.cashUsd[S.cashUsd.length - 1].value, 6000, 'cashUsd מוחזר');
  /* "מס ששולם" מסווג כהמרה אבל הוא בשקלים — לא נוגע ביתרת הדולרים */
  const tax = Classifier.enrichAll([R({ Date: '2020-03-10', Type: 'קניה שח', Name: 'מס ששולם', Symbol: '9993983', Qty: 500, ExecutionRate: 100, TotalILS: -500, Currency: '₪' })]);
  eq(usdCashDeltas(tax).length, 0, 'מס ששולם (9993983) אינו דולרים');
  ok(S.invested.every(p => Math.abs(p.value - 10000) < 0.01 || p.value === 0), 'ההון שהושקע לא השתנה');
}

section('סדרות: יתרה שקלית בסוף יום — בלי תלות בסדר השורות (סינתטי)');
{
  /* יום אחד עם משיכה של ₪100,000 ואחריה המרה של $41,000 ל-₪115,000.
     יתרת פתיחה ₪−4,000. סוף היום: ₪11,000 — לא יתרת הביניים ₪−104,000. */
  const base = [
    R({ Date: '2020-03-02', Type: 'העברה מזומן בשח', Name: 'העברה רגילה', Symbol: '900', TotalILS: 160000, CashBalanceILS: 160000, Currency: '₪' }),
    R({ Date: '2020-03-03', Type: 'קניה שח', Name: 'B USD/ILS 4.000', Symbol: '99028', Qty: 41000, ExecutionRate: 400, TotalILS: -164000, CashBalanceILS: -4000, Currency: '₪' }),
    R({ Date: '2020-03-10', Type: 'העברה מזומן בשח', Name: 'משיכה', Symbol: '900', TotalILS: -100000, CashBalanceILS: -104000, Currency: '₪' }),
    R({ Date: '2020-03-10', Type: 'מכירה שח', Name: 'S USD/ILS 2.805', Symbol: '99028', Qty: 41000, ExecutionRate: 280.5, TotalILS: 115000, CashBalanceILS: 11000, Currency: '₪' }),
    R({ Date: '2020-03-10', Type: 'הפקדה', Name: 'מגן מס', Symbol: '9993983', Qty: 5, Currency: '₪', CashBalanceILS: -4000 }),
    /* נייר אחד — בלעדיו המנוע לא מחזיר עקומה. $5 יצאו מהדולרים ונכנסו לנייר (בעלות): השווי לא זז. */
    R({ Date: '2020-03-04', Type: 'קניה חול מטח', Symbol: 'ZS', Name: 'ZS US', Qty: 1, ExecutionRate: 5, TotalFX: -5, CashBalanceILS: -4000 }),
  ];
  const orders = [[0, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 0], [3, 4, 2, 0, 5, 1], [2, 5, 4, 3, 1, 0]];
  orders.forEach(o => {
    const rows = Classifier.enrichAll(o.map(i => base[i]));
    const c = ilsCashByDay(rows);
    eq(c[c.length - 1].ils, 11000, `סוף היום ₪11,000 בסדר ${o.join('')}`);
    const S = investSeries(rows, {}, fx, 'IVV');
    const v = S.value.find(p => p.time === '2020-03-15');
    eq(Math.round(v.value), 2750, `שווי אחרי המשיכה: ₪11,000 ÷ 4 = $2,750, בסדר ${o.join('')}`);
  });
  eq(ilsCashByDay(Classifier.enrichAll([R({ Date: '2020-03-02', Type: 'קניה חול מטח', Symbol: 'ZS', Qty: 1, ExecutionRate: 5, TotalFX: -5 })])).length, 0, 'יום בלי יתרה מדווחת לא מייצר נקודה');
}

section('סדרות: מזומן בדולרים (נתונים אמיתיים)');
{
  const tp = new URL('./private/stocksdata/Transactions.csv', import.meta.url), fp = new URL('./private/stocksdata/USD_ILS.csv', import.meta.url);
  if (!existsSync(tp) || !existsSync(fp)) info('מדלג — אין tests/private/stocksdata');
  else {
    const mig = analyzeTransactions(readFileSync(tp, 'utf8'));
    const rows = Classifier.enrichAll(mig.ok.map(p => toEngineRow(p.doc)));
    const d = usdCashDeltas(rows);
    /* שפיות: יתרת דולרים משוחזרת נכון חוזרת לסביבת האפס בתקופות ארוכות
       (2025: כל מכירה הומרה או הושקעה מחדש). יתרה שנסחפת = סוג תנועה שפוספס. */
    const bal = day => d.filter(x => x.t <= Date.parse(day)).reduce((s, x) => s + x.usd, 0);
    ['2025-02-01', '2025-09-01', '2025-10-01', '2026-01-05'].forEach(day =>
      ok(Math.abs(bal(day)) < 300, `יתרת הדולרים ב-${day} קרובה לאפס — קיבלתי ${Math.round(bal(day))}`));
    /* היום שחשף את הבאג: דר, 2.6.2026 — משיכה + המרה באותו יום */
    const dar = ilsCashByDay(rows).filter(x => x.port === 'איביאי-דר');
    const d0206 = dar.find(x => x.t === Date.parse('2026-06-02'));
    eq(d0206 && d0206.ils, 10633.11, 'דר 2.6.2026: יתרת סוף היום היא זו שאחרי ההמרה');
    const shuffled = [...rows].reverse();
    eq(JSON.stringify(ilsCashByDay(shuffled)), JSON.stringify(ilsCashByDay(rows)), 'סדר שורות הפוך — אותן יתרות בדיוק');
    ok(bal('2026-05-21') > 50000, 'במאי 2026 יש עשרות אלפי דולרים במזומן שהגרף לא ספר');
  }
}
