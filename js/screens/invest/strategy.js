/* ================================================================
   STRATEGY — "האם כל חלק באסטרטגיה עושה את העבודה שלו".
   (יועד, 2.10.2026: ליבה · טווח ארוך · קריפטו · מסחר אקטיבי.)

   למעלה: פסק הדין על המסחר האקטיבי — נטו מול המדד, בטווח שבוחרים.
   באמצע: ארבע הקבוצות זו לצד זו. לחיצה על קבוצה = הניירות שלה, ושם
   אפשר להעביר נייר לקבוצה אחרת (נשמר ב-settings/strategy).
   למטה: היתרון של הקבוצה הפתוחה, חודש אחרי חודש.
   החישוב: engines/strategy.js (מעל engines/periods.js).
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, kpi, table, note, chip } from '../../ui/components.js';
import { usd, pct, day, todayIso, dirClass } from '../../core/format.js';
import { hrefOf, stockHref } from '../../core/routes.js';
import * as store from '../../core/store.js';
import { toast } from '../../ui/toast.js';
import { loadInvest, loadMarket, hasHistory, autoHistoryError } from './data.js';
import { dailyPnl } from '../../engines/periods.js';
import { strategy, verdictText, GROUPS } from '../../engines/strategy.js';
import { barChart } from '../../ui/charts.js';
import { BENCHMARK } from '../../config.js';
import { compareSymbols } from '../../engines/compare.js';

const PRESETS = [['1M', 'חודש'], ['2M', 'חודשיים'], ['3M', '3 חודשים'], ['YTD', 'מתחילת השנה'], ['1Y', 'שנה'], ['ALL', 'הכל']];
const st = { portfolio: 'all', preset: 'YTD', from: '', to: '', open: 'active', bench: null };
/* המדד להשוואה (יועד, 2.10.2026: "אסטרטגיה" — מול QQQ במקום מול IVV, למשל).
   ברירת מחדל IVV. הבחירה נזכרת במכשיר — נוחות, לא נתון. */
const BENCH_KEY = 'strategy:bench';
try { st.bench = localStorage.getItem(BENCH_KEY); } catch (e) { /* חסום — ברירת מחדל */ }
const bench = () => st.bench || BENCHMARK;
let cache = { key: '', D: null };
let settings = null;                                   // המסמך settings/strategy, או null

export async function render(el, ctx) {
  mount(el, head(), loading('kpis'), loading('card'));
  let inv, market;
  try { [inv, market, settings] = await Promise.all([loadInvest(), loadMarket(), store.get('settings', 'strategy')]); }
  catch (e) { mount(el, head(), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  if (!inv.docs.length) { mount(el, head(), emptyState({ title: 'אין עדיין תנועות', text: 'האסטרטגיה נמדדת מהתנועות ומהמחירים.', actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'upload') }, 'לקליטת קובץ')] })); return; }
  if (!hasHistory(market)) {
    mount(el, head(), emptyState({ title: `אין היסטוריית מחירים של ${BENCHMARK}`, text: `בלי הסגירות היומיות אי אפשר לדעת מה המדד היה עושה באותם ימים.${autoHistoryError ? ` המשיכה האוטומטית נכשלה: ${autoHistoryError}.` : ''} אפשר למשוך ידנית במסך המיגרציה.`, actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'migrate') }, 'למשיכת היסטוריה')] }));
    return;
  }
  draw(el, inv, market);
}

function head(tools) {
  return h('div', { class: 'world-head' }, h('h1', null, 'אסטרטגיה'), tools || h('span', { class: 'question' }, 'האם כל חלק בתיק עושה את העבודה שלו'));
}

const seg = (label, items, cur, onPick) => h('div', { class: 'seg', role: 'group', 'aria-label': label },
  items.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(cur === v), onclick: () => onPick(v) }, t)));

