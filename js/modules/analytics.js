/* ================================================================
   ANALYTICS — cash-flow aggregation (pure logic, UI-free)
   ----------------------------------------------------------------
   Aggregates classified transactions into cash buckets, in USD.
   ILS rows (deposits, ₪ fees) are converted with the current FX rate
   so everything is comparable; callers convert back for display.
   Reused by the dashboard and the cash-flow page.
   ================================================================ */

const Analytics = (() => {

  const n = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;

  /* USD magnitude of a row: prefer the foreign (USD) total, else convert ILS. */
  function _usd(row, fx) {
    const f = n(row.TotalFX);
    if (Math.abs(f) > 0.001) return Math.abs(f);
    const ils = n(row.TotalILS);
    if (Math.abs(ils) > 0.001) return fx ? Math.abs(ils) / fx : Math.abs(ils);
    return 0;
  }

  // sub-category → bucket. Inflows are income/capital-in; outflows are costs.
  const INFLOW  = { DEPOSIT: 'deposits', CASH_DIVIDEND: 'dividends', CREDIT_INTEREST: 'interest', TAX_REFUND: 'taxRefund' };
  const OUTFLOW = { TRADE_COMMISSION: 'fees', MGMT_FEE: 'fees', DEBIT_INTEREST: 'debitInterest',
                    CAPITAL_GAIN_TAX: 'taxes', DIVIDEND_TAX: 'taxes', TAX_PAYMENT: 'taxes' };

  /* Returns totals (USD) + a date-sorted list of cash events. */
  function cashSummary(txns, fx) {
    const t = { deposits: 0, dividends: 0, interest: 0, taxRefund: 0,
                fees: 0, debitInterest: 0, taxes: 0, provision: 0 };
    const events = [];

    (txns || []).forEach(r => {
      const sub = r.subCategory;
      let bucket = null, sign = 0;
      let amt = _usd(r, fx);

      if (INFLOW[sub])        { bucket = INFLOW[sub];  sign =  1; }
      else if (OUTFLOW[sub])  { bucket = OUTFLOW[sub]; sign = -1; }
      else if (sub === 'TAX_PROVISION') {
        // מגן מס: TotalILS is 0; the ILS amount sits in Qty. Informational only.
        bucket = 'provision'; sign = 0;
        amt = fx ? Math.abs(n(r.Qty)) / fx : Math.abs(n(r.Qty));
      } else {
        return;   // stocks / FX / split / bonus → not a cash income/expense
      }

      t[bucket] += amt;
      events.push({
        date: r.Date, sub, category: r.category,
        symbol: (r.Symbol || '').toString().trim(),
        name: (r.Name || '').toString().trim(),
        amountUSD: sign * amt, sign,
      });
    });

    const inflow  = t.deposits + t.dividends + t.interest + t.taxRefund;
    const outflow = t.fees + t.debitInterest + t.taxes;
    return {
      ...t,
      inflow, outflow,
      net: inflow - outflow,                                   // includes capital deposits
      incomeNet: (t.dividends + t.interest + t.taxRefund) - outflow, // income only, ex-deposits
      events: events.sort((a, b) => new Date(b.date) - new Date(a.date)),
    };
  }

  /* Current cash balance (ILS) = most recent row's running CashBalanceILS. */
  function latestCashILS(txns) {
    let best = null, bestTs = -Infinity;
    (txns || []).forEach(r => {
      const ts = new Date(r.Date).getTime();
      const bal = n(r.CashBalanceILS);
      if (isFinite(ts) && ts >= bestTs && Math.abs(bal) > 0.0001) { bestTs = ts; best = bal; }
    });
    return best;   // null if unknown
  }

  return { cashSummary, latestCashILS };
})();
