/* ================================================================
   SPEND — "על מה הוצאנו כסף". קיבוץ, הצעות, קיזוזים וסיכומים. טהור.

   הוסב מ-FinanceAPP v3 (js/modules/expenses.js, 41 בדיקות, אומת
   ב-Playwright מול 574 שורות אמת ב-5.9.2026) והותאם למסמכי v4:
   תאריך הוא מחרוזת יום, חודש חיוב הוא 'YYYY-MM' (billingKey), ושמות
   הדליים הם של v4 (הכנסה · צריכה · העברה · הון).

   ההכרעות מהאפיון (5.9.2026) שהקוד הזה מממש:
   · ארבעה דליים. רק "צריכה" עונה על "על מה הוצאנו". העברות מקוזזות
     ומוצגות בנפרד. הדלי נגזר מהקטגוריה (creditBucket) — לא נשמר.
   · כלל לא מוחל אחורה. הוא הופך הצעה, ויועד מאשר בקבוצות.
   · שלושה מצבים לשורה: pending · auto (נספר, מסומן לסקירה) · ok.
   · זוג מתקזז (אותו כרטיס, סכום הפוך בדיוק, ±3 ימים) ננעל לבד.
     כל זיכוי אחר — קישור ידני (offsetOf), ופאנל "נכנסו ולא שויכו".
   · תשלומים: נספר מה שחויב בפועל; מה שנשאר — פאנל נפרד.
   · בסיס זמן: חיוב (ברירת מחדל, מתלכד עם הבנק) או עסקה.

   ⚠️ המנוע לא מנרמל שמות סוחרים. הנירמול קורה בקליטה (merchants.js)
   ונשמר ב-merchantNorm. עותק שני של הנירמול היה נפרד בשקט.
   ================================================================ */
import { creditBucket } from './ingestPlan.js';
import { reconcile } from './bankRules.js';

export const BUCKET = { income: 'הכנסה', consume: 'צריכה', transfer: 'העברה', capital: 'הון' };
export const PENDING = 'בהמתנה';

/* מילות עצירה. ערים וסיומות מסלקה הן ידע של יועד — `יבנה` לבדה
   קישרה 13 סוחרים שאין ביניהם דבר (נמדד 5.9.2026). */
export const STOP = ['בעמ', 'בע', 'מ', 'ה', 'בית', 'של', 'רשת', 'ישראל', 'אתר', 'סנטר', 'טאון', 'מרכז', 'חנות',
  'יבנה', 'ציונה', 'גבעתיים', 'מידטאון', 'איכילוב', 'רמבם', 'גמא', 'יציל', 'ראשלצ', 'רחובות',
  'אשדוד', 'חיפה', 'ירושלים', 'בעיר', 'העמק', 'השרון', 'דיזנגוף', 'הקישון', 'נתבג', 'אילון',
  'LTD', 'THE', 'AND', 'INC', 'CO'];

/* הצעה לפי מילה בשם. לא נכתבת לשום מקום — רק ממלאת מראש את הבורר. */
export const KEYWORDS = [
  ['בייקרי|רולדין|מאפ|לחם|קייזר|קונדיטור|לוליטה|בייקר|כהנים|בבקה', 'מזון', 'מאפייה'],
  ['קפה|ארומה|אספרסו|CAFE|COFFEE', 'מזון', 'בית קפה'],
  ['בורגר|פיצה|חומוס|מסעדת|סושי|גריל|שווארמה|פלאפל|WOLT', 'מזון', 'מסעדה'],
  ['גלידה|גלידת|ממתקים|סוויט', 'מזון', 'ממתקים'],
  ['מרקט|צרכני|מכולת|סופרמרקט|שופרסל|רמי לוי', 'מזון', 'סופרמרקט'],
  ['חניון|חניה|פנגו', 'תחבורה', 'חניה'],
  ['דלק|סונול|YELLOW|מנטה|פז ', 'תחבורה', 'דלק'],
  ['מוביט|רכבת|תחבורה', 'תחבורה', 'תחבורה ציבורית'],
  ['ביטוח|פספורטכארד|דיירקט', 'ביטוח', 'ביטוח'],
  ['רפואי|מכבי|כללית|שיבא|קופת', 'בריאות', 'רפואה'],
  ['פארם|טבע בריא', 'בריאות', 'פארם'],
  ['שיער|קוסמט', 'טיפוח', 'טיפוח'],
  ['מלון|HOTEL|נופש|DUTY FREE|טרמינל', 'נסיעות', 'נסיעות'],
  ['משתלה|משתלות|גינון|הום|טרלידור', 'בית', 'בית וגינון'],
  ['זארה|אינטימה|גוטקס|VICTORIA|ביגוד', 'קניות', 'ביגוד'],
  ['KSP|K S P|מחשב|אלקטרו', 'קניות', 'אלקטרוניקה'],
  ['PAYBOX|BIT |ביט |העברה', 'העברות', 'העברה אישית'],
  ['SPOTIFY|PRIME|APPLECOM|ANTHROPIC|TRADINGVIEW|RISEUP|YES', 'מנויים', 'תוכנה'],
];

