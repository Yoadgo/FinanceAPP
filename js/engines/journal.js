/* ================================================================
   JOURNAL — יומן מחקר: תזה לכל נייר, על ציר זמן יחד עם העסקאות.
   (יועד, 30.9.2026: "תזה לנייר + ציר זמן", שדות: מחיר יעד, תנאי יציאה)

   רשומה = { symbol, date, kind, text, target, exit }
     kind: thesis (למה קניתי) · update (מה השתנה) · lesson (מה למדתי)
     target, exit — רק בתזה. target במטבע הנייר (דולר).
   התזה הנוכחית = התזה האחרונה לפי תאריך. תזה חדשה לא מוחקת את
   הקודמת — ההיסטוריה של "מה חשבתי אז" היא כל הטעם.

   פונקציות טהורות; המסך (screens/invest/stock.js — כרטיס הנייר) רק מצייר.
   ================================================================ */
export const KINDS = { thesis: 'תזה', update: 'עדכון', lesson: 'לקח' };
export const MAX_TEXT = 4000;

const isoOk = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
/* "1,250.5" → 1250.5. כל דבר אחר שאינו מספר → NaN (ונדחה), לא "תיקון" שקט. */
const numOrNull = v => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(/,/g, '').trim()));

/* קלט מהטופס → רשומה נקייה + רשימת בעיות (ריקה = אפשר לשמור). */
export function normalizeEntry(input) {
  const e = {
    symbol: String(input.symbol || '').trim().toUpperCase(),
    date: String(input.date || '').trim(),
    kind: String(input.kind || ''),
    text: String(input.text || '').trim(),
    target: input.kind === 'thesis' ? numOrNull(input.target) : null,
    exit: input.kind === 'thesis' ? String(input.exit || '').trim() : '',
  };
  const problems = [];
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(e.symbol)) problems.push('נייר לא תקין');
  if (!isoOk(e.date)) problems.push('תאריך לא תקין');
  if (!KINDS[e.kind]) problems.push('סוג רשומה לא מוכר');
  if (!e.text) problems.push('אין טקסט');
  if (e.text.length > MAX_TEXT) problems.push(`הטקסט ארוך מ-${MAX_TEXT} תווים`);
  if (e.target !== null && !(Number.isFinite(e.target) && e.target > 0)) problems.push('מחיר יעד חייב להיות מספר חיובי');
  if (isoOk(e.date) && new Date(`${e.date}T00:00:00Z`).toISOString().slice(0, 10) !== e.date) problems.push('תאריך לא קיים');
  if (e.exit.length > 500) problems.push('תנאי היציאה ארוך מדי');
  return { entry: e, problems };
}

const byDateDesc = (a, b) => b.date.localeCompare(a.date) || String(b.createdKey || '').localeCompare(String(a.createdKey || ''));

export function entriesFor(symbol, entries) {
  return (entries || []).filter(e => !e.voided && e.symbol === symbol).sort(byDateDesc);
}

export function currentThesis(symbol, entries) {
  return entriesFor(symbol, entries).find(e => e.kind === 'thesis') || null;
}

/* כמה נשאר ליעד: +12% = המחיר צריך לעלות 12%. ≤ 0 = היעד הושג. */
export function targetGap(price, target) {
  if (!(price > 0) || !(target > 0)) return null;
  return target / price - 1;
}

/* ציר זמן: רשומות היומן + העסקאות של הנייר (כל התיקים). עסקאות מאותו
   יום, סוג ותיק מאוחדות לשורה אחת (כמות כוללת, מחיר ממוצע משוקלל) —
   שש קניות של GOOGL ביום אחד הן החלטה אחת. */
export function timeline(symbol, entries, rows) {
  const items = entriesFor(symbol, entries).map(e => ({ type: 'note', date: e.date, entry: e }));
  const groups = {};
  (rows || []).forEach(r => {
    if (String(r.Symbol || '').trim().toUpperCase() !== symbol) return;
    const sub = r.subCategory;
    const type = sub === 'BUY_STOCK' ? 'buy' : sub === 'SELL_STOCK' ? 'sell' : sub === 'SPLIT' ? 'split' : null;
    if (!type) return;
    const date = String(r.Date).slice(0, 10);
    const k = `${date}|${type}|${r.Portfolio}`;
    const g = (groups[k] = groups[k] || { type, date, portfolio: r.Portfolio, qty: 0, value: 0, count: 0 });
    const q = Math.abs(Number(r.Qty) || 0), p = Math.abs(Number(r.ExecutionRate) || 0);
    g.qty += q; g.value += q * p; g.count++;
  });
  Object.values(groups).forEach(g => items.push({ ...g, price: g.qty ? g.value / g.qty : null }));
  /* החדש למעלה; באותו יום — הרשומה אחרי העסקה (קודם קנית, אחר כך כתבת למה) */
  const rank = { note: 0, sell: 1, buy: 2, split: 3 };
  return items.sort((a, b) => b.date.localeCompare(a.date) || rank[a.type] - rank[b.type]);
}

/* רשימת הניירות ליומן: כל מה שמוחזק היום, כל מה שנסחר, וכל מה שיש לו
   רשומה. מוחזקים קודם (לפי עלות), אחר כך השאר לפי שם. */
export function symbolsIndex(entries, positions, rows) {
  const S = {};
  const get = s => (S[s] = S[s] || { symbol: s, qty: 0, cost: 0, notes: 0, thesis: null, traded: false, lastTrade: '' });
  (positions || []).forEach(p => { const s = get(p.symbol); s.qty += p.qty; s.cost += p.totalCost; });
  (rows || []).forEach(r => {
    if (r.category !== 'STOCKS') return;
    const sym = String(r.Symbol || '').trim().toUpperCase();
    if (!/^[A-Z]{1,5}$/.test(sym)) return;
    const s = get(sym); s.traded = true;
    const d = String(r.Date).slice(0, 10); if (d > s.lastTrade) s.lastTrade = d;
  });
  (entries || []).filter(e => !e.voided).forEach(e => { get(e.symbol).notes++; });
  Object.values(S).forEach(s => { s.thesis = currentThesis(s.symbol, entries); });
  return Object.values(S).sort((a, b) => (b.qty > 0) - (a.qty > 0) || b.cost - a.cost || b.lastTrade.localeCompare(a.lastTrade) || a.symbol.localeCompare(b.symbol));
}
