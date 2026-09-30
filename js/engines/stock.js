/* ================================================================
   STOCK — כרטיס נייר: כל מה שקרה איתו, ומה יקרה אם אמכור עכשיו.
   (יועד, 30.9.2026: נקודות כניסה ויציאה על הגרף, עלויות, כמה
   הרווחתי, כמה פוטנציאלי אם מוכר עכשיו — אחרי מס ועמלה, מול IVV,
   וסטטיסטיקות מסחר.) טהור; כל החישוב מעל מנוע ה-FIFO הקיים.

   מושגים:
     ממומש       — Σ (מכירה − עלות FIFO) על המכירות שנעשו. לפני עמלות.
     לא ממומש    — כמות פתוחה × מחיר עכשיו − עלות הפרוסות הפתוחות.
     נטו         — ממומש + לא ממומש − כל העמלות ששולמו על הנייר.
     מחיר ממוצע  — מפרוסות ה-FIFO (מותאם לפיצולים), לא מהשורות הגולמיות:
                   קנייה של מניה אחת ב-$2,243 לפני פיצול 20:1 היא $112.
   "אם מוכר עכשיו" — הערכה, והמסך אומר את זה:
     עמלה  = העמלה הממוצעת על מכירות קודמות של הנייר (או של כל הניירות),
             פעם אחת לכל תיק (כל תיק = מכירה נפרדת)
     מס    = 25% על הרווח (בדולרים), לכל תיק בנפרד, פחות זיכוי מס פתוח
             של אותו תיק (מגן המס: הפסדים שמומשו השנה מקזזים).
             המס האמיתי מחושב בשקלים וכולל את שינוי השער — לכן "הערכה".
   ================================================================ */
import { PortfolioEngine } from './fifo.js';

export const TAX_RATE = 0.25;
const num = v => parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
const symOf = r => String(r.Symbol || '').trim().toUpperCase();

/* rows — שורות מנוע מסווגות (כל התיקים). price — מחיר עכשיו (או null).
   creditsUsd — { portfolio: זיכוי מס פתוח בדולרים } (אופציונלי). */
