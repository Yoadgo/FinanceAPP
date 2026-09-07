const L = require('./load.js');
const B = L.load('bankParser.gs');
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('❌ ' + n + (x !== undefined ? '  → ' + x : '')); } };

const fx = JSON.parse(fs.readFileSync(__dirname + '/bank-fixture.json', 'utf8'));
const rev = v => (v && typeof v === 'object' && v.__d) ? new Date(v.__d + 'T00:00:00Z') : v;
const grid = fx['report__2026-06-01__2026-09-01.xlsx'].map(r => r.map(rev));

ok('מזוהה כדוח עו״ש', B.isBankSheet_(grid) === true);
ok('קובץ אשראי לא מזוהה כעו״ש',
   B.isBankSheet_([['כרטיס:5519 - אמקס חודש החיוב: 02/09/2026'], ['תאריך עסקה','שם  העסק']]) === false);

const p = B.parseBankSheet_(grid);
ok('אין אזהרות', p.warnings.length === 0, JSON.stringify(p.warnings));
ok('חשבון זוהה', p.meta.account === '305-15761', p.meta.account);
ok('טווח זוהה', p.meta.from === '2026-06-01' && p.meta.to === '2026-09-01',
   p.meta.from + ' → ' + p.meta.to);
ok('77 תנועות', p.rows.length === 77, p.rows.length);

const debit  = p.rows.reduce((a, r) => a + r.debit, 0);
const credit = p.rows.reduce((a, r) => a + r.credit, 0);
ok('סה״כ חובה = 317,546', Math.abs(debit - 317546) < 1, debit.toFixed(2));
ok('סה״כ זכות = 256,608', Math.abs(credit - 256608) < 1, credit.toFixed(2));

/* הסימן האחיד — הבדיקה שמונעת את הבאג הקלאסי של שתי עמודות */
ok('סכום חתום = זכות פחות חובה',
   Math.abs(p.rows.reduce((a, r) => a + r.amount, 0) - (credit - debit)) < 0.02);
ok('כל שורה חתומה לכיוון אחד בלבד',
   p.rows.every(r => !(r.debit > 0 && r.credit > 0)));
ok('חובה נותנת סכום שלילי', p.rows.filter(r => r.debit > 0).every(r => r.amount < 0));
ok('זכות נותנת סכום חיובי', p.rows.filter(r => r.credit > 0).every(r => r.amount > 0));

