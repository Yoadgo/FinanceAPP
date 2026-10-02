/* ================================================================
   HOME — עומק 0. "מה המצב ומה דורש טיפול".

   המספר הראשי (הוחלט 29.9.2026): חיסכון החודש מול היעד, ומתחתיו
   "נשאר להוציא בלי לפגוע ביעד". היעד — סכום קבוע בשקלים, נשמר ב-
   settings/goals (לא בקוד: הריפו ציבורי). הכנסה חד-פעמית נכנסת.
   החישוב: engines/savings.js. כל מספר נפתח ל"ממה מורכב".

   לידו: דורש טיפול (כל שורה עם הפעולה שלה), שווי התיק מול המדד,
   ומצב כל עולם.
   ================================================================ */
import { h, mount, num } from '../ui/dom.js';
import { emptyState, errorState, loading, makeTraceable } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { hrefOf, WORLDS } from '../core/routes.js';
import { ils, todayIso } from '../core/format.js';
import * as store from '../core/store.js';
import { session } from '../core/auth.js';
import { monthSavings } from '../engines/savings.js';
import { bankEffective } from '../engines/spend.js';
import { creditBucket } from '../engines/ingestPlan.js';
import { loadInvest, loadMarket, hasHistory } from './invest/data.js';
import { investChartPanel } from './invest/chartPanel.js';

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export async function render(el) {
  const greet = session.user ? session.user.name.split(' ')[0] : '';
  mount(el, head(greet), h('div', { class: 'grid main-side' }, loading('card'), loading('card')), loading('card'));

  let bank, expenses, goals, loans, counts, inv, market;
  try {
    [bank, expenses, goals, loans, counts, inv, market] = await Promise.all([
      store.list('bank'), store.list('expenses'), store.get('settings', 'goals'), store.get('settings', 'loans'),
      Promise.all([store.count('expenses', ['status', '==', 'pending']), store.count('bank', ['status', '==', 'pending']), store.count('imports'), store.count('pots')]),
      loadInvest(), loadMarket(),
    ]);
  } catch (e) {
    mount(el, head(greet), errorState({ error: e, onRetry: () => render(el) }));
    return;
  }
  const [expPending, bankPending, imports, pots] = counts;
  /* ריבית לפי הלוואה, וסילוק כרטיס בלי פירוט = הוצאה מרוכזת */
  bank = bankEffective(bank, expenses, loans);
  const month = todayIso().slice(0, 7);

  mount(el,
    head(greet),
    h('div', { class: 'grid main-side' }, savingsPanel({ el, month, bank, expenses, goals }), actionsPanel({ inv, bank, expenses, expPending, bankPending, market, pots })),
    h('div', { class: 'grid main-side' },
      investChartPanel({ inv, market, title: 'שווי התיק מול IVV', height: 240, initial: '1Y', compact: true }),
      worldsPanel({ inv, bank, expenses, imports, pots })));
}

function head(greet) {
  return h('div', { class: 'world-head' }, h('h1', null, greet ? `שלום ${greet}` : 'הבית'), h('span', { class: 'question' }, 'מה המצב ומה דורש טיפול'));
}

