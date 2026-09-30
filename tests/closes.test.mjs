/* סגירה יומית — מתי ואיזו. */
import { section, ok, eq } from './lib.mjs';
import { closeTarget, closesFrom, mergeCloses, mergeHistoryDocs, prevWeekday } from '../js/engines/closes.js';

section('סגירה יומית');
{
  const at = s => new Date(s);               // UTC
  /* 30.9.2026 היה יום רביעי. ניו יורק = UTC−4 בקיץ. */
  eq(JSON.stringify(closeTarget(at('2026-09-30T21:00:00Z'))), JSON.stringify({ date: '2026-09-30', mode: 'price' }), 'אחרי הסגירה (17:00 NY) → היום, לפי המחיר');
  eq(JSON.stringify(closeTarget(at('2026-09-30T15:00:00Z'))), JSON.stringify({ date: '2026-09-29', mode: 'derive' }), 'באמצע המסחר → אתמול, מחושב מהשינוי');
  eq(JSON.stringify(closeTarget(at('2026-09-30T11:00:00Z'))), JSON.stringify({ date: '2026-09-29', mode: 'price' }), 'לפני הפתיחה → אתמול, לפי המחיר');
  eq(closeTarget(at('2026-10-03T15:00:00Z')).date, '2026-10-02', 'שבת → שישי');
  eq(closeTarget(at('2026-10-05T11:00:00Z')).date, '2026-10-02', 'שני לפני פתיחה → שישי');
  eq(closeTarget(at('2026-10-01T02:00:00Z')).date, '2026-09-30', 'לילה אחרי 20:00 NY (רביעי) → רביעי');
  eq(prevWeekday('2026-10-05'), '2026-10-02', 'יום עסקים קודם לשני = שישי');

  const prices = { IVV: { price: 770, changePct: 1 }, BAD: { price: 0, changePct: 0 }, X: { price: 10, changePct: null } };
  const d = closesFrom(prices, { date: '2026-09-29', mode: 'derive' });
  eq(d.length, 1, 'מחיר חסר / שינוי חסר → לא נרשם');
  eq(d[0].close, 762.3762, 'סגירה קודמת = מחיר ÷ (1 + שינוי%)');
  eq(closesFrom(prices, { date: '2026-09-30', mode: 'price' }).length, 2, 'אחרי סגירה — כל מי שיש לו מחיר');

  const existing = { px_IVV_2026: { symbol: 'IVV', year: 2026, closes: { '09-29': 767.52 } } };
  const m = mergeCloses(existing, [{ sym: 'IVV', date: '2026-09-29', close: 1 }, { sym: 'IVV', date: '2026-09-30', close: 771 }, { sym: 'NEW', date: '2026-09-30', close: 5 }]);
  eq(m.length, 2, 'שני מסמכים השתנו');
  const ivv = m.find(x => x.id === 'px_IVV_2026').data;
  eq(ivv.closes['09-29'], 767.52, 'סגירה קיימת לא נדרסת');
  eq(ivv.closes['09-30'], 771, 'סגירה חדשה נוספה');
  ok(m.find(x => x.id === 'px_NEW_2026').data.symbol === 'NEW', 'נייר חדש → מסמך חדש');
  eq(Object.keys(existing.px_IVV_2026.closes).length, 1, 'הקלט לא שונה');
  eq(mergeCloses(existing, [{ sym: 'IVV', date: '2026-09-29', close: 1 }]).length, 0, 'אין חדש → אין כתיבה');

  const h = mergeHistoryDocs({ px_IVV_2026: { closes: { '09-30': 771, '09-29': 1 } } }, [{ id: 'px_IVV_2026', data: { symbol: 'IVV', year: 2026, closes: { '09-29': 767.52 } } }]);
  ok(h[0].data.closes['09-30'] === 771 && h[0].data.closes['09-29'] === 767.52, 'משיכת היסטוריה: הגיליון מנצח בתאריכים שלו, סגירות מאוחרות נשמרות');
}
