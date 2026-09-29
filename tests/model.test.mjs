/* מודל התנועה והמיגרציה. נתוני דוגמה סינתטיים שמכסים את כל סוגי
   התנועה בגיליון — כולל מלכודת "הסכום ב-Qty" של מגן המס. */
import { section, ok, eq, info } from './lib.mjs';
import { fromSheetRow, toEngineRow, toIsoDay, toNum } from '../js/engines/model.js';
import { analyzeTransactions, analyzeFx, REQUIRED, comparePositions } from '../js/engines/migration.js';
import { parseCsv } from '../js/ingest/csv.js';
import { makeFxSeries, FxMissing, yearDocsFromSeries, seriesFromYearDocs } from '../js/engines/fx.js';

section('CSV');
{
  const r = parseCsv('﻿a,b,c\n1,"x, y","ש""ח"\r\n2,,"שורה\nשנייה"\n');
  eq(r.length, 3, '3 שורות (כולל כותרת), BOM הוסר');
  eq(r[1][1], 'x, y', 'פסיק בתוך מרכאות');
  eq(r[1][2], 'ש"ח', 'מרכאה כפולה → אחת');
  eq(r[2][2], 'שורה\nשנייה', 'שורה חדשה בתוך מרכאות');
}

section('המרות בסיס');
eq(toIsoDay('03/03/2022'), '2022-03-03', 'DD/MM/YYYY');
eq(toIsoDay('1/9/2026'), '2026-09-01', 'בלי אפסים מובילים');
eq(toIsoDay('2026-09-01'), '2026-09-01', 'ISO נשאר');
eq(toIsoDay('לא תאריך'), '', 'לא תאריך → ריק (ולא ניחוש)');
eq(toNum('1,234.50'), 1234.5, 'פסיקי אלפים');
eq(toNum('-$12.3'), -12.3, 'סמל ומינוס');
eq(toNum(''), 0, 'ריק → 0');

const H = REQUIRED.join(',');
const line = o => REQUIRED.map(k => (o[k] ?? '')).map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',');
const SAMPLE = [
  { Date: '01/03/2022', Type: 'העברה מזומן בשח', Name: 'העברה', Qty: 0, TotalILS: 50000, CashBalanceILS: 50000, Portfolio: 'איביאי-יועד' },
  { Date: '02/03/2022', Type: 'קניה חול מטח', Name: 'QQQ US', Symbol: 'QQQ', Qty: 10, ExecutionRate: 350, Currency: '$', Commission: 2.5, TotalFX: -3500, Portfolio: 'איביאי-יועד' },
  { Date: '02/03/2022', Type: 'קניה חול מטח', Name: 'QQQ US', Symbol: 'QQQ', Qty: 10, ExecutionRate: 350, Currency: '$', Commission: 2.5, TotalFX: -3500, Portfolio: 'איביאי-יועד' },
  { Date: '10/05/2022', Type: 'קניה חול מטח', Name: 'TSLA US', Symbol: 'TSLA', Qty: 3, ExecutionRate: 900, Currency: '$', Commission: 2.5, TotalFX: -2700, Portfolio: 'איביאי-דר' },
  { Date: '25/08/2022', Type: 'הטבה', Name: 'TSLA US', Symbol: 'TSLA', Qty: 6, ExecutionRate: 0, Portfolio: 'איביאי-דר' },
  { Date: '01/12/2022', Type: 'מכירה חול מטח', Name: 'QQQ US', Symbol: 'QQQ', Qty: -5, ExecutionRate: 280, Currency: '$', Commission: 2.5, TotalFX: 1400, Portfolio: 'איביאי-יועד' },
  { Date: '02/12/2022', Type: 'הפקדה', Name: 'מגן מס', Symbol: '9993983', Qty: 1200, Portfolio: 'איביאי-יועד' },
  { Date: '03/12/2022', Type: 'משיכה', Name: 'מס לשלם', Symbol: '9993983', Qty: 800, Portfolio: 'איביאי-יועד' },
  { Date: '15/12/2022', Type: 'הפקדה דיבידנד מטח', Name: 'דיב/ QQQ US', Symbol: 'QQQ', TotalFX: 12.5, Portfolio: 'איביאי-יועד' },
  { Date: '15/12/2022', Type: 'משיכת מס חול מטח', Name: 'מסח/ QQQ US', Symbol: 'QQQ', TotalFX: -3.13, Portfolio: 'איביאי-יועד' },
  { Date: '20/12/2022', Type: 'קניה שח', Name: 'המרה', Symbol: '99028', Qty: 1000, ExecutionRate: 3.5, Portfolio: 'איביאי-יועד' },
];
const CSV = [H, ...SAMPLE.map(line)].join('\n');

