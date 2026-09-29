/* מריץ את כל הבדיקות: node tests/run.mjs
   בדיקות שדורשות נתונים אמיתיים (tests/private, לא בריפו) מדלגות
   בלעדיהם ואומרות את זה — לא "עוברות" בשקט. */
import { readdirSync } from 'node:fs';
import { results } from './lib.mjs';
/* הבדיקות רצות בשעון ישראל — שם האפליקציה רצה. באג היום-אחורה בעו"ש
   (30.9.2026) היה בלתי נראה בשעון UTC. להריץ גם ב-UTC: TZ=UTC node … */
if (!process.env.TZ) process.env.TZ = 'Asia/Jerusalem';
const files = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.test.mjs')).sort();
for (const f of files) await import(`./${f}`);
console.log(`\n${results.fail ? '✗' : '✓'} ${results.pass} עברו · ${results.fail} נכשלו`);
if (results.fail) { results.failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
