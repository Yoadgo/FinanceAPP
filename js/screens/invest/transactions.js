/* ================================================================
   TRANSACTIONS — כל תנועות ההשקעה, עם סינון לפי תיק וסוג, וחיפוש.
   כל שורה מראה את הסיווג (מה המנוע הבין) ואת המקור (שורה בגיליון
   או קובץ קליטה) — כדי שכל סכום יהיה ניתן למעקב.
   מוצגות עד 300 שורות בכל פעם; הסינון רץ על כולן.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, table, chip } from '../../ui/components.js';
import { usd, ils, qty as fq, day, dirClass } from '../../core/format.js';
import { hrefOf } from '../../core/routes.js';
import { loadInvest } from './data.js';

const MAX = 300;
const state = { portfolio: 'all', cat: 'all', q: '' };

export async function render(el, ctx) {
  mount(el, head(ctx), loading('table', 10));
  let inv;
  try { inv = await loadInvest(); } catch (e) { mount(el, head(ctx), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  if (!inv.docs.length) {
    mount(el, head(ctx), emptyState({ title: 'אין תנועות במסד', text: 'התנועות יועברו מהגיליון בשלב 2.', actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'migrate') }, 'למיגרציה')] }));
    return;
  }
  draw(el, ctx, inv);
}

function head(ctx) { return h('div', { class: 'world-head' }, h('h1', null, 'תנועות'), h('span', { class: 'question' }, 'מה נקנה, נמכר, הופקד ושולם — ומאיפה זה הגיע')); }

const CAT_LABEL = { STOCKS: 'מסחר', CASH: 'מזומן', INTEREST: 'ריבית', FEES: 'עמלות', TAXES: 'מס', UNCLASSIFIED: 'לא מסווג' };

function draw(el, ctx, inv) {
  const q = state.q.trim().toUpperCase();
  const rows = inv.rows
    .filter(r => state.portfolio === 'all' || r.Portfolio === state.portfolio)
    .filter(r => state.cat === 'all' || r.category === state.cat)
    .filter(r => !q || String(r.Symbol).toUpperCase().includes(q) || String(r.Name).toUpperCase().includes(q) || String(r.Type).includes(state.q.trim()))
    .sort((a, b) => (a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : 0));

  const sel = (id, value, options, onChange) => h('select', { id, class: 'btn sm', onchange: e => onChange(e.target.value) },
    options.map(([v, l]) => h('option', { value: v, selected: v === value ? true : null }, l)));
  const search = h('input', { id: 'tx-q', class: 'btn sm', type: 'search', placeholder: 'חיפוש: סימול, שם או סוג', value: state.q, style: { minWidth: '200px' } });
  let t = null;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = search.value; draw(el, ctx, inv); document.getElementById('tx-q')?.focus(); }, 250); });

  const unclassified = inv.rows.filter(r => r.category === 'UNCLASSIFIED').length;

  mount(el, head(ctx),
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
      sel('tx-port', state.portfolio, [['all', 'כל התיקים'], ...inv.portfolios.map(p => [p, p])], v => { state.portfolio = v; draw(el, ctx, inv); }),
      sel('tx-cat', state.cat, [['all', 'כל הסוגים'], ...Object.entries(CAT_LABEL)], v => { state.cat = v; draw(el, ctx, inv); }),
      search,
      h('span', { class: 'small muted' }, `${rows.length.toLocaleString('en-US')} מתוך ${inv.rows.length.toLocaleString('en-US')}`),
      unclassified ? chip(`${unclassified} לא מסווגות`, 'attn') : chip('הכל מסווג', 'up')),
    table({
      columns: [
        { key: 'Date', label: 'תאריך', render: r => num(day(r.Date)) },
        { key: 'Portfolio', label: 'תיק' },
        { key: 'label', label: 'סיווג', render: r => r.category === 'UNCLASSIFIED' ? chip(r.Type, 'attn') : r.label },
        { key: 'Symbol', label: 'נייר', render: r => /^[A-Z]{1,5}$/.test(String(r.Symbol)) ? h('b', null, r.Symbol) : h('span', { class: 'muted' }, r.Name) },
        { key: 'Qty', label: 'כמות', num: true, render: r => r.category === 'STOCKS' || r.subCategory === 'SPLIT' ? num(fq(Number(r.Qty))) : '' },
        { key: 'ExecutionRate', label: 'מחיר', num: true, render: r => Number(r.ExecutionRate) ? num(usd(Number(r.ExecutionRate), { digits: 2 })) : '' },
        { key: 'amt', label: 'סכום', num: true, render: r => amount(r) },
        { key: 'src', label: 'מקור', render: r => r._src && r._src.sheetRow ? h('span', { class: 'muted' }, `גיליון ${r._src.sheetRow}`) : '' },
      ],
      rows: rows.slice(0, MAX).map(r => ({ ...r, id: r._id })),
    }),
    rows.length > MAX ? h('p', { class: 'small muted' }, `מוצגות ${MAX} הראשונות. צמצם בסינון כדי לראות אחרות.`) : null);
}

function amount(r) {
  const fx = Number(r.TotalFX), il = Number(r.TotalILS);
  if (fx) return num(usd(fx, { sign: true }), dirClass(fx));
  if (il) return num(ils(il, { sign: true }), dirClass(il));
  if (['TAX_PROVISION', 'TAX_PAYMENT', 'TAX_ACCRUAL', 'TAX_ACCRUAL_REV', 'TAX_RESET'].includes(r.subCategory)) return num(ils(Number(r.Qty)), 'muted');
  return '';
}
