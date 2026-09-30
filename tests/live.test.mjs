/* שעות המסחר ומיזוג מחירים חיים (engines/marketHours.js, engines/quotes.js) */
import { section, ok, eq } from './lib.mjs';
import { usSession } from '../js/engines/marketHours.js';
import { parseFinnhubQuote, mergeQuotes, ilDay } from '../js/engines/quotes.js';

section('שעות המסחר בניו יורק');
/* 30.9.2026 — יום רביעי. ניו יורק ב-EDT (UTC−4) */
eq(usSession(new Date('2026-09-30T13:29:00Z')), 'pre', '9:29 בניו יורק — לפני פתיחה');
eq(usSession(new Date('2026-09-30T13:30:00Z')), 'open', '9:30 — פתוח (16:30 בישראל)');
eq(usSession(new Date('2026-09-30T19:59:00Z')), 'open', '15:59 — עדיין פתוח');
eq(usSession(new Date('2026-09-30T20:00:00Z')), 'post', '16:00 — אחרי סגירה');
eq(usSession(new Date('2026-10-03T15:00:00Z')), 'closed', 'שבת — סגור');
/* חורף: EST (UTC−5). 9:30 בניו יורק = 14:30 UTC */
eq(usSession(new Date('2026-12-02T14:29:00Z')), 'pre', 'בחורף 14:29 UTC עוד לפני פתיחה');
eq(usSession(new Date('2026-12-02T14:30:00Z')), 'open', 'בחורף 14:30 UTC פתוח');
/* השבוע ששעון הקיץ לא מתואם: ארה"ב עברה לחורף ב-1.11, ישראל ב-25.10 */
eq(usSession(new Date('2026-10-28T13:30:00Z')), 'open', 'שבוע אי-התאמה: לפי ניו יורק, לא לפי ישראל');

section('Finnhub — פענוח ומיזוג');
const q = parseFinnhubQuote({ c: 190.5, d: 1.5, dp: 0.7937, pc: 189, t: 1790780000 });
eq(q.price, 190.5, 'מחיר אחרון');
eq(q.at, 1790780000000, 'זמן העסקה במילישניות');
eq(parseFinnhubQuote({ c: 0, d: null, dp: null, pc: 0, t: 0 }), null, 'נייר לא מוכר (c=0) — אין מחיר, לא אפס');
eq(parseFinnhubQuote({ error: 'Invalid API key.' }), null, 'תשובת שגיאה — אין מחיר');
eq(parseFinnhubQuote({ c: 100, pc: 80, t: 1 }).changePct, 25, 'בלי dp — מחשבים מהסגירה הקודמת');
const sheet = { asOf: '2026-09-30', fetchedAt: '2026-09-30T14:00:00.000Z', prices: { IVV: { price: 760, changePct: -0.1, asOf: '2026-09-30' }, QQQ: { price: 730, changePct: 0.2, asOf: '2026-09-30' } }, fx: { USDILS: { rate: 3.07 } } };
const m = mergeQuotes(sheet, { IVV: { price: 765.2, changePct: 0.5, at: Date.parse('2026-09-30T14:30:00Z') } });
eq(m.prices.IVV.price, 765.2, 'מחיר חי חדש גובר על הגיליון');
eq(m.prices.IVV.src, 'live', 'ומסומן כחי');
eq(m.prices.QQQ.src, 'sheet', 'נייר בלי מחיר חי — מהגיליון');
eq(m.fx.USDILS.rate, 3.07, 'שער הדולר נשאר מהגיליון');
eq(m.liveCount, 1, 'ספירת מחירים חיים');
const old = mergeQuotes(sheet, { IVV: { price: 700, changePct: 0, at: Date.parse('2026-09-29T19:00:00Z') } });
eq(old.prices.IVV.price, 760, 'מחיר "חי" ישן מהגיליון — לא גובר');
eq(ilDay(Date.parse('2026-09-30T22:30:00Z')), '2026-10-01', 'היום לפי שעון ישראל (01:30 בלילה = יום למחרת)');
eq(Object.keys(mergeQuotes(null, {}).prices).length, 0, 'בלי גיליון ובלי חי — ריק, לא קורס');
