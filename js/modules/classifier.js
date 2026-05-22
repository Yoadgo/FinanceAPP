/* ================================================================
   TRANSACTION CLASSIFIER  v3
   ----------------------------------------------------------------
   Input : a single row-object from the Transactions sheet
   Output: { category, subCategory, label }

   KEY FINDINGS from data audit:
   - "הפקדה"           → ALWAYS a tax-bond provision (TotalILS=0, numeric symbol)
   - "משיכה"           → ALWAYS a tax payment ("מס לשלם") OR a debit-interest charge
   - "העברה מזומן בשח" → the REAL cash deposits (positive transfers from bank)
   - "הטבה"            → split or bonus shares (corporate action, no cash value)
   - "ר. חובה" / "ר.חובה" in Name → debit interest charged on credit/margin
   ================================================================ */

const Classifier = (() => {

  /* ── Helpers ── */
  const clean = v => (v || '').toString().trim();
  const num   = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;
  const has   = (str, ...words) => words.some(w => str.includes(w));

  /* Stock ticker = 1–5 capital letters (TSLA, NOW, QQQ…)
     Numeric codes like 9993983 / 9992985 / 99028 are broker/tax instruments. */
  const isStockTicker = sym => /^[A-Z]{1,5}$/.test(sym);
  const isNumericCode = sym => /^\d{3,}$/.test(sym);

  /* ── Human-readable labels ── */
  const LABELS = {
    STOCKS: {
      BUY_STOCK:        'קניית מניה',
      SELL_STOCK:       'מכירת מניה',
    },
    CASH: {
      DEPOSIT:          'הפקדת מזומן',
      CASH_DIVIDEND:    'דיבידנד',
      FX_CONVERSION:    'המרת מט"ח',
      SPLIT:            'פיצול מניות',   // corporate action — no monetary value
      BONUS:            'בונוס מניות',   // corporate action
    },
    INTEREST: {
      CREDIT_INTEREST:  'ריבית זכות',
    },
    FEES: {
      TRADE_COMMISSION: 'עמלת מסחר',
      MGMT_FEE:         'דמי ניהול',
      DEBIT_INTEREST:   'ריבית חובה',   // interest charged on credit/margin — a cost
    },
    TAXES: {
      CAPITAL_GAIN_TAX: 'מס רווח הון',
      DIVIDEND_TAX:     'מס דיבידנד',
      TAX_PROVISION:    'עתודת מס (מגן מס)',
      TAX_PAYMENT:      'תשלום מס',
      TAX_REFUND:       'זיכוי מס',
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
    const qty       = num(row.Qty);
    const price     = num(row.ExecutionRate);

    let category, subCategory;

    /* ---- FX CONVERSION (check BEFORE stocks) --------------------------------
       קניה שח / מכירה שח with a numeric symbol = ILS↔USD currency trade.
       Symbol is a broker FX instrument code (e.g. 99028), not a stock ticker. */
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

    /* ---- CORPORATE ACTIONS (under CASH — no independent monetary value) ----
       הטבה = broker bonus / share split.
       Split: stock ticker + qty > 0 + price = 0.  Bonus: everything else.     */
    else if (type === 'הטבה') {
      category    = 'CASH';
      subCategory = (isStockTicker(symbol) && qty > 0 && price === 0) ? 'SPLIT' : 'BONUS';
    }

    /* ---- CASH ---- */
    else if (type === 'הפקדה דיבידנד מטח') {
      [category, subCategory] = ['CASH', 'CASH_DIVIDEND'];
    }
    else if (type === 'העברה מזומן בשח') {
      [category, subCategory] = ['CASH', 'DEPOSIT'];
    }

    /* ---- INTEREST ---- */
    else if (type === 'משיכת ריבית מטח') {
      [category, subCategory] = ['INTEREST', 'CREDIT_INTEREST'];
    }

    /* ---- FEES (includes debit interest — a cost charged by the broker) ---- */
    else if (type === 'ריבית חובה מטח') {
      [category, subCategory] = ['FEES', 'DEBIT_INTEREST'];
    }
    else if (type === 'דמי טפול מזומן בשח') {
      [category, subCategory] = ['FEES', 'MGMT_FEE'];
    }

    /* ---- TAXES ---- */
    // הפקדה: broker parks money in a tax-bond (מגן מס). TotalILS=0 always.
    else if (type === 'הפקדה') {
      [category, subCategory] = ['TAXES', 'TAX_PROVISION'];
    }

    // משיכה: either a tax payment OR a debit-interest charge on credit.
    // Must check Name to distinguish them.
    else if (type === 'משיכה') {
      if (has(nameLower, 'מס לשלם')) {
        [category, subCategory] = ['TAXES', 'TAX_PAYMENT'];
      } else if (has(nameLower, 'ר. חובה', 'ר.חובה', 'ריבית חובה')) {
        [category, subCategory] = ['FEES', 'DEBIT_INTEREST'];
      } else {
        [category, subCategory] = ['UNCLASSIFIED', 'UNKNOWN'];
      }
    }

    // משיכת מס חול מטח: foreign withholding tax deducted at source.
    else if (type === 'משיכת מס חול מטח') {
      category    = 'TAXES';
      subCategory = has(nameLower, 'דיב', 'div', 'dividend')
        ? 'DIVIDEND_TAX'
        : 'CAPITAL_GAIN_TAX';
    }

    /* ---- Name-based fallbacks (catch rows whose Type wasn't listed above) ----
       Must come AFTER all type-based rules.                                      */
    else if (has(nameLower, 'ר. חובה', 'ר.חובה', 'ריבית חובה')) {
      [category, subCategory] = ['FEES', 'DEBIT_INTEREST'];
    }
    else if (has(nameLower, 'ר. זכות', 'ר.זכות', 'ריבית זכות')) {
      [category, subCategory] = ['INTEREST', 'CREDIT_INTEREST'];
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
