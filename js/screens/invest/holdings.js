/* ================================================================
   HOLDINGS — "מה יש לי, כמה זה שווה, ואיך זה זז".

   למעלה רצועת מדדים (עלות · שווי · רווח לא ממומש · ממומש · מול IVV),
   באמצע הגרף הראשי וחלוקת התיק, ולמטה טבלת רשימת מעקב בסגנון Koyfin:
   נייר · תיק · כמות · עלות ממוצעת · מחיר · שינוי יומי · 90 יום · שווי
   · רווח · משקל. לחיצה על שורה פותחת את פרוסות ה-FIFO עד שורת המקור.

   מחיר: מגיליון המחירים (market/latest); אם אין — הסגירה האחרונה
   בהיסטוריה, עם התאריך שלה. בלי שניהם — מקף, לא ניחוש.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, kpi, table, note } from '../../ui/components.js';
import { allocation, sparkline } from '../../ui/charts.js';
import { usd, qty as fq, pct, day, dirClass } from '../../core/format.js';
import { hrefOf } from '../../core/routes.js';
import { loadInvest, loadMarket } from './data.js';
import { investChartPanel } from './chartPanel.js';
import { lastCloses } from '../../engines/series.js';
import { efficiency } from '../../engines/efficiency.js';
import { groupBySymbol } from '../../engines/holdingsGroup.js';
import * as liveApi from '../../core/live.js';
import { BENCHMARK } from '../../config.js';

let filter = 'all';
let allocBy = 'symbol';

export async function render(el, ctx) {
  mount(el, head(ctx), loading('kpis'), loading('card'), loading('table'));
  let inv, market, live;
  try {
    [inv, market, live] = await Promise.all([loadInvest(), loadMarket(), liveApi.ready()]);
  } catch (e) {
    mount(el, head(ctx), errorState({ error: e, onRetry: () => render(el, ctx) }));
    return;
  }
  if (!inv.docs.length) {
    mount(el, head(ctx), emptyState({
      title: 'אין עדיין תנועות השקעה במסד',
      text: 'האחזקות מחושבות מהתנועות. הן יועברו מהגיליון הישן בשלב 2 — מיגרציה חד-פעמית עם בדיקה מול דוח הברוקר.',
      actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'migrate') }, 'למסך המיגרציה')],
    }));
    return;
  }
  draw(el, ctx, inv, market, live);
}

function head(ctx) {
  return h('div', { class: 'world-head' }, h('h1', null, 'אחזקות'), h('span', { class: 'question' }, ctx.world.question));
}

function priceOf(sym, live, market) {
  const p = live && live.data && live.data.prices && live.data.prices[sym];
  if (p && isFinite(p.price)) return { price: p.price, asOf: p.asOf, change: p.changePct, src: p.src };
  const hist = market.history[sym];
  if (hist && hist.length) {
    const lastRow = hist[hist.length - 1], prev = hist[hist.length - 2];
    return { price: lastRow.close, asOf: lastRow.date, change: prev ? (lastRow.close / prev.close - 1) * 100 : null };
  }
  return null;
}

/* הפוזיציות עם המחיר הנוכחי. נקרא בכל ציור, וגם בכל עדכון מחיר חי. */
function computePos(inv, market, live) {
  const pos = inv.positions.filter(p => filter === 'all' || p.portfolio === filter).map(p => {
    const pr = priceOf(p.symbol, live, market);
    const value = pr ? p.qty * pr.price : null;
    return { ...p, id: `${p.portfolio}|${p.symbol}`, price: pr ? pr.price : null, priceAsOf: pr && pr.asOf, change: pr ? pr.change : null, priceSrc: pr && pr.src,
      value, pnl: value === null ? null : value - p.totalCost, spark: lastCloses(market.history[p.symbol]) };
  });
  const totalCost = pos.reduce((s, p) => s + p.totalCost, 0);
  const allPriced = pos.every(p => p.value !== null);
  const totalValue = allPriced ? pos.reduce((s, p) => s + p.value, 0) : null;
  pos.forEach(p => { p.weight = totalValue ? (p.value / totalValue) * 100 : (p.totalCost / totalCost) * 100; });
  pos.sort((a, b) => (b.value ?? b.totalCost) - (a.value ?? a.totalCost));
  return { pos, totalCost, allPriced, totalValue };
}

let unsubLive = null;

