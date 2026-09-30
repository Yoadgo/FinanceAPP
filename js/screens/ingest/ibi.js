/* ================================================================
   IBI — קליטת ייצוא תנועות מאיביאי, בתוך מסך "גרירה ואישור".
   (המנוע: engines/ibiImport.js. כאן רק תצוגה וכתיבה.)

   הזרימה: קובץ → בחירת תיק (עם בדיקת התאמה) → תצוגה מקדימה →
   אישור → כתיבה → אימות אחרי כתיבה.

   ארבעה דברים שהמסך מראה לפני שנכתב משהו:
   · כמה שורות חדשות, וכמה כבר קיימות וידולגו.
   · אילו שורות קיימות יתעדכנו (אומדן מס, יתרה) — לפני ואחרי.
   · שורות חדשות בתוך תקופה שכבר במסד — כל אחת צריכה אישור.
   · פערים: שורות במסד שאינן בקובץ. לא נמחקות; לכל אחת כפתור ביטול.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { table, chip, note, loading, errorState } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { ils, usd, qty as fq, day } from '../../core/format.js';
import { planIbi, ibiImportRecord } from '../../engines/ibiImport.js';
import * as store from '../../core/store.js';
import { clearInvestCache } from '../invest/data.js';
import { hrefOf } from '../../core/routes.js';

async function loadContext() {
  const [existing, imports] = await Promise.all([
    store.list('transactions', { includeVoided: true }),
    store.list('imports', { includeVoided: true }),
  ]);
  return { existing, imports };
}

export async function showIbi(status, wb, values) {
  mount(status, loading('card'));
  let data;
  try { data = await loadContext(); }
  catch (e) { mount(status, errorState({ title: 'לא ניתן לקרוא את התנועות הקיימות', error: e })); return; }
  const ctx = { fileName: wb.name, hash: wb.hash, ...data };
  const first = await planIbi(values, ctx);
  if (first.status !== 'needs-portfolio') { mount(status, card(first, [], null)); return; }

  const out = h('div');
  let seq = 0;                       // לחיצה מהירה על שני תיקים: רק התוכנית האחרונה מוצגת
  const pick = async p => {
    const my = ++seq;
    picker.querySelectorAll('button[data-p]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === p)));
    mount(out, loading('card'));
    const plan = await planIbi(values, { ...ctx, portfolio: p });
    if (my === seq) mount(out, card(plan, values, ctx));
  };
  /* תיק שעוד אין בו תנועות (חשבון חדש). בדיקת ההתאמה עדיין רצה:
     אם השורות כבר קיימות בתיק אחר — נעצר. */
  const newName = h('input', { type: 'text', placeholder: 'שם תיק חדש', 'aria-label': 'שם תיק חדש', style: { width: '160px' } });
  const newBtn = h('button', { class: 'btn ghost', onclick: () => { const v = newName.value.trim(); if (v) pick(v); } }, 'תיק חדש');
  const picker = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
    first.portfolioCheck.map(c => h('button', { class: 'btn', dataset: { p: c.portfolio }, 'aria-pressed': 'false', onclick: () => pick(c.portfolio) },
      c.portfolio, ' ', chip(c.existingInRange ? `${c.matched} מתוך ${c.existingInRange} קיימות` : 'אין נתונים בתקופה', c.portfolio === first.suggested ? 'up' : ''))),
    h('span', { style: { display: 'inline-flex', gap: '6px' } }, newName, newBtn));
  mount(status, h('div', { class: 'card', style: { display: 'grid', gap: '12px' } },
    h('div', { class: 'card-title' }, wb.name, chip('ייצוא איביאי', 'accent')),
    h('div', null, `${first.parsed} תנועות · ${day(first.range.from)} → ${day(first.range.to)}`),
    note('בקובץ אין עמודת תיק. לבחור לאיזה תיק הוא שייך. ליד כל תיק: כמה משורות הקובץ כבר נמצאות בו באותה תקופה — התיק הנכון הוא זה שהשורות שלו תואמות.', { kind: 'info' }),
    picker), out);
  /* אותו קובץ כבר נקלט בעבר → בוחרים מיד את התיק של אז, והתוכנית
     אומרת אם יש עוד משהו לעשות (בדרך כלל: "אין מה להוסיף"). */
  const prev = data.imports.find(i => i.hash === wb.hash && i.status === 'ok' && !i.voided && i.portfolio);
  if (prev) pick(prev.portfolio);
}

const total = d => (d.totalFx ? usd(d.totalFx, { digits: 2 }) : ils(d.amountIls ?? d.totalIls, { digits: 2 }));
const rowCols = [
  { key: 'date', label: 'תאריך', render: d => num(day(d.date)) },
  { key: 'type', label: 'סוג' },
  { key: 'name', label: 'נייר' },
  { key: 'qty', label: 'כמות', num: true, render: d => num(d.amountIls != null ? '' : fq(d.qty)) },
  { key: 'price', label: 'שער', num: true, render: d => num(d.amountIls != null ? '' : fq(d.price, 5)) },
  { key: 'total', label: 'סכום', num: true, render: d => num(total(d)) },
];

