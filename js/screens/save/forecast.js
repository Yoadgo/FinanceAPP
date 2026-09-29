/* ================================================================
   FORECAST — לאן החסכונות מגיעים. כל הקופות בגרף אחד, שלושה
   תרחישים, ואופק לבחירה. התחזית תמיד מסומנת כתחזית.
   החישוב: engines/forecast.js.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, table, chip, kpi } from '../../ui/components.js';
import { timeChart, legend, PALETTE } from '../../ui/charts.js';
import { ils, todayIso } from '../../core/format.js';
import { projectPot, projectAll, reachesTarget, annuity, KIND_LABEL } from '../../engines/forecast.js';
import * as store from '../../core/store.js';
import { hrefOf } from '../../core/routes.js';

const SCEN = ['זהיר', 'בסיס', 'אופטימי'];
const HORIZONS = [['5 שנים', 5], ['10 שנים', 10], ['20 שנים', 20], ['30 שנים', 30]];
const state = { scenario: 1, years: 10, factor: 200 };

export async function render(el) {
  mount(el, head(), loading('card'));
  let pots;
  try { pots = await store.list('pots'); } catch (e) { mount(el, head(), errorState({ error: e, onRetry: () => render(el) })); return; }
  if (!pots.length) {
    mount(el, head(), emptyState({ title: 'אין קופות לתחזית', text: 'התחזית נבנית מהקופות: יתרה, הפקדה חודשית ותשואה. מוסיפים אותן במסך הקופות.', actions: [h('a', { class: 'btn primary', href: hrefOf('save', 'funds') }, 'להוספת קופה')] }));
    return;
  }
  draw(el, pots);
}

function head(tools) {
  return h('div', { class: 'world-head' }, h('h1', null, 'תחזית'), tools || h('span', { class: 'question' }, 'לאן זה מגיע — בשקלים של היום'));
}

const monthKey = m => `${m}-01`;
const addYears = (ym, y) => `${Number(ym.slice(0, 4)) + y}${ym.slice(4, 7)}`;

async function draw(el, pots) {
  const start = todayIso().slice(0, 7);
  const until = addYears(start, state.years);
  const seg = (items, cur, onPick) => h('div', { class: 'seg', role: 'group' }, items.map(([l, v]) =>
    h('button', { type: 'button', 'aria-pressed': String(v === cur), onclick: () => { onPick(v); draw(el, pots); } }, l)));
  const tools = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    seg(SCEN.map((l, i) => [l, i]), state.scenario, v => { state.scenario = v; }),
    seg(HORIZONS, state.years, v => { state.years = v; }));

  const all = projectAll(pots, { scenario: state.scenario, until });
  const end = all[all.length - 1];
  const today = pots.reduce((s, p) => s + (Number(p.balance) || 0), 0);
  const deposits = pots.reduce((s, p) => s + (Number(p.monthly) || 0), 0) * 12 * state.years;
  const byScenario = [0, 1, 2].map(sc => projectAll(pots, { scenario: sc, until }).slice(-1)[0].total);

  const strip = h('div', { class: 'strip' },
    kpi({ label: 'היום', value: ils(today, { digits: 0 }) }),
    kpi({ label: `בעוד ${state.years} שנים · ${SCEN[state.scenario]}`, value: ils(end.total, { digits: 0 }), cls: 'forecast',
      trace: { title: `תחזית לעוד ${state.years} שנים`, total: end.total, totalText: ils(end.total, { digits: 0 }),
        formula: 'לכל קופה, חודש אחר חודש: יתרה × (1 + תשואה חודשית − דמי ניהול מצבירה) + הפקדה × (1 − דמי ניהול מהפקדה). תשואה ריאלית — התוצאה בשקלים של היום.',
        parts: pots.map(p => ({ label: p.name, src: KIND_LABEL[p.kind], valueText: ils(end.byPot[p.id], { digits: 0 }) })), partsSum: end.total } }),
    kpi({ label: 'מתוכם הפקדות', value: ils(deposits, { digits: 0 }), size: 'sm', ctx: 'השאר — תשואה' }),
    kpi({ label: 'טווח התרחישים', value: `₪${(byScenario[0] / 1e6).toFixed(2)}M–${(byScenario[2] / 1e6).toFixed(2)}M`, size: 'sm', ctx: 'זהיר עד אופטימי' }));

  const chartBox = h('div', { class: 'chart lg' });
  const series = [
    { name: 'סה"כ', color: '--s-1', kind: 'area', data: all.map(r => ({ time: monthKey(r.month), value: r.total })) },
    ...pots.map((p, i) => ({ name: p.name, color: PALETTE[(i + 1) % PALETTE.length], kind: 'line', data: all.map(r => ({ time: monthKey(r.month), value: r.byPot[p.id] || 0 })) })),
  ];

  const rows = pots.map(p => {
    const vals = [0, 1, 2].map(sc => { const s = projectPot(p, { scenario: sc, until: p.endDate && p.endDate < until ? p.endDate : until }); return s[s.length - 1].value; });
    return { ...p, vals, hit: reachesTarget(p, state.scenario) };
  });

  mount(el,
    head(tools),
    strip,
    h('section', { class: 'panel' },
      h('div', { class: 'panel-h' }, h('h2', null, 'צבירה צפויה'), chip('תחזית', 'attn')),
      h('div', { class: 'panel-b' }, legend(series.map(s => ({ label: s.name, color: s.color }))), chartBox)),
    h('section', { class: 'panel' },
      h('div', { class: 'panel-h' }, h('h2', null, 'לכל קופה'), h('span', { class: 'chart-note' }, `בעוד ${state.years} שנים, בשלושת התרחישים`)),
      h('div', { class: 'panel-b flush' }, table({
        columns: [
          { key: 'name', label: 'קופה', render: p => h('b', null, p.name) },
          { key: 'balance', label: 'היום', num: true, render: p => num(ils(Number(p.balance), { digits: 0 })) },
          { key: 'z', label: 'זהיר', num: true, render: p => num(ils(p.vals[0], { digits: 0 }), 'muted') },
          { key: 'b', label: 'בסיס', num: true, render: p => h('b', null, num(ils(p.vals[1], { digits: 0 }))) },
          { key: 'o', label: 'אופטימי', num: true, render: p => num(ils(p.vals[2], { digits: 0 }), 'muted') },
          { key: 'target', label: 'יעד', render: p => (p.target ? (p.hit ? chip(`מושג ב-${p.hit.split('-').reverse().join('/')}`, 'up') : chip('לא באופק', 'attn')) : '—') },
          { key: 'ann', label: 'קצבה חודשית', num: true, render: p => (p.kind === 'pension' ? num(ils(annuity(p.vals[state.scenario], state.factor), { digits: 0 })) : '') },
        ],
        rows,
      }))),
    h('p', { class: 'small muted' }, `קצבה = צבירה ÷ מקדם המרה (${state.factor}; בפועל לפי הקרן, גיל ומצב משפחתי). כל המספרים כאן תחזית, לא נתון מדוד.`));

  try { await timeChart(chartBox, { series, format: v => (v >= 1e6 ? `₪${(v / 1e6).toFixed(1)}M` : `₪${Math.round(v / 1000)}K`) }); }
  catch (e) { mount(chartBox, errorState({ title: 'הגרף לא נטען', error: e })); }
}
