/* ================================================================
   COMPARE PICKER — "+ השוואה": בחירת עד 3 טיקרים להתיך על גרף.
   (יועד, 2.10.2026.) רכיב אחד לכל הגרפים — כל מסך מחליט מה לצייר.

   · רשימה נפתחת רגילה (select) — במובייל נפתח הבורר של המערכת, ובמחשב
     אפשר להקליד אותיות כדי לקפוץ לנייר.
   · כל נייר נבחר הוא שבב בצבע הקו שלו, עם × להסרה.
   · הבחירה נזכרת במכשיר הזה לכל גרף בנפרד (localStorage) — נוחות בלבד,
     לא נתון. אם האחסון חסום — מתחילים ריק, בלי שגיאה.
   · הצבע צמוד לנייר כל עוד הוא נבחר: הסרת נייר אחד לא צובעת מחדש את האחרים.
   ================================================================ */
import { h } from './dom.js';
import { MAX_COMPARE } from '../engines/compare.js';

const COLORS = ['--cmp-1', '--cmp-2', '--cmp-3'];
const load = key => { try { return JSON.parse(localStorage.getItem(`cmp:${key}`) || '[]'); } catch (e) { return []; } };
const save = (key, v) => { try { localStorage.setItem(`cmp:${key}`, JSON.stringify(v)); } catch (e) { /* פרטי/חסום — לא נזכר, וזה בסדר */ } };

/* key — שם הגרף לזיכרון · symbols — מה אפשר לבחור · onChange(selected)
   מחזיר { el, selected() → [{ sym, color }] } */
export function comparePicker({ key, symbols, onChange, max = MAX_COMPARE }) {
  const avail = new Set(symbols);
  let sel = load(key).filter(x => x && avail.has(x.sym) && COLORS.includes(x.color)).slice(0, max);
  const el = h('div', { class: 'cmp', role: 'group', 'aria-label': 'השוואה לנייר' });

  const render = () => {
    const chips = sel.map(x => h('span', { class: 'cmp-chip' },
      h('i', { style: { background: `var(${x.color})` }, 'aria-hidden': 'true' }),
      h('span', { class: 'sym' }, x.sym),
      h('button', { type: 'button', 'aria-label': `הסר את ${x.sym} מההשוואה`, title: 'הסר', onclick: () => set(sel.filter(y => y.sym !== x.sym)) }, '×')));
    const free = symbols.filter(s => !sel.some(x => x.sym === s));
    const full = sel.length >= max;
    const pick = h('select', { class: 'cmp-add', 'aria-label': 'הוסף נייר להשוואה', disabled: full || !free.length },
      h('option', { value: '' }, full ? `עד ${max} ניירות` : '+ השוואה'),
      free.map(s => h('option', { value: s }, s)));
    pick.addEventListener('change', () => {
      const s = pick.value; if (!s) return;
      const color = COLORS.find(c => !sel.some(x => x.color === c));
      set([...sel, { sym: s, color }]);
    });
    el.replaceChildren(...chips, pick);
  };
  const set = v => { sel = v; save(key, sel); render(); onChange && onChange(sel); };
  render();
  return { el, selected: () => sel };
}