/* קטגוריות ברירת מחדל — רק כשאין אוסף categories במסד. */
export const CATS_FALLBACK = {
  'מזון': ['סופרמרקט', 'מסעדה', 'בית קפה', 'מאפייה', 'משלוחים', 'ממתקים'],
  'תחבורה': ['חניה', 'דלק', 'רכב', 'תחבורה ציבורית'],
  'בריאות': ['פארם', 'רפואה', 'כושר'],
  'מנויים': ['מדיה', 'תוכנה', 'תקשורת'],
  'ביטוח': ['ביטוח', 'ביטוח חיים', 'ביטוח רכב'],
  'קניות': ['ביגוד', 'אלקטרוניקה', 'כללי'],
  'בית': ['בית וגינון', 'שירותים לבית', 'ועד בית'],
  'טיפוח': ['טיפוח'], 'נסיעות': ['נסיעות', 'מלונות'],
  'חינוך': ['לימודים', 'חוגים'], 'העברות': ['העברה אישית'], 'הטבות': ['טעינת כרטיס'],
};

const round2 = v => Math.round(v * 100) / 100;
const s = v => (v == null ? '' : String(v).trim());
const n = v => { const x = Number(v); return isFinite(x) ? x : 0; };

/* מסמך expenses → שורה פנימית. שמות קצרים כמו ב-v3, כדי שהלוגיקה
   המוסבת תישאר קריאה מול המקור. */
export function rowOf(d) {
  return {
    id: d.id, date: s(d.date), card: s(d.card), billing: s(d.billingKey),
    merchant: s(d.merchant), norm: s(d.merchantNorm) || s(d.merchant),
    amount: n(d.amount), charge: n(d.charge),
    note: s(d.note), noteKind: s(d.noteKind),
    installment: n(d.installment), installments: n(d.installments),
    cat: s(d.category), sub: s(d.subcategory), tag: s(d.tag),
    status: s(d.status) || 'pending', ruleId: s(d.ruleId), offsetOf: s(d.offsetOf),
  };
}

/* ── קטגוריות: מסמכי categories → { קטגוריה: [תתי קטגוריה] } ── */
export function catMap(catDocs, rows = []) {
  const m = {};
  (catDocs || []).filter(c => c.active !== false && s(c.category))
    .sort((a, b) => (n(a.order) - n(b.order)) || s(a.category).localeCompare(s(b.category)))
    .forEach(c => { (m[c.category] = m[c.category] || []); if (s(c.subcategory) && !m[c.category].includes(c.subcategory)) m[c.category].push(c.subcategory); });
  const base = Object.keys(m).length ? m : JSON.parse(JSON.stringify(CATS_FALLBACK));
  /* קטגוריה שבשימוש בשורה אבל חסרה ברשימה — מוצגת, לא נעלמת */
  rows.forEach(r => { if (r.cat && !base[r.cat]) base[r.cat] = []; if (r.cat && r.sub && !base[r.cat].includes(r.sub)) base[r.cat].push(r.sub); });
  return base;
}

/* ── אסימונים ── ≥3 תווים, לא מילת עצירה. */
export function tokens(str, stop = STOP) {
  const block = new Set(stop.map(t => String(t).toUpperCase()));
  return String(str || '').toUpperCase().split(/[\s\-–—/.,()]+/).filter(t => t.length >= 3 && !block.has(t));
}

/* ── צבירת שורות לסוחרים ── */
export function byMerchant(rows) {
  const m = {};
  rows.forEach(r => {
    const o = m[r.norm] = m[r.norm] || { norm: r.norm, sample: r.merchant, rows: 0, total: 0, mo: {}, cards: {}, ids: [] };
    o.rows++; o.total += r.charge; o.ids.push(r.id);
    o.mo[r.billing] = round2((o.mo[r.billing] || 0) + r.charge);
    o.cards[r.card] = 1;
  });
  return Object.values(m).map(o => ({ ...o, total: round2(o.total), cards: Object.keys(o.cards) }));
}

