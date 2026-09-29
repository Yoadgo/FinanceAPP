/* ================================================================
   MIGRATE SPEND — העברת ההוצאות, העו"ש והקטגוריות מהגיליון הישן.

   למה בכלל: ב-v3 יועד כבר סיווג 362 שורות אשראי ביד (ספטמבר 2026).
   קליטה מחדש של קבצי הבנק הייתה מביאה את השורות — אבל לא את ההחלטות.
   לכן מעבירים את הטאבים Expenses / Bank / Categories / Imports כמו
   שהם, וממפים כל שורה למבנה המסמך של v4.

   המפתח לכל זה: **אותו מזהה מסמך כמו בקליטה רגילה.** המזהה נגזר
   מטביעת האצבע (Key) ומהמופע (Occ) — ומפענחי v4 הם אותם מפענחים של
   v3, כך שהטביעות זהות (נבדק 30.9.2026: 574/574 אשראי, 77/77 עו"ש).
   משמעות: קליטה עתידית של אותו קובץ מזהה את השורות כקיימות, בלי
   כפילויות.

   הבדיקות (כולן חייבות לעבור לפני כתיבה):
   1. מבנה      — העמודות הנדרשות קיימות.
   2. שורות     — תאריך, סכום, טביעה ומופע תקינים בכל שורה.
   3. ייחודיות  — אין שני מסמכים עם אותו מזהה.
   4. התאמה    — סכום הפירוט לכל כרטיס וחודש חיוב = שורת הסילוק בעו"ש
                  (כשיש לשניהם). זו אותה בדיקה שעברה 9/9 בייצור.
   ================================================================ */
import { parseCsv, toObjects } from '../ingest/csv.js';
import { toIsoDay } from './model.js';
import { normMerchant } from './merchants.js';
import { billingMonthKey, reconcile } from './bankRules.js';
import { docId } from './hash.js';

const num = v => { const x = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(x) ? x : 0; };
const numOrNull = v => (String(v ?? '').trim() === '' ? null : num(v));
const str = v => String(v ?? '').trim();
const round2 = x => Math.round(x * 100) / 100;

export const EXP_REQUIRED = ['Date', 'Card', 'BillingMonth', 'Merchant', 'Amount', 'Charge', 'Category', 'Status', 'Key', 'Occ'];
export const BANK_REQUIRED = ['Date', 'Desc', 'Amount', 'Bucket', 'Category', 'Status', 'Key', 'Occ'];

/* FileHash (12 תווים) → רשומת הקליטה המלאה, כדי שלכל שורה יהיה מקור */
function importIndex(imports) {
  return (imports || []).map(i => ({ hash: str(i.Hash), fileName: str(i.FileName), importId: `i-${str(i.Hash).slice(0, 20)}` }));
}
function sourceOf(fileHash, idx, kind, sheetRow, v3Id) {
  const fh = str(fileHash);
  const imp = fh ? idx.find(i => i.hash.startsWith(fh)) : null;
  return { kind, importId: imp ? imp.importId : '', fileName: imp ? imp.fileName : '', sheetRow: Number(sheetRow) || null, v3Id: str(v3Id), migrated: true };
}

const STATUS = new Set(['ok', 'auto', 'pending']);

