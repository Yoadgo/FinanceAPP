/* ================================================================
   CASHFLOW — "עו"ש ותזרים". מה נכנס, מה יצא, ולאן.

   כל תנועת עו"ש נכנסת לדלי אחד, ורק "הכנסה" ו"צריכה" משנים כמה כסף
   יש. שלושה כללים שנבדקים כאן בגלוי:
   · סילוק כרטיס שיש לו פירוט = העברה (ההוצאה היא הפירוט). בלי פירוט —
     "הוצאה מרוכזת", נספרת במלואה. פער — דגל אדום עם הסכום.
   · ריבית הלוואה — לפי ההלוואה (יועד, 29.9.2026). ברירת מחדל: הוצאה.
   · שורה שאף כלל לא זיהה נשארת "בהמתנה" בלי דלי — לא מנחשים.
   החישוב החודשי זהה לבית (engines/savings.js), בלי ה"צפוי".
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { emptyState, errorState, loading, kpi, note, chip, table } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { ils } from '../../core/format.js';
import { hrefOf } from '../../core/routes.js';
import * as store from '../../core/store.js';
import * as S from '../../engines/spend.js';
import { monthSavings } from '../../engines/savings.js';
import { creditBucket } from '../../engines/ingestPlan.js';
import { loadSpend, applyLocal } from './data.js';
import { head, seg, monthName, dm } from './common.js';

const ui = { month: null, all: false };
const BUCKETS = ['הכנסה', 'צריכה', 'העברה', 'הון'];
const BUCKET_KIND = { 'הכנסה': 'up', 'צריכה': 'down', 'העברה': '', 'הון': 'accent' };

export async function render(el, ctx) {
  mount(el, head('עו"ש ותזרים', ctx.world.question), loading('kpis'), loading('table', 8));
  let data;
  try { data = await loadSpend(); } catch (e) { mount(el, head('עו"ש ותזרים'), errorState({ error: e, onRetry: () => render(el, ctx) })); return; }
  if (!data.bank.length) {
    mount(el, head('עו"ש ותזרים', ctx.world.question), emptyState({
      title: 'אין עדיין תנועות עו"ש במסד', text: 'אחרי קליטת דוח העו"ש (או העברה מהגיליון) — כאן: הכנסות מול צריכה בכל חודש, התאמת חיובי האשראי, וריבית ההלוואות.',
      actions: [h('a', { class: 'btn primary', href: hrefOf('ingest', 'migrate') }, 'להעברה מהגיליון'), h('a', { class: 'btn', href: hrefOf('ingest', 'upload') }, 'לקליטת קובץ')],
    }));
    return;
  }
  draw(el, ctx, data);
}

function draw(el, ctx, data) {
  const redraw = () => draw(el, ctx, data);
  const eff = S.bankEffective(data.bank, data.expenses, data.loans);
  const flow = S.cashflow(eff);
  const months = flow.map(f => f.month);
  if (!ui.month || !months.includes(ui.month)) ui.month = months[months.length - 1];
  const m = monthSavings({ month: ui.month, bank: eff, credit: data.expenses, goal: 0, creditBucket });
  const saved = m.incomeActual - m.spendActual;
  const creditSpend = m.parts.credit.reduce((a, x) => a + x.value, 0);
  const f = flow.find(x => x.month === ui.month) || {};

  const monthsBar = h('div', { class: 'sp-months', role: 'group', 'aria-label': 'חודש' },
    months.map(v => h('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(ui.month === v), onclick: () => { ui.month = v; redraw(); } }, monthName(v))));

  const incomeTrace = { title: `הכנסות · ${monthName(ui.month)}`, total: m.incomeActual, totalText: ils(m.incomeActual),
    formula: 'תנועות עו"ש בדלי "הכנסה" בחודש הזה — כולל חד-פעמיות.', parts: m.parts.income.map(p => ({ label: p.label, src: dm(p.date), valueText: ils(p.value) })), partsSum: m.incomeActual };
  const spendTrace = { title: `צריכה · ${monthName(ui.month)}`, total: m.spendActual, totalText: ils(m.spendActual),
    formula: 'צריכה מהעו"ש (כולל ריבית שמוגדרת כהוצאה, וחיוב כרטיס בלי פירוט) + שורות האשראי שחויבו החודש בדלי "צריכה". סילוק כרטיס שיש לו פירוט לא נספר — הפירוט הוא ההוצאה.',
    parts: [...m.parts.spendBank.map(p => ({ label: p.label, src: `עו"ש ${dm(p.date)}`, valueText: ils(p.value) })), ...m.parts.credit.map(p => ({ label: p.label, src: 'אשראי', valueText: ils(p.value) }))], partsSum: m.spendActual };

  const strip = h('div', { class: 'strip' },
    kpi({ label: 'נכנס (הכנסות)', value: ils(m.incomeActual, { digits: 0 }), cls: 'up', trace: incomeTrace, ctx: m.oneTime ? `מזה חד-פעמי ${ils(m.oneTime, { digits: 0 })}` : 'הכול קבוע' }),
    kpi({ label: 'צריכה', value: ils(m.spendActual, { digits: 0 }), trace: spendTrace, ctx: `אשראי ${ils(creditSpend, { digits: 0 })} · עו"ש ${ils(m.spendActual - creditSpend, { digits: 0 })}` }),
    kpi({ label: 'נשאר (חיסכון)', value: ils(saved, { digits: 0, sign: true }), cls: saved >= 0 ? 'up' : 'down', ctx: 'הכנסות פחות צריכה' }),
    kpi({ label: 'להון ולהלוואות', value: ils(f.capital || 0, { digits: 0, sign: true }), size: 'sm', ctx: 'תיקים, קרן הלוואה' }),
    kpi({ label: 'בהמתנה', value: ils(f.pending || 0, { digits: 0, sign: true }), size: 'sm', cls: f.pending ? 'attn' : '', ctx: 'תנועות בלי דלי' }));

  const creditNote = !m.creditKnown ? note(`אין פירוט אשראי לחודש החיוב ${monthName(ui.month)} — חיובי הכרטיס נספרים כ"הוצאה מרוכזת" עד שהפירוט ייקלט.`, { kind: 'info' }) : null;
  /* חודש חלקי: העו"ש נקלט רק עד יום מסוים, אבל פירוט האשראי של החודש
     כבר כולו כאן — בלי האזהרה ה"חיסכון" נראה שלילי בלי סיבה. */
  const lastBank = data.bank.reduce((mx, r) => (r.date > mx ? r.date : mx), '');
  const [yy, mm] = ui.month.split('-').map(Number);
  const monthEnd = `${ui.month}-${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, '0')}`;
  const partialNote = lastBank && lastBank.slice(0, 7) === ui.month && lastBank < monthEnd
    ? note(`העו"ש נקלט עד ${dm(lastBank)} — ${monthName(ui.month)} חלקי. הכנסות שעוד לא נכנסו לא מופיעות, ולכן ה"נשאר" עדיין לא אומר הרבה.`, { kind: 'bad' }) : null;

  mount(el,
    head('עו"ש ותזרים', 'מה נכנס, מה יצא, ולאן'),
    monthsBar, strip, partialNote, creditNote,
    pendingPanel(data, redraw),
    h('div', { class: 'grid main-side' }, flowPanel(flow), loansPanel(data, redraw)),
    reconcilePanel(eff),
    rowsPanel(eff.filter(r => String(r.date).slice(0, 7) === ui.month), data, redraw));
}

