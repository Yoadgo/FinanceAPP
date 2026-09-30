/* ================================================================
   CLOSES — שמירת סגירה יומית בעצמנו. טהור.

   הרקע (30.9.2026): היסטוריית GOOGLEFINANCE לא נחשפת בפרסום, ולכן
   ההיסטוריה עד 29.9.2026 הועתקה פעם אחת כערכים (config: HISTORY_URL).
   מכאן והלאה, בכל פעם שהאפליקציה מושכת את שורות המחיר (שכן עובדות),
   היא רושמת סגירה אחת לכל נייר — פעם ביום לכל היותר.

   איזו סגירה אפשר לדעת, לפי השעה בניו יורק:
     אחרי 16:00 (post, או לילה אחרי 20:00) → הסגירה של היום = המחיר
     לפני הפתיחה (pre, או לילה לפני 4:00) → הסגירה של יום המסחר הקודם = המחיר
     בזמן המסחר (open) → הסגירה של יום המסחר הקודם = מחיר ÷ (1 + שינוי%)
     סוף שבוע → הסגירה של יום שישי = המחיר
   הגבלות שנאמרות בקול: חגים אמריקאיים לא מוכרים (בחג תירשם סגירה זהה
   לקודמת — קו שטוח, לא טעות בכיוון). יום שבו אף אחד לא פתח את
   האפליקציה נשאר חור, והסדרה משתמשת בסגירה הקודמת לו.
   סגירה שכבר קיימת לא נדרסת לעולם — ההיסטוריה המקורית מנצחת.
   ================================================================ */
import { nyParts, usSession } from './marketHours.js';

const NY = 'America/New_York';
let FMT = null;
export function nyDate(d = new Date()) {
  if (!FMT) FMT = new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' });
  return FMT.format(d);
}

const DAY = 86400000;
const dow = iso => new Date(`${iso}T12:00:00Z`).getUTCDay();
const shift = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export function prevWeekday(iso) { let d = shift(iso, -1); while (dow(d) === 0 || dow(d) === 6) d = shift(d, -1); return d; }
export function lastWeekdayOnOrBefore(iso) { let d = iso; while (dow(d) === 0 || dow(d) === 6) d = shift(d, -1); return d; }

/* לאיזה יום שייכת הסגירה שאפשר לדעת עכשיו, ואיך מחשבים אותה. */
export function closeTarget(now = new Date()) {
  const s = usSession(now), today = nyDate(now), { dow: d, minutes } = nyParts(now);
  if (s === 'post') return { date: today, mode: 'price' };
  if (s === 'open') return { date: prevWeekday(today), mode: 'derive' };
  if (s === 'pre') return { date: prevWeekday(today), mode: 'price' };
  if (d === 0 || d === 6) return { date: lastWeekdayOnOrBefore(today), mode: 'price' };
  return minutes < 240 ? { date: prevWeekday(today), mode: 'price' } : { date: today, mode: 'price' };
}

const r4 = x => Math.round(x * 10000) / 10000;

/* prices = market/latest.prices ({ SYM: { price, changePct } }) → [{ sym, date, close }] */
export function closesFrom(prices, target) {
  const out = [];
  Object.entries(prices || {}).forEach(([sym, p]) => {
    if (!p || !(p.price > 0)) return;
    let close = p.price;
    if (target.mode === 'derive') {
      if (!Number.isFinite(p.changePct) || p.changePct <= -100) return;
      close = p.price / (1 + p.changePct / 100);
    }
    out.push({ sym, date: target.date, close: r4(close) });
  });
  return out;
}

/* מיזוג לתוך מסמכי px_{SYM}_{YEAR}. existing = { id: doc }. מחזיר רק
   מסמכים שהשתנו, כמו שייכתבו (המסמך כולו). */
export function mergeCloses(existing, closes) {
  const changed = {};
  closes.forEach(({ sym, date, close }) => {
    const year = Number(date.slice(0, 4)), id = `px_${sym}_${year}`, mmdd = date.slice(5, 10);
    const doc = changed[id] || (existing[id] ? { ...existing[id], closes: { ...(existing[id].closes || {}) } } : { symbol: sym, year, closes: {} });
    if (doc.closes[mmdd] !== undefined) return;            // לא דורסים
    doc.closes[mmdd] = close;
    changed[id] = doc;
  });
  return Object.entries(changed).map(([id, data]) => ({ id, data }));
}

/* היסטוריה מהגיליון + סגירות שנרשמו כאן. הגיליון מנצח בתאריכים שלו,
   וסגירות שנרשמו אחרי הצילום נשמרות. */
export function mergeHistoryDocs(existing, fresh) {
  return fresh.map(({ id, data }) => {
    const old = existing[id];
    return { id, data: old ? { ...data, closes: { ...(old.closes || {}), ...data.closes } } : data };
  });
}