/* ── קיבוץ סוחרים ── חמדני: בכל סבב האסימון עם הציון הגבוה. ציון =
   גודל × (0.4 + שיעור הפתיחה). שם עסק פותח את השם ("סופר פארם"), שם
   עיר יושב בסוף ("רמי לוי - יבנה"). שיעור הפתיחה קובע רק מה מסומן
   מראש — לעולם לא מה נכתב. */
export function group(merchants, { stopwords, minLead = 0.5 } = {}) {
  const stop = stopwords && stopwords.length ? stopwords : STOP;
  const stat = {};
  merchants.forEach(o => {
    const seen = new Set();
    tokens(o.norm, stop).forEach((x, i) => {
      if (seen.has(x)) return; seen.add(x);
      const st = stat[x] = stat[x] || { token: x, ms: [], first: 0 };
      st.ms.push(o);
      if (i === 0) st.first++;
    });
  });
  const taken = new Set(), groups = [];
  for (;;) {
    let best = null;
    for (const k of Object.keys(stat)) {
      const free = stat[k].ms.filter(o => !taken.has(o.norm));
      if (free.length < 2) continue;
      const lead = stat[k].first / stat[k].ms.length;
      const score = free.length * (0.4 + lead);
      if (!best || score > best.score) best = { token: k, free, lead, score };
    }
    if (!best) break;
    best.free.forEach(o => taken.add(o.norm));
    groups.push({
      token: best.token, lead: Math.round(best.lead * 100), confident: best.lead >= minLead,
      members: best.free.slice().sort((a, b) => b.total - a.total),
      rows: best.free.reduce((a, o) => a + o.rows, 0),
      total: round2(best.free.reduce((a, o) => a + o.total, 0)),
    });
  }
  groups.sort((a, b) => b.total - a.total);
  const singles = merchants.filter(o => !taken.has(o.norm)).sort((a, b) => b.total - a.total);
  return { groups, singles };
}

/* ── עוגנים להצעה משכן ── אסימון בשתי קטגוריות שונות נפסל (אחרת
   `סופר` היה מקשר סופר-פארם לסופרמרקט). */
export function buildAnchors(rows, stop = STOP) {
  const m = {};
  rows.forEach(r => {
    if (!r.cat) return;
    tokens(r.norm, stop).forEach(t => {
      const a = m[t] = m[t] || { token: t, cat: r.cat, sub: r.sub, n: 0, conflict: false };
      if (a.cat !== r.cat) a.conflict = true;
      a.n++;
    });
  });
  return Object.fromEntries(Object.entries(m).filter(([, a]) => !a.conflict));
}

export function suggest(name, { keywords = KEYWORDS, anchors = {}, stopwords } = {}) {
  for (const [re, cat, sub] of keywords) {
    try { if (new RegExp(re, 'i').test(name)) return { cat, sub, via: 'keyword' }; } catch (e) { /* ביטוי שבור — מדלגים */ }
  }
  let best = null;
  tokens(name, stopwords).forEach(t => { const a = anchors[t]; if (a && (!best || a.n > best.n)) best = a; });
  return best ? { cat: best.cat, sub: best.sub, via: `neighbor:${best.token}` } : { cat: '', sub: '', via: '' };
}

/* מה מחכה להחלטה: קבוצות וסוחרים בודדים מהשורות בלי קטגוריה, עם הצעה. */
export function decisions(rows, { stopwords = STOP } = {}) {
  const anchors = buildAnchors(rows.filter(r => r.cat), stopwords);
  const pend = byMerchant(rows.filter(r => !r.cat && !r.offsetOf));   // זיכוי מקושר כבר הוכרע
  const g = group(pend, { stopwords });
  const ctx = { anchors, stopwords };
  g.groups.forEach(x => { const a = suggest(x.members[0].norm, ctx); x.sug = a.cat ? a : suggest(x.token, ctx); });
  g.singles.forEach(x => { x.sug = suggest(x.norm, ctx); });
  return g;
}

/* שורות שסווגו אוטומטית (כלל) ומחכות לעין אנושית — מקובצות לפי
   קטגוריה, כדי לאשר קבוצה בלחיצה. */
