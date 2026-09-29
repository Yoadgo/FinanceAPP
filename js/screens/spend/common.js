/* ================================================================
   SPEND COMMON — מה שמשותף לארבעת מסכי ההוצאות: צבע לקטגוריה,
   בורר קטגוריה (עם "+ חדשה"), שם חודש, ושמירת קטגוריה חדשה.
   ================================================================ */
import { h } from '../../ui/dom.js';
import * as store from '../../core/store.js';
import { docId } from '../../engines/hash.js';
import { PENDING } from '../../engines/spend.js';

export const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export const monthName = ym => (ym && /^\d{4}-\d{2}$/.test(ym) ? `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` : ym || '—');
export const monthShort = ym => (ym && /^\d{4}-\d{2}$/.test(ym) ? `${MONTHS[Number(ym.slice(5)) - 1].slice(0, 3)}׳ ${ym.slice(2, 4)}` : ym || '—');
export const dm = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');

/* צבע יציב לקטגוריה. קטגוריה שיועד יצר מקבלת גוון נגזר מהשם — לא
   האפור של "בהמתנה" (שתי משמעויות שונות באותו צבע). */
const PAL = { 'מזון': '#db2777', 'תחבורה': '#4f46e5', 'בריאות': '#0891b2', 'מנויים': '#7c3aed', 'ביטוח': '#d97706',
  'קניות': '#dc2626', 'בית': '#059669', 'טיפוח': '#c026d3', 'נסיעות': '#0284c7', 'חו״ל': '#0284c7', 'חינוך': '#65a30d',
  'העברות': '#64748b', 'הטבות': '#ca8a04', 'דיור': '#0d9488' };
export function catColor(name) {
  if (!name || name === PENDING) return 'var(--line-strong)';
  if (PAL[name]) return PAL[name];
  let x = 0;
  for (let i = 0; i < name.length; i++) x = (x * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${x} 62% 45%)`;
}

export function head(title, question, tools) {
  return h('div', { class: 'world-head' }, h('div', { class: 'sp-titles' }, h('h1', null, title), question ? h('span', { class: 'question' }, question) : null), tools || null);
}

export function seg(options, value, onPick, label) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label || '' },
    options.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => onPick(v) }, l)));
}

/* בורר קטגוריה + תת-קטגוריה. "+ חדשה" פותח שדה טקסט במקום הבורר —
   הקטגוריה נשמרת רק כשמאשרים את השורות (לא קטגוריה ריקה ביומן). */
export function catPicker({ cats, cat = '', sub = '', compact = false, placeholder = 'קטגוריה…' }) {
  const state = { cat, sub, newCat: false, newSub: false };
  const wrap = h('span', { class: `sp-picker${compact ? ' compact' : ''}` });
  const draw = () => {
    wrap.replaceChildren();
    if (state.newCat) {
      const inp = h('input', { class: 'btn sm sp-new', placeholder: 'שם קטגוריה חדשה', value: state.cat });
      inp.addEventListener('input', () => { state.cat = inp.value.trim(); });
      wrap.append(inp, h('button', { type: 'button', class: 'btn sm ghost', title: 'ביטול', onclick: () => { state.newCat = false; state.cat = cat; draw(); } }, '✕'));
      setTimeout(() => inp.focus(), 0);
    } else {
      const c = h('select', { class: 'btn sm', 'aria-label': 'קטגוריה' },
        h('option', { value: '' }, placeholder),
        Object.keys(cats).map(k => h('option', { value: k, selected: k === state.cat ? true : null }, k)),
        h('option', { value: '__new' }, '+ קטגוריה חדשה…'));
      c.addEventListener('change', () => { if (c.value === '__new') { state.newCat = true; state.cat = ''; state.sub = ''; } else { state.cat = c.value; state.sub = ''; } draw(); });
      wrap.append(c);
    }
    if (state.newSub || (state.newCat && state.cat)) {
      const inp = h('input', { class: 'btn sm sp-new', placeholder: 'תת-קטגוריה (לא חובה)', value: state.sub });
      inp.addEventListener('input', () => { state.sub = inp.value.trim(); });
      wrap.append(inp);
    } else if (state.cat && !state.newCat) {
      const list = cats[state.cat] || [];
      const sc = h('select', { class: 'btn sm', 'aria-label': 'תת-קטגוריה' },
        h('option', { value: '' }, '—'),
        list.map(k => h('option', { value: k, selected: k === state.sub ? true : null }, k)),
        h('option', { value: '__new' }, '+ תת-קטגוריה…'));
      sc.addEventListener('change', () => { if (sc.value === '__new') { state.newSub = true; state.sub = ''; draw(); } else state.sub = sc.value; });
      wrap.append(sc);
    }
  };
  draw();
  return { el: wrap, value: () => ({ cat: state.cat.trim(), sub: (state.sub || '').trim(), isNew: state.newCat || state.newSub }) };
}

/* קטגוריה (או תת) שעוד לא ברשימה → מסמכי categories. מזהה נגזר
   מהשם, כך ששמירה כפולה כותבת על אותו מסמך. אם האוסף עוד ריק (לא
   הועבר מהגיליון) — זורעים איתה את כל מה שהמסך מציג, אחרת הרשימה
   הייתה מתכווצת לקטגוריה אחת. */
export async function ensureCategory(data, cat, sub) {
  if (!cat) return;
  data.categories = data.categories || [];
  const have = new Set(data.categories.map(c => `${c.category}|${c.subcategory || ''}`));
  const want = [];
  if (!data.categories.length) Object.entries(data.cats).forEach(([c, subs]) => { want.push([c, '']); subs.forEach(x => want.push([c, x])); });
  want.push([cat, '']);
  if (sub) want.push([cat, sub]);
  const items = [];
  for (const [c, x] of want) {
    const k = `${c}|${x}`;
    if (have.has(k)) continue;
    have.add(k);
    items.push({ id: await docId('c', k), data: { category: c, subcategory: x, active: true, order: 100, notes: '' } });
  }
  if (!items.length) return;
  await store.putMany('categories', items);
  items.forEach(it => data.categories.push({ id: it.id, ...it.data }));
  data.cats[cat] = data.cats[cat] || [];
  if (sub && !data.cats[cat].includes(sub)) data.cats[cat].push(sub);
}

/* פס אופקי יחסי (לשורות קטגוריה) */
export function bar(value, max, color) {
  const w = max > 0 ? Math.max(1.5, (Math.abs(value) / max) * 100) : 0;
  return h('span', { class: 'sp-track' }, h('i', { style: { width: `${w}%`, background: color } }));
}
