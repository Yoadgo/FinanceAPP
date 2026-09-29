/* ================================================================
   SPEND DATA — טעינה אחת לכל ארבעת מסכי ההוצאות, עם מטמון.
   אחרי כל כתיבה (אישור קבוצה, תיקון שורה) המסך קורא ל-clearSpendCache
   ומצייר מחדש — כך אף מספר לא נשאר ישן אחרי שינוי.

   עלות: ~574 שורות אשראי + ~77 עו"ש + כמה עשרות כללים וקטגוריות =
   כ-700 קריאות לטעינה מלאה. המכסה היומית: 50,000. ה-SDK שומר מטמון
   מקומי (persistentLocalCache), כך שמעבר בין המסכים לא קורא שוב.
   ================================================================ */
import * as store from '../../core/store.js';
import { rowOf, catMap } from '../../engines/spend.js';

let cache = null;

export async function loadSpend({ force = false } = {}) {
  if (cache && !force) return cache;
  const [expenses, bank, categories, rules, loans] = await Promise.all([
    store.list('expenses'), store.list('bank'), store.list('categories'), store.list('rules'), store.get('settings', 'loans'),
  ]);
  const rows = expenses.map(rowOf);
  cache = { expenses, rows, bank, categories, rules, loans, cats: catMap(categories, rows) };
  return cache;
}

export function clearSpendCache() { cache = null; }

/* עדכון מקומי אחרי כתיבה מוצלחת — בלי לחכות לקריאה מחדש. השורות
   שהשתנו מקבלות את השדות החדשים, והמפות נבנות מחדש. */
export function applyLocal(coll, updates) {
  if (!cache) return;
  const list = cache[coll === 'expenses' ? 'expenses' : 'bank'];
  const byId = new Map(list.map(d => [d.id, d]));
  updates.forEach(u => { const d = byId.get(u.id); if (d) Object.assign(d, u.fields); });
  if (coll === 'expenses') { cache.rows = cache.expenses.map(rowOf); cache.cats = catMap(cache.categories, cache.rows); }
}
