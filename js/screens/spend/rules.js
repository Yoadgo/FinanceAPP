/* ================================================================
   RULES — "כללים וקטגוריות".

   קטגוריות: מקור אמת יחיד לכל בורר במסכים. שינוי שם מעדכן את
   הקטגוריה, את כל השורות שמשתמשות בה ואת הכללים — ומראה מראש כמה.
   "הסתרה" מסרבת אם הקטגוריה בשימוש, ומציעה מיזוג במקום.

   כללים: "שם הסוחר מכיל X → קטגוריה". חלים רק בקליטה של קובץ חדש, לא
   אחורה (הכרעה 5.9.2026). כלל של יועד/דרי (עדיפות 50) גובר על כלל זרע
   (100). "פגיעות" = כמה שורות קיימות הכלל היה תופס — כדי לראות כלל
   רחב מדי לפני שהוא פוגע בקליטה הבאה.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, chip, table, note } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { ils } from '../../core/format.js';
import { hrefOf } from '../../core/routes.js';
import * as store from '../../core/store.js';
import { prepRules, ruleHits } from '../../engines/merchants.js';
import { loadSpend, clearSpendCache } from './data.js';
import { head, seg, catColor, ensureCategory } from './common.js';

const ui = { tab: 'cats', editing: null };

export async function render(el, ctx) {
  mount(el, head('כללים וקטגוריות', ctx.world.question), loading('table', 10));
  let data;
  try { data = await loadSpend(); } catch (e) { mount(el, head('כללים וקטגוריות'), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  draw(el, ctx, data);
}

function draw(el, ctx, data) {
  const redraw = () => draw(el, ctx, data);
  const reload = async () => { clearSpendCache(); data = await loadSpend(); draw(el, ctx, data); };
  const tabs = seg([['cats', `קטגוריות · ${Object.keys(data.cats).length}`], ['rules', `כללים · ${data.rules.length}`]], ui.tab, v => { ui.tab = v; redraw(); }, 'תצוגה');
  mount(el, head('כללים וקטגוריות', 'מה כל קטגוריה מכילה, ואיך קובץ חדש מסווג', tabs),
    ui.tab === 'cats' ? catsPanel(data, redraw, reload) : rulesPanel(data, redraw));
}

/* ── קטגוריות ── */
function catsPanel(data, redraw, reload) {
  const usage = {};
  data.rows.forEach(r => { if (!r.cat) return; const u = usage[r.cat] = usage[r.cat] || { n: 0, sum: 0, subs: {} }; u.n++; u.sum += r.charge; if (r.sub) u.subs[r.sub] = (u.subs[r.sub] || 0) + 1; });
  const cats = Object.keys(data.cats).sort((a, b) => ((usage[b] && usage[b].sum) || 0) - ((usage[a] && usage[a].sum) || 0));
  const fromFallback = !data.categories.length;

  const addName = h('input', { class: 'btn sm', placeholder: 'קטגוריה חדשה' });
  const addBtn = h('button', { type: 'button', class: 'btn sm primary' }, 'הוסף');
  addBtn.addEventListener('click', async () => {
    const name = addName.value.trim();
    if (!name) return;
    if (data.cats[name]) { toast('הקטגוריה כבר קיימת.'); return; }
    addBtn.disabled = true;
    try { await ensureCategory(data, name, ''); toast(`נוספה: ${name}`); redraw(); } catch (e) { addBtn.disabled = false; toast(`נכשל: ${e.message || e}`); }
  });

  const list = h('div', { class: 'sp-catlist' }, cats.map(c => {
    const u = usage[c] || { n: 0, sum: 0, subs: {} };
    const editing = ui.editing === c;
    const row = h('div', { class: `sp-catrow${editing ? ' open' : ''}` },
      h('button', { type: 'button', class: 'sp-catrow-h', onclick: () => { ui.editing = editing ? null : c; redraw(); } },
        h('span', { class: 'sp-cat-n' }, h('i', { style: { background: catColor(c) } }), h('b', null, c)),
        h('span', { class: 'sp-subs' }, (data.cats[c] || []).map(s => chip(u.subs[s] ? `${s} · ${u.subs[s]}` : s))),
        h('span', { class: 'small muted' }, u.n ? `${u.n} שורות` : 'לא בשימוש'),
        num(u.n ? ils(u.sum, { digits: 0 }) : '—')));
    if (editing) row.append(catEditor(c, u, data, reload));
    return row;
  }));

  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'קטגוריות'), h('div', { class: 'tools' }, addName, addBtn)),
    fromFallback ? h('div', { class: 'panel-b' }, note('הרשימה עוד לא נשמרה במסד — מוצגת רשימת ברירת המחדל. היא תישמר בפעם הראשונה שתוסיף או תשנה קטגוריה, או בהעברה מהגיליון.', { kind: 'info' })) : null,
    h('div', { class: 'panel-b flush' }, list));
}

