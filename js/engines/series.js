/* ================================================================
   SERIES — סדרות זמן לגרפים. טהור, נבדק ב-node.

   שלוש סדרות בגרף הראשי של עולם ההשקעות (אפיון, "ביצועים מול מדד"):
     1. שווי התיק   — שווי שוק של האחזקות + מזומן בתיק, לפי יום.
     2. ההון שהושקע — סכום ההפקדות, כל אחת בשער הדולר של היום שלה.
     3. אותו כסף במדד — אותן הפקדות, באותם ימים, כאילו נקנה בהן IVV.
   הפער בין 1 ל-3 הוא התשובה לשאלה "האם הבחירות שלי הכו את המדד".

   מחירים ב-Firestore: market/px_{SYM}_{YEAR} = { symbol, year, closes: { 'MM-DD': close } }
   ================================================================ */
import { PortfolioEngine } from './fifo.js';

const DAY = 86400000;

/* מסמכי מחיר → { SYM: [{ date, close }] } ממוין. */
export function historyFromDocs(docs) {
  const out = {};
  (docs || []).forEach(d => {
    if (!d || !d.symbol || !d.closes) return;
    const sym = String(d.symbol).toUpperCase();
    Object.entries(d.closes).forEach(([mmdd, c]) => {
      if (isFinite(c) && c > 0) (out[sym] = out[sym] || []).push({ date: `${d.year}-${mmdd}`, close: Number(c) });
    });
  });
  Object.values(out).forEach(a => a.sort((x, y) => (x.date < y.date ? -1 : 1)));
  return out;
}

/* סדרה ← מסמכי שנה (לכתיבה אחרי משיכה מגיליון המחירים). */
export function docsFromHistory(symbol, rows) {
  const by = {};
  (rows || []).forEach(([date, close]) => {
    const y = String(date).slice(0, 4);
    (by[y] = by[y] || { symbol: String(symbol).toUpperCase(), year: Number(y), closes: {} }).closes[String(date).slice(5, 10)] = Number(close);
  });
  return Object.values(by).map(d => ({ id: `px_${d.symbol}_${d.year}`, data: d }));
}

/* הסגירה האחרונה ביום date או לפניו. */
export function closeAt(rows, date) {
  let lo = 0, hi = rows.length - 1, best = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid].date <= date) { best = rows[mid].close; lo = mid + 1; } else hi = mid - 1; }
  return best;
}

const isoDay = t => new Date(t).toISOString().slice(0, 10);

/* הפקדות בדולר, כל אחת בשער של היום שלה. rows = שורות מנוע מסווגות. */
export function depositsUsd(rows, fx) {
  const out = [];
  rows.forEach(r => {
    if (r.subCategory !== 'DEPOSIT') return;
    const ils = parseFloat(String(r.TotalILS).replace(/[^\d.-]/g, '')) || 0;
    if (!ils) return;
    const date = String(r.Date).slice(0, 10);
    out.push({ date, usd: ils / fx.rateOn(date) });      // FxMissing אם אין שער — לא מנחשים
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/* "אותו כסף במדד": כל הפקדה קונה יחידות של המדד בסגירה של אותו יום. */
export function benchmarkSeries(deposits, benchRows, days) {
  let units = 0, di = 0;
  const out = [];
  days.forEach(date => {
    while (di < deposits.length && deposits[di].date <= date) {
      const px = closeAt(benchRows, deposits[di].date);
      if (px) units += deposits[di].usd / px;
      di++;
    }
    const px = closeAt(benchRows, date);
    if (px && units > 0) out.push({ time: date, value: units * px });
  });
  return out;
}

/* שלוש הסדרות, לפי יום. */
export function investSeries(rows, historyMap, fx, bench = 'IVV') {
  const pts = PortfolioEngine.computeEquityCurve(rows, historyMap, fx.rateOn(fx.last), 'day', fx.engineSeries);
  const byDay = new Map();
  pts.forEach(p => byDay.set(isoDay(p.t + 12 * 3600000), p));         // חצות מקומית → אותו יום
  const days = [...byDay.keys()].sort();
  const value = [], invested = [];
  days.forEach(d => {
    const p = byDay.get(d);
    value.push({ time: d, value: p.marketValue + p.cash });
    invested.push({ time: d, value: p.invested });
  });
  const benchRows = historyMap[bench] || [];
  const benchmark = benchRows.length ? benchmarkSeries(depositsUsd(rows, fx), benchRows, days) : [];
  return { value, invested, benchmark, days };
}

/* 90 הסגירות האחרונות — לספארקליין. */
export function lastCloses(rows, n = 90) {
  return (rows || []).slice(-n).map(r => r.close);
}

export { DAY };
