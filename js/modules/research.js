/* ================================================================
   RESEARCH — alpha attribution against a benchmark (pure logic)
   ----------------------------------------------------------------
   Answers, from data that already exists, the three questions Yoad
   picked: did I beat the index · which trades worked · what does the
   friction cost.

   THE METHOD, AND THE TWO THAT WERE REJECTED
   ------------------------------------------
   ✗ Shadow portfolio ("buy IVV every time he bought"). Breaks the
     moment the picks beat the index: the sale proceeds exceed what the
     shadow holds, and the shadow goes short. A number with no meaning.
   ✗ IRR vs IRR. Mathematically fine, returns one figure, explains
     nothing, and cannot say which trade was good.
   ✓ Per-FIFO-slice alpha. For every slice of capital, compare what it
     did over its OWN window to what the benchmark did over the SAME
     days:
         alpha% = (sell/buy − 1) − (bench(sellDate)/bench(buyDate) − 1)
         alpha$ = costBasis × alpha%
     Exact, no shorting, handles partial sells (each slice carries its
     own lot date), and it doubles as the answer to "which trades
     worked" — +5% while the index did +12% is a LOSING trade.

   WHAT THIS NUMBER IS NOT
   -----------------------
   It measures SECURITY SELECTION, not the portfolio. Cash sitting idle
   between trades is not in it, and neither is the ILS→USD timing. Both
   are real questions; both need the FX history that no endpoint exposes
   yet. Saying so is cheaper than a number that quietly means something
   else.

   AS-OF CONSISTENCY
   -----------------
   Open slices are valued at the last CLOSE, not the live price, and the
   benchmark is read at that same date. A live price for the stock
   against yesterday's close for the index would put a day of market
   move into "alpha". So this page's unrealized figures can differ
   slightly from the portfolio screen's — on purpose.
   ================================================================ */