/* תאריכים */
ok('כל התאריכים בצורת YYYY-MM-DD', p.rows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
ok('כל התאריכים בתוך הטווח',
   p.rows.every(r => r.date >= p.meta.from && r.date <= p.meta.to));
ok('DD/MM/YYYY מפוענח נכון', B.bankDate_('02/07/2026') === '2026-07-02', B.bankDate_('02/07/2026'));
ok('Date מפוענח נכון', B.bankDate_(new Date('2026-07-02T00:00:00Z')) === '2026-07-02');

/* עוגנים מהנתונים האמיתיים */
const house = p.rows.filter(r => r.desc.indexOf('העברה מהחשבון') === 0);
ok('5 העברות הבית', house.length === 5, house.length);
ok('הבית = 216,554', Math.abs(house.reduce((a, r) => a - r.amount, 0) - 216554) < 1);
ok('לכולן אותה אסמכתא', new Set(house.map(r => r.ref)).size === 1, house.map(r => r.ref).join());

const cards = p.rows.filter(r => /אמריקן אקספרס - \d{4}|ישראכרט בע"מ - \d{4}/.test(r.desc));
ok('9 חיובי כרטיסים', cards.length === 9, cards.length);
ok('סילוק = 74,996', Math.abs(cards.reduce((a, r) => a - r.amount, 0) - 74996) < 1);
ok('מספר הכרטיס נשלף מהתיאור',
   cards.every(r => /\b(5519|5701|7487)\b/.test(r.desc)));

/* אלה המספרים שאומתו מול פירוטי האשראי — אם הפרסר יזוז, זה ייפול */
const jul = cards.filter(r => r.date === '2026-07-02');
ok('02/07 — שלושה כרטיסים', jul.length === 3, jul.length);
ok('02/07 — 5519 = 12,185.50',
   Math.abs(jul.find(r => r.desc.indexOf('5519') > -1).amount + 12185.50) < 0.01);
ok('02/07 — 7487 = 16,862.31',
   Math.abs(jul.find(r => r.desc.indexOf('7487') > -1).amount + 16862.31) < 0.01);
ok('02/07 — 5701 = 5,646.60',
   Math.abs(jul.find(r => r.desc.indexOf('5701') > -1).amount + 5646.60) < 0.01);

/* קודי פעולה */
const byCode = {};
p.rows.forEach(r => { byCode[r.opCode] = (byCode[r.opCode] || 0) + 1; });
ok('קוד פעולה נשמר על כל שורה', p.rows.every(r => /^\d+$/.test(r.opCode)));
ok('קוד 272 = 7 העברות יוצאות', byCode['272'] === 7, byCode['272']);
ok('קוד 240 = 2 הלוואות שהתקבלו', byCode['240'] === 2, byCode['240']);

/* כפילויות */
const withOcc = B.withBankOccurrence_(p.rows);
ok('מונה מופעים נוסף לכל שורה', withOcc.every(r => r.occ >= 1 && r.key));
const keys = withOcc.map(r => r.key + '#' + r.occ);
ok('אין שתי שורות עם אותו מפתח+מופע', new Set(keys).size === keys.length);
ok('שורה זהה פעמיים מקבלת מופע 1 ו-2', (() => {
  const one = p.rows[0];
  const two = B.withBankOccurrence_([one, one]);
  return two[0].occ === 1 && two[1].occ === 2 && two[0].key === two[1].key;
})());
ok('קליטה חוזרת של אותו קובץ נותנת מפתחות זהים',
   B.withBankOccurrence_(p.rows).map(r => r.key + '#' + r.occ).join() === keys.join());

/* קצה */
ok('קובץ ריק לא מפיל', B.parseBankSheet_([]).warnings.length === 1);
ok('גיליון בלי כותרות מחזיר אזהרה',
   B.parseBankSheet_([['משהו'], ['אחר']]).warnings[0].indexOf('כותרות') > -1);

/* ---------- מיון לדליים ---------- */
const I = L.load('ingest.gs');
const B4 = I.BUCKETS_;

const sug = p.rows.map(r => ({ r, s: I.suggestBankBucket_(r) }));
const hit = sug.filter(x => x.s.hit);
const miss = sug.filter(x => !x.s.hit);

ok('רוב השורות קיבלו הצעה', hit.length >= 70, hit.length + '/' + p.rows.length);
ok('כל הצעה נושאת דלי מוכר',
   hit.every(x => Object.keys(B4).map(k => B4[k]).indexOf(x.s.bucket) > -1));
ok('שורה בלי כלל נשארת בלי דלי',
   miss.every(x => x.s.bucket === '' && x.s.why === 'אין כלל מתאים'));

const sum  = f => sug.filter(f).reduce((a, x) => a + Math.abs(x.r.amount), 0);
const net  = f => sug.filter(f).reduce((a, x) => a + x.r.amount, 0);   // חתום

/* שלושת המספרים מהמודל — אם המיון יזוז, הם ייפלו */
ok('סילוק אשראי = 74,996',
   Math.abs(sum(x => x.s.category === 'סילוק אשראי') - 74996) < 1,
   sum(x => x.s.category === 'סילוק אשראי').toFixed(0));
ok('משכורות = 87,913',
   Math.abs(sum(x => x.s.category === 'משכורת') - 87913) < 1,
   sum(x => x.s.category === 'משכורת').toFixed(0));
ok('הלוואות שהתקבלו = 100,000',
   Math.abs(sum(x => x.s.category === 'הלוואה שהתקבלה') - 100000) < 1);

/* מספר הכרטיס נשלף לצורך הקישור לפירוט */
const settle = sug.filter(x => x.s.settlesCard);
ok('9 שורות סילוק עם מספר כרטיס', settle.length === 9, settle.length);
ok('רק 5519 / 5701 / 7487',
   settle.every(x => ['5519','5701','7487'].indexOf(x.s.settlesCard) > -1),
   [...new Set(settle.map(x => x.s.settlesCard))].join());

/* התשובות של יועד, נעולות בקוד */
const bitMe = sug.filter(x => /מיועד גולן|מפייבוקס/.test(x.r.desc));
ok('ביט מעצמי ופייבוקס = העברה ולא הכנסה',
   bitMe.length > 0 && bitMe.every(x => x.s.bucket === B4.move), bitMe.length);
const halp = sug.filter(x => x.r.desc.indexOf('הלפרין') > -1);
ok('הלפרין = הכנסה', halp.length === 3 && halp.every(x => x.s.bucket === B4.income));
const shikun = sug.filter(x => x.r.desc.indexOf('שיכוני חי') > -1);
ok('שיכוני חי = צריכה · דיור · קבוע',
   shikun.length === 3 && shikun.every(x =>
     x.s.bucket === B4.spend && x.s.category === 'דיור' && x.s.freq === 'קבוע'));

/* ⛔ הבית לא מקבל דלי אוטומטי — ניחוש כאן הופך ₪216,554 להוצאה */
const house2 = sug.filter(x => x.r.desc.indexOf('העברה מהחשבון') === 0);
ok('חמש העברות הבית נשארות בלי דלי',
   house2.length === 5 && house2.every(x => x.s.hit === false));

/* צריכה אוטומטית — רק מה שבטוח */
/* צריכה נטו: שיכוני חי 2,322 + כאל 388, פחות זיכוי ישראכרט 135 */
ok('צריכה נטו = 2,575', Math.abs(net(x => x.s.bucket === B4.spend) + 2575) < 2,
   net(x => x.s.bucket === B4.spend).toFixed(0));
ok('הזיכוי מישראכרט נכנס לצריכה עם סימן חיובי', (() => {
  const t = sug.find(x => x.r.desc.indexOf('תיקונים') === 0);
  return t && t.s.bucket === B4.spend && t.s.category === 'זיכוי אשראי' && t.r.amount === 135;
})());
ok('הזיכוי אינו מסלק חודש חיוב',
   sug.find(x => x.r.desc.indexOf('תיקונים') === 0).s.settlesCard === '');

/* תדירות */
const freq = I.inferFreq_(p.rows);
ok('משכורת מזוהה כקבועה', freq['מופ"ת קבע'] === 'קבוע', freq['מופ"ת קבע']);
ok('שיכוני חי מזוהה כקבוע', freq['עמותת שיכוני חי'] === 'קבוע');
ok('הלוואה שהתקבלה מזוהה כחד-פעמית',
   freq['הלוואה - תשלום קרן #'] === 'חד-פעמי', freq['הלוואה - תשלום קרן #']);
ok('מספרים בתיאור לא מפצלים פריט קבוע',
   Object.keys(freq).some(k => k.indexOf('#') > -1));

/* עמודות הטאב */
ok('Bank כולל את שדות המודל',
   ['Bucket','Freq','GoalId','SettlesCard','Tag'].every(c => I.BANK_COLS.indexOf(c) > -1));

console.log('\nכיסוי המיון:');
Object.keys(B4).map(k => B4[k]).forEach(b => {
  const n = sug.filter(x => x.s.bucket === b).length;
  if (n) console.log('  ' + b.padEnd(8) + String(n).padStart(3) + ' שורות · ₪' +
    sum(x => x.s.bucket === b).toLocaleString('he-IL', {maximumFractionDigits:0}));
});
console.log('  ' + 'ללא'.padEnd(8) + String(miss.length).padStart(3) + ' שורות · ₪' +
  sum(x => !x.s.hit).toLocaleString('he-IL', {maximumFractionDigits:0}));
console.log('  ' + miss.map(x => x.r.desc).filter((v,i,a) => a.indexOf(v)===i).join(' · '));

console.log('\nסיכום הקובץ האמיתי:');
console.log('  %d תנועות · %s → %s · חשבון %s', p.rows.length, p.meta.from, p.meta.to, p.meta.account);
console.log('  יצא ₪%s · נכנס ₪%s', debit.toLocaleString('he-IL', {maximumFractionDigits:0}),
            credit.toLocaleString('he-IL', {maximumFractionDigits:0}));
console.log('\n' + (fail ? '❌ ' + fail + ' נכשלו מתוך ' + (pass + fail) : '✅ כל ' + pass + ' הבדיקות עברו'));
process.exit(fail ? 1 : 0);
