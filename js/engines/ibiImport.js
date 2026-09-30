/* ================================================================
   IBI IMPORT — קליטת קובץ ייצוא תנועות מאיביאי (data N.xlsx).
   פונקציות טהורות: שום דבר לא נכתב כאן. המסך מציג את התוכנית,
   ורק אחרי אישור היא נכתבת.

   מבנה הקובץ (נבדק על data 11.xlsx, 643 שורות, 30.9.2026):
   גיליון אחד, כותרת בשורה 1, 13 עמודות, סדר כרונולוגי הפוך.
   אין עמודת תיק — התיק נבחר בזמן הקליטה.
   תאריך כמחרוזת DD/MM/YYYY · מטבע עם רווח נגרר ('$ ') · סימבול
   לפעמים מספר (9993983 = מגן מס) · שמות עם רווחים כפולים
   ('אמאזון     AMZN') · שער ביצוע עם עד 5 ספרות אחרי הנקודה.

   ── מניעת כפילויות: שש שכבות ──────────────────────────────────
   מה שנמצא בבדיקה על הקובץ האמיתי: הגיליון הישן שמר את השורות
   **אחרי עיבוד** — רווחים כפולים בשם כווצו, ושער הביצוע עוגל ל-2
   ספרות (317.9356 → 317.94). השוואה "תו בתו" לשורות שכבר במסד
   הייתה מזהה רק 495 מתוך 622 — ו-127 שורות היו נכתבות **פעמיים**.
   לכן ההשוואה נעשית על תוכן מנורמל, לא על מזהה המסמך:

   1. גיבוב הקובץ — אותו קובץ בדיוק פעמיים → נדחה מיד.
   2. מפתח תוכן מנורמל (matchKey) — שם בלי רווחים כפולים, סכומים
      ושער מעוגלים ל-2 ספרות, כמות ל-6. כך שורה מהגיליון הישן ושורה
      מהקובץ הגולמי מקבלות אותו מפתח. נבדק: 622/622.
   3. ספירה, לא סדר — לכל מפתח: כמה בקובץ, כמה במסד. חדשות = רק
      העודף. שתי קניות זהות באותו יום הן שתיים, לא אחת.
   4. מזהה מסמך דטרמיניסטי — שורה חדשה מקבלת מזהה מהמפתח ומספר
      המופע. לחיצה כפולה או קליטה שנקטעה באמצע כותבות על אותו מסמך.
   5. בדיקת תיק — הקובץ מושווה לכל התיקים. אם הוא תואם תיק אחר יותר
      מהתיק שנבחר, הקליטה נעצרת.
   6. "חדשה בתוך תקופה מכוסה" — שורה חדשה שהתאריך שלה כבר מכוסה
      במסד חשודה (אולי שינוי פורמט). כל אחת דורשת אישור מפורש, ומעל
      סף — הקובץ נדחה כולו.
   ואחרי הכתיבה: המסך מריץ את התוכנית שוב מול המסד המעודכן, ומוודא
   שקליטה חוזרת של אותו קובץ מוסיפה אפס שורות.
   ================================================================ */
import { fromSheetRow, toEngineRow } from './model.js';
import { Classifier } from './classifier.js';
import { docId } from './hash.js';

/* כותרת בקובץ → שם השדה בגיליון הישן (ומשם fromSheetRow, כמו במיגרציה). */
export const IBI_COLUMNS = {
  'תאריך': 'Date', 'סוג פעולה': 'Type', 'שם נייר': 'Name', "מס' נייר / סימבול": 'Symbol',
  'כמות': 'Qty', 'שער ביצוע': 'ExecutionRate', 'מטבע': 'Currency', 'עמלת פעולה': 'Commission',
  'עמלות נלוות': 'Fees', 'תמורה במט"ח': 'TotalFX', 'תמורה בשקלים': 'TotalILS',
  'יתרה שקלית': 'CashBalanceILS', 'אומדן מס רווחי הון': 'EstimatedTax',
};
const NUMERIC = ['Qty', 'ExecutionRate', 'Commission', 'Fees', 'TotalFX', 'TotalILS', 'CashBalanceILS', 'EstimatedTax'];

/* שדות שהברוקר משנה בדיעבד. לא חלק מהמפתח; בשורה קיימת הם מתעדכנים.
   estimatedTax — הוכח ב-3.9 (אומדן המס מתעדכן רטרואקטיבית).
   cashBalanceIls — היתרה אחרי השורה תלויה בסדר השורות בתוך היום. */
