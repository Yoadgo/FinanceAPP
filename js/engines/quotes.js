/* ================================================================
   QUOTES — מחירים בזמן אמת מ-Finnhub, ומיזוג עם תמונת הגיליון. טהור.

   Finnhub /quote מחזיר: c (מחיר אחרון) · d (שינוי) · dp (שינוי %) ·
   pc (סגירה קודמת) · t (זמן העסקה, שניות מאז 1970).
   נייר שאינו מוכר מחזיר c=0 — זה "אין מחיר", לא מחיר אפס.
   ================================================================ */

export function parseFinnhubQuote(j) {
  if (!j || typeof j !== 'object') return null;
  const c = Number(j.c);
  if (!(c > 0)) return null;
  const pc = Number(j.pc);
  const dp = isFinite(Number(j.dp)) && j.dp !== null ? Number(j.dp) : (pc > 0 ? (c / pc - 1) * 100 : null);
  return { price: c, changePct: dp, prevClose: pc > 0 ? pc : null, at: Number(j.t) > 0 ? Number(j.t) * 1000 : null };
}

/* יום לוח בישראל של רגע נתון — ה-asOf של מחיר */
export function ilDay(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
}

/* sheet = market/latest ({ prices:{SYM:{price,changePct,asOf}}, fx, asOf })
   live  = { SYM: { price, changePct, at } }
   → אותו מבנה כמו market/latest, כשמחיר חי גובר על הגיליון אם הוא
   חדש יותר. כל מחיר מסומן במקור שלו (src) ובזמן (at). */
export function mergeQuotes(sheet, live, now = Date.now()) {
  const prices = {};
  const sp = (sheet && sheet.prices) || {};
  const sheetAt = sheet && sheet.fetchedAt ? Date.parse(sheet.fetchedAt) : null;
  Object.entries(sp).forEach(([s, v]) => { prices[s] = { ...v, src: 'sheet', at: sheetAt }; });
  Object.entries(live || {}).forEach(([s, q]) => {
    if (!q || !(q.price > 0)) return;
    const cur = prices[s];
    /* הגיליון מעוכב (~20 דק' מגוגל), ולכן זמן המשיכה שלו אינו זמן המחיר.
       מחיר חי נדחה רק אם הוא ישן בחצי שעה ויותר מהמשיכה — כלומר באמת
       מיום/סשן קודם. */
    if (cur && cur.at && q.at && q.at < cur.at - 30 * 60000) return;
    prices[s] = { price: q.price, changePct: q.changePct, asOf: ilDay(q.at || now), at: q.at || now, src: 'live' };
  });
  const liveCount = Object.values(prices).filter(p => p.src === 'live').length;
  return { ...(sheet || {}), prices, liveCount };
}
