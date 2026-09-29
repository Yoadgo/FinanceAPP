/* ערכת בדיקות מינימלית — בלי ספרייה. כל קובץ בדיקה מייבא מכאן. */
export const results = { pass: 0, fail: 0, failures: [] };
let current = '';
export function section(name) { current = name; console.log(`\n═══ ${name} ═══`); }
export function ok(cond, msg) {
  if (cond) results.pass++;
  else { results.fail++; results.failures.push(`${current}: ${msg}`); console.log(`  ✗ ${msg}`); }
}
export function eq(a, b, msg) {
  ok(Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9),
     `${msg} — קיבלתי ${JSON.stringify(a)}, ציפיתי ${JSON.stringify(b)}`);
}
export function info(msg) { console.log(`  · ${msg}`); }
