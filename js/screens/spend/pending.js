/* ================================================================
   PENDING — "לסיווג". כל שורת אשראי צריכה קטגוריה אחת; יועד מחליט.

   ההכרעות (אפיון 5.9.2026):
   · סוחרים דומים מקובצים לכרטיס אחד — 25 קבוצות + 81 בודדים = 106
     החלטות במקום 197. הקיבוץ הוא הצעה: לכל סוחר תיבת סימון; ביטחון
     נמוך (כנראה שם מקום) → שום דבר לא מסומן מראש.
   · ההצעה (מילת מפתח או "שכן" שכבר סווג) רק ממלאת את הבורר.
   · "צור כלל לעתיד" — משפיע רק על קליטות הבאות. לא מוחל אחורה.
   · שורות שכלל סיווג בקליטה (auto) נספרות כבר, ומחכות כאן לעין אנושית.
   · כל אישור ניתן לביטול מההודעה שקופצת.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, chip } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { ils } from '../../core/format.js';
import { hrefOf } from '../../core/routes.js';
import * as store from '../../core/store.js';
import { docId } from '../../engines/hash.js';
import { decisions, autoReview, progress, PENDING } from '../../engines/spend.js';
import { loadSpend, applyLocal } from './data.js';
import { head, seg, catPicker, ensureCategory, dm, catColor } from './common.js';

const ui = { tab: 'pending', open: new Set(), shown: 30, busy: new Set(), sel: new Map() };

export async function render(el, ctx) {
  mount(el, head('לסיווג', ctx.world.question), loading('kpis'), loading('card'), loading('card'));
  let data;
  try { data = await loadSpend(); } catch (e) { mount(el, head('לסיווג'), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  if (!data.rows.length) {
    mount(el, head('לסיווג', ctx.world.question), emptyState({
      title: 'אין עדיין שורות אשראי במסד',
      text: 'השורות מגיעות מקליטת קובץ פירוט אשראי, או מהעברת ההוצאות מהגיליון הישן (כולל כל מה שכבר סיווגת שם).',
      actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'migrate') }, 'להעברה מהגיליון'), h('a', { class: 'btn', href: hrefOf('ingest', 'upload') }, 'לקליטת קובץ')],
    }));
    return;
  }
  draw(el, ctx, data);
}

function draw(el, ctx, data) {
  const redraw = () => draw(el, ctx, data);
  const rows = data.rows;
  const g = decisions(rows);
  const auto = autoReview(rows);
  const p = progress(rows);
  const pendingSum = rows.filter(r => !r.cat && !r.offsetOf).reduce((a, r) => a + r.charge, 0);
  const nDec = g.groups.length + g.singles.length;

  const tabs = seg([['pending', `ממתינות · ${nDec}`], ['auto', `אוטומטיות לסקירה · ${auto.reduce((a, x) => a + x.rows.length, 0)}`]], ui.tab, v => { ui.tab = v; ui.shown = 30; redraw(); }, 'תצוגה');
  const blocks = [head('לסיווג', 'כל שורה מקבלת קטגוריה אחת. ההצעות ממלאות — אתה מאשר.', tabs), progressPanel(p, pendingSum)];

  if (ui.tab === 'auto') blocks.push(...autoPanel(auto, data, redraw));
  else if (!nDec) blocks.push(h('section', { class: 'panel' }, emptyState({ title: 'הכול מסווג ✓', text: 'אין שורות שממתינות להחלטה. שורות חדשות יופיעו כאן אחרי הקליטה הבאה.' })));
  else {
    const items = [...g.groups.map(x => ({ ...x, kind: 'group', key: `g:${x.token}` })), ...g.singles.map(x => ({ ...x, kind: 'single', key: `s:${x.norm}` }))];
    const list = h('div', { class: 'sp-cards' });
    const shown = items.slice(0, ui.shown);
    let lastKind = '';
    shown.forEach(it => {
      if (it.kind !== lastKind) {
        list.append(h('div', { class: 'eyebrow sp-sect' }, it.kind === 'group' ? `${g.groups.length} קבוצות סוחרים` : `${g.singles.length} סוחרים בודדים`));
        lastKind = it.kind;
      }
      list.append(card(it, data, redraw));
    });
    blocks.push(list);
    if (items.length > ui.shown) blocks.push(h('button', { class: 'btn', type: 'button', onclick: () => { ui.shown += 30; redraw(); } }, `הצג עוד ${Math.min(30, items.length - ui.shown)} (מתוך ${items.length - ui.shown} שנותרו)`));
  }
  blocks.push(tagList(rows));
  mount(el, ...blocks);
}

function progressPanel(p, pendingSum) {
  const pct = x => `${(x / (p.total || 1)) * 100}%`;
  return h('section', { class: 'panel' }, h('div', { class: 'panel-b sp-progress' },
    h('div', { class: 'sp-progress-top' },
      h('div', null, num(`${p.ok + p.auto}`, 'sp-big'), h('span', { class: 'muted' }, ` מתוך ${p.total} שורות סווגו`)),
      h('div', { class: 'small' }, num(ils(pendingSum, { digits: 0 })), h('span', { class: 'muted' }, ' עדיין בלי קטגוריה'))),
    h('div', { class: 'sp-stack', role: 'img', 'aria-label': `אושרו ${p.ok}, אוטומטי ${p.auto}, בהמתנה ${p.pending}` },
      h('i', { class: 'ok', style: { width: pct(p.ok) } }), h('i', { class: 'auto', style: { width: pct(p.auto) } })),
    h('div', { class: 'legend' },
      h('span', null, h('i', { style: { background: 'var(--up)' } }), `אישרת · ${p.ok}`),
      h('span', null, h('i', { style: { background: 'var(--accent)' } }), `כלל סיווג — לסקירה · ${p.auto}`),
      h('span', null, h('i', { style: { background: 'var(--line-strong)' } }), `בהמתנה · ${p.pending}`))));
}

/* ── כרטיס החלטה: קבוצה או סוחר בודד ── */
function card(it, data, redraw) {
  const solo = it.kind === 'single';
  const members = solo ? [it] : it.members;
  const isOpen = ui.open.has(it.key);
  const preChecked = solo || it.confident;
  /* מקור האמת לבחירה: קבוצת מזהי השורות. תיבת סוחר היא קיצור. */
  const rowsOfMember = m => data.rows.filter(r => r.norm === m.norm && !r.cat && !r.offsetOf);
  /* הבחירה נשמרת בין ציורים (פתיחת כרטיס אחר לא מסמנת מחדש מה שביטלת) */
  if (!ui.sel.has(it.key)) ui.sel.set(it.key, new Set(preChecked ? members.flatMap(m => rowsOfMember(m).map(r => r.id)) : []));
  const sel = ui.sel.get(it.key);
  const allIds = members.flatMap(m => rowsOfMember(m).map(r => r.id));
  for (const id of [...sel]) if (!allIds.includes(id)) sel.delete(id);

  const pill = solo ? chip('סוחר יחיד') : it.confident ? chip(`ביטחון גבוה · ${it.lead}%`, 'up') : chip(`בדוק — ייתכן שם מקום · ${it.lead}%`, 'attn');
  const hd = h('button', { type: 'button', class: 'sp-card-h', 'aria-expanded': String(isOpen) },
    h('span', { class: 'sp-chev', 'aria-hidden': 'true' }, isOpen ? '▾' : '◂'),
    h('span', { class: 'sp-card-t' }, h('b', null, solo ? it.norm : it.token), pill,
      h('span', { class: 'small muted' }, solo ? (it.rows === 1 ? 'שורה אחת' : `${it.rows} שורות`) : `${it.members.length} סוחרים · ${it.rows} שורות`),
      it.sug && it.sug.cat ? h('span', { class: 'small sp-sug' }, h('i', { style: { background: catColor(it.sug.cat) } }), `הצעה: ${it.sug.cat}${it.sug.sub ? ' · ' + it.sug.sub : ''}`) : null),
    num(ils(it.total), 'sp-card-amt'));
  hd.addEventListener('click', () => { if (isOpen) ui.open.delete(it.key); else ui.open.add(it.key); redraw(); });
  const box = h('section', { class: `panel sp-card${isOpen ? ' open' : ''}` }, hd);
  if (!isOpen) return box;

  const why = solo
    ? `סוחר בודד — אין סוחר אחר שנראה כמוהו.${it.sug && it.sug.cat ? ` ההצעה ${it.sug.via && it.sug.via.startsWith('neighbor') ? 'מבוססת על סוחר דומה שכבר סיווגת' : 'מבוססת על מילה בשם'}.` : ' אין הצעה אוטומטית.'}`
    : `מקובץ לפי המילה "${it.token}" — היא פותחת את שם הסוחר ב-${it.lead}% מהמקרים. ${it.confident ? 'לכן כולם מסומנים מראש.' : 'אחוז נמוך מרמז על שם מקום ולא על עסק — לכן שום דבר לא סומן.'}`;

  const approveBtn = h('button', { type: 'button', class: 'btn primary sm' });
  const refreshBtn = () => {
    const ids = [...sel];
    const total = data.rows.filter(r => sel.has(r.id)).reduce((a, r) => a + r.charge, 0);
    approveBtn.textContent = ids.length ? `אשר ${ids.length} שורות · ${ils(total)}` : 'סמן שורות לאישור';
    approveBtn.disabled = !ids.length || ui.busy.has(it.key);
  };

  const memberBoxes = [];
  const memList = h('div', { class: 'sp-mems' }, members.map(m => {
    const ids = rowsOfMember(m).map(r => r.id);
    const cb = h('input', { type: 'checkbox' });
    cb.checked = ids.every(id => sel.has(id));
    cb.addEventListener('change', () => { ids.forEach(id => (cb.checked ? sel.add(id) : sel.delete(id))); syncRows(); refreshBtn(); });
    memberBoxes.push({ cb, ids });
    return h('label', { class: 'sp-mem' }, cb, h('span', { class: 'sp-mem-n' }, m.norm), h('span', { class: 'small muted' }, `${m.rows} ${m.rows === 1 ? 'שורה' : 'שורות'}`), num(ils(m.total)));
  }));

  const rowsBox = h('div', { class: 'sp-rows', hidden: true });
  const rowBoxes = [];
  const syncRows = () => rowBoxes.forEach(({ cb, id }) => { cb.checked = sel.has(id); });
  const syncMems = () => memberBoxes.forEach(({ cb, ids }) => { cb.checked = ids.every(id => sel.has(id)); cb.indeterminate = !cb.checked && ids.some(id => sel.has(id)); });
  members.flatMap(rowsOfMember).sort((a, b) => a.date.localeCompare(b.date)).forEach(r => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = sel.has(r.id);
    cb.addEventListener('change', () => { if (cb.checked) sel.add(r.id); else sel.delete(r.id); syncMems(); refreshBtn(); });
    rowBoxes.push({ cb, id: r.id });
    rowsBox.append(h('label', { class: 'sp-row' }, cb, num(dm(r.date), 'muted'), h('span', { class: 'sp-row-n', title: r.merchant }, r.norm),
      h('span', { class: 'small muted' }, r.installments > 1 ? `תשלום ${r.installment}/${r.installments}` : r.noteKind === 'refund' ? 'זיכוי' : r.card),
      num(ils(r.charge), r.charge < 0 ? 'up' : '')));
  });
  syncMems();
  const detailBtn = h('button', { type: 'button', class: 'btn ghost sm' }, 'פירוט שורות — לדייק אחת-אחת ▾');
  detailBtn.addEventListener('click', () => { rowsBox.hidden = !rowsBox.hidden; detailBtn.textContent = rowsBox.hidden ? 'פירוט שורות — לדייק אחת-אחת ▾' : 'הסתר שורות ▴'; });

  const picker = catPicker({ cats: data.cats, cat: it.sug ? it.sug.cat : '', sub: it.sug ? it.sug.sub : '' });
  const tag = h('input', { class: 'btn sm sp-tag', list: 'sp-taglist', placeholder: 'תג — טיול או אירוע (לא חובה)' });
  const ruleCb = h('input', { type: 'checkbox' });
  ruleCb.checked = solo || it.confident;
  const pattern = solo ? it.norm : it.token;

  approveBtn.addEventListener('click', async () => {
    const { cat, sub } = picker.value();
    if (!cat) { toast('בחר קטגוריה לפני האישור.'); return; }
    ui.busy.add(it.key); refreshBtn();
    try {
      /* כלל לעתיד רק כשכל הקבוצה אושרה. אם הורדת סוחר מהקבוצה, כלל על
         המילה היה תופס גם אותו בקליטה הבאה. */
      const whole = allIds.every(id => sel.has(id));
      const rule = ruleCb.checked && whole ? pattern : null;
      if (ruleCb.checked && !whole) toast(`לא נוצר כלל: "${pattern}" היה תופס גם את השורות שהורדת. אפשר ליצור כלל מדויק במסך הכללים.`, { ms: 9000 });
      const ok = await approve({ data, ids: [...sel], cat, sub, tag: tag.value.trim(), rule });
      if (ok) { ui.open.delete(it.key); ui.sel.delete(it.key); }
    } finally { ui.busy.delete(it.key); }
    redraw();
  });
  refreshBtn();

  box.append(h('div', { class: 'panel-b sp-body' },
    h('p', { class: `small ${!solo && !it.confident ? 'sp-warn' : 'muted'}` }, why),
    memList, detailBtn, rowsBox,
    h('div', { class: 'sp-foot' }, picker.el, tag,
      h('label', { class: 'small sp-rule', title: `כלל: שם הסוחר מכיל "${pattern}". חל רק על קליטות עתידיות.` }, ruleCb, ` צור כלל לעתיד ("${pattern}")`),
      approveBtn)));
  return box;
}

