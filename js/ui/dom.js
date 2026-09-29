/* ================================================================
   DOM — עוזר יחיד לבניית אלמנטים. מונע הזרקת HTML: טקסט נכנס
   תמיד כ-textContent. שמות סוחרים ושדה "פירוט" מגיעים מקבצי בנק —
   הם לעולם לא נכנסים כ-innerHTML.
   ================================================================ */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(target, ...nodes) {
  target.replaceChildren();
  append(target, nodes);
  return target;
}

/* מספר מוצג: מונו, LTR מבודד, צבע כיוון אופציונלי. */
export function num(text, cls = '') {
  return h('span', { class: `num ${cls}`.trim(), dir: 'ltr' }, text);
}
