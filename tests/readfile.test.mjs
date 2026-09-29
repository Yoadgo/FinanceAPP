/* קריאת קובץ אקסל → מערך. שתי המלכודות: עמודה A ריקה, ותאריך שזז
   ביום בגלל אזור זמן. נבדק עם SheetJS אמיתי אם הוא זמין בסביבת
   הבדיקה (XLSX_PATH), אחרת מדלג ואומר זאת. */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { section, ok, eq, info } from './lib.mjs';
import { sheetToValues, workbookToSheets } from '../js/ingest/readFile.js';
import { parseCreditSheet } from '../js/engines/creditParser.js';

const P = process.env.XLSX_PATH || '/tmp/sjs/package/xlsx.js';
if (!existsSync(P)) info(`SheetJS לא נמצא ב-${P} — מדלג על בדיקת קריאת הקבצים`);
else {
  const XLSX = createRequire(import.meta.url)(P);
  section(`קריאת קבצים (SheetJS ${XLSX.version})`);

  /* גיליון בצורת פירוט אשראי: עמודה A ריקה לגמרי, תאריך כמספר סידורי
     עם פורמט תאריך, כמו ש-xls של הבינלאומי מגיע. */
  const ws = {};
  const put = (addr, cell) => { ws[addr] = cell; };
  put('B1', { t: 's', v: 'כרטיס:5519 - אמקס  חודש החיוב: 02/07/2026' });
  put('B2', { t: 's', v: 'עסקאות בשקלים חיוב בתאריך 02/07/2026' });
  ['תאריך עסקה', 'שם  העסק', 'סכום עסקה', 'סכום חיוב', 'פירוט'].forEach((h, i) => put(String.fromCharCode(66 + i) + '3', { t: 's', v: h }));
  put('B4', { t: 'n', v: 46023, z: 'dd/mm/yyyy' });          // 2026-01-01
  put('C4', { t: 's', v: 'שופרסל' }); put('D4', { t: 'n', v: 100 }); put('E4', { t: 'n', v: 100 });
  put('B5', { t: 's', v: 'סה"כ' }); put('E5', { t: 'n', v: 100 });
  ws['!ref'] = 'B1:F5';                                        // הטווח מתחיל ב-B — המלכודת

  const v = sheetToValues(XLSX, ws);
  eq(v[0].length, 6, 'הקריאה מתחילה מעמודה A גם כשהטווח מתחיל ב-B');
  eq(v[0][0], '', 'עמודה A ריקה');
  ok(v[3][1] instanceof Date, 'תא תאריך → Date');
  eq(`${v[3][1].getFullYear()}-${v[3][1].getMonth() + 1}-${v[3][1].getDate()}`, '2026-1-1', 'היום לא זז (חצות מקומית)');
  const p = parseCreditSheet(v);
  eq(p.rows.length, 1, 'המפענח מוצא את העסקה');
  eq(p.sections[0].balanced, true, 'והמקטע מאוזן');

  /* הלוך-חזור דרך קובץ xls אמיתי (BIFF8) — הפורמט הישן של הבינלאומי */
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Activities');
  const bytes = XLSX.write(wb, { bookType: 'biff8', type: 'array' });
  const sheets = workbookToSheets(XLSX, new Uint8Array(bytes));
  const v2 = sheets[0].values;
  eq(sheets[0].name, 'Activities', 'שם הגיליון');
  eq(parseCreditSheet(v2).rows.length, 1, 'xls (BIFF8) נקרא ומפוענח');
  ok(v2[3][1] instanceof Date && v2[3][1].getDate() === 1, 'התאריך שורד את הקובץ');
}