/* ── חיסכון החודש ── */
function savingsPanel({ el, month, bank, expenses, goals }) {
  const goal = goals && Number(goals.monthly) > 0 ? Number(goals.monthly) : null;
  const title = `חיסכון החודש · ${MONTHS[Number(month.slice(5, 7)) - 1]}`;
  const editBtn = h('button', { class: 'btn sm ghost', type: 'button' }, goal ? `יעד ${ils(goal)}` : 'הגדרת יעד');
  const panel = h('section', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', null, title), h('div', { class: 'tools' }, editBtn)));
  const body = h('div', { class: 'panel-b' });
  panel.append(body);
  editBtn.addEventListener('click', () => mount(body, goalEditor(goals, () => render(el))));

  if (!bank.length && !expenses.length) {
    mount(body, emptyState({
      title: 'יופיע אחרי קליטת העו"ש והאשראי',
      text: 'החישוב: הכנסות החודש (כולל חד-פעמיות) פחות הצריכה, מול יעד החיסכון. העברות לתיק ההשקעות והחזר קרן הלוואה אינם צריכה — הם חלק מהחיסכון.',
      actions: [h('a', { class: 'btn sm', href: hrefOf('ingest', 'upload') }, 'לקליטת קובץ'), goal ? null : h('button', { class: 'btn sm primary', onclick: () => mount(body, goalEditor(goals, () => render(el))) }, 'להגדיר יעד')],
    }));
    return panel;
  }

  const m = monthSavings({ month, bank, credit: expenses, goal: goal || 0, creditBucket });
  const big = h('div', { class: 'hero-num', style: { color: m.projected >= 0 ? 'var(--fg)' : 'var(--down)' } }, ils(m.projected, { digits: 0 }));
  makeTraceable(big, {
    title: 'חיסכון צפוי החודש', total: m.projected, totalText: ils(m.projected, { digits: 0 }),
    formula: 'הכנסות שנכנסו + הכנסות קבועות שעוד צפויות, פחות צריכה שיצאה + חיובים קבועים שעוד צפויים. העברות לתיק והחזר קרן הלוואה אינם צריכה.',
    parts: [
      ...m.parts.income.map(p => ({ label: p.label, src: `נכנס · ${p.freq || 'חד-פעמי'}`, valueText: ils(p.value, { sign: true }), cls: 'up' })),
      ...m.parts.expIncome.map(p => ({ label: p.label, src: 'צפוי — הופיע בחודש הקודם', valueText: ils(p.value, { sign: true }), cls: 'up' })),
      ...m.parts.credit.map(p => ({ label: p.label, src: 'אשראי', valueText: ils(-p.value, { sign: true }), cls: 'down' })),
      ...m.parts.spendBank.map(p => ({ label: p.label, src: 'עו"ש', valueText: ils(-p.value, { sign: true }), cls: 'down' })),
      ...m.parts.expSpend.map(p => ({ label: p.label, src: 'צפוי — קבוע מהחודש הקודם', valueText: ils(-p.value, { sign: true }), cls: 'down' })),
    ],
    partsSum: m.projected,
  });
  const pctOfGoal = goal ? Math.max(0, Math.min(1.25, m.projected / goal)) : null;

  mount(body,
    h('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
      h('div', null, h('div', { class: 'eyebrow' }, 'צפי לסוף החודש'), big),
      goal ? h('div', { style: { textAlign: 'end' } },
        h('div', { class: 'eyebrow' }, 'נשאר להוציא בלי לפגוע ביעד'),
        h('div', { class: `num ${m.left >= 0 ? '' : 'down'}`, style: { fontSize: '26px' } }, ils(m.left, { digits: 0 }))) : null),
    goal ? h('div', { style: { display: 'grid', gap: '6px' } },
      h('div', { class: 'meter', role: 'img', 'aria-label': `${Math.round(pctOfGoal * 100)}% מהיעד` },
        h('span', { style: { width: `${(pctOfGoal / 1.25) * 100}%`, background: m.onTrack ? 'var(--up)' : 'var(--attn)' } }),
        h('i', { style: { insetInlineStart: `${(1 / 1.25) * 100}%` } })),
      h('div', { class: 'small', style: { display: 'flex', justifyContent: 'space-between' } },
        h('span', null, m.onTrack ? 'בדרך ליעד' : 'היעד בסכנה'), h('span', { class: 'num muted' }, `יעד ${ils(goal)}`))) : null,
    h('div', { class: 'small muted' },
      `הכנסה צפויה ${ils(m.income, { digits: 0 })} (מתוכה חד-פעמית ${ils(m.oneTime, { digits: 0 })}) · צריכה צפויה ${ils(m.spend, { digits: 0 })}`,
      m.creditKnown ? '' : ' · חיוב האשראי של החודש עוד לא נקלט'));
  return panel;
}

function goalEditor(goals, onSaved) {
  const cur = goals && goals.parts ? goals.parts : [{ label: 'החזר הלוואות', amount: '' }, { label: 'חיסכון והשקעה', amount: '' }];
  const inputs = cur.map((p, i) => ({
    label: h('input', { id: `goal-l-${i}`, class: 'btn sm', value: p.label, style: { flex: '1', textAlign: 'start' } }),
    amount: h('input', { id: `goal-a-${i}`, class: 'btn sm num', type: 'number', min: '0', step: '100', value: p.amount, style: { width: '110px' } }),
  }));
  const total = h('span', { class: 'num' });
  const upd = () => { total.textContent = ils(inputs.reduce((s, x) => s + (Number(x.amount.value) || 0), 0), { digits: 0 }); };
  inputs.forEach(x => x.amount.addEventListener('input', upd)); upd();
  const save = h('button', { class: 'btn primary sm', type: 'button' }, 'שמירה');
  save.addEventListener('click', async () => {
    const parts = inputs.map(x => ({ label: x.label.value.trim(), amount: Number(x.amount.value) || 0 })).filter(p => p.label || p.amount);
    const monthly = parts.reduce((s, p) => s + p.amount, 0);
    save.disabled = true;
    try { await store.put('settings', 'goals', { monthly, parts }, { isNew: !goals }); toast(`היעד נשמר: ${ils(monthly)} בחודש`); onSaved(); }
    catch (e) { save.disabled = false; toast(`השמירה נכשלה: ${e.message || e}`); }
  });
  return h('div', { style: { display: 'grid', gap: '8px' } },
    h('div', { class: 'eyebrow' }, 'יעד חיסכון חודשי — סכום קבוע בשקלים'),
    inputs.map(x => h('div', { style: { display: 'flex', gap: '8px' } }, x.label, x.amount)),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, h('span', null, 'סה"כ: ', total), save),
    h('p', { class: 'small muted' }, 'החזר קרן הלוואה נספר כחיסכון (הוא מקטין חוב). נשמר במסד, לא בקוד.'));
}

