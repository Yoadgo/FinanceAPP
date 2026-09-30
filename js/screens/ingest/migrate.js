/* ================================================================
   MIGRATE — מעבר חד-פעמי מגיליון StocksData (שלב 2).

   שלושה קבצי CSV מהגיליון הישן (קובץ ← הורדה ← CSV, מהטאב הפעיל):
     Transactions       — חובה. 1,660 תנועות ההשקעה.
     USD_ILS            — רשות. שערים יומיים מ-2022 (גם בגיליון המחירים).
     Rules              — רשות. כללי הסיווג (אם לא — זורעים את כללי הזרע).

   כלום לא נכתב עד שכל הבדיקות ירוקות ויועד לוחץ "כתיבה". הכתיבה
   אידמפוטנטית: מזהה כל מסמך נגזר מהתוכן, והרצה חוזרת כותבת על אותם
   מסמכים. מסמך שקיים במסד ולא קיים יותר בגיליון מוצג — לא נמחק בשקט.

   השער של שלב 2: לכל תיק ולכל נייר, הכמות והעלות בטבלת הפוזיציות
   שוות לדוח הברוקר האחרון. פער אחד עוצר את השלב הבא.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { errorState, table, chip, note, loading } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { usd, qty as fq, day } from '../../core/format.js';
import { analyzeTransactions, analyzeFx } from '../../engines/migration.js';
import { analyzeSpend } from '../../engines/migrateSpend.js';
import { clearSpendCache } from '../spend/data.js';
import { yearDocsFromSeries } from '../../engines/fx.js';
import { seedRuleDocs } from '../../engines/merchants.js';
import { parseCsv, toObjects } from '../../ingest/csv.js';
import { docId } from '../../engines/hash.js';
import * as store from '../../core/store.js';
import { clearInvestCache } from '../invest/data.js';
import { refreshHistory } from '../../core/market.js';
import { PRICES_URL } from '../../config.js';

const S = { tx: null, fx: null, rules: null, txName: '', fxName: '', rulesName: '', existing: null };
/* חלק ב': הוצאות ועו"ש (טאבים Expenses · Bank · Categories · Imports) */
const P = { texts: {}, names: {}, result: null, busy: false };

export async function render(el, ctx) {
  mount(el, head(), loading('card'));
  try {
    S.existing = await store.count('transactions');
  } catch (e) { mount(el, head(), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  draw(el, ctx);
}

function head() {
  return h('div', { class: 'world-head' }, h('h1', null, 'מיגרציה מהגיליון'), h('span', { class: 'question' }, 'שלב 2 · חד-פעמי · שום דבר לא נכתב לפני אישור'));
}

function picker(id, label, hint, onText) {
  const input = h('input', { id, type: 'file', accept: '.csv,text/csv' });
  const zone = h('label', { class: 'dropzone', for: id },
    h('b', null, label), h('span', { class: 'small muted' }, hint), input);
  const handle = async f => { if (f) onText(f.name, await f.text()); };
  input.addEventListener('change', () => handle(input.files[0]));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); handle(e.dataTransfer.files[0]); });
  return zone;
}

function checksList(checks) {
  return h('div', { style: { display: 'grid', gap: '4px' } }, checks.map(c =>
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline' } },
      chip(c.pass ? 'עבר' : 'נכשל', c.pass ? 'up' : 'down'), h('span', null, c.text))));
}

