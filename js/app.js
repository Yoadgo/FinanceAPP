/* ================================================================
   APP — נקודת הכניסה. שלושה תפקידים בלבד:
     1. לבדוק שיש הגדרה, ולהריץ את שער הכניסה.
     2. לצייר את השלד: סרגל עליון, סרגל תחתון (מובייל), אזור תוכן.
     3. לנתב: כתובת ← עולם ← תת-מסך ← טעינת קובץ המסך.
   אין כאן לוגיקה של כסף ואין כאן גישה לנתונים.

   חוזה של קובץ מסך: export async function render(el, ctx)
     el  — הקונטיינר שהמסך מצייר לתוכו
     ctx — { world, sub, go(worldId, subId) }
   ================================================================ */
import { isConfigured } from './config.js';
import { h, mount } from './ui/dom.js';
import { WORLDS, parseHash, hrefOf, STAGE_NAMES } from './core/routes.js';
import { emptyState, errorState, loading } from './ui/components.js';
import * as gate from './ui/gate.js';

const root = document.getElementById('root');

async function boot() {
  if (!isConfigured()) { gate.renderSetupNeeded(root); return; }
  let auth;
  try {
    auth = await import('./core/auth.js');
  } catch (e) {
    /* ה-SDK של גוגל לא נטען (רשת, חוסם פרסומות). אומרים את זה, לא מסך לבן. */
    gate.renderGateError(root, new Error('לא ניתן לטעון את Firebase. בדוק חיבור לאינטרנט או חוסם תוכן, ורענן.'), () => location.reload());
    return;
  }
  auth.watchAuth(({ state, user, error }) => {
    if (state === 'signed-out') gate.renderSignIn(root, auth.signIn);
    else if (state === 'not-member') gate.renderNotMember(root, user, auth.signOutNow);
    else if (state === 'no-household') gate.renderNoHousehold(root, user, auth.signOutNow);
    else if (state === 'error') gate.renderGateError(root, error, () => location.reload());
    else if (state === 'member') startShell(user, auth.signOutNow);
  });
}

/* ── השלד ── */
let viewEl = null, navEls = [];

