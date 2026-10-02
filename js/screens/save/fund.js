/* ================================================================
   FUND — כרטיס קופה. קישור ישיר: #/save/funds/<id>.
   (אפיון 2.10.2026, זיכרון הפרויקט savings_funds.)

   השתלמות — כאן העומק ("הקרן השתלמות חשובה"):
     · יתרה, נזילות, הפקדה חודשית לפי חודש משכורת, דמי ניהול בשקלים,
       תשואה מתחילת השנה (עם התאריך שעד אליו הראל חישבה אותה)
     · מס שנחסך: הרווח בהשתלמות פטור; אותו רווח בתיק רגיל = 25%
     · מה הזיז את היתרה השנה — עם הפער, אם יש
     · הפקדות לפי חודש משכורת
     · תחזית: 3% / 5% / 7% ריאלי, בעוד 5 ו-10 שנים
   פנסיה — תצוגה קלה ("התחזית בפנסיה פחות מעניינת"): יתרה, הפקדות,
     והקצבה החזויה של הראל כמו שהיא. בלי תחזית משלנו.

   הקופה היא נכס שקלי בפני עצמו. מקור האמת ליתרה ולתשואה = הדוח של
   הראל, שמוזן ב"עדכון מהדוח". החישובים: engines/harel.js, forecast.js.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, table, chip, note, kpi } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { barChart } from '../../ui/charts.js';
import { ils, pct, day, todayIso } from '../../core/format.js';
import { hrefOf } from '../../core/routes.js';
import * as store from '../../core/store.js';
import { projectPot, KIND_LABEL, DEFAULT_RETURNS } from '../../engines/forecast.js';
import { effectiveMonthly, bySalaryMonth, reconcile, latestReport, upsertReport, isLiquid, feesPerYear, taxSaved, gainOf, TAX_RATE } from '../../engines/harel.js';

const ym = m => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : '—');
const prevMonth = iso => { const [y, m] = iso.slice(0, 7).split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const addYears = (m, y) => `${Number(m.slice(0, 4)) + y}${m.slice(4, 7)}`;
const SCEN = ['זהיר', 'בסיס', 'אופטימי'];

export async function render(el, ctx, id) {
  mount(el, loading('card'));
  let pot;
  try { pot = await store.get('pots', id); }
  catch (e) { mount(el, errorState({ error: e, onRetry: () => render(el, ctx, id) })); return; }
  if (!pot || pot.voided) {
    mount(el, emptyState({ title: 'הקופה לא נמצאה', text: 'אולי הוסרה, או שהקישור ישן.', actions: [h('a', { class: 'btn primary', href: hrefOf('save', 'funds') }, 'לכל הקופות')] }));
    return;
  }
  draw(el, ctx, pot);
}

function draw(el, ctx, pot) {
  const today = todayIso();
  const rep = latestReport(pot);
  const eff = effectiveMonthly(pot);
  const study = pot.kind === 'study', pension = pot.kind === 'pension';
  const liquid = isLiquid(pot, today);
  const formBox = h('div');
  const reload = () => render(el, ctx, pot.id);

  const tools = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    h('a', { class: 'btn sm', href: hrefOf('save', 'funds') }, 'כל הקופות'),
    h('a', { class: 'btn sm', href: hrefOf('ingest', 'upload') }, 'קליטת הפקדות'),
    h('button', { class: 'btn sm', type: 'button', onclick: async () => { const { form } = await import('./funds.js'); mount(formBox, form(pot, reload)); formBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 'הגדרות'),
    h('button', { class: 'btn sm primary', type: 'button', onclick: () => { mount(formBox, reportForm(pot, rep, reload)); formBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 'עדכון מהדוח'));

  const status = pension ? chip('לא נזיל — עד הפרישה')
    : pot.liquidFrom ? chip(liquid ? `נזילה מ-${day(pot.liquidFrom)}` : `נזילה רק מ-${day(pot.liquidFrom)}`, liquid ? 'up' : 'attn')
    : chip('נזילות — לא הוזן מועד', 'attn');

  /* ---- שורת המדדים ---- */
  const k = [];
  k.push(kpi({ label: 'יתרה', value: ils(Number(pot.balance), { digits: 0 }), asOf: pot.asOf,
    trace: { title: 'יתרה', total: Number(pot.balance), totalText: ils(Number(pot.balance), { digits: 0 }), formula: 'היתרה מהדוח האחרון של הראל, כמו שהיא. האפליקציה לא מחשבת אותה.', parts: [{ label: 'דוח הראל', src: rep ? `הוזן ${day(rep.asOf)}` : 'הוזן ידנית', valueText: ils(Number(pot.balance), { digits: 0 }) }], partsSum: Number(pot.balance) } }));
  k.push(kpi({ label: 'הפקדה חודשית', value: ils(eff.value, { digits: 0 }), size: 'sm',
    ctx: eff.source === 'deposits' ? `ממוצע 12 חודשי משכורת · אחרון ${ym(eff.rate.lastMonth)}: ${ils(eff.rate.last, { digits: 0 })}` : 'הוזן ידנית — אין עדיין הפקדות מהראל',
    trace: eff.rate ? {
      title: 'הפקדה חודשית', total: eff.rate.avg12, totalText: ils(eff.rate.avg12, { digits: 0 }),
      formula: `סך ההפקדות לפי חודש המשכורת, ${ym(eff.rate.from)}–${ym(eff.rate.lastMonth)}, חלקי 12. תיקונים רטרואקטיביים (${eff.rate.corrections} שורות) נספרים בחודש המשכורת שלהם.`,
      parts: [['עמית', eff.rate.split.me], ['מעסיק', eff.rate.split.er], ['פיצויים', eff.rate.split.sev]].filter(([, v]) => v).map(([l, v]) => ({ label: l, src: '÷ 12', valueText: ils(v / 12, { digits: 0 }) })),
      partsSum: (eff.rate.split.me + eff.rate.split.er + eff.rate.split.sev) / 12,
    } : null }));
  if (rep && rep.ytdPct != null) k.push(kpi({ label: 'תשואה מתחילת השנה', value: pct(Number(rep.ytdPct), { digits: 2 }), cls: Number(rep.ytdPct) >= 0 ? 'up' : 'down', size: 'sm', ctx: `עד סוף ${ym(rep.ytdThrough)} · לפני דמי ניהול · לפי הראל` }));
  if (study) {
    k.push(kpi({ label: 'דמי ניהול בשנה', value: ils(feesPerYear(pot), { digits: 0 }), size: 'sm', ctx: `${Number(pot.feeBalancePct) || 0}% מהצבירה` }));
    if (rep && rep.gainsYtd != null) k.push(kpi({ label: 'מס שנחסך השנה', value: ils(taxSaved(rep.gainsYtd), { digits: 0 }), cls: 'up', size: 'sm', ctx: `${TAX_RATE * 100}% מרווח של ${ils(Number(rep.gainsYtd), { digits: 0 })}` }));
  }
  if (pension) {
    if (rep && rep.harelPension) k.push(kpi({ label: 'קצבה חזויה (הראל)', value: ils(Number(rep.harelPension), { digits: 0 }), size: 'sm', ctx: rep.harelPensionBalanceOnly ? `על הצבירה בלבד: ${ils(Number(rep.harelPensionBalanceOnly), { digits: 0 })}` : 'בהנחת המשך הפקדות' }));
    if (rep && rep.insuranceYtd != null) k.push(kpi({ label: 'ביטוח מתחילת השנה', value: ils(Number(rep.insuranceYtd), { digits: 0 }), size: 'sm', ctx: 'נכות ושארים' }));
  }

  const panels = [];
  if (!rep) panels.push(note('עוד לא הוזן דוח מהראל. "עדכון מהדוח" — יתרה, תשואה ודמי ניהול מה-PDF. בלי זה אין התאמה ואין תשואה.', { kind: 'info' }));
  if (study && Number(pot.balance) > 0) panels.push(taxPanel(pot, eff, liquid));
  if (rep) panels.push(movedPanel(rep, pension));
  panels.push(depositsPanel(pot));
  if (study) panels.push(forecastPanel(pot, eff));
  if (pension) panels.push(note('בפנסיה מוצגת התחזית של הראל כמו שהיא, בלי תחזית משלנו (הוחלט 2.10.2026). בדיקה אחת הראתה שבהנחות של הראל החישוב שלנו יוצא כ-6% מעל — הראל לא מפרסמת את עלויות הביטוח לפי גיל.', { kind: '' }));

  mount(el,
    h('div', { class: 'world-head' }, h('h1', null, pot.name), h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }, chip(KIND_LABEL[pot.kind] || pot.kind), status), tools),
    h('div', { class: 'strip' }, k),
    formBox,
    panels);

  const chartEl = el.querySelector('[data-chart="deposits"]');
  if (chartEl) {
    const months = bySalaryMonth(pot.deposits).slice(-24);
    barChart(chartEl, { bars: months.map(m => ({ time: `${m.month}-01`, value: m.tot })), format: v => `₪${Math.round(v).toLocaleString('en-US')}`, height: 200 })
      .catch(e => mount(chartEl, errorState({ title: 'הגרף לא נטען', error: e })));
  }
}

