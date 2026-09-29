/* ================================================================
   COMPONENTS — הרכיבים המשותפים (ר' css/components.css).

   חוק UX 1: לכל רכיב שלושה מצבים — ריק, טוען, נכשל. הפונקציות
   emptyState / loading / errorState הן הדרך היחידה לצייר אותם, כדי
   שכל מסך ייראה ויתנהג אותו דבר כשאין נתונים.
   ================================================================ */
import { h, num } from './dom.js';
import { day, ageDays } from '../core/format.js';
import { openComposition } from './composition.js';

/* ריק: מה אין, ולמה, ומה עושים כדי שיהיה. */
export function emptyState({ title, text, actions = [] }) {
  return h('div', { class: 'state', role: 'status' },
    h('h3', null, title),
    text ? h('p', null, text) : null,
    actions.length ? h('div', { class: 'actions' }, actions) : null);
}

/* טוען: שלד בצורת התוכן, לא ספינר. kind: 'kpis' | 'table' | 'card' */
export function loading(kind = 'card', rows = 6) {
  if (kind === 'table') return h('div', { class: 'skel', 'aria-busy': 'true' }, Array.from({ length: rows }, () => h('i', { class: 'row' })));
  if (kind === 'kpis') return h('div', { class: 'strip', 'aria-busy': 'true' }, Array.from({ length: 4 }, () => h('div', { class: 'skel' }, h('i'), h('i', { class: 'lg' }))));
  return h('div', { class: 'card' }, h('div', { class: 'skel', 'aria-busy': 'true' }, h('i', { class: 'lg' }), h('i'), h('i')));
}

/* נכשל: מה נכשל, בשפה פשוטה, וכפתור נסה שוב. לעולם לא נתון ישן
   שמוצג כאילו הוא עדכני. */
export function errorState({ title = 'הטעינה נכשלה', error, onRetry }) {
  const msg = error ? friendlyError(error) : '';
  return h('div', { class: 'state error', role: 'alert' },
    h('h3', null, title),
    msg ? h('p', null, msg) : null,
    onRetry ? h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: onRetry }, 'נסה שוב')) : null);
}

export function friendlyError(e) {
  const code = e && e.code;
  if (code === 'permission-denied') return 'אין הרשאה לקרוא את הנתונים. ייתכן שהחשבון לא רשום כחבר במשק הבית.';
  if (code === 'unavailable') return 'אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.';
  if (code === 'resource-exhausted') return 'עברנו את מכסת הקריאות היומית של Firebase. המכסה מתאפסת בחצות שעון החוף המערבי (10:00 בבוקר בישראל).';
  return (e && e.message) ? e.message : String(e);
}

/* מדד. value הוא טקסט מפורמט. trace — אם קיים, המספר ניתן ללחיצה
   ופותח "ממה מורכב המספר" (חוק UX 2). asOf — תאריך הנתון (חוק UX 3). */
export function kpi({ label, value, cls = '', ctx, asOf, trace, size }) {
  const v = num(value, cls);
  const valueEl = h('div', { class: `value ${size === 'sm' ? 'sm' : ''}`.trim() }, v);
  if (trace) makeTraceable(valueEl, trace);
  return h('div', { class: 'kpi' },
    h('div', { class: 'label' }, label),
    valueEl,
    ctx ? h('div', { class: 'ctx' }, ctx) : null,
    asOf ? asOfLine(asOf) : null);
}

/* "ממתי הנתון". מעל 30 יום — צהוב (חוק UX 3). */
export function asOfLine(iso, prefix = 'נכון ל-') {
  const age = ageDays(iso);
  const stale = age !== null && age > 30;
  return h('div', { class: `asof ${stale ? 'stale' : ''}`.trim() }, `${prefix}${day(iso)}${stale ? ' · ישן' : ''}`);
}

export function makeTraceable(el, trace) {
  el.classList.add('traceable');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `ממה מורכב המספר: ${trace.title || ''}`);
  const open = () => openComposition(typeof trace === 'function' ? trace() : trace);
  el.addEventListener('click', open);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return el;
}

export function chip(text, kind = '') {
  return h('span', { class: `chip ${kind}`.trim() }, text);
}

export function note(text, { kind = '', action } = {}) {
  return h('div', { class: `note ${kind}`.trim() }, h('span', null, text), action || null);
}

/* טבלה צפופה. columns: [{ key, label, num?, render?(row) }]
   onRow(row, tr) — לחיצה על שורה (למשל פתיחת פאנל פרוסות FIFO). */
export function table({ columns, rows, onRow, rowKey = r => r.id }) {
  const thead = h('thead', null, h('tr', null, columns.map(c => h('th', { class: c.num ? 'num' : '', scope: 'col' }, c.label))));
  const tbody = h('tbody');
  rows.forEach(r => {
    const tr = h('tr', { class: onRow ? 'clickable' : '', dataset: { key: rowKey(r) } },
      columns.map(c => {
        const content = c.render ? c.render(r) : r[c.key];
        return h('td', { class: c.num ? 'num' : '' }, content);
      }));
    if (onRow) tr.addEventListener('click', () => onRow(r, tr));
    tbody.append(tr);
  });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'dense' }, thead, tbody));
}
