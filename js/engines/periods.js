/* ================================================================
   PERIODS — "כמה הרווחתי" ביום, בשבוע ובחודש. טהור.
   (יועד, 1.10.2026: שינוי בשווי פחות הפקדות; דולר עם מתג לשקל.)

   השיטה — מבוססת אחזקות, לא יתרת מזומן:
     רווח ביום d = שווי האחזקות בסוף d − שווי האחזקות בסוף היום הקודם
                   + כל הכסף שנכנס לחשבון מהשקעה ב-d (מכירות, דיבידנדים)
                   − כל הכסף שיצא ממנה (קניות כולל עמלה, מס, ריבית, דמי טיפול)
   כך הפקדה או משיכה לא נספרות כרווח: הן לא נוגעות באחזקות. וקנייה לא
   "מורידה" את הרווח: השווי עולה בדיוק בסכום שיצא (פחות העמלה — שהיא
   באמת הפסד של אותו יום).
   רווח תקופה = סכום הימים שלה — לכן יום + יום = שבוע, ושבוע + שבוע = חודש.

   שקלים: כל סכום מומר בשער של היום שלו, ושווי האחזקות בשער של סוף
   היום. לכן ההפרש כולל את תנועת הדולר — מכוון (כך נמדד כסף בשקלים).
   מה לא נכלל: הפרשי שער על מזומן שיושב בחשבון (אין לנו יתרות מזומן
   לפי מטבע), והמרות מט"ח (הן החלפת כסף, לא רווח).

   פיצולים: ההיסטוריה של גוגל מותאמת לפיצולים לאחור (GOOGL ב-2022 מופיע
   כ-$112, לא $2,243), אבל הכמויות בתנועות לפני הפיצול הן הכמויות דאז.
   לכן כל כמות מוכפלת ביחס של הפיצולים שאחרי היום הנמדד — אחרת יום
   הפיצול נראה כמו רווח של פי 20.

   מחיר חסר: נייר בלי סגירה ביום מסוים מקבל את הסגירה הקודמת (עד 7
   ימים), ואם אין — את מחיר העסקה האחרונה בו. כל יום כזה נספר ומוצג.

   מס רווח הון: תשלום ("מס לשלם") הוא עלות ביום שלו, וזיכוי ("מגן מס")
   הוא החזר ביום שלו — לאורך תקופה הם מתקזזים לנטו (ר' engines/friction.js).
   ================================================================ */
const num = v => parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
const dnum = s => Math.floor(Date.parse(`${s}T00:00:00Z`) / DAY);
const symOf = r => String(r.Symbol || '').trim().toUpperCase();
const isTicker = s => /^[A-Z]{1,5}$/.test(s);

/* תזרים של שורה: { usd, ils } — חיובי = נכנס לחשבון מהשקעה. */
function flowOf(r) {
  const sub = r.subCategory, fx = num(r.TotalFX), ils = num(r.TotalILS), q = Math.abs(num(r.Qty));
  if (r.category === 'STOCKS') return fx ? { usd: fx, ils: 0 } : { usd: 0, ils };
  if (sub === 'CASH_DIVIDEND' || sub === 'DIVIDEND_TAX' || sub === 'CAPITAL_GAIN_TAX' || sub === 'BROKER_CREDIT'
    || sub === 'CREDIT_INTEREST' || sub === 'DEBIT_INTEREST' || sub === 'MGMT_FEE') {
    if (fx) return { usd: fx, ils: 0 };
    if (ils) return { usd: 0, ils };
    return { usd: 0, ils: sub === 'DEBIT_INTEREST' || sub === 'MGMT_FEE' ? -q : q };
  }
  if (sub === 'TAX_PAYMENT') return { usd: 0, ils: -q };
  if (sub === 'TAX_PROVISION') return { usd: 0, ils: q };               // זיכוי מגן מס
  return null;                                                            // הפקדות, המרות, מס עתידי, איפוס
}

/* rows — שורות מנוע מסווגות. history — { SYM: [{date, close}] } ממוין.
   fx — { rateOn(date) } (חובה לשקלים). to — יום אחרון (ברירת מחדל: הסגירה
   האחרונה הידועה). מחזיר ימי מסחר עם רווח, ושווי בסוף כל יום. */