/* ── הכתיבה: שורות → קטגוריה, ואופציונלית כלל לעתיד. עם ביטול. ── */
async function approve({ data, ids, cat, sub, tag, rule }) {
  const before = data.expenses.filter(d => ids.includes(d.id)).map(d => ({ id: d.id, fields: { category: d.category || '', subcategory: d.subcategory || '', tag: d.tag || '', status: d.status || 'pending', ruleId: d.ruleId || '' } }));
  let ruleId = '', ruleCreated = false;
  try {
    await ensureCategory(data, cat, sub);
    const fields = { category: cat, subcategory: sub, status: 'ok' };
    if (tag) fields.tag = tag;
    if (rule) {
      ruleId = await docId('r', `${rule.toUpperCase()}|${cat}|${sub}`);
      fields.ruleId = ruleId;
    }
    /* קודם השורות, אחר כך הכלל — כך כישלון בשורות לא משאיר כלל יתום */
    const items = ids.map(id => ({ id, fields }));
    await store.patchMany('expenses', items);
    applyLocal('expenses', items);
    if (rule) {
      const existing = data.rules.find(r => r.id === ruleId && !r.voided && r.active !== false);
      if (!existing) {
        await store.put('rules', ruleId, { active: true, priority: 50, field: 'merchant', match: 'contains', pattern: rule, card: '', category: cat, subcategory: sub, source: 'user' });
        data.rules = data.rules.filter(r => r.id !== ruleId);
        data.rules.push({ id: ruleId, pattern: rule, category: cat, subcategory: sub, source: 'user', active: true, priority: 50 });
        ruleCreated = true;
      }
    }
    toast(`${ids.length} שורות → ${cat}${sub ? ' · ' + sub : ''}${ruleCreated ? ` · נוצר כלל "${rule}"` : ''}`, {
      onUndo: async () => {
        try {
          await store.patchMany('expenses', before);
          applyLocal('expenses', before);
          /* מבטלים רק כלל שנוצר באישור הזה — לא כלל שהיה קיים קודם */
          if (ruleCreated) { await store.voidDoc('rules', ruleId); data.rules = data.rules.filter(r => r.id !== ruleId); }
          toast('בוטל. השורות חזרו למצבן הקודם.');
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } catch (e) { toast(`הביטול נכשל: ${e.message || e}`); }
      },
    });
    return true;
  } catch (e) {
    toast(`השמירה נכשלה: ${e.message || e}.`, { ms: 12000 });
    return false;
  }
}

