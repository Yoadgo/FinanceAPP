/* ================================================================
   TOAST — אישור קצר אחרי כתיבה, עם ביטול לשמונה שניות (חוק UX 5).
   onUndo — אם ניתן. הטוסט לא מבצע את הביטול בעצמו; הוא קורא למסך
   שיודע מה לבטל.
   ================================================================ */
import { h, mount } from './dom.js';

let timer = null;

export function toast(text, { onUndo, ms = 8000 } = {}) {
  const root = document.getElementById('toast-root');
  clearTimeout(timer);
  const close = () => mount(root);
  const undoBtn = onUndo ? h('button', { onclick: async () => { close(); await onUndo(); } }, 'ביטול') : null;
  mount(root, h('div', { class: 'toast', role: 'status' }, h('span', null, text), undoBtn));
  timer = setTimeout(close, ms);
}
