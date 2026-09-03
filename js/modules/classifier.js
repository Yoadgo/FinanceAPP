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
      BROKER_CREDIT:    'זיכוי מהברוקר', // שונות מזומן בשח — מבצע חבר מביא חבר. כסף אמיתי שנכנס.
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
      /* שלוש התוויות הבאות הן **תנועות פנימיות של מגן המס, לא עלות**.
         עד עכשיו הן נפלו ל-UNCLASSIFIED (55 שורות). כל מי שמסכם עלויות
         חייב לדלג עליהן — אחרת המס נספר פעמיים ושלוש. */
      TAX_ACCRUAL:      'צבירת מס עתידי',   // הפקדה/"מס עתידי"
      TAX_ACCRUAL_REV:  'שחרור מס עתידי',   // משיכה/"מס עתידי" — מקזזת את הקודמת בדיוק
      TAX_RESET:        'איפוס מגן מס',     // משיכה/"איפוס מגן מס"
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

    /* שונות מזומן בשח — 4 rows, all "מבצע חבר מביא חבר", +₪1,500 total.
       Real money that entered the account and was counted nowhere. */
    else if (type === 'שונות מזומן בשח') {
      [category, subCategory] = ['CASH', 'BROKER_CREDIT'];
    }

    /* ---- INTEREST ----
       משיכת ריבית מטח was mapped straight to CREDIT_INTEREST — income.
       In the real data all 5 rows are named "ריבית חובה מט"ח" and carry a
       NEGATIVE TotalFX (−$3.67 in total): they are a charge, not a receipt.
       Small money, wrong direction, and the direction is what the cash-flow
       screen shows. The Name decides; the Type alone cannot. */
    else if (type === 'משיכת ריבית מטח') {
      [category, subCategory] = has(nameLower, 'ר. חובה', 'ר.חובה', 'ריבית חובה')
        ? ['FEES', 'DEBIT_INTEREST']
        : ['INTEREST', 'CREDIT_INTEREST'];
    }

    /* ---- FEES (includes debit interest — a cost charged by the broker) ---- */
    else if (type === 'ריבית חובה מטח') {
      [category, subCategory] = ['FEES', 'DEBIT_INTEREST'];
    }
    else if (type === 'דמי טפול מזומן בשח') {
      [category, subCategory] = ['FEES', 'MGMT_FEE'];
    }

    /* ---- TAXES ---- */
    /* הפקדה: the broker parks money in a tax-bond. TotalILS and TotalFX are
       BOTH 0 — **the amount sits in Qty, in ILS**. Two distinct names:
         "מגן מס"    (114 rows) → the provision itself
         "מס עתידי"  (47 rows)  → a future-tax accrual that is reversed 1:1
                                   by a משיכה row of the same name and amount.
       Splitting them matters: the accrual pair nets to zero and must never
       be counted as a cost, while the provision is a real (if reversible)
       parking of cash. */
    else if (type === 'הפקדה') {
      category    = 'TAXES';
      subCategory = has(nameLower, 'מס עתידי') ? 'TAX_ACCRUAL' : 'TAX_PROVISION';
    }

    /* משיכה: four distinct things share one Type. The Name is the only
       discriminator, and the amount is in **Qty (ILS)**, not TotalILS.
         "מס לשלם"       (43) → the tax that was ACTUALLY PAID. A real cost.
         "מס עתידי"      (47) → reverses the הפקדה accrual. Nets to zero.
         "איפוס מגן מס"  (4)  → releases the provision. Not a cost.
       Only the first is money that left for good. Before this split, the
       last two fell to UNCLASSIFIED and TAX_PAYMENT was valued at zero,
       so ₪33,212 of paid tax was invisible. */
    else if (type === 'משיכה') {
      if (has(nameLower, 'מס לשלם')) {
        [category, subCategory] = ['TAXES', 'TAX_PAYMENT'];
      } else if (has(nameLower, 'מס עתידי')) {
        [category, subCategory] = ['TAXES', 'TAX_ACCRUAL_REV'];
      } else if (has(nameLower, 'איפוס מגן מס', 'איפוס מגן')) {
        [category, subCategory] = ['TAXES', 'TAX_RESET'];
      } else if (has(nameLower, 'ר. חובה', 'ר.חובה', 'ריבית חובה')) {
        [category, subCategory] = ['FEES', 'DEBIT_INTEREST'];
      } else {
        [category, subCategory] = ['UNCLASSIFIED', 'UNKNOWN'];
      }
    }

    /* משיכת מס חול מטח: foreign tax withheld AT SOURCE.
       The old rule looked for "דיב" in the Name and fell back to capital
       gains. But the broker names these rows "מסח/ TICKER US" (מס חו"ל),
       while the matching dividend is "דיב/ TICKER US" — so the marker is on
       the OTHER row and every one of the 72 rows fell to CAPITAL_GAIN_TAX.
       Checked against the sheet 3.9.2026: all 72 pair 1:1 with a dividend
       receipt on the same date and ticker, at exactly 25% of it
       (13.83/55.32, 4.06/16.25, 39.91/159.65). Nothing is withheld at source
       on capital gains in this account — that tax is paid later through the
       מגן מס mechanism, as TAX_PAYMENT.
       So: this Type is dividend withholding unless the Name says otherwise. */
    else if (type === 'משיכת מס חול מטח') {
      category    = 'TAXES';
      subCategory = has(nameLower, 'רווח הון', 'רווחי הון', 'capital')
        ? 'CAPITAL_GAIN_TAX'
        : 'DIVIDEND_TAX';
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