const Research = (() => {

  const DAY = 86400000;
  const n = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;

  /* ── Price series → sorted array + "last close at or before t" ──
     Binary search rather than a moving pointer: slices are iterated in
     lot order, not date order, so a pointer would walk backwards.       */
  function series(rows) {
    const arr = (rows || [])
      .map(r => ({ t: new Date(r.date).getTime(), c: parseFloat(r.close) }))
      .filter(x => isFinite(x.t) && isFinite(x.c) && x.c > 0)
      .sort((a, b) => a.t - b.t);
    return {
      arr,
      first: arr.length ? arr[0].t : null,
      last:  arr.length ? arr[arr.length - 1].t : null,
      lastClose: arr.length ? arr[arr.length - 1].c : null,
      at(t) {
        if (!arr.length || !isFinite(t) || t < arr[0].t) return null;
        let lo = 0, hi = arr.length - 1, best = null;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (arr[mid].t <= t) { best = arr[mid].c; lo = mid + 1; } else hi = mid - 1;
        }
        return best;
      },
    };
  }

  function buildSeriesMap(historyMap) {
    const out = {};
    Object.entries(historyMap || {}).forEach(([sym, rows]) => {
      out[sym.toUpperCase()] = series(rows);
    });
    return out;
  }

  /* ═══════════════════════════════════════════════════
     alpha — the engine
     ─────────────────────────────────────────────────
     slices     : PortfolioEngine.computeLotSlices(enrichedTxns)
     seriesMap  : { SYMBOL: series() }  — from buildSeriesMap
     benchSymbol: 'IVV' | 'QQQ'
     ══════════════════════════════════════════════════ */
  function alpha(slices, seriesMap, benchSymbol) {
    const bench = seriesMap[(benchSymbol || '').toUpperCase()];
    const rows = [];
    const skipped = { noBench: [], noPrice: [], badData: [] };

    /* Open slices are marked to the benchmark's last close so that every
       open position in the table shares one as-of date. Using each
       symbol's own last date would compare windows of different lengths. */
    const asOfOpen = bench ? bench.last : null;

    (slices || []).forEach(s => {
      const buyT  = new Date(s.buyDate).getTime();
      const buyPx = Number(s.buyPrice);
      if (!isFinite(buyT) || !(buyPx > 0) || !(s.qty > 0)) { skipped.badData.push(s); return; }

      let sellPx, sellT;
      if (s.open) {
        const own = seriesMap[s.symbol];
        if (!own || own.lastClose == null || asOfOpen == null) { skipped.noPrice.push(s); return; }
        sellPx = own.at(asOfOpen) != null ? own.at(asOfOpen) : own.lastClose;
        sellT  = asOfOpen;
      } else {
        sellPx = Number(s.sellPrice);
        sellT  = new Date(s.sellDate).getTime();
        if (!isFinite(sellT) || !(sellPx > 0)) { skipped.badData.push(s); return; }
      }

      const b0 = bench ? bench.at(buyT)  : null;
      const b1 = bench ? bench.at(sellT) : null;
      if (!(b0 > 0) || !(b1 > 0)) { skipped.noBench.push(s); return; }

      const cost      = s.qty * buyPx;
      const value     = s.qty * sellPx;
      const pnl       = value - cost;
      const ret       = sellPx / buyPx - 1;
      const benchRet  = b1 / b0 - 1;
      const benchPnl  = cost * benchRet;

      rows.push({
        symbol: s.symbol, portfolio: s.portfolio, open: s.open,
        qty: s.qty, buyPrice: buyPx, sellPrice: sellPx,
        buyDate: s.buyDate, sellDate: s.open ? null : s.sellDate,
        asOf: sellT,
        holdDays: Math.max(0, (sellT - buyT) / DAY),
        cost, value, pnl, ret,
        benchRet, benchPnl,
        alphaPct: ret - benchRet,
        alphaUsd: pnl - benchPnl,
        beat: (ret - benchRet) > 0,
      });
    });

    return { rows, skipped, benchSymbol: (benchSymbol || '').toUpperCase(), covered: !!bench };
  }

  /* ── Totals. Weighted returns use cost basis, never a mean of percentages:
        a $50 slice and a $50,000 slice are not one vote each.            */
  function totals(rows) {
    const t = {
      count: rows.length, closed: 0, open: 0,
      cost: 0, value: 0, pnl: 0, benchPnl: 0, alphaUsd: 0,
      wins: 0, losses: 0, beats: 0, misses: 0,
      costClosed: 0, pnlClosed: 0, benchPnlClosed: 0,
      costOpen: 0, pnlOpen: 0, benchPnlOpen: 0,
      weightedHoldDays: 0,
    };
    rows.forEach(r => {
      t.cost += r.cost; t.value += r.value; t.pnl += r.pnl;
      t.benchPnl += r.benchPnl; t.alphaUsd += r.alphaUsd;
      t.weightedHoldDays += r.cost * r.holdDays;
      if (r.pnl > 0) t.wins++; else if (r.pnl < 0) t.losses++;
      if (r.beat) t.beats++; else t.misses++;
      if (r.open) { t.open++; t.costOpen += r.cost; t.pnlOpen += r.pnl; t.benchPnlOpen += r.benchPnl; }
      else        { t.closed++; t.costClosed += r.cost; t.pnlClosed += r.pnl; t.benchPnlClosed += r.benchPnl; }
    });
    t.ret        = t.cost > 0 ? t.pnl / t.cost : 0;
    t.benchRet   = t.cost > 0 ? t.benchPnl / t.cost : 0;
    t.alphaPct   = t.ret - t.benchRet;
    t.avgHoldDays= t.cost > 0 ? t.weightedHoldDays / t.cost : 0;
    t.winRate    = t.count ? t.wins / t.count : 0;
    t.beatRate   = t.count ? t.beats / t.count : 0;
    return t;
  }

  /* ── Group rows by any key, each group carrying its own totals ── */
  function groupBy(rows, keyFn, labelFn) {
    const g = {};
    rows.forEach(r => {
      const k = keyFn(r);
      if (k === null || k === undefined) return;
      (g[k] = g[k] || []).push(r);
    });
    return Object.entries(g).map(([k, list]) => ({
      key: k,
      label: labelFn ? labelFn(k, list) : k,
      rows: list,
      ...totals(list),
    }));
  }

  /* ── The segmentation dimensions for "which trades worked" ──
     Buckets are fixed, not quantiles: quantiles move every time a trade
     is added, so last month's conclusion cannot be compared to this
     month's. Fixed edges keep the answer stable.                        */
  const HOLD_BUCKETS = [
    { max: 7,        label: 'עד שבוע' },
    { max: 30,       label: 'שבוע עד חודש' },
    { max: 90,       label: 'חודש עד רבעון' },
    { max: 365,      label: 'רבעון עד שנה' },
    { max: Infinity, label: 'מעל שנה' },
  ];
  const SIZE_BUCKETS = [
    { max: 1000,     label: 'עד $1,000' },
    { max: 5000,     label: '$1,000–$5,000' },
    { max: 20000,    label: '$5,000–$20,000' },
    { max: Infinity, label: 'מעל $20,000' },
  ];
  const _bucket = (v, defs) => (defs.find(b => v <= b.max) || defs[defs.length - 1]).label;
  const _order  = defs => defs.map(b => b.label);

  function segments(rows) {
    const byHold = groupBy(rows, r => _bucket(r.holdDays, HOLD_BUCKETS));
    const bySize = groupBy(rows, r => _bucket(r.cost, SIZE_BUCKETS));
    const ho = _order(HOLD_BUCKETS), so = _order(SIZE_BUCKETS);
    return {
      byHold:      byHold.sort((a, b) => ho.indexOf(a.key) - ho.indexOf(b.key)),
      bySize:      bySize.sort((a, b) => so.indexOf(a.key) - so.indexOf(b.key)),
      bySymbol:    groupBy(rows, r => r.symbol).sort((a, b) => b.alphaUsd - a.alphaUsd),
      byPortfolio: groupBy(rows, r => r.portfolio || '—').sort((a, b) => b.cost - a.cost),
      byYear:      groupBy(rows, r => { const y = new Date(r.asOf).getFullYear(); return isFinite(y) ? String(y) : null; })
                     .sort((a, b) => Number(b.key) - Number(a.key)),
    };
  }

  return { series, buildSeriesMap, alpha, totals, groupBy, segments,
           HOLD_BUCKETS, SIZE_BUCKETS };
})();