export function autoReview(rows) {
  const m = {};
  rows.filter(r => r.status === 'auto' && r.cat).forEach(r => {
    const k = `${r.cat}|${r.sub}`;
    const o = m[k] = m[k] || { key: k, cat: r.cat, sub: r.sub, rows: [], total: 0, merchants: new Set() };
    o.rows.push(r); o.total = round2(o.total + r.charge); o.merchants.add(r.norm);
  });
  return Object.values(m).map(o => ({ ...o, merchants: [...o.merchants] })).sort((a, b) => b.total - a.total);
}

export function progress(rows) {
  /* זיכוי שקושר להוצאה (offsetOf) נחשב מוכרע — הוא נספר בקטגוריה שלה */
  const done = r => r.cat || r.offsetOf;
  const ok = rows.filter(r => r.status === 'ok' && done(r)).length;
  const auto = rows.filter(r => r.status === 'auto' && done(r)).length;
  return { ok, auto, pending: rows.length - ok - auto, total: rows.length };
}

/* ── זוגות מתקזזים ── עסקה והיפוכה: אותו כרטיס, סכום הפוך בדיוק,
   עד 3 ימים. רק ההתאמה המדויקת ננעלת (נמדד: 2 זוגות מתוך 574). */
export function washPairs(rows, days = 3) {
  const win = days * 86400000;
  const ms = d => Date.parse(d) || 0;          // 'YYYY-MM-DD' → חצות UTC; ההפרש לא תלוי אזור
  const neg = rows.filter(r => r.charge < 0 && !r.offsetOf), pos = rows.filter(r => r.charge > 0);
  const used = new Set(), pairs = [];
  neg.forEach(a => {
    const b = pos.find(p => !used.has(p.id) && p.card === a.card && Math.abs(p.charge + a.charge) <= 0.01 && Math.abs(ms(p.date) - ms(a.date)) <= win);
    if (b) { used.add(b.id); pairs.push({ credit: a, debit: b, amount: Math.abs(a.charge) }); }
  });
  return pairs;
}

const monthOf = (r, basis) => (basis === 'date' ? r.date.slice(0, 7) : r.billing);

/* הקטגוריה שבה השורה נספרת. זיכוי שקושר ידנית להוצאה (offsetOf) יורש
   את הקטגוריה שלה — כך החזר על מעיל מקטין את "ביגוד" ולא נשאר צף. */
function effCat(r, byId) {
  if (r.cat) return { cat: r.cat, sub: r.sub };
  if (r.offsetOf && byId[r.offsetOf] && byId[r.offsetOf].cat) return { cat: byId[r.offsetOf].cat, sub: byId[r.offsetOf].sub };
  return { cat: '', sub: '' };
}

/* סינון אחד לסיכום ולרשימת השורות — כדי ש"₪1,200 מזון" ייפתח בדיוק
   לשורות שמסתכמות ב-₪1,200. בדיקה נועלת את השוויון. */
function filterFn(opts, byId) {
  const basis = opts.basis === 'date' ? 'date' : 'billing';
  const wash = new Set();
  (opts.washPairs || []).forEach(p => { wash.add(p.credit.id); wash.add(p.debit.id); });
  return {
    basis, wash,
    keep: r => {
      if (wash.has(r.id)) return false;
      if (opts.month && opts.month !== 'all' && monthOf(r, basis) !== opts.month) return false;
      if (opts.tag && opts.tag !== 'all' && r.tag !== opts.tag) return false;
      return true;
    },
    cat: r => effCat(r, byId),
  };
}

const indexById = rows => Object.fromEntries(rows.map(r => [r.id, r]));