/* ── תזרים לפי חודש ── */
function flowPanel(flow) {
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'חודש אחרי חודש'), h('span', { class: 'chart-note' }, 'עו"ש בלבד · לפי הדלי שבו התנועה נספרת')),
    h('div', { class: 'panel-b flush' }, table({
      columns: [
        { key: 'month', label: 'חודש', render: x => monthName(x.month) },
        { key: 'income', label: 'הכנסה', num: true, render: x => num(ils(x.income, { digits: 0 }), 'up') },
        { key: 'consume', label: 'צריכה', num: true, render: x => num(ils(x.consume, { digits: 0 })) },
        { key: 'transfer', label: 'העברה', num: true, render: x => num(ils(x.transfer, { digits: 0, sign: true }), 'muted') },
        { key: 'capital', label: 'הון', num: true, render: x => num(ils(x.capital, { digits: 0, sign: true }), 'muted') },
        { key: 'pending', label: 'בהמתנה', num: true, render: x => num(x.pending ? ils(x.pending, { digits: 0, sign: true }) : '—', x.pending ? 'attn' : 'muted') },
      ], rows: flow.map(x => ({ ...x, id: x.month })),
    })));
}

/* ── ריבית לפי הלוואה ── */
function loansPanel(data, redraw) {
  const loans = S.loansOf(data.bank, data.loans);
  const body = h('div', { class: 'panel-b' });
  if (!loans.length) body.append(h('p', { class: 'small muted' }, 'אין תנועות ריבית על הלוואה בעו"ש.'));
  loans.forEach(l => {
    const name = h('input', { class: 'btn sm', value: l.name, placeholder: 'שם (למשל משכנתא)', 'aria-label': `שם הלוואה ${l.key}` });
    const save = async exp => {
      const cfg = { name: name.value.trim(), interestIsExpense: exp };
      try {
        /* עדכון של ההלוואה הזו בלבד — לא החלפת המסמך כולו, כדי לא למחוק
           הגדרה שדרי שמרה בינתיים להלוואה אחרת */
        if (data.loans) await store.patch('settings', 'loans', { [`items.${l.key}`]: cfg });
        else await store.put('settings', 'loans', { items: { [l.key]: cfg } });
        const items = { ...((data.loans && data.loans.items) || {}), [l.key]: cfg };
        data.loans = { ...(data.loans || {}), items };
        toast(`ריבית הלוואה ${l.key}: ${exp ? 'נספרת כהוצאה' : 'חלק מההלוואה (לא הוצאה)'}`);
        redraw();
      } catch (e) { toast(`השמירה נכשלה: ${e.message || e}`); }
    };
    name.addEventListener('change', () => save(l.interestIsExpense));
    body.append(h('div', { class: 'sp-loan' },
      h('div', null, h('b', null, l.name || `הלוואה ${l.key}`), h('div', { class: 'small muted' }, `מס' ${l.key} · ${l.rows} חיובי ריבית · אחרון ${dm(l.last)}`)),
      num(ils(l.interest)),
      h('div', { class: 'sp-loan-set' }, name, h('span', { class: 'small muted' }, 'הריבית היא:'),
        seg([[true, 'הוצאה'], [false, 'חלק מההלוואה']], l.interestIsExpense, v => save(v), `ריבית הלוואה ${l.key}`))));
  });
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'ריבית על הלוואות')),
    body, h('p', { class: 'small muted', style: { padding: '0 16px 12px' } }, 'הקרן היא תמיד "הון" (החזר חוב = חיסכון). הריבית — לפי ההלוואה: כסף שהלך לבנק, או חלק מעלות הנכס.'));
}