function catEditor(c, u, data, reload) {
  const rules = data.rules.filter(r => r.category === c && !r.voided);
  const name = h('input', { class: 'btn sm', value: c, 'aria-label': 'שם חדש' });
  const rename = h('button', { type: 'button', class: 'btn sm primary' }, 'שנה שם / מזג');
  const hint = h('span', { class: 'small muted' });
  const upd = () => {
    const to = name.value.trim();
    hint.textContent = !to || to === c ? '' : data.cats[to]
      ? `"${to}" כבר קיימת → מיזוג: ${u.n} שורות ו-${rules.length} כללים יעברו אליה.`
      : `ישתנו: ${u.n} שורות, ${rules.length} כללים.`;
  };
  name.addEventListener('input', upd);
  rename.addEventListener('click', async () => {
    const to = name.value.trim();
    if (!to || to === c) return;
    rename.disabled = true;
    try {
      const rows = data.expenses.filter(d => d.category === c);
      await store.patchMany('expenses', rows.map(d => ({ id: d.id, fields: { category: to } })));
      await store.patchMany('rules', rules.map(r => ({ id: r.id, fields: { category: to } })));
      const catDocs = data.categories.filter(d => d.category === c);
      if (catDocs.length) await store.patchMany('categories', catDocs.map(d => ({ id: d.id, fields: { category: to } })));
      else await ensureCategory(data, to, '');
      toast(`"${c}" → "${to}": ${rows.length} שורות, ${rules.length} כללים.`);
      ui.editing = null;
      await reload();
    } catch (e) { rename.disabled = false; toast(`נכשל באמצע: ${e.message || e}. מה שנכתב נשאר — הרצה חוזרת תשלים.`, { ms: 12000 }); }
  });

  const subName = h('input', { class: 'btn sm', placeholder: 'תת-קטגוריה חדשה' });
  const addSub = h('button', { type: 'button', class: 'btn sm' }, 'הוסף תת');
  addSub.addEventListener('click', async () => {
    const s = subName.value.trim();
    if (!s) return;
    addSub.disabled = true;
    try { await ensureCategory(data, c, s); toast(`נוספה: ${c} · ${s}`); await reload(); } catch (e) { addSub.disabled = false; toast(`נכשל: ${e.message || e}`); }
  });

  const hide = h('button', { type: 'button', class: 'btn sm ghost' }, 'הסתר');
  hide.addEventListener('click', async () => {
    if (u.n) { toast(`"${c}" בשימוש ב-${u.n} שורות. כדי להיפטר ממנה — שנה את שמה לשם של קטגוריה קיימת (מיזוג).`, { ms: 10000 }); return; }
    const docs = data.categories.filter(d => d.category === c);
    if (!docs.length) { toast('הקטגוריה מגיעה מרשימת ברירת המחדל ואינה במסד.'); return; }
    hide.disabled = true;
    try { await store.patchMany('categories', docs.map(d => ({ id: d.id, fields: { active: false } }))); toast(`"${c}" הוסתרה.`); ui.editing = null; await reload(); }
    catch (e) { hide.disabled = false; toast(`נכשל: ${e.message || e}`); }
  });

  return h('div', { class: 'sp-cat-edit' },
    h('div', { class: 'sp-fix' }, name, rename, hint),
    h('div', { class: 'sp-fix' }, subName, addSub, hide),
    rules.length ? h('div', { class: 'small muted' }, `כללים שמובילים לכאן: ${rules.map(r => `"${r.pattern}"`).join(' · ')}`) : null);
}