section('מודל — הלוך-חזור');
{
  const { doc } = fromSheetRow({ ...SAMPLE[6], _row: 8 });
  eq(doc.qty, 0, 'מגן מס: qty = 0 (כמות היא כמות ניירות, תמיד)');
  eq(doc.amountIls, 1200, 'מגן מס: הסכום עבר ל-amountIls');
  eq(toEngineRow(doc).Qty, 1200, 'ובחזרה למנוע — ב-Qty, כמו שהמנוע מכיר');
  eq(doc.date, '2022-12-02', 'תאריך ISO');
  eq(doc.source.sheetRow, 8, 'המקור מתועד: שורה 8 בגיליון');
  const { problems } = fromSheetRow({ Date: '', Type: '', Portfolio: '' });
  eq(problems.length, 3, 'שורה בלי תאריך/סוג/תיק → 3 בעיות, לא ניחוש');
}

section('מיגרציה — ארבע הבדיקות');
{
  const a = analyzeTransactions(CSV);
  a.checks.forEach(c => info(`${c.pass ? '✓' : '✗'} ${c.text}`));
  ok(a.checks.every(c => c.pass), 'כל הבדיקות ירוקות על נתונים תקינים');
  eq(a.total, SAMPLE.length, 'כל השורות נספרו');
  const qqq = a.positions.find(p => p.symbol === 'QQQ');
  eq(qqq.qty, 15, 'QQQ: 20 נקנו, 5 נמכרו');
  const tsla = a.positions.find(p => p.symbol === 'TSLA');
  eq(tsla.qty, 9, 'TSLA: פיצול 1:3 אחרי 3 יחידות');
  eq(tsla.portfolio, 'איביאי-דר', 'TSLA בתיק הנכון');
  eq(a.unclassified.length, 0, 'אין תנועה לא מסווגת');
  const occ = a.items.filter(x => x.occ === 2);
  eq(occ.length, 1, 'שתי קניות זהות באותו יום = שני מופעים, לא כפילות');

  /* בדיקה שיודעת להגיד לא */
  const good = a.ok.map(p => toEngineRow(p.doc));
  const tampered = good.map(r => r.Symbol === 'QQQ' && r.Type === 'מכירה חול מטח' ? { ...r, Qty: -6 } : r);
  eq(comparePositions(good, tampered).diff.length, 1, 'יחידה אחת שונה במכירה → בדיקת המנוע מזהה פער');
  const noCol = analyzeTransactions(CSV.replace('Portfolio', 'Portfolyo'));
  ok(!noCol.checks[0].pass, 'עמודה חסרה → בדיקת המבנה נכשלת');
  const badRow = analyzeTransactions(CSV + '\n' + line({ Date: '32/13/20', Type: 'קניה חול מטח', Portfolio: 'x' }));
  ok(!badRow.checks.find(c => c.id === 'rows').pass, 'שורה עם תאריך שבור → בדיקת השורות נכשלת');
  eq(badRow.bad.length, 1, 'והשורה הבעייתית מוצגת');
}

section('שערים');
{
  const fx = analyzeFx('Date,Rate\n01/01/2022,3.11\n02/01/2022,3.12\n05/01/2022,3.15\n');
  ok(fx.checks.every(c => c.pass), 'CSV שערים תקין');
  eq(fx.series.length, 3, '3 שערים');
  const sheet = analyzeFx('TODAY,USD-ILS\n30/09/2026,3.06706\n,\nDate,Close\n01/01/2022 23:58:00,3.11333\n29/09/2026 23:58:00,3.06706\n');
  ok(sheet.checks.every(c => c.pass), 'מבנה הטאב USD_ILS (שער "עכשיו" ואז Date,Close) נקרא');
  eq(sheet.series.length, 2, 'שער "עכשיו" לא נכנס להיסטוריה');
  eq(sheet.last, '2026-09-29', 'ההיסטוריה נגמרת בסגירה האחרונה');
  const bad = analyzeFx('Date,Rate\n01/01/2022,0.32\n');
  ok(!bad.checks.every(c => c.pass), 'שער הפוך (0.32) נדחה');

  const s = makeFxSeries(fx.series);
  eq(s.rateOn('2022-01-02'), 3.12, 'שער ביום עצמו');
  eq(s.rateOn('2022-01-04'), 3.12, 'יום בלי שער → האחרון שלפניו');
  let threw = null; try { s.rateOn('2021-12-01'); } catch (e) { threw = e; }
  ok(threw instanceof FxMissing, 'לפני תחילת הסדרה → שגיאה גלויה, לא נפילה לשער היום');
  threw = null; try { s.rateOn('2022-02-01'); } catch (e) { threw = e; }
  ok(threw instanceof FxMissing, 'חור של יותר משבוע → שגיאה גלויה');
  const docs = yearDocsFromSeries(fx.series);
  eq(docs.length, 1, 'מסמך אחד לשנה');
  eq(seriesFromYearDocs(docs).length, 3, 'הלוך-חזור מסמכי שנה');
}
