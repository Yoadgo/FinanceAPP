/* ================================================================
   LIVE — מחירים חיים. שירות אחד לכל האפליקציה (שורת המדדים, האחזקות).

   שתי שכבות, והחיה גוברת כשהיא חדשה יותר:
   1. הגיליון (GOOGLEFINANCE, מפורסם כ-CSV) — תמיד. בשעות המסחר מתרענן
      כל 5 דקות; מחוצה להן פעם ב-6 שעות. גוגל עצמה מעכבת עד ~20 דקות.
   2. Finnhub — זמן אמת, רק אם הוגדר מפתח (settings/pricefeed), רק
      בשעות המסחר ורק כשהלשונית גלויה. 25 בקשות בדקה לכל לשונית פתוחה —
      חצי מהמכסה החינמית (60), כדי שיועד ודרי יחד לא יחרגו.

   המפתח לא בקוד (הריפו ציבורי) אלא ב-Firestore, שרק חברי משק הבית
   קוראים. מחירים חיים לא נכתבים למסד — הם חיים רק בדפדפן.
   ================================================================ */
import * as store from './store.js';
import { latest as sheetLatest } from './market.js';
import { usSession } from '../engines/marketHours.js';
import { parseFinnhubQuote, mergeQuotes } from '../engines/quotes.js';

const RATE_PER_MIN = 25;
const TICK_MS = Math.ceil(60000 / RATE_PER_MIN);
const SHEET_OPEN_MIN = 5, SHEET_CLOSED_MIN = 360;
const FIRST = ['IVV', 'QQQ'];
const ENDPOINT = 'https://finnhub.io/api/v1/quote';

const st = {
  sheet: null, refreshError: null, live: {}, key: null, status: 'idle', error: null,
  session: usSession(), lastQuoteAt: null, priority: [], queue: [], cycle: 0,
  pausedUntil: 0, running: false, subs: new Set(), emitTimer: null,
};

export function snapshot() {
  return {
    data: mergeQuotes(st.sheet, st.live), refreshError: st.refreshError,
    status: st.status, error: st.error, session: st.session, hasKey: !!st.key, lastQuoteAt: st.lastQuoteAt,
  };
}

function emit() {
  if (st.emitTimer) return;
  st.emitTimer = setTimeout(() => { st.emitTimer = null; const s = snapshot(); st.subs.forEach(fn => { try { fn(s); } catch (e) { console.error(e); } }); }, 150);
}

/* לפני הציור הראשון של מסך: מחכים שתמונת הגיליון תיטען פעם אחת. */
export async function ready() {
  await start();
  return snapshot();
}

export function subscribe(fn) {
  st.subs.add(fn);
  fn(snapshot());
  start();
  return () => st.subs.delete(fn);
}

/* המסך שמציג אחזקות אומר אילו ניירות חשובים — הם נמשכים בכל סבב,
   השאר בכל סבב שלישי. */
export function prioritize(symbols) {
  st.priority = [...new Set((symbols || []).map(s => String(s).toUpperCase()))];
}

async function refreshSheet() {
  const maxAgeMin = st.session === 'open' ? SHEET_OPEN_MIN : SHEET_CLOSED_MIN;
  const r = await sheetLatest({ maxAgeMin });
  st.sheet = r.data || st.sheet;
  st.refreshError = r.refreshError || null;
  emit();
}

export async function loadKey() {
  try {
    const doc = await store.get('settings', 'pricefeed');
    st.key = doc && doc.provider === 'finnhub' && doc.key ? doc.key : null;
  } catch (e) { st.key = null; }
  st.status = st.key ? 'ready' : 'no-key';
  st.error = null;
  emit();
  return !!st.key;
}

/* בדיקת מפתח לפני שמירה: מבקשים מחיר אחד. */
export async function testKey(key) {
  const res = await fetch(`${ENDPOINT}?symbol=AAPL&token=${encodeURIComponent(key)}`);
  if (res.status === 401 || res.status === 403) throw new Error('המפתח נדחה על ידי Finnhub');
  if (res.status === 429) throw new Error('Finnhub: יותר מדי בקשות — נסה שוב בעוד דקה');
  if (!res.ok) throw new Error(`Finnhub החזיר ${res.status}`);
  const q = parseFinnhubQuote(await res.json());
  if (!q) throw new Error('Finnhub ענה, אבל בלי מחיר');
  return q;
}

export async function saveKey(key) {
  await testKey(key);
  const existing = await store.get('settings', 'pricefeed');
  await store.put('settings', 'pricefeed', { provider: 'finnhub', key }, { isNew: !existing });
  st.key = key; st.status = 'ready'; st.error = null; st.pausedUntil = 0;
  emit();
}

export async function removeKey() {
  await store.put('settings', 'pricefeed', { provider: '', key: '' }, { isNew: false });
  st.key = null; st.live = {}; st.status = 'no-key';
  emit();
}

function buildQueue() {
  st.cycle++;
  const all = Object.keys((st.sheet && st.sheet.prices) || {});
  const rest = st.cycle % 3 === 1 ? all : [];
  st.queue = [...new Set([...FIRST, ...st.priority, ...rest])];
}

async function pollOne() {
  if (!st.queue.length) buildQueue();
  const sym = st.queue.shift();
  if (!sym) return;
  let res;
  try { res = await fetch(`${ENDPOINT}?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(st.key)}`); }
  catch (e) { st.status = 'error'; st.error = 'אין חיבור ל-Finnhub'; st.pausedUntil = Date.now() + 30000; emit(); return; }
  if (res.status === 401 || res.status === 403) { st.status = 'bad-key'; st.error = 'המפתח נדחה — צריך להדביק מחדש'; emit(); return; }
  if (res.status === 429) { st.status = 'throttled'; st.error = 'חרגנו ממכסת הבקשות — ממתינים דקה'; st.pausedUntil = Date.now() + 60000; st.queue.unshift(sym); emit(); return; }
  if (!res.ok) return;
  const q = parseFinnhubQuote(await res.json());
  if (q) { st.live[sym] = q; st.lastQuoteAt = Date.now(); st.status = 'live'; st.error = null; emit(); }
}

let sheetTimer = null, pollTimer = null;

async function tick() {
  st.session = usSession();
  const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
  const canPoll = st.key && st.status !== 'bad-key' && st.session === 'open' && visible && Date.now() >= st.pausedUntil;
  if (canPoll) await pollOne();
  else if (st.key && st.status === 'live' && st.session !== 'open') { st.status = 'ready'; emit(); }
  pollTimer = setTimeout(tick, TICK_MS);
}

export async function start() {
  if (st.running) return;
  st.running = true;
  try { await refreshSheet(); } catch (e) { st.refreshError = e.message || String(e); emit(); }
  await loadKey();
  sheetTimer = setInterval(() => { st.session = usSession(); refreshSheet().catch(() => {}); }, 60000);
  tick();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshSheet().catch(() => {}); });
}

/* ליציאה מהחשבון */
export function stop() {
  clearInterval(sheetTimer); clearTimeout(pollTimer);
  st.running = false; st.live = {}; st.key = null; st.sheet = null;
}
