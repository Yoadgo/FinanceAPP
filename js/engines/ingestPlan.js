/* ================================================================
   INGEST PLAN — "מה יקרה אם נקלוט את הקובץ הזה". פונקציה טהורה.

   מקבלת את תוכן הקובץ ואת מה שכבר במסד, ומחזירה תוכנית: אילו שורות
   ייכתבו, כמה ידולגו ולמה, ואילו אזהרות. **שום דבר לא נכתב כאן.**
   המסך מציג את התוכנית (חוק UX 5: "כל פעולת כתיבה מראה מה היא תעשה
   לפני שהיא עושה"), ורק אחרי אישור store.putMany כותב אותה.

   ארבעת הכללים שאין להפר (אפיון, "קליטת קבצים"):
   1. טביעת אצבע לכל שורה + מונה מופעים.
   2. קליטה אידמפוטנטית — אותו קובץ פעמיים = אפס שורות חדשות
      (גיבוב תוכן + מזהי מסמך דטרמיניסטיים).
   3. שורה שלא הובנה לא נזרקת ולא מנוחשת — status: 'pending'.
   4. סכום מקטע מוצהר = סכום שורותיו. מקטע אחד לא מאוזן פוסל את
      הקובץ כולו: קליטה חלקית גרועה מאי-קליטה.

   הלוגיקה הוסבה מ-ingestInbox_ (v3, apps-script/ingest.gs), שרצה
   בייצור על 574 שורות אשראי ב-5.9.2026 בהתאמה של 9/9 מול הבנק.
   ================================================================ */
import { parseCreditSheet, parseNote, withOccurrence, diffAgainstExisting } from './creditParser.js';
import { parseBankSheet, isBankSheet, withBankOccurrence } from './bankParser.js';
import { normMerchant, prepRules, applyRules } from './merchants.js';
import { suggestBankBucket, inferFreq, billingMonthKey } from './bankRules.js';
import { docId } from './hash.js';

export function detectKind(values) {
  const lim = Math.min(values.length, 60);
  for (let r = 0; r < lim; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const s = String(values[r][c] == null ? '' : values[r][c]);
      if (s.indexOf('כרטיס:') !== -1 && s.indexOf('חודש החיוב') !== -1) return 'credit';
    }
  }
  if (isBankSheet(values)) return 'bank';
  return 'unknown';
}

/* דלי של שורת אשראי נגזר מהקטגוריה — לא נשמר. כך שינוי דעה על
   קטגוריה שלמה ("העברות אינן צריכה") לא דורש לגעת בשורות. */
export const NON_CONSUME = { 'העברות': 'העברה', 'הון': 'הון' };
export const creditBucket = category => NON_CONSUME[category] || 'צריכה';

const iso = d => (d instanceof Date)
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : String(d || '');

/* ctx:
     fileName, hash           — מהקובץ
     importedHashes           — Set של גיבובים שכבר נקלטו בהצלחה
     creditCounts, bankCounts — { key: כמה מופעים כבר במסד }
     rules                    — מסמכי rules מ-Firestore               */
export async function planImport(values, ctx) {
  const kind = detectKind(values);
  const importId = `i-${ctx.hash.slice(0, 20)}`;
  const base = { kind, importId, fileName: ctx.fileName, hash: ctx.hash, warnings: [], add: [], skipped: 0, parsed: 0 };

  if (ctx.importedHashes && ctx.importedHashes.has(ctx.hash)) {
    return { ...base, status: 'duplicate-file', warnings: ['הקובץ הזה כבר נקלט (תוכן זהה, גם אם השם שונה). אין מה להוסיף.'] };
  }
  if (kind === 'credit') return planCredit(values, ctx, base);
  if (kind === 'bank') return planBank(values, ctx, base);
  return { ...base, status: 'unsupported', warnings: ['סוג הקובץ לא זוהה. נתמכים: פירוט אשראי ודוח עו"ש של הבינלאומי.'] };
}