export function summarize(rows, opts = {}) {
  const byId = indexById(rows);
  const f = filterFn(opts, byId);
  const byCat = {}, bySub = {}, byMonth = {}, byTag = {}, buckets = {};
  let consume = 0, transfer = 0, capital = 0, pending = 0, washed = 0, used = 0;
  rows.forEach(r => {
    if (f.wash.has(r.id)) { washed += Math.abs(r.charge); return; }
    if (!f.keep(r)) return;
    used++;
    const { cat, sub } = f.cat(r);
    const b = creditBucket(cat);
    buckets[b] = round2((buckets[b] || 0) + r.charge);
    /* התג נספר לפני הדליים: טיול אוסף גם קניות וגם מסעדות */
    if (r.tag) byTag[r.tag] = round2((byTag[r.tag] || 0) + r.charge);
    if (b === BUCKET.transfer) { transfer += r.charge; return; }
    if (b === BUCKET.capital) { capital += r.charge; return; }
    const m = monthOf(r, f.basis);
    byMonth[m] = round2((byMonth[m] || 0) + r.charge);
    const k = cat || PENDING;
    if (!cat) pending += r.charge; else consume += r.charge;
    byCat[k] = round2((byCat[k] || 0) + r.charge);
    const sk = `${k}|${sub || ''}`;
    bySub[sk] = round2((bySub[sk] || 0) + r.charge);
  });
  const list = o => Object.entries(o).map(([k, v]) => ({ k, sum: v }));
  return {
    rows: used, consume: round2(consume), pending: round2(pending), spend: round2(consume + pending),
    transfer: round2(transfer), capital: round2(capital), washed: round2(washed), buckets,
    byCat: list(byCat).map(x => ({ cat: x.k, sum: x.sum })).sort((a, b) => b.sum - a.sum),
    bySub: list(bySub).map(x => { const [cat, sub] = x.k.split('|'); return { cat, sub, sum: x.sum }; }).sort((a, b) => b.sum - a.sum),
    byMonth: list(byMonth).map(x => ({ month: x.k, sum: x.sum })).sort((a, b) => a.month.localeCompare(b.month)),
    byTag: list(byTag).map(x => ({ tag: x.k, sum: x.sum })).sort((a, b) => b.sum - a.sum),
  };
}

/* אותו סינון, שורות במקום סכום. cat = שם קטגוריה או PENDING. */
export function rowsIn(rows, opts = {}) {
  const byId = indexById(rows);
  const f = filterFn(opts, byId);
  return rows.filter(r => {
    if (!f.keep(r)) return false;
    if (!opts.cat) return true;
    const { cat, sub } = f.cat(r);
    /* תת-קטגוריה — לפי הקטגוריה האפקטיבית, בדיוק כמו bySub */
    if (opts.sub !== undefined && (sub || '') !== (opts.sub || '')) return false;
    const b = creditBucket(cat);
    if (b !== BUCKET.consume) return opts.cat === cat;       // העברות/הון — רק כשמבקשים אותן בשמן
    return (cat || PENDING) === opts.cat;
  });
}

export function months(rows, basis = 'billing') {
  return [...new Set(rows.map(r => monthOf(r, basis)).filter(Boolean))].sort();
}

/* ── תשלומים פתוחים ── "כמה עוד נשאר לשלם" ≠ "כמה הוצאתי". מכל עסקה
   לוקחים רק את החיוב האחרון שנקלט, אחרת עסקה של 48 תשלומים שנקלטה
   בשלושה חודשים הייתה נספרת שלוש פעמים. */
export function openInstallments(rows) {
  const latest = {};
  rows.forEach(r => {
    if (r.noteKind !== 'installment' || !r.installments || !r.installment) return;
    const k = `${r.card}|${r.norm}|${r.amount}|${r.installments}`;
    if (!latest[k] || r.installment > latest[k].installment) latest[k] = r;
  });
  return Object.values(latest).map(r => {
    const left = r.installments - r.installment;
    return left > 0 ? { id: r.id, merchant: r.norm, per: r.charge, left, remaining: round2(r.charge * left), of: r.installments, at: r.installment, full: r.amount, date: r.date, cat: r.cat } : null;
  }).filter(Boolean).sort((a, b) => b.remaining - a.remaining);
}

/* ── זיכויים שלא שויכו ── כסף שנכנס לכרטיס ולא ברור על מה. לא נעלם
   בשקט: פאנל קבוע עד שיקושר או יסווג. */
export function unlinkedCredits(rows, pairs = []) {
  const wash = new Set(pairs.flatMap(p => [p.credit.id, p.debit.id]));
  return rows.filter(r => r.charge < 0 && !wash.has(r.id) && !r.offsetOf && !r.cat).sort((a, b) => a.charge - b.charge);
}

/* מועמדים לקישור זיכוי: אותו כרטיס, הוצאה (חיובית), עד 120 יום לפניו,
   הקרובים בסכום קודם. הצעה בלבד — יועד בוחר. */
export function offsetCandidates(credit, rows, { limit = 8 } = {}) {
  const t = Date.parse(credit.date) || 0;
  return rows.filter(r => r.charge > 0 && r.card === credit.card && r.id !== credit.id)
    .map(r => ({ r, dt: (t - (Date.parse(r.date) || 0)) / 86400000, gap: Math.abs(r.charge + credit.charge) }))
    .filter(x => x.dt >= -3 && x.dt <= 120)
    .sort((a, b) => a.gap - b.gap || a.dt - b.dt)
    .slice(0, limit).map(x => x.r);
}

