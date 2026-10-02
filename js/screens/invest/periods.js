/* ================================================================
   PERIODS — "כמה הרווחתי" ביום, בשבוע ובחודש, בטווח שבוחרים.
   (יועד, 1.10.2026: שינוי בשווי פחות הפקדות; דולר עם מתג לשקל.)

   למעלה: סך הרווח בטווח, התקופה הטובה והגרועה, כמה תקופות ברווח.
   באמצע: עמודות — ירוק רווח, אדום הפסד.
   למטה: טבלה, החדש למעלה. לחיצה על תקופה = ממה הרווח מורכב: כמה
   תרם כל נייר (עם קישור לכרטיס שלו), וכמה הכנסות והוצאות (דיבידנד,
   מס, ריבית).
   החישוב: engines/periods.js.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, kpi, table, note } from '../../ui/components.js';
import { usd, ils, pct, day, todayIso, dirClass } from '../../core/format.js';
import { hrefOf, stockHref } from '../../core/routes.js';
import { loadInvest, loadMarket, hasHistory, autoHistoryError } from './data.js';
import { dailyPnl, aggregate } from '../../engines/periods.js';
import { barChart } from '../../ui/charts.js';

const RES = [['day', 'יומי'], ['week', 'שבועי'], ['month', 'חודשי']];
const PRESETS = [['1M', 'חודש'], ['3M', '3 חודשים'], ['YTD', 'מתחילת השנה'], ['1Y', 'שנה'], ['ALL', 'הכל']];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const st = { res: 'week', cur: 'usd', unit: 'pct', portfolio: 'all', preset: '3M', from: '', to: '' };
let cache = { key: '', D: null };

export async function render(el, ctx) {
  mount(el, head(), loading('kpis'), loading('card'));
  let inv, market;
  try { [inv, market] = await Promise.all([loadInvest(), loadMarket()]); }
  catch (e) { mount(el, head(), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  if (!inv.docs.length) { mount(el, head(), emptyState({ title: 'אין עדיין תנועות', text: 'הרווח מחושב מהתנועות ומהמחירים.', actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'upload') }, 'לקליטת קובץ')] })); return; }
  if (!hasHistory(market)) {
    mount(el, head(), emptyState({ title: 'אין עדיין היסטוריית מחירים', text: `כדי לדעת כמה שווה היה התיק בכל יום צריך את מחירי הסגירה.${autoHistoryError ? ` המשיכה האוטומטית נכשלה: ${autoHistoryError}.` : ''} אפשר למשוך ידנית במסך המיגרציה.`, actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'migrate') }, 'למשיכת היסטוריה')] }));
    return;
  }
  draw(el, inv, market);
}

function head(tools) {
  return h('div', { class: 'world-head' }, h('h1', null, 'רווח לפי תקופה'), tools || h('span', { class: 'question' }, 'כמה הרווחתי ביום, בשבוע ובחודש'));
}

const seg = (label, items, cur, onPick) => h('div', { class: 'seg', role: 'group', 'aria-label': label },
  items.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(cur === v), onclick: () => onPick(v) }, t)));

function rangeOf(preset, last) {
  const d = new Date(`${last}T00:00:00Z`);
  if (preset === 'ALL') return '0000-00-00';
  if (preset === 'YTD') return `${last.slice(0, 4)}-01-01`;
  d.setUTCMonth(d.getUTCMonth() - ({ '1M': 1, '3M': 3, '1Y': 12 }[preset]));
  return d.toISOString().slice(0, 10);
}

function label(p, res) {
  if (res === 'day') return day(p.key);
  if (res === 'week') return `שבוע מ-${day(p.from)}`;
  return `${MONTHS[Number(p.key.slice(5, 7)) - 1]} ${p.key.slice(0, 4)}`;
}

function draw(el, inv, market) {
  const redraw = () => draw(el, inv, market);
  const rows = st.portfolio === 'all' ? inv.rows : inv.rows.filter(r => r.Portfolio === st.portfolio);
  const fx = market.fx && market.fx.size ? market.fx : null;
  const key = `${st.portfolio}|${inv.docs.length}|${Object.keys(market.history).length}`;
  if (cache.key !== key) {
    try { cache = { key, D: dailyPnl(rows, market.history, { fx }) }; }
    catch (e) { mount(el, head(), errorState({ title: 'החישוב נכשל', error: e })); return; }
  }
  const D = cache.D;
  const last = D.days.length ? D.days[D.days.length - 1].date : todayIso();
  const from = st.preset ? rangeOf(st.preset, last) : (st.from || '0000-00-00');
  const to = st.preset ? last : (st.to || last);
  const A = aggregate(D.days, { res: st.res, from, to, cur: st.cur });
  const money = st.cur === 'ils' ? (v, o) => ils(v, o) : (v, o) => usd(v, o);

  /* ── כלים ── */
  const fromIn = h('input', { type: 'date', value: from > '0000-00-00' ? from : (D.days[0] && D.days[0].date) || '', 'aria-label': 'מתאריך' });
  const toIn = h('input', { type: 'date', value: to, 'aria-label': 'עד תאריך' });
  const onDates = () => { st.preset = ''; st.from = fromIn.value; st.to = toIn.value; redraw(); };
  fromIn.addEventListener('change', onDates); toIn.addEventListener('change', onDates);
  const tools = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
    seg('רזולוציה', RES, st.res, v => { st.res = v; redraw(); }),
    seg('מטבע', [['usd', '$'], ['ils', '₪']], st.cur, v => { st.cur = v; redraw(); }),
    seg('תיק', [['all', 'כל התיקים'], ...inv.portfolios.map(p => [p, p])], st.portfolio, v => { st.portfolio = v; redraw(); }));
  const rangeBar = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
    seg('טווח', PRESETS, st.preset, v => { st.preset = v; redraw(); }),
    h('span', { class: 'small muted' }, 'או:'), fromIn, h('span', { class: 'small muted' }, '→'), toIn);

  if (!A.count) { mount(el, head(tools), rangeBar, emptyState({ title: 'אין ימי מסחר בטווח הזה', text: '' })); return; }

  /* ── מספרים ── */
  const first = A.periods[0];
  const buys = A.periods.reduce((s, p) => s + p.buys, 0);
  const base = first.startMv + 0.5 * buys;
  const totalPct = st.cur === 'usd' && A.total !== null && base > 1 ? A.total / base : null;
  const resWord = { day: 'ימים', week: 'שבועות', month: 'חודשים' }[st.res];
  const strip = h('div', { class: 'strip' },
    kpi({ label: `רווח ${day(first.from)} → ${day(A.periods[A.periods.length - 1].to)}`, value: A.total === null ? '—' : money(A.total, { sign: true }), cls: dirClass(A.total),
      ctx: totalPct === null ? (st.cur === 'ils' ? 'כולל תנועת הדולר' : '') : `${pct(totalPct * 100)} על ההון שהיה מושקע` }),
    kpi({ label: 'התקופה הטובה', value: A.best ? money(A.best.pnl, { sign: true }) : '—', size: 'sm', cls: 'up', ctx: A.best ? label(A.best, st.res) : '' }),
    kpi({ label: 'התקופה הגרועה', value: A.worst ? money(A.worst.pnl, { sign: true }) : '—', size: 'sm', cls: 'down', ctx: A.worst ? label(A.worst, st.res) : '' }),
    kpi({ label: `${resWord} ברווח`, value: `${A.positive}/${A.count}`, size: 'sm', ctx: `${pct((A.positive / A.count) * 100, { sign: false, digits: 0 })} מה${resWord}` }),
    kpi({ label: 'ממוצע לתקופה', value: A.total === null ? '—' : money(A.total / A.count, { sign: true }), size: 'sm', cls: dirClass(A.total) }));

  const chartBox = h('div', { class: 'stock-chart', style: { minHeight: '260px' } });
  /* הגרף: ברירת המחדל אחוזים (תשואת התקופה) — כך שבוע מ-2022 ושבוע מ-2026 ברי השוואה
     גם כשהתיק גדל פי כמה. המתג בכותרת הגרף מחזיר לסכומים. */
  const sym = st.cur === 'ils' ? '₪' : '$';
  const asPct = st.unit === 'pct';
  const bars = asPct
    ? A.periods.filter(p => p.pct !== null).map(p => ({ time: p.from, value: p.pct * 100 }))
    : A.periods.filter(p => p.pnl !== null).map(p => ({ time: p.from, value: p.pnl }));
  const fmt = asPct ? v => `${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%` : v => sym + Math.round(v).toLocaleString('en-US');
  const noPct = asPct ? A.periods.filter(p => p.pnl !== null && p.pct === null).length : 0;
  setTimeout(() => barChart(chartBox, { bars, format: fmt, height: 260 })
    .catch(e => mount(chartBox, note(`הגרף לא נטען: ${e.message || e}`, { kind: 'bad' }))), 0);

  const notes = [];
  const fb = A.periods.filter(p => p.fallback).length;
  if (fb) notes.push(note(`ב-${fb} תקופות היה נייר בלי מחיר סגירה, והוא הוערך לפי מחיר העסקה האחרונה בו. הרווח בתקופות האלה פחות מדויק.`, { kind: 'info' }));
  if (st.cur === 'ils' && A.total === null) notes.push(note('חסרים שערי דולר–שקל לחלק מהימים, ולכן אין סכום בשקלים. אפשר לעבור לדולר.', { kind: 'info' }));
  if (st.cur === 'ils') notes.push(h('p', { class: 'small muted' }, 'בשקלים: השווי מומר בשער של כל יום, ולכן יום שבו הדולר ירד נראה כהפסד גם אם המניות לא זזו. זה הרווח בכסף שלך.'));

  /* ── טבלה ── */
  const tbl = table({
    columns: [
      { key: 'p', label: { day: 'יום', week: 'שבוע', month: 'חודש' }[st.res], render: p => label(p, st.res) },
      { key: 'pnl', label: 'רווח', num: true, render: p => num(p.pnl === null ? '—' : money(p.pnl, { sign: true }), dirClass(p.pnl)) },
      { key: 'pct', label: '%', num: true, render: p => num(p.pct === null ? '—' : pct(p.pct * 100), dirClass(p.pct)) },
      { key: 'mv', label: 'שווי האחזקות בסוף', num: true, render: p => num(st.cur === 'ils' ? (p.mvEndIls === null ? '—' : ils(p.mvEndIls)) : usd(p.mvEnd)) },
      { key: 'd', label: 'ימי מסחר', num: true, render: p => num(String(p.days)) },
    ],
    rows: [...A.periods].reverse().map(p => ({ ...p, id: p.key })),
    onRow: (p, tr) => {
      const next = tr.nextElementSibling;
      if (next && next.classList.contains('detail')) { next.remove(); tr.classList.remove('expanded'); return; }
      tr.parentElement.querySelectorAll('tr.detail').forEach(x => x.remove());
      tr.parentElement.querySelectorAll('tr.expanded').forEach(x => x.classList.remove('expanded'));
      tr.classList.add('expanded');
      tr.after(h('tr', { class: 'detail' }, h('td', { colspan: '5' }, breakdown(p))));
    },
  });

  mount(el, head(tools), rangeBar, strip, ...notes,
    h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, `רווח ${RES.find(r => r[0] === st.res)[1]}`), seg('יחידות הגרף', [['pct', '%'], ['amt', sym]], st.unit, v => { st.unit = v; redraw(); })),
      h('div', { class: 'panel-b' }, chartBox,
        asPct ? h('p', { class: 'small muted', style: { marginTop: '6px' } }, `אחוז = רווח התקופה חלקי ההון שהיה מושקע בה (שווי בתחילתה + מחצית הקניות).${noPct ? ` ${noPct} תקופות בלי הון מושקע בתחילתן לא מוצגות.` : ''}`) : null)),
    h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, `לפי ${{ day: 'יום', week: 'שבוע', month: 'חודש' }[st.res]} · ${A.count}`), h('span', { class: 'chart-note' }, 'לחיצה = ממה הרווח מורכב')), h('div', { class: 'panel-b flush' }, tbl)),
    h('p', { class: 'small muted' }, 'איך זה מחושב: רווח = השינוי בשווי האחזקות + מה שנכנס מהן (מכירות, דיבידנדים, זיכויי מס) − מה שיצא אליהן (קניות כולל עמלה, מס, ריבית חובה, דמי טיפול). הפקדות ומשיכות לא נספרות כרווח. התרומה של כל נייר — בדולרים.'));
}

/* ממה מורכב הרווח של תקופה: תרומת כל נייר + הכנסות והוצאות */
function breakdown(p) {
  const parts = Object.entries(p.contrib).filter(([, v]) => Math.abs(v) >= 0.5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const top = parts.slice(0, 12), rest = parts.slice(12).reduce((s, [, v]) => s + v, 0);
  return h('div', { style: { display: 'grid', gap: '6px', maxWidth: '520px' } },
    h('div', { class: 'eyebrow' }, 'ממה הרווח מורכב (דולר)'),
    top.map(([s, v]) => h('div', { class: 'kv' }, h('a', { href: stockHref(s), class: 'sym' }, s), num(usd(v, { sign: true }), dirClass(v)))),
    rest ? h('div', { class: 'kv' }, h('span', { class: 'muted' }, `עוד ${parts.length - 12} ניירות`), num(usd(rest, { sign: true }), dirClass(rest))) : null,
    Math.abs(p.otherUsd) >= 0.5 ? h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'הכנסות והוצאות (דיבידנד, מס, ריבית, דמי טיפול)'), num(usd(p.otherUsd, { sign: true }), dirClass(p.otherUsd))) : null);
}
