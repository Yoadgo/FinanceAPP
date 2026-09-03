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

  /* ── The tax-shield family carries its amount in Qty, not in a total ──
     For Type הפקדה / משיכה the broker writes TotalFX = 0 AND TotalILS = 0,
     and puts the ILS amount in **Qty** (with ExecutionRate = 100, Currency ₪ —
     it is quoted as a par-100 bond). Reading TotalILS returns 0, which is why
     ₪33,212 of tax that was actually paid was displayed as zero.
     Verified against the sheet 3.9.2026: all 94 משיכה rows and all 161 הפקדה
     rows have TotalILS = TotalFX = 0.                                        */
  const QTY_IS_ILS = { TAX_PROVISION: 1, TAX_ACCRUAL: 1, TAX_ACCRUAL_REV: 1,
                       TAX_RESET: 1, TAX_PAYMENT: 1 };

  /* USD magnitude of a row: prefer the foreign (USD) total, else convert ILS. */
  function _usd(row, fx) {
    if (QTY_IS_ILS[row.subCategory]) {
      const q = Math.abs(n(row.Qty));
      return fx ? q / fx : q;
    }
    const f = n(row.TotalFX);
    if (Math.abs(f) > 0.001) return Math.abs(f);
    const ils = n(row.TotalILS);
    if (Math.abs(ils) > 0.001) return fx ? Math.abs(ils) / fx : Math.abs(ils);
    return 0;
  }

  /* ── כיוון התנועה מול הכיוון הטבעי של הדלי ──
     `_usd` מחזירה גודל מוחלט, וזה נכון כל עוד כל שורה זורמת לכיוון שהדלי
     מצפה לו. שתי דוגמאות מהנתונים האמיתיים שמפרות את ההנחה:

       • `העברה מזומן בשח` בשם "משיכה מקובץ אקסל", 02/06/2026, ‎−₪100,000.
         זו **משיכה** שרשומה כהעברה. הערך המוחלט הפך אותה להפקדה, ולכן
         "הפקדות הון" הוצגו כ-₪937,800 במקום ₪737,800 — **תוספת פיקטיבית
         של ₪200,000**, שנכנסת גם ל-`invested` בגרף ההתפתחות.
       • שורות היפוך של דיבידנד בדוחות אלטשולר (+42.42 מול −42.42):
         זוג שמתקזז, שהערך המוחלט הופך לכפל הכנסה.

     לכן: שורה שסימנה **הפוך** מהכיוון הטבעי של הדלי היא **תיקון**, לא
     אירוע נוסף מאותו סוג — והיא נספרת בסימן שלילי בתוך הדלי.
     אומת מול הגיליון 3.9.2026: פרט לשורת ה-₪100,000, **אף שורה אחרת אינה
     סותרת את כיוון הדלי שלה** — כלומר התיקון הזה הוא no-op על כל השאר. */
  function _dir(row, expected) {
    var raw = n(row.TotalFX);
    if (!(Math.abs(raw) > 0.001)) raw = n(row.TotalILS);
    if (!(Math.abs(raw) > 0.001)) return 1;      // סכום שיושב ב-Qty — אין סימן לקרוא
    return (raw > 0 ? 1 : -1) === expected ? 1 : -1;
  }

  /* Native ILS magnitude — for buckets we refuse to fake-convert. */
  function _ils(row) {
    if (QTY_IS_ILS[row.subCategory]) return Math.abs(n(row.Qty));
    return Math.abs(n(row.TotalILS));
  }

  // sub-category → bucket. Inflows are income/capital-in; outflows are costs.
  const INFLOW  = { DEPOSIT: 'deposits', CASH_DIVIDEND: 'dividends', CREDIT_INTEREST: 'interest',
                    TAX_REFUND: 'taxRefund', BROKER_CREDIT: 'brokerCredit' };
  const OUTFLOW = { TRADE_COMMISSION: 'fees', MGMT_FEE: 'fees', DEBIT_INTEREST: 'debitInterest',
                    CAPITAL_GAIN_TAX: 'taxes', DIVIDEND_TAX: 'taxes', TAX_PAYMENT: 'taxes' };

  /* Returns totals (USD) + a date-sorted list of cash events. */
  function cashSummary(txns, fx) {
    const t = { deposits: 0, dividends: 0, interest: 0, taxRefund: 0, brokerCredit: 0,
                fees: 0, debitInterest: 0, taxes: 0, provision: 0, commission: 0 };

    /* ── Trade commission is NOT a row — it is a COLUMN on the trade row ──
       This is why the label TRADE_COMMISSION existed but nothing ever
       produced it, and why the fees bucket showed ₪270 of management fees
       while $5,006 of commission went uncounted. Read the column.
       Verified 3.9.2026: every non-zero Commission sits on a Currency='$'
       row, so no cross-currency mixing. The guard keeps it that way — an
       ILS-denominated commission would be converted, not silently added. */
    (txns || []).forEach(r => {
      if (r.category !== 'STOCKS') return;
      const c = Math.abs(n(r.Commission));
      if (!(c > 0)) return;
      const isIls = (r.Currency || '').toString().trim() === '₪';
      t.commission += isIls ? (fx ? c / fx : c) : c;
    });
    t.fees += t.commission;
    const events = [];

    (txns || []).forEach(r => {
      const sub = r.subCategory;
      let bucket = null, sign = 0;
      let amt = _usd(r, fx);

      if (INFLOW[sub])        { bucket = INFLOW[sub];  sign =  1; amt *= _dir(r,  1); }
      else if (OUTFLOW[sub])  { bucket = OUTFLOW[sub]; sign = -1; amt *= _dir(r, -1); }
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

    const inflow  = t.deposits + t.dividends + t.interest + t.taxRefund + t.brokerCredit;
    const outflow = t.fees + t.debitInterest + t.taxes;
    return {
      ...t,
      inflow, outflow,
      net: inflow - outflow,                                   // includes capital deposits
      incomeNet: (t.dividends + t.interest + t.taxRefund + t.brokerCredit) - outflow, // income only, ex-deposits
      events: events.sort((a, b) => new Date(b.date) - new Date(a.date)),
    };
  }

  /* Tax breakdown (USD) overall + per calendar year. */
  function taxSummary(txns, fx) {
    const SUB = { CAPITAL_GAIN_TAX: 'capitalGain', DIVIDEND_TAX: 'dividend', TAX_PAYMENT: 'payment',
                  TAX_REFUND: 'refund', TAX_PROVISION: 'provision' };
    /* TAX_ACCRUAL / TAX_ACCRUAL_REV / TAX_RESET are deliberately absent: they
       are internal movements of the tax shield, not tax. */
    const totals = { capitalGain: 0, dividend: 0, payment: 0, refund: 0, provision: 0 };
    const years = {};
    (txns || []).forEach(r => {
      const bucket = SUB[r.subCategory];
      if (!bucket) return;
      const amt = _usd(r, fx);   // _usd now reads Qty for the shield family
      totals[bucket] += amt;
      const y = new Date(r.Date).getFullYear();
      if (isFinite(y)) {
        if (!years[y]) years[y] = { year: y, capitalGain: 0, dividend: 0, payment: 0, refund: 0, provision: 0 };
        years[y][bucket] += amt;
      }
    });
    totals.totalTax = totals.capitalGain + totals.dividend;   // withheld at source
    return { ...totals, byYear: Object.values(years).sort((a, b) => b.year - a.year) };
  }

  /* Current total cash (ILS) = SUM of each portfolio's most recent running
     CashBalanceILS. CashBalanceILS is per-portfolio, so summing the latest
     balance of every portfolio gives the real account-wide cash. */
  function latestCashILS(txns) {
    const latestByPort = {};
    (txns || [])
      .map(r => ({ ts: new Date(r.Date).getTime(), port: (r.Portfolio || '').trim(), bal: n(r.CashBalanceILS) }))
      .filter(x => isFinite(x.ts) && Math.abs(x.bal) > 0.0001)
      .sort((a, b) => a.ts - b.ts)
      .forEach(x => { latestByPort[x.port] = x.bal; });
    const keys = Object.keys(latestByPort);
    return keys.length ? keys.reduce((s, k) => s + latestByPort[k], 0) : null;
  }


  /* ═══════════════════════════════════════════════════════════════════
     frictionSummary — what the account costs to operate
     ───────────────────────────────────────────────────────────────────
     Everything the broker takes, separated from everything the market
     gives. Built for one reason: until now the app answered "עמלות: ₪270"
     when the real figure was $5,006 of commission on top of it.

     Currency is kept honest. Each bucket carries its NATIVE amount —
     `usd` for dollar-denominated rows, `ils` for shekel ones — plus a
     `conv` field converted at TODAY'S rate. USD/ILS moved between 2.80
     and 4.08 over this data's lifetime (a 46% swing), so `conv` on a
     four-year total is an approximation and the UI must say so. The
     native figures are the ones that are exactly true.
     ═══════════════════════════════════════════════════════════════════ */
  function _bucket() { return { usd: 0, ils: 0, count: 0 }; }
  function _conv(b, fx) { return b.usd + (fx ? b.ils / fx : b.ils); }

  function frictionSummary(txns, fx) {
    const commission    = _bucket();   // trade commission — a COLUMN, not a row
    const mgmtFee       = _bucket();   // דמי טיפול
    const debitInterest = _bucket();   // ריבית חובה on margin/credit
    const withholding   = _bucket();   // foreign tax withheld at source
    const capGainTax    = _bucket();   // capital-gains tax actually PAID
    const dividends     = _bucket();
    const creditInterest= _bucket();
    const brokerCredit  = _bucket();
    const turnover      = { buys: 0, sells: 0 };
    const years         = {};
    const symbols       = {};

    const yr = r => { const y = new Date(r.Date).getFullYear(); return isFinite(y) ? y : null; };
    const bumpYear = (y, key, v) => {
      if (y === null || !(v > 0)) return;
      if (!years[y]) years[y] = { year: y, commission: 0, mgmtFee: 0, debitInterest: 0,
                                  withholding: 0, capGainTax: 0, income: 0, trades: 0, turnover: 0 };
      years[y][key] += v;
    };

    (txns || []).forEach(r => {
      const sub = r.subCategory, y = yr(r);
      const isIls = (r.Currency || '').toString().trim() === '₪';

      /* ── Trades: commission off the column, turnover off the total ── */
      if (r.category === 'STOCKS' && (sub === 'BUY_STOCK' || sub === 'SELL_STOCK')) {
        const gross = Math.abs(n(r.TotalFX)) || (fx ? Math.abs(n(r.TotalILS)) / fx : 0);
        if (sub === 'BUY_STOCK') turnover.buys += gross; else turnover.sells += gross;
        bumpYear(y, 'turnover', gross);
        bumpYear(y, 'trades', 1);

        const c = Math.abs(n(r.Commission));
        if (c > 0) {
          commission.count++;
          if (isIls) commission.ils += c; else commission.usd += c;
          bumpYear(y, 'commission', isIls ? (fx ? c / fx : c) : c);
        }
        const symKey = (r.Symbol || '').toString().trim().toUpperCase();
        if (symKey) {
          if (!symbols[symKey]) symbols[symKey] = { symbol: symKey, commission: 0, trades: 0, turnover: 0 };
          symbols[symKey].trades++;
          symbols[symKey].turnover += gross;
          symbols[symKey].commission += isIls ? (fx ? c / fx : c) : c;
        }
        return;
      }

      /* ── Standalone cost and income rows ── */
      const put = (b, key, expected) => {
        const d = _dir(r, expected === undefined ? -1 : expected);
        const u = _usd(r, fx) * d;
        if (!Math.abs(u)) return;
        b.count++;
        // A row is ILS-native when it carries no foreign total.
        if (Math.abs(n(r.TotalFX)) > 0.001) b.usd += Math.abs(n(r.TotalFX)) * d;
        else b.ils += _ils(r) * d;
        bumpYear(y, key, u);
      };

      if (sub === 'MGMT_FEE')             put(mgmtFee, 'mgmtFee');
      else if (sub === 'DEBIT_INTEREST')  put(debitInterest, 'debitInterest');
      else if (sub === 'DIVIDEND_TAX' || sub === 'CAPITAL_GAIN_TAX') put(withholding, 'withholding');
      else if (sub === 'TAX_PAYMENT')     put(capGainTax, 'capGainTax');
      else if (sub === 'CASH_DIVIDEND')   put(dividends, 'income', 1);
      else if (sub === 'CREDIT_INTEREST') put(creditInterest, 'income', 1);
      else if (sub === 'BROKER_CREDIT')   put(brokerCredit, 'income', 1);
    });

    const costs  = [commission, mgmtFee, debitInterest, withholding, capGainTax];
    const income = [dividends, creditInterest, brokerCredit];
    const totalCost   = costs.reduce((s2, b) => s2 + _conv(b, fx), 0);
    const totalIncome = income.reduce((s2, b) => s2 + _conv(b, fx), 0);
    const totalTurnover = turnover.buys + turnover.sells;

    return {
      commission, mgmtFee, debitInterest, withholding, capGainTax,
      dividends, creditInterest, brokerCredit,
      turnover: { ...turnover, total: totalTurnover },
      totalCost, totalIncome,
      /* Excluding tax, because tax is a consequence of profit and the other
         four are a consequence of activity. Mixing them hides the lever the
         user actually controls. */
      totalCostExTax: _conv(commission, fx) + _conv(mgmtFee, fx) + _conv(debitInterest, fx),
      commissionConv: _conv(commission, fx),
      avgCommission: commission.count ? _conv(commission, fx) / commission.count : 0,
      commissionPctOfTurnover: totalTurnover > 0 ? (_conv(commission, fx) / totalTurnover) * 100 : 0,
      byYear: Object.values(years).sort((a, b) => b.year - a.year),
      bySymbol: Object.values(symbols).filter(x => x.trades > 0)
                      .sort((a, b) => b.commission - a.commission),
    };
  }

  return { cashSummary, taxSummary, latestCashILS, frictionSummary };
})();