export const MUTABLE = ['estimatedTax', 'cashBalanceIls'];
/* שדות שלא בתוך המפתח ולא אמורים להשתנות. הבדל = הודעה, לא שינוי. */
const WATCH = ['commission', 'fees', 'currency'];

/* סף הדחייה של שכבה 6: יותר מזה "חדשות בתוך תקופה מכוסה" = כנראה
   שהפורמט השתנה, והקובץ נדחה כולו. */
export const INSIDE_LIMIT = { abs: 3, ratio: 0.05 };

export const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/* עיגול סימטרי (חצי מתעגל הרחק מאפס, כמו בגיליונות). ה-1e-7 מתקן
   ייצוג בינארי: 244.305 × 100 = 24430.4999… → 24431, לא 24430. */
export function round(x, d) {
  const f = 10 ** d;
  const n = Number(x) || 0;
  const r = Math.sign(n) * Math.round(Math.abs(n) * f + 1e-7) / f;
  return r === 0 ? 0 : r;                       // בלי ‎-0
}

/* המפתח המנורמל — הלב של מניעת הכפילויות. */
export function matchKey(d) {
  return [
    d.date, d.type, d.symbol, d.portfolio, clean(d.name),
    round(d.qty, 6), d.amountIls == null ? '' : round(d.amountIls, 2),
    round(d.price, 2), round(d.totalFx, 2), round(d.totalIls, 2),
  ].join('|');
}

/* מפתח רופף: אותו יום, סוג, נייר וכמות. משמש רק לאזהרה — "השורה
   החדשה הזו דומה לשורה קיימת שלא נמצא לה זוג". */
export function looseKey(d) {
  return [d.date, d.type, d.symbol, d.portfolio, d.amountIls == null ? round(d.qty, 6) : round(d.amountIls, 2)].join('|');
}

/* איפה שורת הכותרת (בדרך כלל שורה 1) ואיפה כל עמודה. */
export function findIbiHeader(values) {
  const lim = Math.min((values || []).length, 10);
  for (let r = 0; r < lim; r++) {
    const cells = (values[r] || []).map(clean);
    const cols = {};
    let all = true;
    for (const [he, field] of Object.entries(IBI_COLUMNS)) {
      const i = cells.indexOf(clean(he));
      if (i < 0) { all = false; break; }
      cols[field] = i;
    }
    if (all) return { row: r, cols };
  }
  return null;
}
export const isIbiSheet = values => !!findIbiHeader(values);

const pad = n => String(n).padStart(2, '0');
function dateCell(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  return v;
}
/* מספר "נקי": מספר, או מחרוזת שכולה ספרות/פסיקים/נקודה/מינוס. אחרת
   toNum היה הופך "abc" ל-0 בשקט — ושקט כזה הוא בדיוק מה שאסור. */
const numOk = v => v === '' || v == null || typeof v === 'number' || /^\s*-?[\d,]*\.?\d+\s*$/.test(String(v));

/* ערכי גיליון → מסמכים (בלי תיק). */
export function parseIbiSheet(values) {
  const hdr = findIbiHeader(values);
  if (!hdr) return { header: false, rows: [], problems: [], range: null };
  const rows = [], problems = [];
  for (let r = hdr.row + 1; r < values.length; r++) {
    const line = values[r] || [];
    const raw = {};
    for (const [field, i] of Object.entries(hdr.cols)) raw[field] = line[i];
    if (Object.values(raw).every(v => clean(dateCell(v)) === '')) continue;   // שורה ריקה
    const bad = NUMERIC.filter(f => !numOk(raw[f]));
    const { doc, problems: p } = fromSheetRow({ ...raw, Date: dateCell(raw.Date), Portfolio: '-' });
    const all = [...p, ...bad.map(f => `ערך לא מספרי ב-${f}: "${raw[f]}"`)];
    if (all.length) { problems.push({ row: r + 1, text: all.join(' · ') }); continue; }
    doc.name = clean(doc.name);
    doc.currency = clean(doc.currency);
    doc.portfolio = '';
    doc.source = { kind: 'ibi', sheetRow: r + 1 };
    rows.push(doc);
  }
  const dates = rows.map(d => d.date).sort();
  return { header: true, rows, problems, range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null };
}

const group = (docs, keyFn) => docs.reduce((m, d) => { (m[keyFn(d)] = m[keyFn(d)] || []).push(d); return m; }, {});
const inRange = (d, range) => d.date >= range.from && d.date <= range.to;

