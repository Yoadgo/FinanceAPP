/* ================================================================
   FRICTION — "כמה עלה לי המסחר". מנוע טהור למסך מס ועמלות.

   כל שורת תנועה מתורגמת לפריטים: דלי, מטבע מקורי, סכום (חיובי =
   עלות). שום דבר לא מומר בשקט: הסכום נשמר במטבע שלו, וההמרה לשקל
   נעשית לפי שער יום העסקה (fx.rateOn). שער חסר = הסכום המשולב הוא
   מקף, והמסך אומר למה (כלל FxMissing — לא נפילה לשער היום).

   הדליים (הוכח ב-3.9.2026 על כל השורות — ר' phase3_research):
     עמלת מסחר   — עמודה על שורת העסקה עצמה, לא שורה משלה.
     ריבית חובה  — "ר.חובה" בשם, בשקל או בדולר.
     דמי טיפול   — דמי טפול מזומן בשח.
     מס רווח הון — נטו: "מס לשלם" פחות זיכויי "מגן מס". ר' למטה.
     מס דיבידנד  — משיכת מס חול מטח, 25% במקור.
   ⚠️ מגן המס — נמדד 30.9.2026 על כל השורות, לכל תיק ושנה:
     "מס לשלם" − "הפקדה/מגן מס" = Σ אומדן המס של הברוקר, עד האגורה.
   כלומר "הפקדה/מגן מס" היא **זיכוי מס** (הפסד שקיזז מס ששולם), לא
   "עתודה". ספירה של "מס לשלם" לבד מנפחת את המס פי כמה. לכן המס כאן
   הוא נטו, לכל תיק ושנה (מגן המס הוא לכל חשבון — זיכוי בתיק אחד לא
   מקזז תיק אחר). נטו שלילי = זיכוי שלא נוצל — הוא מתאפס בתחילת השנה
   הבאה ("איפוס מגן מס"), ולכן העלות היא 0 והזיכוי מוצג בנפרד (אפשר
   לנצל בדוח שנתי).
   לא נספרים: מס עתידי (זוג שמתקזז לאפס), איפוס מגן מס. אומדן המס
   לעולם לא מחובר לתשלום (כלל ברזל 1 במודל המס).

   מנגד (לא מקזז את החיכוך, מוצג לידו): דיבידנד ברוטו, זיכויי ברוקר,
   ריבית זכות.
   ================================================================ */
import { PortfolioEngine } from './fifo.js';

export const COSTS = {
  commission: 'עמלות מסחר',
  debitInterest: 'ריבית חובה',
  mgmtFee: 'דמי טיפול',
  cgTax: 'מס רווח הון (נטו)',
  divTax: 'מס במקור על דיבידנד',
};
export const INCOME = { dividend: 'דיבידנד ברוטו', credit: 'זיכוי מהברוקר', creditInterest: 'ריבית זכות' };

const num = v => parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
const curOf = r => (String(r.Currency || '').trim() === '$' ? 'USD' : 'ILS');

/* סכום השורה עם הסימן שלה, ובאיזה מטבע. מגן המס (הפקדה/משיכה) שומר
   את הסכום ב-Qty בשקלים. */
function signed(r) {
  const fx = num(r.TotalFX), ils = num(r.TotalILS);
  if (fx) return { cur: 'USD', v: fx };
  if (ils) return { cur: 'ILS', v: ils };
  return { cur: 'ILS', v: -Math.abs(num(r.Qty)) };          // משיכה בשקל: יציאה
}

/* שורה מסווגת (Classifier) → פריטים. */
export function itemsOf(r) {
  const base = { date: String(r.Date).slice(0, 10), portfolio: r.Portfolio || '', symbol: String(r.Symbol || '').trim().toUpperCase(), row: r };
  const out = [];
  const c = Math.abs(num(r.Commission)) + Math.abs(num(r.Fees));        // עמלת פעולה + עמלות נלוות
  if (c) out.push({ ...base, bucket: 'commission', side: 'cost', cur: curOf(r), amount: c, trade: r.category === 'STOCKS' });
  const sub = r.subCategory;
  const cost = b => { const s = signed(r); if (s.v) out.push({ ...base, bucket: b, side: 'cost', cur: s.cur, amount: -s.v }); };
  const inc = b => { const s = signed(r); if (s.v) out.push({ ...base, bucket: b, side: 'income', cur: s.cur, amount: s.v }); };
  if (sub === 'DEBIT_INTEREST') cost('debitInterest');
  else if (sub === 'MGMT_FEE') cost('mgmtFee');
  else if (sub === 'TAX_PAYMENT') out.push({ ...base, bucket: 'cgTax', side: 'cost', cur: 'ILS', amount: Math.abs(num(r.Qty)), tax: 'paid' });
  else if (sub === 'TAX_PROVISION') out.push({ ...base, bucket: 'cgTax', side: 'cost', cur: 'ILS', amount: -Math.abs(num(r.Qty)), tax: 'credit' });
  else if (sub === 'DIVIDEND_TAX' || sub === 'CAPITAL_GAIN_TAX') cost(sub === 'DIVIDEND_TAX' ? 'divTax' : 'cgTax');
  else if (sub === 'CASH_DIVIDEND') inc('dividend');
  else if (sub === 'BROKER_CREDIT') inc('credit');
  else if (sub === 'CREDIT_INTEREST') inc('creditInterest');
  return out;
}

const empty = () => ({ usd: 0, ils: 0, total: 0, n: 0 });

/* rows — שורות מנוע מסווגות. fx — { rateOn(date) } או null.
   מחזיר סיכום לכל שנה, ובתוך כל שנה: לפי דלי, לפי תיק, לפי נייר. */