function rangeOf(preset, last) {
  const d = new Date(`${last}T00:00:00Z`);
  if (preset === 'ALL') return '0000-00-00';
  if (preset === 'YTD') return `${last.slice(0, 4)}-01-01`;
  d.setUTCMonth(d.getUTCMonth() - ({ '1M': 1, '2M': 2, '3M': 3, '1Y': 12 }[preset]));
  return d.toISOString().slice(0, 10);
}

const money = v => usd(v, { sign: true, digits: 0 });
const worthChip = g => chip(g.worth ? 'שווה' : 'לא שווה', g.worth ? 'up' : 'down');

function draw(el, inv, market) {
  const redraw = () => draw(el, inv, market);
  const rows = st.portfolio === 'all' ? inv.rows : inv.rows.filter(r => r.Portfolio === st.portfolio);
  const key = `${st.portfolio}|${inv.docs.length}|${Object.keys(market.history).length}`;
  if (cache.key !== key) {
    try { cache = { key, D: dailyPnl(rows, market.history, {}) }; }
    catch (e) { mount(el, head(), errorState({ title: 'החישוב נכשל', error: e })); return; }
  }
  const D = cache.D;
  const lastDay = D.days.length ? D.days[D.days.length - 1].date : todayIso();
  const from = st.preset ? rangeOf(st.preset, lastDay) : (st.from || '0000-00-00');
  const to = st.preset ? lastDay : (st.to || lastDay);
  const map = (settings && settings.map) || null;
  if (!compareSymbols(market.history).includes(bench())) st.bench = null;   // נייר שנבחר ואין לו היסטוריה — חזרה ל-IVV
  let A;
  try { A = strategy(D.days, market.history, rows, { from, to, map, bench: bench() }); }
  catch (e) { mount(el, head(), errorState({ title: 'החישוב נכשל', error: e })); return; }

  /* ── כלים ── */
  const fromIn = h('input', { type: 'date', value: from > '0000-00-00' ? from : (D.days[0] && D.days[0].date) || '', 'aria-label': 'מתאריך' });
  const toIn = h('input', { type: 'date', value: to, 'aria-label': 'עד תאריך' });
  const onDates = () => { st.preset = ''; st.from = fromIn.value; st.to = toIn.value; redraw(); };
  fromIn.addEventListener('change', onDates); toIn.addEventListener('change', onDates);
  const tools = seg('תיק', [['all', 'כל התיקים'], ...inv.portfolios.map(p => [p, p])], st.portfolio, v => { st.portfolio = v; redraw(); });
  const benchSel = h('select', { class: 'cmp-add', style: { borderStyle: 'solid' }, 'aria-label': 'מדד להשוואה' },
    compareSymbols(market.history).map(sym => h('option', { value: sym, selected: sym === bench() }, sym)));
  benchSel.addEventListener('change', () => { st.bench = benchSel.value; try { localStorage.setItem(BENCH_KEY, st.bench); } catch (e) { /* לא נזכר */ } redraw(); });
  const rangeBar = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
    seg('טווח', PRESETS, st.preset, v => { st.preset = v; redraw(); }),
    h('span', { class: 'small muted' }, 'או:'), fromIn, h('span', { class: 'small muted' }, '→'), toIn,
    h('span', { class: 'small muted', style: { marginInlineStart: '8px' } }, 'מול:'), benchSel);

  if (!A.days) { mount(el, head(tools), rangeBar, emptyState({ title: 'אין ימי מסחר בטווח הזה', text: 'אפשר לבחור טווח אחר.' })); return; }

  const g = id => A.groups.find(x => x.id === id);
  const act = g('active');
  const span = `${day(A.from)} → ${day(A.to)}`;

  /* ── פסק הדין: המסחר האקטיבי ── */
  const hasAct = act.symbols.length > 0;
  const verdict = !hasAct
    ? note('לא היה מסחר אקטיבי בטווח הזה.', { kind: 'info' })
    : h('div', { class: `verdict ${act.worth ? 'good' : 'bad'}` },
      h('span', { class: 'mark', 'aria-hidden': 'true' }, act.worth ? '✓' : '✗'),
      h('b', null, act.worth ? `המסחר האקטיבי הכה את ${bench()}` : `המסחר האקטיבי לא הכה את ${bench()}`),
      h('p', null, `${span}: ${verdictText(act, bench())}`));

  const strip = h('div', { class: 'strip' },
    kpi({ label: `מסחר אקטיבי מול ${bench()}`, value: hasAct ? money(act.edge) : '—', cls: dirClass(act.edge), ctx: hasAct ? `נטו ${money(act.pnl)} · המדד ${money(act.bench)}` : '' }),
    kpi({ label: 'עסקאות', value: String(act.trades), size: 'sm', ctx: `${act.buys} קניות · ${act.sells} מכירות · ${act.symbols.length} ניירות` }),
    kpi({ label: 'עמלות על המסחר', value: usd(act.fees, { digits: 0 }), size: 'sm', ctx: act.trades ? `${usd(act.fees / act.trades, { digits: 1 })} לעסקה · כבר בתוך הנטו` : '' }),
    kpi({ label: 'הון ממוצע במסחר', value: usd(act.avgCap, { digits: 0 }), size: 'sm', ctx: act.ret === null ? '' : `${pct(act.ret * 100)} תשואה עליו` }),
    kpi({ label: 'כל התיק', value: money(A.total.pnl), size: 'sm', cls: dirClass(A.total.pnl), ctx: `מול המדד: ${money(A.total.edge)}` }));

  /* ── ארבע הקבוצות ── */
  const tbl = table({
    columns: [
      { key: 'g', label: 'חלק', render: x => h('span', null, h('b', null, x.label), ' ', h('span', { class: 'small muted' }, x.symbols.length ? x.symbols.map(s => s.symbol).slice(0, 4).join(' · ') + (x.symbols.length > 4 ? ` +${x.symbols.length - 4}` : '') : 'אין ניירות')) },
      { key: 'edge', label: 'יתרון', num: true, render: x => num(money(x.edge), dirClass(x.edge)) },
      { key: 'v', label: 'שווה?', render: x => (x.symbols.length ? worthChip(x) : null) },
      { key: 'w', label: 'משקל היום', num: true, render: x => num(x.weight === null ? '—' : pct(x.weight * 100, { sign: false, digits: 0 })) },
      { key: 'cap', label: 'הון ממוצע', num: true, render: x => num(usd(x.avgCap, { digits: 0 })) },
      { key: 'pnl', label: 'רווח נטו', num: true, render: x => num(money(x.pnl), dirClass(x.pnl)) },
      { key: 'bench', label: `אותו כסף ב-${bench()}`, num: true, render: x => num(money(x.bench), dirClass(x.bench)) },
      { key: 'tr', label: 'עסקאות', num: true, render: x => num(String(x.trades)) },
    ],
    rows: A.groups,
    onRow: x => { st.open = st.open === x.id ? '' : x.id; redraw(); },
  });
  /* הפירוט של הקבוצה הפתוחה — שורה מתחת לשורה שלה */
  const openG = st.open ? g(st.open) : null;
  if (openG) {
    const tr = tbl.querySelector(`tr[data-key="${openG.id}"]`);
    if (tr) { tr.classList.add('expanded'); tr.after(h('tr', { class: 'detail' }, h('td', { colspan: '8' }, detail(openG, redraw)))); }
  }

  /* ── לפי חודש ── */
  const chartG = openG && openG.months.length ? openG : (act.months.length ? act : null);
  const chartBox = h('div', { class: 'stock-chart', style: { minHeight: '220px' } });
  if (chartG) {
    setTimeout(() => barChart(chartBox, { bars: chartG.months.map(m => ({ time: `${m.key}-01`, value: m.edge })), format: v => '$' + Math.round(v).toLocaleString('en-US'), height: 220 })
      .catch(e => mount(chartBox, note(`הגרף לא נטען: ${e.message || e}`, { kind: 'bad' }))), 0);
  }

  const notes = [];
  if (A.benchMissing) notes.push(note(`ב-${A.benchMissing} ימים חסרה סגירה של ${bench()}, ולכן "אותו כסף במדד" חסר בהם. היתרון בטווח הזה לא שלם.`, { kind: 'attn' }));
  if (A.fallbackDays) notes.push(note(`ב-${A.fallbackDays} ימים היה נייר בלי מחיר סגירה, והוא הוערך לפי מחיר העסקה האחרונה בו.`, { kind: 'info' }));

  mount(el, head(tools), rangeBar, verdict, strip, ...notes,
    h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, 'ארבעת החלקים'), h('span', { class: 'chart-note' }, 'לחיצה = הניירות של החלק')), h('div', { class: 'panel-b flush' }, tbl)),
    chartG ? h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, `${chartG.label}: יתרון מול ${bench()} לפי חודש`)), h('div', { class: 'panel-b' }, chartBox,
      h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'עמודה ירוקה = בחודש הזה החלק הזה עשה יותר מהמדד על אותו כסף. אדומה = המדד עשה יותר.'))) : null,
    Math.abs(A.total.other) >= 0.5 ? h('p', { class: 'small muted' }, `לא מיוחס לאף חלק: ${money(A.total.other)} (דיבידנדים, מס, ריבית ודמי טיפול). הפירוט ב"מס ועמלות".`) : null,
    h('p', { class: 'small muted' }, `איך זה מחושב: רווח נטו = השינוי בשווי הניירות של החלק + מכירות − קניות, כולל עמלות. "אותו כסף ב-${bench()}" = בכל יום, השווי שהיה מושקע בנייר בתחילת היום כפול התשואה של ${bench()} באותו יום. עסקה שנפתחה ונסגרה באותו יום לא "ישנה" במדד, ולכן המדד שלה אפס. מס לא נכלל (הוא מחושב לכל תיק ושנה). נייר שייך לחלק אחד לכל אורך הטווח — גם אם פעם החזקת בו ועכשיו אתה סוחר בו.`));
}

