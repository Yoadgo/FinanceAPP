/* ================================================================
   JOURNAL — יומן מחקר. "למה קניתי, מתי אצא, והאם צדקתי".
   (שלב 3, 30.9.2026. יועד בחר: תזה לנייר + ציר זמן; שדות: מחיר
   יעד ותנאי יציאה.)

   בצד: כל הניירות — מוחזקים קודם, עם סימן אם יש תזה.
   במרכז, לנייר שנבחר:
     · פסק הדין מול IVV (מאותו מנוע של "ביצועים מול מדד")
     · התזה הנוכחית: מחיר יעד וכמה נשאר אליו, תנאי יציאה
     · טופס רשומה חדשה (תזה / עדכון / לקח)
     · ציר זמן: הרשומות והעסקאות יחד — כך רואים מה חשבת כשקנית,
       ומה קרה אחר כך.
   נתונים: אוסף journal (store.js). טקסט נכנס כ-textContent בלבד.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, chip, note } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { usd, pct, qty as fq, day, todayIso, dirClass } from '../../core/format.js';
import { hrefOf } from '../../core/routes.js';
import { session } from '../../core/auth.js';
import * as store from '../../core/store.js';
import * as liveApi from '../../core/live.js';
import { loadInvest, loadMarket } from './data.js';
import { efficiency, verdictText } from '../../engines/efficiency.js';
import { KINDS, normalizeEntry, currentThesis, timeline, targetGap, symbolsIndex } from '../../engines/journal.js';
import { BENCHMARK } from '../../config.js';

let selected = null;
let kind = 'thesis';
/* טיוטה: מה שהוקלד נשמר כשמחליפים סוג רשומה (לא נמחק, ולא נקרא שוב מהמסד) */
let draft = { text: '', date: '', target: '', exit: '' };

export async function render(el, ctx) {
  mount(el, head(), loading('card'), loading('table'));
  let inv, market, live, entries;
  try {
    [inv, market, live, entries] = await Promise.all([loadInvest(), loadMarket(), liveApi.ready().catch(() => null), store.list('journal')]);
  } catch (e) { mount(el, head(), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  entries = entries.map(e => ({ ...e, createdKey: e.createdAt && e.createdAt.toMillis ? String(e.createdAt.toMillis()).padStart(15, '0') : '' }));
  const index = symbolsIndex(entries, inv.positions, inv.rows);
  if (!index.length) {
    mount(el, head(), emptyState({ title: 'אין עדיין ניירות', text: 'היומן נבנה סביב הניירות שקנית. אחרי שיהיו תנועות, כל נייר יופיע כאן.', actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'upload') }, 'לקליטת קובץ')] }));
    return;
  }
  if (!selected || !index.find(s => s.symbol === selected)) selected = index[0].symbol;
  let eff = null;
  try { if (market.history[BENCHMARK]) eff = efficiency(inv.rows, market.history, { bench: BENCHMARK, fx: market.fx }); } catch (e) { eff = null; }
  draw(el, ctx, { inv, market, live, entries, index, eff });
}

function head() {
  return h('div', { class: 'world-head' }, h('h1', null, 'יומן מחקר'), h('span', { class: 'question' }, 'למה קניתי, מתי אצא, והאם צדקתי'));
}

function priceOf(sym, live, market) {
  const p = live && live.data && live.data.prices && live.data.prices[sym];
  if (p && isFinite(p.price)) return { price: p.price, asOf: p.asOf };
  const hist = market.history[sym];
  if (hist && hist.length) return { price: hist[hist.length - 1].close, asOf: hist[hist.length - 1].date };
  return null;
}

function draw(el, ctx, data) {
  const { index } = data;
  const side = h('nav', { class: 'journal-list', 'aria-label': 'ניירות' },
    index.map(s => h('button', {
      type: 'button', class: 'journal-sym', 'aria-pressed': String(s.symbol === selected),
      onclick: () => { if (s.symbol !== selected) draft = { text: '', date: '', target: '', exit: '' }; selected = s.symbol; draw(el, ctx, data); },
    },
    h('span', { class: 'sym' }, s.symbol),
    h('span', { class: 'small muted' }, s.qty > 0 ? `${fq(s.qty)} יח'` : 'נסגר'),
    s.thesis ? chip('תזה', 'accent') : (s.qty > 0 ? chip('אין תזה', 'attn') : null))));
  mount(el, head(), h('div', { class: 'journal' }, side, main(el, ctx, data)));
}

