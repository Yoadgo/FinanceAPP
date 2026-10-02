/* ================================================================
   CHART PANEL — הגרף הראשי של עולם ההשקעות, משותף לבית, לאחזקות
   ולביצועים: שווי התיק · ההון שהושקע · אותו כסף ב-IVV.
   בורר טווח (1M · 3M · YTD · 1Y · 3Y · הכל) כמו ב-Koyfin, ובמסכים
   המלאים גם טווח חופשי (מתאריך → עד תאריך).

   השוואה לטיקר (יועד, 2.10.2026 — "האם הנפילה של יוני קשורה לנפילה של
   טסלה, או שזה בכלל משיכת כסף?"):
     · "+ השוואה" — עד 3 ניירות. מתג:
         תזמון   — אחוז השינוי של הנייר מתחילת הטווח, על הציר השמאלי.
                   עונה על "האם ירדו באותם ימים".
         מי ניצח — אותו כסף בנייר (כל הפקדה נקנית בו באותו יום), בדולרים.
     · חצים על קו השווי: ▲ הפקדה, ▼ משיכה — כדי שמשיכה לא תיראה כמו הפסד.
     · מתחת לגרף (לא בבית): "ממה מורכב השינוי" בטווח — משיכות/הפקדות,
       רווח מהשוק ותרומת כל נייר, ושארית שחייבת להיות קטנה (engines/compare.js).

   בלי היסטוריית מחירים — אין קו שווי, ואומרים את זה. הקו של ההון שהושקע
   מצויר גם בלי מחירים: הוא נגזר מההפקדות ומהשערים בלבד.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, note } from '../../ui/components.js';
import { timeChart, legend } from '../../ui/charts.js';
import { comparePicker } from '../../ui/comparePicker.js';
import { usd, pct, day, dirClass, todayIso } from '../../core/format.js';
import { stockHref } from '../../core/routes.js';
import { investSeries, depositsUsd, benchmarkSeries } from '../../engines/series.js';
import { dailyPnl } from '../../engines/periods.js';
import { compareSymbols, rebasePct, rangeReturn, flowEvents, decompose } from '../../engines/compare.js';
import { BENCHMARK } from '../../config.js';

const RANGES = [['1M', 1], ['3M', 3], ['YTD', 'ytd'], ['1Y', 12], ['3Y', 36], ['הכל', 0]];
const MODES = [['time', 'תזמון'], ['win', 'מי ניצח']];
let mode = 'time';                                  // נשמר בין מסכים באותה טעינה
const pnlCache = new WeakMap();                     // inv.rows → dailyPnl (חישוב יקר יחסית)

function startOf(range, last) {
  if (!range) return '0000';
  const d = new Date(`${last}T00:00:00Z`);
  if (range === 'ytd') return `${last.slice(0, 4)}-01-01`;
  d.setUTCMonth(d.getUTCMonth() - range);
  return d.toISOString().slice(0, 10);
}
const kUsd = v => { const a = Math.abs(v); return a >= 1000 ? `$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}K` : `$${Math.round(a)}`; };
const pctFmt = v => `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;

export function investChartPanel({ inv, market, title = 'שווי התיק מול המדד', height = 300, initial = 'הכל', compact = false }) {
  const body = h('div', { class: 'panel-b' }, loading('card'));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'טווח' });
  const panel = h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, title), h('div', { class: 'tools' }, seg)),
    body);

  let S, deposits;
  try {
    if (!inv.rows.length) { mount(body, emptyState({ title: 'אין עדיין תנועות', text: 'הגרף ייבנה מהתנועות אחרי המיגרציה (שלב 2).' })); return panel; }
    if (!market.fx.size) { mount(body, emptyState({ title: 'אין שערי דולר–שקל במסד', text: 'השערים נכתבים במסך המיגרציה. בלעדיהם אי אפשר להמיר הפקדות בשקלים לדולרים בשער של אותו יום.' })); return panel; }
    S = investSeries(inv.rows, market.history, market.fx, BENCHMARK);
    deposits = depositsUsd(inv.rows, market.fx);
  } catch (e) {
    mount(body, errorState({ title: 'הגרף לא חושב', error: e }));
    return panel;
  }

  const hasPrices = Object.values(market.history).some(a => a.length >= 200);
  const last = S.days[S.days.length - 1] || todayIso();
  let chart = null, current = initial, custom = null;
  const sameMoney = new Map();                       // sym → סדרת "אותו כסף" (לא משתנה בין טווחים)

  const picker = comparePicker({ key: 'invest-value', symbols: hasPrices ? compareSymbols(market.history) : [], onChange: () => draw() });
  const modeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'צורת ההשוואה' });
  MODES.forEach(([v, t]) => modeSeg.append(h('button', { type: 'button', 'aria-pressed': String(mode === v), onclick: () => { mode = v; [...modeSeg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(MODES[i][0] === mode))); draw(); } }, t)));

  /* טווח חופשי — רק במסכים המלאים */
  const fromIn = h('input', { type: 'date', 'aria-label': 'מתאריך' });
  const toIn = h('input', { type: 'date', 'aria-label': 'עד תאריך' });
  const onDates = () => {
    if (!fromIn.value || !toIn.value || fromIn.value > toIn.value) return;
    custom = { from: fromIn.value, to: toIn.value };
    [...seg.children].forEach(x => x.setAttribute('aria-pressed', 'false'));
    draw();
  };
  fromIn.addEventListener('change', onDates); toIn.addEventListener('change', onDates);

  const draw = async () => {
    const from = custom ? custom.from : startOf(RANGES.find(r => r[0] === current)[1], last);
    const to = custom ? custom.to : last;
    fromIn.value = from > '0000' ? from : (S.days[0] || ''); toIn.value = to;
    const cut = arr => arr.filter(p => p.time >= from && p.time <= to);
    const v = cut(S.value), b = cut(S.benchmark), inv0 = cut(S.invested);
    const firstDay = (v[0] || inv0[0] || {}).time || from;

    /* ▲ הפקדה / ▼ משיכה — על קו השווי (או על קו ההון כשאין מחירים) */
    const flows = flowEvents(deposits, firstDay, to, { min: 100 });
    /* בטווח ארוך יש עשרות הפקדות — טקסט רק על 6 הגדולות, כדי שהגרף לא ייחנק */
    const big = new Set(flows.length <= 12 ? flows : [...flows].sort((x, y) => Math.abs(y.usd) - Math.abs(x.usd)).slice(0, 6));
    const markers = flows.map(f => ({ time: f.date, position: f.usd > 0 ? 'belowBar' : 'aboveBar', color: f.usd > 0 ? '--up' : '--down',
      shape: f.usd > 0 ? 'arrowUp' : 'arrowDown', text: big.has(f) ? `${f.usd > 0 ? '+' : '−'}${kUsd(f.usd)}` : '' }));

    const series = [];
    if (hasPrices) series.push({ name: 'שווי התיק', color: '--s-1', kind: 'area', data: v, markers });
    series.push({ name: 'ההון שהושקע', color: '--s-2', kind: 'line', dashed: true, data: inv0, markers: hasPrices ? null : markers });
    if (S.benchmark.length) series.push({ name: `אותו כסף ב-${BENCHMARK}`, color: '--s-3', kind: 'line', data: b });

    const cmp = hasPrices ? picker.selected() : [];
    const cmpInfo = [], lateStart = [];
    cmp.forEach(c => {
      const closes = market.history[c.sym] || [];
      if (mode === 'time') {
        series.push({ name: `${c.sym} · % מתחילת הטווח`, color: c.color, kind: 'line', scale: 'left', format: pctFmt, data: rebasePct(closes, firstDay, to) });
      } else if (c.sym !== BENCHMARK) {
        if (!sameMoney.has(c.sym)) sameMoney.set(c.sym, benchmarkSeries(deposits, closes, S.days));
        /* הפקדה מלפני ההיסטוריה של הנייר לא "נקנית" בו — הקו היה נראה נמוך מדי בלי הסבר */
        if (closes.length && deposits.length && closes[0].date > deposits[0].date) lateStart.push(`${c.sym} מ-${day(closes[0].date)}`);
        series.push({ name: `אותו כסף ב-${c.sym}`, color: c.color, kind: 'line', data: cut(sameMoney.get(c.sym)) });
      }
      cmpInfo.push({ sym: c.sym, ret: rangeReturn(closes, firstDay, to) });
    });

    /* השינוי בטווח — מאותו בסיס כמו "ממה מורכב השינוי": היום שלפני תחילת הטווח */
    const chg = (arr, all) => { if (!arr.length) return null; const prev = [...all].reverse().find(p => p.time < from); const base = prev || arr[0]; return arr.length > 1 || prev ? arr[arr.length - 1].value - base.value : null; };
    const summary = h('div', { class: 'legend', style: { justifyContent: 'space-between' } },
      legend([...series.map(s => ({ label: s.name, color: s.color, dashed: s.dashed })),
        ...(markers.length ? [{ label: '▲▼ הפקדה / משיכה', color: '--fg-2' }] : [])]),
      hasPrices && chg(v, S.value) !== null ? h('span', null, 'בטווח: ', num(usd(chg(v, S.value), { sign: true }), dirClass(chg(v, S.value))),
        chg(b, S.benchmark) !== null ? h('span', { class: 'muted' }, ` · ${BENCHMARK} `, num(usd(chg(b, S.benchmark), { sign: true }), dirClass(chg(b, S.benchmark)))) : null) : null);

    const bar = h('div', { class: 'cmp-bar' }, picker.el,
      cmp.length ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        cmpInfo.map(c => h('span', { class: 'small' }, h('span', { class: 'sym' }, c.sym), ' ', num(c.ret === null ? '—' : pct(c.ret * 100), dirClass(c.ret)))),
        modeSeg) : null);
    const box = h('div', { class: 'chart', style: { height: `${height}px` } });
    const decompBox = compact || !hasPrices ? null : h('div', { class: 'decomp-wrap', style: { borderTop: '1px solid var(--line)', marginTop: '12px', paddingTop: '12px' } });
    mount(body,
      compact ? null : h('div', { class: 'range-in', style: { marginBottom: '8px' } }, h('span', { class: 'small muted' }, 'טווח:'), fromIn, h('span', { class: 'small muted' }, '→'), toIn),
      hasPrices ? bar : null, summary, box,
      cmp.length && mode === 'time' ? h('div', { class: 'chart-note' }, 'קווי ההשוואה באחוזים מתחילת הטווח — הציר השמאלי. התיק בדולרים — הציר הימני. מה שמעניין הוא אם הירידות קרו באותם ימים, לא איפה הקווים נפגשים.') : null,
      cmp.length && mode === 'win' ? h('div', { class: 'chart-note' }, `"אותו כסף" = כל הפקדה שלך נקנתה בנייר באותו יום, וכל משיכה נמכרה ממנו באותו יום — בדיוק כמו קו ${BENCHMARK}.`,
        lateStart.length ? ` שים לב: יש מחירים רק ל-${lateStart.join(', ')}, והפקדות מלפני כן לא נכנסות לקו — הוא נמוך מהאמת.` : '') : null,
      hasPrices ? null : h('div', { class: 'chart-note' }, 'קו השווי יופיע כשגיליון המחירים יחובר ותימשך היסטוריית מחירים. בינתיים — ההון שהושקע בלבד.'),
      decompBox);
    if (chart) { chart.remove(); chart = null; }
    try { chart = await timeChart(box, { series, format: x => (Math.abs(x) >= 1000 ? `$${(x / 1000).toFixed(0)}K` : `$${x.toFixed(0)}`) }); }
    catch (e) { mount(box, errorState({ title: 'הגרף לא נטען', error: e })); }
    if (decompBox) renderDecomp(decompBox, { inv, market, S, deposits, from, to, cmp });
  };

  RANGES.forEach(([label]) => {
    const btn = h('button', { type: 'button', 'aria-pressed': String(label === current) }, label);
    btn.addEventListener('click', () => { current = label; custom = null; [...seg.children].forEach(x => x.setAttribute('aria-pressed', String(x === btn))); draw(); });
    seg.append(btn);
  });
  if (compact) seg.replaceChildren(...[...seg.children].filter(x => ['1Y', 'הכל'].includes(x.textContent)));
  draw();
  return panel;
}

