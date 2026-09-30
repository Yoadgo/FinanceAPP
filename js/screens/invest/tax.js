/* ================================================================
   TAX — "כמה עלה לי המסחר". (שלב 3, 30.9.2026)

   המספר הגדול: החיכוך של השנה בשקלים — עמלות, ריבית חובה, דמי
   טיפול, מס רווח הון נטו ומס דיבידנד — וכמה זה מתוך הרווח. (יועד
   בחר את השאלה הזו כראשית.) מתחת: כל דלי במטבע המקורי, לפי שנה,
   לפי נייר ולפי תיק.

   החישוב: engines/friction.js. כל מספר ניתן לפירוק (ממה מורכב).
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, kpi, table, note } from '../../ui/components.js';
import { ils, usd, pct, day, todayIso } from '../../core/format.js';
import { hrefOf } from '../../core/routes.js';
import { loadInvest, loadMarket } from './data.js';
import { friction, COSTS } from '../../engines/friction.js';

let portfolio = 'all';
let year = null;

export async function render(el, ctx) {
  mount(el, head(), loading('kpis'), loading('table'));
  let inv, market;
  try { [inv, market] = await Promise.all([loadInvest(), loadMarket()]); }
  catch (e) { mount(el, head(), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  if (!inv.docs.length) {
    mount(el, head(), emptyState({ title: 'אין עדיין תנועות', text: 'העמלות והמסים נקראים מתנועות ההשקעה.', actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'upload') }, 'לקליטת קובץ')] }));
    return;
  }
  draw(el, inv, market);
}

function head(tools) {
  return h('div', { class: 'world-head' }, h('h1', null, 'מס ועמלות'), tools || h('span', { class: 'question' }, 'כמה עלה לי המסחר, ולאן זה הלך'));
}

const seg = (label, items, current, onPick) => h('div', { class: 'seg', role: 'group', 'aria-label': label },
  items.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(current === v), onclick: () => onPick(v) }, t)));

/* סכום במטבע המקורי: "$120" / "₪45" / "$1 + ₪300" */
const orig = b => [b.usd ? usd(b.usd) : null, b.ils ? ils(b.ils) : null].filter(Boolean).join(' + ') || ils(0);

