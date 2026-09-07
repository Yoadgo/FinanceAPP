/* ===== GOALS — יעדי חיסכון =====
   טאב `Goals` מחזיק יעדים, וטאב `Bank` מחזיק את הכסף. החיבור ביניהם
   הוא עמודת `GoalId` שכבר שמורה שם מהיום הראשון.

   ⚠️ **ליעד יש מקור אמת אחד ליתרה, ולעולם לא שניים.** בגרסה הזו
   המקור הוא `תיוג`: יתרה = `Opening` + סכום שורות העו״ש שמסומנות
   ליעד. המקור השני שתוכנן — `תיק`, שבו היתרה נקראת משווי תיק
   השקעות — שמור בעמודה `Source` ואינו ממומש עדיין. הסיבה שהוא לא
   פשוט "עוד אפשרות": העברה לתיק שמסומנת ליעד **ושווי התיק** הם
   אותו כסף. יעד שיסכם את שניהם יציג פי שניים ממה שיש, וזה בדיוק
   הכלל שכבר נקבע במסך התזרים — אסור לחבר תזרים ומאזן.

   ⚠️ **`Opening` היא הודאה, לא הערכה.** ״כבר יש לי ₪X ביעד הזה
   מלפני שהתחלתי לעקוב״ — מספר שיועד מקליד פעם אחת, עם חותמת זמן,
   כדי שלא יצטרך לסמן שנתיים אחורה.

   ⚠️ **`Monthly` היא הקצאה, לא חישוב.** היעדים מתחרים על אותו עודף
   חודשי, והמסך מזהיר כשסך ההקצאות עולה עליו. מנגנון שלא יכול
   להגיד ״לא״ אינו שווה את הקוד שלו.                                */

var GOAL_COLS = ['GoalId', 'Name', 'Target', 'Monthly', 'Deadline', 'Priority',
                 'Source', 'LinkedPortfolio', 'Opening', 'Active', 'Notes', 'UpdatedAt'];

var GOAL_SOURCE_ = { tagged: 'תיוג', portfolio: 'תיק' };

function goalsSheet_(ss) { return ensureSheetWithCols_(ss, 'Goals', GOAL_COLS); }

function goalStr_(v) { return v == null ? '' : String(v).trim(); }
function goalNum_(v) { var x = Number(v); return isFinite(x) ? x : 0; }

/* מזהה קצר וקריא בגיליון. **מחושב רק בשרת**, כמו ב-Plan. */
function goalId_(name) {
  var s = goalStr_(name), h = 2166136261;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return 'g' + h.toString(36);
}

/* ---------------------------------------------------------------
   טהור: מה נשלח → מה נכתב. בלי גיליון.
   --------------------------------------------------------------- */
function goalsSaveItems_(rows, items, now) {
  var out = { updates: [], appends: [], skipped: [] };
  if (!items || !items.length) return out;

  var byId = {};
  (rows || []).forEach(function (r) {
    var id = goalStr_(r.GoalId);
    if (id) byId[id] = r;
  });

  var seen = {};
  items.forEach(function (it) {
    var name = goalStr_(it.name);
    if (!name) { out.skipped.push({ name: '', why: 'יעד בלי שם' }); return; }

    var target = Math.abs(goalNum_(it.target));
    if (!(target > 0)) { out.skipped.push({ name: name, why: 'יעד בלי סכום' }); return; }

    var src = goalStr_(it.source) || GOAL_SOURCE_.tagged;
    /* ⛔ המקור השני עוד לא ממומש. לקבל אותו בשקט היה מייצר יעדים
       שהמסך לא יודע לחשב, והם היו מציגים ״₪0 נחסך״ לנצח.        */
    if (src !== GOAL_SOURCE_.tagged) {
      out.skipped.push({ name: name, why: 'מקור יתרה שאינו תיוג עוד לא נתמך' }); return;
    }

    var id = goalStr_(it.id) || goalId_(name);
    if (seen[id]) { out.skipped.push({ name: name, why: 'כפול באותה שליחה' }); return; }
    seen[id] = 1;

    var prev = byId[id];
    var obj = {
      GoalId: id, Name: name, Target: target,
      Monthly: Math.abs(goalNum_(it.monthly)),
      Deadline: goalStr_(it.deadline),
      Priority: goalNum_(it.priority) || 0,
      Source: src,
      LinkedPortfolio: goalStr_(it.linkedPortfolio),
      Opening: Math.abs(goalNum_(it.opening)),
      Active: it.active === undefined ? true : !!it.active,
      Notes: it.notes === undefined ? (prev ? (prev.Notes || '') : '') : goalStr_(it.notes),
      UpdatedAt: now
    };

    if (prev) out.updates.push({ _row: prev._row, obj: obj });
    else out.appends.push(obj);
  });

  return out;
}

