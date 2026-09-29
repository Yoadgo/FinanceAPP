/* ================================================================
   CSV — פענוח CSV לפי RFC 4180: מרכאות, פסיקים בתוך מרכאות, שורה
   חדשה בתוך מרכאות, ומרכאות כפולות ("") כמרכאה אחת. זה הפורמט
   שגוגל שיטס מייצא (קובץ ← הורדה ← CSV).
   מחזיר מערך של שורות, כל שורה מערך של מחרוזות. בלי המרת טיפוסים —
   ההמרה היא החלטה של מי שקורא, לא של המפענח.
   ================================================================ */
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');   // BOM של אקסל
  const rows = [];
  let row = [], field = '', i = 0, q = false;
  while (i < s.length) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

/* שורה ראשונה = כותרות → מערך אובייקטים. כותרת כפולה או ריקה נשמרת
   בשם עם מספר, כדי שעמודה לא תדרוס עמודה בשקט. */
export function toObjects(rows) {
  if (!rows.length) return { headers: [], objects: [] };
  const seen = {};
  const headers = rows[0].map((h, i) => {
    let k = String(h).trim() || `col${i + 1}`;
    if (seen[k]) k = `${k}_${++seen[k]}`; else seen[k] = 1;
    return k;
  });
  const objects = rows.slice(1).map((r, idx) => {
    const o = { _row: idx + 2 };               // מספר השורה בגיליון (כותרת = 1)
    headers.forEach((h, i) => { o[h] = r[i] === undefined ? '' : r[i]; });
    return o;
  });
  return { headers, objects };
}