/* ---- למה ההשתלמות שווה יותר משקל בתיק רגיל ---- */
function taxPanel(pot, eff, liquid) {
  const until = addYears(String(pot.asOf).slice(0, 7), 10);
  const s = projectPot({ ...pot, monthly: eff.value }, { scenario: 1, until });
  const gain = gainOf(s, pot.balance);
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'היתרון של ההשתלמות'), chip('פטורה ממס רווחי הון', 'up')),
    h('div', { class: 'panel-b', style: { display: 'grid', gap: '8px' } },
      h('p', null, `הרווח בקרן השתלמות פטור ממס. אותו רווח בתיק באיביאי משלם ${TAX_RATE * 100}% על הרווח הריאלי. בתרחיש הבסיס (${(pot.returns || DEFAULT_RETURNS.study)[1]}% לשנה), בעוד 10 שנים הקופה תרוויח בערך `, h('b', null, num(ils(gain, { digits: 0 }))), ' — כלומר חיסכון במס של כ-', h('b', null, num(ils(taxSaved(gain), { digits: 0 }))), '.'),
      h('p', { class: 'small muted' }, liquid
        ? 'הקופה נזילה — אפשר למשוך אותה מחר. אבל כל שקל שיוצא מפסיק לצבור רווח פטור ממס, וכל שקל שיחזור להשקעה בתיק רגיל ישלם מס על הרווח העתידי.'
        : 'הקופה עוד לא נזילה. אחרי מועד הנזילות אפשר למשוך — אבל הפטור ממס ממשיך רק כל עוד הכסף נשאר בקופה.'),
      h('p', { class: 'small muted' }, 'הערכה גסה: מניחה שאותו כסף היה מושקע אותו דבר בתיק רגיל. התחזית ריאלית, והמס בישראל על רווח ריאלי — אותו בסיס.')));
}

