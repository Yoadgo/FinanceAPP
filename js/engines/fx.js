/* ================================================================
   FX — שער דולר–שקל לפי יום. הכלל כתוב כאן, ורק כאן:

   1. המרה היסטורית תמיד לפי שער היום של העסקה. (הבאג של הגרסה
      הקודמת — המרה לפי שער היום — עיוות את ההון שהושקע ב-16.4%.)
   2. יום בלי שער (סוף שבוע, חג) מקבל את השער האחרון שלפניו,
      עד MAX_GAP ימים אחורה.
   3. שער שלא נמצא בכלל הוא שגיאה גלויה — לא נפילה שקטה לשער היום.

   אחסון ב-Firestore: market/fx_{year} = { year, rates: { 'MM-DD': rate } }
   שנה למסמך: כל ההיסטוריה מ-2022 נקראת בחמש קריאות במקום 1,606.
   ================================================================ */
export const MAX_GAP = 7;   // ימים. חג ארוך + סוף שבוע = 5. מעבר לזה — חור בנתונים.

export class FxMissing extends Error {
  constructor(date) { super(`אין שער דולר–שקל ל-${date} ולא ב-${MAX_GAP} הימים שלפניו`); this.date = date; this.code = 'fx-missing'; }
}

const DAY = 86400000;
const dayNum = iso => Math.floor(Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') / DAY);

/* series: [{ date: 'YYYY-MM-DD', rate }] — בכל סדר. */
export function makeFxSeries(series) {
  const clean = (series || [])
    .filter(x => x && x.date && isFinite(x.rate) && x.rate > 0)
    .map(x => ({ d: dayNum(x.date), r: Number(x.rate), date: String(x.date).slice(0, 10) }))
    .sort((a, b) => a.d - b.d);
  const d = clean.map(x => x.d), r = clean.map(x => x.r);

  /* השער ביום date, או FxMissing. */
  function rateOn(date) {
    const t = dayNum(date);
    let lo = 0, hi = d.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (d[mid] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    if (best < 0 || t - d[best] > MAX_GAP) throw new FxMissing(String(date).slice(0, 10));
    return r[best];
  }

  /* הצורה שמנוע ה-FIFO מצפה לה בפרמטר fxSeries (ימים מאז 1970 + שערים). */
  const engineSeries = { d, r };
  const first = clean.length ? clean[0].date : null;
  const last = clean.length ? clean[clean.length - 1].date : null;
  return { rateOn, engineSeries, first, last, size: clean.length };
}

/* מסמכי שנה → סדרה. */
export function seriesFromYearDocs(docs) {
  const out = [];
  (docs || []).forEach(doc => {
    Object.entries(doc.rates || {}).forEach(([mmdd, rate]) => out.push({ date: `${doc.year}-${mmdd}`, rate }));
  });
  return out;
}

/* סדרה → מסמכי שנה (למיגרציה). */
export function yearDocsFromSeries(series) {
  const by = {};
  (series || []).forEach(({ date, rate }) => {
    const y = String(date).slice(0, 4), k = String(date).slice(5, 10);
    (by[y] = by[y] || { year: Number(y), rates: {} }).rates[k] = Number(rate);
  });
  return Object.values(by).sort((a, b) => a.year - b.year);
}
