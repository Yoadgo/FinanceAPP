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

/* מחירים היסטוריים (market/px_SYM_YEAR) ושערים (market/fx_YEAR). */
export async function loadMarket({ force = false } = {}) {
  if (marketCache && !force) return marketCache;
  const docs = await store.list('market');
  const history = historyFromDocs(docs.filter(d => /^px_/.test(d.id)));
  const fx = makeFxSeries(seriesFromYearDocs(docs.filter(d => /^fx_\d{4}$/.test(d.id))));
  const latest = docs.find(d => d.id === 'latest') || null;
  marketCache = { history, fx, latest };
  return marketCache;
}

export function clearInvestCache() { cache = null; marketCache = null; }
