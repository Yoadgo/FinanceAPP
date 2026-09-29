/* ================================================================
   BREAKDOWN — "על מה הוצאנו". צריכה בלבד: העברות מקוזזות ומוצגות
   בנפרד, סילוק כרטיס לא נספר (הפירוט הוא ההוצאה), זוג מתקזז יוצא.

   ציר זמן: לפי חיוב (ברירת מחדל — מתלכד עם הבנק לאגורה) או לפי עסקה
   (מתי באמת קנית). לחיצה על קטגוריה פותחת בדיוק את השורות שמרכיבות
   אותה (rowsIn — אותו סינון כמו הסכום, נעול בבדיקה), ושם מתקנים.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, kpi, note, chip, table } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { ils, pct } from '../../core/format.js';
import { hrefOf } from '../../core/routes.js';
import * as store from '../../core/store.js';
import * as S from '../../engines/spend.js';
import { loadSpend, applyLocal } from './data.js';
import { head, seg, catPicker, ensureCategory, catColor, monthName, monthShort, dm, bar } from './common.js';

const ui = { basis: 'billing', month: 'all', openCat: null, sub: false };

export async function render(el, ctx) {
  mount(el, head('על מה הוצאנו', ctx.world.question), loading('kpis'), h('div', { class: 'grid main-side' }, loading('card'), loading('card')));
  let data;
  try { data = await loadSpend(); } catch (e) { mount(el, head('על מה הוצאנו'), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  if (!data.rows.length) {
    mount(el, head('על מה הוצאנו', ctx.world.question), emptyState({
      title: 'אין עדיין הוצאות במסד', text: 'אחרי העברה מהגיליון או קליטת פירוט אשראי — כאן יופיע לאן הלך הכסף, לפי קטגוריה וחודש.',
      actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'migrate') }, 'להעברה מהגיליון')],
    }));
    return;
  }
  draw(el, ctx, data);
}

function draw(el, ctx, data) {
  const redraw = () => draw(el, ctx, data);
  const rows = data.rows;
  const wash = S.washPairs(rows);
  const months = S.months(rows, ui.basis);
  if (ui.month !== 'all' && !months.includes(ui.month)) ui.month = 'all';
  const opt = { basis: ui.basis, month: ui.month, washPairs: wash };
  const sm = S.summarize(rows, opt);
  const all = S.summarize(rows, { basis: ui.basis, washPairs: wash });
  const inst = S.openInstallments(rows);
  const owed = inst.reduce((a, x) => a + x.remaining, 0);
  const floating = S.unlinkedCredits(rows, wash);
  const floatSum = floating.reduce((a, r) => a + r.charge, 0);

  const tools = h('div', { class: 'sp-tools' },
    seg([['billing', 'לפי חיוב'], ['date', 'לפי עסקה']], ui.basis, v => { ui.basis = v; redraw(); }, 'ציר זמן'));
  const monthsBar = h('div', { class: 'sp-months', role: 'group', 'aria-label': 'חודש' },
    [['all', 'כל התקופה'], ...months.map(m => [m, monthName(m)])].map(([v, l]) =>
      h('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(ui.month === v), onclick: () => { ui.month = v; ui.openCat = null; redraw(); } }, l)));

  const periodTxt = ui.month === 'all' ? `${months.length} חודשי ${ui.basis === 'billing' ? 'חיוב' : 'עסקה'}` : monthName(ui.month);
  const spendTrace = () => ({
    title: `צריכה · ${periodTxt}`, total: sm.spend, totalText: ils(sm.spend),
    formula: 'סכום שורות האשראי בדלי "צריכה" (כולל שורות שעוד בלי קטגוריה). לא כולל: העברות (PayBox/BIT), קטגוריית "הון", וזוגות עסקה+ביטול שמתקזזים.',
    parts: sm.byCat.map(c => ({ label: c.cat, valueText: ils(c.sum) })), partsSum: sm.spend,
  });
  const strip = h('div', { class: 'strip' },
    kpi({ label: ui.month === 'all' ? 'צריכה בתקופה' : 'צריכה בחודש', value: ils(sm.spend, { digits: 0 }), trace: spendTrace, ctx: periodTxt }),
    kpi({ label: 'מזה עוד בלי קטגוריה', value: ils(sm.pending, { digits: 0 }), size: 'sm', cls: sm.pending > 1 ? 'attn' : '', ctx: sm.spend ? `${pct((sm.pending / sm.spend) * 100, { sign: false, digits: 0 })} מהצריכה` : null }),
    kpi({ label: 'העברות', value: ils(sm.transfer, { digits: 0 }), size: 'sm', ctx: 'כסף שזז, לא צריכה' }),
    kpi({ label: 'תשלומים פתוחים', value: ils(owed, { digits: 0 }), size: 'sm', ctx: `${inst.length} עסקאות שעוד משלמים` }),
    kpi({ label: 'זיכויים שלא שויכו', value: ils(-floatSum, { digits: 0 }), size: 'sm', cls: floating.length ? 'attn' : '', ctx: floating.length ? `${floating.length} שורות — למטה` : 'הכול משויך' }));

  mount(el,
    head('על מה הוצאנו', null, tools),
    monthsBar, strip,
    sm.pending > 1 ? note(`${ils(sm.pending, { digits: 0 })} עדיין בלי קטגוריה — זה הפס האפור. כל קבוצה שתאשר מעבירה סכום ממנו לקטגוריה אמיתית.`, { action: h('a', { class: 'btn sm', href: hrefOf('spend', 'pending') }, 'לסיווג') }) : null,
    h('div', { class: 'grid main-side' }, catPanel(sm, data, opt, redraw), h('div', { class: 'grid' }, monthPanel(all, ui.month, m => { ui.month = m; redraw(); }), tagPanel(sm))),
    h('div', { class: 'grid cols-2' }, installmentsPanel(inst), creditsPanel(floating, wash, data, redraw)));
}

/* ── לפי קטגוריה, עם פתיחה לשורות ── */
function catPanel(sm, data, opt, redraw) {
  const list = ui.sub ? sm.bySub.map(x => ({ cat: x.cat, label: x.sub ? `${x.cat} · ${x.sub}` : x.cat, sum: x.sum, sub: x.sub })) : sm.byCat.map(x => ({ ...x, label: x.cat }));
  const max = list.length ? Math.max(...list.map(x => Math.abs(x.sum))) : 1;
  const body = h('div', { class: 'sp-cats' });
  list.forEach(c => {
    const key = ui.sub ? `${c.cat}|${c.sub || ''}` : c.cat;
    const open = ui.openCat === key;
    const row = h('button', { type: 'button', class: `sp-cat${open ? ' open' : ''}`, 'aria-expanded': String(open) },
      h('span', { class: 'sp-cat-n' }, h('i', { style: { background: catColor(c.cat) } }), c.label),
      bar(c.sum, max, catColor(c.cat)),
      h('span', { class: 'sp-cat-p small muted' }, sm.spend ? pct((c.sum / sm.spend) * 100, { sign: false, digits: 0 }) : ''),
      num(ils(c.sum, { digits: 0 }), 'sp-cat-v'));
    row.addEventListener('click', () => { ui.openCat = open ? null : key; redraw(); });
    body.append(row);
    if (open) body.append(catRows(c, data, opt, redraw));
  });
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'לפי קטגוריה'), h('div', { class: 'tools' },
      seg([[false, 'קטגוריה'], [true, 'תת-קטגוריה']], ui.sub, v => { ui.sub = v; ui.openCat = null; redraw(); }, 'רמה'))),
    h('div', { class: 'panel-b' }, list.length ? body : h('p', { class: 'muted small' }, 'אין צריכה בתקופה הזו.'),
      h('p', { class: 'small muted' }, 'לחיצה על קטגוריה פותחת את השורות שמרכיבות אותה — שם מתקנים טעות שכבר אושרה.')));
}