function draw(el, ctx, inv, market, live) {
  const rows = filter === 'all' ? inv.rows : inv.rows.filter(r => r.Portfolio === filter);
  const { pos, totalCost, allPriced, totalValue } = computePos(inv, market, live);
  const realized = pos.reduce((s, p) => s + p.realizedPnl, 0);

  let eff = null;
  try { if (market.history[BENCHMARK]) eff = efficiency(rows, market.history, { bench: BENCHMARK, fx: market.fx }); } catch (e) { eff = null; }

  const filters = h('div', { class: 'seg', role: 'group', 'aria-label': 'תיק' },
    ['all', ...inv.portfolios].map(p => h('button', { type: 'button', 'aria-pressed': String(filter === p), onclick: () => { filter = p; draw(el, ctx, inv, market, live); } }, p === 'all' ? 'כל התיקים' : p)));

  const buildStrip = ({ pos, totalCost, allPriced, totalValue }) => {
  const costTrace = {
    title: 'עלות האחזקות הפתוחות', total: totalCost, totalText: usd(totalCost),
    formula: 'סכום על כל הפוזיציות הפתוחות: כמות בכל פרוסת FIFO פתוחה × מחיר הקנייה שלה. עמלות לא בעלות — הן נספרות בנפרד.',
    parts: pos.map(p => ({ label: `${p.symbol} · ${p.portfolio}`, src: `${p.lots.length} פרוסות פתוחות`, valueText: usd(p.totalCost) })),
    partsSum: totalCost,
  };
  const valueTrace = totalValue === null ? null : {
    title: 'שווי שוק', total: totalValue, totalText: usd(totalValue),
    formula: 'כמות × המחיר האחרון, לכל נייר. המחיר מגיליון המחירים, או הסגירה האחרונה בהיסטוריה.',
    parts: pos.map(p => ({ label: `${p.symbol} · ${fq(p.qty)} × ${usd(p.price, { digits: 2 })}`, src: p.priceAsOf ? `מחיר מ-${day(p.priceAsOf)}` : '', valueText: usd(p.value) })),
    partsSum: pos.reduce((s, p) => s + (p.value || 0), 0),
  };
  const unreal = totalValue === null ? null : totalValue - totalCost;

  const strip = h('div', { class: 'strip' },
    kpi({ label: 'שווי', value: totalValue === null ? '—' : usd(totalValue), trace: valueTrace, ctx: allPriced ? `${pos.length} פוזיציות` : 'חסרים מחירים' }),
    kpi({ label: 'עלות', value: usd(totalCost), size: 'sm', trace: costTrace }),
    kpi({ label: 'רווח לא ממומש', value: unreal === null ? '—' : usd(unreal, { sign: true }), size: 'sm', cls: dirClass(unreal), ctx: unreal === null ? null : pct((unreal / totalCost) * 100) }),
    kpi({ label: 'רווח ממומש', value: usd(realized, { sign: true }), size: 'sm', cls: dirClass(realized), ctx: 'מפרוסות שנסגרו' }),
    kpi({ label: `יתרון מול ${BENCHMARK}`, value: eff ? usd(eff.total.edge, { sign: true }) : '—', size: 'sm', cls: eff ? dirClass(eff.total.edge) : '',
      ctx: eff ? (eff.total.worth ? 'הבחירות הכו את המדד' : 'המדד היה עושה יותר') : 'דרוש מחיר היסטורי של המדד' }));
  return strip;
  };
  let strip = buildStrip({ pos, totalCost, allPriced, totalValue });

  const allocSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'חלוקה לפי' },
    [['symbol', 'נייר'], ['portfolio', 'תיק']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(allocBy === k), onclick: () => { allocBy = k; draw(el, ctx, inv, market, live); } }, l)));
  /* אותו נייר בשני תיקים = שורה אחת בחלוקה לפי נייר */
  const groupBy = key => Object.values(pos.reduce((m, p) => { const k = p[key]; m[k] = m[k] || { label: k, value: 0 }; m[k].value += p.value ?? p.totalCost; return m; }, {})).map(x => ({ ...x, text: usd(x.value) }));
  const allocParts = groupBy(allocBy);
  const allocPanel = h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, totalValue === null ? 'חלוקה לפי עלות' : 'חלוקה לפי שווי'), h('div', { class: 'tools' }, allocSeg)),
    h('div', { class: 'panel-b' }, allocation(allocParts, { max: 9 })));

  const warn = live && live.refreshError ? note(`המחירים לא רועננו: ${live.refreshError}.`, { kind: 'info' }) : null;

  /* "כל התיקים": שורה אחת לנייר (סכום על כל התיקים), ולחיצה פותחת שורת
     פירוט לכל תיק. תיק אחד: כמו קודם — שורה לנייר, לחיצה פותחת פרוסות. */
  const grouped = filter === 'all';
  const listRows = grouped ? groupBySymbol(pos) : pos;
  const isGroup = p => !!p.children;
  const multi = p => isGroup(p) && p.children.length > 1;
  const columns = [
      { key: 'symbol', label: 'נייר', render: p => (p.sub ? h('span', { class: 'muted sub-mark' }, '↳') : h('span', { class: 'sym' }, p.symbol)) },
      { key: 'portfolio', label: 'תיק', render: p => h('span', { class: 'muted' },
        multi(p) ? `${p.children.length} תיקים ▾` : isGroup(p) ? p.children[0].portfolio : p.portfolio) },
      { key: 'qty', label: 'כמות', num: true, render: p => num(fq(p.qty)) },
      { key: 'avg', label: 'עלות ממוצעת', num: true, render: p => num(usd(p.avgCost, { digits: 2 })) },
      { key: 'price', label: 'מחיר', num: true, render: p => liveCell(p, 'price') },
      { key: 'change', label: 'יומי', num: true, render: p => liveCell(p, 'change') },
      { key: 'spark', label: '90 יום', render: p => (p.spark.length > 1 ? sparkline(p.spark) : h('span', { class: 'muted' }, '—')) },
      { key: 'value', label: 'שווי', num: true, render: p => liveCell(p, 'value') },
      { key: 'pnl', label: 'רווח', num: true, render: p => liveCell(p, 'pnl') },
      { key: 'pnlPct', label: '%', num: true, render: p => liveCell(p, 'pnlPct') },
      { key: 'weight', label: 'משקל', num: true, render: p => num(pct(p.weight, { sign: false })) },
  ];
  /* פרוסות FIFO — תמיד של תיק אחד (פוזיציה אמיתית של המנוע). */
  const toggleLots = (p, tr) => {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('detail')) { next.remove(); tr.classList.remove('expanded'); return; }
    tr.parentElement.querySelectorAll('tr.detail').forEach(x => x.remove());
    tr.parentElement.querySelectorAll('tr.expanded').forEach(x => x.classList.remove('expanded'));
    tr.classList.add('expanded');
    tr.after(h('tr', { class: 'detail' }, h('td', { colspan: String(columns.length) }, lotsPanel(p, inv))));
  };
  const subRow = c => {
    const r = { ...c, sub: true };
    const tr = h('tr', { class: 'sub clickable', dataset: { key: c.id } }, columns.map(col => h('td', { class: col.num ? 'num' : '' }, col.render ? col.render(r) : r[col.key])));
    tr.addEventListener('click', e => { e.stopPropagation(); toggleLots(c, tr); });
    return tr;
  };
  const tbl = table({
    columns,
    rows: listRows,
    onRow: (p, tr) => {
      if (!multi(p)) { toggleLots(isGroup(p) ? p.children[0] : p, tr); return; }
      const open = tr.classList.contains('open');
      /* סוגרים את הפירוט של הנייר הזה (שורות תיק + פרוסות פתוחות) */
      let n = tr.nextElementSibling;
      while (n && (n.classList.contains('sub') || n.classList.contains('detail'))) { const x = n.nextElementSibling; n.remove(); n = x; }
      tr.classList.toggle('open', !open);
      if (!open) tr.after(...p.children.map(subRow));
    },
  });

  mount(el,
    h('div', { class: 'world-head' }, h('h1', null, 'אחזקות'), filters),
    strip, warn,
    h('div', { class: 'grid main-side' }, investChartPanel({ inv: filter === 'all' ? inv : { ...inv, rows }, market, height: 290 }), allocPanel),
    h('section', { class: 'panel' },
      h('div', { class: 'panel-h' }, h('h2', null, grouped ? `רשימת אחזקות · ${listRows.length} ניירות · ${pos.length} פוזיציות` : `רשימת אחזקות · ${pos.length}`), h('span', { class: 'chart-note' }, `תנועה אחרונה במסד: ${day(inv.lastDate)}`)),
      h('div', { class: 'panel-b flush' }, tbl)));

  /* מחירים חיים: כל עדכון מחשב מחדש את הפוזיציות ומחליף רק את
     רצועת המדדים ואת תאי המחיר/שווי/רווח — הגרף והטבלה לא נבנים
     מחדש, ופאנל פרוסות פתוח נשאר פתוח. */
  liveApi.prioritize(pos.map(p => p.symbol));
  if (unsubLive) unsubLive();
  let first = true;
  unsubLive = liveApi.subscribe(snap => {
    if (first) { first = false; return; }            // התמונה הראשונה כבר מצוירת
    if (!el.isConnected || !strip.isConnected) { if (unsubLive) { unsubLive(); unsubLive = null; } return; }
    const next = computePos(inv, market, snap);
    const ns = buildStrip(next);
    strip.replaceWith(ns);
    strip = ns;
    /* גם שורות הנייר המאוחדות וגם שורות התיק (אם פתוחות) */
    const cells = filter === 'all' ? [...groupBySymbol(next.pos), ...next.pos] : next.pos;
    cells.forEach(p => ['price', 'change', 'value', 'pnl', 'pnlPct'].forEach(f => {
      const cell = el.querySelector(`[data-live="${CSS.escape(`${p.id}|${f}`)}"]`);
      if (!cell) return;
      const fresh = liveCell(p, f);
      if (f === 'price' && cell.textContent !== fresh.textContent) {
        const tr = cell.closest('tr');
        const up = (p.price || 0) >= Number(cell.dataset.v || 0);
        if (tr) { tr.classList.remove('flash-up', 'flash-down'); void tr.offsetWidth; tr.classList.add(up ? 'flash-up' : 'flash-down'); }
      }
      cell.replaceWith(fresh);
    }));
  });
}

