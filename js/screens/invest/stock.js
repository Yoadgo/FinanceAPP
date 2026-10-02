/* ================================================================
   STOCK — כרטיס נייר. "מה עשיתי עם הנייר הזה, מה יצא לי, ומה יקרה
   אם אמכור עכשיו". (יועד, 30.9.2026. כולל את יומן המחקר.)

   בצד: כל הניירות — מוחזקים קודם, עם סימן אם יש תזה.
   במרכז, לנייר שנבחר:
     · גרף סגירות עם נקודות כניסה (▲) ויציאה (▼) וקו העלות הממוצעת
     · נטו על הנייר: ממומש + לא ממומש − עמלות, ומול IVV
     · "אם אמכור עכשיו": עמלה משוערת, מס 25% פחות זיכוי פתוח, נשאר ביד
     · סטטיסטיקות מסחר: כניסות, יציאות, % מרוויחות, החזקה ממוצעת
     · התזה, רשומה חדשה, וציר זמן של רשומות ועסקאות
   קישור ישיר: #/invest/stock/GOOGL. החישוב: engines/stock.js,
   engines/journal.js, engines/efficiency.js. טקסט = textContent בלבד.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, chip, note, kpi } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { usd, ils, pct, qty as fq, day, todayIso, dirClass } from '../../core/format.js';
import { hrefOf, stockHref } from '../../core/routes.js';
import { session } from '../../core/auth.js';
import * as store from '../../core/store.js';
import * as liveApi from '../../core/live.js';
import { loadInvest, loadMarket, hasHistory, autoHistoryError } from './data.js';
import { efficiency, verdictText } from '../../engines/efficiency.js';
import { KINDS, normalizeEntry, currentThesis, timeline, targetGap, symbolsIndex } from '../../engines/journal.js';
import { stockSummary, tradeMarkers, TAX_RATE } from '../../engines/stock.js';
import { friction } from '../../engines/friction.js';
import { tradeChart, legend } from '../../ui/charts.js';
import { comparePicker } from '../../ui/comparePicker.js';
import { compareSymbols, rebasePct, closeBefore } from '../../engines/compare.js';
import { BENCHMARK } from '../../config.js';

let selected = null;
let kind = 'thesis';
/* טיוטה: מה שהוקלד נשמר כשמחליפים סוג רשומה (לא נמחק, ולא נקרא שוב מהמסד) */
let draft = { text: '', date: '', target: '', exit: '' };

export async function render(el, ctx) {
  const fromHash = decodeURIComponent(String(location.hash).split('/')[3] || '').toUpperCase();
  if (/^[A-Z][A-Z0-9.]{0,9}$/.test(fromHash)) selected = fromHash;
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
  try { if (hasHistory(market)) eff = efficiency(inv.rows, market.history, { bench: BENCHMARK, fx: market.fx }); } catch (e) { eff = null; }
  /* זיכוי מס פתוח השנה, לכל תיק (מגן המס) — בדולרים לפי שער היום */
  const creditsUsd = {};
  let creditNote = null;
  try {
    const fx = market.fx && market.fx.size ? market.fx : null;
    const Y = friction(inv.rows, { fx }).years.find(y => y.year === todayIso().slice(0, 4));
    if (Y) Y.portfolios.forEach(p => { if (p.unusedCredit > 0) { if (fx) creditsUsd[p.portfolio] = p.unusedCredit / fx.rateOn(todayIso()); else creditNote = 'יש זיכוי מס פתוח, אבל חסר שער דולר–שקל כדי לקזז אותו בהערכה.'; } });
  } catch (e) { creditNote = 'הזיכוי הפתוח לא חושב (חסר שער דולר–שקל).'; }
  draw(el, ctx, { inv, market, live, entries, index, eff, creditsUsd, creditNote });
}