function catRows(c, data, opt, redraw) {
  const rows = S.rowsIn(data.rows, ui.sub ? { ...opt, cat: c.cat, sub: c.sub || '' } : { ...opt, cat: c.cat }).slice().sort((a, b) => b.charge - a.charge);
  const MAX = 60;
  return h('div', { class: 'sp-drill' },
    table({
      columns: [
        { key: 'date', label: 'תאריך', render: r => num(dm(r.date), 'muted') },
        { key: 'norm', label: 'סוחר', render: r => h('span', { class: 'sp-clip', title: r.merchant }, r.norm, r.tag ? chip(r.tag, 'accent') : null, r.status === 'auto' ? chip('אוטומטי', '') : null) },
        { key: 'card', label: 'כרטיס', render: r => num(r.card, 'muted') },
        { key: 'charge', label: 'חיוב', num: true, render: r => num(ils(r.charge), r.charge < 0 ? 'up' : '') },
        { key: 'fix', label: 'קטגוריה', render: r => fixCell(r, data, redraw) },
      ],
      rows: rows.slice(0, MAX),
    }),
    rows.length > MAX ? h('p', { class: 'small muted' }, `מוצגות ${MAX} הגדולות מתוך ${rows.length}.`) : null);
}

/* תיקון שורה בודדת: בורר + שמירה. שורה שקושרה (offsetOf) מסווגת דרך
   ההוצאה שאליה קושרה — לא כאן. */