/* שורת Expenses → מסמך expenses. problems ריק = תקינה. */
export function expenseDoc(o, idx = []) {
  const problems = [];
  const date = toIsoDay(o.Date);
  if (!date) problems.push(`תאריך לא תקין: "${o.Date}"`);
  const billing = str(o.BillingMonth);
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(billing)) problems.push(`חודש חיוב לא תקין: "${billing}"`);
  const card = str(o.Card);
  if (!/^\d{4}$/.test(card)) problems.push(`כרטיס לא 4 ספרות: "${card}"`);
  if (!str(o.Key)) problems.push('חסרה טביעת אצבע (Key)');
  const occ = Number(o.Occ);
  if (!(occ >= 1)) problems.push(`מופע לא תקין: "${o.Occ}"`);
  let status = str(o.Status) || 'pending';
  if (!STATUS.has(status)) problems.push(`סטטוס לא מוכר: "${status}"`);
  const category = str(o.Category);
  if (!category && status !== 'pending') status = 'pending';   // שורה בלי קטגוריה אינה "מסווגת"

  const currency = str(o.Currency) || 'ש"ח';
  const doc = {
    date, card, issuer: str(o.Issuer), billing, billingKey: billingMonthKey(billing),
    merchant: str(o.Merchant), merchantNorm: str(o.MerchantNorm) || normMerchant(o.Merchant),
    amount: num(o.Amount), currency,
    charge: num(o.Charge), chargeCurrency: str(o.ChargeCurrency) || 'ש"ח',
    /* המקטע בקובץ (שקלי/מט"ח) לא נשמר ב-v3. נגזר ממטבע העסקה — נבדק
       מול פענוח מחדש של הקבצים: 574/574 (567 שקלי, 7 מט"ח). */
    kindSection: currency === 'ש"ח' ? 'ils' : 'fx',
    note: str(o.Note), noteKind: str(o.NoteKind) || 'plain',
    installment: numOrNull(o.Installment), installments: numOrNull(o.Installments),
    category, subcategory: category ? str(o.Subcategory) : '', tag: str(o.Tag),
    status, ruleId: str(o.RuleId),
    key: str(o.Key), occ,
    source: sourceOf(o.FileHash, idx, 'credit', o.SheetRow, o.Id),
  };
  return { doc, problems };
}

export function bankDoc(o, idx = []) {
  const problems = [];
  const date = toIsoDay(o.Date);
  if (!date) problems.push(`תאריך לא תקין: "${o.Date}"`);
  if (!str(o.Key)) problems.push('חסרה טביעת אצבע (Key)');
  const occ = Number(o.Occ);
  if (!(occ >= 1)) problems.push(`מופע לא תקין: "${o.Occ}"`);
  const bucket = str(o.Bucket);
  if (bucket && !['הכנסה', 'צריכה', 'העברה', 'הון'].includes(bucket)) problems.push(`דלי לא מוכר: "${bucket}"`);
  let status = str(o.Status) || 'pending';
  if (!STATUS.has(status)) problems.push(`סטטוס לא מוכר: "${status}"`);
  if (!bucket) status = 'pending';
  const doc = {
    date, valueDate: toIsoDay(o.ValueDate) || date, opCode: str(o.OpCode), ref: str(o.Ref), desc: str(o.Desc),
    amount: num(o.Amount), debit: num(o.Debit), credit: num(o.Credit),
    bucket, category: str(o.Category), subcategory: str(o.Subcategory), freq: str(o.Freq), tag: str(o.Tag),
    goalId: str(o.GoalId), settlesCard: str(o.SettlesCard), settlesMonth: str(o.SettlesMonth),
    status, ruleId: str(o.RuleId), key: str(o.Key), occ,
    source: sourceOf(o.FileHash, idx, 'bank', o.SheetRow, o.Id),
  };
  return { doc, problems };
}

