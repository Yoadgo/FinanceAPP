/* ================================================================
   MIGRATE — מעבר חד-פעמי מגיליון StocksData (שלב 2).

   שלושה קבצי CSV מהגיליון הישן (קובץ ← הורדה ← CSV, מהטאב הפעיל):
     Transactions       — חובה. 1,660 תנועות ההשקעה.
     USD_ILS_History    — חובה. שערים יומיים מ-2022.
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
import { yearDocsFromSeries } from '../../engines/fx.js';
import { seedRuleDocs } from '../../engines/merchants.js';
import { parseCsv, toObjects } from '../../ingest/csv.js';
import { docId } from '../../engines/hash.js';
import * as store from '../../core/store.js';
import { clearInvestCache } from '../invest/data.js';
import { refreshHistory } from '../../core/market.js';
import { PRICES_URL } from '../../config.js';

const S = { tx: null, fx: null, rules: null, txName: '', fxName: '', rulesName: '', existing: null };

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
    h('li', null, 'רשות: אותו דבר לטאב USD_ILS_History. אם גיליון המחירים מחובר — השערים נמשכים ממנו, מ-2022.'),
    h('li', null, 'רשות: אותו דבר לטאב Rules (כללי הסיווג). בלעדיו נזרעים 30 כללי הזרע.'),
    h('li', null, 'לגרור את הקבצים לכאן. הבדיקות רצות מיד, בדפדפן, ושום דבר לא נשלח עד הלחיצה על "כתיבה".'));

  const pickers = h('div', { class: 'grid cols-3' },
    picker('mg-tx', S.txName || 'Transactions.csv', S.tx ? `${S.tx.total} שורות` : 'חובה', (n, t) => { S.txName = n; S.tx = analyzeTransactions(t); redraw(); }),
    picker('mg-fx', S.fxName || 'USD_ILS_History.csv', S.fx ? `${S.fx.series.length} שערים` : 'רשות', (n, t) => { S.fxName = n; S.fx = analyzeFx(t); redraw(); }),
    picker('mg-rules', S.rulesName || 'Rules.csv', S.rules ? `${S.rules.length} כללים` : 'רשות', (n, t) => { S.rulesName = n; S.rules = parseRules(t); redraw(); }));

  const blocks = [head(), h('div', { class: 'card', style: { display: 'grid', gap: '12px' } }, h('span', { class: 'eyebrow' }, 'איך'), steps), pickers];
  if (S.existing) blocks.push(note(`במסד כבר יש ${S.existing.toLocaleString('en-US')} תנועות. הרצה חוזרת בטוחה: אותה שורה נכתבת על אותו מסמך.`, { kind: 'info' }));

  if (S.tx) blocks.push(txReport(S.tx));
  if (S.fx) blocks.push(h('div', { class: 'card', style: { display: 'grid', gap: '10px' } },
    h('div', { class: 'card-title' }, 'שערי דולר–שקל'), checksList(S.fx.checks),
    h('div', { class: 'small muted' }, `${day(S.fx.first)} → ${day(S.fx.last)}`)));

  const ready = S.tx && S.tx.checks.every(c => c.pass) && (!S.fx || S.fx.checks.every(c => c.pass));
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

  mount(el, ...blocks);
}

function summaryLine() {
  const rules = S.rules ? `${S.rules.length} כללים מהגיליון` : '30 כללי זרע';
  const years = S.fx ? yearDocsFromSeries(S.fx.series).length : 0;
  const fx = S.fx ? ` · ${S.fx.series.length.toLocaleString('en-US')} שערים ב-${years} מסמכי שנה` : '';
  return `ייכתבו: ${S.tx.items.length.toLocaleString('en-US')} תנועות${fx} · ${rules}. עלות משוערת: ${(S.tx.items.length + years + (S.rules ? S.rules.length : 30)).toLocaleString('en-US')} כתיבות מתוך 20,000 ביום.`;
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
    const items = await Promise.all(S.tx.items.map(async it => ({ id: await docId('t', it.key, it.occ), data: it.doc })));

    /* מסמכים במסד שכבר לא קיימים בגיליון — מראים, לא מוחקים */
    const existing = S.existing ? await store.list('transactions') : [];
    const newIds = new Set(items.map(i => i.id));
    const orphans = existing.filter(d => d.source && d.source.kind === 'sheet' && !newIds.has(d.id));

    await store.putMany('transactions', items, { onProgress: (d, t) => { progress.textContent = `תנועות: ${d.toLocaleString('en-US')} / ${t.toLocaleString('en-US')}`; } });
    const years = S.fx ? yearDocsFromSeries(S.fx.series) : [];
    if (years.length) await store.putMany('market', years.map(y => ({ id: `fx_${y.year}`, data: y })));
    progress.textContent = 'כללי סיווג…';
    const rules = S.rules || seedRuleDocs();
    await store.putMany('rules', rules.map(({ id, ...data }) => ({ id: String(id), data })));

    clearInvestCache();
    S.existing = items.length;
    progress.textContent = '';
    toast(`נכתבו ${items.length.toLocaleString('en-US')} תנועות, ${years.length} מסמכי שערים ו-${rules.length} כללים.`);
    if (orphans.length) toast(`${orphans.length} תנועות במסד לא קיימות יותר בגיליון. בדוק אותן במסך התנועות לפני שממשיכים.`, { ms: 15000 });
    redraw();
  } catch (e) {
    progress.textContent = '';
    btn.disabled = false;
    toast(`הכתיבה נעצרה: ${e.message || e}. מה שנכתב נשאר, והרצה חוזרת תשלים בלי כפילויות.`, { ms: 15000 });
  }
}
