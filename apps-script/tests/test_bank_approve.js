const L = require('./load.js');
const I = L.load('ingest.gs');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('❌ ' + n + (x !== undefined ? '  → ' + x : '')); } };
const B = I.BUCKETS_;

let r = I.bankApproveItems_({ items: [
  { id: 'B1', bucket: B.move,    category: 'רכישת דירה', freq: 'חד-פעמי' },
  { id: 'B2', bucket: B.spend,   category: 'מסים' } ] });
ok('שתי שורות', r.length === 2, r.length);
ok('דלי נכתב', r[0].bucket === B.move && r[1].bucket === B.spend);
ok('קטגוריה נכתבת כשנשלחה', r[0].hasCategory && r[0].category === 'רכישת דירה');
ok('תדירות נכתבת כשנשלחה', r[0].hasFreq && r[0].freq === 'חד-פעמי');

/* המפתח החסר — אותו לקח כמו Tag באשראי: לא לגעת, לא למחוק */
ok('בלי freq → לא נוגעים', r[1].hasFreq === false, JSON.stringify(r[1]));
ok('בלי tag → לא נוגעים', r[1].hasTag === false);
ok('בלי subcategory → לא נוגעים', r[1].hasSub === false);
ok('ערך ריק מפורש כן נכתב (מחיקה)',
   I.bankApproveItems_({ items: [{ id: 'B1', bucket: B.move, tag: '' }] })[0].hasTag === true);

/* דלי הוא השדה היחיד שחובה */
let threw = false;
try { I.bankApproveItems_({ items: [{ id: 'B1' }] }); } catch (e) { threw = /דלי/.test(e.message); }
ok('שורה בלי דלי נופלת', threw);
threw = false;
try { I.bankApproveItems_({ items: [{ id: 'B1', bucket: 'משהו' }] }); } catch (e) { threw = /לא מוכר/.test(e.message); }
ok('דלי לא מוכר נופל', threw);
ok('קטגוריה אינה חובה',
   I.bankApproveItems_({ items: [{ id: 'B1', bucket: B.capital }] }).length === 1);

/* ארבעת הדליים מתקבלים, ורק הם */
['income','spend','move','capital'].forEach(function (k) {
  ok('דלי ' + B[k] + ' מתקבל',
     I.bankApproveItems_({ items: [{ id: 'X', bucket: B[k] }] })[0].bucket === B[k]);
});

ok('שורה בלי id נשמטת',
   I.bankApproveItems_({ items: [{ bucket: B.move }, { id: 'B1', bucket: B.move }] }).length === 1);
ok('מזהה עם רווחים נחתך',
   I.bankApproveItems_({ items: [{ id: '  B9 ', bucket: B.move }] })[0].id === 'B9');
ok('ריק → מערך ריק', I.bankApproveItems_({}).length === 0);
ok('BANK_COLS מכיל את שדות ההחלטה',
   ['Bucket','Category','Subcategory','Freq','Tag'].every(c => I.BANK_COLS.indexOf(c) >= 0));

console.log('\n' + (fail ? '❌ ' + fail + ' נכשלו מתוך ' + (pass + fail) : '✅ כל ' + pass + ' הבדיקות עברו'));
process.exit(fail ? 1 : 0);
