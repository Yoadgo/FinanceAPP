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
module.exports = { load };