/* ── התאמת אשראי ↔ עו"ש ── */
function reconcilePanel(eff) {
  const rec = eff.filter(r => r.rec).map(r => ({ ...r.rec, id: r.id }));
  if (!rec.length) return null;
  const st = x => x.status === 'match' ? chip('תואם לאגורה', 'up') : x.status === 'gap' ? chip(`פער ${ils(x.gap)}`, 'down') : chip('בלי פירוט — הוצאה מרוכזת', 'attn');
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, 'חיובי כרטיס מול הפירוט'), h('span', { class: 'chart-note' }, 'הבדיקה שיכולה להגיד "לא"')),
    h('div', { class: 'panel-b flush' }, table({
      columns: [
        { key: 'date', label: 'יום חיוב', render: x => num(dm(x.date)) },
        { key: 'card', label: 'כרטיס', render: x => num(x.card) },
        { key: 'bank', label: 'בעו"ש', num: true, render: x => num(ils(x.bank)) },
        { key: 'detail', label: 'בפירוט', num: true, render: x => num(x.detail === null ? '—' : ils(x.detail), x.detail === null ? 'muted' : '') },
        { key: 'st', label: 'מצב', render: st },
      ], rows: rec.sort((a, b) => b.date.localeCompare(a.date)),
    })));
}