async function planCredit(values, ctx, base) {
  const p = parseCreditSheet(values);
  const rows = withOccurrence(p.rows);
  const d = diffAgainstExisting(rows, ctx.creditCounts || {});
  const unbalanced = p.sections.filter(s => s.balanced === false);
  const out = {
    ...base, billingMonth: p.billingMonth, sections: p.sections, parsed: rows.length,
    skipped: d.skipped, warnings: p.warnings.slice(),
    cards: [...new Set(rows.map(r => r.card))],
  };
  if (!rows.length) return { ...out, status: 'rejected', warnings: [...out.warnings, 'לא נמצאו עסקאות בקובץ.'] };
  if (unbalanced.length) {
    return { ...out, status: 'rejected', add: [], warnings: [...out.warnings, `הקובץ נדחה — ${unbalanced.length} מקטעים לא מאוזנים. אף שורה לא נכתבת.`] };
  }

  const rules = prepRules(ctx.rules || []);
  out.add = await Promise.all(d.add.map(async rec => {
    const mn = normMerchant(rec.merchantRaw);
    const note = parseNote(rec.note);
    const hit = applyRules({ merchantNorm: mn, note: rec.note, card: rec.card }, rules);
    return {
      id: await docId('e', rec.key, rec.occ),
      data: {
        date: iso(rec.date), card: rec.card, issuer: rec.issuer,
        billing: rec.billing, billingKey: billingMonthKey(rec.billing),
        merchant: rec.merchantRaw, merchantNorm: mn,
        amount: rec.amount, currency: rec.origCurrency || 'ש"ח',
        charge: rec.charge, chargeCurrency: rec.chargeCurrency || 'ש"ח',
        kindSection: rec.kind,                       // ils / fx
        note: rec.note, noteKind: note.kind,
        installment: note.installment, installments: note.installments,
        category: hit ? hit.category : '', subcategory: hit ? hit.subcategory : '',
        /* auto ולא ok: כלל סיווג, אבל אדם עוד לא ראה. ההבחנה הזו היא
           ההבדל בין אוטומציה להחלטה. */
        status: hit ? 'auto' : 'pending', ruleId: hit ? hit.ruleId : '',
        key: rec.key, occ: rec.occ,
        source: { kind: 'credit', importId: base.importId, fileName: ctx.fileName, sheetRow: rec.sheetRow },
      },
    };
  }));
  out.status = 'ok';
  out.totals = {
    charge: round2(out.add.reduce((s, x) => s + x.data.charge, 0)),
    pending: out.add.filter(x => x.data.status === 'pending').length,
    auto: out.add.filter(x => x.data.status === 'auto').length,
  };
  return out;
}

/* ⚠️ נמצא 30.9.2026: מפענח העו"ש (הוסב כמו שהוא מ-v3) קורא תאריך
   ב-getUTC*, כי ב-Apps Script הגיליון החזיר Date של חצות UTC. אבל
   readFile.js מחזיר חצות **מקומית** (כך מפענח האשראי צריך). בישראל
   (UTC+3) חצות 1.6 מקומית = 31.5 21:00 UTC → כל תנועה זזה יום אחורה:
   המשכורת של 1.6 נופלת למאי, והמפתח לא תואם למה שכבר במסד (כפילויות).
   התיקון כאן, במתאם, ולא במפענח המוגן: Date מקומי → אותו יום ב-UTC. */
export function toUtcDays(values) {
  return values.map(r => (r || []).map(c => (c instanceof Date && !isNaN(c.getTime()))
    ? new Date(Date.UTC(c.getFullYear(), c.getMonth(), c.getDate())) : c));
}

async function planBank(values, ctx, base) {
  const bp = parseBankSheet(toUtcDays(values));
  const rows = withBankOccurrence(bp.rows);
  const d = diffAgainstExisting(rows, ctx.bankCounts || {});
  const out = { ...base, range: { from: bp.meta.from, to: bp.meta.to }, parsed: rows.length, skipped: d.skipped, warnings: bp.warnings.slice() };
  if (!rows.length) return { ...out, status: 'rejected', warnings: [...out.warnings, 'לא נמצאו תנועות — הקובץ נדחה.'] };

  const freqMap = inferFreq(rows);
  out.add = await Promise.all(d.add.map(async rec => {
    const sg = suggestBankBucket(rec);
    return {
      id: await docId('b', rec.key, rec.occ),
      data: {
        date: rec.date, valueDate: rec.valueDate, opCode: rec.opCode, ref: rec.ref,
        desc: rec.desc, amount: rec.amount, debit: rec.debit, credit: rec.credit,
        /* שורה שאף כלל לא זיהה נשארת pending **בלי דלי**. ניחוש שקט
           כאן הופך הלוואה לבית להוצאה. */
        bucket: sg.bucket, category: sg.category, subcategory: sg.subcategory,
        freq: sg.freq || freqMap[String(rec.desc).replace(/\d+/g, '#').trim()] || '',
        settlesCard: sg.settlesCard, settlesMonth: '',
        status: sg.hit ? 'auto' : 'pending', ruleId: sg.hit ? sg.why : '',
        key: rec.key, occ: rec.occ,
        source: { kind: 'bank', importId: base.importId, fileName: ctx.fileName, sheetRow: rec.sheetRow },
      },
    };
  }));
  out.status = 'ok';
  out.totals = {
    in: round2(out.add.filter(x => x.data.amount > 0).reduce((s, x) => s + x.data.amount, 0)),
    out: round2(out.add.filter(x => x.data.amount < 0).reduce((s, x) => s - x.data.amount, 0)),
    pending: out.add.filter(x => x.data.status === 'pending').length,
    auto: out.add.filter(x => x.data.status === 'auto').length,
  };
  return out;
}

/* מסמך יומן הקליטות. נכתב גם כשהקובץ נדחה — כדי שיהיה תיעוד לכך
   שנוסה ולמה לא נקלט. יצירה בלבד (כללי Firestore). */
export function importRecord(plan) {
  return {
    fileName: plan.fileName, hash: plan.hash, kind: plan.kind, status: plan.status,
    billingMonth: plan.billingMonth || null, range: plan.range || null,
    sections: plan.sections ? plan.sections.length : null,
    parsed: plan.parsed, added: plan.status === 'ok' ? plan.add.length : 0, skipped: plan.skipped,
    warnings: plan.warnings,
  };
}

const round2 = x => Math.round(x * 100) / 100;
