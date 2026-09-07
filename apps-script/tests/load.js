/* טוען קובץ .gs כמודול node. הקבצים הם JS רגיל; הסיומת בלבד שונה,
   ו-node מסרב לטעון .gs ישירות. אין כאן שכתוב — הקוד שנבדק הוא בדיוק
   הקוד שרץ ב-Apps Script.                                              */
const fs = require('fs'), path = require('path');
function load(name) {
  const code = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const m = { exports: {} };
  new Function('module', 'exports', code)(m, m.exports);
  return m.exports;
}
/* טוען כמה קבצי .gs לאותו סקופ, כמו ש-Apps Script עושה בפועל. נחוץ
   כשפונקציה בקובץ אחד קוראת לפונקציה מקובץ אחר — למשל detectKind_
   ב-ingest.gs שקורא ל-isBankSheet_ ב-bankParser.gs. טעינה בנפרד הייתה
   מסתירה בדיוק את סוג התקלה שהבדיקה אמורה לתפוס.                     */
function loadAll(names) {
  const code = names.map(n =>
    fs.readFileSync(path.join(__dirname, '..', n), 'utf8')).join('\n;\n');
  const m = { exports: {} };
  new Function('module', 'exports', code)(m, m.exports);
  return m.exports;
}
module.exports = { load, loadAll };

