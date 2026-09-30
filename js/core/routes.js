/* ================================================================
   ROUTES — מפת המסכים. מקור אמת אחד לניווט העליון, לסרגל הפנימי
   ולסרגל התחתון במובייל. מסך חדש נוסף כאן ורק כאן.

   שלושה עומקים (אפיון, "מפת המסכים"):
     0 — הבית.  1 — ארבעה עולמות.  2 — תת-המסכים של כל עולם.

   stage — באיזה שלב של מפת הדרכים המסך נבנה. מסך שעוד לא נבנה
   מציג מצב ריק כן: מה יופיע כאן ומתי. לא נתוני דמה.
   ================================================================ */
export const WORLDS = [
  { id: 'home', label: 'בית', short: 'בית', dot: 'home', question: 'מה המצב ומה דורש טיפול', load: () => import('../screens/home.js') },
  {
    id: 'invest', label: 'השקעות', short: 'השקעות', dot: 'invest',
    question: 'מה יש לי, כמה זה הרוויח, והאם המדד היה עושה טוב יותר',
    subs: [
      { id: 'holdings', label: 'אחזקות', stage: 3, load: () => import('../screens/invest/holdings.js') },
      { id: 'performance', label: 'ביצועים מול מדד', stage: 3, load: () => import('../screens/invest/performance.js') },
      { id: 'transactions', label: 'תנועות', stage: 3, load: () => import('../screens/invest/transactions.js') },
      { id: 'tax', label: 'מס ועמלות', stage: 3 },
      { id: 'journal', label: 'יומן מחקר', stage: 3 },
      { id: 'planner', label: 'תכנון קנייה', stage: 3 },
    ],
  },
  {
    id: 'spend', label: 'הוצאות ועו"ש', short: 'הוצאות', dot: 'spend',
    question: 'על מה הכסף יוצא, ומה עוד צפוי לצאת',
    subs: [
      { id: 'breakdown', label: 'על מה הוצאנו', stage: 4, load: () => import('../screens/spend/breakdown.js') },
      { id: 'pending', label: 'לסיווג', stage: 4, load: () => import('../screens/spend/pending.js') },
      { id: 'cashflow', label: 'עו"ש ותזרים', stage: 4, load: () => import('../screens/spend/cashflow.js') },
      { id: 'rules', label: 'כללים וקטגוריות', stage: 4, load: () => import('../screens/spend/rules.js') },
    ],
  },
  {
    id: 'save', label: 'חסכונות ופנסיה', short: 'חסכונות', dot: 'save',
    question: 'כמה צברנו, כמה נכנס כל חודש, ולאן זה מגיע',
    subs: [
      { id: 'funds', label: 'קופות', stage: 6, load: () => import('../screens/save/funds.js') },
      { id: 'growth', label: 'הפקדות וצבירה', stage: 6 },
      { id: 'forecast', label: 'תחזית', stage: 6, load: () => import('../screens/save/forecast.js') },
    ],
  },
  {
    id: 'ingest', label: 'קליטה', short: 'קליטה', dot: 'ingest',
    question: 'מה נכנס למערכת, מתי, ומאיזה קובץ',
    subs: [
      { id: 'upload', label: 'גרירה ואישור', stage: 4, load: () => import('../screens/ingest/upload.js') },
      { id: 'log', label: 'יומן קליטות', stage: 4, load: () => import('../screens/ingest/log.js') },
      { id: 'migrate', label: 'מיגרציה מהגיליון', stage: 2, load: () => import('../screens/ingest/migrate.js') },
      { id: 'prices', label: 'מקורות מחיר', stage: 3, load: () => import('../screens/ingest/prices.js') },
    ],
  },
];

export const STAGE_NAMES = { 1: 'הקמה', 2: 'נתונים ומיגרציה', 3: 'עולם ההשקעות', 4: 'קליטה והוצאות', 5: 'הבית', 6: 'חסכונות ופנסיה', 7: 'ליטוש' };

/* '#/invest/holdings' → { world, sub }. כתובת לא מוכרת → הבית. */
export function parseHash(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const world = WORLDS.find(w => w.id === parts[0]) || WORLDS[0];
  const sub = world.subs ? (world.subs.find(s => s.id === parts[1]) || world.subs[0]) : null;
  return { world, sub };
}

export const hrefOf = (worldId, subId) => `#/${worldId}${subId ? '/' + subId : ''}`;
