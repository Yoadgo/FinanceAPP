/* ================================================================
   CHART PANEL — הגרף הראשי של עולם ההשקעות, משותף לבית, לאחזקות
   ולביצועים: שווי התיק · ההון שהושקע · אותו כסף ב-IVV.
   בורר טווח (1M · 3M · YTD · 1Y · 3Y · הכל) כמו ב-Koyfin.

   בלי היסטוריית מחירים (גיליון המחירים עוד לא נפרס) — אין קו שווי,
   ואומרים את זה. הקו של ההון שהושקע מצויר גם בלי מחירים: הוא נגזר
   מההפקדות ומהשערים בלבד.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading } from '../../ui/components.js';
import { timeChart, legend } from '../../ui/charts.js';
import { usd, pct, dirClass, todayIso } from '../../core/format.js';
import { investSeries } from '../../engines/series.js';
import { BENCHMARK } from '../../config.js';

const RANGES = [['1M', 1], ['3M', 3], ['YTD', 'ytd'], ['1Y', 12], ['3Y', 36], ['הכל', 0]];

function startOf(range, last) {
  if (!range) return '0000';
  const d = new Date(`${last}T00:00:00Z`);
  if (range === 'ytd') return `${last.slice(0, 4)}-01-01`;
  d.setUTCMonth(d.getUTCMonth() - range);
  return d.toISOString().slice(0, 10);
}

export function investChartPanel({ inv, market, title = 'שווי התיק מול המדד', height = 300, initial = 'הכל', compact = false }) {
  const body = h('div', { class: 'panel-b' }, loading('card'));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'טווח' });
  const panel = h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, title), h('div', { class: 'tools' }, seg)),
    body);

  let S;
  try {
    if (!inv.rows.length) { mount(body, emptyState({ title: 'אין עדיין תנועות', text: 'הגרף ייבנה מהתנועות אחרי המיגרציה (שלב 2).' })); return panel; }
    if (!market.fx.size) { mount(body, emptyState({ title: 'אין שערי דולר–שקל במסד', text: 'השערים נכתבים במסך המיגרציה. בלעדיהם אי אפשר להמיר הפקדות בשקלים לדולרים בשער של אותו יום.' })); return panel; }
    S = investSeries(inv.rows, market.history, market.fx, BENCHMARK);
  } catch (e) {
    mount(body, errorState({ title: 'הגרף לא חושב', error: e }));
    return panel;
  }

  const hasPrices = Object.values(market.history).some(a => a.length >= 200);
  const last = S.days[S.days.length - 1] || todayIso();
  let chart = null, current = initial;

  const draw = async () => {
    const from = startOf(RANGES.find(r => r[0] === current)[1], last);
    const cut = arr => arr.filter(p => p.time >= from);
    const series = [];
    if (hasPrices) series.push({ name: 'שווי התיק', color: '--s-1', kind: 'area', data: cut(S.value) });
    series.push({ name: 'ההון שהושקע', color: '--s-2', kind: 'line', dashed: true, data: cut(S.invested) });
    if (S.benchmark.length) series.push({ name: `אותו כסף ב-${BENCHMARK}`, color: '--s-3', kind: 'line', data: cut(S.benchmark) });

    const v = S.value.filter(p => p.time >= from), b = S.benchmark.filter(p => p.time >= from);
    const chg = arr => (arr.length > 1 ? arr[arr.length - 1].value - arr[0].value : null);
    const summary = h('div', { class: 'legend', style: { justifyContent: 'space-between' } },
      legend(series.map(s => ({ label: s.name, color: s.color, dashed: s.dashed }))),
      hasPrices && v.length > 1 ? h('span', null, 'בטווח: ', num(usd(chg(v), { sign: true }), dirClass(chg(v))),
        b.length > 1 ? h('span', { class: 'muted' }, ` · ${BENCHMARK} `, num(usd(chg(b), { sign: true }), dirClass(chg(b)))) : null) : null);
    const box = h('div', { class: 'chart', style: { height: `${height}px` } });
    mount(body, summary, box,
      hasPrices ? null : h('div', { class: 'chart-note' }, 'קו השווי יופיע כשגיליון המחירים יחובר ותימשך היסטוריית מחירים. בינתיים — ההון שהושקע בלבד.'));
    if (chart) { chart.remove(); chart = null; }
    try { chart = await timeChart(box, { series, format: v => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v.toFixed(0)}`) }); }
    catch (e) { mount(box, errorState({ title: 'הגרף לא נטען', error: e })); }
  };

  RANGES.forEach(([label]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(label === current) }, label);
    b.addEventListener('click', () => { current = label; [...seg.children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); });
    seg.append(b);
  });
  if (compact) seg.replaceChildren(...[...seg.children].filter(b => ['1Y', 'הכל'].includes(b.textContent)));
  draw();
  return panel;
}