function main(el, ctx, data) {
  const { inv, market, live, entries, eff } = data;
  const sym = selected;
  const px = priceOf(sym, live, market);
  const thesis = currentThesis(sym, entries);
  const s = data.index.find(x => x.symbol === sym);
  const effRow = eff && eff.bySymbol.find(x => x.symbol === sym);

  const header = h('div', { class: 'panel-h' },
    h('h2', null, h('span', { class: 'sym' }, sym), ' ', s.qty > 0 ? chip(`מוחזק · ${fq(s.qty)}`, 'up') : chip('לא מוחזק')),
    h('span', { class: 'chart-note' }, px ? num(`${usd(px.price, { digits: 2 })} · ${day(px.asOf)}`) : 'אין מחיר'));

  const verdict = effRow
    ? h('div', { class: `verdict ${effRow.worth ? 'good' : 'bad'}` },
      h('span', { class: 'mark', 'aria-hidden': 'true' }, effRow.worth ? '✓' : '✗'),
      h('b', null, effRow.worth ? `שווה מול ${BENCHMARK}` : `לא שווה מול ${BENCHMARK}`),
      h('p', null, verdictText(effRow, BENCHMARK)))
    : note(eff ? 'לנייר הזה עוד אין פרוסות למדידה מול המדד.' : `פסק הדין מול ${BENCHMARK} יופיע אחרי "משיכת היסטוריה" במסך המיגרציה.`, { kind: 'info' });

  /* התזה הנוכחית */
  let thesisCard;
  if (thesis) {
    const gap = px ? targetGap(px.price, thesis.target) : null;
    thesisCard = h('div', { class: 'card', style: { display: 'grid', gap: '8px' } },
      h('div', { class: 'eyebrow' }, `התזה הנוכחית · ${day(thesis.date)} · ${session.nameOf(thesis.createdBy)}`),
      h('p', { class: 'journal-text' }, thesis.text),
      h('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap' } },
        thesis.target ? h('div', null, h('span', { class: 'small muted' }, 'מחיר יעד '), num(usd(thesis.target, { digits: 2 })),
          gap === null ? null : h('span', { class: 'small' }, ' · ', gap > 0 ? num(`עוד ${pct(gap * 100)} ליעד`, 'muted') : num('היעד הושג', 'up'))) : null,
        thesis.exit ? h('div', null, h('span', { class: 'small muted' }, 'תנאי יציאה: '), thesis.exit) : null));
  } else {
    thesisCard = h('div', { class: 'card' }, h('b', null, 'אין עדיין תזה לנייר הזה'),
      h('p', { class: 'small muted' }, s.qty > 0 ? 'למה קנית? מה המחיר שבו תסתפק, ומתי תודה שטעית? שלוש שורות עכשיו יחסכו ניחוש בעוד חצי שנה.' : 'אפשר לכתוב לקח על העסקאות שנסגרו.'));
  }

  const tl = timeline(sym, entries, inv.rows);
  const tlList = tl.length ? h('ol', { class: 'timeline' }, tl.map(it => timelineItem(it, el, ctx))) : h('p', { class: 'small muted' }, 'אין עדיין אירועים.');

  return h('section', { class: 'panel' }, header,
    h('div', { class: 'panel-b', style: { display: 'grid', gap: '14px' } },
      verdict, thesisCard, form(sym, px, el, ctx),
      h('div', { class: 'eyebrow' }, `ציר זמן · ${tl.length}`), tlList));
}

