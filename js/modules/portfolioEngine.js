/* ================================================================
   PORTFOLIO ENGINE  —  FIFO position calculator (pure logic)
   ----------------------------------------------------------------
   Input : enriched transactions (rows already run through Classifier).
   Output: open positions, one per (portfolio, symbol) pair.

   DESIGN PRINCIPLES (the lessons that fixed the broken engine):

   1. LEDGER IS KEYED BY (portfolio, symbol) — NOT by symbol alone.
      A symbol held in two portfolios (e.g. QQQ in both איביאי-יועד
      and איביאי-דר) must stay as two independent positions. Keying
      by symbol alone merged them and mislabelled the portfolio with
      whichever transaction happened to be processed last.

   2. SPLITS ARE DRIVEN BY THE BROKER'S "הטבה" ROWS — no hardcoded
      corporate-actions table. The broker (IBI) reports a split as a
      הטבה row carrying the actual share delta (e.g. TSLA +44). We
      derive the ratio from that delta and scale existing lots. The
      old code did BOTH a hardcoded pre-split normalization AND a
      split event → it counted every split twice (TSLA showed 337
      instead of 205; GOOGL ballooned from 0 to a ghost 380).

   3. COST BASIS = pure trade value (qty × ExecutionRate). Commissions
      and fees are tracked separately as cash events, not folded into
      the cost basis — consistent with the rest of the app.
   ================================================================ */

const PortfolioEngine = (() => {

  /* ── Helpers ── */
  const n = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;

  /* Stock ticker = 1–5 capital letters (TSLA, QQQ, NOW…).
     Numeric instrument codes are broker/tax instruments, never positions. */
  const isTicker = sym => /^[A-Z]{1,5}$/.test(sym);

  /* Resolve BUY / SELL from classification, with a raw-Type fallback for
     anything the classifier didn't catch by exact type. */
  function _action(row) {
    const sub = row.subCategory;
    if (sub === 'BUY_STOCK')  return 'BUY';
    if (sub === 'SELL_STOCK') return 'SELL';
    const t = (row.Type || '').trim();
    if (t.includes('קני'))  return 'BUY';
    if (t.includes('מכיר')) return 'SELL';
    return null;
  }

  function _isBuyLike(row) {
    return row.subCategory === 'BUY_STOCK' ||
           row.subCategory === 'SPLIT'     ||   // splits add shares → treat as buy-side in tiebreak
           (row.Type || '').includes('קני');
  }

  /* ── Which rows participate in the FIFO ledger ──
     Include: STOCKS (BUY_STOCK / SELL_STOCK) + SPLIT events.
     Exclude: BONUS, cash, fees, taxes, FX. BONUS (reverse-split style
     negative-qty הטבה) is intentionally NOT included — adding it back
     would re-open closed positions.
     Fallback: UNCLASSIFIED rows that look like trades by raw Type. */
  function _isRelevant(row) {
    if (row.category === 'STOCKS') return true;
    if (row.subCategory === 'SPLIT') return true;
    if (row.category === 'UNCLASSIFIED' || !row.subCategory) {
      const t = (row.Type || '').trim();
      return t.includes('קני') || t.includes('מכיר');
    }
    return false;
  }

  /* ── Deterministic ordering ──
     The data has dates but no intraday time (every row on a day shares the
     same timestamp), so we apply explicit tiebreakers:
       1. chronological by date
       2. same date → BUY/SPLIT before SELL (a long-only book can't sell
          before it buys; keeps positions from going transiently negative)
       3. same date & side → original sheet row order                       */
  function _sorted(rows) {
    return rows
      .map((r, _sheetIdx) => ({ ...r, _sheetIdx }))
      .sort((a, b) => {
        const dateDiff = new Date(a.Date) - new Date(b.Date);
        if (dateDiff !== 0) return dateDiff;
        const aBuy = _isBuyLike(a), bBuy = _isBuyLike(b);
        if (aBuy && !bBuy) return -1;
        if (!aBuy && bBuy) return  1;
        return a._sheetIdx - b._sheetIdx;
      });
  }

  /* ═══════════════════════════════════════════════════
     computePositions — the FIFO ledger
     ══════════════════════════════════════════════════ */
  function computePositions(transactions) {
    const ledger = {};                    // key: `${portfolio}|${symbol}`

    const relevant = _sorted(transactions.filter(_isRelevant));

    relevant.forEach(row => {
      const sym = (row.Symbol || '').toString().trim().toUpperCase();
      if (!sym || !isTicker(sym)) return;

      const port = (row.Portfolio || '').trim();
      const key  = `${port}|${sym}`;
      if (!ledger[key]) ledger[key] = { symbol: sym, portfolio: port, qty: 0, lots: [], realizedPnl: 0 };
      const item = ledger[key];

      /* ── SPLIT: scale existing lots by the broker-reported share delta ──
         ratio = (held + delta) / held. qty grows, cost-per-share shrinks
         proportionally → total cost basis is preserved and lot dates are
         kept intact for FIFO. No hardcoded ratios. */
      if (row.subCategory === 'SPLIT') {
        const delta = Math.abs(n(row.Qty));
        if (item.qty > 0.001 && delta > 0) {
          const ratio = (item.qty + delta) / item.qty;
          item.qty += delta;
          item.lots.forEach(l => { l.qty *= ratio; l.costPerShare /= ratio; });
        }
        return;
      }

      const action = _action(row);
      if (!action) return;

      // *** Math.abs is critical — sell rows arrive with negative Qty ***
      const qty   = Math.abs(n(row.Qty));
      const price = Math.abs(n(row.ExecutionRate));
      if (!qty) return;

      // Cost per share: prefer ExecutionRate; fall back to TotalFX / qty.
      const costPerShare = price > 0 ? price : Math.abs(n(row.TotalFX)) / qty;

      if (action === 'BUY') {
        item.qty += qty;
        item.lots.push({ qty, costPerShare, date: row.Date });

      } else { // SELL — peel oldest lots first (FIFO), accumulate realized P&L
        let remaining = qty;
        let costOfSold = 0;
        while (remaining > 0.0001 && item.lots.length > 0) {
          const lot = item.lots[0];
          if (lot.qty > remaining) {
            costOfSold += remaining * lot.costPerShare;
            lot.qty    -= remaining;
            remaining   = 0;
          } else {
            costOfSold += lot.qty * lot.costPerShare;
            remaining  -= lot.qty;
            item.lots.shift();
          }
        }
        item.realizedPnl += qty * price - costOfSold;
        item.qty -= qty;

        // Guard against data errors within a single portfolio (a SELL with
        // no matching BUY). Without this the position would carry a phantom
        // negative qty. Reset and surface it rather than silently corrupt.
        if (item.qty < -0.0001) {
          console.warn(`[PortfolioEngine] ${key}: sell exceeded holdings — clamping qty ${item.qty.toFixed(4)} → 0`);
          item.qty = 0;
          item.lots = [];
        }
      }
    });

    return Object.values(ledger)
      .filter(p => p.qty > 0.01)
      .map(p => {
        const totalCost = p.lots.reduce((s, l) => s + l.qty * l.costPerShare, 0);
        return {
          symbol:      p.symbol,
          portfolio:   p.portfolio,
          qty:         p.qty,
          totalCost,
          avgCost:     p.qty > 0 ? totalCost / p.qty : 0,
          lots:        p.lots,
          realizedPnl: p.realizedPnl,
        };
      });
  }

  return { computePositions };
})();