function saveGoals_(ss, body) {
  var e = goalsSheet_(ss);
  var t = readTable_(e.sheet);
  var headers = t.headers && t.headers.length ? t.headers : e.headers;
  var now = nowIso_();

  var g = goalsSaveItems_(t.rows, body && body.items, now);

  g.updates.forEach(function (u) { writeRow_(e.sheet, headers, u._row, u.obj); });

  if (g.appends.length) {
    var start = e.sheet.getLastRow() + 1;
    var lines = g.appends.map(function (o) { return objToLine_(headers, o); });
    e.sheet.getRange(start, 1, lines.length, headers.length).setValues(lines);
  }

  return { updated: g.updates.length, created: g.appends.length,
           skipped: g.skipped, requested: (body && body.items ? body.items.length : 0) };
}

/* ---------------------------------------------------------------
   שיוך תנועות עו״ש ליעד.
   `goalId` ריק = ביטול שיוך, וזו פעולה לגיטימית ולא שגיאה: טעות
   בשיוך חייבת להיות הפיכה בלחיצה, אחרת איש לא יסמן.
   כתיבה בבלוק אחד, כמו `approveBank_` — כתיבה שורה-שורה על 77
   שורות היא 77 קריאות ל-API והיא נתקעת.
   --------------------------------------------------------------- */
function assignGoal_(ss, body) {
  var goal = goalStr_(body && body.goalId);
  var ids = (body && body.ids) || [];
  if (!ids.length) throw new Error('לא נשלחו שורות לשיוך');

  /* יעד שאינו קיים אינו שיוך אלא באג שקט: השורה הייתה נושאת מזהה
     שאף מסך לא יודע לפרש, והכסף היה נעלם מכל יעד.               */
  if (goal) {
    var gt = readTable_(goalsSheet_(ss).sheet);
    var known = false;
    gt.rows.forEach(function (r) { if (goalStr_(r.GoalId) === goal) known = true; });
    if (!known) throw new Error('יעד לא מוכר: ' + goal);
  }

  var want = {};
  ids.forEach(function (x) { var s = goalStr_(x); if (s) want[s] = 1; });

  var e = bankSheet_(ss), t = readTable_(e.sheet);
  if (!t.rows.length) return { updated: 0, requested: ids.length };

  var iG = t.headers.indexOf('GoalId'), iU = t.headers.indexOf('UpdatedAt');
  if (iG < 0) throw new Error('אין עמודת GoalId בטאב Bank');

  var first = t.rows[0]._row, last = t.rows[t.rows.length - 1]._row;
  var block = e.sheet.getRange(first, 1, last - first + 1, t.headers.length);
  var vals = block.getValues(), now = nowIso_(), n = 0;

  t.rows.forEach(function (r) {
    if (!want[goalStr_(r.Id)]) return;
    var i = r._row - first;
    vals[i][iG] = goal;
    if (iU >= 0) vals[i][iU] = now;
    n++;
  });
  if (n) block.setValues(vals);

  return { updated: n, requested: ids.length, goalId: goal, cleared: !goal };
}

/* ---------------------- נקודות קצה ---------------------- */

function goalsApiRead_(ss, r) {
  if (r !== 'goals') return null;
  var sh = ss.getSheetByName('Goals');
  return { values: sh ? sh.getDataRange().getValues() : [GOAL_COLS] };
}

function goalsApiWrite_(ss, action, body) {
  if (action === 'goals.save')   return saveGoals_(ss, body);
  if (action === 'goals.assign') return assignGoal_(ss, body);
  return null;
}

if (typeof module !== 'undefined') module.exports = {
  GOAL_COLS: GOAL_COLS, GOAL_SOURCE_: GOAL_SOURCE_,
  goalId_: goalId_, goalsSaveItems_: goalsSaveItems_
};
