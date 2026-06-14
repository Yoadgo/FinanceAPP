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

  /* ═══════════════════════════════════════════════════
     computeClosedTrades — realized round-trips (FIFO)
     ─────────────────────────────────────────────────
     Every SELL is matched against the oldest open lots; each produces a
     closed-trade record with cost basis, proceeds, P&L, %, and the
     quantity-weighted average holding period. Keyed per (portfolio, symbol),
     same split handling as computePositions. Used by the performance page.
     ══════════════════════════════════════════════════ */
  function computeClosedTrades(transactions) {
    const books = {};   // key `${portfolio}|${symbol}` → { lots: [{qty,cps,date}] }
    const trades = [];
    const relevant = _sorted(transactions.filter(_isRelevant));

    relevant.forEach(row => {
      const sym = (row.Symbol || '').toString().trim().toUpperCase();
      if (!sym || !isTicker(sym)) return;
      const port = (row.Portfolio || '').trim();
      const key  = `${port}|${sym}`;
      if (!books[key]) books[key] = { lots: [] };
      const b = books[key];

      if (row.subCategory === 'SPLIT') {
        const delta = Math.abs(n(row.Qty));
        const held  = b.lots.reduce((s, l) => s + l.qty, 0);
        if (held > 0.001 && delta > 0) {
          const ratio = (held + delta) / held;
          b.lots.forEach(l => { l.qty *= ratio; l.cps /= ratio; });
        }
        return;
      }

      const action = _action(row);
      if (!action) return;
      const qty   = Math.abs(n(row.Qty));
      const price = Math.abs(n(row.ExecutionRate));
      if (!qty) return;
      const cps = price > 0 ? price : Math.abs(n(row.TotalFX)) / qty;

      if (action === 'BUY') {
        b.lots.push({ qty, cps, date: row.Date });
      } else {
        let remaining = qty, cost = 0, weightedDays = 0;
        const sellMs = new Date(row.Date).getTime();
        while (remaining > 0.0001 && b.lots.length > 0) {
          const lot  = b.lots[0];
          const take = Math.min(lot.qty, remaining);
          cost         += take * lot.cps;
          weightedDays += take * ((sellMs - new Date(lot.date).getTime()) / 86400000);
          lot.qty      -= take;
          remaining    -= take;
          if (lot.qty < 0.0001) b.lots.shift();
        }
        const filled   = qty - remaining;
        if (filled <= 0.0001) return;     // sell with no matching buy — skip
        const proceeds = filled * price;
        trades.push({
          symbol: sym, portfolio: port,
          sellDate: row.Date,
          qty: filled,
          buyAvg:  cost / filled,
          sellPrice: price,
          cost, proceeds,
          pnl: proceeds - cost,
          pnlPct: cost > 0 ? ((proceeds - cost) / cost) * 100 : 0,
          holdDays: filled > 0 ? weightedDays / filled : 0,
        });
      }
    });

    return trades.sort((a, b) => new Date(b.sellDate) - new Date(a.sellDate));
  }

  /* ═══════════════════════════════════════════════════
     computeEquityCurve — time series of cash / realized / unrealized
     ─────────────────────────────────────────────────
     Reconstructs, at a monthly grid from the first trade to today:
       • cash       — running cash (USD) from all flows (buys/sells, deposits,
                      dividends, interest, fees, taxes).
       • realized   — cumulative realized P&L from closed round-trips.
       • unrealized — holdings market value − cost basis, valued with each
                      symbol's split-adjusted historical close on that date.
     historyMap: { SYMBOL: [{date, close}, ...] }. fxRate converts ILS flows.
     ══════════════════════════════════════════════════ */
  function _usdAmt(r, fx) {
    const f = n(r.TotalFX);
    if (Math.abs(f) > 0.001) return Math.abs(f);
    const ils = n(r.TotalILS);
    if (Math.abs(ils) > 0.001) return fx ? Math.abs(ils) / fx : Math.abs(ils);
    return 0;
  }

  function computeEquityCurve(txns, historyMap, fxRate, step = 'month') {
    if (!txns || !txns.length) return [];
    const relevant = _sorted(txns.filter(_isRelevant)).filter(r => {
      const s = (r.Symbol || '').toString().trim().toUpperCase();
      return s && isTicker(s);
    });
    if (!relevant.length) return [];

    // Split events per symbol (date,ratio), derived from broker rows.
    const runQ = {}, splitEv = {}, seen = new Set();
    relevant.forEach(r => {
      const sym = r.Symbol.toString().trim().toUpperCase();
      const key = `${(r.Portfolio || '').trim()}|${sym}`;
      const q = Math.abs(n(r.Qty));
      if (r.subCategory === 'SPLIT') {
        const held = runQ[key] || 0;
        if (held > 0.001 && q > 0) {
          const dk = `${sym}|${(r.Date || '').toString().slice(0, 10)}`;
          if (!seen.has(dk)) { (splitEv[sym] = splitEv[sym] || []).push({ t: new Date(r.Date).getTime(), ratio: (held + q) / held }); seen.add(dk); }
          runQ[key] = held + q;
        }
        return;
      }
      const act = _action(r); if (!act || !q) return;
      runQ[key] = (runQ[key] || 0) + (act === 'BUY' ? q : -q);
    });
    const factorAfter = (sym, t) => { let f = 1; (splitEv[sym] || []).forEach(e => { if (e.t > t) f *= e.ratio; }); return f; };

    // Realized (cumulative) from closed trades — keep symbol for per-symbol breakdown.
    const closedAsc = computeClosedTrades(txns)
      .map(c => ({ t: new Date(c.sellDate).getTime(), pnl: c.pnl, symbol: c.symbol }))
      .sort((a, b) => a.t - b.t);

    // Cash = the broker's actual running CashBalanceILS (→USD), not a
    // reconstruction — so the line matches the real account balance.
    const cashBal = txns
      .map(r => ({ t: new Date(r.Date).getTime(), ils: n(r.CashBalanceILS) }))
      .filter(x => isFinite(x.t) && Math.abs(x.ils) > 0.0001)
      .sort((a, b) => a.t - b.t);

    // Price history → sorted arrays + advancing pointers.
    const hist = {}, ptr = {};
    Object.entries(historyMap || {}).forEach(([s, rows]) => {
      hist[s.toUpperCase()] = (rows || [])
        .map(r => ({ t: new Date(r.date).getTime(), c: parseFloat(r.close) }))
        .filter(x => isFinite(x.t) && isFinite(x.c))
        .sort((a, b) => a.t - b.t);
    });
    const priceAt = (sym, t) => {
      const arr = hist[sym]; if (!arr || !arr.length) return null;
      let i = ptr[sym] || 0;
      while (i + 1 < arr.length && arr[i + 1].t <= t) i++;
      ptr[sym] = i;
      return arr[i].t > t ? null : arr[i].c;
    };

    // Holdings replay (per portfolio|symbol) advanced lazily to each grid date.
    const books = {}; let evi = 0;
    const applyUpTo = tLimit => {
      while (evi < relevant.length) {
        const r = relevant[evi];
        if (new Date(r.Date).getTime() > tLimit) break;
        evi++;
        const sym = r.Symbol.toString().trim().toUpperCase();
        const key = `${(r.Portfolio || '').trim()}|${sym}`;
        if (!books[key]) books[key] = { lots: [] };
        const b = books[key];
        const q = Math.abs(n(r.Qty));
        if (r.subCategory === 'SPLIT') {
          const held = b.lots.reduce((s, l) => s + l.qty, 0);
          if (held > 0.001 && q > 0) { const ratio = (held + q) / held; b.lots.forEach(l => { l.qty *= ratio; l.cps /= ratio; }); }
          continue;
        }
        const act = _action(r); if (!act || !q) continue;
        const price = Math.abs(n(r.ExecutionRate));
        const cps = price > 0 ? price : Math.abs(n(r.TotalFX)) / q;
        if (act === 'BUY') b.lots.push({ qty: q, cps });
        else { let rem = q; while (rem > 0.0001 && b.lots.length) { const lot = b.lots[0]; const take = Math.min(lot.qty, rem); lot.qty -= take; rem -= take; if (lot.qty < 0.0001) b.lots.shift(); } }
      }
    };

    // Grid from first trade to today — monthly (default) or daily (step='day').
    const firstT = new Date(relevant[0].Date).getTime();
    const grid = []; const now = Date.now();
    let d = new Date(firstT);
    if (step === 'day') {
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      while (d.getTime() <= now) { grid.push(d.getTime()); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); }
    } else {
      d = new Date(d.getFullYear(), d.getMonth(), 1);
      while (d.getTime() <= now) { grid.push(d.getTime()); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
    }
    if (!grid.length || grid[grid.length - 1] !== now) grid.push(now);

    const points = [];
    const realBySym = {};
    let cashIls = 0, realized = 0, cbi = 0, ri = 0;
    grid.forEach(gt => {
      while (cbi < cashBal.length && cashBal[cbi].t <= gt) cashIls = cashBal[cbi++].ils;
      const cash = fxRate ? cashIls / fxRate : cashIls;
      while (ri < closedAsc.length && closedAsc[ri].t <= gt) {
        realized += closedAsc[ri].pnl;
        realBySym[closedAsc[ri].symbol] = (realBySym[closedAsc[ri].symbol] || 0) + closedAsc[ri].pnl;
        ri++;
      }
      applyUpTo(gt);

      const bySymHold = {};
      Object.entries(books).forEach(([key, b]) => {
        const sym = key.split('|')[1];
        const q = b.lots.reduce((s, l) => s + l.qty, 0);
        const cost = b.lots.reduce((s, l) => s + l.qty * l.cps, 0);
        if (!bySymHold[sym]) bySymHold[sym] = { q: 0, cost: 0 };
        bySymHold[sym].q += q; bySymHold[sym].cost += cost;
      });
      let mv = 0, costBasis = 0;
      // Per-symbol total P&L (unrealized + realized) — for the returns breakdown.
      const bySym = {};
      const allSyms = new Set([...Object.keys(bySymHold), ...Object.keys(realBySym)]);
      allSyms.forEach(sym => {
        const o = bySymHold[sym] || { q: 0, cost: 0 };
        costBasis += o.cost;
        let unrSym = 0;
        if (o.q > 0.001) {
          const px = priceAt(sym, gt);
          const valSym = px != null ? o.q * factorAfter(sym, gt) * px : o.cost;
          mv += valSym;
          unrSym = valSym - o.cost;
        }
        bySym[sym] = unrSym + (realBySym[sym] || 0);
      });
      points.push({ t: gt, cash, realized, unrealized: mv - costBasis, marketValue: mv, bySym });
    });
    return points;
  }

  return { computePositions, computeClosedTrades, computeEquityCurve };
})();