/* כמה משורות הקובץ נמצאות כבר בתיק p (ספירה לפי מפתח). */
export function overlap(fileDocs, existing, p, range) {
  const ex = existing.filter(d => d.portfolio === p && !d.voided && inRange(d, range));
  const exG = group(ex, matchKey);
  const fiG = group(fileDocs.map(d => ({ ...d, portfolio: p })), matchKey);
  let matched = 0;
  for (const k in fiG) matched += Math.min(fiG[k].length, (exG[k] || []).length);
  return { portfolio: p, matched, existingInRange: ex.length };
}

/* ctx: { fileName, hash, portfolio, existing, imports, now }
   existing = כל מסמכי transactions **כולל מבוטלים** (עם id).
   imports  = כל רשומות יומן הקליטות, כולל מבוטלות.
   (importedHashes — אפשר להעביר ישירות במקום imports; לבדיקות.)

   שני סוגי "מבוטל", ושני טיפולים שונים:
   · יועד ביטל שורה בעצמו (פער, כפילות) → נספרת כקיימת, כדי שלא תחזור
     בשקט בקליטה הבאה.
   · השורה בוטלה כי **כל הקליטה שלה בוטלה** ביומן → כאילו לא הייתה.
     אם הקובץ הבא מכיל אותה, היא חוזרת (באותו מזהה בדיוק). אחרת ביטול
     של קליטה ישנה היה מוחק לתמיד שורה אמיתית שגם קובץ חדש יותר מכיל. */
