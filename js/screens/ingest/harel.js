/* ================================================================
   HAREL — קליטת אקסל ההפקדות מאתר הראל (השתלמות או פנסיה), בתוך
   מסך "גרירה ואישור". המנוע: engines/harel.js.

   הזרימה: קובץ → בחירת קופה → תצוגה מקדימה → אישור → כתיבה.
   ההפקדות נשמרות בתוך מסמך הקופה (pots/{id}.deposits) — כמה עשרות
   שורות בשנה, בלי אוסף חדש ובלי שינוי בכללי Firestore.

   הקופה מוצעת לפי התוכן: יש פיצויים → פנסיה, אין → השתלמות. אם
   בוחרים קופה מסוג אחר — אזהרה, לא חסימה.
   ================================================================ */
import { h, mount, num } from '../../ui/dom.js';
import { chip, note, loading, errorState, table } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { ils, todayIso } from '../../core/format.js';
import { parseHarelSheet, planDeposits, depositRate, yearTotals } from '../../engines/harel.js';
import { KIND_LABEL } from '../../engines/forecast.js';
import * as store from '../../core/store.js';
import { hrefOf } from '../../core/routes.js';

const ym = m => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : '—');
const NEW = { study: { name: 'קרן השתלמות — הראל', kind: 'study' }, pension: { name: 'פנסיה — הראל', kind: 'pension' } };

export async function showHarel(status, wb, values) {
  const parsed = parseHarelSheet(values);
  if (!parsed.rows.length) { mount(status, errorState({ title: 'לא נמצאו הפקדות בקובץ', error: new Error(parsed.warnings.join(' ')) })); return; }
  mount(status, loading('card'));
  let pots;
  try { pots = (await store.list('pots')).filter(p => p.kind === 'study' || p.kind === 'pension'); }
  catch (e) { mount(status, errorState({ title: 'לא ניתן לקרוא את הקופות', error: e })); return; }

  const guess = parsed.hasSeverance ? 'pension' : 'study';
  const sals = parsed.rows.map(r => r.sal).sort();
  const out = h('div');
  const pick = (pot, isNew) => {
    picker.querySelectorAll('button[data-id]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === (pot.id || `new-${pot.kind}`))));
    mount(out, preview({ wb, parsed, pot, isNew, status }));
  };
  const picker = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
    pots.map(p => h('button', { class: 'btn', type: 'button', dataset: { id: p.id }, 'aria-pressed': 'false', onclick: () => pick(p, false) },
      p.name, ' ', chip(KIND_LABEL[p.kind], p.kind === guess ? 'up' : ''))),
    ['study', 'pension'].filter(k => !pots.some(p => p.kind === k)).map(k => h('button', { class: 'btn ghost', type: 'button', dataset: { id: `new-${k}` }, 'aria-pressed': 'false', onclick: () => pick({ ...NEW[k] }, true) },
      `+ ${NEW[k].name}`)));

  mount(status, h('div', { class: 'card', style: { display: 'grid', gap: '12px' } },
    h('div', { class: 'card-title' }, wb.name, chip('הפקדות הראל', 'accent'), chip(parsed.hasSeverance ? 'יש פיצויים — כנראה פנסיה' : 'בלי פיצויים — כנראה השתלמות')),
    h('div', null, `${parsed.rows.length} שורות · חודשי משכורת ${ym(sals[0])} → ${ym(sals[sals.length - 1])}`),
    parsed.warnings.map(w => note(w, { kind: 'bad' })),
    note('לאיזו קופה הקובץ שייך? הקופה המתאימה מסומנת בירוק.', { kind: 'info' }),
    picker), out);

  const only = pots.filter(p => p.kind === guess);
  if (only.length === 1) pick(only[0], false);
}

