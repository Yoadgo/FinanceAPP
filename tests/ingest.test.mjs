/* קליטה: שלושת קבצי האשראי האמיתיים ודוח העו"ש (tests/private).
   המספרים כאן אינם "מה שהקוד מחזיר" — הם מה שהבנק אמר:
   574 שורות, 14 מקטעים מאוזנים, ו-9 זוגות כרטיס-חודש שתואמים לאגורה
   לחיוב בעו"ש ולקובץ "ריכוז חיובים" (אומת ב-5.9.2026). */
import { section, ok, eq, info } from './lib.mjs';
import { privateJson, revive } from './private.mjs';
import { parseCreditSheet } from '../js/engines/creditParser.js';
import { parseBankSheet } from '../js/engines/bankParser.js';
import { planImport, detectKind, creditBucket, importRecord } from '../js/engines/ingestPlan.js';
import { reconcile, suggestBankBucket } from '../js/engines/bankRules.js';
import { seedRuleDocs } from '../js/engines/merchants.js';

const credit = privateJson('fixtures.json');
const bank = privateJson('bank-fixture.json');

if (!credit) info('tests/private/fixtures.json חסר — מדלג על בדיקות הקליטה (הקובץ לא בריפו, בכוונה)');
else {
  section('אשראי — פענוח שלושת הקבצים האמיתיים');
  const files = Object.entries(credit).map(([name, grid]) => ({ name, values: revive(grid) }));
  const parsed = files.map(f => parseCreditSheet(f.values));
  eq(parsed.reduce((s, p) => s + p.rows.length, 0), 574, '574 שורות — בדיוק מה שנקלט בייצור');
  const secs = parsed.flatMap(p => p.sections);
  eq(secs.length, 14, '14 מקטעים');
  ok(secs.every(s => s.balanced === true), 'כל המקטעים מאוזנים מול הסכום המוצהר');
  files.forEach(f => eq(detectKind(f.values), 'credit', `${f.name} מזוהה כאשראי`));

  /* 9 מתוך 9 — מול מקורות שהמפענח לא קרא */
  const byCard = {};
  secs.forEach(s => { const k = `${s.billing}|${s.card}`; byCard[k] = Math.round(((byCard[k] || 0) + s.stated) * 100) / 100; });
  const BANK = {
    '02/07/2026|5519': 12185.5, '02/07/2026|5701': 5646.6, '02/07/2026|7487': 16862.31,
    '02/08/2026|5519': 17606.1, '02/08/2026|5701': 5194.11, '02/08/2026|7487': 563.38,
    '02/09/2026|5519': 11502.65, '02/09/2026|5701': 8495.42, '02/09/2026|7487': 2916.69,
  };
  Object.entries(BANK).forEach(([k, v]) => eq(byCard[k], v, `חיוב ${k} = ₪${v}`));

  section('תוכנית קליטה — ארבעת הכללים');
  const rules = seedRuleDocs();
  const counts = {};
  const imported = new Set();
  let total = 0, auto = 0, pending = 0;
  const plans = [];
  for (const f of files) {
    const plan = await planImport(f.values, { fileName: f.name, hash: 'h-' + f.name, importedHashes: imported, creditCounts: counts, rules });
    plans.push(plan);
    eq(plan.status, 'ok', `${f.name} — סטטוס ok`);
    plan.add.forEach(x => { counts[x.data.key] = (counts[x.data.key] || 0) + 1; });
    imported.add(plan.hash);
    total += plan.add.length; auto += plan.totals.auto; pending += plan.totals.pending;
  }
  eq(total, 574, 'קליטה ראשונה: 574 שורות חדשות');
  info(`סיווג אוטומטי בכללי הזרע: ${auto} · ממתינות להחלטה: ${pending}`);
  eq(auto, 202, 'מסווגות אוטומטית: 202 — בדיוק כמו בייצור ב-5.9.2026');
  eq(pending, 372, 'ממתינות להחלטה: 372 — בדיוק כמו בייצור');
  const ids = new Set(plans.flatMap(p => p.add.map(x => x.id)));
  eq(ids.size, 574, 'מזהי מסמך ייחודיים — אין שתי שורות שנכתבות לאותו מסמך');
  ok(plans.every(p => p.add.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.data.date))), 'כל תאריך נשמר כמחרוזת יום');

  // כלל 2: אותו קובץ שוב — לפי גיבוב
  const again = await planImport(files[0].values, { fileName: 'שם-אחר.xls', hash: 'h-' + files[0].name, importedHashes: imported, creditCounts: counts, rules });
  eq(again.status, 'duplicate-file', 'אותו תוכן בשם אחר → "כבר נקלט"');
  // כלל 1: אותן שורות בקובץ אחר (גיבוב שונה) — לפי טביעת אצבע
  const overlap = await planImport(files[0].values, { fileName: 'עותק.xls', hash: 'אחר', importedHashes: imported, creditCounts: counts, rules });
  eq(overlap.add.length, 0, 'אותן שורות מקובץ אחר → 0 חדשות');
  eq(overlap.skipped, plans[0].parsed, 'כולן נספרו כדילוג');
  // מזהים דטרמיניסטיים: קליטה חוזרת בלי ספירות כותבת לאותם מסמכים
  const fresh = await planImport(files[0].values, { fileName: 'x', hash: 'y', importedHashes: new Set(), creditCounts: {}, rules });
  ok(fresh.add.every((x, i) => x.id === plans[0].add[i].id), 'אותה שורה → אותו מזהה מסמך, בכל קליטה');

  // כלל 4: מקטע אחד לא מאוזן → הקובץ כולו נדחה
  const broken = files[1].values.map(r => r.slice());
  const txRow = broken.findIndex(r => r[1] instanceof Date);
  const col = broken[txRow].findIndex((c, i) => i > 2 && typeof c === 'number');
  broken[txRow][col + 1 < broken[txRow].length && typeof broken[txRow][col + 1] === 'number' ? col + 1 : col] += 10;
  const rej = await planImport(broken, { fileName: 'שבור.xls', hash: 'z', importedHashes: new Set(), creditCounts: {}, rules });
  eq(rej.status, 'rejected', 'שינוי של ₪10 בשורה אחת → הקובץ נדחה');
  eq(rej.add.length, 0, 'ואף שורה לא נכתבת');
  eq(importRecord(rej).added, 0, 'ביומן: נוספו 0');

  // דלי נגזר מקטגוריה
  eq(creditBucket('מזון'), 'צריכה', 'מזון = צריכה');
  eq(creditBucket('העברות'), 'העברה', 'העברות אינן צריכה');

  // פרטיות: אין מספר כרטיס מלא
  ok(plans.every(p => p.add.every(x => /^\d{4}$/.test(x.data.card))), 'כרטיס נשמר כ-4 ספרות בלבד');

  if (!bank) info('tests/private/bank-fixture.json חסר — מדלג על העו"ש');
  else {
    section('עו"ש — פענוח, דליים והתאמה לאשראי');
    const [bname, bgrid] = Object.entries(bank)[0];
    const bvalues = revive(bgrid);
    eq(detectKind(bvalues), 'bank', 'מזוהה כעו"ש');
    const bp = parseBankSheet(bvalues);
    info(`${bp.rows.length} תנועות, ${bp.meta.from} → ${bp.meta.to}`);
    ok(bp.rows.length > 50, 'יש תנועות');
    const bplan = await planImport(bvalues, { fileName: bname, hash: 'bank1', importedHashes: new Set(), bankCounts: {}, rules });
    eq(bplan.status, 'ok', 'תוכנית עו"ש ok');
    const settles = bplan.add.filter(x => x.data.settlesCard);
    info(`${settles.length} שורות סילוק אשראי זוהו`);
    ok(settles.every(x => x.data.bucket === 'העברה'), 'סילוק אשראי בדלי העברה — לא נספר כצריכה');
    ok(bplan.add.filter(x => x.data.status === 'pending').every(x => x.data.bucket === ''), 'שורה לא מזוהה נשארת בלי דלי');

    /* ההתאמה: כל חיוב אשראי בעו"ש בטווח הדוח מול סכום פירוט האשראי */
    const creditRows = plans.flatMap(p => p.add.map(x => x.data));
    const rec = reconcile(bplan.add.map(x => ({ id: x.id, ...x.data })), creditRows);
    const matched = rec.filter(r => r.status === 'match');
    info(rec.map(r => `${r.card} ${r.month}: ${r.status}${r.gap ? ' ' + r.gap : ''}`).join(' · '));
    eq(matched.length, 6, '6 מתוך 6 זוגות בטווח הדוח תואמים לאגורה');
    ok(rec.every(r => r.status !== 'gap'), 'אין פער באף זוג');

    // המנגנון יודע להגיד לא: שינוי אגורה אחת בפירוט → פער
    const tampered = creditRows.map((c, i) => i === 0 ? { ...c, charge: c.charge + 0.01 } : c);
    const rec2 = reconcile(bplan.add.map(x => ({ id: x.id, ...x.data })), tampered);
    eq(rec2.filter(r => r.status === 'gap').length, 1, 'אגורה אחת חסרה → זוג אחד באדום');

    // תיקונים (זיכוי) לא נחשב סילוק
    eq(suggestBankBucket({ desc: 'תיקונים ישראכרט - 5701', opCode: '' }).settlesCard, '', 'זיכוי "תיקונים" אינו סילוק');
  }
}