function draw(el, ctx) {
  const redraw = () => draw(el, ctx);
  const steps = h('ol', { class: 'small', style: { margin: 0, paddingInlineStart: '20px', display: 'grid', gap: '4px' } },
    h('li', null, 'לפתוח את StocksData, לעמוד על הטאב Transactions, ואז: קובץ ← הורדה ← ערכים מופרדים בפסיקים (CSV).'),
    h('li', null, 'רשות: אותו דבר לטאב USD_ILS. אם גיליון המחירים מחובר — השערים נמשכים ממנו, מ-2022.'),
    h('li', null, 'רשות: אותו דבר לטאב Rules (כללי הסיווג). בלעדיו נזרעים 30 כללי הזרע.'),
    h('li', null, 'לגרור את הקבצים לכאן. הבדיקות רצות מיד, בדפדפן, ושום דבר לא נשלח עד הלחיצה על "כתיבה".'));

  const pickers = h('div', { class: 'grid cols-3' },
    picker('mg-tx', S.txName || 'Transactions.csv', S.tx ? `${S.tx.total} שורות` : 'חובה', (n, t) => { S.txName = n; S.tx = analyzeTransactions(t); redraw(); }),
    picker('mg-fx', S.fxName || 'USD_ILS.csv', S.fx ? `${S.fx.series.length} שערים` : 'רשות', (n, t) => { S.fxName = n; S.fx = analyzeFx(t); redraw(); }),
    picker('mg-rules', S.rulesName || 'Rules.csv', S.rules ? `${S.rules.length} כללים` : 'רשות', (n, t) => { S.rulesName = n; S.rules = parseRules(t); redraw(); }));

  const blocks = [head(), h('div', { class: 'card', style: { display: 'grid', gap: '12px' } }, h('span', { class: 'eyebrow' }, 'איך'), steps), pickers];
  /* נעילה (30.9): אחרי שהתנועות הועברו, המקור שלהן הוא קבצי איביאי ולא
     הגיליון. הרצה חוזרת של חלק התנועות הייתה (1) מחזירה לחיים שורות
     שביטלת, (2) מחזירה אומדני מס ישנים, ו-(3) משכפלת שורות שנקלטו
     מאיביאי — כי הגיליון והקליטה בונים את המזהה אחרת. השערים והכללים
     עדיין נכתבים. */
  if (S.existing) blocks.push(note(`במסד כבר יש ${S.existing.toLocaleString('en-US')} תנועות, ולכן חלק התנועות נעול: מעכשיו הן נכנסות רק דרך קליטת קובץ איביאי. שערים וכללים עדיין נכתבים מכאן.`, { kind: 'info' }));

  if (S.tx) blocks.push(txReport(S.tx));
  if (S.fx) blocks.push(h('div', { class: 'card', style: { display: 'grid', gap: '10px' } },
    h('div', { class: 'card-title' }, 'שערי דולר–שקל'), checksList(S.fx.checks),
    h('div', { class: 'small muted' }, `${day(S.fx.first)} → ${day(S.fx.last)}`)));

  const txLocked = S.existing > 0;
  const ready = txLocked ? (S.fx && S.fx.checks.every(c => c.pass))
    : (S.tx && S.tx.checks.every(c => c.pass) && (!S.fx || S.fx.checks.every(c => c.pass)));
  const btn = h('button', { class: 'btn primary', disabled: ready ? null : true }, 'כתיבה למסד');
  const progress = h('span', { class: 'small muted' });
  btn.addEventListener('click', () => write(btn, progress, redraw));
  blocks.push(h('div', { class: 'card', style: { display: 'grid', gap: '10px' } },
    h('div', { class: 'card-title' }, 'כתיבה'),
    ready ? h('p', { class: 'small' }, summaryLine()) : h('p', { class: 'small muted' }, 'הכפתור נפתח רק כשכל הבדיקות של התנועות (ושל השערים, אם הועלו) ירוקות.'),
    h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, btn, progress)));

  /* היסטוריית מחירים ושערים מגיליון המחירים — לגרפים ולניתוח מול המדד */
  const hbtn = h('button', { class: 'btn', disabled: PRICES_URL ? null : true }, 'משיכת היסטוריה');
  const hprog = h('span', { class: 'small muted' });
  hbtn.addEventListener('click', async () => {
    hbtn.disabled = true; hprog.textContent = 'מושך את הגיליון (כ-1.5MB)…';
    try {
      const r = await refreshHistory({ onProgress: (d, t) => { hprog.textContent = `נכתבו ${d} / ${t} מסמכים`; } });
      clearInvestCache();
      hprog.textContent = '';
      toast(`נמשכה היסטוריה ל-${r.symbols} ניירות ושער הדולר (${r.docs} מסמכים).${r.problems.length ? ' ' + r.problems[0] : ''}`);
    } catch (e) { hprog.textContent = ''; toast(`המשיכה נכשלה: ${e.message || e}`, { ms: 12000 }); }
    hbtn.disabled = false;
  });
  blocks.push(h('div', { class: 'card', style: { display: 'grid', gap: '10px' } },
    h('div', { class: 'card-title' }, 'היסטוריית מחירים ושערים'),
    h('p', { class: 'small' }, PRICES_URL
      ? 'סגירות יומיות מינואר 2022 לכל הניירות ולדולר–שקל, מהגיליון "FinanceAPP — מחירים". נכתבות למסד, ומשם לגרפים ולניתוח מול המדד. אפשר להריץ שוב בכל זמן.'
      : 'גיליון המחירים עוד לא מחובר (PRICES_URL ב-config.js).'),
    h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, hbtn, hprog)));

  blocks.push(spendBlock(redraw));
  mount(el, ...blocks);
}

