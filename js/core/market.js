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
import { PRICES_URL, HISTORY_URL } from '../config.js';
import * as store from './store.js';
import { parseCsv } from '../ingest/csv.js';
import { parsePricesSheet } from '../engines/pricesSheet.js';
import { docsFromHistory } from '../engines/series.js';
import { yearDocsFromSeries } from '../engines/fx.js';
import { todayIso } from './format.js';
import { closeTarget, closesFrom, mergeCloses, mergeHistoryDocs } from '../engines/closes.js';

/* כמה זמן תמונת המחירים נחשבת עדכנית. בשעות המסחר live.js מבקש 5
   דקות; מחוצה להן 6 שעות (אין מה לרענן). */
const FRESH_MIN_DEFAULT = 360;

async function fetchSheet(latestOnly) {
  if (!PRICES_URL) throw new Error('כתובת גיליון המחירים עוד לא הוגדרה');
  /* המחיר העדכני — מהטאב החי (נוסחאות). ההיסטוריה — מהטאב הקבוע (ר' config). */
  const url = latestOnly ? `${PRICES_URL}${PRICES_URL.includes('?') ? '&' : '?'}range=A1:BZ3` : (HISTORY_URL || PRICES_URL);
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
    const data = { asOf, prices, fx: p.fx.USDILS ? { USDILS: { rate: p.fx.USDILS.rate, asOf } } : {}, fetchedAt: new Date().toISOString(),
      closesFor: (cached && cached.closesFor) || '' };
    await store.put('market', 'latest', data, { isNew: !cached });
    try { await recordDailyCloses(data); } catch (e) { /* לא קריטי: ננסה ברענון הבא */ }
    return { data, refreshError: null, problems: p.problems };
  } catch (e) {
    return { data: cached, refreshError: e.message || String(e) };
  }
}

/* סגירה יומית — פעם ביום לכל היותר (הסימן closesFor ב-market/latest).
   כ-35 קריאות וכתיבות ביום, מתוך 50,000/20,000. */
export async function recordDailyCloses(data, now = new Date()) {
  const target = closeTarget(now);
  const key = `${target.date}|${target.mode}`;
  if (data.closesFor === key) return { written: 0, skipped: true };
  const closes = closesFrom(data.prices, target);
  const ids = [...new Set(closes.map(c => `px_${c.sym}_${c.date.slice(0, 4)}`))];
  const docs = await Promise.all(ids.map(id => store.get('market', id)));
  const existing = {};
  docs.forEach((d, i) => { if (d) existing[ids[i]] = d; });
  const changed = mergeCloses(existing, closes);
  if (changed.length) await store.putMany('market', changed);
  await store.patch('market', 'latest', { closesFor: key });
  data.closesFor = key;
  return { written: changed.length, target };
}

/* משיכת כל ההיסטוריה (כ-1.5MB) וכתיבתה למסד. פעם אחת במיגרציה, ואחר
   כך לפי לחיצה ("רענון היסטוריה"). */
export async function refreshHistory({ onProgress } = {}) {
  const p = await fetchSheet(false);
  if (!Object.keys(p.history).length) throw new Error(p.problems[0] || 'בגיליון לא נמצאה היסטוריה (אולי שוב "Loading..." — מלכודת 14 ב-CLAUDE.md)');
  const fx = [], px = [];
  Object.entries(p.history).forEach(([sym, rows]) => {
    if (sym === 'USDILS') yearDocsFromSeries(rows.map(([date, rate]) => ({ date, rate }))).forEach(y => fx.push({ id: `fx_${y.year}`, data: y }));
    else px.push(...docsFromHistory(sym, rows));
  });
  /* לא לדרוס סגירות שנרשמו כאן אחרי הצילום */
  const existing = {};
  (await store.list('market')).forEach(d => { if (/^px_/.test(d.id)) existing[d.id] = d; });
  const items = [...fx, ...mergeHistoryDocs(existing, px)];
  await store.putMany('market', items, { onProgress });
  return { symbols: Object.keys(p.history).length, docs: items.length, problems: p.problems };
}
