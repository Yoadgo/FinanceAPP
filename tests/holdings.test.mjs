/* איחוד שורות האחזקות לפי נייר (תצוגה בלבד). */
import { section, ok, eq } from './lib.mjs';
import { groupBySymbol } from '../js/engines/holdingsGroup.js';

section('אחזקות — שורה אחת לנייר');
{
  const p = (portfolio, symbol, qty, avg, price, weight) => ({ id: `${portfolio}|${symbol}`, portfolio, symbol, qty, totalCost: qty * avg, avgCost: avg,
    price, value: price === null ? null : qty * price, weight, realizedPnl: 0, change: 1, spark: [] });
  const pos = [p('Y', 'ETHA', 1250, 20.61, 20.19, 8.4), p('A', 'ETHA', 105, 25.18, 20.19, 0.7), p('D', 'ETHA', 100, 22.74, 20.19, 0.7), p('Y', 'IVV', 82, 462.38, 772.17, 21)];
  const g = groupBySymbol(pos);
  eq(g.length, 2, 'שני ניירות');
  const e = g.find(x => x.symbol === 'ETHA');
  eq(e.qty, 1455, 'כמות כוללת');
  eq(Math.round(e.avgCost * 100) / 100, 21.09, 'עלות ממוצעת משוקללת = סך עלות ÷ סך כמות');
  eq(Math.round(e.weight * 10) / 10, 9.8, 'משקל = סכום המשקלים');
  eq(Math.round(e.pnl), Math.round(1455 * 20.19 - e.totalCost), 'רווח = שווי − עלות');
  eq(e.children.length, 3, 'שלוש שורות פירוט');
  eq(e.children[0].portfolio, 'Y', 'הגדולה ראשונה');
  eq(g[0].symbol, 'IVV', 'מיון לפי שווי');
  const n = groupBySymbol([p('Y', 'X', 1, 1, null, 1), p('D', 'X', 1, 1, 5, 1)]);
  ok(n[0].value === null && n[0].pnl === null, 'מחיר חסר בשורה אחת → שווי מקף, לא חצי סכום');
}
