/* ================================================================
   MARKET — מחירים, שינוי יומי, היסטוריה ושער דולר–שקל.

   המקור: הגיליון "FinanceAPP — מחירים" (נוסחאות GOOGLEFINANCE),
   מפורסם לאינטרנט כ-CSV. אין Apps Script ואין שרת.
   הדפדפן מושך אותו, ושומר את התוצאה ב-Firestore:
     market/latest           — מחיר ושינוי יומי לכל נייר + שער
     market/px_{SYM}_{YEAR}   — סגירות יומיות
     market/fx_{YEAR}         — שער יומי
   כך המשתמש השני לא מושך שוב, ויש מחיר (עם התאריך שלו) גם כשהגיליון
   לא זמין. כל מחיר נושא את התאריך שלו (חוק UX 3).
   ================================================================ */
import { PRICES_URL } from '../config.js';
import * as store from './store.js';
import { parseCsv } from '../ingest/csv.js';
import { parsePricesSheet } from '../engines/pricesSheet.js';
import { docsFromHistory } from '../engines/series.js';
import { yearDocsFromSeries } from '../engines/fx.js';
import { todayIso } from './format.js';

/* כמה זמן תמונת המחירים נחשבת עדכנית. בשעות המסחר live.js מבקש 5
   דקות; מחוצה להן 6 שעות (אין מה לרענן). */
const FRESH_MIN_DEFAULT = 360;

async function fetchSheet(latestOnly) {
  if (!PRICES_URL) throw new Error('כתובת גיליון המחירים עוד לא הוגדרה');
  const url = latestOnly ? `${PRICES_URL}${PRICES_URL.includes('?') ? '&' : '?'}range=A1:BZ3` : PRICES_URL;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`גיליון המחירים החזיר ${res.status}`);
  return parsePricesSheet(parseCsv(await res.text()));
}

/* המחירים האחרונים. מרענן אם ישן, ולא נכשל בגלל זה: אם הגיליון לא
   עונה — מוחזר המחיר האחרון הידוע + הסיבה. */
export async function latest({ maxAgeMin = FRESH_MIN_DEFAULT } = {}) {
  const cached = await store.get('market', 'latest');
  const age = cached && cached.fetchedAt ? (Date.now() - Date.parse(cached.fetchedAt)) / 60000 : Infinity;
  if (!PRICES_URL || age < maxAgeMin) return { data: cached, refreshError: PRICES_URL ? null : 'גיליון המחירים עוד לא מחובר' };
  try {
    const p = await fetchSheet(true);
    if (!Object.keys(p.latest).length) throw new Error(p.problems[0] || 'גיליון המחירים ריק');
    const asOf = todayIso();
    const prices = {};
    Object.entries(p.latest).forEach(([s, v]) => { prices[s] = { ...v, asOf }; });
    const data = { asOf, prices, fx: p.fx.USDILS ? { USDILS: { rate: p.fx.USDILS.rate, asOf } } : {}, fetchedAt: new Date().toISOString() };
    await store.put('market', 'latest', data, { isNew: !cached });
    return { data, refreshError: null, problems: p.problems };
  } catch (e) {
    return { data: cached, refreshError: e.message || String(e) };
  }
}

/* משיכת כל ההיסטוריה (כ-1.5MB) וכתיבתה למסד. פעם אחת במיגרציה, ואחר
   כך לפי לחיצה ("רענון היסטוריה"). */
export async function refreshHistory({ onProgress } = {}) {
  const p = await fetchSheet(false);
  const items = [];
  Object.entries(p.history).forEach(([sym, rows]) => {
    if (sym === 'USDILS') yearDocsFromSeries(rows.map(([date, rate]) => ({ date, rate }))).forEach(y => items.push({ id: `fx_${y.year}`, data: y }));
    else items.push(...docsFromHistory(sym, rows));
  });
  await store.putMany('market', items, { onProgress });
  return { symbols: Object.keys(p.history).length, docs: items.length, problems: p.problems };
}
