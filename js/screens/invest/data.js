/* ================================================================
   INVEST DATA — טעינה משותפת לכל מסכי עולם ההשקעות (ולבית).
   מקום אחד שקורא תנועות, מסווג, מריץ את המנוע, וטוען מחירים ושערים —
   כדי שהאחזקות, הביצועים והבית לא יחשבו כל אחד בדרך משלו.
   ================================================================ */
import * as store from '../../core/store.js';
import { toEngineRow } from '../../engines/model.js';
import { Classifier } from '../../engines/classifier.js';
import { PortfolioEngine } from '../../engines/fifo.js';
import { historyFromDocs } from '../../engines/series.js';
import { makeFxSeries, seriesFromYearDocs } from '../../engines/fx.js';
import { refreshHistory } from '../../core/market.js';
import { BENCHMARK } from '../../config.js';

let cache = null, marketCache = null;

export async function loadInvest({ force = false } = {}) {
  if (cache && !force) return cache;
  const docs = await store.list('transactions');
  const rows = Classifier.enrichAll(docs.map(toEngineRow));
  const positions = PortfolioEngine.computePositions(rows);
  const portfolios = [...new Set(rows.map(r => r.Portfolio).filter(Boolean))].sort();
  const lastDate = rows.reduce((m, r) => (r.Date > m ? r.Date : m), '');
  cache = { docs, rows, positions, portfolios, lastDate };
  return cache;
}

/* האם יש מספיק היסטוריה כדי למדוד מול המדד ולצייר גרפים. לא "יש מסמך":
   הסגירה היומית (engines/closes.js) יוצרת מסמך עם סגירה אחת, וזה לא
   היסטוריה. (באג 2.10.2026: פסק דין "לא שווה" על בסיס סגירה אחת.) */
export const MIN_HISTORY = 200;
export const hasHistory = (market, sym = BENCHMARK) => ((market && market.history[sym]) || []).length >= MIN_HISTORY;

/* משיכה אוטומטית — פעם אחת לכל טעינת אפליקציה, אם ההיסטוריה חסרה.
   (יועד, 2.10.2026: "אמור להיות מנגנון" — הוא צדק: לא סביר שגרף יחכה
   ללחיצה במסך מיגרציה.) מיזוג, לא דריסה — ר' market.refreshHistory. */
let autoTried = false;
export let autoHistoryError = null;

/* מחירים היסטוריים (market/px_SYM_YEAR) ושערים (market/fx_YEAR). */
export async function loadMarket({ force = false } = {}) {
  if (marketCache && !force) return marketCache;
  let docs = await store.list('market');
  const benchCloses = docs.filter(d => d.id.startsWith(`px_${BENCHMARK}_`)).reduce((n, d) => n + Object.keys(d.closes || {}).length, 0);
  if (benchCloses < MIN_HISTORY && !autoTried) {
    autoTried = true;
    try { await refreshHistory(); docs = await store.list('market'); autoHistoryError = null; }
    catch (e) { autoHistoryError = e.message || String(e); }
  }
  const history = historyFromDocs(docs.filter(d => /^px_/.test(d.id)));
  const fx = makeFxSeries(seriesFromYearDocs(docs.filter(d => /^fx_\d{4}$/.test(d.id))));
  const latest = docs.find(d => d.id === 'latest') || null;
  marketCache = { history, fx, latest };
  return marketCache;
}

export function clearInvestCache() { cache = null; marketCache = null; }