export function stockSummary(symbol, rows, { price = null, creditsUsd = {} } = {}) {
  const mine = rows.filter(r => symOf(r) === symbol);
  const trades = mine.filter(r => r.category === 'STOCKS');
  const buys = trades.filter(r => r.subCategory === 'BUY_STOCK');
  const sells = trades.filter(r => r.subCategory === 'SELL_STOCK');
  const commission = r => Math.abs(num(r.Commission)) + Math.abs(num(r.Fees));
  const commissions = trades.reduce((s, r) => s + commission(r), 0);

  const closed = PortfolioEngine.computeClosedTrades(mine);
  const realized = closed.reduce((s, t) => s + t.pnl, 0);
  const wins = closed.filter(t => t.pnl > 0).length, losses = closed.filter(t => t.pnl < 0).length;
  const soldQty = closed.reduce((s, t) => s + t.qty, 0);
  const avgHoldDays = soldQty ? closed.reduce((s, t) => s + t.holdDays * t.qty, 0) / soldQty : null;

  const slices = PortfolioEngine.computeLotSlices(mine);
  const boughtQty = slices.reduce((s, x) => s + x.qty, 0);
  const avgBuy = boughtQty ? slices.reduce((s, x) => s + x.qty * x.buyPrice, 0) / boughtQty : null;
  const closedSl = slices.filter(x => !x.open);
  const closedQty = closedSl.reduce((s, x) => s + x.qty, 0);
  const avgSell = closedQty ? closedSl.reduce((s, x) => s + x.qty * x.sellPrice, 0) / closedQty : null;

  const positions = PortfolioEngine.computePositions(mine).filter(p => p.qty > 1e-9);
  const qty = positions.reduce((s, p) => s + p.qty, 0);
  const openCost = positions.reduce((s, p) => s + p.totalCost, 0);
  const value = price > 0 ? qty * price : null;
  const unrealized = value === null ? null : value - openCost;

  /* עמלה משוערת למכירה: ממוצע המכירות של הנייר, אחרת של כל הניירות */
  const allSells = rows.filter(r => r.subCategory === 'SELL_STOCK' && commission(r) > 0);
  const avgOf = list => (list.length ? list.reduce((s, r) => s + commission(r), 0) / list.length : null);
  const sellFee = avgOf(sells.filter(r => commission(r) > 0)) ?? avgOf(allSells) ?? 0;

  let sellNow = null;
  if (qty > 1e-9 && price > 0) {
    const perPortfolio = positions.map(p => {
      const fee = sellFee;
      const gain = p.qty * price - p.totalCost - fee;
      const taxBefore = Math.max(0, gain) * TAX_RATE;
      const credit = Math.max(0, creditsUsd[p.portfolio] || 0);
      const tax = Math.max(0, taxBefore - credit);
      return { portfolio: p.portfolio, qty: p.qty, cost: p.totalCost, value: p.qty * price, fee, gain, taxBefore, creditUsed: taxBefore - tax, tax };
    });
    const S = k => perPortfolio.reduce((s, x) => s + x[k], 0);
    sellNow = {
      value: S('value'), fee: S('fee'), gain: S('gain'), taxBefore: S('taxBefore'), creditUsed: S('creditUsed'), tax: S('tax'),
      afterTax: S('gain') - S('tax'),
      cashOut: S('value') - S('fee') - S('tax'),
      /* אם אמכור עכשיו — כמה ירוויח הנייר מההתחלה, אחרי הכול */
      lifetimeAfterTax: realized + (S('value') - S('cost')) - commissions - S('fee') - S('tax'),
      perPortfolio,
    };
  }

  return {
    symbol, price, qty, openCost, value, unrealized, avgCost: qty ? openCost / qty : null,
    realized, commissions,
    net: realized + (unrealized || 0) - commissions,
    entries: buys.length, exits: sells.length, closedTrades: closed.length, wins, losses,
    winRate: closed.length ? wins / closed.length : null,
    avgHoldDays, avgBuy, avgSell, sellFee,
    firstDate: trades.length ? trades.map(r => String(r.Date).slice(0, 10)).sort()[0] : null,
    portfolios: [...new Set(trades.map(r => r.Portfolio))],
    sellNow,
  };
}

/* נקודות לגרף: כל עסקה (מאוחדת לפי יום וכיוון), במחיר מותאם פיצול כדי
   שתשב על הקו. */
export function tradeMarkers(symbol, rows) {
  const slices = PortfolioEngine.computeLotSlices(rows.filter(r => symOf(r) === symbol));
  const by = {};
  const add = (date, side, qty, px) => {
    const k = `${date}|${side}`;
    const g = (by[k] = by[k] || { date, side, qty: 0, value: 0 });
    g.qty += qty; g.value += qty * px;
  };
  /* קניות: כל פרוסה פעם אחת לפי תאריך הקנייה (פרוסה פתוחה + סגורות מאותה קנייה = אותה קנייה) */
  const seenBuy = new Map();
  slices.forEach(s => {
    const k = `${s.buyDate}|${s.buyPrice}|${s.portfolio}`;
    seenBuy.set(k, (seenBuy.get(k) || { date: String(s.buyDate).slice(0, 10), px: s.buyPrice, qty: 0 }));
    seenBuy.get(k).qty += s.qty;
    if (!s.open) add(String(s.sellDate).slice(0, 10), 'sell', s.qty, s.sellPrice);
  });
  seenBuy.forEach(b => add(b.date, 'buy', b.qty, b.px));
  return Object.values(by).map(g => ({ date: g.date, side: g.side, qty: g.qty, price: g.value / g.qty }))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.side === 'buy' ? -1 : 1));
}
