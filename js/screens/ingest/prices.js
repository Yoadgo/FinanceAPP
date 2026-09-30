/* ================================================================
   PRICES — "מקורות מחיר". מאיפה כל מחיר מגיע, ממתי, ואיך מחברים זמן אמת.

   שני מקורות:
   · הגיליון (GOOGLEFINANCE) — תמיד. עיכוב של עד ~20 דקות מגוגל, ובשעות
     המסחר האפליקציה מרעננת אותו כל 5 דקות.
   · Finnhub — זמן אמת, חינמי לשימוש אישי. דורש מפתח שיועד מדביק כאן.
     המפתח נבדק מול Finnhub לפני שמירה, ונשמר ב-settings/pricefeed
     (רק חברי משק הבית קוראים). לא בקוד — הריפו ציבורי.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { note, chip, table, loading } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import * as live from '../../core/live.js';
import { SESSION_LABEL } from '../../engines/marketHours.js';
import { usd, day } from '../../core/format.js';

let unsub = null;

export async function render(el) {
  mount(el, head(), loading('card'));
  await live.ready();
  if (unsub) unsub();
  unsub = live.subscribe(snap => {
    if (!el.isConnected) { unsub(); unsub = null; return; }
    /* לא לצייר מחדש בזמן שמקלידים מפתח */
    if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    draw(el, snap);
  });
}

function head() {
  return h('div', { class: 'world-head' }, h('h1', null, 'מקורות מחיר'), h('span', { class: 'question' }, 'מאיפה כל מחיר מגיע, ממתי, ואיך מחברים זמן אמת'));
}

