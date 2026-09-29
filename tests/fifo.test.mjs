/* מנוע ה-FIFO: (א) זהה בית-לבית לגרסה שאומתה מול דוח הברוקר,
   (ב) מתנהג נכון בשלוש המלכודות המתועדות בו. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { section, ok, eq, info } from './lib.mjs';
import { PortfolioEngine as E } from '../js/engines/fifo.js';
import { Classifier as C } from '../js/engines/classifier.js';

section('מנועים — זהות לגרסה המאומתת (v3, קומיט 1c764fd)');
/* טביעת SHA-256 של הקבצים המקוריים. כל קובץ מוסב, אחרי הסרת כותרת ההסבה
   ושורת ה-export, חייב לחזור בדיוק לקובץ המקורי. שינוי של תו אחד במנוע
   המאומת — והבדיקה נכשלת. */
const ORIGINAL = {
  'fifo.js':         ['2fa1eadd904c74d59e575e8bc684c5fce578663a62265009f4ca6a78a85e9991', s => s.replace(/^\/\*[\s\S]*?\*\/\n/, '').replace('export const PortfolioEngine = ', 'const PortfolioEngine = ')],
  'classifier.js':   ['32e592143e7019651f8df5bf2c6189e5f74d6efd85d90801b4bca2b4a501728e', s => s.replace(/^\/\*[^\n]*\*\/\n/, '').replace('export const Classifier = ', 'const Classifier = ')],
  'research.js':     ['e6c34472f5721257f681b384ada71c04bc17a791af3419185d491ab753ba780e', s => s.replace(/^\/\*[^\n]*\*\/\n/, '').replace('export const Research = ', 'const Research = ')],
  'creditParser.js': ['7a49a3b3a4f0941f42fec150f58b94f32b8c31cc1dc2e73c7cdfa63aea7542cb', s => s.replace(/^\/\*[\s\S]*?\*\/\n/, '').replace(/\nexport \{[\s\S]*$/, '') + "if (typeof module !== 'undefined') module.exports =\n  { parseCreditSheet_: parseCreditSheet_, parseNote_: parseNote_,\n    fingerprint_: fingerprint_, withOccurrence_: withOccurrence_,\n    diffAgainstExisting_: diffAgainstExisting_ };\n"],
  'bankParser.js':   ['2bfbc70675ca5fe7b7028bc8d9df08d910f1ac3a56d48960f8aa19227b75607a', s => s.replace(/^\/\*[\s\S]*?\*\/\n/, '').replace(/\nexport \{[\s\S]*$/, '') + "if (typeof module !== 'undefined') module.exports = {\n  parseBankSheet_: parseBankSheet_, isBankSheet_: isBankSheet_,\n  bankFingerprint_: bankFingerprint_, withBankOccurrence_: withBankOccurrence_,\n  bankDate_: bankDate_, bankNum_: bankNum_, bankIsoDay_: bankIsoDay_\n};\n"],
};
for (const [file, [want, undo]] of Object.entries(ORIGINAL)) {
  const src = readFileSync(new URL(`../js/engines/${file}`, import.meta.url), 'utf8');
  eq(createHash('sha256').update(undo(src)).digest('hex'), want, `${file} — הלוגיקה זהה בית-לבית למקור`);
}

const row = (Date, Type, Symbol, Qty, ExecutionRate, Portfolio = 'איביאי-יועד', extra = {}) =>
  ({ Date, Type, Name: Symbol, Symbol, Qty, ExecutionRate, TotalFX: Qty * ExecutionRate, TotalILS: 0, Portfolio, ...extra });

section('FIFO — התנהגות');
{
  const t = C.enrichAll([
    row('2024-01-01', 'קניה חול מטח', 'AAA', 10, 100),
    row('2024-02-01', 'קניה חול מטח', 'AAA', 10, 200),
    row('2024-03-01', 'מכירה חול מטח', 'AAA', -15, 300),
  ]);
  const [p] = E.computePositions(t);
  eq(p.qty, 5, 'נשארו 5 יחידות');
  eq(p.totalCost, 1000, 'הנותרות הן מהקנייה השנייה (FIFO): 5 × 200');
  eq(p.realizedPnl, 15 * 300 - (10 * 100 + 5 * 200), 'רווח ממומש לפי הפרוסות הוותיקות');
  const closed = E.computeClosedTrades(t);
  eq(closed.length, 1, 'עסקה סגורה אחת');
  eq(closed[0].cost, 2000, 'עלות הנמכר');
}
{
  // מלכודת 1: אותו נייר בשני תיקים — שתי פוזיציות נפרדות
  const t = C.enrichAll([
    row('2024-01-01', 'קניה חול מטח', 'QQQ', 3, 400, 'איביאי-יועד'),
    row('2024-01-02', 'קניה חול מטח', 'QQQ', 2, 410, 'איביאי-דר'),
  ]);
  const ps = E.computePositions(t);
  eq(ps.length, 2, 'QQQ בשני תיקים = שתי פוזיציות');
  ok(ps.some(p => p.portfolio === 'איביאי-דר' && p.qty === 2), 'התיק של דר שומר על 2 יחידות');
}
{
  // מלכודת 2: פיצול מדוח הברוקר (הטבה עם כמות ומחיר 0) — פעם אחת בלבד
  const t = C.enrichAll([
    row('2022-01-01', 'קניה חול מטח', 'TSLA', 10, 900),
    { Date: '2022-08-25', Type: 'הטבה', Name: 'TSLA', Symbol: 'TSLA', Qty: 20, ExecutionRate: 0, TotalFX: 0, TotalILS: 0, Portfolio: 'איביאי-יועד' },
  ]);
  eq(t[1].subCategory, 'SPLIT', 'הטבה עם סימול, כמות חיובית ומחיר 0 = פיצול');
  const [p] = E.computePositions(t);
  eq(p.qty, 30, 'פיצול 1:3 → 30 יחידות');
  eq(Math.round(p.totalCost), 9000, 'עלות כוללת נשמרת');
  eq(Math.round(p.avgCost * 100) / 100, 300, 'עלות ליחידה יורדת פי 3');
}
{
  // מלכודת 3: מכירה בלי קנייה לא יוצרת פוזיציית רפאים
  const t = C.enrichAll([row('2024-01-01', 'מכירה חול מטח', 'ZZZ', -5, 10)]);
  const orig = console.warn; console.warn = () => {};
  eq(E.computePositions(t).length, 0, 'אין פוזיציה שלילית');
  console.warn = orig;
}
{
  // קנייה ומכירה באותו יום: הקנייה קודם, גם אם המכירה מופיעה ראשונה בגיליון
  const t = C.enrichAll([
    row('2024-05-05', 'מכירה חול מטח', 'BBB', -4, 50),
    row('2024-05-05', 'קניה חול מטח', 'BBB', 10, 40),
  ]);
  const [p] = E.computePositions(t);
  eq(p.qty, 6, 'סדר תוך-יומי: קנייה לפני מכירה');
}
