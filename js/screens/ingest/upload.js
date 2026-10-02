/* ================================================================
   UPLOAD — גרירה → זיהוי → תצוגה מקדימה → אישור → כתיבה.
   (אפיון, "קליטת קבצים". שלב 4.)

   הקובץ נקרא בדפדפן בלבד. לפני שמשהו נכתב, המסך מראה בדיוק מה
   ייכתב: כמה שורות, אילו כרטיסים, אילו מקטעים ואם הם מאוזנים, כמה
   כפולות ידולגו, כמה יסווגו אוטומטית וכמה ימתינו. רק אז "אישור".
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { errorState, table, chip, note, loading } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { ils, day } from '../../core/format.js';
import { readWorkbookFile } from '../../ingest/readFile.js';
import { planImport, importRecord } from '../../engines/ingestPlan.js';
import * as store from '../../core/store.js';
import { clearSpendCache } from '../spend/data.js';
import { hrefOf } from '../../core/routes.js';
import { isIbiSheet } from '../../engines/ibiImport.js';
import { isHarelSheet } from '../../engines/harel.js';

export async function render(el, ctx) {
  const status = h('div');
  const input = h('input', { id: 'up-file', type: 'file', accept: '.xls,.xlsx' });
  const zone = h('label', { class: 'dropzone', for: 'up-file' },
    h('b', null, 'לגרור לכאן קובץ, או ללחוץ לבחירה'),
    h('span', { class: 'small muted' }, 'פירוט אשראי של הבינלאומי (xls), דוח תנועות עו"ש (xlsx), ייצוא תנועות מאיביאי (data N.xlsx), או אקסל הפקדות מהראל (השתלמות / פנסיה). הקובץ נקרא בדפדפן בלבד.'),
    input);
  /* איפוס הבחירה: אותו קובץ פעמיים ברצף (קליטה חוזרת לבדיקה) עדיין מפעיל change. */
  const go = f => { if (f) handle(f, status); input.value = ''; };
  input.addEventListener('change', () => go(input.files[0]));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); go(e.dataTransfer.files[0]); });

  mount(el,
    h('div', { class: 'world-head' }, h('h1', null, 'קליטת קובץ'), h('span', { class: 'question' }, ctx.world.question)),
    h('div', { class: 'steps-inline' }, h('span', { 'aria-current': 'step' }, 'גרירה'), '←', h('span', null, 'זיהוי'), '←', h('span', null, 'תצוגה מקדימה'), '←', h('span', null, 'אישור'), '←', h('span', null, 'כתיבה')),
    zone, status);
}

async function handle(file, status) {
  mount(status, loading('card'));
  let wb, ctxData;
  try { wb = await readWorkbookFile(file); }
  catch (e) { mount(status, errorState({ title: 'הקובץ לא נקרא', error: e })); return; }

  /* ייצוא איביאי — זרימה נפרדת (בחירת תיק, השוואה לתנועות הקיימות). */
  const ibi = wb.sheets.find(sh => isIbiSheet(sh.values));
  if (ibi) { const { showIbi } = await import('./ibi.js'); await showIbi(status, wb, ibi.values); return; }

  /* אקסל הפקדות מהראל (השתלמות או פנסיה) — זרימה נפרדת: בחירת קופה. */
  const harel = wb.sheets.find(sh => isHarelSheet(sh.values));
  if (harel) { const { showHarel } = await import('./harel.js'); await showHarel(status, wb, harel.values); return; }

  try { ctxData = await loadContext(); }
  catch (e) { mount(status, errorState({ title: 'הנתונים הקיימים לא נקראו', error: e })); return; }

  /* הגיליון הראשון שמזוהה. בקבצי הבינלאומי יש גיליון אחד. */
  let plan = null;
  for (const sh of wb.sheets) {
    const p = await planImport(sh.values, { fileName: wb.name, hash: wb.hash, ...ctxData });
    if (p.kind !== 'unknown' || !plan) plan = p;
    if (p.kind !== 'unknown') break;
  }
  mount(status, preview(plan, status));
}

async function loadContext() {
  const [imports, expenses, bank, rules] = await Promise.all([
    store.list('imports', { includeVoided: true }), store.list('expenses'), store.list('bank'), store.list('rules'),
  ]);
  const countKeys = rows => rows.reduce((m, r) => { if (r.key) m[r.key] = (m[r.key] || 0) + 1; return m; }, {});
  return {
    importedHashes: new Set(imports.filter(i => i.status === 'ok' && !i.voided).map(i => i.hash)),
    creditCounts: countKeys(expenses), bankCounts: countKeys(bank), rules,
  };
}

