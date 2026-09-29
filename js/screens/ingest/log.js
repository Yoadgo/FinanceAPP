/* ================================================================
   LOG — יומן הקליטות. המקום היחיד שמספר מה נכנס למערכת, מתי, ממה
   ומי. ביטול קליטה לא מוחק: השורות מסומנות voided ונעלמות מהתצוגה,
   ורשומת הקליטה מסומנת "בוטלה" — ההיסטוריה נשארת.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, table, chip } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { day } from '../../core/format.js';
import { hrefOf } from '../../core/routes.js';
import { session } from '../../core/auth.js';
import * as store from '../../core/store.js';
import { clearSpendCache } from '../spend/data.js';

export async function render(el, ctx) {
  mount(el, head(ctx), loading('table'));
  let rows;
  try { rows = await store.list('imports', { includeVoided: true }); }
  catch (e) { mount(el, head(ctx), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  if (!rows.length) {
    mount(el, head(ctx), emptyState({ title: 'עוד לא נקלט אף קובץ', text: 'כל קובץ שייקלט יופיע כאן: שם, סוג, כמה שורות נוספו וכמה דולגו, מי קלט ומתי.', actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'upload') }, 'לקליטת קובץ')] }));
    return;
  }
  const ts = r => (r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis() : 0);
  rows.sort((a, b) => ts(b) - ts(a));
  mount(el, head(ctx), table({
    columns: [
      { key: 'when', label: 'מתי', render: r => num(r.createdAt && r.createdAt.toDate ? day(r.createdAt.toDate().toISOString()) : '—') },
      { key: 'who', label: 'מי', render: r => session.nameOf(r.createdBy) },
      { key: 'fileName', label: 'קובץ' },
      { key: 'kind', label: 'סוג', render: r => ({ credit: 'אשראי', bank: 'עו"ש' }[r.kind] || r.kind) },
      { key: 'period', label: 'תקופה', render: r => r.billingMonth || (r.range ? `${day(r.range.from)}–${day(r.range.to)}` : '') },
      { key: 'added', label: 'נוספו', num: true, render: r => num(String(r.added ?? 0)) },
      { key: 'skipped', label: 'דולגו', num: true, render: r => num(String(r.skipped ?? 0)) },
      { key: 'status', label: 'מצב', render: r => r.voided ? chip('בוטלה', 'down') : r.status === 'ok' ? chip('נקלט', 'up') : chip(r.status, 'attn') },
      { key: 'act', label: '', render: r => (!r.voided && r.status === 'ok') ? undoButton(r, el, ctx) : '' },
    ],
    rows,
  }));
}

function head(ctx) { return h('div', { class: 'world-head' }, h('h1', null, 'יומן קליטות'), h('span', { class: 'question' }, ctx.world.question)); }

/* ביטול בשני שלבים בתוך הדף — בלי חלון אישור של הדפדפן. */
function undoButton(r, el, ctx) {
  const b = h('button', { class: 'btn sm ghost' }, 'ביטול קליטה');
  let armed = false;
  b.addEventListener('click', async e => {
    e.stopPropagation();
    if (!armed) { armed = true; b.textContent = `לסמן ${r.added} שורות כמבוטלות?`; setTimeout(() => { armed = false; b.textContent = 'ביטול קליטה'; }, 5000); return; }
    b.disabled = true; b.textContent = 'מבטל…';
    try { const n = await voidImport(r.id); toast(`בוטלה: ${n} שורות סומנו כמבוטלות.`); render(el, ctx); }
    catch (err) { b.disabled = false; toast(`הביטול נכשל: ${err.message || err}`); }
  });
  return b;
}

export async function voidImport(importId) {
  const rec = await store.get('imports', importId);
  const coll = rec && rec.kind === 'bank' ? 'bank' : 'expenses';
  const rows = await store.listWhere(coll, 'source.importId', '==', importId);
  const uid = session.user ? session.user.uid : null;
  const at = new Date().toISOString();
  await store.patchMany(coll, rows.filter(r => !r.voided).map(r => ({ id: r.id, fields: { voided: true, voidedBy: uid, voidedAt: at } })));
  clearSpendCache();
  await store.patch('imports', importId, { voided: true, voidedBy: uid, voidedAt: at });
  return rows.length;
}