function draw(el, inv, market) {
  const rows = portfolio === 'all' ? inv.rows : inv.rows.filter(r => r.Portfolio === portfolio);
  let f;
  try { f = friction(rows, { fx: market.fx && market.fx.size ? market.fx : null }); }
  catch (e) { mount(el, head(), errorState({ title: 'החישוב נכשל', error: e })); return; }
  const redraw = () => draw(el, inv, market);
  const portSeg = seg('תיק', [['all', 'כל התיקים'], ...inv.portfolios.map(p => [p, p])], portfolio, v => { portfolio = v; redraw(); });
  if (!f.years.length) { mount(el, head(portSeg), emptyState({ title: 'אין תנועות בתיק הזה', text: '' })); return; }

  const years = f.years.map(y => y.year);
  const thisYear = todayIso().slice(0, 4);
  if (!year || !years.includes(year)) year = years.includes(thisYear) ? thisYear : years[0];
  const Y = f.years.find(y => y.year === year);

  const tools = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    seg('שנה', years.map(y => [y, y]), year, v => { year = v; redraw(); }), portSeg);

  /* ── המספר הגדול ── */
  const parts = Object.entries(COSTS).map(([k, label]) => {
    const b = Y.costs[k];
    const src = k === 'cgTax' ? `שולם ${ils(Y.tax.paid)} · זוכה ${ils(Y.tax.credit)}${Y.tax.unusedCredit > 0.005 ? ` · זיכוי פתוח ${ils(Y.tax.unusedCredit)}` : ''}` : `${b.n} שורות · ${orig(b)}`;
    return { label, src, valueText: b.total === null ? '—' : ils(b.total) };
  });
  const partsSum = Object.keys(COSTS).reduce((s, k) => s + (Y.costs[k].total || 0), 0);
  const share = Y.shareOfProfit;
  const shareText = share !== null ? `${pct(share * 100, { sign: false, digits: 0 })} מהרווח (ממומש + דיבידנד)`
    : Y.profitBaseIls !== null && Y.profitBaseIls <= 0 ? 'השנה אין רווח ממומש — החיכוך הוא הפסד נוסף' : '';
  const hero = kpi({
    label: `החיכוך ב-${year}`, value: Y.frictionIls === null ? '—' : ils(Y.frictionIls), ctx: shareText,
    trace: {
      title: `החיכוך ב-${year}`, total: Y.frictionIls ?? undefined, totalText: Y.frictionIls === null ? '—' : ils(Y.frictionIls),
      formula: 'עמלות מסחר + ריבית חובה + דמי טיפול + מס רווח הון נטו + מס במקור על דיבידנד. כל סכום בדולר מומר לשקל לפי השער של יום השורה.',
      parts, partsSum,
      note: share !== null ? `הבסיס לאחוז: רווח ממומש ברוטו ${ils(Y.realizedIls)} + דיבידנדים וזיכויים ${ils(Y.incomeIls)} = ${ils(Y.profitBaseIls)}.` : null,
    },
  });

  const c = Y.costs;
  const perTrade = Y.trades ? c.commission.usd / Y.trades : null;
  const strip = h('div', { class: 'strip' },
    hero,
    kpi({ label: 'עמלות מסחר', value: orig(c.commission), size: 'sm', ctx: `${Y.trades} עסקאות${perTrade ? ` · ${usd(perTrade, { digits: 2 })} לעסקה` : ''}` }),
    kpi({ label: 'מס רווח הון (נטו)', value: c.cgTax.total === null ? '—' : ils(c.cgTax.total), size: 'sm', ctx: `שולם ${ils(Y.tax.paid)} · זוכה ${ils(Y.tax.credit)}`,
      trace: { title: `מס רווח הון ${year}`, total: c.cgTax.total ?? undefined, totalText: c.cgTax.total === null ? '—' : ils(c.cgTax.total),
        formula: 'לכל תיק: "מס לשלם" פחות זיכויי "מגן מס" — כמו שהברוקר מחשב (שווה לסכום אומדני המס על המכירות). תיק שיצא במינוס = זיכוי שלא נוצל: המס שלו 0, והזיכוי לא מקזז תיק אחר (מגן המס הוא לכל חשבון).',
        parts: [
          { label: 'מס ששולם ("מס לשלם")', valueText: ils(Y.tax.paid) },
          { label: 'זיכויי מגן מס (הפסדים שקיזזו)', valueText: ils(-Y.tax.credit) },
          ...(Y.tax.unusedCredit > 0.005 ? [{ label: 'זיכוי שלא נוצל (נשאר בתיק שלו)', valueText: ils(Y.tax.unusedCredit) }] : []),
        ],
        partsSum: Y.tax.paid - Y.tax.credit + Y.tax.unusedCredit } }),
    kpi({ label: 'ריבית חובה', value: orig(c.debitInterest), size: 'sm', ctx: `${c.debitInterest.n} חיובים` }),
    kpi({ label: 'מס במקור על דיבידנד', value: orig(c.divTax), size: 'sm', ctx: 'ארה"ב, 25%' }),
    kpi({ label: 'דמי טיפול', value: orig(c.mgmtFee), size: 'sm' }));

  const notes = [];
  const missY = f.missingFx.filter(d => d.startsWith(year));
  if (missY.length) notes.push(note(`חסר שער דולר–שקל ל-${missY.length} ימים ב-${year} (הראשון ${day(missY[0])}), ולכן הסכום בשקלים לא מוצג. הסכומים במטבע המקורי נכונים. השערים נמשכים במסך המיגרציה ("משיכת היסטוריה").`, { kind: 'info' }));
  if (Y.tax.unusedCredit > 0.5) notes.push(note(year === thisYear
    ? `זיכוי מס פתוח ב-${year}: ${ils(Y.tax.unusedCredit)} — הפסדים שכבר מומשו השנה. הוא יקזז מס על רווחים עד סוף השנה; מה שלא ינוצל מתאפס ב-1 בינואר (ואפשר לקזז אותו בדוח השנתי למס הכנסה).`
    : `זיכוי מס שלא נוצל ב-${year}: ${ils(Y.tax.unusedCredit)}. הברוקר איפס אותו בתחילת השנה הבאה — אפשר לקזז אותו בדוח השנתי למס הכנסה.`, { kind: 'info' }));
  const inc = Y.income;
  const incomeLine = h('p', { class: 'small muted' }, `מנגד ב-${year}: דיבידנד ברוטו ${orig(inc.dividend)}${inc.credit.n ? ` · זיכויים מהברוקר ${orig(inc.credit)}` : ''}${inc.creditInterest.n ? ` · ריבית זכות ${orig(inc.creditInterest)}` : ''}. אומדן הברוקר למס על המכירות השנה: ${ils(Y.estimatedTaxIls)}.`);

  /* ── לפי שנה ── */
  const byYear = table({
    columns: [
      { key: 'year', label: 'שנה', render: y => h('b', null, y.year) },
      { key: 'trades', label: 'עסקאות', num: true, render: y => num(String(y.trades)) },
      { key: 'comm', label: 'עמלות', num: true, render: y => num(orig(y.costs.commission)) },
      { key: 'int', label: 'ריבית חובה', num: true, render: y => num(orig(y.costs.debitInterest)) },
      { key: 'tax', label: 'מס רווח הון נטו', num: true, render: y => num(y.costs.cgTax.total === null ? '—' : ils(y.costs.cgTax.total)) },
      { key: 'div', label: 'מס דיבידנד', num: true, render: y => num(orig(y.costs.divTax)) },
      { key: 'total', label: 'חיכוך', num: true, render: y => num(y.frictionIls === null ? '—' : ils(y.frictionIls)) },
      { key: 'share', label: 'מתוך הרווח', num: true, render: y => num(y.shareOfProfit === null ? (y.profitBaseIls !== null && y.profitBaseIls <= 0 ? 'שנת הפסד' : '—') : pct(y.shareOfProfit * 100, { sign: false, digits: 0 }), y.shareOfProfit > 0.5 ? 'down' : '') },
    ],
    rows: f.years.map(y => ({ ...y, id: y.year })),
    onRow: y => { year = y.year; redraw(); },
  });

  /* ── לפי נייר (השנה שנבחרה) ── */
  const bySym = table({
    columns: [
      { key: 'symbol', label: 'נייר', render: s => h('span', { class: 'sym' }, s.symbol) },
      { key: 'trades', label: 'עסקאות', num: true, render: s => num(String(s.trades)) },
      { key: 'comm', label: 'עמלות', num: true, render: s => num(usd(s.commissionUsd)) },
      { key: 'real', label: 'רווח ממומש ברוטו', num: true, render: s => num(usd(s.realizedUsd, { sign: true }), s.realizedUsd > 0 ? 'up' : s.realizedUsd < 0 ? 'down' : '') },
      { key: 'eat', label: 'עמלות מתוך הרווח', num: true, render: s => num(s.realizedUsd > 0 ? pct((s.commissionUsd / s.realizedUsd) * 100, { sign: false, digits: 0 }) : '—') },
    ],
    rows: Y.symbols.slice(0, 25).map(s => ({ ...s, id: s.symbol })),
  });

  const byPort = portfolio === 'all' && Y.portfolios.length > 1 ? h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, `לפי תיק · ${year}`)),
    h('div', { class: 'panel-b flush' }, table({
      columns: [
        { key: 'portfolio', label: 'תיק' },
        { key: 'comm', label: 'עמלות', num: true, render: p => num(orig(p.commission)) },
        { key: 'int', label: 'ריבית חובה', num: true, render: p => num(orig(p.debitInterest)) },
        { key: 'tax', label: 'מס רווח הון נטו', num: true, render: p => num(p.cgTax.total === null ? '—' : ils(p.cgTax.total)) },
        { key: 'total', label: 'סה"כ', num: true, render: p => num(Y.costsComplete ? ils(p.totalIls) : '—') },
      ],
      rows: Y.portfolios.map(p => ({ ...p, id: p.portfolio })),
    }))) : null;

  mount(el,
    head(tools), strip, ...notes, incomeLine,
    h('section', { class: 'panel' },
      h('div', { class: 'panel-h' }, h('h2', null, 'לפי שנה'), h('span', { class: 'chart-note' }, 'לחיצה על שנה = הפירוט שלה')),
      h('div', { class: 'panel-b flush' }, byYear)),
    h('div', { class: byPort ? 'grid cols-2' : '' },
      h('section', { class: 'panel' },
        h('div', { class: 'panel-h' }, h('h2', null, `עמלות לפי נייר · ${year}`), h('span', { class: 'chart-note' }, `${Y.symbols.length} ניירות`)),
        h('div', { class: 'panel-b flush' }, bySym)),
      byPort),
    h('p', { class: 'small muted' },
      'עמלה היא עמודה על שורת העסקה, לא שורה משלה. מס רווח הון הוא נטו: הברוקר גובה מס על רווח ומחזיר ("מגן מס") כשהפסד מקזז אותו — ',
      'נמדד על כל השורות שהתשלום פחות הזיכויים שווה בדיוק לאומדן שלו. באלטשולר הדיבידנד מדווח נטו, ולכן המס עליו (סכום קטן) לא מופיע כאן.'));
}
