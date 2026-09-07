const G = require('../goals.gs');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('❌ ' + n + (x !== undefined ? '  → ' + x : '')); } };
const NOW = '2026-09-07T10:00:00.000Z';
const g = o => Object.assign({ name: 'רכב', target: 80000, monthly: 5000 }, o);

/* ── מזהה ── */
const id1 = G.goalId_('רכב');
ok('מזהה: יציב', id1 === G.goalId_('רכב'));
ok('מזהה: מתחיל ב-g', /^g[0-9a-z]+$/.test(id1), id1);
ok('מזהה: שם אחר → מזהה אחר', id1 !== G.goalId_('טיול'));

/* ── יצירה ── */
let r = G.goalsSaveItems_([], [g(), g({ name: 'קרן חירום', target: 30000, monthly: 2000 })], NOW);
ok('יצירה: שניים', r.appends.length === 2 && r.updates.length === 0);
ok('יצירה: כל העמודות', G.GOAL_COLS.every(c => c in r.appends[0]),
   G.GOAL_COLS.filter(c => !(c in r.appends[0])).join(','));
ok('יצירה: Active ברירת מחדל', r.appends[0].Active === true);
ok('יצירה: מקור ברירת מחדל תיוג', r.appends[0].Source === 'תיוג', r.appends[0].Source);
ok('יצירה: חותמת זמן', r.appends[0].UpdatedAt === NOW);

/* ── סכומים חיוביים ── */
ok('סכום: מינוס → חיובי', G.goalsSaveItems_([], [g({ target: -500 })], NOW).appends[0].Target === 500);
ok('הקצאה: מינוס → חיובי', G.goalsSaveItems_([], [g({ monthly: -50 })], NOW).appends[0].Monthly === 50);
ok('פתיחה: טקסט → 0', G.goalsSaveItems_([], [g({ opening: 'הרבה' })], NOW).appends[0].Opening === 0);

/* ── עדכון ── */
const ex = [{ _row: 2, GoalId: id1, Name: 'רכב', Target: 80000, Monthly: 5000, Notes: 'ישן' }];
r = G.goalsSaveItems_(ex, [g({ id: id1, monthly: 6000 })], NOW);
ok('עדכון: לא כפילות', r.updates.length === 1 && r.appends.length === 0);
ok('עדכון: השורה הנכונה', r.updates[0]._row === 2);
ok('עדכון: הקצאה חדשה', r.updates[0].obj.Monthly === 6000);
ok('עדכון: הערה נשמרת', r.updates[0].obj.Notes === 'ישן');
ok('עדכון: מפתח טבעי מוצא שורה קיימת', G.goalsSaveItems_(ex, [g()], NOW).updates.length === 1);

/* ⚠️ שינוי שם ליעד קיים — בלי העדפת המזהה נוצר יעד שני והתיוגים
   של הישן היו נשארים יתומים בטאב Bank. */
r = G.goalsSaveItems_(ex, [g({ id: id1, name: 'רכב חדש' })], NOW);
ok('שינוי שם: מעדכן ולא משכפל', r.updates.length === 1 && r.appends.length === 0);
ok('שינוי שם: המזהה נשמר', r.updates[0].obj.GoalId === id1);
ok('שינוי שם: השם החדש נכתב', r.updates[0].obj.Name === 'רכב חדש');

/* ── ביטול ── */
r = G.goalsSaveItems_(ex, [g({ id: id1, active: false })], NOW);
ok('ביטול: השורה נשארת', r.updates.length === 1);
ok('ביטול: לא-פעיל', r.updates[0].obj.Active === false);

/* ── דחיות ── */
const bad = (o, why) => {
  const x = G.goalsSaveItems_([], [o], NOW);
  ok('דחייה: ' + why, x.appends.length === 0 && x.updates.length === 0 && x.skipped.length === 1,
     JSON.stringify(x.skipped));
};
bad(g({ name: '' }),      'יעד בלי שם');
bad(g({ name: '   ' }),   'שם רווחים בלבד');
bad(g({ target: 0 }),     'יעד בלי סכום');
bad(g({ target: 'הרבה' }), 'סכום שאינו מספר');
/* ⛔ מקור ״תיק״ תוכנן אך לא מומש. קבלה שקטה שלו הייתה יוצרת יעד
   שהמסך לא יודע לחשב, והוא היה מציג ₪0 לנצח. */
bad(g({ source: 'תיק' }), 'מקור תיק עוד לא נתמך');
bad(g({ source: 'משהו' }), 'מקור לא מוכר');

r = G.goalsSaveItems_([], [g(), g()], NOW);
ok('כפילות: רק אחד נוצר', r.appends.length === 1 && r.skipped.length === 1,
   JSON.stringify({ a: r.appends.length, s: r.skipped.length }));

/* ── קלטים ריקים ── */
['', null, undefined, []].forEach((v, i) => {
  const x = G.goalsSaveItems_([], v, NOW);
  ok('ריק #' + i, x.appends.length === 0 && x.updates.length === 0);
});
ok('שורות קיימות null', G.goalsSaveItems_(null, [g()], NOW).appends.length === 1);
ok('שורה ידנית בלי מזהה',
   G.goalsSaveItems_([{ _row: 2, GoalId: '', Name: 'רכב' }], [g()], NOW).appends.length === 1);

/* ── ניקוי רווחים ── */
r = G.goalsSaveItems_([], [g({ name: '  רכב  ' })], NOW);
ok('ניקוי: רווחים נחתכים', r.appends[0].Name === 'רכב', '[' + r.appends[0].Name + ']');
ok('ניקוי: אותו מזהה', r.appends[0].GoalId === id1);

/* ── תערובת ── */
r = G.goalsSaveItems_(ex, [g({ id: id1, monthly: 7000 }), g({ name: 'טיול', target: 15000 }), g({ name: '' })], NOW);
ok('תערובת: עדכון + יצירה + דחייה',
   r.updates.length === 1 && r.appends.length === 1 && r.skipped.length === 1,
   JSON.stringify({ u: r.updates.length, a: r.appends.length, s: r.skipped.length }));

console.log('\n' + (fail ? '❌ ' + fail + ' נכשלו מתוך ' + (pass + fail) : '✅ כל ' + pass + ' הבדיקות עברו'));
process.exit(fail ? 1 : 0);
