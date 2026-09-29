/* ================================================================
   SAVINGS — המספר הראשי של הבית: כמה נחסוך החודש, מול היעד.
   (הוחלט 29.9.2026: שני המספרים; היעד סכום קבוע בשקלים; הכנסה
   חד-פעמית נכנסת לחישוב החודשי.)

   בסיס: מועד חיוב (כמו שהוחלט לבית, לתזרים ולשווי הנקי). כלומר החודש
   הוא מה שיצא ונכנס לחשבון בחודש הזה — חשבון האשראי של החודש נכנס
   כולו ביום החיוב שלו.

     הכנסה צפויה  = הכנסות שכבר נכנסו + הכנסות קבועות מהחודש הקודם
                    שעוד לא הגיעו
     צריכה צפויה  = צריכה שכבר יצאה + חיובים קבועים מהחודש הקודם שעוד
                    לא ירדו
     חיסכון צפוי  = הכנסה צפויה − צריכה צפויה
     נשאר להוציא  = חיסכון צפוי − יעד   (שלילי = היעד בסכנה)

   מודל ארבעת הדליים: "העברה" (סילוק אשראי, העברה לתיק) ו"הון" אינם
   צריכה — כסף שעבר לתיק ההשקעות הוא חיסכון, בדיוק כמו שצריך.

   ⚠️ שאלה פתוחה (לשיחה): רכישות באשראי החודש יורדות רק בחודש הבא.
   "נשאר להוציא" לפי מועד חיוב לא מרגיש אותן עד שקובץ האשראי הבא נקלט.
   ================================================================ */
const sig = desc => String(desc || '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const prevMonth = ym => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

/* bank:   [{ date, desc, amount (+נכנס/−יצא), bucket, freq }]
   credit: [{ billingKey 'YYYY-MM', charge, category }]  — דלי נגזר מהקטגוריה
   creditBucket: category → דלי (ingestPlan.creditBucket)              */
export function monthSavings({ month, bank = [], credit = [], goal = 0, creditBucket }) {
  const inMonth = r => String(r.date).slice(0, 7) === month;
  const prev = prevMonth(month);
  const inPrev = r => String(r.date).slice(0, 7) === prev;

  const incomeRows = bank.filter(r => inMonth(r) && r.bucket === 'הכנסה');
  const spendBank = bank.filter(r => inMonth(r) && r.bucket === 'צריכה');
  const creditRows = credit.filter(r => r.billingKey === month && creditBucket(r.category) === 'צריכה');

  const incomeActual = incomeRows.reduce((s, r) => s + r.amount, 0);
  const oneTime = incomeRows.filter(r => r.freq !== 'קבוע').reduce((s, r) => s + r.amount, 0);
  const spendActual = spendBank.reduce((s, r) => s - r.amount, 0) + creditRows.reduce((s, r) => s + r.charge, 0);

  /* קבועות מהחודש הקודם שעוד לא הופיעו החודש — לפי "חתימת" התיאור */
  const seen = new Set(bank.filter(inMonth).map(r => sig(r.desc)));
  const pendingFixed = bank.filter(r => inPrev(r) && r.freq === 'קבוע' && !seen.has(sig(r.desc)));
  const expIncome = pendingFixed.filter(r => r.bucket === 'הכנסה').reduce((s, r) => s + r.amount, 0);
  const expSpend = pendingFixed.filter(r => r.bucket === 'צריכה').reduce((s, r) => s - r.amount, 0);

  const creditKnown = creditRows.length > 0;
  const income = incomeActual + expIncome;
  const spend = spendActual + expSpend;
  const projected = income - spend;
  return {
    month, goal,
    income, incomeActual, oneTime, expIncome,
    spend, spendActual, expSpend,
    projected, left: projected - goal,
    onTrack: projected >= goal,
    creditKnown,
    parts: {
      income: incomeRows.map(r => ({ label: r.desc, date: r.date, value: r.amount, freq: r.freq })),
      expIncome: pendingFixed.filter(r => r.bucket === 'הכנסה').map(r => ({ label: r.desc, date: r.date, value: r.amount })),
      spendBank: spendBank.map(r => ({ label: r.desc, date: r.date, value: -r.amount })),
      credit: creditRows.length ? [{ label: `חיוב אשראי ${month} (${creditRows.length} שורות צריכה)`, value: creditRows.reduce((s, r) => s + r.charge, 0) }] : [],
      expSpend: pendingFixed.filter(r => r.bucket === 'צריכה').map(r => ({ label: r.desc, date: r.date, value: -r.amount })),
    },
  };
}