function fixCell(r, data, redraw) {
  if (r.offsetOf && !r.cat) return h('span', { class: 'small muted' }, 'זיכוי מקושר');
  const picker = catPicker({ cats: data.cats, cat: r.cat, sub: r.sub, compact: true, placeholder: '— בחר —' });
  const save = h('button', { type: 'button', class: 'btn sm' }, 'שמור');
  save.addEventListener('click', async () => {
    const { cat, sub } = picker.value();
    if (!cat) return;
    save.disabled = true;
    const before = [{ id: r.id, fields: { category: r.cat, subcategory: r.sub, status: r.status } }];
    try {
      await ensureCategory(data, cat, sub);
      const items = [{ id: r.id, fields: { category: cat, subcategory: sub, status: 'ok' } }];
      await store.patchMany('expenses', items);
      applyLocal('expenses', items);
      toast(`${r.norm} → ${cat}${sub ? ' · ' + sub : ''}`, { onUndo: async () => { try { await store.patchMany('expenses', before); applyLocal('expenses', before); redraw(); } catch (e) { toast(`הביטול נכשל: ${e.message || e}`); } } });
      redraw();
    } catch (e) { save.disabled = false; toast(`השמירה נכשלה: ${e.message || e}`); }
  });
  return h('span', { class: 'sp-fix' }, picker.el, save);
}

