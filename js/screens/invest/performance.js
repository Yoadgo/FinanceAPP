/* ================================================================
   PERFORMANCE — "האם ההשקעות שלי יעילות". (יועד, 29.9.2026)

   למעלה: פסק דין אחד לתיק כולו — שווה או לא, ובכמה.
   באמצע: הגרף — שווי התיק מול אותו כסף ב-IVV.
   למטה: טבלה לכל נייר — כניסות, ניצחונות/הפסדים, עמלות, נטו, מה
   IVV היה עושה על אותו כסף באותם ימים, והיתרון. ממוין מהגרוע לטוב,
   כי השאלה המעניינת היא "איפה הפסדתי מול המדד".

   החישוב: engines/efficiency.js (על בסיס Research.alpha מ-v3).
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, kpi, table, chip } from '../../ui/components.js';
import { usd, pct, dirClass } from '../../core/format.js';
import { hrefOf } from '../../core/routes.js';
import { loadInvest, loadMarket } from './data.js';
import { investChartPanel } from './chartPanel.js';
import { efficiency, verdictText } from '../../engines/efficiency.js';
import { BENCHMARK } from '../../config.js';

let filter = 'all';

export async function render(el, ctx) {
  mount(el, head(), loading('card'), loading('table'));
  let inv, market;
  try { [inv, market] = await Promise.all([loadInvest(), loadMarket()]); }
  catch (e) { mount(el, head(), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  if (!inv.docs.length) {
    mount(el, head(), emptyState({ title: 'אין עדיין תנועות', text: 'הניתוח נבנה מהתנועות אחרי המיגרציה.', actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'migrate') }, 'למיגרציה')] }));
    return;
  }
  if (!market.history[BENCHMARK]) {
    mount(el, head(), emptyState({
      title: `אין היסטוריית מחירים של ${BENCHMARK}`,
      text: 'כדי לדעת מה המדד היה עושה באותם ימים בדיוק, צריך את הסגירות היומיות שלו. הן נמשכות מגיליון המחירים במסך המיגרציה, בלחיצה אחת.',
      actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'migrate') }, 'למשיכת היסטוריה')],
    }));
    return;
  }
  draw(el, inv, market);
}

function head(tools) {
  return h('div', { class: 'world-head' }, h('h1', null, 'ביצועים מול מדד'), tools || h('span', { class: 'question' }, `האם הבחירות שלי שוות יותר מ-${BENCHMARK}`));
}

function draw(el, inv, market) {
  const rows = filter === 'all' ? inv.rows : inv.rows.filter(r => r.Portfolio === filter);
  let e;
  try { e = efficiency(rows, market.history, { bench: BENCHMARK, fx: market.fx }); }
  catch (err) { mount(el, head(), errorState({ title: 'החישוב נכשל', error: err })); return; }
  const t = e.total;

  const filters = h('div', { class: 'seg', role: 'group', 'aria-label': 'תיק' },
    ['all', ...inv.portfolios].map(p => h('button', { type: 'button', 'aria-pressed': String(filter === p), onclick: () => { filter = p; draw(el, inv, market); } }, p === 'all' ? 'כל התיקים' : p)));

  const verdict = h('div', { class: `verdict ${t.worth ? 'good' : 'bad'}` },
    h('span', { class: 'mark', 'aria-hidden': 'true' }, t.worth ? '✓' : '✗'),
    h('b', null, t.worth ? `הבחירות שלך הכו את ${BENCHMARK}` : `${BENCHMARK} היה עושה יותר`),
    h('p', null, verdictText(t, BENCHMARK)));

  const strip = h('div', { class: 'strip' },
    kpi({ label: 'נטו אחרי עמלות', value: usd(t.net, { sign: true }), cls: dirClass(t.net), size: 'sm',
      trace: { title: 'נטו אחרי עמלות', total: t.net, totalText: usd(t.net), formula: 'רווח ממומש + רווח לא ממומש, על כל פרוסות ה-FIFO, פחות כל העמלות.',
        parts: [{ label: 'רווח (ממומש + לא ממומש)', valueText: usd(t.pnl) }, { label: 'עמלות', valueText: usd(-t.commissions) }], partsSum: t.pnl - t.commissions } }),
    kpi({ label: `${BENCHMARK} על אותו כסף`, value: usd(t.benchPnl, { sign: true }), cls: dirClass(t.benchPnl), size: 'sm', ctx: 'באותם ימים בדיוק' }),
    kpi({ label: 'יתרון / פספוס', value: usd(t.edge, { sign: true }), cls: dirClass(t.edge), size: 'sm' }),
    kpi({ label: 'תשואה שנתית על ההון', value: t.annualPct === null ? '—' : pct(t.annualPct), size: 'sm', cls: dirClass(t.annualPct), ctx: `${BENCHMARK}: ${t.benchAnnualPct === null ? '—' : pct(t.benchAnnualPct)}` }),
    kpi({ label: 'אחוז עסקאות מרוויחות', value: t.winRate === null ? '—' : pct(t.winRate * 100, { sign: false, digits: 0 }), size: 'sm', ctx: `${t.wins} מתוך ${t.exits}` }),
    kpi({ label: 'עמלות', value: usd(t.commissions), size: 'sm', ctx: t.feeShare === null ? null : `${pct(t.feeShare * 100, { sign: false, digits: 0 })} מהרווח הגולמי` }));

  const tbl = table({
    columns: [
      { key: 'symbol', label: 'נייר', render: s => h('span', { class: 'sym' }, s.symbol) },
      { key: 'entries', label: 'כניסות', num: true, render: s => num(String(s.entries)) },
      { key: 'wl', label: 'רווח / הפסד', num: true, render: s => (s.exits ? num(`${s.wins} / ${s.losses}`) : h('span', { class: 'muted' }, 'פתוח')) },
      { key: 'commissions', label: 'עמלות', num: true, render: s => num(usd(s.commissions)) },
      { key: 'net', label: 'נטו', num: true, render: s => num(usd(s.net, { sign: true }), dirClass(s.net)) },
      { key: 'bench', label: `${BENCHMARK} היה`, num: true, render: s => num(usd(s.benchPnl, { sign: true }), 'muted') },
      { key: 'edge', label: 'יתרון', num: true, render: s => num(usd(s.edge, { sign: true }), dirClass(s.edge)) },
      { key: 'ann', label: 'שנתי', num: true, render: s => num(s.annualPct === null ? '—' : pct(s.annualPct, { digits: 0 }), dirClass(s.annualPct)) },
      { key: 'verdict', label: 'שווה?', render: s => chip(s.worth ? 'שווה' : 'לא שווה', s.worth ? 'up' : 'down') },
    ],
    rows: e.bySymbol.map(s => ({ ...s, id: s.symbol })),
    onRow: (s, tr) => {
      const next = tr.nextElementSibling;
      if (next && next.classList.contains('detail')) { next.remove(); tr.classList.remove('expanded'); return; }
      tr.parentElement.querySelectorAll('tr.detail').forEach(x => x.remove());
      tr.parentElement.querySelectorAll('tr.expanded').forEach(x => x.classList.remove('expanded'));
      tr.classList.add('expanded');
      tr.after(h('tr', { class: 'detail' }, h('td', { colspan: '9' }, h('div', { style: { display: 'grid', gap: '6px' } },
        h('b', null, verdictText(s, BENCHMARK)),
        h('span', { class: 'small muted' }, `${s.slices} פרוסות הון · החזקה ממוצעת ${Math.round(s.capitalDays / Math.max(1, s.cost))} ימים · רווח גולמי ${usd(s.grossWin)} · הפסד גולמי ${usd(-s.grossLoss)} · תיקים: ${s.portfolios.join(', ')}`)))));
    },
  });

  const skipped = e.skipped.noPrice.length + e.skipped.noBench.length + e.skipped.badData.length;
  mount(el,
    head(filters),
    verdict,
    strip,
    investChartPanel({ inv: { ...inv, rows }, market, height: 280 }),
    h('section', { class: 'panel' },
      h('div', { class: 'panel-h' }, h('h2', null, `לכל נייר · ${e.bySymbol.length}`), h('span', { class: 'chart-note' }, 'ממוין מהפספוס הגדול ליתרון הגדול · לחיצה על שורה = ההסבר')),
      h('div', { class: 'panel-b flush' }, tbl)),
    h('p', { class: 'small muted' },
      `איך זה מחושב: כל פרוסת הון (קנייה שנמכרה, או עדיין מוחזקת) מושווית למה ש-${BENCHMARK} עשה מיום הקנייה ועד יום המכירה (או עד היום). `,
      `"${BENCHMARK} היה" לא מנכה עמלה, ולכן ההשוואה נוטה מעט לטובת המסחר — נייר שמפסיד גם כך, מפסיד באמת.`,
      skipped ? ` ${skipped} פרוסות לא נכללו (חסר מחיר או תאריך).` : ''));
}