function preview({ wb, parsed, pot, isNew, status }) {
  const plan = planDeposits(pot.deposits || [], parsed.rows);
  const before = depositRate(pot.deposits || []);
  const after = depositRate(plan.merged);
  const year = String(new Date().getFullYear());
  const yt = yearTotals(plan.merged, year);
  const mismatch = (pot.kind === 'study' && parsed.hasSeverance) || (pot.kind === 'pension' && !parsed.hasSeverance);
  const facts = [`${parsed.rows.length} שורות בקובץ`, `${plan.add.length} חדשות`, `${plan.already} כבר קיימות וידולגו`];

  const btn = h('button', { class: 'btn primary', type: 'button', disabled: plan.add.length ? null : true },
    plan.add.length ? `אישור — לשמור ${plan.add.length} הפקדות ב"${pot.name}"` : 'אין מה להוסיף');
  btn.addEventListener('click', () => commit({ wb, pot, isNew, plan, btn, status }));

  return h('div', { class: 'card', style: { display: 'grid', gap: '12px', marginTop: '12px' } },
    h('div', { class: 'card-title' }, pot.name, chip(KIND_LABEL[pot.kind]), isNew ? chip('קופה חדשה', 'accent') : null),
    mismatch ? note(pot.kind === 'study' ? 'בקובץ יש הפקדות לפיצויים — בקרן השתלמות אין פיצויים. האם זה קובץ של פנסיה?' : 'בקובץ אין אף הפקדה לפיצויים — בפנסיה בדרך כלל יש. האם זה קובץ של השתלמות?', { kind: 'bad' }) : null,
    h('div', { class: 'small', style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, facts.map(f => chip(f))),
    table({
      columns: [
        { key: 'l', label: '' },
        { key: 'v', label: 'לפני', num: true, render: r => num(r.v) },
        { key: 'w', label: 'אחרי הקליטה', num: true, render: r => h('b', null, num(r.w)) },
      ],
      rows: [
        { id: 1, l: 'הפקדה חודשית (ממוצע 12 חודשי משכורת)', v: before ? ils(before.avg12, { digits: 0 }) : '—', w: after ? ils(after.avg12, { digits: 0 }) : '—' },
        { id: 2, l: 'חודש המשכורת האחרון', v: before ? ym(before.lastMonth) : '—', w: after ? ym(after.lastMonth) : '—' },
        { id: 3, l: `הפקדות ${year} (לפי מועד ההפקדה)`, v: '', w: ils(yt.tot, { digits: 0 }) },
      ],
    }),
    note(`לבדיקה מול הדוח של הראל: "הפקדות השנה" צריך להיות ${ils(yt.tot, { digits: 0 })}${yt.sev ? ` (עובד ${ils(yt.me, { digits: 0 })} · מעסיק ${ils(yt.er, { digits: 0 })} · פיצויים ${ils(yt.sev, { digits: 0 })})` : ` (עמית ${ils(yt.me, { digits: 0 })} · מעסיק ${ils(yt.er, { digits: 0 })})`}.`, { kind: 'info' }),
    h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, btn));
}

async function commit({ wb, pot, isNew, plan, btn, status }) {
  btn.disabled = true;
  const prev = pot.deposits || [];
  const fields = { deposits: plan.merged, depositsFile: wb.name, depositsAt: todayIso() };
  let id = pot.id;
  try {
    if (isNew) {
      id = `pot-${pot.kind}-harel`;
      await store.put('pots', id, {
        name: pot.name, kind: pot.kind, owner: '', balance: 0, asOf: todayIso(), monthly: 0,
        feeBalancePct: 0, feeDepositPct: 0, returns: [3, 5, 7], target: null, endDate: null,
        liquidFrom: null, reports: [], ...fields,
      }, { isNew: true });
    } else {
      await store.patch('pots', id, fields);
    }
    mount(status, note(`נשמרו ${plan.add.length} הפקדות ב"${pot.name}".${isNew ? ' עכשיו כדאי להזין את היתרה מהדוח בכרטיס הקופה.' : ''}`,
      { kind: 'good', action: h('a', { class: 'btn sm', href: `${hrefOf('save', 'funds')}/${encodeURIComponent(id)}` }, 'לכרטיס הקופה') }));
    if (!isNew) toast(`נשמרו ${plan.add.length} הפקדות`, { onUndo: async () => {
      await store.patch('pots', id, { deposits: prev });
      toast('הקליטה בוטלה — ההפקדות חזרו למצב הקודם.');
    } });
  } catch (e) {
    btn.disabled = false;
    toast(`השמירה נכשלה: ${e.message || e}. קליטה חוזרת של אותו קובץ בטוחה — שורות קיימות מדולגות.`, { ms: 15000 });
  }
}

