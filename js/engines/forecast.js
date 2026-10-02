/* ================================================================
   FORECAST — תחזית לכל קופה: פנסיה, קרן השתלמות, חיסכון לבית, חירום.
   (יועד, 29.9.2026: "התחזית היא לא רק של הפנסיה — אלא על חיסכון, קרן
   השתלמות, חיסכון לבית וכו'.")

   מודל אחד לכל הקופות, חודש אחר חודש:
     יתרה(ח+1) = יתרה(ח) × (1 + תשואה חודשית − דמי ניהול מצבירה חודשיים)
                 + הפקדה × (1 − דמי ניהול מהפקדה)

   התשואה ריאלית (אחרי אינפלציה), ולכן כל התוצאות בשקלים של היום —
   מספר שאפשר להבין בלי לחשוב על אינפלציה.
   שלושה תרחישים לכל קופה: זהיר · בסיס · אופטימי. תחזית מסומנת תמיד
   כתחזית (אפיון: "בגופן ובצבע שונים מנתון מדוד").

   pot = { id, name, kind, balance, asOf: 'YYYY-MM-DD', monthly,
           returns: [low, base, high] (% לשנה, ריאלי),
           feeBalancePct, feeDepositPct, endDate?: 'YYYY-MM', target? }
   ================================================================ */
/* פנסיה והשתלמות: 3/5/7 — אושר 2.10.2026 (שתי הקופות במסלול מחקה S&P 500). */
export const DEFAULT_RETURNS = { pension: [3, 5, 7], study: [3, 5, 7], house: [1, 2, 3], savings: [1, 3, 5], other: [1, 3, 5] };
export const KIND_LABEL = { pension: 'פנסיה', study: 'קרן השתלמות', house: 'חיסכון לבית', savings: 'חיסכון', other: 'אחר' };

const addMonths = (ym, k) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
export const monthsBetween = (a, b) => {
  const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

/* סדרה חודשית לקופה אחת בתרחיש אחד. */
export function projectPot(pot, { scenario = 1, until } = {}) {
  const start = String(pot.asOf).slice(0, 7);
  const end = until || pot.endDate || addMonths(start, 12 * 20);
  const n = Math.max(0, monthsBetween(start, end));
  const rYear = (pot.returns || DEFAULT_RETURNS[pot.kind] || DEFAULT_RETURNS.other)[scenario] / 100;
  const r = Math.pow(1 + rYear, 1 / 12) - 1;
  const feeB = (pot.feeBalancePct || 0) / 100 / 12;
  const dep = (pot.monthly || 0) * (1 - (pot.feeDepositPct || 0) / 100);
  let v = Number(pot.balance) || 0, deposited = 0;
  const out = [{ month: start, value: v, deposited }];
  for (let i = 1; i <= n; i++) {
    v = v * (1 + r - feeB) + dep;
    deposited += pot.monthly || 0;
    out.push({ month: addMonths(start, i), value: v, deposited });
  }
  return out;
}

/* כל הקופות יחד, בתרחיש אחד, עד חודש משותף. קופה שהסתיימה (endDate)
   נשארת ביתרה הסופית שלה — הכסף לא נעלם, רק מפסיק לגדול בהפקדות. */
export function projectAll(pots, { scenario = 1, until }) {
  const series = pots.map(p => ({ pot: p, rows: projectPot(p, { scenario, until: p.endDate && monthsBetween(p.endDate, until) < 0 ? p.endDate : until }) }));
  const months = new Set();
  series.forEach(s => s.rows.forEach(r => months.add(r.month)));
  const sorted = [...months].sort();
  const valueAt = (rows, m) => { let last = null; for (const r of rows) { if (r.month <= m) last = r; else break; } return last; };
  return sorted.map(m => {
    const row = { month: m, total: 0, byPot: {} };
    series.forEach(s => { const r = valueAt(s.rows, m); const v = r ? r.value : 0; row.byPot[s.pot.id] = v; row.total += v; });
    return row;
  });
}

/* מתי הקופה מגיעה ליעד (בתרחיש נתון). null = לא עד סוף התחזית. */
export function reachesTarget(pot, scenario = 1) {
  if (!pot.target) return null;
  const hit = projectPot(pot, { scenario }).find(r => r.value >= pot.target);
  return hit ? hit.month : null;
}

/* קצבה חודשית מפנסיה: צבירה ÷ מקדם המרה (כ-200 לגבר בן 67, לפי הקרן). */
export const annuity = (balance, factor = 200) => (factor > 0 ? balance / factor : null);
