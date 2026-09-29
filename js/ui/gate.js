/* ================================================================
   GATE — המסכים שלפני הכניסה: חסרה הגדרה · כניסה · לא חבר ·
   אין משק בית · תקלה. כל אחד אומר מה קורה ומה עושים.
   ================================================================ */
import { h, mount } from './dom.js';
import { friendlyError } from './components.js';

function brand() {
  return h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'FinanceAPP');
}

function shell(root, ...content) {
  mount(root, h('div', { class: 'gate' }, h('div', { class: 'card' }, brand(), ...content)));
}

export function renderSetupNeeded(root) {
  shell(root,
    h('h1', null, 'חסרה הגדרת Firebase'),
    h('p', { class: 'muted' }, 'הקוד מוכן, אבל עוד לא מחובר לפרויקט Firebase. זה צעד חד-פעמי של שלב 1.'),
    h('ol', { class: 'small' },
      h('li', null, 'בקונסולת Firebase: הגדרות הפרויקט ← האפליקציות שלך ← Web app ← Config.'),
      h('li', null, 'להעתיק את ששת השדות לקובץ js/config.js.'),
      h('li', null, 'קומיט ופוש ב-GitHub Desktop, ולרענן את הדף.')));
}

export function renderSignIn(root, onSignIn) {
  const err = h('p', { class: 'small', style: { color: 'var(--down)' } });
  const btn = h('button', { class: 'btn primary', onclick: async () => {
    btn.disabled = true; err.textContent = '';
    try { await onSignIn(); } catch (e) { err.textContent = friendlyError(e); } finally { btn.disabled = false; }
  } }, 'כניסה עם גוגל');
  shell(root,
    h('h1', null, 'כניסה'),
    h('p', { class: 'muted' }, 'האפליקציה פתוחה ליועד ולדרי בלבד, כל אחד עם חשבון הגוגל שלו.'),
    btn, err);
}

export function renderNotMember(root, user, onSignOut) {
  const copy = h('button', { class: 'btn sm', onclick: async () => {
    try { await navigator.clipboard.writeText(user.uid); copy.textContent = 'הועתק'; } catch (e) { copy.textContent = 'סמן והעתק ידנית'; }
  } }, 'העתקת המזהה');
  shell(root,
    h('h1', null, 'החשבון הזה עוד לא במשק הבית'),
    h('p', { class: 'muted' }, 'הכניסה הצליחה, אבל המזהה הזה לא ברשימת החברים. כדי להוסיף אותו: קונסולת Firestore ← households ← main ← members ← להוסיף את המזהה.'),
    h('dl', { class: 'kv' },
      h('dt', null, 'חשבון'), h('dd', null, user.email),
      h('dt', null, 'מזהה'), h('dd', null, h('code', null, user.uid))),
    h('div', { style: { display: 'flex', gap: '8px' } }, copy, h('button', { class: 'btn sm ghost', onclick: onSignOut }, 'יציאה')));
}

export function renderNoHousehold(root, user, onSignOut) {
  shell(root,
    h('h1', null, 'משק הבית עוד לא הוקם'),
    h('p', { class: 'muted' }, 'זו הקמה ראשונה. בקונסולת Firestore יוצרים מסמך אחד:'),
    h('dl', { class: 'kv' },
      h('dt', null, 'אוסף'), h('dd', null, h('code', null, 'households')),
      h('dt', null, 'מסמך'), h('dd', null, h('code', null, 'main')),
      h('dt', null, 'שדה members'), h('dd', null, 'מערך (array) עם המזהה: ', h('code', null, user.uid)),
      h('dt', null, 'שדה names'), h('dd', null, 'מפה (map): המזהה ← "יועד"')),
    h('p', { class: 'small muted' }, 'ההוראות המלאות, צעד אחר צעד, ב-README בסעיף "הקמה".'),
    h('button', { class: 'btn sm ghost', onclick: onSignOut }, 'יציאה'));
}

export function renderGateError(root, error, onRetry) {
  shell(root,
    h('h1', null, 'משהו נכשל בכניסה'),
    h('p', { class: 'muted' }, friendlyError(error)),
    h('button', { class: 'btn', onclick: onRetry }, 'נסה שוב'));
}
