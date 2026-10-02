/* ================================================================
   STRATEGY — "האם כל חלק באסטרטגיה עושה את העבודה שלו". טהור.

   (יועד, 2.10.2026: "יש לי את הליבה (IVV ו-QQQ), מניית טווח ארוך שהיא
   טסלה, קריפטו, וכל השאר זה מסחר אקטיבי. זו האסטרטגיה שלי שאני גם רוצה
   לבדוק." והשאלה שמאחוריה: "אני עובד קשה כדי שהמסחר האקטיבי ישפר את
   ההכנסות שלי" — האם הוא משפר.)

   ארבע קבוצות. כל נייר שייך לאחת. ברירת המחדל: מה שלא הוגדר — מסחר
   אקטיבי. מניה שקשורה לקריפטו אבל נסחרת (IREN, BMNR) היא מסחר, לא
   קריפטו: כך המספר של המסחר משקף את כל ההחלטות. שיוך אחר נשמר
   ב-settings/strategy ודורס את ברירת המחדל.

   המספר הראשי לכל קבוצה (נבחר 2.10): נטו מול המדד.
     רווח נטו   = Σ התרומה היומית של הניירות שלה (engines/periods.js:
                  שינוי בשווי + מכירות − קניות כולל עמלה).
     המדד היה   = Σ לכל יום: השווי שהיה מושקע בנייר בתחילת היום × תשואת
                  המדד באותו יום. כלומר "אותו כסף, באותם ימים, במדד".
     יתרון      = רווח נטו − המדד היה.   שווה? = יתרון ≥ 0.

   למה לא engines/efficiency.js: הוא מודד פרוסות FIFO לאורך כל חייהן,
   ואין לו טווח תאריכים. כאן צריך "מתחילת השנה" ו"שלושה חודשים", ולכן
   המדידה יומית. שתי השיטות עונות על אותה שאלה; המספרים יכולים להיות
   שונים מעט (שם הבסיס הוא העלות, כאן השווי של כל יום).

   הנחות שנאמרות בקול:
   • קנייה ומכירה באותו יום: לכסף אין "לילה" במדד, ולכן המדד = 0 לעסקה.
   • המדד לא משלם עמלות — ההשוואה נוטה מעט לטובת המדד בקבוצה שנסחרת הרבה,
     וזה בדיוק המחיר האמיתי של המסחר.
   • מס לא מיוחס לקבוצה (הוא נטו לכל תיק ושנה) — הוא ב"מס ועמלות".
   • דיבידנדים, ריבית ודמי טיפול לא מיוחסים לנייר — מוצגים בשורה נפרדת.
   ================================================================ */
const num = v => parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
const DAY = 86400000;
const dnum = s => Math.floor(Date.parse(`${s}T00:00:00Z`) / DAY);
const isTicker = s => /^[A-Z]{1,5}$/.test(s);

export const GROUPS = [
  { id: 'core', label: 'ליבה', hint: 'מדדים בהחזקה' },
  { id: 'long', label: 'טווח ארוך', hint: 'מניה בהחזקה לשנים' },
  { id: 'crypto', label: 'קריפטו', hint: 'קרנות קריפטו בהחזקה' },
  { id: 'active', label: 'מסחר אקטיבי', hint: 'כל השאר: כניסות ויציאות' },
];
const IDS = new Set(GROUPS.map(g => g.id));
export const DEFAULT_MAP = { IVV: 'core', QQQ: 'core', TSLA: 'long', IBIT: 'crypto', ETHA: 'crypto' };

/* הקבוצה של נייר. map — מה שנשמר ב-settings/strategy (דורס את ברירת המחדל). */
export function groupOf(sym, map) {
  const g = (map && map[sym]) || DEFAULT_MAP[sym];
  return IDS.has(g) ? g : 'active';
}

/* days    — הפלט של dailyPnl (כולל bySym: שווי כל נייר בסוף היום).
   history — { SYM: [{date, close}] } ממוין.
   rows    — שורות המנוע (לספירת עסקאות ועמלות).
   from/to — טווח, כולל. map — שיוך שנשמר. bench — המדד.            */