function card(plan, values, ctx) {
  const parts = [h('div', { class: 'card-title' }, plan.fileName, chip('ייצוא איביאי', 'accent'), plan.portfolio ? chip(plan.portfolio) : null)];
  if (plan.range) parts.push(h('div', null, `${day(plan.range.from)} → ${day(plan.range.to)}`));
  plan.warnings.forEach(w => parts.push(note(w, { kind: plan.status === 'ok' ? '' : 'bad' })));
  if (plan.problems.length) parts.push(table({ columns: [{ key: 'row', label: 'שורה', num: true }, { key: 'text', label: 'בעיה' }], rows: plan.problems.map(p => ({ ...p, id: p.row })) }));
  if (plan.status !== 'ok') return h('div', { class: 'card', style: { display: 'grid', gap: '12px' } }, parts);

  const facts = [
    chip(`${plan.parsed} שורות בקובץ`),
    chip(`${plan.add.length} חדשות`, plan.add.length ? 'accent' : ''),
    chip(`${plan.matched} כבר קיימות — ידולגו`),
    chip(`${plan.updates.length} יתעדכנו`),
  ];
  if (plan.matchedVoided) facts.push(chip(`${plan.matchedVoided} בוטלו על ידך בעבר — לא יוחזרו`, 'attn'));
  if (plan.revived) facts.push(chip(`${plan.revived} חוזרות אחרי ביטול קליטה קודמת`, 'attn'));
  if (plan.gaps.length) facts.push(chip(`${plan.gaps.length} פערים`, 'attn'));
  parts.push(h('div', { class: 'small', style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, facts));

  /* שכבה 6: אישור מפורש לכל שורה חדשה בתוך תקופה מכוסה */
  let confirm = null;
  if (plan.attention.length) {
    const why = { inside: 'חסרה במסד', near: 'דומה לשורה קיימת', unclassified: 'סוג לא מוכר' };
    const whyOf = a => a.kinds.map(k => why[k] || k).join(' · ') + (a.edge ? ' (יום שנקלט חלקית)' : '');
    parts.push(h('h3', null, `לבדוק לפני אישור (${plan.attention.length})`));
    parts.push(note('השורות האלה חדשות, אבל התאריך שלהן כבר מכוסה במסד. ייתכן שהן באמת חסרו (למשל סנכרון חלקי של הגיליון הישן) — וייתכן שזו כפילות שלא זוהתה. להשוות מול האתר של איביאי.', {}));
    parts.push(table({ columns: [...rowCols, { key: 'why', label: 'למה', render: a => chip(whyOf(a), 'attn') }].map(c => c.key === 'why' ? c : { ...c, render: a => (c.render ? c.render(a.doc) : a.doc[c.key]) }),
      rows: plan.attention.map((a, i) => ({ ...a, id: i })) }));
    confirm = h('input', { type: 'checkbox', id: 'ibi-confirm' });
    parts.push(h('label', { for: 'ibi-confirm', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, confirm, `בדקתי: ${plan.attention.length} השורות האלה אמיתיות ולא כפולות`));
  }

  if (plan.add.length) {
    parts.push(h('h3', null, `שורות חדשות (${plan.add.length})`));
    parts.push(table({ columns: rowCols, rows: plan.add.map(a => ({ ...a.data, id: a.id })) }));
  }
  if (plan.updates.length) {
    const lbl = { estimatedTax: 'אומדן מס', cashBalanceIls: 'יתרה שקלית' };
    parts.push(h('h3', null, `שורות קיימות שיתעדכנו (${plan.updates.length})`));
    parts.push(h('p', { class: 'small muted' }, 'שדות שהברוקר משנה בדיעבד. השורה עצמה לא משתכפלת — רק הערך מתעדכן.'));
    parts.push(table({ columns: [
      { key: 'date', label: 'תאריך', render: u => num(day(u.doc.date)) },
      { key: 'name', label: 'נייר', render: u => u.doc.name },
      { key: 'f', label: 'שדה', render: u => Object.keys(u.fields).map(k => lbl[k] || k).join(' · ') },
      { key: 'b', label: 'היה', num: true, render: u => num(Object.keys(u.fields).map(k => ils(u.before[k], { digits: 2 })).join(' · ')) },
      { key: 'a', label: 'יהיה', num: true, render: u => num(Object.keys(u.fields).map(k => ils(u.fields[k], { digits: 2 })).join(' · ')) },
    ], rows: plan.updates }));
  }
  if (plan.staleUpdates.length) parts.push(note(`${plan.staleUpdates.length} ערכים (אומדן מס/יתרה) שונים בקובץ הישן הזה — לא נכתבים, כי כבר נקלט קובץ חדש יותר.`, { kind: 'info' }));
  if (plan.differs.length) parts.push(note(`${plan.differs.length} שדות (עמלה/מטבע) שונים בין הקובץ למסד. לא משתנים אוטומטית — כדאי לבדוק.`, {}));
  if (plan.gaps.length) parts.push(gapsBlock(plan));
  if (plan.edgeGaps.length) parts.push(note(`${plan.edgeGaps.length} שורות במסד ביום הראשון/האחרון של הקובץ לא נמצאו בו. כנראה שהייצוא לא כולל את כל היום הזה — הן נשארות כמו שהן.`, { kind: 'info' }));

  const work = plan.add.length + plan.updates.length;
  const btn = h('button', { class: 'btn primary', disabled: true },
    work ? `אישור — ${plan.add.length} חדשות${plan.updates.length ? ` · ${plan.updates.length} עדכונים` : ''}` : 'אין מה לכתוב — המסד כבר תואם לקובץ');
  const sync = () => { btn.disabled = !work || (confirm && !confirm.checked); };
  if (confirm) confirm.addEventListener('change', sync);
  sync();
  const progress = h('span', { class: 'small muted' });
  const result = h('div');
  btn.addEventListener('click', () => commit(plan, values, ctx, btn, progress, result));
  parts.push(h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, btn, progress), result);
  return h('div', { class: 'card', style: { display: 'grid', gap: '12px' } }, parts);
}

/* פערים: במסד ולא בקובץ. ביטול בשתי לחיצות, שורה-שורה. */
function gapsBlock(plan) {
  const voidBtn = d => {
    const b = h('button', { class: 'btn sm ghost' }, 'לבטל');
    let armed = false;
    b.addEventListener('click', async () => {
      if (!armed) { armed = true; b.textContent = 'בטוח? ללחוץ שוב'; setTimeout(() => { if (armed) { armed = false; b.textContent = 'לבטל'; } }, 5000); return; }
      armed = false; b.disabled = true; b.textContent = 'מבטל…';
      try { await store.voidDoc('transactions', d.id); clearInvestCache(); b.replaceWith(chip('בוטלה', 'down')); }
      catch (e) { b.disabled = false; b.textContent = 'לבטל'; toast(`הביטול נכשל: ${e.message || e}`); }
    });
    return b;
  };
  return h('div', { style: { display: 'grid', gap: '8px' } },
    h('h3', null, `פערים: במסד אבל לא בקובץ של הברוקר (${plan.gaps.length})`),
    h('p', { class: 'small muted' }, 'לא נמחק כלום אוטומטית. שורה שהיא כפילות מהגיליון הישן — לבטל. שורה אמיתית שחסרה בקובץ — להשאיר ולבדוק מול הברוקר.'),
    table({ columns: [...rowCols, { key: 'act', label: '', render: voidBtn }], rows: plan.gaps }));
}

async function commit(plan, values, ctx, btn, progress, result) {
  btn.disabled = true;
  try {
    if (plan.add.length) await store.putMany('transactions', plan.add, { onProgress: (d, t) => { progress.textContent = `חדשות ${d} / ${t}`; } });
    if (plan.updates.length) await store.patchMany('transactions', plan.updates.map(u => ({ id: u.id, fields: u.fields })), { onProgress: (d, t) => { progress.textContent = `עדכונים ${d} / ${t}`; } });
    await store.put('imports', plan.importId, ibiImportRecord(plan));
    clearInvestCache();
    progress.textContent = 'מאמת…';
  } catch (e) {
    btn.disabled = false; progress.textContent = '';
    toast(`הכתיבה נעצרה: ${e.message || e}. קליטה חוזרת של אותו קובץ תשלים בלי כפילויות.`, { ms: 15000 });
    return;
  }
  /* אימות אחרי כתיבה: אותו קובץ, מול המסד המעודכן, צריך לתת אפס. */
  let verdict;
  try {
    const fresh = await loadContext();
    const re = await planIbi(values, { ...ctx, existing: fresh.existing, imports: fresh.imports, importedHashes: new Set(), portfolio: plan.portfolio });
    verdict = re.status === 'ok' && re.add.length === 0 && re.updates.length === 0
      ? note(`נקלטו ${plan.add.length} שורות ועודכנו ${plan.updates.length}. אימות: קליטה חוזרת של הקובץ מוסיפה 0 שורות ✓`, { kind: 'good', action: h('a', { class: 'btn sm', href: hrefOf('invest', 'holdings') }, 'לאחזקות') })
      : note(`נכתב, אבל האימות לא נקי: קליטה חוזרת הייתה מוסיפה ${re.add.length} ומעדכנת ${re.updates.length}. לא לקלוט שוב — לבדוק.`, { kind: 'bad' });
  } catch (e) { verdict = note(`נכתב, אבל האימות נכשל בקריאה: ${e.message || e}`, { kind: 'bad' }); }
  progress.textContent = '';
  mount(result, verdict);
  toast(`נקלטו ${plan.add.length} שורות`);
}