function preview(plan, status) {
  const kindLabel = { credit: 'פירוט אשראי', bank: 'דוח עו"ש', unknown: 'לא מזוהה' }[plan.kind];
  const good = plan.status === 'ok' && plan.add.length > 0;
  const parts = [
    h('div', { class: 'card-title' }, plan.fileName, chip(kindLabel, plan.kind === 'unknown' ? 'down' : 'accent')),
  ];
  if (plan.kind === 'credit' && plan.billingMonth) parts.push(h('div', null, `חודש חיוב ${plan.billingMonth} · כרטיסים ${(plan.cards || []).join(', ')}`));
  if (plan.kind === 'bank' && plan.range) parts.push(h('div', null, `טווח ${day(plan.range.from)} → ${day(plan.range.to)}`));

  if (plan.sections && plan.sections.length) parts.push(table({
    columns: [
      { key: 'card', label: 'כרטיס' }, { key: 'kind', label: 'מקטע', render: s => s.kind === 'fx' ? 'מט"ח' : 'שקלים' },
      { key: 'n', label: 'שורות', num: true, render: s => num(String(s.n)) },
      { key: 'computed', label: 'סכום השורות', num: true, render: s => num(ils(s.computed, { digits: 2 })) },
      { key: 'stated', label: 'מוצהר בקובץ', num: true, render: s => num(ils(s.stated, { digits: 2 })) },
      { key: 'balanced', label: 'מאוזן', render: s => chip(s.balanced === false ? 'לא' : 'כן', s.balanced === false ? 'down' : 'up') },
    ],
    rows: plan.sections.map((s, i) => ({ ...s, id: i })),
  }));

  const facts = [`${plan.parsed} שורות בקובץ`, `${plan.add.length} חדשות`, `${plan.skipped} כבר קיימות וידולגו`];
  if (plan.totals) {
    facts.push(`${plan.totals.auto} יסווגו לפי כלל`, `${plan.totals.pending} ימתינו להחלטה`);
    if (plan.totals.charge !== undefined) facts.push(`סך חיוב ${ils(plan.totals.charge, { digits: 2 })}`);
    if (plan.totals.in !== undefined) facts.push(`נכנס ${ils(plan.totals.in)} · יצא ${ils(plan.totals.out)}`);
  }
  parts.push(h('div', { class: 'small', style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, facts.map(f => chip(f))));
  plan.warnings.forEach(w => parts.push(note(w, { kind: plan.status === 'ok' ? '' : 'bad' })));

  const btn = h('button', { class: 'btn primary', disabled: good ? null : true }, good ? `אישור — לכתוב ${plan.add.length} שורות` : 'אין מה לכתוב');
  const progress = h('span', { class: 'small muted' });
  btn.addEventListener('click', () => commit(plan, btn, progress, status));
  parts.push(h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, btn, progress));
  return h('div', { class: 'card', style: { display: 'grid', gap: '12px' } }, parts);
}

async function commit(plan, btn, progress, status) {
  btn.disabled = true;
  const coll = plan.kind === 'credit' ? 'expenses' : 'bank';
  try {
    await store.putMany(coll, plan.add, { onProgress: (d, t) => { progress.textContent = `${d} / ${t}`; } });
    clearSpendCache();
    await store.put('imports', plan.importId, importRecord(plan));
    progress.textContent = '';
    mount(status, note(`נקלטו ${plan.add.length} שורות מ-${plan.fileName}.`, { kind: 'good', action: h('a', { class: 'btn sm', href: hrefOf('ingest', 'log') }, 'ליומן הקליטות') }));
    toast(`נקלטו ${plan.add.length} שורות`, { onUndo: async () => {
      const { voidImport } = await import('./log.js');
      await voidImport(plan.importId);
      toast('הקליטה בוטלה — השורות סומנו כמבוטלות.');
    } });
  } catch (e) {
    btn.disabled = false; progress.textContent = '';
    toast(`הכתיבה נעצרה: ${e.message || e}. קליטה חוזרת של אותו קובץ תשלים בלי כפילויות.`, { ms: 15000 });
  }
}
