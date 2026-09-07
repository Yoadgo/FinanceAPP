global.window = {};
const M = require('../js/ui/money.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('❌ ' + n + (x !== undefined ? '  → ' + x : '')); } };

/* ── משק הבית: שקלים שלמים ── */
ok('שקל שלם', M.ils(1234) === '₪1,234', M.ils(1234));
ok('מעגל לשקל', M.ils(1234.6) === '₪1,235', M.ils(1234.6));
ok('מפריד אלפים', M.ils(1234567) === '₪1,234,567', M.ils(1234567));
ok('אפס הוא אפס', M.ils(0) === '₪0', M.ils(0));
ok('ערך מוחלט', M.ils(-500) === '₪500', M.ils(-500));
ok('אגורות לפי בקשה', M.ils(12.345, 2) === '₪12.35', M.ils(12.345, 2));

/* ── ⚠️ תא ריק אינו אפס ──
   `Number(null)` הוא 0. בלי הבדיקה המפורשת המסך היה אומר "₪0" על נתון
   חסר — "בדקנו ואין כסף" במקום "אין נתון". */
ok('null → מקף', M.ils(null) === '—', M.ils(null));
ok('undefined → מקף', M.ils(undefined) === '—', M.ils(undefined));
ok('מחרוזת ריקה → מקף', M.ils('') === '—', M.ils(''));
ok('NaN → מקף', M.ils(NaN) === '—', M.ils(NaN));
ok('אינסוף → מקף', M.ils(Infinity) === '—', M.ils(Infinity));
ok('טקסט → מקף', M.ils('שלום') === '—', M.ils('שלום'));
ok('מחרוזת מספרית כן עוברת', M.ils('1500') === '₪1,500', M.ils('1500'));

/* ── סימן ── */
ok('שלילי מקבל מינוס', M.signed(-1234) === '−₪1,234', M.signed(-1234));
ok('חיובי בלי סימן', M.signed(1234) === '₪1,234', M.signed(1234));
ok('אפס אינו שלילי', M.signed(0) === '₪0', M.signed(0));
ok('המינוס הוא U+2212', M.signed(-5).charCodeAt(0) === 0x2212, M.signed(-5).charCodeAt(0));
ok('⛔ ולא מקף רגיל', M.signed(-5)[0] !== '-');
ok('delta מוסיף פלוס', M.delta(50) === '+₪50', M.delta(50));
ok('delta על שלילי', M.delta(-50) === '−₪50', M.delta(-50));
ok('delta על אפס', M.delta(0) === '+₪0', M.delta(0));
ok('signed על חסר', M.signed(null) === '—');

/* ── השקעות ── */
ok('plain בלי מטבע', M.plain(12.5) === '12.50', M.plain(12.5));
ok('plain בלי אגורות', M.plain(12.5, 0) === '13', M.plain(12.5, 0));
ok('דולר כברירת מחדל', M.disp(100) === '$100.00', M.disp(100));
ok('דולר מפורש', M.disp(100, { currency: 'USD' }) === '$100.00');
ok('המרה לשקל', M.disp(100, { currency: 'ILS', rate: 3.7 }) === '₪370.00',
   M.disp(100, { currency: 'ILS', rate: 3.7 }));
ok('שקל בלי שער → לא ממיר בשקט',
   M.disp(100, { currency: 'ILS' }) === '₪100.00', M.disp(100, { currency: 'ILS' }));
ok('dispSigned', M.dispSigned(-100, { currency: 'USD' }) === '−$100.00',
   M.dispSigned(-100, { currency: 'USD' }));
ok('disp על חסר', M.disp(null) === '—');
ok('sym', M.sym('ILS') === '₪' && M.sym('USD') === '$');

/* ── אחוזים ── */
ok('אחוז', M.pct(85.86) === '85.9%', M.pct(85.86));
ok('אחוז בלי שבר', M.pct(85.86, 0) === '86%', M.pct(85.86, 0));
ok('אחוז שלילי שומר סימן', M.pct(-3.21) === '-3.2%', M.pct(-3.21));
ok('אחוז על חסר', M.pct(null) === '—');

/* ── הפורמט זהה למה שהמסכים כתבו קודם, כדי שהחלפה לא תשנה תצוגה ── */
const old = v => '₪' + Math.round(Math.abs(v)).toLocaleString('he-IL');
[0, 1, 58, 942, 1000, 12337, 26833, 150002, 317546].forEach(v => {
  ok('תואם לפורמט הישן · ' + v, M.ils(v) === old(v), M.ils(v) + ' vs ' + old(v));
});

console.log('\n' + (fail ? '❌ ' + fail + ' נכשלו מתוך ' + (pass + fail) : '✅ כל ' + pass + ' הבדיקות עברו'));
process.exit(fail ? 1 : 0);
