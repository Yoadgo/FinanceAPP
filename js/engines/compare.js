/* ================================================================
   COMPARE — השוואה לטיקר על גרפים, ופירוק "ממה מורכב השינוי". טהור.
   (יועד, 2.10.2026: "האם הנפילה של יוני קשורה לנפילה של טסלה, או
   שזה בכלל משיכת כסף?")

   שלוש תשובות אפשריות לירידה בשווי התיק, וכל אחת נמדדת אחרת:
     1. כסף יצא (משיכה)       — flows: ההפקדות/משיכות בטווח, בשער של יומן.
     2. נייר מסוים ירד         — bySym: התרומה של כל נייר (מ-dailyPnl).
     3. כל השוק ירד            — marketPct: תשואת המדד באותו טווח.
   והבדיקה שיכולה להגיד "לא": residual = השינוי בשווי − כסף שנכנס/יצא
   − הרווח. אם הוא גדול, החישובים לא מתיישבים — ואומרים את זה במסך.
   מקורות ידועים לשארית קטנה: תנועת הדולר על מזומן שקלי שיושב בתיק
   (השווי בדולרים), והפרש בין שער ההמרה בפועל לשער היומי.

   קו השוואה על גרף — שני מצבים (יועד בחר מתג):
     · תזמון  — rebasePct: אחוז השינוי מתחילת הטווח, על ציר משלו.
                עונה על "האם ירדו באותם ימים".
     · מי ניצח — benchmarkSeries מ-series.js: אותו כסף בנייר, בדולרים.
   ================================================================ */
import { closeAt } from './series.js';

export const MAX_COMPARE = 3;

/* הסגירה האחרונה לפני date (לא כולל) — הבסיס של תשואה שמתחילה ב-date. */
export function closeBefore(rows, date) {
  let lo = 0, hi = (rows || []).length - 1, best = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid].date < date) { best = rows[mid].close; lo = mid + 1; } else hi = mid - 1; }
  return best;
}

/* ניירות שאפשר להשוות אליהם: יש להם היסטוריה אמיתית (לא סגירה יומית בודדת). */
export function compareSymbols(history, { min = 200, exclude = [] } = {}) {
  const ex = new Set(exclude.map(s => String(s).toUpperCase()));
  return Object.keys(history || {}).filter(s => s !== 'USDILS' && !ex.has(s) && (history[s] || []).length >= min).sort();
}

/* אחוז שינוי מתחילת הטווח. הבסיס: הסגירה שלפני from; אם אין — הסגירה
   הראשונה בטווח (ואז הנקודה הראשונה היא 0%). */
export function rebasePct(closes, from = '0000', to = '9999') {
  const inR = (closes || []).filter(c => c.date >= from && c.date <= to && c.close > 0);
  if (!inR.length) return [];
  const base = closeBefore(closes, from) || inR[0].close;
  return inR.map(c => ({ time: c.date, value: (c.close / base - 1) * 100 }));
}

/* תשואת נייר בטווח [from, to] — אותו בסיס כמו rebasePct. null אם אין נתונים. */
export function rangeReturn(closes, from, to) {
  const end = closeAt(closes || [], to);
  const first = (closes || []).find(c => c.date >= from && c.date <= to);
  if (!end || !first) return null;
  const base = closeBefore(closes, from) || first.close;
  return end / base - 1;
}

/* תשואת הנייר בכל תקופה של "רווח לפי תקופה" — לצד התשואה שלך.
   periods: [{ from, to }] (מ-aggregate). מחזיר [{ time: from, value: % }]. */
export function periodReturns(closes, periods) {
  const out = [];
  (periods || []).forEach(p => {
    const r = rangeReturn(closes, p.from, p.to);
    if (r !== null) out.push({ time: p.from, value: r * 100 });
  });
  return out;
}

/* הפקדות ומשיכות לפי יום (לחצים על הגרף). deposits מ-depositsUsd. */
export function flowEvents(deposits, from = '0000', to = '9999', { min = 1 } = {}) {
  const by = new Map();
  (deposits || []).forEach(d => { if (d.date >= from && d.date <= to) by.set(d.date, (by.get(d.date) || 0) + d.usd); });
  return [...by.entries()].filter(([, v]) => Math.abs(v) >= min).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, usd]) => ({ date, usd }));
}

/* ממה מורכב השינוי בשווי התיק בטווח [from, to].
   value    — S.value מ-investSeries ([{ time, value }], דולר, כולל מזומן).
   deposits — depositsUsd(rows, fx).
   days     — dailyPnl(...).days.
   השווי בנקודה d כולל את כל התנועות של d, לכן הכול נמדד ב-(start, end]. */
export function decompose({ value, deposits, days }, { from = '0000', to = '9999' } = {}) {
  const startPt = [...(value || [])].reverse().find(p => p.time < from) || null;
  const inR = (value || []).filter(p => p.time >= from && p.time <= to);
  const endPt = inR[inR.length - 1];
  if (!endPt) return null;
  const a = startPt ? startPt.time : '0000', b = endPt.time;
  const startValue = startPt ? startPt.value : 0;
  const change = endPt.value - startValue;

  let flowsIn = 0, flowsOut = 0;
  (deposits || []).forEach(d => { if (d.date > a && d.date <= b) { if (d.usd >= 0) flowsIn += d.usd; else flowsOut += d.usd; } });
  const flows = flowsIn + flowsOut;

  let gain = 0, other = 0, gainDays = 0, fallbackDays = 0, missing = 0;
  const bySym = {};
  (days || []).forEach(d => {
    if (!(d.date > a && d.date <= b)) return;
    gainDays++;
    if (d.fallback) fallbackDays++;
    if (d.pnlUsd === null || !isFinite(d.pnlUsd)) { missing++; return; }
    gain += d.pnlUsd;
    other += d.otherUsd || 0;
    Object.entries(d.contrib || {}).forEach(([s, c]) => { bySym[s] = (bySym[s] || 0) + c; });
  });
  const sym = Object.entries(bySym).map(([symbol, usd]) => ({ symbol, usd })).sort((x, y) => Math.abs(y.usd) - Math.abs(x.usd));
  const residual = change - flows - gain;
  /* "מתיישב": שארית קטנה מ-1% מהשווי (או $50). מעבר לזה — מציגים אזהרה. */
  const tol = Math.max(50, 0.01 * Math.max(Math.abs(startValue), Math.abs(endPt.value)));
  return {
    from: startPt ? inR[0].time : (value[0] && value[0].time), to: b, startDate: a === '0000' ? null : a,
    startValue, endValue: endPt.value, change, flows, flowsIn, flowsOut, gain, other, bySym: sym,
    residual, reconciled: Math.abs(residual) <= tol, tolerance: tol, gainDays, fallbackDays, missing,
  };
}