const hhmm = ms => (ms ? new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

function draw(el, snap) {
  const d = snap.data || { prices: {} };
  const statusChip = {
    live: chip('חי', 'up'), ready: chip(snap.session === 'open' ? 'ממתין לעדכון' : 'מחובר · השוק סגור', 'accent'),
    'no-key': chip('לא מחובר'), 'bad-key': chip('המפתח נדחה', 'down'), throttled: chip('ממתין — מכסה', 'attn'), error: chip('שגיאה', 'down'), idle: chip('…'),
  }[snap.status] || chip(snap.status);

  const key = h('input', { class: 'btn', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'הדבק כאן את ה-API Key מ-Finnhub', style: { minWidth: '280px', fontFamily: 'var(--mono)' } });
  const save = h('button', { class: 'btn primary', type: 'button' }, snap.hasKey ? 'החלף מפתח' : 'בדיקה ושמירה');
  const msg = h('span', { class: 'small' });
  save.addEventListener('click', async () => {
    const v = key.value.trim();
    if (!/^[A-Za-z0-9]{16,40}$/.test(v)) { msg.textContent = 'זה לא נראה כמו מפתח של Finnhub (אותיות ומספרים, ~20 תווים). אם הדבקת שניים צמודים — רק ה-API Key.'; msg.style.color = 'var(--down)'; return; }
    save.disabled = true; msg.textContent = 'בודק מול Finnhub…'; msg.style.color = 'var(--muted)';
    try {
      await live.saveKey(v);
      key.value = '';
      toast('המפתח נבדק ונשמר. בשעות המסחר המחירים יתעדכנו כל דקה בערך.');
      draw(el, live.snapshot());
    } catch (e) { save.disabled = false; msg.textContent = e.message || String(e); msg.style.color = 'var(--down)'; }
  });
  const remove = snap.hasKey ? h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { await live.removeKey(); toast('המפתח הוסר. המחירים חוזרים לגיליון בלבד.'); } }, 'הסר מפתח') : null;

  const finnhub = h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'זמן אמת · Finnhub'), statusChip),
    h('div', { class: 'panel-b' },
      snap.error ? note(snap.error, { kind: 'bad' }) : null,
      h('dl', { class: 'kv' },
        h('dt', null, 'שוק ניו יורק'), h('dd', null, `${SESSION_LABEL[snap.session]} · שעות רגילות 16:30–23:00 שעון ישראל`),
        h('dt', null, 'עדכון אחרון'), h('dd', null, num(hhmm(snap.lastQuoteAt))),
        h('dt', null, 'קצב'), h('dd', null, '25 בקשות בדקה מכל לשונית פתוחה (המכסה החינמית: 60). הניירות שבתיק — בכל סבב, כלומר בערך כל דקה.'),
        h('dt', null, 'מתי פועל'), h('dd', null, 'רק כשהאתר פתוח ומוצג, ורק בשעות המסחר. מחוץ להן מוצגת הסגירה.')),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, key, save, remove),
      msg,
      snap.hasKey ? null : h('ol', { class: 'small', style: { margin: 0, paddingInlineStart: '20px', display: 'grid', gap: '4px' } },
        h('li', null, 'נרשמים ב-finnhub.io (חינם, מייל בלבד, בלי כרטיס אשראי).'),
        h('li', null, 'בלוח הבקרה מעתיקים את השורה שליד "API Key" — לא את ה-Webhook Secret.'),
        h('li', null, 'מדביקים כאן ולוחצים "בדיקה ושמירה". המפתח נבדק מול Finnhub לפני שהוא נשמר.')),
      h('p', { class: 'small muted' }, 'המפתח נשמר במסד (רק אתה ודרי יכולים לקרוא אותו), לא בקוד של האתר — הקוד ציבורי ב-GitHub.')));

  const sheetAt = d.fetchedAt ? Date.parse(d.fetchedAt) : null;
  const sheet = h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'גיליון המחירים · GOOGLEFINANCE'), snap.refreshError ? chip('לא רוענן', 'attn') : chip('מחובר', 'up')),
    h('div', { class: 'panel-b' },
      snap.refreshError ? note(`הרענון האחרון נכשל: ${snap.refreshError}`, { kind: 'info' }) : null,
      h('dl', { class: 'kv' },
        h('dt', null, 'נמשך לאחרונה'), h('dd', null, num(sheetAt ? `${day(d.asOf)} ${hhmm(sheetAt)}` : '—')),
        h('dt', null, 'רענון'), h('dd', null, 'בשעות המסחר — כל 5 דקות. אחרת — פעם ב-6 שעות.'),
        h('dt', null, 'עיכוב'), h('dd', null, 'גוגל מעכבת מחירים עד כ-20 דקות. שער הדולר מגיע תמיד מכאן.'))));

  const rows = Object.entries(d.prices || {}).map(([sym, p]) => ({ id: sym, sym, ...p })).sort((a, b) => (a.src === b.src ? a.sym.localeCompare(b.sym) : a.src === 'live' ? -1 : 1));
  const list = h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, `מחיר לכל נייר · ${rows.length}`), h('span', { class: 'chart-note' }, `${d.liveCount || 0} בזמן אמת`)),
    h('div', { class: 'panel-b flush' }, table({
      columns: [
        { key: 'sym', label: 'נייר', render: r => h('span', { class: 'sym' }, r.sym) },
        { key: 'price', label: 'מחיר', num: true, render: r => num(usd(r.price, { digits: 2 })) },
        { key: 'ch', label: 'יומי', num: true, render: r => num(r.changePct === null || r.changePct === undefined ? '—' : `${r.changePct > 0 ? '+' : ''}${Number(r.changePct).toFixed(2)}%`, r.changePct > 0 ? 'up' : r.changePct < 0 ? 'down' : '') },
        { key: 'src', label: 'מקור', render: r => (r.src === 'live' ? chip('חי', 'up') : chip('גיליון')) },
        { key: 'at', label: 'ממתי', render: r => num(r.at ? `${day(r.asOf)} ${hhmm(r.at)}` : day(r.asOf), 'muted') },
      ],
      rows,
    })));

  mount(el, head(), h('div', { class: 'grid cols-2' }, finnhub, sheet), list);
}