/* ── דורש טיפול: כל שורה עם הפעולה שלה (חוק UX 4) ── */
function actionsPanel({ inv, bank, expenses, expPending, bankPending, market, pots }) {
  const items = [];
  const add = (text, href, action) => items.push(h('div', null, h('span', { class: 'txt' }, h('span', { class: 'dot' }), text), h('a', { class: 'btn sm', href }, action)));
  if (!inv.docs.length) add('תנועות ההשקעה עוד לא הועברו מהגיליון', hrefOf('ingest', 'migrate'), 'למיגרציה');
  else if (!hasHistory(market)) add('אין היסטוריית מחירים — הגרפים חסרים', hrefOf('ingest', 'migrate'), 'למשוך');
  if (expPending) add(`${expPending.toLocaleString('he-IL')} שורות אשראי ממתינות לסיווג`, hrefOf('spend', 'pending'), 'לסווג');
  if (bankPending) add(`${bankPending.toLocaleString('he-IL')} תנועות עו"ש בלי דלי`, hrefOf('spend', 'cashflow'), 'לבדוק');
  if (!expenses.length && !bank.length) add('עוד לא נקלט קובץ אשראי או עו"ש', hrefOf('ingest', 'upload'), 'לקליטה');
  if (!pots) add('הקופות (פנסיה, השתלמות, דירה) עוד לא הוזנו', hrefOf('save', 'funds'), 'להוסיף');
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'דורש טיפול'), h('span', { class: 'chip ' + (items.length ? 'attn' : 'up') }, String(items.length))),
    items.length ? h('div', { class: 'actionlist' }, items) : h('div', { class: 'panel-b' }, h('p', { class: 'small muted' }, 'אין כרגע משהו שדורש טיפול.')));
}

/* ── מצב העולמות ── */
function worldsPanel({ inv, bank, expenses, imports, pots }) {
  const row = (id, main, ctx) => {
    const w = WORLDS.find(x => x.id === id);
    return h('a', { href: hrefOf(id), style: { display: 'grid', gridTemplateColumns: '10px 1fr auto', gap: '10px', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--grid)', color: 'inherit', textDecoration: 'none' } },
      h('span', { class: `wdot ${w.dot}` }), h('span', null, h('b', { style: { fontSize: '13px' } }, w.label), h('div', { class: 'small muted' }, ctx)), num(main));
  };
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'העולמות')),
    h('div', null,
      row('invest', inv.positions.length.toLocaleString('en-US'), `${inv.docs.length.toLocaleString('en-US')} תנועות · פוזיציות פתוחות`),
      row('spend', (expenses.length + bank.length).toLocaleString('en-US'), `${expenses.length} שורות אשראי · ${bank.length} עו"ש`),
      row('save', String(pots), 'קופות בתחזית'),
      row('ingest', String(imports), 'קבצים ביומן')));
}