/* ── חלק ב': הוצאות ועו"ש ── ההחלטות שכבר קיבלת ב-v3 (362 שורות
   מסווגות) עוברות כמו שהן. מזהי המסמכים זהים לקליטה רגילה, ולכן
   העלאה עתידית של אותם קבצים לא תשכפל. שורה שכבר קיימת במסד לא
   נדרסת — כדי שסיווג שעשית כאן לא יימחק בהרצה חוזרת. */
function spendBlock(redraw) {
  const pick = (key, file, hint) => picker(`mg-sp-${key}`, P.names[key] || file, P.texts[key] ? 'נטען' : hint, async (n, t) => {
    P.names[key] = n; P.texts[key] = t;
    P.result = P.texts.expenses || P.texts.bank ? await analyzeSpend(P.texts) : null;
    redraw();
  });
  const parts = [
    h('div', { class: 'card-title' }, 'הוצאות ועו"ש מהגיליון'),
    h('p', { class: 'small muted' }, 'אותה דרך: לעמוד על הטאב ב-StocksData ← קובץ ← הורדה ← CSV. Expenses ו-Bank הם העיקר; Categories ו-Imports משלימים (רשימת הקטגוריות, ויומן הקבצים שכבר נקלטו).'),
    h('div', { class: 'grid cols-4' }, pick('expenses', 'Expenses.csv', 'שורות אשראי'), pick('bank', 'Bank.csv', 'עו"ש'), pick('categories', 'Categories.csv', 'רשות'), pick('imports', 'Imports.csv', 'רשות')),
    h('p', { class: 'small muted' }, S.rules ? `כללי הסיווג: ${S.rules.length} מ-Rules.csv (למעלה) ייכתבו גם כאן.` : 'כללי הסיווג: אם העלית Rules.csv למעלה — הם ייכתבו גם כאן. בלי זה נזרעים 30 כללי הזרע.'),
  ];
  const r = P.result;
  if (r) {
    parts.push(checksList(r.checks));
    if (r.bad.length) parts.push(table({ columns: [{ key: 'tab', label: 'טאב' }, { key: 'row', label: 'שורה' }, { key: 'p', label: 'הבעיה' }], rows: r.bad.slice(0, 30).map((b, i) => ({ id: i, tab: b.tab, row: b.row, p: b.problems.join(' · ') })) }));
    const ST = { ok: 'מאושרות', auto: 'אוטומטיות', pending: 'בהמתנה' };
    const st = o => Object.entries(o).map(([k, v]) => `${v} ${ST[k] || k}`).join(' · ');
    parts.push(h('p', { class: 'small' }, `אשראי: ${r.summary.expenses} שורות (${st(r.summary.expStatus)}) · עו"ש: ${r.summary.bank} (${st(r.summary.bankStatus)}) · ${r.summary.categories} קטגוריות · ${r.summary.imports} קבצים ביומן`));
    if (r.summary.byBilling.length) parts.push(h('p', { class: 'small muted' }, 'סכום הפירוט לפי חודש חיוב: ', r.summary.byBilling.map(([m, v]) => num(`${m} ${usdless(v)}`)).reduce((a, x, i) => (i ? [...a, ' · ', x] : [x]), [])));
    const ready = r.checks.every(c => c.pass);
    const btn = h('button', { class: 'btn primary', disabled: ready && !P.busy ? null : true }, 'כתיבת ההוצאות והעו"ש');
    const prog = h('span', { class: 'small muted' });
    btn.addEventListener('click', () => writeSpend(btn, prog, redraw));
    parts.push(h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, btn, prog));
  }
  return h('div', { class: 'card', style: { display: 'grid', gap: '12px' } }, parts);
}