/* ================================================================
   עו"ש
   ================================================================ */

/* מספר ההלוואה מתוך "ריבית על הלוואה 31/05 00111" → '00111'. */
export function loanKeyOf(desc) {
  const m = String(desc || '').match(/(\d{3,})\s*$/);
  return m ? m[1] : '';
}
export const isInterest = r => r.category === 'החזר הלוואה' && r.subcategory === 'ריבית';

/* ריבית: "בהתאם להלוואה" (יועד, 29.9.2026). לכל הלוואה הגדרה אם
   הריבית שלה היא הוצאה; ברירת המחדל — הוצאה. loans = settings/loans. */
export function interestIsExpense(r, loans) {
  const k = loanKeyOf(r.desc);
  const cfg = loans && loans.items && loans.items[k];
  return cfg ? cfg.interestIsExpense !== false : true;
}

export function loansOf(bank, loans) {
  const m = {};
  bank.filter(isInterest).forEach(r => {
    const k = loanKeyOf(r.desc) || '—';
    const o = m[k] = m[k] || { key: k, name: (loans && loans.items && loans.items[k] && loans.items[k].name) || '', rows: 0, interest: 0, last: '' };
    o.rows++; o.interest = round2(o.interest - r.amount); if (r.date > o.last) o.last = r.date;
    o.interestIsExpense = interestIsExpense(r, loans);
  });
  return Object.values(m).sort((a, b) => b.interest - a.interest);
}

/* הדלי שבו שורת עו"ש נספרת בפועל, והסיבה:
   · ריבית הלוואה — לפי ההגדרה של אותה הלוואה.
   · סילוק כרטיס שיש לו פירוט → העברה (הפירוט הוא ההוצאה).
   · סילוק כרטיס בלי פירוט → "הוצאה מרוכזת", נספרת במלואה. בלי זה
     חיוב של ₪16,938 (6/2026) היה נעלם, וכך גם כאל שאין לו דוח. */
export function bankEffective(bank, expenses, loans) {
  const rec = reconcile(bank, expenses.map(e => ({ card: e.card, billing: e.billing, charge: e.charge })));
  const recById = Object.fromEntries(rec.map(x => [x.id, x]));
  return bank.map(r => {
    let effBucket = r.bucket, why = '';
    if (isInterest(r)) {
      const exp = interestIsExpense(r, loans);
      effBucket = exp ? BUCKET.consume : BUCKET.capital;
      why = exp ? 'ריבית — מוגדרת כהוצאה' : 'ריבית — מוגדרת כחלק מההלוואה';
    } else if (recById[r.id]) {
      const x = recById[r.id];
      if (x.status === 'no-detail') { effBucket = BUCKET.consume; why = 'חיוב כרטיס בלי פירוט — הוצאה מרוכזת'; }
      else why = x.status === 'match' ? 'סילוק — תואם לפירוט' : `סילוק — פער ${x.gap}`;
    }
    return { ...r, effBucket, effWhy: why, rec: recById[r.id] || null };
  });
}

/* תזרים חודשי לפי דלי אפקטיבי. amount חיובי = נכנס. */
export function cashflow(effRows) {
  const m = {};
  effRows.forEach(r => {
    const k = String(r.date).slice(0, 7);
    const o = m[k] = m[k] || { month: k, in: 0, out: 0, income: 0, consume: 0, transfer: 0, capital: 0, pending: 0 };
    if (r.amount > 0) o.in += r.amount; else o.out -= r.amount;
    const b = r.effBucket;
    const v = r.amount;
    if (!b) o.pending += v;
    else if (b === BUCKET.income) o.income += v;
    else if (b === BUCKET.consume) o.consume -= v;
    else if (b === BUCKET.transfer) o.transfer += v;
    else if (b === BUCKET.capital) o.capital += v;
  });
  return Object.values(m).map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v])))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/* שורות עו"ש שעוד לא החליטו עליהן — מקובצות לפי "חתימת" תיאור. */
export function bankPending(bank) {
  const sig = d => String(d || '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const m = {};
  bank.filter(r => r.status === 'pending' || !r.bucket).forEach(r => {
    const k = sig(r.desc);
    const o = m[k] = m[k] || { sig: k, sample: r.desc, rows: [], total: 0 };
    o.rows.push(r); o.total = round2(o.total + r.amount);
  });
  return Object.values(m).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}
