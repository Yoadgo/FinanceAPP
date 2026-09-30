/* יומן מחקר — מנוע. */
import { section, ok, eq } from './lib.mjs';
import { normalizeEntry, currentThesis, timeline, targetGap, symbolsIndex } from '../js/engines/journal.js';

section('יומן מחקר');
{
  const n = normalizeEntry({ symbol: ' googl ', date: '2026-06-24', kind: 'thesis', text: '  ענן + בינה ', target: '400', exit: 'מתחת ל-320' });
  eq(n.problems.length, 0, 'רשומה תקינה');
  eq(n.entry.symbol, 'GOOGL', 'נייר באותיות גדולות');
  eq(n.entry.target, 400, 'מחיר יעד כמספר');
  const u = normalizeEntry({ symbol: 'GOOGL', date: '2026-07-01', kind: 'update', text: 'x', target: '999', exit: 'y' });
  ok(u.entry.target === null && u.entry.exit === '', 'יעד ותנאי יציאה רק בתזה');
  ok(normalizeEntry({ symbol: 'GOOGL', date: '24/06/2026', kind: 'thesis', text: 'x' }).problems.length > 0, 'תאריך לא ISO → נדחה');
  ok(normalizeEntry({ symbol: 'GOOGL', date: '2026-06-24', kind: 'thesis', text: '' }).problems.length > 0, 'בלי טקסט → נדחה');
  ok(normalizeEntry({ symbol: 'GOOGL', date: '2026-06-24', kind: 'thesis', text: 'x', target: '-5' }).problems.length > 0, 'יעד שלילי → נדחה');
  eq(normalizeEntry({ symbol: 'GOOGL', date: '2026-06-24', kind: 'thesis', text: 'x', target: '1,250.5' }).entry.target, 1250.5, 'פסיק אלפים מותר');
  ok(normalizeEntry({ symbol: 'GOOGL', date: '2026-06-24', kind: 'thesis', text: 'x', target: '4oo' }).problems.length > 0, 'יעד לא מספרי → נדחה, לא "4"');
  ok(normalizeEntry({ symbol: 'GOOGL', date: '2026-02-31', kind: 'thesis', text: 'x' }).problems.length > 0, '31 בפברואר → נדחה');

  const E = [
    { id: 1, symbol: 'GOOGL', date: '2026-06-24', kind: 'thesis', text: 'ישנה', target: 400 },
    { id: 2, symbol: 'GOOGL', date: '2026-08-01', kind: 'thesis', text: 'חדשה', target: 380 },
    { id: 3, symbol: 'GOOGL', date: '2026-09-01', kind: 'lesson', text: 'לקח' },
    { id: 4, symbol: 'GOOGL', date: '2026-09-02', kind: 'thesis', text: 'מבוטלת', voided: true },
    { id: 5, symbol: 'ZS', date: '2026-09-02', kind: 'thesis', text: 'אחר' },
  ];
  eq(currentThesis('GOOGL', E).text, 'חדשה', 'התזה הנוכחית = האחרונה, בלי מבוטלות');
  eq(currentThesis('NVDA', E), null, 'אין תזה → null');
  eq(Math.round(targetGap(340, 380) * 1000) / 1000, 0.118, 'עוד 11.8% ליעד');
  ok(targetGap(400, 380) < 0, 'מעל היעד → שלילי (הושג)');
  eq(targetGap(null, 380), null, 'בלי מחיר → null');

  const rows = [
    { Symbol: 'GOOGL', subCategory: 'BUY_STOCK', Date: '2026-06-24', Portfolio: 'Y', Qty: 20, ExecutionRate: 350 },
    { Symbol: 'GOOGL', subCategory: 'BUY_STOCK', Date: '2026-06-24', Portfolio: 'Y', Qty: 10, ExecutionRate: 353 },
    { Symbol: 'GOOGL', subCategory: 'SELL_STOCK', Date: '2026-07-23', Portfolio: 'Y', Qty: 30, ExecutionRate: 318 },
    { Symbol: 'ZS', subCategory: 'BUY_STOCK', Date: '2026-07-23', Portfolio: 'Y', Qty: 1, ExecutionRate: 1 },
  ];
  const t = timeline('GOOGL', E, rows);
  eq(t.length, 5, '3 רשומות + 2 עסקאות (שתי קניות באותו יום = שורה אחת)');
  eq(t[t.length - 1].type, 'buy', 'הישן בסוף');
  eq(t[t.length - 1].qty, 30, 'כמות מאוחדת');
  eq(t[t.length - 1].price, 351, 'מחיר ממוצע משוקלל');
  eq(t[t.length - 2].type, 'note', 'באותו יום — הרשומה אחרי העסקה (למעלה ממנה)');

  const idx = symbolsIndex(E, [{ symbol: 'ZS', qty: 5, totalCost: 900 }], rows);
  eq(idx[0].symbol, 'ZS', 'מוחזק ראשון');
  ok(idx.find(s => s.symbol === 'GOOGL').notes === 3, 'ספירת רשומות בלי מבוטלות');
}