/* ── ממה מורכב השינוי ── */
function renderDecomp(box, { inv, market, S, deposits, from, to, cmp }) {
  let X;
  try {
    if (!pnlCache.has(inv.rows)) pnlCache.set(inv.rows, dailyPnl(inv.rows, market.history, { fx: market.fx }));
    X = decompose({ value: S.value, deposits, days: pnlCache.get(inv.rows).days }, { from, to });
  } catch (e) { mount(box, errorState({ title: 'הפירוק לא חושב', error: e })); return; }
  if (!X) { mount(box, h('p', { class: 'small muted' }, 'אין נתונים בטווח הזה.')); return; }

  const kv = (label, value, cls = '', extra = '') => h('div', { class: `kv ${extra}`.trim() }, label, num(value, cls));
  const L = t => h('span', { class: 'muted' }, t);
  const pinned = new Set(cmp.map(c => c.sym));
  const top = X.bySym.filter(s => Math.abs(s.usd) >= 0.5).slice(0, 6);
  cmp.forEach(c => { const s = X.bySym.find(y => y.symbol === c.sym); if (s && !top.includes(s)) top.push(s); });
  const restList = X.bySym.filter(s => !top.includes(s));
  const rest = restList.reduce((a, s) => a + s.usd, 0);
  const flowsIn = flowEvents(deposits, X.from, X.to, { min: 1 }).filter(f => f.usd > 0);
  const flowsOut = flowEvents(deposits, X.from, X.to, { min: 1 }).filter(f => f.usd < 0);
  const dates = list => list.slice(0, 4).map(f => day(f.date)).join(', ') + (list.length > 4 ? ` ועוד ${list.length - 4}` : '');

  /* המשפט — שלוש התשובות האפשריות, במספרים */
  const parts = [];
  if (X.flowsOut) parts.push(`משיכה של ${kUsd(X.flowsOut)}`);
  if (X.flowsIn) parts.push(`הפקדה של ${kUsd(X.flowsIn)}`);
  const lead = X.bySym[0];
  parts.push(`${X.gain >= 0 ? 'רווח' : 'הפסד'} מהשוק של ${kUsd(X.gain)}${lead && Math.abs(lead.usd) >= 1 ? ` (הכי הרבה: ${lead.symbol} ${lead.usd >= 0 ? '+' : '−'}${kUsd(lead.usd)})` : ''}`);
  const bench = rangeReturn(market.history[BENCHMARK] || [], X.from, X.to);
  const say = `השווי ${X.change >= 0 ? 'עלה' : 'ירד'} ב-${kUsd(X.change)}. מתוך זה: ${parts.join(', ')}.${bench === null ? '' : ` באותו זמן ${BENCHMARK} ${pct(bench * 100)}.`}`;

  mount(box,
    h('div', { class: 'panel-h', style: { padding: 0, border: 0, marginBottom: '6px' } }, h('h3', { style: { margin: 0, fontSize: '14px' } }, 'ממה מורכב השינוי'),
      h('span', { class: 'chart-note' }, `${X.startDate ? day(X.startDate) : 'מההתחלה'} → ${day(X.to)}`)),
    h('p', { class: 'decomp-say' }, say),
    h('div', { class: 'decomp' },
      kv(L(X.startDate ? `שווי ב-${day(X.startDate)}` : 'שווי בהתחלה'), usd(X.startValue)),
      X.flowsIn ? kv(L(`הפקדות (${dates(flowsIn)})`), usd(X.flowsIn, { sign: true }), 'up') : null,
      X.flowsOut ? kv(L(`משיכות (${dates(flowsOut)})`), usd(X.flowsOut, { sign: true }), 'down') : null,
      kv(L('רווח / הפסד מהשוק'), usd(X.gain, { sign: true }), dirClass(X.gain)),
      top.map(s => h('div', { class: `kv sub${pinned.has(s.symbol) ? ' pin' : ''}` }, h('a', { href: stockHref(s.symbol), class: 'sym' }, s.symbol), num(usd(s.usd, { sign: true }), dirClass(s.usd)))),
      restList.length ? kv(L(`עוד ${restList.length} ניירות`), usd(rest, { sign: true }), dirClass(rest), 'sub') : null,
      Math.abs(X.other) >= 0.5 ? kv(L('דיבידנד, מס, ריבית, דמי טיפול'), usd(X.other, { sign: true }), dirClass(X.other), 'sub') : null,
      kv(L('הפרשי שער על מזומן ושונות'), usd(X.residual, { sign: true }), X.reconciled ? 'muted' : 'attn'),
      kv(h('span', null, `שווי ב-${day(X.to)}`), usd(X.endValue), '', 'total')),
    X.reconciled ? null : note(`הפירוק לא מתיישב: נשאר פער של ${usd(X.residual)} שלא מוסבר בהפקדות, במשיכות או ברווח (סבולת ${usd(X.tolerance)}). כנראה חסרות תנועות או מחירים בטווח הזה — לא לסמוך על הפירוק עד שזה נבדק.`, { kind: 'attn' }),
    X.fallbackDays ? h('p', { class: 'small muted' }, `ב-${X.fallbackDays} ימים היה נייר בלי מחיר סגירה, והוא הוערך לפי מחיר העסקה האחרונה בו.`) : null,
    h('p', { class: 'small muted' }, 'רווח מהשוק = אותו חישוב כמו "רווח לפי תקופה": השינוי בשווי האחזקות ועוד מה שהן החזירו, פחות מה שהושקע בהן. הפקדות ומשיכות לא נספרות כרווח. "הפרשי שער" = תנועת הדולר על מזומן שקלי שיושב בתיק, והפרש בין שער ההמרה בפועל לשער היומי — אמורים להיות קטנים.'));
}
