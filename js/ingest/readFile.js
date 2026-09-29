/* ================================================================
   READ FILE — קובץ xls/xlsx מהדפדפן → מערך דו-ממדי בצורה שהמפענחים
   מכירים (אותה צורה ש-getValues() של Apps Script החזירה).

   הספרייה: SheetJS 0.20.3 — הספרייה החיצונית היחידה מלבד Firebase,
   אושרה ב-29.9.2026. נטענת רק כשנכנסים למסך הקליטה, לא בכל פתיחה.

   שתי מלכודות שהקובץ הזה סוגר:
   1. **עמודה A ריקה.** בקבצי האשראי של הבינלאומי עמודה A ריקה לגמרי,
      ו-SheetJS מדווח את טווח הגיליון מ-B. קריאה "רגילה" מזיזה כל עמודה
      אחת שמאלה — והמפענח, שמחפש תאריך בעמודה 1, לא מוצא אף עסקה.
      לכן הקריאה כאן מתחילה תמיד מ-A1, בלי קשר למה שהטווח אומר.
   2. **תאריכים ואזור זמן.** תא תאריך נקרא כמספר סידורי של אקסל ומומר
      ידנית ל-Date בחצות **מקומית** (new Date(y, m, d)). כך היום לא זז
      ביום אחד בגלל אזור זמן — והמפענח (שקורא getFullYear/getDate
      מקומיים) מקבל בדיוק את היום שבקובץ.
   ================================================================ */
import { sha256Hex } from '../engines/hash.js';

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

let loading = null;
export function loadSheetJS() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SHEETJS_URL;
      s.onload = () => resolve(globalThis.XLSX);
      s.onerror = () => { loading = null; reject(new Error('לא ניתן לטעון את ספריית קריאת הקבצים (SheetJS). בדוק חיבור ונסה שוב.')); };
      document.head.append(s);
    });
  }
  return loading;
}

/* גיליון → מערך דו-ממדי מ-A1. פונקציה טהורה: מקבלת את XLSX מבחוץ,
   ולכן נבדקת ב-node. */
export function sheetToValues(XLSX, ws) {
  if (!ws || !ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const out = [];
  for (let r = 0; r <= range.e.r; r++) {            // מ-0, לא מ-range.s.r
    const row = [];
    for (let c = 0; c <= range.e.c; c++) {          // מ-0, לא מ-range.s.c
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      row.push(cellValue(XLSX, cell));
    }
    out.push(row);
  }
  return out;
}

function cellValue(XLSX, cell) {
  if (!cell) return '';
  if (cell.t === 'n') {
    if (cell.z && XLSX.SSF.is_date(cell.z)) {
      const p = XLSX.SSF.parse_date_code(cell.v);
      if (p) return new Date(p.y, p.m - 1, p.d);
    }
    return cell.v;
  }
  if (cell.t === 'd') {
    const d = cell.v instanceof Date ? cell.v : new Date(cell.v);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (cell.t === 's' || cell.t === 'str') return cell.v == null ? '' : String(cell.v);
  if (cell.t === 'b') return cell.v;
  return '';                                        // 'e' (שגיאה), 'z' (ריק)
}

export function workbookToSheets(XLSX, data) {
  const wb = XLSX.read(data, { type: 'array', cellDates: false, cellNF: true, raw: false });
  return wb.SheetNames.map(name => ({ name, values: sheetToValues(XLSX, wb.Sheets[name]) }));
}

/* File (מגרירה או מבחירה) → { name, size, hash, sheets } */
export async function readWorkbookFile(file) {
  const XLSX = await loadSheetJS();
  const buf = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Hex(buf);
  const sheets = workbookToSheets(XLSX, buf);
  return { name: file.name, size: file.size, hash, sheets };
}