/* ── כללים ── */
function rulesPanel(data, redraw) {
  if (!data.rules.length) {
    return h('section', { class: 'panel' }, emptyState({
      title: 'אין עדיין כללי סיווג במסד',
      text: 'הכללים נכתבים בהעברה מהגיליון (הטאב Rules), או נוצרים כשאתה מאשר קבוצה במסך "לסיווג" עם "צור כלל לעתיד".',
      actions: [h('a', { class: 'btn', href: hrefOf('ingest', 'migrate') }, 'להעברה מהגיליון')],
    }));
  }
  const prepared = prepRules(data.rules.filter(r => r.active !== false));
  const hits = {};
  data.rows.forEach(r => prepared.forEach(p => { if (ruleHits(p, { merchantNorm: r.norm, note: r.note, card: r.card })) hits[p.Id] = (hits[p.Id] || 0) + 1; }));
  const rules = data.rules.slice().sort((a, b) => (Number(a.priority) || 100) - (Number(b.priority) || 100) || String(a.pattern).localeCompare(String(b.pattern)));
  const srcLabel = s => (s === 'seed' ? chip('זרע') : s === 'user' ? chip('שלך', 'accent') : chip(s || 'גיליון'));

  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'כללי סיווג'), h('span', { class: 'chart-note' }, 'חלים רק על קליטות חדשות. לא אחורה.')),
    h('div', { class: 'panel-b flush' }, table({
      columns: [
        { key: 'pattern', label: 'שם הסוחר מכיל', render: r => h('b', { class: r.active === false ? 'muted' : '' }, r.pattern) },
        { key: 'cat', label: '→ קטגוריה', render: r => h('span', { class: 'sp-cat-n' }, h('i', { style: { background: catColor(r.category) } }), `${r.category}${r.subcategory ? ' · ' + r.subcategory : ''}`) },
        { key: 'card', label: 'כרטיס', render: r => num(r.card || 'כל', 'muted') },
        { key: 'src', label: 'מקור', render: r => srcLabel(r.source) },
        { key: 'prio', label: 'עדיפות', num: true, render: r => num(String(r.priority || 100), 'muted') },
        { key: 'hits', label: 'פגיעות', num: true, render: r => num(String(hits[r.id] || 0), hits[r.id] ? '' : 'muted') },
        { key: 'act', label: '', render: r => ruleActions(r, redraw) },
      ],
      rows: rules,
    })),
    h('p', { class: 'small muted', style: { padding: '0 16px 12px' } }, 'עדיפות נמוכה = נבדק קודם. "פגיעות" — כמה מהשורות הקיימות הכלל היה תופס היום (כולל כאלה שסיווגת אחרת).'));
}

function ruleActions(r, redraw) {
  const toggle = h('button', { type: 'button', class: 'btn sm' }, r.active === false ? 'הפעל' : 'השבת');
  toggle.addEventListener('click', async () => {
    toggle.disabled = true;
    try { await store.patch('rules', r.id, { active: r.active === false }); r.active = r.active === false; redraw(); }
    catch (e) { toggle.disabled = false; toast(`נכשל: ${e.message || e}`); }
  });
  return h('span', { class: 'sp-fix' }, toggle);
}