/* ── דורש החלטה: תנועות בלי דלי, מקובצות לפי תיאור ── */
function pendingPanel(data, redraw) {
  const groups = S.bankPending(data.bank);
  if (!groups.length) return null;
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, `דורש החלטה · ${groups.reduce((a, g) => a + g.rows.length, 0)} תנועות`), h('span', { class: 'chart-note' }, 'אף כלל לא זיהה אותן — אין ניחוש')),
    h('div', { class: 'panel-b flush' }, h('div', { class: 'actionlist' }, groups.map(g => {
      const b = h('select', { class: 'btn sm', 'aria-label': 'דלי' }, h('option', { value: '' }, 'דלי…'), BUCKETS.map(x => h('option', { value: x }, x)));
      const cat = h('input', { class: 'btn sm', placeholder: 'קטגוריה (לא חובה)' });
      const go = h('button', { type: 'button', class: 'btn sm primary' }, `החל על ${g.rows.length}`);
      go.addEventListener('click', async () => {
        if (!b.value) { toast('בחר דלי.'); return; }
        go.disabled = true;
        const items = g.rows.map(r => ({ id: r.id, fields: { bucket: b.value, category: cat.value.trim() || r.category || '', status: 'ok' } }));
        const before = g.rows.map(r => ({ id: r.id, fields: { bucket: r.bucket || '', category: r.category || '', status: r.status || 'pending' } }));
        try {
          await store.patchMany('bank', items);
          applyLocal('bank', items);
          toast(`${g.rows.length} תנועות → ${b.value}`, { onUndo: async () => { try { await store.patchMany('bank', before); applyLocal('bank', before); redraw(); } catch (e) { toast(`הביטול נכשל: ${e.message || e}`); } } });
          redraw();
        } catch (e) { go.disabled = false; toast(`השמירה נכשלה: ${e.message || e}`); }
      });
      return h('div', null,
        h('div', { class: 'txt' }, h('i', { class: 'dot', style: { background: 'var(--attn)' } }),
          h('div', null, h('b', null, g.sample), h('div', { class: 'small muted' }, g.rows.map(r => dm(r.date)).join(' · ')))),
        h('div', { class: 'sp-auto-act' }, num(ils(g.total, { sign: true }), g.total > 0 ? 'up' : ''), b, cat, go));
    }))));
}

/* ── כל תנועות החודש ── */
function rowsPanel(rows, data, redraw) {
  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-h' }, h('h2', null, `תנועות ${monthName(ui.month)} · ${rows.length}`)),
    h('div', { class: 'panel-b flush' }, table({
      columns: [
        { key: 'date', label: 'תאריך', render: r => num(dm(r.date), 'muted') },
        { key: 'desc', label: 'תיאור', render: r => h('span', { class: 'sp-clip', title: r.desc }, r.desc) },
        { key: 'amount', label: 'סכום', num: true, render: r => num(ils(r.amount, { sign: true }), r.amount > 0 ? 'up' : '') },
        { key: 'b', label: 'נספר כ-', render: r => r.effBucket ? chip(r.effBucket, BUCKET_KIND[r.effBucket]) : chip('בהמתנה', 'attn') },
        { key: 'cat', label: 'קטגוריה', render: r => h('span', { class: 'small' }, [r.category, r.subcategory].filter(Boolean).join(' · ')) },
        { key: 'why', label: 'למה', render: r => h('span', { class: 'small muted' }, r.effWhy || (r.status === 'ok' ? 'אושר' : r.ruleId ? `כלל (${r.ruleId})` : '')) },
      ],
      rows: sorted,
      onRow: (r, tr) => editRow(r, tr, data, redraw),
    })));
}

function editRow(r, tr, data, redraw) {
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('detail')) { next.remove(); return; }
  tr.parentElement.querySelectorAll('tr.detail').forEach(x => x.remove());
  const b = h('select', { class: 'btn sm' }, h('option', { value: '' }, 'דלי…'), BUCKETS.map(x => h('option', { value: x, selected: x === r.bucket ? true : null }, x)));
  const cat = h('input', { class: 'btn sm', value: r.category || '', placeholder: 'קטגוריה' });
  const sub = h('input', { class: 'btn sm', value: r.subcategory || '', placeholder: 'תת-קטגוריה' });
  const save = h('button', { type: 'button', class: 'btn sm primary' }, 'שמור');
  save.addEventListener('click', async () => {
    if (!b.value) { toast('בחר דלי — בלי דלי התנועה נשארת בהמתנה.'); return; }
    save.disabled = true;
    const items = [{ id: r.id, fields: { bucket: b.value, category: cat.value.trim(), subcategory: sub.value.trim(), status: 'ok' } }];
    try { await store.patchMany('bank', items); applyLocal('bank', items); toast('נשמר.'); redraw(); }
    catch (e) { save.disabled = false; toast(`השמירה נכשלה: ${e.message || e}`); }
  });
  tr.after(h('tr', { class: 'detail' }, h('td', { colspan: '6' }, h('div', { class: 'sp-fix' },
    h('span', { class: 'small muted' }, 'דלי:'), b, cat, sub, save,
    r.settlesCard ? h('span', { class: 'small muted' }, `סילוק כרטיס ${r.settlesCard} — הדלי בפועל נקבע מול הפירוט`) : null))));
}
