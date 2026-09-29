/* ================================================================
   COMPOSITION — מגירת "ממה מורכב המספר". עיקרון 1 של האפליקציה.

   כל מספר שמוצג ניתן לפירוק לשלושה דברים:
     formula — הנוסחה במילים ("שווי = כמות × מחיר סגירה אחרון")
     parts   — השורות שמרכיבות אותו, כל אחת עם המקור שלה
               (קובץ, תאריך קליטה, מספר שורה)
     total   — הסכום, כדי לראות שהחלקים מתלכדים אליו

   אם sum(parts) ≠ total — המגירה אומרת את זה באדום. מספר שהחלקים
   שלו לא מתלכדים הוא באג, לא עיגול.
   ================================================================ */
import { h, num, mount } from './dom.js';

let lastFocus = null;

export function openComposition({ title, total, totalText, formula, parts = [], partsSum, note }) {
  const root = document.getElementById('drawer-root');
  lastFocus = document.activeElement;

  const close = () => {
    mount(root);
    document.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  let mismatch = null;
  if (typeof total === 'number' && typeof partsSum === 'number' && Math.abs(total - partsSum) > 0.01) {
    mismatch = h('div', { class: 'note bad' }, `החלקים מסתכמים ל-${partsSum.toFixed(2)} ולא ל-${total.toFixed(2)}. זה באג — לא עיגול.`);
  }

  const closeBtn = h('button', { class: 'btn sm', onclick: close, 'aria-label': 'סגירה' }, 'סגירה');
  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', null, h('h2', null, title), closeBtn),
    h('div', { class: 'body' },
      h('div', null, h('div', { class: 'eyebrow' }, 'הסכום'), h('div', { class: 'total' }, num(totalText || String(total ?? '—')))),
      formula ? h('div', null, h('div', { class: 'eyebrow' }, 'הנוסחה במילים'), h('div', { class: 'formula' }, formula)) : null,
      mismatch,
      parts.length ? h('div', null,
        h('div', { class: 'eyebrow' }, `ממה זה מורכב · ${parts.length} שורות`),
        h('div', { class: 'parts' }, parts.map(p => h('div', { class: 'part' },
          h('div', null, h('div', null, p.label), p.src ? h('div', { class: 'src' }, p.src) : null),
          num(p.valueText, p.cls || ''))))) : null,
      note ? h('p', { class: 'small muted' }, note) : null));

  mount(root, h('div', { class: 'drawer-backdrop', onclick: close }), drawer);
  closeBtn.focus();
}