/* ── סקירת האוטומטיות: כלל סיווג בקליטה, אדם עוד לא ראה ── */
function autoPanel(groups, data, redraw) {
  if (!groups.length) return [h('section', { class: 'panel' }, emptyState({ title: 'אין שורות אוטומטיות לסקירה', text: 'כשקובץ חדש נקלט, שורות שכלל זיהה יופיעו כאן — כבר נספרות בדוחות, ומחכות לאישור שלך.' }))];
  return [h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'סווגו אוטומטית בקליטה'), h('span', { class: 'chart-note' }, 'כבר נספרות בדוחות. אישור רק מסמן שראית.')),
    h('div', { class: 'panel-b flush' }, h('div', { class: 'actionlist sp-auto' }, groups.map(gr => {
      const picker = catPicker({ cats: data.cats, cat: gr.cat, sub: gr.sub, compact: true });
      const ok = h('button', { type: 'button', class: 'btn sm primary' }, `אשר ${gr.rows.length}`);
      ok.addEventListener('click', async () => {
        const { cat, sub } = picker.value();
        if (!cat) return;
        ok.disabled = true;
        await approve({ data, ids: gr.rows.map(r => r.id), cat, sub, tag: '', rule: null });
        redraw();
      });
      return h('div', null,
        h('div', { class: 'txt' }, h('i', { class: 'dot', style: { background: catColor(gr.cat) } }),
          h('div', null, h('b', null, `${gr.cat}${gr.sub ? ' · ' + gr.sub : ''}`),
            h('div', { class: 'small muted sp-clip' }, gr.merchants.slice(0, 6).join(' · ') + (gr.merchants.length > 6 ? ` ועוד ${gr.merchants.length - 6}` : '')))),
        h('div', { class: 'sp-auto-act' }, num(ils(gr.total)), picker.el, ok));
    }))))];
}

function tagList(rows) {
  const tags = [...new Set(rows.map(r => r.tag).filter(Boolean))].sort();
  return h('datalist', { id: 'sp-taglist' }, tags.map(t => h('option', { value: t })));
}

export { PENDING };