function form(sym, px, el, ctx) {
  const date = h('input', { type: 'date', value: draft.date || todayIso(), 'aria-label': 'תאריך', max: todayIso() });
  const text = h('textarea', { rows: '3', placeholder: kind === 'thesis' ? 'למה אני מחזיק את הנייר הזה?' : kind === 'lesson' ? 'מה למדתי?' : 'מה השתנה?', 'aria-label': 'טקסט', maxlength: '4000' });
  const target = h('input', { type: 'number', step: '0.01', min: '0', placeholder: px ? `למשל ${Math.round(px.price * 1.2)}` : 'מחיר יעד', 'aria-label': 'מחיר יעד ($)' });
  const exit = h('input', { type: 'text', placeholder: 'למשל: מתחת ל-$300, או אם הצמיחה בענן נעצרת', 'aria-label': 'תנאי יציאה', maxlength: '500' });
  text.value = draft.text; target.value = draft.target; exit.value = draft.exit;
  const keep = () => { draft = { text: text.value, date: date.value, target: target.value, exit: exit.value }; };
  const msg = h('span', { class: 'small' });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'שמירה');
  const kinds = h('div', { class: 'seg', role: 'group', 'aria-label': 'סוג רשומה' },
    Object.entries(KINDS).map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(kind === k), onclick: () => { keep(); kind = k; f.replaceWith(form(sym, px, el, ctx)); } }, l)));
  const f = h('form', { class: 'card journal-form', style: { display: 'grid', gap: '8px' } },
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, h('b', null, 'רשומה חדשה'), kinds, date),
    text,
    kind === 'thesis' ? h('div', { class: 'grid cols-2' },
      h('label', { class: 'small' }, 'מחיר יעד ($)', target),
      h('label', { class: 'small' }, 'תנאי יציאה', exit)) : null,
    h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, save, msg));
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const { entry, problems } = normalizeEntry({ symbol: sym, date: date.value, kind, text: text.value, target: target.value, exit: exit.value });
    if (problems.length) { msg.textContent = problems.join(' · '); msg.className = 'small down'; return; }
    save.disabled = true; msg.textContent = 'שומר…'; msg.className = 'small muted';
    try {
      const id = `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await store.put('journal', id, entry);
      draft = { text: '', date: '', target: '', exit: '' };
      toast('נשמר ביומן');
      render(el, ctx);
    } catch (err) { save.disabled = false; msg.textContent = `השמירה נכשלה: ${err.message || err}`; msg.className = 'small down'; }
  });
  return f;
}

function timelineItem(it, el, ctx) {
  if (it.type !== 'note') {
    const label = { buy: 'קנייה', sell: 'מכירה', split: 'פיצול' }[it.type];
    return h('li', { class: `tl-trade ${it.type}` },
      num(day(it.date), 'muted'),
      h('span', null, h('b', null, label), ' ', num(`${fq(it.qty)}${it.type !== 'split' && it.price ? ` @ ${usd(it.price, { digits: 2 })}` : ''}`), h('span', { class: 'small muted' }, ` · ${it.portfolio}`)));
  }
  const e = it.entry;
  const del = h('button', { class: 'btn sm ghost', type: 'button' }, 'מחיקה');
  let armed = false;
  del.addEventListener('click', async () => {
    if (!armed) { armed = true; del.textContent = 'בטוח?'; setTimeout(() => { armed = false; del.textContent = 'מחיקה'; }, 4000); return; }
    del.disabled = true;
    try { await store.voidDoc('journal', e.id); toast('הרשומה נמחקה (נשמרת במסד כמבוטלת)'); render(el, ctx); }
    catch (err) { del.disabled = false; toast(`המחיקה נכשלה: ${err.message || err}`); }
  });
  return h('li', { class: `tl-note ${e.kind}` },
    num(day(e.date), 'muted'),
    h('div', { style: { display: 'grid', gap: '4px' } },
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        chip(KINDS[e.kind] || e.kind, e.kind === 'thesis' ? 'accent' : e.kind === 'lesson' ? 'attn' : ''),
        h('span', { class: 'small muted' }, session.nameOf(e.createdBy)),
        e.target ? h('span', { class: 'small' }, 'יעד ', num(usd(e.target, { digits: 2 }))) : null,
        del),
      h('p', { class: 'journal-text' }, e.text),
      e.exit ? h('p', { class: 'small' }, h('span', { class: 'muted' }, 'תנאי יציאה: '), e.exit) : null));
}
