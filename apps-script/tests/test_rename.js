const L = require('./load.js');
const I = L.load('ingest.gs');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('❌ ' + n + (x !== undefined ? '  → ' + x : '')); } };

const R = (c, s, row) => ({ Category: c, Subcategory: s, _row: row });
const rows = [
  R('מזון', 'בית קפה', 2), R('מזון', 'בית קפה', 3), R('מזון', 'מסעדה', 4),
  R('מזון', 'סופרמרקט', 5), R('קניות', 'ביגוד', 6), R('', '', 7),
];

/* ── איחוד תת-קטגוריה ── */
let p = I.renamePlan_(rows, 'מזון', 'בית קפה', 'מזון', 'בית קפה/מסעדות');
ok('איחוד: רק שתי שורות בית קפה', p.length === 2, p.length);
ok('איחוד: היעד נכתב', p[0].category === 'מזון' && p[0].subcategory === 'בית קפה/מסעדות');
ok('איחוד: מסעדה לא נגעה', !p.some(h => h.row.Subcategory === 'מסעדה'));

/* השלב השני של אותו איחוד — מסעדה לאותו יעד */
p = I.renamePlan_(rows, 'מזון', 'מסעדה', 'מזון', 'בית קפה/מסעדות');
ok('איחוד שני: שורה אחת', p.length === 1 && p[0].subcategory === 'בית קפה/מסעדות', p.length);

/* ── קטגוריה שלמה: תת-הסעיפים נשמרים ── */
p = I.renamePlan_(rows, 'מזון', '', 'אוכל', '');
ok('קטגוריה שלמה: כל ארבע השורות', p.length === 4, p.length);
ok('קטגוריה שלמה: תת-הסעיף נשמר',
   p.map(h => h.subcategory).join(',') === 'בית קפה,בית קפה,מסעדה,סופרמרקט',
   p.map(h => h.subcategory).join(','));
ok('קטגוריה שלמה: קניות לא נגעה', !p.some(h => h.row.Category === 'קניות'));

/* ── מה שכבר בשם הנכון אינו נכתב מחדש ── */
ok('אין שינוי → אין כתיבה', I.renamePlan_(rows, 'מזון', 'מסעדה', 'מזון', 'מסעדה').length === 0);
ok('יעד שווה למקור בקטגוריה שלמה', I.renamePlan_(rows, 'מזון', '', 'מזון', '').length === 0);

/* ── שורות ריקות / ערכי null אינם מפילים ── */
ok('שורה ריקה לא נתפסת', !I.renamePlan_(rows, '', '', 'x', 'y').some(h => h.row._row === 7));
ok('null בשדות',
   I.renamePlan_([{ Category: null, Subcategory: undefined, _row: 2 }], 'מזון', '', 'x', '').length === 0);
ok('רווחים נחתכים',
   I.renamePlan_([R(' מזון ', ' מסעדה ', 2)], 'מזון', 'מסעדה', 'מזון', 'חדש').length === 1);
ok('קלט ריק', I.renamePlan_(null, 'a', '', 'b', '').length === 0);

/* ── קטגוריה שלמה כשהיעד כבר קיים = איחוד קטגוריות ── */
p = I.renamePlan_(rows, 'קניות', '', 'מזון', '');
ok('איחוד קטגוריות: השורה עוברת', p.length === 1 && p[0].category === 'מזון' && p[0].subcategory === 'ביגוד');

/* ── שדה השורה המקורי נשמר, כדי שהכותב יידע לאיזו שורה בגיליון ── */
ok('_row מוחזר', I.renamePlan_(rows, 'מזון', 'סופרמרקט', 'מזון', 'סופר')[0].row._row === 5);
ok('CATEGORY_COLS מיוצא', I.CATEGORY_COLS && I.CATEGORY_COLS[0] === 'Category');

console.log('\n' + (fail ? '❌ ' + fail + ' נכשלו מתוך ' + (pass + fail) : '✅ כל ' + pass + ' הבדיקות עברו'));
process.exit(fail ? 1 : 0);