/* תא שמתעדכן חי. data-live מזהה אותו, data-v שומר את הערך הקודם. */
function liveCell(p, f) {
  let text, cls = '';
  if (f === 'price') text = p.price === null ? '—' : usd(p.price, { digits: 2 });
  else if (f === 'change') { text = p.change === null || p.change === undefined ? '—' : pct(p.change, { digits: 2 }); cls = dirClass(p.change); }
  else if (f === 'value') text = p.value === null ? '—' : usd(p.value);
  else if (f === 'pnl') { text = p.pnl === null ? '—' : usd(p.pnl, { sign: true }); cls = dirClass(p.pnl); }
  else { text = p.pnl === null ? '—' : pct((p.pnl / p.totalCost) * 100); cls = dirClass(p.pnl); }
  const n = num(text, `${cls}${p.priceSrc === 'live' && f === 'price' ? ' is-live' : ''}`.trim());
  n.dataset.live = `${p.id}|${f}`;
  if (f === 'price' && p.price !== null) n.dataset.v = String(p.price);
  return n;
}

/* פרוסות FIFO פתוחות + שורות המקור שלהן */
function lotsPanel(p, inv) {
  const buys = inv.rows.filter(r => r.Portfolio === p.portfolio && String(r.Symbol).toUpperCase() === p.symbol && r.subCategory === 'BUY_STOCK');
  return h('div', { style: { display: 'grid', gap: '8px', maxHeight: '340px', overflowY: 'auto' } },
    h('div', { class: 'eyebrow' }, `${p.lots.length} פרוסות פתוחות · ${p.symbol} · ${p.portfolio}`),
    table({
      columns: [
        { key: 'date', label: 'תאריך קנייה', render: l => num(day(l.date)) },
        { key: 'qty', label: 'כמות פתוחה', num: true, render: l => num(fq(l.qty)) },
        { key: 'cps', label: 'מחיר קנייה', num: true, render: l => num(usd(l.costPerShare, { digits: 2 })) },
        { key: 'cost', label: 'עלות', num: true, render: l => num(usd(l.qty * l.costPerShare)) },
        { key: 'now', label: 'שווי היום', num: true, render: l => num(p.price === null ? '—' : usd(l.qty * p.price)) },
        { key: 'gain', label: 'רווח', num: true, render: l => (p.price === null ? '—' : num(pct((p.price / l.costPerShare - 1) * 100), dirClass(p.price - l.costPerShare))) },
        { key: 'src', label: 'מקור', render: l => {
          const src = buys.filter(b => b.Date === l.date).map(b => b._src && b._src.sheetRow).filter(Boolean);
          return src.length ? `גיליון, שורה ${src.join(', ')}` : '—';
        } },
      ],
      rows: p.lots.map((l, i) => ({ ...l, id: i })),
    }));
}
