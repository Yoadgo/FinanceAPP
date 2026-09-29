/* ================================================================
   FORMAT — פורמט כסף, אחוזים ותאריכים. מקום אחד בלבד.
   (בגרסה הקודמת שלושה מסכים כתבו פורמט כסף לעצמם.)

   כללים:
   · null/undefined → מקף. תא ריק אינו אפס.
   · מינוס לפני הסמל והמספר: −₪1,234 (תו מינוס אמיתי U+2212).
   · התוצאה היא טקסט; הרכיב שמציג אותו עוטף ב-.num (מונו, LTR).
   ================================================================ */
const MINUS = '−';

function fmt(n, digits) {
  return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function money(n, { cur = 'ILS', digits, sign = false } = {}) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  const sym = cur === 'USD' ? '$' : '₪';
  const d = digits === undefined ? (Math.abs(n) >= 1000 ? 0 : 2) : digits;
  const rounded = Number(n.toFixed(d));
  const s = rounded < 0 ? MINUS : (sign && rounded > 0 ? '+' : '');
  return `${s}${sym}${fmt(rounded, d)}`;
}
export const ils = (n, o = {}) => money(n, { ...o, cur: 'ILS' });
export const usd = (n, o = {}) => money(n, { ...o, cur: 'USD' });

export function pct(n, { digits = 1, sign = true } = {}) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  const r = Number(n.toFixed(digits));
  const s = r < 0 ? MINUS : (sign && r > 0 ? '+' : '');
  return `${s}${fmt(r, digits)}%`;
}

export function qty(n, digits = 4) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  const r = Number(n.toFixed(digits));
  return (r < 0 ? MINUS : '') + Math.abs(r).toLocaleString('en-US', { maximumFractionDigits: digits });
}

/* תאריך 'YYYY-MM-DD' → '29.09.2026'. במודל החדש כל תאריך נשמר כמחרוזת
   יום — בלי אזור זמן, בלי מלכודת "חצות UTC = היום הקודם בישראל". */
export function day(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso);
}

/* גיל נתון בימים, לסימון "ישן" (חוק UX 3: מעל חודש = צהוב). */
export function ageDays(iso, today = todayIso()) {
  if (!iso) return null;
  return Math.round((Date.parse(today) - Date.parse(String(iso).slice(0, 10))) / 86400000);
}

/* היום הנוכחי בישראל, כ-'YYYY-MM-DD'. */
export function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

/* כיוון הכסף → מחלקת צבע. ירוק/אדום רק כאן, לעולם לא לקישוט. */
export const dirClass = n => (n > 0 ? 'up' : n < 0 ? 'down' : '');
