/* ================================================================
   EFFICIENCY — "האם ההשקעות שלי יעילות". לכל נייר, ולתיק כולו.

   השאלה של יועד (29.9.2026), במילים שלו: "מניית גוגל — נכנסתי 12
   פעמים, כ-100 דולר עמלות, הפסדתי 8 פעמים כ-1,000 דולר, הרווחתי
   פעמיים 1,200. סה"כ רווח של 100 דולר — שווה או לא שווה?"

   רווח חיובי לא עונה על השאלה. התשובה היא השוואה: מה אותו כסף היה
   עושה, באותם ימים בדיוק, אילו ישב במדד. זה מה ש-Research.alpha כבר
   מחשב לכל פרוסת FIFO (הוסב מ-v3 ואומת שם). הקובץ הזה רק מקבץ לפי
   נייר ומוסיף את מה שחסר לשאלה: כניסות, ניצחונות/הפסדים, עמלות.

     נטו        = רווח (ממומש + לא ממומש) − עמלות
     המדד היה   = Σ עלות הפרוסה × תשואת המדד בחלון של הפרוסה
     יתרון      = נטו − המדד היה
     שווה?      = יתרון ≥ 0

   הנחה שנאמרת בקול: "המדד היה" לא מנכה עמלה. קנייה אחת של IVV עולה
   עמלה אחת, בעוד שהמסחר בנייר עלה כמה — ולכן ההשוואה נוטה מעט לטובת
   המסחר, לא נגדו. אם הנייר מפסיד גם כך, הוא באמת מפסיד.
   ================================================================ */
import { PortfolioEngine } from './fifo.js';
import { Research } from './research.js';

const num = v => parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;

/* rows      — שורות מנוע מסווגות (Classifier.enrichAll)
   historyMap — { SYM: [{ date, close }] }
   opts.bench — 'IVV'
   opts.fx    — { rateOn(date) } להמרת עמלה בשקלים (אם יש)           */
export function efficiency(rows, historyMap, { bench = 'IVV', fx = null } = {}) {
  const slices = PortfolioEngine.computeLotSlices(rows);
  const seriesMap = Research.buildSeriesMap(historyMap);
  const alpha = Research.alpha(slices, seriesMap, bench);
  const closed = PortfolioEngine.computeClosedTrades(rows);

  const S = {};
  const get = sym => (S[sym] = S[sym] || {
    symbol: sym, portfolios: new Set(), entries: 0, exits: 0, wins: 0, losses: 0, grossWin: 0, grossLoss: 0,
    commissions: 0, pnl: 0, benchPnl: 0, cost: 0, capitalDays: 0, openCost: 0, slices: 0,
  });

  rows.forEach(r => {
    if (r.category !== 'STOCKS') return;
    const sym = String(r.Symbol || '').trim().toUpperCase();
    if (!/^[A-Z]{1,5}$/.test(sym)) return;
    const s = get(sym);
    s.portfolios.add(r.Portfolio);
    if (r.subCategory === 'BUY_STOCK') s.entries++;
    const c = Math.abs(num(r.Commission));
    const ils = String(r.Currency || '').trim() === '₪';
    s.commissions += ils && fx ? c / fx.rateOn(String(r.Date).slice(0, 10)) : c;
  });

  closed.forEach(t => {
    const s = get(t.symbol);
    s.exits++;
    if (t.pnl > 0) { s.wins++; s.grossWin += t.pnl; } else if (t.pnl < 0) { s.losses++; s.grossLoss += -t.pnl; }
  });

  /* פרוסה שלא נמדדה (חסר מחיר המדד או של הנייר) = הנייר לא נמדד במלואו.
     בלי זה: נטו = 0 − עמלות, "המדד היה" = 0, ופסק דין "לא שווה" שקרי. */
  [...alpha.skipped.noBench, ...alpha.skipped.noPrice, ...alpha.skipped.badData].forEach(sl => { get(sl.symbol).missing = (get(sl.symbol).missing || 0) + 1; });

  alpha.rows.forEach(a => {
    const s = get(a.symbol);
    s.pnl += a.pnl; s.benchPnl += a.benchPnl; s.cost += a.cost; s.slices++;
    s.capitalDays += a.cost * a.holdDays;
    if (a.open) s.openCost += a.cost;
  });

  const finish = s => {
    const net = s.pnl - s.commissions;
    const edge = net - s.benchPnl;
    const years = s.capitalDays / 365;
    return {
      ...s,
      portfolios: [...(s.portfolios || [])],
      net, edge,
      worth: edge >= 0,
      incomplete: (s.missing || 0) > 0,
      /* תשואה שנתית על ההון שהיה מושקע בפועל, ומה המדד היה נותן עליו */
      annual: years > 0 ? net / years : null,
      annualPct: s.capitalDays > 0 ? (net / s.capitalDays) * 365 * 100 : null,
      benchAnnualPct: s.capitalDays > 0 ? (s.benchPnl / s.capitalDays) * 365 * 100 : null,
      avgCapital: s.capitalDays > 0 && s.cost > 0 ? s.capitalDays / (s.capitalDays / s.cost) : 0,
      winRate: s.exits ? s.wins / s.exits : null,
      /* כמה מהרווח הגולמי הלך לעמלות */
      feeShare: s.grossWin > 0 ? s.commissions / s.grossWin : null,
    };
  };

  const bySymbol = Object.values(S).filter(s => s.slices > 0 || s.exits > 0).map(finish).sort((a, b) => a.edge - b.edge);
  const tot = bySymbol.reduce((t, s) => {
    ['entries', 'exits', 'wins', 'losses', 'grossWin', 'grossLoss', 'commissions', 'pnl', 'benchPnl', 'cost', 'capitalDays', 'openCost', 'slices']
      .forEach(k => { t[k] += s[k]; });
    return t;
  }, { symbol: 'סה"כ', portfolios: new Set(), entries: 0, exits: 0, wins: 0, losses: 0, grossWin: 0, grossLoss: 0, commissions: 0, pnl: 0, benchPnl: 0, cost: 0, capitalDays: 0, openCost: 0, slices: 0 });

  const total = finish(tot);
  total.incomplete = bySymbol.some(s => s.incomplete);
  return { bench, bySymbol, total, skipped: alpha.skipped, covered: alpha.covered };
}

/* משפט אחד שעונה על השאלה, בלי ז'רגון. */
export function verdictText(s, bench = 'IVV') {
  const f = v => `$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
  const net = s.net >= 0 ? `הרווחת ${f(s.net)} נטו` : `הפסדת ${f(s.net)} נטו`;
  const b = s.benchPnl >= 0 ? `${bench} היה נותן ${f(s.benchPnl)}` : `${bench} היה מפסיד ${f(s.benchPnl)}`;
  return s.worth
    ? `שווה. ${net} אחרי עמלות, ובאותם ימים ${b} על אותו כסף — יתרון של ${f(s.edge)}.`
    : `לא שווה. ${net} אחרי עמלות, אבל באותם ימים ${b} על אותו כסף — פספוס של ${f(s.edge)}.`;
}
