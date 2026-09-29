/* חיסכון חודשי מול יעד, ותחזית קופות. */
import { section, ok, eq, info } from './lib.mjs';
import { monthSavings } from '../js/engines/savings.js';
import { creditBucket } from '../js/engines/ingestPlan.js';
import { projectPot, projectAll, reachesTarget, annuity, monthsBetween } from '../js/engines/forecast.js';

section('חיסכון החודש מול היעד');
{
  const bank = [
    // חודש קודם
    { date: '2026-08-10', desc: 'משכורת 08', amount: 25000, bucket: 'הכנסה', freq: 'קבוע' },
    { date: '2026-08-15', desc: 'ועד בית', amount: -500, bucket: 'צריכה', freq: 'קבוע' },
    { date: '2026-08-02', desc: 'אמריקן אקספרס - 5519', amount: -9000, bucket: 'העברה', freq: 'קבוע' },
    // החודש
    { date: '2026-09-02', desc: 'אמריקן אקספרס - 5519', amount: -9000, bucket: 'העברה', freq: 'קבוע' },
    { date: '2026-09-05', desc: 'החזר מס', amount: 3000, bucket: 'הכנסה', freq: 'חד-פעמי' },
    { date: '2026-09-06', desc: 'העברה לאיביאי', amount: -5000, bucket: 'הון', freq: '' },
  ];
  const credit = [
    { billingKey: '2026-09', charge: 8000, category: 'מזון' },
    { billingKey: '2026-09', charge: 1000, category: 'העברות' },    // BIT — לא צריכה
  ];
  const m = monthSavings({ month: '2026-09', bank, credit, goal: 8000, creditBucket });
  eq(m.incomeActual, 3000, 'הכנסה בפועל: החזר המס (חד-פעמי נכנס לחישוב)');
  eq(m.expIncome, 25000, 'משכורת צפויה — הופיעה בחודש הקודם ועוד לא החודש');
  eq(m.spendActual, 8000, 'צריכה: רק שורות האשראי שבדלי צריכה');
  eq(m.expSpend, 500, 'ועד בית צפוי');
  eq(m.projected, 3000 + 25000 - 8000 - 500, 'חיסכון צפוי = 19,500');
  eq(m.left, 11500, 'נשאר להוציא מעבר ליעד 8,000');
  ok(m.onTrack, 'בדרך ליעד');
  ok(m.parts.credit.length === 1 && m.parts.expIncome.length === 1, 'כל מספר מפורק לחלקים (ממה מורכב המספר)');
  const m2 = monthSavings({ month: '2026-09', bank, credit, goal: 25000, creditBucket });
  ok(!m2.onTrack && m2.left < 0, 'יעד גבוה מהצפי → שלילי, לא מוסתר');
}

section('תחזית קופות');
{
  const p = { id: 'a', name: 'קרן השתלמות', kind: 'study', balance: 100000, asOf: '2026-09-30', monthly: 1000, returns: [0, 0, 0] };
  const flat = projectPot(p, { until: '2027-09' });
  eq(flat.length, 13, '12 חודשים + נקודת ההתחלה');
  eq(Math.round(flat[12].value), 112000, 'בלי תשואה: 100,000 + 12×1,000');
  const g = projectPot({ ...p, monthly: 0, returns: [0, 12, 0] }, { until: '2027-09' });
  eq(Math.round(g[12].value), 112000, '12% שנתי בריבית חודשית מצטברת → 112,000 בדיוק');
  const fee = projectPot({ ...p, monthly: 0, returns: [0, 0, 0], feeBalancePct: 1.2 }, { until: '2027-09' });
  ok(fee[12].value < 100000 && fee[12].value > 98700, 'דמי ניהול מצבירה מקטינים את היתרה');
  const t = reachesTarget({ ...p, returns: [0, 0, 0], target: 106000 }, 1);
  eq(t, '2027-03', 'יעד 106,000 מושג אחרי 6 הפקדות');
  const all = projectAll([p, { ...p, id: 'b', balance: 50000, monthly: 0, endDate: '2027-03' }], { scenario: 1, until: '2027-09' });
  eq(Math.round(all[all.length - 1].total), 112000 + 50000, 'קופה שהסתיימה נשארת ביתרה שלה');
  eq(annuity(1000000, 200), 5000, 'מיליון ÷ מקדם 200 = 5,000 בחודש');
  eq(monthsBetween('2026-09', '2067-01'), 484, 'חודשים עד פרישה');
}
