/* ================================================================
   FUNDS — הקופות: פנסיה, קרן השתלמות, חיסכון לבית, חירום, וכל מה
   שחוסך לאורך זמן. כל קופה היא "נקודת מצב" — יתרה + התאריך שלה — ועוד
   הפקדה חודשית, דמי ניהול ותשואה צפויה לשלושה תרחישים.

   הנתונים מוזנים ידנית (את הפנסיה אפשר להעתיק מאתר הראל). קליטה
   אוטומטית של דוחות — מועמדת לשלב ה-AI.
   שמירה: pots/{id}. מחיקה = voided (כמו בכל האפליקציה).
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, table, chip, asOfLine } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { ils, pct, day, todayIso, ageDays } from '../../core/format.js';
import { DEFAULT_RETURNS, KIND_LABEL } from '../../engines/forecast.js';
import * as store from '../../core/store.js';
import { hrefOf } from '../../core/routes.js';

export async function render(el, ctx) {
  mount(el, head(), loading('table'));
  let pots;
  try { pots = await store.list('pots'); } catch (e) { mount(el, head(), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  draw(el, ctx, pots);
}

function head(tools) {
  return h('div', { class: 'world-head' }, h('h1', null, 'קופות'), tools || h('span', { class: 'question' }, 'כמה יש בכל קופה, ממתי, וכמה נכנס כל חודש'));
}

function draw(el, ctx, pots) {
  const formBox = h('div');
  const addBtn = h('button', { class: 'btn primary sm', type: 'button', onclick: () => mount(formBox, form(null, () => render(el, ctx))) }, '+ קופה');
  const total = pots.reduce((s, p) => s + (Number(p.balance) || 0), 0);
  const monthly = pots.reduce((s, p) => s + (Number(p.monthly) || 0), 0);

  if (!pots.length) {
    mount(el, head(addBtn), formBox, emptyState({
      title: 'עוד אין קופות',
      text: 'להוסיף כל קופה עם היתרה האחרונה והתאריך שלה, וההפקדה החודשית. פנסיה וקרן השתלמות — מהדוח או מאתר הראל. חיסכון לבית — היתרה בחשבון או בקופה.',
      actions: [addBtn.cloneNode(true)],
    }));
    el.querySelector('.state .btn').addEventListener('click', () => mount(formBox, form(null, () => render(el, ctx))));
    return;
  }

  mount(el,
    head(h('div', { style: { display: 'flex', gap: '8px' } }, h('a', { class: 'btn sm', href: hrefOf('save', 'forecast') }, 'לתחזית'), addBtn)),
    h('div', { class: 'strip' },
      h('div', { class: 'kpi' }, h('div', { class: 'label' }, 'צבירה כוללת'), h('div', { class: 'value' }, num(ils(total, { digits: 0 })))),
      h('div', { class: 'kpi' }, h('div', { class: 'label' }, 'הפקדה חודשית'), h('div', { class: 'value sm' }, num(ils(monthly, { digits: 0 })))),
      h('div', { class: 'kpi' }, h('div', { class: 'label' }, 'קופות'), h('div', { class: 'value sm' }, num(String(pots.length))))),
    formBox,
    h('section', { class: 'panel' },
      h('div', { class: 'panel-h' }, h('h2', null, 'הקופות'), h('span', { class: 'chart-note' }, 'לחיצה על שורה = עריכה')),
      h('div', { class: 'panel-b flush' }, table({
        columns: [
          { key: 'name', label: 'קופה', render: p => h('b', null, p.name) },
          { key: 'kind', label: 'סוג', render: p => chip(KIND_LABEL[p.kind] || p.kind) },
          { key: 'owner', label: 'בעלים', render: p => p.owner || '—' },
          { key: 'balance', label: 'יתרה', num: true, render: p => num(ils(Number(p.balance), { digits: 0 })) },
          { key: 'asOf', label: 'נכון ל-', render: p => { const a = ageDays(p.asOf); return h('span', { class: `num ${a > 120 ? '' : 'muted'}`, style: a > 120 ? { color: 'var(--attn)' } : null }, day(p.asOf) + (a > 120 ? ' · ישן' : '')); } },
          { key: 'monthly', label: 'הפקדה', num: true, render: p => num(ils(Number(p.monthly) || 0, { digits: 0 })) },
          { key: 'fees', label: 'דמי ניהול', num: true, render: p => num(`${Number(p.feeBalancePct) || 0}% · ${Number(p.feeDepositPct) || 0}%`, 'muted') },
          { key: 'ret', label: 'תשואה (ז/ב/א)', num: true, render: p => num((p.returns || DEFAULT_RETURNS[p.kind] || DEFAULT_RETURNS.other).join(' / ') + '%', 'muted') },
          { key: 'target', label: 'יעד', num: true, render: p => num(p.target ? ils(Number(p.target), { digits: 0 }) : '—') },
        ],
        rows: pots,
        onRow: p => { mount(formBox, form(p, () => render(el, ctx))); formBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      }))),
    h('p', { class: 'small muted' }, 'יתרה בת יותר מארבעה חודשים מסומנת בצהוב — הגיע זמן לעדכן מהדוח.'));
}

function form(pot, onSaved) {
  const p = pot || { kind: 'study', asOf: todayIso(), returns: DEFAULT_RETURNS.study };
  const f = (id, label, input) => h('label', { style: { display: 'grid', gap: '3px', fontSize: '12px', color: 'var(--muted)' } }, label, input);
  const inp = (id, value, attrs = {}) => h('input', { id, class: 'btn sm', value: value ?? '', style: { textAlign: 'start', width: '100%' }, ...attrs });
  const kind = h('select', { id: 'pot-kind', class: 'btn sm' }, Object.entries(KIND_LABEL).map(([k, l]) => h('option', { value: k, selected: k === p.kind ? true : null }, l)));
  const I = {
    name: inp('pot-name', p.name, { placeholder: 'למשל: קרן השתלמות — הראל' }),
    owner: inp('pot-owner', p.owner, { placeholder: 'יועד / דרי / משותף' }),
    balance: inp('pot-balance', p.balance, { type: 'number', step: '100' }),
    asOf: inp('pot-asof', p.asOf, { type: 'date' }),
    monthly: inp('pot-monthly', p.monthly, { type: 'number', step: '50' }),
    feeB: inp('pot-feeb', p.feeBalancePct, { type: 'number', step: '0.01', placeholder: '0.22' }),
    feeD: inp('pot-feed', p.feeDepositPct, { type: 'number', step: '0.1', placeholder: '1.5' }),
    r0: inp('pot-r0', (p.returns || [])[0], { type: 'number', step: '0.5' }),
    r1: inp('pot-r1', (p.returns || [])[1], { type: 'number', step: '0.5' }),
    r2: inp('pot-r2', (p.returns || [])[2], { type: 'number', step: '0.5' }),
    target: inp('pot-target', p.target, { type: 'number', step: '1000', placeholder: 'רשות' }),
    end: inp('pot-end', p.endDate, { type: 'month', placeholder: 'רשות — למשל גיל פרישה' }),
  };
  kind.addEventListener('change', () => { const d = DEFAULT_RETURNS[kind.value] || DEFAULT_RETURNS.other; [I.r0, I.r1, I.r2].forEach((x, i) => { if (!pot) x.value = d[i]; }); });

  const save = h('button', { class: 'btn primary sm', type: 'button' }, pot ? 'שמירה' : 'הוספה');
  const del = pot ? h('button', { class: 'btn sm ghost', type: 'button' }, 'הסרת הקופה') : null;
  save.addEventListener('click', async () => {
    const n = v => (v === '' || v === null ? null : Number(v));
    const data = {
      name: I.name.value.trim(), kind: kind.value, owner: I.owner.value.trim(),
      balance: n(I.balance.value) || 0, asOf: I.asOf.value || todayIso(), monthly: n(I.monthly.value) || 0,
      feeBalancePct: n(I.feeB.value) || 0, feeDepositPct: n(I.feeD.value) || 0,
      returns: [n(I.r0.value), n(I.r1.value), n(I.r2.value)].map((x, i) => (x === null ? (DEFAULT_RETURNS[kind.value] || DEFAULT_RETURNS.other)[i] : x)),
      target: n(I.target.value), endDate: I.end.value || null,
    };
    if (!data.name) { toast('חסר שם לקופה'); return; }
    save.disabled = true;
    const id = pot ? pot.id : `pot-${Date.now().toString(36)}`;
    try { await store.put('pots', id, data, { isNew: !pot }); toast(pot ? 'הקופה עודכנה' : 'הקופה נוספה'); onSaved(); }
    catch (e) { save.disabled = false; toast(`השמירה נכשלה: ${e.message || e}`); }
  });
  if (del) {
    let armed = false;
    del.addEventListener('click', async () => {
      if (!armed) { armed = true; del.textContent = 'בטוח? לחיצה נוספת מסירה'; setTimeout(() => { armed = false; del.textContent = 'הסרת הקופה'; }, 4000); return; }
      try { await store.voidDoc('pots', pot.id); toast('הקופה הוסרה'); onSaved(); } catch (e) { toast(`ההסרה נכשלה: ${e.message || e}`); }
    });
  }

  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, pot ? `עריכה · ${pot.name}` : 'קופה חדשה'), h('div', { class: 'tools' }, del, save)),
    h('div', { class: 'panel-b' },
      h('div', { class: 'grid cols-4' },
        f('pot-name', 'שם', I.name), f('pot-kind', 'סוג', kind), f('pot-owner', 'בעלים', I.owner), f('pot-target', 'יעד (₪)', I.target),
        f('pot-balance', 'יתרה (₪)', I.balance), f('pot-asof', 'נכון לתאריך', I.asOf), f('pot-monthly', 'הפקדה חודשית (₪)', I.monthly), f('pot-end', 'עד חודש', I.end),
        f('pot-feeb', 'דמי ניהול מצבירה (%)', I.feeB), f('pot-feed', 'דמי ניהול מהפקדה (%)', I.feeD),
        f('pot-r', 'תשואה ריאלית שנתית: זהיר / בסיס / אופטימי (%)', h('div', { style: { display: 'flex', gap: '6px' } }, I.r0, I.r1, I.r2))),
      h('p', { class: 'small muted' }, 'תשואה ריאלית = אחרי אינפלציה. כך כל התחזית בשקלים של היום.')));
}