/* ---- מה הזיז את היתרה השנה ---- */
function movedPanel(rep, pension) {
  const rc = reconcile(rep);
  if (!rc) return note('כדי לראות מה הזיז את היתרה — להזין בדוח גם את "יתרה בתחילת השנה".', { kind: 'info' });
  const n = k => Number(rep[k]) || 0;
  const rows = [
    { id: 'a', l: 'יתרה בתחילת השנה', v: n('startBalance') },
    { id: 'b', l: '+ הפקדות', v: n('depositsYtd') },
    { id: 'c', l: '+ רווחים (לפני דמי ניהול)', v: n('gainsYtd') },
    { id: 'd', l: '− דמי ניהול', v: -n('feesYtd') },
  ];
  if (pension || n('insuranceYtd')) rows.push({ id: 'e', l: '− ביטוח (נכות ושארים)', v: -n('insuranceYtd') });
  if (n('otherYtd')) rows.push({ id: 'f', l: '− אחר (עדכון אקטוארי וכו\')', v: -n('otherYtd') });
  rows.push({ id: 'g', l: '= מחושב', v: rc.computed, b: true }, { id: 'h', l: 'יתרה בדוח', v: n('balance'), b: true });
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'מה הזיז את היתרה השנה'), chip(rc.ok ? `מתיישב · פער ${ils(rc.gap, { digits: 0 })}` : `פער ${ils(rc.gap, { digits: 0 })}`, rc.ok ? 'up' : 'attn')),
    h('div', { class: 'panel-b flush' }, table({
      columns: [{ key: 'l', label: '', render: r => (r.b ? h('b', null, r.l) : r.l) }, { key: 'v', label: '₪', num: true, render: r => num(ils(r.v, { digits: 0 }), r.b ? '' : 'muted') }],
      rows,
    })),
    rc.ok ? null : h('div', { class: 'panel-b' }, note(`החלקים לא מתלכדים ליתרה — פער של ${ils(rc.gap, { digits: 0 })}. בדוח של הראל הרווחים לפעמים מעוגלים למאות, אז פער של עשרות שקלים צפוי. פער גדול = לבדוק את המספרים שהוזנו.`, { kind: '' })));
}

