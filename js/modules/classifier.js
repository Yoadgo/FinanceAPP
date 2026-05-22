/* ================================================================
   TRANSACTION CLASSIFIER  v2
   ----------------------------------------------------------------
   Input : a single row-object from the Transactions sheet
   Output: { category, subCategory, label }

   Verified against live data (792 rows, 12 Type values).

   KEY FINDINGS from data audit:
   - "הפקדה"        → ALWAYS a tax-bond provision (TotalILS=0, numeric symbol)
                      NOT a cash deposit.
   - "משיכה"        → ALWAYS a tax payment ("מס לשלם", symbol 9993983)
                      NOT a cash withdrawal to bank.
   - "העברה מזומן בשח" → the REAL cash deposits (44 rows, all positive).
   ================================================================ */

const Classifier = (() => {

  /* ── Helpers ── */
  const clean = v  => (v  || '').toString().trim();
  const num   = v  => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;
  const has   = (str, ...words) => words.some(w => str.includes(w));

  /* Stock ticker = 1–5 capital letters only (TSLA, NOW, QQQ…)
     Numeric codes like 9993983 / 9992985 / 99028 are broker/tax instruments. */
  const isStockTicker = sym => /^[A-Z]{1,5}$/.test(sym);
  const isNumericCode = sym => /^\d{3,}$/.test(sym);

  /* ── Human-readable labels ── */
  const LABELS = {
    STOCKS: {
      BUY_STOCK:  'קניית מניה',
      SELL_STOCK: 'מכירת מניה',
    },
    CASH: {
      DEPOSIT:        'הפקדת מזומן',
      CASH_DIVIDEND:  'דיבידנד',
      INTEREST:       'ריבית',
      FX_CONVERSION:  'המרת מט"ח',
    },
    FEES: {
      TRADE_COMMISSION: 'עמלת מסחר',   // extracted from Commission field, not a separate row
      MGMT_FEE:         'דמי ניהול',
    },
    TAXES: {
      CAPITAL_GAIN_TAX: 'מס רווח הון',
      DIVIDEND_TAX:     'מס דיבידנד',
      TAX_PROVISION:    'עתודת מס (מגן מס)',
      TAX_PAYMENT:      'תשלום מס',
      TAX_REFUND:       'זיכוי מס',
    },
    BONUS: {
      SPLIT: 'פיצול מניות',
      BONUS: 'בונוס מניות',
    },
    UNCLASSIFIED: {
      UNKNOWN: 'לא מסווג',
    },
  };

  /* ── Core classification ── */
  function classify(row) {
    const type      = clean(row.Type);
    const nameLower = clean(row.Name).toLowerCase();
    const symbol    = clean(row.Symbol);
    const totalILS  = num(row.TotalILS);
    const qty       = num(row.Qty);
    const price     = num(row.ExecutionRate);

    let category, subCategory;

    /* ---- FX CONVERSION (must be checked BEFORE stocks) ----
       קניה שח / מכירה שח with a numeric symbol = currency trade (e.g. buying USD with ILS).
       Name contains "USD/ILS" or "ILS" and symbol is a broker FX code like 99028. */
    if ((type === 'קניה שח' || type === 'מכירה שח') && isNumericCode(symbol)) {
      [category, subCategory] = ['CASH', 'FX_CONVERSION'];
    }

    /* ---- STOCKS ---- */
    else if (type === 'קניה חול מטח' || type === 'קניה שח') {
      [category, subCategory] = ['STOCKS', 'BUY_STOCK'];
    }
    else if (type === 'מכירה חול מטח' || type === 'מכירה שח') {
      [category, subCategory] = ['STOCKS', 'SELL_STOCK'];
    }

    /* ---- BONUS / SPLITS ---- */
    // הטבה = broker bonus; if stock ticker + qty > 0 + price = 0 → split
    else if (type === 'הטבה') {
      category    = 'BONUS';
      subCategory = (isStockTicker(symbol) && qty > 0 && price === 0) ? 'SPLIT' : 'BONUS';
    }

    /* ---- CASH ---- */
    else if (type === 'הפקדה דיבידנד מטח') {
      [category, subCategory] = ['CASH', 'CASH_DIVIDEND'];
    }
    else if (type === 'משיכת ריבית מטח') {
      [category, subCategory] = ['CASH', 'INTEREST'];
    }
    // העברה מזומן בשח = actual cash deposit from bank (all 44 rows are positive transfers in)
    else if (type === 'העברה מזומן בשח') {
      [category, subCategory] = ['CASH', 'DEPOSIT'];
    }

    /* ---- TAXES ---- */
    // הפקדה: broker sets aside money into a tax-bond (מגן מס / מס עתידי).
    // TotalILS is always 0 — no fresh cash arrives; it's a tax-escrow provision.
    else if (type === 'הפקדה') {
      category    = 'TAXES';
      subCategory = 'TAX_PROVISION';
    }

    // משיכה: actual tax payment ("מס לשלם") — broker redeems the tax-bond and pays the tax.
    else if (type === 'משיכה') {
      if (has(nameLower, 'מס לשלם', 'מס לשלם')) {
        [category, subCategory] = ['TAXES', 'TAX_PAYMENT'];
      } else {
        // Safety net for any future withdrawal type we haven't seen yet
        [category, subCategory] = ['UNCLASSIFIED', 'UNKNOWN'];
      }
    }

    // משיכת מס חול מטח: foreign tax deducted at source.
    // Distinguish dividend tax vs capital-gains tax by Name prefix "מסח/" = מס חו"ל
    else if (type === 'משיכת מס חול מטח') {
      category    = 'TAXES';
      subCategory = has(nameLower, 'דיב', 'div', 'dividend')
        ? 'DIVIDEND_TAX'
        : 'CAPITAL_GAIN_TAX';
    }

    /* ---- FEES ---- */
    else if (type === 'דמי טפול מזומן בשח') {
      [category, subCategory] = ['FEES', 'MGMT_FEE'];
    }

    /* ---- UNCLASSIFIED (safety net) ---- */
    else {
      [category, subCategory] = ['UNCLASSIFIED', 'UNKNOWN'];
    }

    return {
      category,
      subCategory,
      label: LABELS[category]?.[subCategory] ?? subCategory,
    };
  }

  /* ── Enrich: add classification to every row ── */
  function enrichAll(rows) {
    return rows.map(row => ({ ...row, ...classify(row) }));
  }

  /* ── Summary: count by category (used in dashboard) ── */
  function summarize(enrichedRows) {
    const result = {};
    enrichedRows.forEach(({ category, subCategory }) => {
      if (!result[category]) result[category] = { total: 0, subs: {} };
      result[category].total++;
      result[category].subs[subCategory] = (result[category].subs[subCategory] || 0) + 1;
    });
    return result;
  }

  /* ── Debug: find any UNCLASSIFIED rows ── */
  function findUnclassified(enrichedRows) {
    return enrichedRows.filter(r => r.category === 'UNCLASSIFIED');
  }

  return { classify, enrichAll, summarize, findUnclassified, LABELS };
})();
