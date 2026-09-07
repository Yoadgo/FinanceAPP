const P = require('../plan.gs');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('❌ ' + n + (x !== undefined ? '  → ' + x : '')); } };
const NOW = '2026-09-07T10:00:00.000Z';

const line = o => Object.assign({ kind: 'שורה', bucket: 'צריכה', category: 'דיור',
  label: 'עמותת שיכוני', key: 'עמותת שיכוני', amount: 800 }, o);
const env = o => Object.assign({ kind: 'מעטפה', bucket: 'צריכה', category: 'מזון',
  amount: 2000 }, o);

/* ══════════════ מזהה ══════════════ */
const id1 = P.planId_({ kind:'מעטפה', bucket:'צריכה', category:'מזון' });
ok('מזהה: יציב', id1 === P.planId_({ kind:'מעטפה', bucket:'צריכה', category:'מזון' }));
ok('מזהה: מתחיל ב-p', /^p[0-9a-z]+$/.test(id1), id1);
ok('מזהה: קטגוריה אחרת → מזהה אחר',
   id1 !== P.planId_({ kind:'מעטפה', bucket:'צריכה', category:'תחבורה' }));
ok('מזהה: סוג אחר → מזהה אחר',
   id1 !== P.planId_({ kind:'שורה', bucket:'צריכה', category:'מזון' }));
ok('מזהה: עברית לא שוברת', P.planId_({ kind:'שורה', label:'מופ"ת קבע' }).length > 1);

/* ══════════════ יצירה ══════════════ */
let r = P.planSaveItems_([], [line(), env()], NOW);
ok('יצירה: שתי שורות חדשות', r.appends.length === 2 && r.updates.length === 0);
ok('יצירה: מזהה הוקצה', /^p/.test(r.appends[0].PlanId), r.appends[0].PlanId);
ok('יצירה: Active ברירת מחדל', r.appends[0].Active === true);
ok('יצירה: חותמת זמן', r.appends[0].UpdatedAt === NOW);
ok('יצירה: כל העמודות', P.PLAN_COLS.every(c => c in r.appends[0]),
   P.PLAN_COLS.filter(c => !(c in r.appends[0])).join(','));

/* ══════════════ הסכום תמיד חיובי ══════════════ */
ok('סכום: מינוס הופך לחיובי',
   P.planSaveItems_([], [env({ amount: -2000 })], NOW).appends[0].Amount === 2000);
ok('סכום: מחרוזת עם פסיק → 0 ולא NaN',
   P.planSaveItems_([], [env({ amount: 'שלוש מאות' })], NOW).appends[0].Amount === 0);
ok('סכום: ריק → 0',
   P.planSaveItems_([], [env({ amount: null })], NOW).appends[0].Amount === 0);

/* ══════════════ עדכון במקום ══════════════ */
const existing = [{ _row: 2, PlanId: id1, Kind:'מעטפה', Bucket:'צריכה', Category:'מזון',
                    Amount: 2000, Active: true, Notes: 'הערה ישנה' }];
r = P.planSaveItems_(existing, [env({ id: id1, amount: 2500 })], NOW);
ok('עדכון: לא נוצרה שורה כפולה', r.updates.length === 1 && r.appends.length === 0);
ok('עדכון: השורה הנכונה', r.updates[0]._row === 2);
ok('עדכון: הסכום החדש', r.updates[0].obj.Amount === 2500);
ok('עדכון: הערה קיימת נשמרת כשלא נשלחה', r.updates[0].obj.Notes === 'הערה ישנה');
ok('עדכון: הערה חדשה דורסת',
   P.planSaveItems_(existing, [env({ id: id1, notes: 'חדשה' })], NOW).updates[0].obj.Notes === 'חדשה');

/* עדכון בלי מזהה — המפתח הטבעי מוצא את השורה הקיימת */
r = P.planSaveItems_(existing, [env({ amount: 3000 })], NOW);
ok('עדכון: מפתח טבעי מוצא שורה קיימת', r.updates.length === 1 && r.appends.length === 0);

/* ⚠️ שינוי שם לשורה קיימת — המפתח הטבעי משתנה. בלי העדפת המזהה
   היינו מוסיפים שורה שנייה ומשאירים יתומה בגיליון.               */