/* ---- הפקדות לפי חודש משכורת ---- */
function depositsPanel(pot) {
  const dep = pot.deposits || [];
  if (!dep.length) return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'הפקדות')),
    h('div', { class: 'panel-b' }, emptyState({ title: 'עוד לא נקלטו הפקדות', text: 'באתר הראל: "תנועות אחרונות" → ייצוא לאקסל. גוררים את הקובץ למסך הקליטה. בינתיים התחזית משתמשת בהפקדה שהוזנה ידנית.', actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'upload') }, 'לקליטה')] })));
  const months = bySalaryMonth(dep);
  const last12 = months.slice(-12).reverse();
  const hasSev = months.some(m => m.sev);
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'הפקדות לפי חודש משכורת'), h('span', { class: 'chart-note' }, `${dep.length} שורות · מקובץ ${pot.depositsFile || '—'}${pot.depositsAt ? `, ${day(pot.depositsAt)}` : ''}`)),
    h('div', { class: 'panel-b' }, h('div', { class: 'chart', dataset: { chart: 'deposits' } })),
    h('div', { class: 'panel-b flush' }, table({
      columns: [
        { key: 'month', label: 'חודש משכורת', render: m => num(ym(m.month)) },
        { key: 'me', label: pot.kind === 'pension' ? 'עובד' : 'עמית', num: true, render: m => num(ils(m.me, { digits: 0 }), 'muted') },
        { key: 'er', label: 'מעסיק', num: true, render: m => num(ils(m.er, { digits: 0 }), 'muted') },
        ...(hasSev ? [{ key: 'sev', label: 'פיצויים', num: true, render: m => num(ils(m.sev, { digits: 0 }), 'muted') }] : []),
        { key: 'tot', label: 'סה"כ', num: true, render: m => h('b', null, num(ils(m.tot, { digits: 0 }))) },
        { key: 'rows', label: 'שורות', num: true, render: m => num(String(m.rows), m.rows > 1 ? '' : 'muted') },
      ],
      rows: last12.map(m => ({ ...m, id: m.month })),
    })),
    h('div', { class: 'panel-b' }, h('p', { class: 'small muted' }, 'הראל מוסיפה תיקונים רטרואקטיביים קטנים לחודשים קודמים. לפי חודש המשכורת הם מתחברים להפקדה שלהם — לכן חודש עם יותר משורה אחת.')));
}

/* ---- תחזית: 3 תרחישים × 5/10 שנים ---- */
function forecastPanel(pot, eff) {
  const start = String(pot.asOf).slice(0, 7);
  const returns = pot.returns || DEFAULT_RETURNS.study;
  const rows = [5, 10].map(y => {
    const vals = [0, 1, 2].map(sc => { const s = projectPot({ ...pot, monthly: eff.value }, { scenario: sc, until: addYears(start, y) }); return { v: s[s.length - 1].value, g: gainOf(s, pot.balance) }; });
    return { id: y, y, vals };
  });
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'לאן היא מגיעה'), chip('תחזית', 'attn'), h('span', { class: 'chart-note' }, `תשואה ריאלית ${returns.join(' / ')}% · הפקדה ${ils(eff.value, { digits: 0 })} לחודש · בשקלים של היום`)),
    h('div', { class: 'panel-b flush' }, table({
      columns: [
        { key: 'y', label: 'בעוד', render: r => `${r.y} שנים` },
        ...SCEN.map((l, i) => ({ key: `s${i}`, label: `${l} (${returns[i]}%)`, num: true, render: r => h('div', null, i === 1 ? h('b', null, num(ils(r.vals[i].v, { digits: 0 }))) : num(ils(r.vals[i].v, { digits: 0 }), 'muted'), h('div', { class: 'small muted' }, num(`רווח ${ils(r.vals[i].g, { digits: 0 })}`))) })),
      ],
      rows,
    })),
    h('div', { class: 'panel-b' }, h('p', { class: 'small muted' }, 'הקופה בשקלים, והמסלול חשוף במלואו לדולר — שנה של דולר חלש יכולה למחוק שנה של עליות במדד. התחזית לא מנחשת את שער הדולר; הטווח בין התרחישים הוא הדרך להראות אי-ודאות.')));
}