/* הטאב Categories: Category · Subcategory · Active · Order · Notes */
export function categoryDocs(objects) {
  const out = [], seen = new Set();
  (objects || []).forEach(o => {
    const category = str(o.Category), subcategory = str(o.Subcategory);
    if (!category) return;
    const k = `${category}|${subcategory}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ category, subcategory, active: str(o.Active).toUpperCase() !== 'FALSE', order: Number(o.Order) || 0, notes: str(o.Notes) });
  });
  return out;
}

/* הטאב Imports → יומן הקליטות. כך העלאה חוזרת של קובץ שכבר נקלט
   ב-v3 תיענה "הקובץ כבר נקלט". */
export function importDocs(objects) {
  return (objects || []).filter(o => str(o.Hash)).map(o => ({
    id: `i-${str(o.Hash).slice(0, 20)}`,
    data: {
      fileName: str(o.FileName), hash: str(o.Hash), kind: str(o.Kind), status: str(o.Status) || 'ok',
      billingMonth: str(o.Kind) === 'credit' ? str(o.BillingMonth) : null,
      range: str(o.Kind) === 'bank' ? str(o.BillingMonth) : null,
      sections: numOrNull(o.Sections), parsed: num(o.RowsParsed), added: num(o.RowsAdded), skipped: num(o.RowsSkipped),
      warnings: str(o.Warnings) ? [str(o.Warnings)] : [], at: str(o.At), migrated: true,
    },
  }));
}

function checkSet(kind, headers, required, parsed) {
  const checks = [];
  const missing = required.filter(h => !headers.includes(h));
  checks.push({ id: `${kind}-structure`, pass: !missing.length, text: missing.length ? `חסרות עמודות: ${missing.join(', ')}` : `כל ${required.length} העמודות הנדרשות קיימות` });
  const bad = parsed.filter(p => p.problems.length);
  checks.push({ id: `${kind}-rows`, pass: !missing.length && !bad.length, text: bad.length ? `${bad.length} שורות עם בעיה — לא ייכתבו` : `כל ${parsed.length} השורות פוענחו` });
  return { checks, bad };
}

/* texts: { expenses, bank, categories?, imports? } — תוכן CSV. */
export async function analyzeSpend(texts) {
  const read = t => (t ? toObjects(parseCsv(t)) : { headers: [], objects: [] });
  const E = read(texts.expenses), B = read(texts.bank), C = read(texts.categories), I = read(texts.imports);
  const idx = importIndex(I.objects);
  const result = { checks: [], expenses: [], bank: [], categories: categoryDocs(C.objects), imports: importDocs(I.objects), bad: [] };

  const pe = E.objects.map(o => ({ src: o, ...expenseDoc(o, idx) }));
  const pb = B.objects.map(o => ({ src: o, ...bankDoc(o, idx) }));
  if (texts.expenses) {
    const c = checkSet('exp', E.headers, EXP_REQUIRED, pe);
    result.checks.push(...c.checks); result.bad.push(...c.bad.map(b => ({ tab: 'Expenses', row: b.src._row, problems: b.problems })));
  }
  if (texts.bank) {
    const c = checkSet('bank', B.headers, BANK_REQUIRED, pb);
    result.checks.push(...c.checks); result.bad.push(...c.bad.map(b => ({ tab: 'Bank', row: b.src._row, problems: b.problems })));
  }

  /* 3. ייחודיות — אותו מזהה פעמיים = שורה שתדרוס שורה אחרת בשקט */
  const withIds = async (list, prefix) => Promise.all(list.filter(p => !p.problems.length).map(async p => ({ id: await docId(prefix, p.doc.key, p.doc.occ), data: p.doc })));
  result.expenses = await withIds(pe, 'e');
  result.bank = await withIds(pb, 'b');
  const dupE = result.expenses.length - new Set(result.expenses.map(x => x.id)).size;
  const dupB = result.bank.length - new Set(result.bank.map(x => x.id)).size;
  result.checks.push({ id: 'unique', pass: !dupE && !dupB, text: dupE || dupB ? `${dupE + dupB} מזהים כפולים` : 'כל מזהה מסמך ייחודי — אותם מזהים כמו בקליטה רגילה' });

  /* 4. התאמה אשראי ↔ עו"ש */
  const rec = reconcile(result.bank.map(b => ({ id: b.id, ...b.data })), result.expenses.map(e => e.data));
  result.reconcile = rec;
  const withDetail = rec.filter(r => r.status !== 'no-detail');
  const gaps = rec.filter(r => r.status === 'gap');
  if (texts.expenses && texts.bank) {
    result.checks.push({
      id: 'reconcile', pass: !gaps.length,
      text: gaps.length ? `${gaps.length} חיובים שלא מתלכדים עם הפירוט` : `${withDetail.length} חיובי כרטיס בעו"ש = סכום הפירוט, לאגורה${rec.length > withDetail.length ? ` · ${rec.length - withDetail.length} בלי פירוט (הוצאה מרוכזת)` : ''}`,
    });
  }

  /* סיכום לתצוגה */
  const count = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  result.summary = {
    expenses: result.expenses.length, bank: result.bank.length,
    expStatus: count(result.expenses, x => x.data.status),
    bankStatus: count(result.bank, x => x.data.status),
    byBilling: Object.entries(result.expenses.reduce((m, x) => { const k = x.data.billingKey; m[k] = round2((m[k] || 0) + x.data.charge); return m; }, {})).sort(),
    categories: result.categories.length, imports: result.imports.length,
  };
  return result;
}