const exLine = [{ _row: 3, PlanId: 'pABC', Kind:'שורה', Bucket:'צריכה',
                  Category:'דיור', Label:'עמותת שיכוני', Key:'עמותת שיכוני', Amount: 800 }];
r = P.planSaveItems_(exLine, [line({ id: 'pABC', label: 'ועד בית' })], NOW);
ok('שינוי שם: מעדכן ולא משכפל', r.updates.length === 1 && r.appends.length === 0,
   JSON.stringify({ u: r.updates.length, a: r.appends.length }));
ok('שינוי שם: השם החדש נכתב', r.updates[0].obj.Label === 'ועד בית');
ok('שינוי שם: המזהה נשמר', r.updates[0].obj.PlanId === 'pABC');

/* ══════════════ ביטול = Active=false, לא מחיקה ══════════════ */
r = P.planSaveItems_(existing, [env({ id: id1, active: false })], NOW);
ok('ביטול: השורה נשארת', r.updates.length === 1);
ok('ביטול: מסומנת לא-פעילה', r.updates[0].obj.Active === false);

/* ══════════════ מה נדחה ══════════════ */
const bad = (o, why) => {
  const x = P.planSaveItems_([], [o], NOW);
  ok('דחייה: ' + why, x.appends.length === 0 && x.updates.length === 0 && x.skipped.length === 1,
     JSON.stringify(x.skipped));
};
bad(env({ kind: 'משהו' }),        'סוג לא מוכר');
bad(env({ kind: '' }),            'בלי סוג');
bad(env({ category: '' }),        'מעטפה בלי קטגוריה');
bad(line({ label: '' }),          'שורה בלי שם');
bad(env({ bucket: 'העברה' }),     'דלי העברה');
bad(env({ bucket: 'הון' }),       'דלי הון');
bad(env({ bucket: '' }),          'בלי דלי');

/* ⚠️ שתי שורות זהות בשליחה אחת היו יוצרות שתי שורות בגיליון עם
   אותו מזהה — ומאותו רגע כל עדכון היה נוגע רק באחת מהן.         */
r = P.planSaveItems_([], [env(), env()], NOW);
ok('כפילות: רק אחת נוצרת', r.appends.length === 1 && r.skipped.length === 1,
   JSON.stringify({ a: r.appends.length, s: r.skipped.length }));

/* ══════════════ קלטים ריקים ══════════════ */
['', null, undefined, []].forEach((v, i) => {
  const x = P.planSaveItems_([], v, NOW);
  ok('ריק #' + i + ': לא מתפוצץ', x.appends.length === 0 && x.updates.length === 0);
});
ok('שורות קיימות ריקות', P.planSaveItems_(null, [env()], NOW).appends.length === 1);

/* שורה קיימת בלי מזהה בגיליון (יועד הקליד ידנית) — לא מפילה כלום */
ok('גיליון: שורה ידנית בלי מזהה',
   P.planSaveItems_([{ _row: 2, PlanId: '', Category: 'מזון' }], [env()], NOW).appends.length === 1);

/* ══════════════ רווחים ══════════════ */
r = P.planSaveItems_([], [env({ category: '  מזון  ' })], NOW);
ok('ניקוי: רווחים נחתכים', r.appends[0].Category === 'מזון', '[' + r.appends[0].Category + ']');
ok('ניקוי: אותו מזהה כמו בלי רווחים', r.appends[0].PlanId === id1);

/* ══════════════ תערובת ══════════════ */
r = P.planSaveItems_(existing,
  [env({ id: id1, amount: 2200 }), line(), env({ kind: 'לא קיים' })], NOW);
ok('תערובת: עדכון + יצירה + דחייה',
   r.updates.length === 1 && r.appends.length === 1 && r.skipped.length === 1,
   JSON.stringify({ u: r.updates.length, a: r.appends.length, s: r.skipped.length }));

console.log('\n' + (fail ? '❌ ' + fail + ' נכשלו מתוך ' + (pass + fail) : '✅ כל ' + pass + ' הבדיקות עברו'));
process.exit(fail ? 1 : 0);
