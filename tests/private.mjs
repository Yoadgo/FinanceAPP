/* טעינת נתוני בדיקה אמיתיים מ-tests/private (ב-.gitignore — הריפו ציבורי).
   מחזיר null אם הקובץ חסר, והבדיקה אומרת שהיא מדלגת. */
import { readFileSync, existsSync } from 'node:fs';
export function privateJson(name) {
  const p = new URL(`./private/${name}`, import.meta.url);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
/* תאריכים בקבצי הבדיקה שמורים כ-{"__d":"YYYY-MM-DD"} → Date בחצות מקומית,
   בדיוק כמו ש-readFile.js מייצר. */
export const revive = grid => grid.map(r => r.map(c => (c && typeof c === 'object' && c.__d)
  ? new Date(+c.__d.slice(0, 4), +c.__d.slice(5, 7) - 1, +c.__d.slice(8, 10)) : c));