function head() {
  return h('div', { class: 'world-head' }, h('h1', null, 'ניירות'), h('span', { class: 'question' }, 'מה עשיתי עם הנייר, מה יצא לי, ומה אם אמכור עכשיו'));
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
      onclick: () => {
        if (s.symbol !== selected) draft = { text: '', date: '', target: '', exit: '' };
        selected = s.symbol;
        history.replaceState(null, '', stockHref(s.symbol));      // קישור שאפשר לשתף, בלי טעינה מחדש
        draw(el, ctx, data);
      },
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
  const found = eff && eff.bySymbol.find(x => x.symbol === sym);
  const effRow = found && !found.incomplete ? found : null;

  const header = h('div', { class: 'panel-h' },
    h('h2', null, h('span', { class: 'sym' }, sym), ' ', s.qty > 0 ? chip(`מוחזק · ${fq(s.qty)}`, 'up') : chip('לא מוחזק')),
    h('span', { class: 'chart-note' }, px ? num(`${usd(px.price, { digits: 2 })} · ${day(px.asOf)}`) : 'אין מחיר'));

  const verdict = effRow
    ? h('div', { class: `verdict ${effRow.worth ? 'good' : 'bad'}` },
      h('span', { class: 'mark', 'aria-hidden': 'true' }, effRow.worth ? '✓' : '✗'),
      h('b', null, effRow.worth ? `שווה מול ${BENCHMARK}` : `לא שווה מול ${BENCHMARK}`),
      h('p', null, verdictText(effRow, BENCHMARK)))
    : note(found && found.incomplete ? `חסרים מחירים לחלק מהעסקאות בנייר הזה, ולכן אין פסק דין מול ${BENCHMARK} — חלקי היה מטעה.`
      : eff ? 'לנייר הזה עוד אין פרוסות למדידה מול המדד.'
      : `אין עדיין היסטוריית מחירים${autoHistoryError ? ` (המשיכה האוטומטית נכשלה: ${autoHistoryError})` : ''}. אפשר למשוך ידנית במסך המיגרציה.`, { kind: 'info' });

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

  /* ── מספרים ── */
  const S = stockSummary(sym, inv.rows, { price: px ? px.price : null, creditsUsd: data.creditsUsd });
  const chartBox = h('div', { class: 'stock-chart' });
  const hist = market.history[sym] || [];
  const markers = tradeMarkers(sym, inv.rows);
  /* השוואה לטיקר (יועד, 2.10.2026): כשנבחר נייר להשוואה, כל הגרף עובר לאחוזים
     מתחילת הטווח — הנייר, העלות הממוצעת וקווי ההשוואה — כדי שיהיו על ציר אחד. */
  const legendBox = h('div');
  const pickerS = hist.length > 20 ? comparePicker({ key: 'stock', symbols: compareSymbols(market.history, { exclude: [sym] }), onChange: () => drawTrade() }) : null;
  const chartPart = hist.length > 20
    ? h('div', null, h('div', { class: 'cmp-bar' }, pickerS.el), chartBox, legendBox)
    : note(hasHistory(market) ? `אין היסטוריית מחירים ל-${sym} בגיליון המחירים, ולכן אין גרף. כדי להוסיף: להוסיף את הנייר לגיליון "FinanceAPP — מחירים".`
      : `אין עדיין היסטוריית מחירים${autoHistoryError ? ` (המשיכה האוטומטית נכשלה: ${autoHistoryError})` : ''}, ולכן אין גרף.`, { kind: 'info' });
  let tc = null;
  const drawTrade = async () => {
    /* מאז שבוע לפני הכניסה הראשונה — לא 2022 כולה בשביל נייר שנקנה אתמול */
    const from = S.firstDate ? new Date(Date.parse(S.firstDate) - 30 * 86400000).toISOString().slice(0, 10) : '';
    const cut = hist.filter(x => x.date >= from);
    const closes = cut.length > 1 ? cut : hist;
    const cmp = pickerS.selected();
    let opts = { closes, markers, avgCost: S.qty > 0 ? S.avgCost : null, height: 300 };
    if (cmp.length) {
      const f0 = closes[0].date, base = closeBefore(hist, f0) || closes[0].close;
      const p = v => `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
      opts = { ...opts, format: p,
        closes: rebasePct(hist, f0).map(x => ({ date: x.time, close: x.value })),
        avgCost: S.qty > 0 ? (S.avgCost / base - 1) * 100 : null,
        overlays: cmp.map(c => ({ color: c.color, data: rebasePct(market.history[c.sym] || [], f0) })) };
    }
    mount(legendBox, legend([
      { label: cmp.length ? `${sym} · % מתחילת הגרף` : 'סגירה', color: '--s-1' }, { label: '▲ קנייה', color: '--up' }, { label: '▼ מכירה', color: '--down' },
      ...cmp.map(c => ({ label: `${c.sym} · %`, color: c.color })),
      ...(S.qty > 0 ? [{ label: `עלות ממוצעת ${usd(S.avgCost, { digits: 2 })}`, color: '--fg-2', dashed: true }] : [])]));
    if (tc) { tc.remove(); tc = null; }
    chartBox.replaceChildren();
    try { tc = await tradeChart(chartBox, opts); }
    catch (e) { mount(chartBox, note(`הגרף לא נטען: ${e.message || e}`, { kind: 'bad' })); }
  };
  /* setTimeout ולא requestAnimationFrame: rAF לא רץ בלשונית מוסתרת, והגרף לא היה מצויר עד שחוזרים אליה */
  if (hist.length > 20) setTimeout(drawTrade, 0);

  const edge = effRow ? effRow.edge : null;
  const strip = h('div', { class: 'strip' },
    kpi({ label: 'נטו על הנייר', value: usd(S.net, { sign: true }), cls: dirClass(S.net), ctx: S.qty > 0 ? 'כולל מה שעדיין מוחזק, לפי המחיר עכשיו' : 'כל העסקאות נסגרו',
      trace: { title: `נטו על ${sym}`, total: S.net, totalText: usd(S.net),
        formula: 'רווח ממומש (מכירות, FIFO) + רווח לא ממומש (מה שמוחזק × המחיר עכשיו − העלות שלו) − כל העמלות ששולמו על הנייר.',
        parts: [{ label: 'ממומש', valueText: usd(S.realized) }, { label: 'לא ממומש', valueText: usd(S.unrealized ?? 0) }, { label: 'עמלות', valueText: usd(-S.commissions) }],
        partsSum: S.realized + (S.unrealized ?? 0) - S.commissions } }),
    kpi({ label: 'ממומש', value: usd(S.realized, { sign: true }), size: 'sm', cls: dirClass(S.realized), ctx: `${S.closedTrades} מכירות` }),
    kpi({ label: 'לא ממומש', value: S.qty > 0 ? usd(S.unrealized, { sign: true }) : '—', size: 'sm', cls: dirClass(S.unrealized),
      ctx: S.qty > 0 ? `${fq(S.qty)} יח' · עלות ${usd(S.openCost)}` : 'אין אחזקה' }),
    kpi({ label: 'עמלות', value: usd(S.commissions), size: 'sm', ctx: `${S.entries + S.exits} עסקאות` }),
    kpi({ label: `מול ${BENCHMARK}`, value: edge === null ? '—' : usd(edge, { sign: true }), size: 'sm', cls: dirClass(edge),
      ctx: effRow ? (effRow.worth ? 'שווה — הכה את המדד' : 'לא שווה — המדד היה עושה יותר') : (found && found.incomplete ? 'חסרים מחירים' : 'דרושה היסטוריית מחירים') }));

  const kv = (label, value, cls = '') => h('div', { class: 'kv' }, h('span', { class: 'muted' }, label), num(value, cls));
  const N = S.sellNow;
  const sellCard = h('div', { class: 'card', style: { display: 'grid', gap: '6px' } },
    h('div', { class: 'card-title' }, 'אם אמכור עכשיו'),
    N ? [
      kv(`שווי שוק (${fq(S.qty)} × ${usd(px.price, { digits: 2 })})`, usd(N.value)),
      kv(`עמלת מכירה משוערת${N.perPortfolio.length > 1 ? ` (${N.perPortfolio.length} תיקים)` : ''}`, usd(-N.fee)),
      kv('רווח לפני מס', usd(N.gain, { sign: true }), dirClass(N.gain)),
      kv(`מס רווח הון משוער (${Math.round(TAX_RATE * 100)}%)`, usd(-N.taxBefore)),
      N.creditUsed > 0.005 ? kv('פחות זיכוי מס פתוח בתיק (הפסדים שמומשו השנה)', usd(N.creditUsed), 'up') : null,
      h('hr', { class: 'sep' }),
      kv('רווח אחרי מס ועמלה', usd(N.afterTax, { sign: true }), dirClass(N.afterTax)),
      kv('נשאר ביד', usd(N.cashOut)),
      kv('הנייר מההתחלה, אם אמכור עכשיו', usd(N.lifetimeAfterTax, { sign: true }), dirClass(N.lifetimeAfterTax)),
      h('p', { class: 'small muted', style: { margin: 0 } }, 'הערכה: המס בפועל מחושב בשקלים וכולל את שינוי השער, והעמלה היא הממוצע של מכירות קודמות. זיכוי מס פתוח מקזז רק באותו תיק.'),
      data.creditNote ? h('p', { class: 'small', style: { margin: 0 } }, data.creditNote) : null,
    ] : h('p', { class: 'small muted' }, S.qty > 0 ? 'אין מחיר עדכני לנייר — אי אפשר להעריך.' : 'אין אחזקה פתוחה בנייר הזה.'));

  const statsCard = h('div', { class: 'card', style: { display: 'grid', gap: '6px' } },
    h('div', { class: 'card-title' }, 'סטטיסטיקות מסחר'),
    kv('כניסות / יציאות', `${S.entries} / ${S.exits}`),
    kv('מכירות מרוויחות', S.winRate === null ? '—' : `${S.wins} מתוך ${S.closedTrades} · ${pct(S.winRate * 100, { sign: false, digits: 0 })}`),
    kv('החזקה ממוצעת עד מכירה', S.avgHoldDays === null ? '—' : `${Math.round(S.avgHoldDays)} ימים`),
    kv('מחיר קנייה ממוצע', S.avgBuy === null ? '—' : usd(S.avgBuy, { digits: 2 })),
    kv('מחיר מכירה ממוצע', S.avgSell === null ? '—' : usd(S.avgSell, { digits: 2 }), S.avgSell !== null && S.avgBuy !== null ? dirClass(S.avgSell - S.avgBuy) : ''),
    kv('עמלה ממוצעת לעסקה', S.entries + S.exits ? usd(S.commissions / (S.entries + S.exits), { digits: 2 }) : '—'),
    kv('פעיל מאז', S.firstDate ? day(S.firstDate) : '—'),
    kv('תיקים', S.portfolios.join(', ') || '—'),
    h('p', { class: 'small muted', style: { margin: 0 } }, 'מחירים ממוצעים מותאמים לפיצולים (מפרוסות ה-FIFO).'));

  return h('section', { class: 'panel' }, header,
    h('div', { class: 'panel-b', style: { display: 'grid', gap: '14px' } },
      chartPart, strip,
      h('div', { class: 'grid cols-2' }, sellCard, statsCard),
      verdict,
      h('div', { class: 'eyebrow' }, 'תזה ויומן'),
      thesisCard, form(sym, px, el, ctx),
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