/* ── חודש אחרי חודש: עמודות SVG ── */
function monthPanel(all, active, onPick) {
  const data = all.byMonth;
  const max = Math.max(1, ...data.map(d => d.sum));
  const W = 320, H = 150, pad = 18, bw = Math.min(48, (W - pad * 2) / Math.max(1, data.length) - 10);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 30}`);
  svg.setAttribute('class', 'sp-bars');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', data.map(d => `${monthName(d.month)}: ${ils(d.sum, { digits: 0 })}`).join(', '));
  const step = (W - pad * 2) / Math.max(1, data.length);
  data.forEach((d, i) => {
    const x = W - pad - step * (i + 1) + (step - bw) / 2;          // RTL: החודש הראשון מימין
    const bh = Math.max(2, (d.sum / max) * (H - 24));
    const g = document.createElementNS(svg.namespaceURI, 'g');
    g.setAttribute('class', `bar${active === d.month ? ' on' : ''}${active !== 'all' && active !== d.month ? ' dim' : ''}`);
    g.style.cursor = 'pointer';
    g.addEventListener('click', () => onPick(active === d.month ? 'all' : d.month));
    const rect = document.createElementNS(svg.namespaceURI, 'rect');
    Object.entries({ x, y: H - bh, width: bw, height: bh, rx: 3 }).forEach(([k, v]) => rect.setAttribute(k, v));
    const t1 = document.createElementNS(svg.namespaceURI, 'text');
    Object.entries({ x: x + bw / 2, y: H - bh - 6, 'text-anchor': 'middle', class: 'v' }).forEach(([k, v]) => t1.setAttribute(k, v));
    t1.textContent = `${Math.round(d.sum / 100) / 10}K`;
    const t2 = document.createElementNS(svg.namespaceURI, 'text');
    Object.entries({ x: x + bw / 2, y: H + 18, 'text-anchor': 'middle', class: 'l' }).forEach(([k, v]) => t2.setAttribute(k, v));
    t2.textContent = monthShort(d.month);
    g.append(rect, t1, t2);
    svg.append(g);
  });
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'צריכה לפי חודש'), h('span', { class: 'chart-note' }, 'לחיצה על עמודה = סינון')),
    h('div', { class: 'panel-b' }, data.length ? svg : h('p', { class: 'muted small' }, '—')));
}

function tagPanel(sm) {
  if (!sm.byTag.length) return null;
  const max = sm.byTag[0].sum;
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'לפי תג')),
    h('div', { class: 'panel-b sp-cats' }, sm.byTag.map(t => h('div', { class: 'sp-cat static' },
      h('span', { class: 'sp-cat-n' }, t.tag), bar(t.sum, max, 'var(--accent)'), h('span'), num(ils(t.sum, { digits: 0 }), 'sp-cat-v'))),
    h('p', { class: 'small muted' }, 'תג חוצה קטגוריות — טיול אחד אוסף מסעדות, קניות ומלונות. לכן הסכומים כאן חופפים לקטגוריות ולא מתחברים אליהן.')));
}

function installmentsPanel(inst) {
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'תשלומים פתוחים'), h('span', { class: 'chart-note' }, 'נספר רק מה שחויב בפועל. זה מה שעוד לפניך.')),
    h('div', { class: 'panel-b flush' }, inst.length ? table({
      columns: [
        { key: 'merchant', label: 'עסקה', render: x => h('span', { class: 'sp-clip' }, x.merchant) },
        { key: 'at', label: 'תשלום', num: true, render: x => num(`${x.at}/${x.of}`, 'muted') },
        { key: 'per', label: 'לחודש', num: true, render: x => num(ils(x.per)) },
        { key: 'remaining', label: 'נשאר', num: true, render: x => num(ils(x.remaining, { digits: 0 })) },
      ], rows: inst,
    }) : h('p', { class: 'muted small', style: { padding: '12px 16px' } }, 'אין עסקאות בתשלומים שעוד נמשכות.')));
}

/* ── זיכויים: זוגות שהתקזזו לבד, וזיכויים שמחכים לקישור ── */
function creditsPanel(floating, wash, data, redraw) {
  const body = h('div', { class: 'panel-b' });
  if (wash.length) body.append(h('div', { class: 'small muted' }, `התקזזו לבד (עסקה + ביטול, אותו כרטיס, עד 3 ימים): `,
    wash.map(p => h('span', { class: 'sp-pair' }, `${dm(p.debit.date)} ${p.debit.norm} ±${ils(p.amount)}`))));
  if (!floating.length) body.append(h('p', { class: 'small' }, 'כל זיכוי משויך. כסף לא נעלם בשקט.'));
  floating.forEach(r => {
    const cands = S.offsetCandidates(r, data.rows);
    const sel = h('select', { class: 'btn sm', 'aria-label': 'קשר להוצאה' },
      h('option', { value: '' }, 'קשר להוצאה…'),
      cands.map(c => h('option', { value: c.id }, `${dm(c.date)} · ${c.norm} · ${ils(c.charge)}`)));
    const link = h('button', { type: 'button', class: 'btn sm' }, 'קשר');
    link.addEventListener('click', async () => {
      if (!sel.value) return;
      link.disabled = true;
      try {
        const items = [{ id: r.id, fields: { offsetOf: sel.value, status: 'ok' } }];
        await store.patchMany('expenses', items);
        applyLocal('expenses', items);
        const target = data.rows.find(x => x.id === sel.value);
        toast(`הזיכוי קושר ל-${target ? target.norm : 'הוצאה'} ומקטין את הקטגוריה שלה.`, { onUndo: async () => { try { const b = [{ id: r.id, fields: { offsetOf: '', status: 'pending' } }]; await store.patchMany('expenses', b); applyLocal('expenses', b); redraw(); } catch (e) { toast(`הביטול נכשל: ${e.message || e}`); } } });
        redraw();
      } catch (e) { link.disabled = false; toast(`הקישור נכשל: ${e.message || e}`); }
    });
    body.append(h('div', { class: 'sp-credit' },
      h('div', null, h('b', null, r.norm), h('div', { class: 'small muted' }, `${dm(r.date)} · כרטיס ${r.card}`)),
      num(ils(r.charge), 'up'), h('span', { class: 'sp-fix' }, sel, link)));
  });
  body.append(h('p', { class: 'small muted' }, 'זיכוי שאין לו הוצאה מקבילה (החזר מאדם, הטבה) — לסווג אותו במסך "לסיווג" כמו כל שורה.'));
  return h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'זיכויים'), floating.length ? chip(`${floating.length} לא שויכו`, 'attn') : chip('הכול משויך', 'up')), body);
}