const usdless = v => `₪${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function writeSpend(btn, prog, redraw) {
  const r = P.result;
  P.busy = true; btn.disabled = true;
  try {
    prog.textContent = 'בודק מה כבר במסד…';
    const [ex, bk, im, cats] = await Promise.all([store.list('expenses', { includeVoided: true }), store.list('bank', { includeVoided: true }), store.list('imports', { includeVoided: true }), store.list('categories', { includeVoided: true })]);
    const has = list => new Set(list.map(d => d.id));
    const exIds = has(ex), bkIds = has(bk), imIds = has(im);
    const catKeys = new Set(cats.map(c => `${c.category}|${c.subcategory || ''}`));
    const newE = r.expenses.filter(x => !exIds.has(x.id));
    const newB = r.bank.filter(x => !bkIds.has(x.id));
    const newI = r.imports.filter(x => !imIds.has(x.id));
    const newC = [];
    for (const c of r.categories) {
      const k = `${c.category}|${c.subcategory}`;
      if (!catKeys.has(k)) newC.push({ id: await docId('c', k), data: c });
    }
    if (newC.length) { prog.textContent = 'קטגוריות…'; await store.putMany('categories', newC); }
    await store.putMany('expenses', newE, { onProgress: (d, t) => { prog.textContent = `אשראי: ${d} / ${t}`; } });
    await store.putMany('bank', newB, { onProgress: (d, t) => { prog.textContent = `עו"ש: ${d} / ${t}`; } });
    if (newI.length) { prog.textContent = 'יומן קבצים…'; await store.putMany('imports', newI); }
    /* כללי הסיווג — רק אם עוד אין במסד (כלל שיועד יצר כאן לא נדרס) */
    const existingRules = await store.list('rules', { includeVoided: true });
    let nRules = 0;
    if (!existingRules.length) {
      const rules = S.rules || seedRuleDocs();
      await store.putMany('rules', rules.map(({ id, ...data }) => ({ id: String(id), data })));
      nRules = rules.length;
    }
    clearSpendCache();
    prog.textContent = '';
    const skipped = (r.expenses.length - newE.length) + (r.bank.length - newB.length);
    toast(`נכתבו ${newE.length} שורות אשראי, ${newB.length} עו"ש, ${newC.length} קטגוריות, ${newI.length} קבצים ביומן${nRules ? `, ${nRules} כללים` : ''}.${skipped ? ` ${skipped} שורות כבר היו במסד ולא נדרסו.` : ''}`, { ms: 12000 });
  } catch (e) {
    prog.textContent = '';
    toast(`הכתיבה נעצרה: ${e.message || e}. מה שנכתב נשאר; הרצה חוזרת משלימה בלי לדרוס.`, { ms: 15000 });
  }
  P.busy = false; btn.disabled = false;
  redraw();
}

function summaryLine() {
  const rules = S.rules ? `${S.rules.length} כללים מהגיליון` : '30 כללי זרע';
  const years = S.fx ? yearDocsFromSeries(S.fx.series).length : 0;
  const fx = S.fx ? ` · ${S.fx.series.length.toLocaleString('en-US')} שערים ב-${years} מסמכי שנה` : '';
  const n = S.existing > 0 || !S.tx ? 0 : S.tx.items.length;       // נעול → 0 תנועות
  return `ייכתבו: ${n.toLocaleString('en-US')} תנועות${fx} · ${rules}. עלות משוערת: ${(n + years + (S.rules ? S.rules.length : 30)).toLocaleString('en-US')} כתיבות מתוך 20,000 ביום.`;
}

function txReport(a) {
  const parts = [h('div', { class: 'card-title' }, 'תנועות — ארבע בדיקות'), checksList(a.checks)];
  if (a.bad.length) parts.push(h('div', null, h('div', { class: 'eyebrow' }, 'שורות עם בעיה'),
    table({ columns: [{ key: 'row', label: 'שורה בגיליון' }, { key: 'p', label: 'הבעיה' }], rows: a.bad.slice(0, 50).map(b => ({ id: b.src._row, row: b.src._row, p: b.problems.join(' · ') })) })));
  if (a.mismatches && a.mismatches.length) parts.push(h('div', null, h('div', { class: 'eyebrow' }, 'שדות שלא שרדו את ההלוך-חזור'),
    table({ columns: [{ key: 'row', label: 'שורה' }, { key: 'field', label: 'שדה' }, { key: 'sheet', label: 'בגיליון' }, { key: 'doc', label: 'במסמך' }], rows: a.mismatches.slice(0, 50).map((m, i) => ({ id: i, ...m })) })));
  if (a.unclassified.length) parts.push(note(`${a.unclassified.length} תנועות שהמסווג לא מכיר (סוג: ${[...new Set(a.unclassified.map(r => r.Type))].join(', ')}). הן ייכתבו, ויסומנו "לא מסווג" במסך התנועות.`));

  if (Object.keys(a.byPortfolio).length) parts.push(h('div', null, h('div', { class: 'eyebrow' }, 'לפי תיק'),
    table({ columns: [
      { key: 'p', label: 'תיק' }, { key: 'rows', label: 'שורות', num: true, render: r => num(r.rows.toLocaleString('en-US')) },
      { key: 'first', label: 'מ-', render: r => num(day(r.first)) }, { key: 'last', label: 'עד', render: r => num(day(r.last)) },
      { key: 'commission', label: 'עמלות', num: true, render: r => num(usd(r.commission)) }],
    rows: Object.entries(a.byPortfolio).map(([p, b]) => ({ id: p, p, ...b })) })));

  if (a.positions.length) parts.push(h('div', null,
    h('div', { class: 'eyebrow' }, 'פוזיציות פתוחות — להשוואה מול דוח הברוקר (השער של שלב 2)'),
    table({ columns: [
      { key: 'portfolio', label: 'תיק' }, { key: 'symbol', label: 'נייר', render: p => h('b', null, p.symbol) },
      { key: 'qty', label: 'כמות', num: true, render: p => num(fq(p.qty)) },
      { key: 'avg', label: 'עלות ממוצעת', num: true, render: p => num(usd(p.avgCost, { digits: 2 })) },
      { key: 'cost', label: 'עלות', num: true, render: p => num(usd(p.totalCost)) }],
    rows: a.positions.map(p => ({ ...p, id: `${p.portfolio}|${p.symbol}` })) }),
    h('p', { class: 'small muted' }, 'להשוות כל שורה לדוח האחזקות העדכני של איביאי (ושל אלטשולר). כמות — בדיוק. עלות — עד סנטים בודדים.')));
  return h('div', { class: 'card', style: { display: 'grid', gap: '12px' } }, parts);
}

