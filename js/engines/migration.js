/* ================================================================
   MIGRATION — מעבר חד-פעמי מגיליון StocksData ל-Firestore (שלב 2).

   הזרימה: CSV → ניתוח → בדיקות → (יועד מאשר) → כתיבה.
   שום דבר לא נכתב לפני שכל הבדיקות כאן ירוקות, ובדיקה שנכשלת
   עוצרת את הכתיבה. זה מימוש של "בדיקה שיכולה להגיד לא".

   ארבע בדיקות:
   1. מבנה   — כל העמודות הנדרשות קיימות.
   2. שורות  — כל שורה מפוענחת; שורה עם בעיה מוצגת ולא נכתבת.
   3. הלוך-חזור — שורת גיליון → מסמך → שורת מנוע נותנת את אותם ערכים
                 בשדות שהמנועים קוראים.
   4. מנוע   — PortfolioEngine על השורות המקוריות ועל המסמכים נותן
                 אותן פוזיציות בדיוק (כמות ועלות, לכל תיק ונייר).
   השער של שלב 2 — השוואה לדוח הברוקר — הוא בדיקה חמישית, ידנית,
   שיועד עושה מול הטבלה שהמסך מציג.
   ================================================================ */
import { parseCsv, toObjects } from '../ingest/csv.js';
import { fromSheetRow, toEngineRow, withTxnOccurrence, toIsoDay, toNum } from './model.js';
import { Classifier } from './classifier.js';
import { PortfolioEngine } from './fifo.js';

export const REQUIRED = ['Date', 'Type', 'Name', 'Symbol', 'Qty', 'ExecutionRate', 'Currency',
  'Commission', 'Fees', 'TotalFX', 'TotalILS', 'CashBalanceILS', 'EstimatedTax', 'Portfolio'];

/* השדות שהמנועים קוראים בפועל — עליהם נבדק ההלוך-חזור. */
const ENGINE_FIELDS = ['Date', 'Type', 'Name', 'Symbol', 'Qty', 'ExecutionRate', 'TotalFX', 'TotalILS', 'CashBalanceILS', 'Portfolio', 'Commission'];

function sameField(k, a, b) {
  if (k === 'Date') return toIsoDay(a) === toIsoDay(b);
  if (k === 'Symbol') return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
  if (['Type', 'Name', 'Portfolio'].includes(k)) return String(a || '').trim() === String(b || '').trim();
  return Math.abs(toNum(a) - toNum(b)) < 1e-9;
}

function positionsKeyed(engineRows) {
  const enriched = Classifier.enrichAll(engineRows);
  const pos = PortfolioEngine.computePositions(enriched);
  const out = {};
  pos.forEach(p => { out[`${p.portfolio}|${p.symbol}`] = { qty: p.qty, cost: p.totalCost, portfolio: p.portfolio, symbol: p.symbol, lots: p.lots.length }; });
  return { map: out, list: pos, enriched };
}

/* שתי קבוצות שורות → אותן פוזיציות? diff ריק = כן. */
export function comparePositions(rowsA, rowsB) {
  const a = positionsKeyed(rowsA), b = positionsKeyed(rowsB);
  const keys = new Set([...Object.keys(a.map), ...Object.keys(b.map)]);
  const diff = [];
  keys.forEach(k => {
    const x = a.map[k], y = b.map[k];
    if (!x || !y || Math.abs(x.qty - y.qty) > 1e-6 || Math.abs(x.cost - y.cost) > 1e-6) diff.push({ key: k, sheet: x || null, docs: y || null });
  });
  return { diff, a, b };
}

