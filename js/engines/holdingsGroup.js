/* ================================================================
   HOLDINGS GROUP — שורה אחת לכל נייר, כשמציגים את כל התיקים.

   המנוע מחזיר פוזיציה לכל צירוף תיק+נייר (ETHA ביועד, ETHA בדר,
   ETHA באלטשולר) — וזה נכון לחישוב FIFO, כי כל תיק הוא חשבון נפרד
   עם פרוסות משלו. אבל ברשימה זה מפזר את אותו נייר על שלוש שורות,
   ו"משקל" של כל שורה מסתיר את החשיפה האמיתית לנייר.
   כאן מאחדים לתצוגה בלבד: הכמות, העלות, השווי והמשקל נסכמים, העלות
   הממוצעת משוקללת (סך עלות ÷ סך כמות), והשורות המקוריות נשמרות
   ב-children לפירוט. שום חישוב FIFO לא משתנה.
   ================================================================ */
export function groupBySymbol(pos) {
  const map = new Map();
  pos.forEach(p => {
    let g = map.get(p.symbol);
    if (!g) {
      g = { id: `sym|${p.symbol}`, symbol: p.symbol, qty: 0, totalCost: 0, value: 0, weight: 0, realizedPnl: 0,
        price: p.price, priceAsOf: p.priceAsOf, change: p.change, priceSrc: p.priceSrc, spark: p.spark, children: [] };
      map.set(p.symbol, g);
    }
    g.children.push(p);
    g.qty += p.qty;
    g.totalCost += p.totalCost;
    g.realizedPnl += p.realizedPnl || 0;
    g.weight += p.weight || 0;
    g.value = g.value === null || p.value === null ? null : g.value + p.value;
  });
  return [...map.values()].map(g => {
    g.avgCost = g.qty > 0 ? g.totalCost / g.qty : 0;
    g.pnl = g.value === null ? null : g.value - g.totalCost;
    g.children.sort((a, b) => (b.value ?? b.totalCost) - (a.value ?? a.totalCost));
    return g;
  }).sort((a, b) => (b.value ?? b.totalCost) - (a.value ?? a.totalCost));
}