/* טאב Rules של הגיליון הישן → מסמכי rules */
function parseRules(text) {
  const { objects } = toObjects(parseCsv(text));
  return objects.filter(o => String(o.Pattern || '').trim()).map((o, i) => ({
    id: String(o.Id || `R${String(i + 1).padStart(4, '0')}`).trim(),
    active: String(o.Active).toLowerCase() !== 'false',
    priority: Number(o.Priority) || 100,
    field: String(o.Field || 'merchant').trim() || 'merchant',
    match: String(o.Match || 'contains').trim() || 'contains',
    pattern: String(o.Pattern).trim(), card: String(o.Card || '').trim(),
    category: String(o.Category || '').trim(), subcategory: String(o.Subcategory || '').trim(),
    source: String(o.Source || 'sheet').trim() || 'sheet',
  }));
}

async function write(btn, progress, redraw) {
  btn.disabled = true;
  try {
    progress.textContent = 'מכין מזהים…';
    const items = S.existing > 0 || !S.tx ? [] : await Promise.all(S.tx.items.map(async it => ({ id: await docId('t', it.key, it.occ), data: it.doc })));

    /* מסמכים במסד שכבר לא קיימים בגיליון — מראים, לא מוחקים */
    const existing = S.existing && items.length ? await store.list('transactions') : [];
    const newIds = new Set(items.map(i => i.id));
    const orphans = existing.filter(d => d.source && d.source.kind === 'sheet' && !newIds.has(d.id));

    if (items.length) await store.putMany('transactions', items, { onProgress: (d, t) => { progress.textContent = `תנועות: ${d.toLocaleString('en-US')} / ${t.toLocaleString('en-US')}`; } });
    const years = S.fx ? yearDocsFromSeries(S.fx.series) : [];
    if (years.length) await store.putMany('market', years.map(y => ({ id: `fx_${y.year}`, data: y })));
    progress.textContent = 'כללי סיווג…';
    /* כללים — רק אם עוד אין במסד. הרצה חוזרת לא מחזירה לחיים כלל
       שהשבתת, ולא דורסת כלל שיצרת כאן. */
    const haveRules = (await store.list('rules', { includeVoided: true })).length;
    const rules = haveRules ? [] : (S.rules || seedRuleDocs());
    if (rules.length) await store.putMany('rules', rules.map(({ id, ...data }) => ({ id: String(id), data })));

    clearInvestCache();
    clearSpendCache();
    if (items.length) S.existing = items.length;
    progress.textContent = '';
    toast(`נכתבו ${items.length.toLocaleString('en-US')} תנועות, ${years.length} מסמכי שערים${rules.length ? ` ו-${rules.length} כללים` : ' (הכללים שבמסד נשארו כמו שהם)'}.`);
    if (orphans.length) toast(`${orphans.length} תנועות במסד לא קיימות יותר בגיליון. בדוק אותן במסך התנועות לפני שממשיכים.`, { ms: 15000 });
    redraw();
  } catch (e) {
    progress.textContent = '';
    btn.disabled = false;
    toast(`הכתיבה נעצרה: ${e.message || e}. מה שנכתב נשאר, והרצה חוזרת תשלים בלי כפילויות.`, { ms: 15000 });
  }
}