export function analyzeTransactions(csvText) {
  const { headers, objects } = toObjects(parseCsv(csvText));
  const missing = REQUIRED.filter(h => !headers.includes(h));
  const result = { headers, missing, total: objects.length, ok: [], bad: [], checks: [], byPortfolio: {}, positions: [], unclassified: [] };
  if (missing.length) {
    result.checks.push({ id: 'structure', pass: false, text: `חסרות עמודות: ${missing.join(', ')}` });
    return result;
  }
  result.checks.push({ id: 'structure', pass: true, text: `כל ${REQUIRED.length} העמודות הנדרשות קיימות` });

  /* 2. שורות */
  const parsed = objects.map(o => ({ src: o, ...fromSheetRow(o) }));
  parsed.forEach(p => (p.problems.length ? result.bad : result.ok).push(p));
  result.checks.push({
    id: 'rows', pass: result.bad.length === 0,
    text: result.bad.length ? `${result.bad.length} שורות עם בעיה — לא ייכתבו עד שיתוקנו בגיליון` : `כל ${objects.length} השורות פוענחו`,
  });

  /* 3. הלוך-חזור */
  const mismatches = [];
  result.ok.forEach(p => {
    const back = toEngineRow(p.doc);
    ENGINE_FIELDS.forEach(k => { if (!sameField(k, p.src[k], back[k])) mismatches.push({ row: p.src._row, field: k, sheet: p.src[k], doc: back[k] }); });
  });
  result.mismatches = mismatches;
  result.checks.push({
    id: 'roundtrip', pass: mismatches.length === 0,
    text: mismatches.length ? `${mismatches.length} שדות שונים בין הגיליון למסמך` : 'שורה ← מסמך ← שורת מנוע: זהה בכל השדות שהמנועים קוראים',
  });

  /* 4. מנוע: אותן פוזיציות משני המסלולים.
     המסלול "גיליון" מקבל את השורות כפי ש-v3 קיבל אותן מה-API: תאריך ISO.
     (תאריך 'DD/MM/YYYY' גולמי נקרא ב-JavaScript כחודש/יום — 01/12 הופך
     ל-12 בינואר — וזה בדיוק סוג הבאג שהבדיקה הזו אמורה לתפוס, לא לייצר.) */
  const sheetRows = result.ok.map(p => ({ ...p.src, Date: toIsoDay(p.src.Date) }));
  const { diff: posDiff, b: fromDocs } = comparePositions(sheetRows, result.ok.map(p => toEngineRow(p.doc)));
  result.positionDiff = posDiff;
  result.checks.push({
    id: 'engine', pass: posDiff.length === 0,
    text: posDiff.length ? `${posDiff.length} פוזיציות שונות בין המסלולים` : `מנוע ה-FIFO נותן ${fromDocs.list.length} פוזיציות זהות משני המסלולים`,
  });
  result.positions = fromDocs.list.sort((a, b) => a.portfolio.localeCompare(b.portfolio) || a.symbol.localeCompare(b.symbol));
  result.unclassified = fromDocs.enriched.filter(r => r.category === 'UNCLASSIFIED');

  /* סיכום לפי תיק — לבדיקה מול הגיליון הישן */
  result.ok.forEach(p => {
    const k = p.doc.portfolio;
    const b = result.byPortfolio[k] = result.byPortfolio[k] || { rows: 0, first: p.doc.date, last: p.doc.date, commission: 0 };
    b.rows++; b.commission += p.doc.commission;
    if (p.doc.date < b.first) b.first = p.doc.date;
    if (p.doc.date > b.last) b.last = p.doc.date;
  });

  /* מזהים דטרמיניסטיים: מפתח + מופע. */
  result.items = withTxnOccurrence(result.ok.map(p => p.doc));
  return result;
}

/* CSV של שערים: עמודה ראשונה תאריך, השנייה שער. כותרות לא מחייבות.
   הטאב USD_ILS בגיליון (נבדק 30.9.2026) בנוי כך:
     TODAY,USD-ILS           ← כותרת של שער "עכשיו"
     30/09/2026,3.06706      ← השער העדכני — לא סגירה, לא נכנס להיסטוריה
     (שורה ריקה)
     Date,Close              ← מכאן ההיסטוריה
     01/01/2022 23:58:00,3.11333
   לכן: אם יש שורת כותרת 'Date' — מתחילים אחריה. אחרת (קובץ פשוט)
   מדלגים רק על שורת הכותרת הראשונה.                                 */
export function analyzeFx(csvText) {
  const all = parseCsv(csvText);
  const hdr = all.findIndex(r => String(r[0] || '').trim().toLowerCase() === 'date');
  const rows = hdr > 0 ? all.slice(hdr) : all;
  const series = [], bad = [];
  rows.forEach((r, i) => {
    const date = toIsoDay(r[0]);
    const rate = toNum(r[1]);
    if (!date) { if (i > 0) bad.push({ row: i + 1, value: r.join(',') }); return; }    // שורת כותרת מדולגת
    if (!(rate > 1 && rate < 10)) { bad.push({ row: i + 1, value: r.join(',') }); return; }
    series.push({ date, rate });
  });
  series.sort((a, b) => a.date.localeCompare(b.date));
  const dup = series.filter((x, i) => i && x.date === series[i - 1].date);
  const min = series.reduce((m, x) => Math.min(m, x.rate), Infinity);
  const max = series.reduce((m, x) => Math.max(m, x.rate), -Infinity);
  return {
    series, bad, dup,
    first: series[0] && series[0].date, last: series.length ? series[series.length - 1].date : null, min, max,
    checks: [
      { id: 'fx-rows', pass: series.length > 0 && bad.length === 0, text: bad.length ? `${bad.length} שורות לא תקינות` : `${series.length} שערים יומיים` },
      { id: 'fx-dup', pass: dup.length === 0, text: dup.length ? `${dup.length} תאריכים כפולים` : 'אין תאריך כפול' },
      /* טווח סביר: הנתונים הידועים נעים 2.80–4.08. שער מחוץ ל-2.5–5 הוא כמעט
         בוודאות עמודה שגויה (למשל שער הפוך, ILS→USD). */
      { id: 'fx-range', pass: min > 2.5 && max < 5, text: `טווח ${isFinite(min) ? min.toFixed(4) : '—'}–${isFinite(max) ? max.toFixed(4) : '—'}` },
    ],
  };
}
