/* ================================================================
   MODEL — צורת תנועת השקעה ב-Firestore, והמעבר ממנה ואליה.

   שלוש צורות, ושתי פונקציות שמחברות ביניהן:

     שורת גיליון (CSV של טאב Transactions)
        │  fromSheetRow()
        ▼
     מסמך Firestore  ← הצורה הקנונית, camelCase, מספרים כמספרים,
        │               תאריך כמחרוזת יום, מקור מתועד
        │  toEngineRow()
        ▼
     שורת מנוע — בדיוק מה ש-PortfolioEngine ו-Classifier מצפים לו
     (Date, Type, Qty, ExecutionRate ...). המנועים לא משתנים.

   מלכודת המבנה של הגיליון הישן, ומה שהמודל החדש עושה איתה:
   בסוגים `הפקדה` ו-`משיכה` (מגן המס) הסכום יושב ב-Qty (בשקלים),
   ו-TotalFX/TotalILS הם אפס. במסמך החדש הסכום עובר לשדה amountIls
   ו-qty הוא 0 — "כמות" היא כמות ניירות, תמיד. toEngineRow מחזיר את
   הסכום ל-Qty כדי שהמנועים יקבלו בדיוק את מה שקיבלו תמיד.

   מבחן הנכונות (tests/model.test.mjs): שורה → מסמך → שורת מנוע
   מחזירה את השדות שהמנועים קוראים, בלי שינוי, ומנוע ה-FIFO מפיק
   אותן פוזיציות משני המסלולים.
   ================================================================ */
export const AMOUNT_IN_QTY_TYPES = ['הפקדה', 'משיכה'];

/* אותו פענוח מספרים כמו במנוע (n() ב-portfolioEngine): מסיר כל מה
   שאינו ספרה, נקודה או מינוס. "1,234.50" → 1234.5, "$12" → 12. */
export function toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const x = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g, ''));
  return isFinite(x) ? x : 0;
}

/* 'DD/MM/YYYY' (הגיליון) או 'YYYY-MM-DD' → 'YYYY-MM-DD'. אחרת ''. */
export function toIsoDay(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

const str = v => String(v == null ? '' : v).trim();

/* שורת גיליון → מסמך. מחזיר { doc, problems } — בעיה היא סיבה לא
   לכתוב את השורה, והמסך מציג אותה. לא מנחשים. */
export function fromSheetRow(r) {
  const problems = [];
  const date = toIsoDay(r.Date);
  if (!date) problems.push(`תאריך לא מזוהה: "${str(r.Date)}"`);
  const type = str(r.Type);
  if (!type) problems.push('אין סוג תנועה');
  const portfolio = str(r.Portfolio);
  if (!portfolio) problems.push('אין תיק');

  const inQty = AMOUNT_IN_QTY_TYPES.includes(type);
  const doc = {
    date,
    type,
    name: str(r.Name),
    symbol: str(r.Symbol).toUpperCase(),
    portfolio,
    qty: inQty ? 0 : toNum(r.Qty),
    amountIls: inQty ? toNum(r.Qty) : null,
    price: toNum(r.ExecutionRate),
    currency: str(r.Currency),
    commission: toNum(r.Commission),
    fees: toNum(r.Fees),
    totalFx: toNum(r.TotalFX),
    totalIls: toNum(r.TotalILS),
    cashBalanceIls: toNum(r.CashBalanceILS),
    estimatedTax: toNum(r.EstimatedTax),
    source: { kind: 'sheet', sheetRow: r._row || null },
  };
  return { doc, problems };
}

/* מסמך → שורת מנוע. הצורה המדויקת שהמנועים של v3 קראו מהגיליון. */
export function toEngineRow(d) {
  const inQty = AMOUNT_IN_QTY_TYPES.includes(d.type);
  return {
    Date: d.date,
    Type: d.type,
    Name: d.name,
    Symbol: d.symbol,
    Qty: inQty ? d.amountIls : d.qty,
    ExecutionRate: d.price,
    Currency: d.currency,
    Commission: d.commission,
    Fees: d.fees,
    TotalFX: d.totalFx,
    TotalILS: d.totalIls,
    CashBalanceILS: d.cashBalanceIls,
    EstimatedTax: d.estimatedTax,
    Portfolio: d.portfolio,
    _id: d.id,
    _src: d.source,
  };
}

/* טביעת אצבע של תנועה. המופע ה-N של אותה טביעה הוא מה שהופך אותה
   לייחודית — שתי קניות זהות באותו יום הן שתי קניות אמיתיות. */
export function txnKey(d) {
  return [d.date, d.type, d.symbol, d.portfolio, d.name, d.qty, d.amountIls ?? '', d.price, d.totalFx, d.totalIls].join('|');
}

/* מונה מופעים על רשימת מסמכים (בסדר המקור). */
export function withTxnOccurrence(docs) {
  const seen = {};
  return docs.map(d => { const k = txnKey(d); seen[k] = (seen[k] || 0) + 1; return { key: k, occ: seen[k], doc: d }; });
}