function startShell(user, onSignOut) {
  const worldLinks = WORLDS.map(w => h('a', { href: hrefOf(w.id), dataset: { world: w.id } }, h('span', { class: `wdot ${w.dot}` }), w.label));
  const tabLinks = WORLDS.map(w => h('a', { href: hrefOf(w.id), dataset: { world: w.id } }, h('span', { class: `wdot ${w.dot}` }), w.short));
  navEls = [...worldLinks, ...tabLinks];

  const avatar = user.photo ? h('img', { src: user.photo, alt: '', referrerpolicy: 'no-referrer' }) : null;
  const userChip = h('div', { class: 'userchip' }, avatar, h('span', { class: 'name' }, user.name),
    h('button', { class: 'btn sm ghost', onclick: async () => { try { (await import('./core/live.js')).stop(); } catch (e) { /* לא קריטי */ } onSignOut(); } }, 'יציאה'));

  const ticker = h('div', { class: 'ticker', 'aria-label': 'מדדים ומחירים' }, h('span', { class: 'tick note' }, 'טוען מחירים…'));
  viewEl = h('main', { class: 'view', id: 'view', tabindex: '-1' });
  mount(root, h('div', { class: 'app' },
    h('header', { class: 'topbar' },
      h('div', { class: 'row1' },
        h('a', { class: 'brand', href: '#/home' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'FinanceAPP'),
        h('nav', { class: 'worldnav', 'aria-label': 'עולמות' }, worldLinks),
        userChip),
      ticker),
    viewEl,
    h('nav', { class: 'tabbar', 'aria-label': 'עולמות' }, tabLinks)));
  fillTicker(ticker);

  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  route();
}

/* ── ניתוב ── */
let routeSeq = 0;

async function route() {
  const seq = ++routeSeq;
  const { world, sub } = parseHash(location.hash);
  navEls.forEach(a => { if (a.dataset.world === world.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });

  const ctx = { world, sub, go: (w, s) => { location.hash = hrefOf(w, s); } };

  let target;
  if (world.subs) {
    const rail = h('nav', { class: 'subrail', 'aria-label': world.label },
      h('div', { class: 'eyebrow' }, world.label),
      world.subs.map(s => h('a', { href: hrefOf(world.id, s.id), 'aria-current': s.id === sub.id ? 'page' : null },
        h('span', null, s.label), s.load ? null : h('span', { class: 'soon' }, `שלב ${s.stage}`))));
    target = h('div', { class: 'world-body' });
    mount(viewEl, h('div', { class: 'world' }, rail, target));
  } else {
    target = h('div', { class: 'world-body' });
    mount(viewEl, target);
  }
  mount(target, loading('card'));

  const screen = world.subs ? sub : world;
  if (!screen.load) { if (seq === routeSeq) mount(target, planned(world, sub)); return; }
  try {
    const mod = await screen.load();
    if (seq !== routeSeq) return;             // המשתמש כבר עבר למסך אחר
    target.replaceChildren();
    await mod.render(target, ctx);
  } catch (e) {
    console.error(e);
    if (seq === routeSeq) mount(target, errorState({ title: 'המסך לא נטען', error: e, onRetry: route }));
  }
}

/* שורת המדדים: המדד, הנאסד"ק, הדולר, ואז שאר הניירות. מנויה לשירות
   המחירים החיים (core/live.js): כל עדכון מצייר אותה מחדש, ומחיר שזז
   מהבהב בירוק/אדום. בלי גיליון — אומרים את זה, לא מציגים מספרים ריקים. */
const TICKER_FIRST = ['IVV', 'QQQ'];
const lastPx = {};
let tickerUnsub = null;
async function fillTicker(el) {
  try {
    const live = await import('./core/live.js');
    const { SESSION_LABEL } = await import('./engines/marketHours.js');
    if (tickerUnsub) tickerUnsub();
    tickerUnsub = live.subscribe(snap => drawTicker(el, snap, SESSION_LABEL));
  } catch (e) {
    mount(el, h('span', { class: 'tick note' }, 'המחירים לא נטענו'));
  }
}

function drawTicker(el, snap, SESSION_LABEL) {
  const data = snap.data;
  if (!data || !data.prices || !Object.keys(data.prices).length) {
    mount(el, h('span', { class: 'tick note' }, snap.refreshError ? `המחירים לא נטענו · ${snap.refreshError}` : 'טוען מחירים…'));
    return;
  }
  const syms = [...TICKER_FIRST.filter(s => data.prices[s]), ...Object.keys(data.prices).filter(s => !TICKER_FIRST.includes(s)).sort()];
  const tick = (sym, px, ch, digits = 2, src) => {
    const prev = lastPx[sym];
    lastPx[sym] = px;
    const flash = prev && px !== prev ? (px > prev ? ' flash-up' : ' flash-down') : '';
    return h('span', { class: `tick${flash}${src === 'live' ? ' is-live' : ''}` },
      h('span', { class: 'sym' }, sym),
      h('span', { class: 'px', dir: 'ltr' }, px.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })),
      ch === null || ch === undefined ? null : h('span', { class: `ch ${ch > 0 ? 'up' : ch < 0 ? 'down' : ''}`, dir: 'ltr' }, `${ch > 0 ? '▲' : ch < 0 ? '▼' : ''} ${Math.abs(ch).toFixed(2)}%`));
  };
  const P = s => data.prices[s];
  const items = syms.slice(0, 2).map(s => tick(s, P(s).price, P(s).changePct, 2, P(s).src));
  if (data.fx && data.fx.USDILS) items.push(tick('USD/ILS', data.fx.USDILS.rate, null, 3));
  syms.slice(2).forEach(s => items.push(tick(s, P(s).price, P(s).changePct, 2, P(s).src)));

  /* מצב המקור: חי (Finnhub) / מושהה / גיליון בלבד */
  const liveOn = snap.status === 'live' && snap.session === 'open';
  const t = snap.lastQuoteAt ? new Date(snap.lastQuoteAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
  const state = liveOn
    ? h('span', { class: 'asof live', title: 'מחירים בזמן אמת מ-Finnhub' }, h('i', { class: 'live-dot' }), `חי · ${t}`)
    : h('a', { class: 'asof', href: '#/ingest/prices', title: 'מקורות מחיר' },
      snap.session === 'open' ? (snap.hasKey ? (snap.error || 'ממתין לעדכון') : 'עיכוב ~20 דק׳ · לחיבור זמן אמת') : `${SESSION_LABEL[snap.session]} · נכון ל-${String(data.asOf || '').split('-').reverse().join('.')}`);
  mount(el, ...items, state);
}

/* מסך שעוד לא נבנה: אומר מה יהיה כאן ובאיזה שלב. */
function planned(world, sub) {
  return h('div', { class: 'world-body' },
    h('div', { class: 'world-head' }, h('h1', null, sub.label), h('span', { class: 'question' }, world.question)),
    emptyState({
      title: `נבנה בשלב ${sub.stage} — ${STAGE_NAMES[sub.stage]}`,
      text: 'המסך הזה מתוכנן באפיון ויופיע כשהשלב שלו ייפתח. עד אז אין כאן נתונים, ובכוונה — לא מציגים מספר שלא ניתן להסביר.',
    }));
}

boot();