export function dailyPnl(rows, history, { fx = null, to = null } = {}) {
  const trades = rows.filter(r => r.category === 'STOCKS' || r.subCategory === 'SPLIT');
  const events = rows.map(r => ({ r, date: String(r.Date).slice(0, 10) })).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (!events.length) return { days: [], fallbackDays: 0, missingFx: [] };
  const lastClose = Object.values(history || {}).reduce((m, a) => (a.length && a[a.length - 1].date > m ? a[a.length - 1].date : m), '');
  const end = to || lastClose || events[events.length - 1].date;
  const start = events[0].date;

  /* סגירה ביום או לפניו (עד 7 ימים) — מצביע עולה לכל נייר */
  const ptr = {};
  const closeOn = (sym, d) => {
    const a = history[sym]; if (!a || !a.length) return null;
    let i = ptr[sym] ?? -1;
    while (i + 1 < a.length && a[i + 1].date <= d) i++;
    ptr[sym] = i;
    if (i < 0) return null;
    return dnum(d) - dnum(a[i].date) <= 7 ? a[i].close : null;
  };

  /* יחסי הפיצול, לפי סדר הזמן: SPLIT מוסיף delta על מה שמוחזק → יחס (held+delta)/held */
  const splits = {};
  {
    const held = {};
    events.forEach(({ r, date }) => {
      const s = symOf(r); if (!isTicker(s)) return;
      const q = Math.abs(num(r.Qty));
      if (r.subCategory === 'SPLIT') { if ((held[s] || 0) > 1e-9) (splits[s] = splits[s] || []).push({ date, ratio: (held[s] + q) / held[s] }); held[s] = (held[s] || 0) + q; }
      else if (r.subCategory === 'BUY_STOCK') held[s] = (held[s] || 0) + q;
      else if (r.subCategory === 'SELL_STOCK') held[s] = (held[s] || 0) - q;
    });
  }
  /* כמה פיצולים עוד יקרו אחרי היום d — מכפיל לכמות (ומחלק למחיר עסקה) */
  const factor = (s, d) => (splits[s] || []).reduce((f, x) => (x.date > d ? f * x.ratio : f), 1);

  const qty = {}, lastTradePx = {};
  const missing = new Set();
  const rate = d => { if (!fx) return null; try { return fx.rateOn(d); } catch (e) { missing.add(d); return null; } };
  const days = [];
  let ei = 0, prevMv = 0, prevMvIls = 0, prevByS = {}, fallbackDays = 0;
  for (let t = dnum(start); t <= dnum(end); t++) {
    const d = iso(t * DAY);
    const dow = new Date(t * DAY).getUTCDay();
    let flowUsd = 0, flowIls = 0, buysUsd = 0;
    const bySymFlow = {}, other = { usd: 0, ils: 0 };
    let had = false;
    while (ei < events.length && events[ei].date === d) {
      const { r } = events[ei++]; had = true;
      const s = symOf(r);
      if (r.subCategory === 'SPLIT') { if (isTicker(s)) qty[s] = (qty[s] || 0) + Math.abs(num(r.Qty)); continue; }
      if (r.category === 'STOCKS' && isTicker(s)) {
        const q = Math.abs(num(r.Qty));
        qty[s] = (qty[s] || 0) + (r.subCategory === 'BUY_STOCK' ? q : -q);
        if (num(r.ExecutionRate) > 0) lastTradePx[s] = num(r.ExecutionRate) / factor(s, d);   // מותאם פיצול, כמו ההיסטוריה
      }
      const f = flowOf(r); if (!f) continue;
      flowUsd += f.usd; flowIls += f.ils;
      if (r.subCategory === 'BUY_STOCK') buysUsd += -f.usd;
      if (r.category === 'STOCKS' && isTicker(s)) { const x = (bySymFlow[s] = bySymFlow[s] || { usd: 0, ils: 0 }); x.usd += f.usd; x.ils += f.ils; }
      else { other.usd += f.usd; other.ils += f.ils; }
    }
    if ((dow === 0 || dow === 6) && !had) continue;                // סוף שבוע בלי תנועות

    let mv = 0, fell = false;
    const byS = {};
    Object.entries(qty).forEach(([s, q]) => {
      if (Math.abs(q) < 1e-9) return;
      const f = factor(s, d);
      let px = closeOn(s, d);
      if (px === null) { px = lastTradePx[s] ?? 0; fell = true; }
      byS[s] = q * f * px; mv += q * f * px;
    });
    if (fell) fallbackDays++;
    const rt = rate(d);
    const pnlUsd = mv - prevMv + flowUsd + (rt ? flowIls / rt : 0);
    const mvIls = rt ? mv * rt : null;
    const pnlIls = rt && prevMvIls !== null ? mvIls - prevMvIls + flowUsd * rt + flowIls : null;
    /* תרומה לכל נייר: שינוי בשווי שלו + התזרים שלו */
    const contrib = {};
    new Set([...Object.keys(byS), ...Object.keys(prevByS), ...Object.keys(bySymFlow)]).forEach(s => {
      const c = (byS[s] || 0) - (prevByS[s] || 0) + ((bySymFlow[s] && bySymFlow[s].usd) || 0) + (rt && bySymFlow[s] ? bySymFlow[s].ils / rt : 0);
      if (Math.abs(c) > 1e-9) contrib[s] = c;
    });
    const otherUsd = other.usd + (rt ? other.ils / rt : 0);
    days.push({ date: d, mv, mvIls, pnlUsd, pnlIls, buysUsd, prevMv, contrib, otherUsd, fallback: fell });
    prevMv = mv; prevMvIls = mvIls; prevByS = byS;
  }
  return { days, fallbackDays, missingFx: [...missing].sort() };
}