/* ---- עדכון מהדוח ---- */
function reportForm(pot, last, onSaved) {
  const pension = pot.kind === 'pension';
  const today = todayIso();
  const r = last || {};
  const f = (label, input, hint) => h('label', { style: { display: 'grid', gap: '3px', fontSize: '12px', color: 'var(--muted)' } }, label, input, hint ? h('span', { class: 'small muted' }, hint) : null);
  const inp = (id, value, attrs = {}) => h('input', { id, class: 'btn sm', value: value ?? '', style: { textAlign: 'start', width: '100%' }, ...attrs });
  const numIn = (id, v) => inp(id, v, { type: 'number', step: 'any', inputmode: 'decimal' });
  const I = {
    asOf: inp('rep-asof', today, { type: 'date' }),
    balance: numIn('rep-balance', ''),
    start: numIn('rep-start', r.asOf && r.asOf.slice(0, 4) === today.slice(0, 4) ? r.startBalance : ''),
    dep: numIn('rep-dep', ''), gains: numIn('rep-gains', ''), fees: numIn('rep-fees', ''),
    ins: numIn('rep-ins', ''), other: numIn('rep-other', ''),
    ytd: numIn('rep-ytd', ''), through: inp('rep-through', prevMonth(today), { type: 'month' }),
    hp: numIn('rep-hp', ''), hpb: numIn('rep-hpb', ''),
  };
  I.asOf.addEventListener('change', () => { if (I.asOf.value) I.through.value = prevMonth(I.asOf.value); });
  const save = h('button', { class: 'btn primary sm', type: 'button' }, 'שמירה');
  const cancel = h('button', { class: 'btn sm ghost', type: 'button', onclick: () => onSaved() }, 'ביטול');
  save.addEventListener('click', async () => {
    const n = el => (el.value === '' ? null : Number(el.value));
    const rep = {
      asOf: I.asOf.value, balance: n(I.balance), startBalance: n(I.start), depositsYtd: n(I.dep), gainsYtd: n(I.gains),
      feesYtd: n(I.fees) == null ? null : Math.abs(n(I.fees)), insuranceYtd: n(I.ins) == null ? null : Math.abs(n(I.ins)), otherYtd: n(I.other) == null ? null : Math.abs(n(I.other)),
      ytdPct: n(I.ytd), ytdThrough: I.through.value || null,
      ...(pension ? { harelPension: n(I.hp), harelPensionBalanceOnly: n(I.hpb) } : {}),
    };
    if (!rep.asOf || rep.balance == null) { toast('חסרים תאריך הדוח והיתרה'); return; }
    save.disabled = true;
    try {
      await store.patch('pots', pot.id, { reports: upsertReport(pot.reports, rep), balance: rep.balance, asOf: rep.asOf });
      toast('הדוח נשמר');
      onSaved();
    } catch (e) { save.disabled = false; toast(`השמירה נכשלה: ${e.message || e}`); }
  });
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'עדכון מהדוח של הראל'), h('div', { class: 'tools' }, cancel, save)),
    h('div', { class: 'panel-b' },
      h('div', { class: 'grid cols-4' },
        f('המידע נכון לתאריך', I.asOf), f('יתרה (סה"כ צבירה)', I.balance), f('יתרה בתחילת השנה', I.start, '"צבירה לתחילת שנה"'), f('הפקדות השנה', I.dep),
        f('רווחים לפני דמי ניהול', I.gains, '"רווחים" / "תשואה"'), f('דמי ניהול השנה', I.fees),
        pension ? f('עלות ביטוח השנה', I.ins, 'נכות ושארים') : null,
        pension ? f('עדכון צבירה (אקטוארי)', I.other) : null,
        f('תשואה מתחילת השנה (%)', I.ytd), f('התשואה עד סוף חודש', I.through, 'בדרך כלל החודש הקודם'),
        pension ? f('פנסיה צפויה (₪ לחודש)', I.hp) : null,
        pension ? f('פנסיה על בסיס הצבירה בלבד', I.hpb) : null),
      h('p', { class: 'small muted' }, 'המספרים מהעמוד "ריכוז תנועות וצבירות מתחילת השנה" בדוח. דמי ניהול וביטוח — כסכום חיובי. מספר זהות ותאריך לידה לא נשמרים כאן.')));
}