/* הניירות של קבוצה, עם אפשרות להעביר נייר לקבוצה אחרת */
function detail(G, redraw) {
  if (!G.symbols.length) return h('p', { class: 'small muted' }, 'אין ניירות בחלק הזה בטווח שנבחר.');
  const pick = s => {
    const sel = h('select', { class: 'btn sm', 'aria-label': `החלק של ${s.symbol}` }, GROUPS.map(x => h('option', { value: x.id, selected: x.id === s.group }, x.label)));
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', async () => {
      const next = { ...((settings && settings.map) || {}), [s.symbol]: sel.value };
      sel.disabled = true;
      try {
        await store.put('settings', 'strategy', { map: next }, { isNew: !settings });
        settings = { ...(settings || {}), map: next };
        toast(`${s.symbol} עבר ל"${GROUPS.find(x => x.id === sel.value).label}"`);
        redraw();
      } catch (e) { sel.disabled = false; sel.value = s.group; toast(`השמירה נכשלה: ${e.message || e}`); }
    });
    return sel;
  };
  return h('div', { style: { display: 'grid', gap: '8px' } },
    h('div', { class: 'eyebrow' }, `${G.label} · ${G.hint}`),
    table({
      columns: [
        { key: 's', label: 'נייר', render: s => h('a', { href: stockHref(s.symbol), class: 'sym' }, s.symbol) },
        { key: 'edge', label: 'יתרון', num: true, render: s => num(money(s.edge), dirClass(s.edge)) },
        { key: 'pnl', label: 'רווח נטו', num: true, render: s => num(money(s.pnl), dirClass(s.pnl)) },
        { key: 'bench', label: `ב-${bench()}`, num: true, render: s => num(money(s.bench), dirClass(s.bench)) },
        { key: 'tr', label: 'עסקאות', num: true, render: s => num(String(s.trades)) },
        { key: 'fee', label: 'עמלות', num: true, render: s => num(usd(s.fees, { digits: 0 })) },
        { key: 'grp', label: 'חלק', render: pick },
      ],
      rows: G.symbols.map(s => ({ ...s, id: s.symbol })),
    }));
}