export function strategy(days, history, rows, { from = '0000', to = '9999', map = null, bench = 'IVV' } = {}) {
  const B = (history && history[bench]) || [];
  let bi = -1;
  const benchOn = d => {                                   // סגירת המדד ביום או עד 7 ימים לפניו
    while (bi + 1 < B.length && B[bi + 1].date <= d) bi++;
    return bi >= 0 && dnum(d) - dnum(B[bi].date) <= 7 ? B[bi].close : null;
  };

  const S = {};
  const get = s => (S[s] = S[s] || { symbol: s, group: groupOf(s, map), pnl: 0, bench: 0, capDays: 0, mvStart: 0, mvEnd: 0, buys: 0, sells: 0, fees: 0, months: {} });
  const month = (o, k) => (o.months[k] = o.months[k] || { key: k, pnl: 0, bench: 0 });

  let prevClose = null, prevDay = null, n = 0, benchMissing = 0, fallbackDays = 0, other = 0, first = null, last = null;
  (days || []).forEach(d => {
    const close = benchOn(d.date);
    const r = close !== null && prevClose !== null ? close / prevClose - 1 : null;
    if (d.date >= from && d.date <= to) {
      const k = d.date.slice(0, 7), start = (prevDay && prevDay.bySym) || {};
      if (!first) { first = d.date; Object.entries(start).forEach(([s, v]) => { get(s).mvStart = v; }); }
      last = d; n++;
      if (d.fallback) fallbackDays++;
      let invested = false;
      Object.entries(start).forEach(([s, v]) => {
        if (Math.abs(v) < 1e-9) return;
        invested = true;
        const o = get(s);
        o.capDays += v;
        if (r !== null) { o.bench += v * r; month(o, k).bench += v * r; }
      });
      if (r === null && invested) benchMissing++;
      Object.entries(d.contrib || {}).forEach(([s, c]) => { const o = get(s); o.pnl += c; month(o, k).pnl += c; });
      other += d.otherUsd || 0;
    }
    if (close !== null) prevClose = close;
    prevDay = d;
  });
  if (last) Object.entries(last.bySym || {}).forEach(([s, v]) => { get(s).mvEnd = v; });

  (rows || []).forEach(r => {
    if (r.category !== 'STOCKS') return;
    const d = String(r.Date).slice(0, 10), s = String(r.Symbol || '').trim().toUpperCase();
    if (d < from || d > to || !isTicker(s) || (first && d < first) || (last && d > last.date)) return;
    const o = get(s);
    if (r.subCategory === 'BUY_STOCK') o.buys++; else if (r.subCategory === 'SELL_STOCK') o.sells++; else return;
    if (String(r.Currency || '').trim() === '$') o.fees += Math.abs(num(r.Commission)) + Math.abs(num(r.Fees));
  });

  const finish = o => {
    const avgCap = n ? o.capDays / n : 0;
    return { ...o, edge: o.pnl - o.bench, avgCap, ret: avgCap > 1 ? o.pnl / avgCap : null, trades: o.buys + o.sells, worth: o.pnl - o.bench >= 0 };
  };
  const syms = Object.values(S).map(finish).filter(o => Math.abs(o.pnl) >= 0.005 || Math.abs(o.capDays) >= 0.005 || o.trades || Math.abs(o.mvEnd) >= 0.005);
  const mvTotal = syms.reduce((t, o) => t + o.mvEnd, 0);

  const sum = list => {
    const g = { pnl: 0, bench: 0, capDays: 0, mvStart: 0, mvEnd: 0, buys: 0, sells: 0, fees: 0, months: {} };
    list.forEach(o => {
      ['pnl', 'bench', 'capDays', 'mvStart', 'mvEnd', 'buys', 'sells', 'fees'].forEach(f => { g[f] += o[f]; });
      Object.values(o.months).forEach(m => { const x = month(g, m.key); x.pnl += m.pnl; x.bench += m.bench; });
    });
    const f = finish(g);
    f.months = Object.values(g.months).sort((a, b) => a.key.localeCompare(b.key)).map(m => ({ ...m, edge: m.pnl - m.bench }));
    f.weight = mvTotal > 1 ? g.mvEnd / mvTotal : null;
    return f;
  };
  const groups = GROUPS.map(G => {
    const list = syms.filter(o => o.group === G.id).sort((a, b) => b.edge - a.edge);
    return { ...G, ...sum(list), symbols: list };
  });
  const total = sum(syms);
  return { groups, total: { ...total, other, net: total.pnl + other }, days: n, from: first, to: last ? last.date : null, benchMissing, fallbackDays, bench };
}

/* משפט אחד, במילים: מה הקבוצה עשתה מול המדד. */
export function verdictText(g, bench = 'IVV', fmt = v => `$${Math.round(v).toLocaleString('en-US')}`) {
  const side = g.pnl >= 0 ? `הרוויח ${fmt(g.pnl)}` : `הפסיד ${fmt(-g.pnl)}`;
  const idx = g.bench >= 0 ? `מרוויח ${fmt(g.bench)}` : `מפסיד ${fmt(-g.bench)}`;
  const gap = g.edge >= 0 ? `יתרון של ${fmt(g.edge)}` : `פער של ${fmt(-g.edge)} לטובת המדד`;
  return `${side} אחרי עמלות. אותו כסף, באותם ימים, ב-${bench} היה ${idx}. ${gap}.`;
}