export function friction(rows, { fx = null } = {}) {
  const missing = new Set();
  const toIls = it => {
    if (it.cur === 'ILS') return it.amount;
    if (!fx) { missing.add(it.date); return null; }
    try { return it.amount * fx.rateOn(it.date); } catch (e) { missing.add(it.date); return null; }
  };
  const years = {};
  const Y = y => (years[y] = years[y] || {
    year: y, costs: Object.fromEntries(Object.keys(COSTS).map(k => [k, empty()])), income: Object.fromEntries(Object.keys(INCOME).map(k => [k, empty()])),
    trades: 0, frictionIls: 0, costsComplete: true, tax: { paid: 0, credit: 0, net: 0, unusedCredit: 0 }, incomeIls: 0, realizedUsd: 0, realizedIls: 0, estimatedTaxIls: 0, symbols: {}, portfolios: {}, items: [], complete: true,
  });
  const add = (acc, it, ils) => {
    acc[it.cur === 'USD' ? 'usd' : 'ils'] += it.amount; acc.n++;
    if (ils === null) acc.total = null; else if (acc.total !== null) acc.total += ils;
  };

  rows.forEach(r => {
    const y = String(r.Date).slice(0, 4);
    if (!/^\d{4}$/.test(y)) return;
    const Yr = Y(y);
    if (r.category === 'STOCKS') Yr.trades++;
    if (r.subCategory === 'SELL_STOCK') Yr.estimatedTaxIls += num(r.EstimatedTax);
    itemsOf(r).forEach(it => {
      const ils = toIls(it);
      Yr.items.push({ ...it, ils });
      if (it.tax) Yr.tax[it.tax] += Math.abs(it.amount);
      if (it.side === 'cost') {
        add(Yr.costs[it.bucket], it, ils);
        if (ils === null) { Yr.complete = false; Yr.costsComplete = false; } else Yr.frictionIls += ils;
        const p = (Yr.portfolios[it.portfolio] = Yr.portfolios[it.portfolio] || { portfolio: it.portfolio, ...Object.fromEntries(Object.keys(COSTS).map(k => [k, empty()])), totalIls: 0 });
        add(p[it.bucket], it, ils); if (ils !== null) p.totalIls += ils;
        if (it.bucket === 'commission' && it.trade) {
          const s = (Yr.symbols[it.symbol] = Yr.symbols[it.symbol] || { symbol: it.symbol, trades: 0, commissionUsd: 0, commissionIls: 0, realizedUsd: 0 });
          s.trades++; if (it.cur === 'USD') s.commissionUsd += it.amount; else s.commissionIls += it.amount;
        }
      } else {
        add(Yr.income[it.bucket], it, ils);
        if (ils === null) Yr.complete = false; else Yr.incomeIls += ils;
      }
    });
  });

  /* רווח ממומש ברוטו (לפני עמלות) — לפי יום המכירה, בשער של אותו יום. */
  PortfolioEngine.computeClosedTrades(rows).forEach(t => {
    const y = String(t.sellDate).slice(0, 4);
    if (!years[y]) return;
    const Yr = years[y];
    Yr.realizedUsd += t.pnl;
    const s = (Yr.symbols[t.symbol] = Yr.symbols[t.symbol] || { symbol: t.symbol, trades: 0, commissionUsd: 0, commissionIls: 0, realizedUsd: 0 });
    s.realizedUsd += t.pnl;
    let rate = null;
    if (fx) { try { rate = fx.rateOn(String(t.sellDate).slice(0, 10)); } catch (e) { missing.add(String(t.sellDate).slice(0, 10)); } }
    if (rate === null) { Yr.complete = false; Yr.realizedIls = null; } else if (Yr.realizedIls !== null) Yr.realizedIls += t.pnl * rate;
  });

  /* מס נטו לכל תיק ושנה, לא פחות מאפס — על הסכום המומר (גם מס בדולר). */
  Object.values(years).forEach(Yr => {
    let clamped = 0;
    Object.values(Yr.portfolios).forEach(p => {
      const raw = p.cgTax.total;
      if (raw === null) return;                       // חסר שער — הסכום המשולב כבר מקף
      const c = Math.max(0, raw);
      if (raw < 0) Yr.tax.unusedCredit += -raw;
      p.unusedCredit = raw < 0 ? -raw : 0;
      p.cgTax.total = c; p.totalIls += c - raw;
      Yr.frictionIls += c - raw;
      clamped += c;
    });
    Yr.tax.net = Yr.tax.paid - Yr.tax.credit;
    Yr.costs.cgTax.total = Yr.costsComplete ? clamped : null;
  });

  const list = Object.values(years).sort((a, b) => b.year.localeCompare(a.year)).map(Yr => {
    /* כמה מהרווח הלך לחיכוך. הבסיס: רווח ממומש ברוטו + הכנסות (דיבידנד,
       זיכויים). בסיס ≤ 0 — אין אחוז (אי אפשר "לאכול" חלק מהפסד). */
    const base = Yr.complete && Yr.realizedIls !== null ? Yr.realizedIls + Yr.incomeIls : null;
    return {
      ...Yr,
      frictionIls: Yr.costsComplete ? Yr.frictionIls : null,
      profitBaseIls: base,
      shareOfProfit: base !== null && base > 0 ? Yr.frictionIls / base : null,
      symbols: Object.values(Yr.symbols).sort((a, b) => b.commissionUsd - a.commissionUsd),
      portfolios: Object.values(Yr.portfolios).sort((a, b) => b.totalIls - a.totalIls),
    };
  });
  return { years: list, missingFx: [...missing].sort() };
}
