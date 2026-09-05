const L = require('./load.js');
const I = L.load('ingest.gs');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('❌ ' + n + (x !== undefined ? '  → ' + x : '')); } };

// צורה חדשה — ערך לכל שורה
let r = I.approveItems_({ items: [
  { id: 'E1', category: 'חו״ל', subcategory: 'קניות', tag: 'יוון 08.26' },
  { id: 'E2', category: 'מזון', subcategory: 'מסעדה' } ] });
ok('items: שתי שורות', r.length === 2, r.length);
ok('items: קטגוריה לכל שורה', r[0].cat === 'חו״ל' && r[1].cat === 'מזון');
ok('items: תג נכתב כשנשלח', r[0].hasTag === true && r[0].tag === 'יוון 08.26');
ok('items: בלי מפתח tag → לא נוגעים', r[1].hasTag === false, JSON.stringify(r[1]));
ok('items: tag ריק מפורש כן נכתב (מחיקת תג)',
   I.approveItems_({ items: [{ id: 'E1', category: 'מזון', tag: '' }] })[0].hasTag === true);

// צורה ישנה
r = I.approveItems_({ ids: ['E1', 'E2'], category: 'קניות', subcategory: 'כללי' });
ok('ids: שתי שורות', r.length === 2, r.length);
ok('ids: אותה קטגוריה לשתיהן', r[0].cat === 'קניות' && r[1].cat === 'קניות');
ok('ids: בלי tag → לא מוחק תגים', r[0].hasTag === false);

// שגיאות
let threw = false; try { I.approveItems_({ items: [{ id: 'E1' }] }); } catch (e) { threw = /קטגוריה/.test(e.message); }
ok('items: שורה בלי קטגוריה נופלת', threw);
threw = false; try { I.approveItems_({ ids: ['E1'] }); } catch (e) { threw = /קטגוריה/.test(e.message); }
ok('ids: בלי קטגוריה נופל', threw);
ok('ריק → מערך ריק', I.approveItems_({}).length === 0);
ok('items מנצח כשגם ids נשלח',
   I.approveItems_({ items: [{ id: 'A', category: 'x' }], ids: ['B','C'], category: 'y' }).length === 1);
ok("מזהה עם רווחים נחתך", I.approveItems_({ items: [{ id: '  E9 ', category: 'x' }] })[0].id === 'E9');
ok("שורה בלי id נשמטת", I.approveItems_({ items: [{ category: 'x' }, { id: 'E1', category: 'x' }] }).length === 1);
ok("Tag בעמודות", I.EXPENSE_COLS.indexOf('Tag') === I.EXPENSE_COLS.length - 1, I.EXPENSE_COLS.indexOf('Tag'));

console.log('\n' + (fail ? '❌ ' + fail + ' נכשלו מתוך ' + (pass + fail) : '✅ כל ' + pass + ' הבדיקות עברו'));
process.exit(fail ? 1 : 0);