/* מפתח תקופה: יום · שבוע (מתחיל בשני) · חודש */
export function periodKey(date, res) {
  if (res === 'day') return date;
  if (res === 'month') return date.slice(0, 7);
  const t = dnum(date), dow = (new Date(t * DAY).getUTCDay() + 6) % 7;     // שני = 0
  return iso((t - dow) * DAY);
}

/* ימים → תקופות בטווח [from, to]. cur: 'usd' | 'ils'. */
export function aggregate(days, { res = 'day', from = '0000', to = '9999', cur = 'usd' } = {}) {
  const pick = d => (cur === 'ils' ? d.pnlIls : d.pnlUsd);
  const B = new Map();
  days.filter(d => d.date >= from && d.date <= to).forEach(d => {
    const k = periodKey(d.date, res);
    const b = B.get(k) || { key: k, from: d.date, to: d.date, pnl: 0, complete: true, startMv: d.prevMv, buys: 0, mvEnd: 0, mvEndIls: null, days: 0, contrib: {}, otherUsd: 0, fallback: false };
    const v = pick(d);
    if (v === null) b.complete = false; else b.pnl += v;
    b.to = d.date; b.days++; b.buys += d.buysUsd; b.mvEnd = d.mv; b.mvEndIls = d.mvIls;
    b.otherUsd += d.otherUsd; b.fallback = b.fallback || d.fallback;
    Object.entries(d.contrib).forEach(([s, c]) => { b.contrib[s] = (b.contrib[s] || 0) + c; });
    B.set(k, b);
  });
  const list = [...B.values()].map(b => {
    /* תשואה: רווח ÷ (שווי בתחילת התקופה + מחצית הקניות) — שיטת דיץ הפשוטה.
       בדולרים בלבד; בשקלים מוצג אותו אחוז (הוא לא תלוי במטבע הבסיס כמעט). */
    const base = b.startMv + 0.5 * b.buys;
    return { ...b, pnl: b.complete ? b.pnl : null, pct: b.complete && base > 1 && cur === 'usd' ? b.pnl / base : null };
  });
  const vals = list.filter(b => b.pnl !== null);
  const total = vals.length === list.length ? vals.reduce((s, b) => s + b.pnl, 0) : null;
  const best = vals.reduce((m, b) => (!m || b.pnl > m.pnl ? b : m), null);
  const worst = vals.reduce((m, b) => (!m || b.pnl < m.pnl ? b : m), null);
  return { periods: list, total, best, worst, positive: vals.filter(b => b.pnl > 0).length, count: list.length };
}