export async function planIbi(values, ctx) {
  const now = ctx.now || Date.now();
  const imports = ctx.imports || [];
  const importedHashes = ctx.importedHashes || new Set(imports.filter(i => i.status === 'ok' && !i.voided).map(i => i.hash));
  const undone = new Set(imports.filter(i => i.voided).map(i => i.id));
  /* מזהה קליטה ייחודי לכל קליטה (גם של אותו קובץ אחרי ביטול) — רשומת
     יומן היא יצירה בלבד, ו"כתיבה על" רשומה קיימת נדחית בכללים. */
  const importId = `i-${ctx.hash.slice(0, 16)}-${now.toString(36)}`;
  const base = {
    kind: 'ibi', importId, fileName: ctx.fileName, hash: ctx.hash, portfolio: ctx.portfolio || '',
    status: '', warnings: [], problems: [], add: [], updates: [], staleUpdates: [], gaps: [], edgeGaps: [], attention: [], differs: [],
    matched: 0, matchedVoided: 0, revived: 0, skipped: 0, parsed: 0, range: null, portfolioCheck: [], suggested: '',
  };
  const seenFile = importedHashes.has(ctx.hash);
  const parsed = parseIbiSheet(values);
  if (!parsed.header) return { ...base, status: 'unsupported', warnings: ['לא נמצאה שורת הכותרות של ייצוא איביאי (13 העמודות).'] };
  base.parsed = parsed.rows.length + parsed.problems.length;
  base.range = parsed.range;
  if (parsed.problems.length) {
    return { ...base, status: 'rejected', problems: parsed.problems,
      warnings: [`${parsed.problems.length} שורות לא פוענחו. הקובץ נדחה כולו — קליטה חלקית גרועה מאי-קליטה.`] };
  }
  if (!parsed.rows.length) return { ...base, status: 'rejected', warnings: ['אין תנועות בקובץ.'] };

  const isUndone = d => d.voided && d.source && undone.has(d.source.importId);
  const existing = (ctx.existing || []).filter(d => !isUndone(d));
  const undoneIds = new Set((ctx.existing || []).filter(isUndone).map(d => d.id));
  const range = parsed.range;

  /* שכבה 5: לאיזה תיק הקובץ שייך */
  const portfolios = [...new Set(existing.map(d => d.portfolio).filter(Boolean))].sort();
  base.portfolioCheck = portfolios.map(p => overlap(parsed.rows, existing, p, range)).sort((a, b) => b.matched - a.matched);
  base.suggested = base.portfolioCheck[0] && base.portfolioCheck[0].matched > 0 ? base.portfolioCheck[0].portfolio : '';
  if (!ctx.portfolio) return { ...base, status: 'needs-portfolio' };
  const p = String(ctx.portfolio).trim();
  base.portfolio = p;
  const mine = base.portfolioCheck.find(c => c.portfolio === p) || { matched: 0, existingInRange: 0 };
  const better = base.portfolioCheck.find(c => c.portfolio !== p && c.matched > mine.matched);
  if (better) {
    return { ...base, status: 'wrong-portfolio',
      warnings: [`נבחר "${p}", אבל ${better.matched} משורות הקובץ כבר קיימות ב"${better.portfolio}" (וב"${p}" רק ${mine.matched}). הקליטה נעצרה כדי לא לשכפל את התיק.`] };
  }
  if (mine.existingInRange > 0 && mine.matched === 0) {
    return { ...base, status: 'rejected',
      warnings: [`ב"${p}" יש כבר ${mine.existingInRange} תנועות בתקופה של הקובץ, ואף אחת לא תואמת. כנראה תיק שגוי או פורמט שהשתנה — לא נכתב כלום.`] };
  }

  /* קובץ ישן מהקליטה האחרונה של התיק לא מחזיר ערכים ישנים (אומדן מס). */
  const newestTo = imports.filter(i => i.kind === 'ibi' && i.status === 'ok' && !i.voided && i.portfolio === p && i.range)
    .reduce((m, i) => (i.range.to > m ? i.range.to : m), '');
  const staleFile = !!newestTo && range.to < newestTo;

  /* שכבות 2–4: השוואה לפי מפתח וספירה */
  const fileDocs = parsed.rows.map(d => ({ ...d, portfolio: p }));
  const exAll = existing.filter(d => d.portfolio === p);
  const exRange = exAll.filter(d => inRange(d, range));
  const exG = group([...exRange].sort((a, b) => String(a.id).localeCompare(String(b.id))), matchKey);
  const fiG = group(fileDocs, matchKey);
  const sameMutable = (f, o) => MUTABLE.every(m => Math.abs((Number(f[m]) || 0) - (Number(o[m]) || 0)) <= 0.004);

  const fresh = [];
  for (const [k, files] of Object.entries(fiG)) {
    const olds = exG[k] || [];
    const active = olds.filter(o => !o.voided), voided = olds.filter(o => o.voided);
    const used = new Set(), pairs = [];
    /* זיווג בתוך קבוצה של שורות זהות: קודם לשורה שהערכים המשתנים שלה
       כבר שווים (אחרת שתי קניות זהות "מחליפות" יתרות בכל קליטה),
       ורק אחר כך לפי הסדר. */
    const left = files.filter(f => {
      const o = active.find(x => !used.has(x) && sameMutable(f, x));
      if (!o) return true;
      used.add(o); pairs.push([f, o]); return false;
    });
    const left2 = left.filter(f => {
      const o = active.find(x => !used.has(x));
      if (!o) return true;
      used.add(o); pairs.push([f, o]); return false;
    });
    const freshHere = left2.slice(Math.min(voided.length, left2.length));
    base.matchedVoided += left2.length - freshHere.length;
    freshHere.forEach((f, j) => fresh.push({ key: k, occ: olds.length + j + 1, doc: f }));

    pairs.forEach(([f, o]) => {
      base.matched++;
      const fields = {}, before = {};
      MUTABLE.forEach(m => { if (Math.abs((Number(f[m]) || 0) - (Number(o[m]) || 0)) > 0.004) { fields[m] = f[m]; before[m] = o[m]; } });
      if (Object.keys(fields).length) (staleFile ? base.staleUpdates : base.updates).push({ id: o.id, fields, before, doc: o });
      WATCH.forEach(m => {
        const a = f[m], b = o[m];
        const same = typeof a === 'number' ? Math.abs(a - (Number(b) || 0)) <= 0.004 : clean(a) === clean(b);
        if (!same) base.differs.push({ id: o.id, field: m, file: a, db: b, doc: o });
      });
    });
    active.filter(o => !used.has(o)).forEach(o => base.gaps.push(o));
  }
  for (const [k, olds] of Object.entries(exG)) if (!fiG[k]) olds.forEach(o => { if (!o.voided) base.gaps.push(o); });
  /* פער ביום הראשון או האחרון של הקובץ אינו ראיה: ייצוא שנעשה באמצע
     יום (או שנחתך באמצע יום) לא כולל את כל היום. הם מוצגים בנפרד,
     בלי כפתור ביטול — כדי שלא יבוטלו שורות אמיתיות. */
  base.edgeGaps = base.gaps.filter(o => o.date === range.from || o.date === range.to);
  base.gaps = base.gaps.filter(o => o.date !== range.from && o.date !== range.to).sort((a, b) => a.date.localeCompare(b.date));
  base.skipped = base.matched + base.matchedVoided;
  if (staleFile && base.staleUpdates.length) {
    base.warnings.push(`הקובץ נגמר ב-${range.to}, וכבר נקלט קובץ חדש יותר לתיק הזה (עד ${newestTo}). ${base.staleUpdates.length} ערכים משתנים (אומדן מס, יתרה) שונים בקובץ — לא מעדכנים לאחור.`);
  }

  /* שכבה 6: חדשה בתוך התקופה שכבר מכוסה במסד (בין הראשונה לאחרונה).
     שורה ביום האחרון המכוסה בדיוק — סבירה (היום הזה נקלט חלקית) ולכן
     לא נספרת לסף הדחייה, אבל עדיין דורשת אישור. */
  const act = exAll.filter(d => !d.voided);
  const firstCovered = act.reduce((m, d) => (!m || d.date < m ? d.date : m), '');
  const lastCovered = act.reduce((m, d) => (d.date > m ? d.date : m), '');
  const gapLoose = group([...base.gaps, ...base.edgeGaps], looseKey);
  const att = new Map();
  const flag = (doc, kind, similar = [], edge = false) => {
    const a = att.get(doc) || { kinds: [], doc, similar: [], edge };
    a.kinds.push(kind); a.similar.push(...similar); a.edge = a.edge && edge;
    att.set(doc, a);
  };
  fresh.forEach(x => {
    if (lastCovered && x.doc.date >= firstCovered && x.doc.date <= lastCovered) {
      const similar = gapLoose[looseKey(x.doc)] || [];
      flag(x.doc, similar.length ? 'near' : 'inside', similar, x.doc.date === lastCovered);
    }
    /* סוג תנועה שהמסווג לא מכיר — נכתב, אבל רק באישור */
    if (Classifier.classify(toEngineRow(x.doc)).category === 'UNCLASSIFIED') flag(x.doc, 'unclassified');
  });
  base.attention = [...att.values()];
  const suspicious = base.attention.filter(a => !a.edge && (a.kinds.includes('inside') || a.kinds.includes('near'))).length;
  const limit = Math.max(INSIDE_LIMIT.abs, Math.ceil(fileDocs.length * INSIDE_LIMIT.ratio));
  if (suspicious > limit) {
    return { ...base, status: 'rejected',
      warnings: [`${suspicious} שורות "חדשות" נופלות בתקופה שכבר קיימת במסד (${firstCovered}–${lastCovered}). זה יותר מדי כדי להיות מקרי — כנראה שהפורמט השתנה ושורות קיימות לא זוהו. לא נכתב כלום.`] };
  }

  /* מזהה דטרמיניסטי. מזהה של שורה שבוטלה בביטול-קליטה — מותר לשימוש
     חוזר (השורה חוזרת לחיים). כל מזהה אחר שתפוס — המופע הבא. */
  const taken = new Set(existing.map(d => d.id));
  for (const x of fresh) {
    let occ = x.occ, id = await docId('t', `ibi|${x.key}`, occ);
    while (taken.has(id)) id = await docId('t', `ibi|${x.key}`, ++occ);
    taken.add(id);
    if (undoneIds.has(id)) base.revived++;
    base.add.push({ id, data: { ...x.doc, source: { ...x.doc.source, importId, fileName: ctx.fileName } } });
  }
  base.add.sort((a, b) => a.data.date.localeCompare(b.data.date));

  if (seenFile) {
    if (!base.add.length && !base.updates.length) {
      return { ...base, status: 'duplicate-file', warnings: ['הקובץ הזה כבר נקלט (תוכן זהה, גם אם השם שונה), והמסד תואם לו. אין מה להוסיף.'] };
    }
    base.warnings.push('הקובץ הזה כבר נקלט בעבר, אבל המסד השתנה מאז (למשל קליטה אחרת בוטלה). מוצג רק מה שחסר עכשיו.');
  }
  base.status = 'ok';
  return base;
}

/* רשומת יומן הקליטות. */
export function ibiImportRecord(plan) {
  return {
    fileName: plan.fileName, hash: plan.hash, kind: 'ibi', status: plan.status, portfolio: plan.portfolio,
    range: plan.range, parsed: plan.parsed, added: plan.status === 'ok' ? plan.add.length : 0,
    skipped: plan.skipped, updated: plan.updates.length, gaps: plan.gaps.length,
    confirmed: plan.attention.length, revived: plan.revived, warnings: plan.warnings,
  };
}
