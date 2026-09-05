const L = require('../apps-script/tests/load.js');
const E = require('../js/modules/expenses.js');
const P = L.load('creditParser.gs');
const I = L.load('ingest.gs');
const fs = require('fs');
let pass=0, fail=0;
const ok=(n,c,x)=>{ if(c) pass++; else { fail++; console.log('❌ '+n+(x!==undefined?'  → '+x:'')); } };

/* בונים טאב Expenses בדיוק כפי שהשרת כותב אותו */
const fx=JSON.parse(fs.readFileSync(__dirname+'/../apps-script/tests/fixtures.json','utf8'));
const rev=v=>(v&&typeof v==='object'&&v.__d)?new Date(v.__d+'T00:00:00Z'):v;
let src=[]; for(const k of Object.keys(fx)) src=src.concat(P.parseCreditSheet_(fx[k].map(r=>r.map(rev))).rows);
src=P.withOccurrence_(src);
const RULES=I.SEED_RULES_.map((s,i)=>({Id:'R'+i,Category:s[1],Subcategory:s[2],_pat:s[0],_patU:s[0].toUpperCase(),_field:'merchant',_match:'contains',_prio:100}));
const COLS=['Id','Date','Card','Issuer','BillingMonth','Merchant','MerchantNorm','Amount','Currency','Charge','ChargeCurrency','Note','NoteKind','Installment','Installments','Category','Subcategory','Status','RuleId','Source','FileHash','SheetRow','Key','Occ','CreatedAt','UpdatedAt'];
const values=[COLS];
src.forEach((r,i)=>{
  const norm=I.normMerchant_(r.merchantRaw), note=P.parseNote_(r.note);
  const hit=I.applyRules_({merchantNorm:norm,note:r.note,card:r.card},RULES);
  const o={Id:'E'+String(i+1).padStart(6,'0'),Date:r.date,Card:r.card,Issuer:r.issuer,BillingMonth:r.billing,
    Merchant:r.merchantRaw,MerchantNorm:norm,Amount:r.amount===null?'':r.amount,Currency:r.origCurrency||'ש"ח',
    Charge:r.charge,ChargeCurrency:r.chargeCurrency||'ש"ח',Note:r.note,NoteKind:note.kind,
    Installment:note.installment===null?'':note.installment,Installments:note.installments===null?'':note.installments,
    Category:hit?hit.category:'',Subcategory:hit?hit.subcategory:'',Status:hit?'auto':'pending'};
  values.push(COLS.map(c=>o[c]===undefined?'':o[c]));
});

/* ---------- קריאה ---------- */
const rows=E.parseRows(values);
ok('574 שורות נקראו', rows.length===574, rows.length);
ok('כותרות לפי שם ולא אינדקס', rows[0].norm && rows[0].card && typeof rows[0].charge==='number');
ok('שורה ריקה לא נכנסת', E.parseRows([COLS, COLS.map(()=>'')]).length===0);
ok('גיליון ריק', E.parseRows([]).length===0 && E.parseRows([COLS]).length===0);

/* ---------- סיכום מול הבנק ---------- */
const w=E.washPairs(rows);
ok('2 זוגות מתקסים', w.length===2, w.length);
ok('זוג = אותו כרטיס', w.every(p=>p.credit.card===p.debit.card));
ok('זוג = סכום הפוך', w.every(p=>Math.abs(p.credit.charge+p.debit.charge)<0.01));

const sAll=E.summarize(rows,{});
ok('סה"כ ₪80,972.76', Math.abs(sAll.total+sAll.washed-80972.76)<0.02, sAll.total+' + wash '+sAll.washed);
const BANK={'02/07/2026':34694.41,'02/08/2026':23363.59,'02/09/2026':22914.76};
for(const m in BANK){
  const sm=E.summarize(rows,{month:m});
  const got=sm.total + sm.washed;
  ok('חודש '+m+' = הבנק', Math.abs(got-BANK[m])<0.02, got+' מול '+BANK[m]);
}

/* ---------- הדליים ---------- */
ok('העברות לא נספרות בצריכה', sAll.buckets['העברות']>0 && sAll.consume>0);
const tr=rows.filter(r=>r.cat==='העברות').reduce((a,r)=>a+r.charge,0);
ok('סכום ההעברות נכון', Math.abs(sAll.transfer-tr)<0.02, sAll.transfer+' מול '+tr);
ok('בהמתנה מופיע ב-byCat', sAll.byCat.some(c=>c.cat==='בהמתנה'));
ok('byCat ממוין יורד', sAll.byCat.every((c,i,a)=>i===0||a[i-1].sum>=c.sum));

/* ---------- התאמת אשראי↔בנק ---------- */
const rec=E.reconcile(rows,[
  {card:'5519',billing:'02/07/2026',amount:12185.50},
  {card:'7487',billing:'02/07/2026',amount:16862.31},
  {card:'5701',billing:'02/08/2026',amount:5194.11},
  {card:'5519',billing:'02/06/2026',amount:10726.20},   // אין פירוט
  {card:'5519',billing:'02/08/2026',amount:17000.00}    // פער מכוון
]);
ok('5519 02/07 settled', rec[0].status==='settled', rec[0].status+' gap='+rec[0].gap);
ok('7487 02/07 settled', rec[1].status==='settled', rec[1].status);
ok('5701 02/08 settled', rec[2].status==='settled', rec[2].status);
ok('חודש בלי פירוט → lump', rec[3].status==='lump' && rec[3].detail===null, rec[3].status);
ok('פער → gap', rec[4].status==='gap', rec[4].status);
ok('הפער מדווח במספר', Math.abs(rec[4].gap-606.10)<0.02, rec[4].gap);

/* ---------- קיבוץ ---------- */
const CITY=['יבנה','ציונה','גבעתיים','מידטאון','איכילוב','רמבם','גמא','יציל','ראשלצ','רחובות','אשדוד','חיפה','ירושלים','בעיר','מרכז','חנות','ישראל','אתר','בעמ','בע','סנטר','טאון','העמק','השרון','דיזנגוף','הקישון','נתבג','אילון','בסנטר','LTD','THE','AND','INC','CO','בית','של','רשת'];
const pend=E.byMerchant(rows.filter(r=>!r.cat));
const g=E.group(pend,{stopwords:CITY});
ok('קבוצות נוצרו', g.groups.length>=20, g.groups.length);
ok('כל קבוצה 2+ חברים', g.groups.every(x=>x.members.length>=2));
ok('אין סוחר בשתי קבוצות', (()=>{const s=new Set();return g.groups.every(x=>x.members.every(m=>{if(s.has(m.norm))return false;s.add(m.norm);return true;}))})());
ok('בודדים לא בקבוצות', (()=>{const s=new Set();g.groups.forEach(x=>x.members.forEach(m=>s.add(m.norm)));return g.singles.every(m=>!s.has(m.norm))})());
ok('סך חברים+בודדים = כל הממתינים', g.groups.reduce((a,x)=>a+x.members.length,0)+g.singles.length===pend.length);
ok('קבוצות ממוינות לפי סכום', g.groups.every((x,i,a)=>i===0||a[i-1].total>=x.total));
ok('רוב הקבוצות בביטחון גבוה', g.groups.filter(x=>x.confident).length/g.groups.length>0.7,
   g.groups.filter(x=>x.confident).length+'/'+g.groups.length);
const yav=g.groups.find(x=>x.token==='יבנה');
ok('"יבנה" נוטרל ע"י מילות העצירה', !yav);
const g0=E.group(pend,{stopwords:['בעמ']});
ok('בלי מילות עצירה — "יבנה" חוזר', !!g0.groups.find(x=>x.token==='יבנה'));

/* ---------- הצעות ---------- */
const anch=E.buildAnchors(rows.filter(r=>r.cat),CITY);
ok('עוגנים נבנו', Object.keys(anch).length>0);
const conflict=E.buildAnchors([{norm:'סופר פארם',cat:'בריאות',sub:'פארם'},{norm:'סופר מרקט',cat:'מזון',sub:''}],CITY);
ok('אסימון סותר נפסל', !conflict['סופר'], JSON.stringify(Object.keys(conflict)));
const KW=I.SUGGEST_;
ok('הצעה ממילת מפתח', E.suggest('אר קפה מידטאון',{keywords:KW}).cat==='מזון');
ok('רג׳קס שבור לא מפיל', E.suggest('x',{keywords:[['[','A','B']]}).cat==='');
ok('הצעה משכן', E.suggest('בבקה הבימה',{anchors:{'בבקה':{cat:'מזון',sub:'מאפייה',n:3}}}).cat==='מזון');
ok('אין הצעה → ריק', E.suggest('זזזז',{keywords:KW,anchors:{}}).cat==='');

/* ---------- תשלומים ---------- */
const inst=E.openInstallments(rows);
ok('תשלומים פתוחים נמצאו', inst.length>0, inst.length);
ok('רק תשלומים שנותרו', inst.every(x=>x.left>0));
ok('remaining = per × left', inst.every(x=>Math.abs(x.remaining-x.per*x.left)<0.02));

/* ---------- ציר תאריך ---------- */
const byDate=E.summarize(rows,{basis:'date'});
ok('ציר עסקה נותן אותו סה"כ', Math.abs(byDate.total-sAll.total)<0.02, byDate.total+' מול '+sAll.total);
ok('ציר עסקה — חודשים אחרים', byDate.byMonth.length!==sAll.byMonth.length || byDate.byMonth[0].month!==sAll.byMonth[0].month);

console.log('');
console.log('סיכום על הנתונים האמיתיים:');
console.log('  צריכה ₪'+sAll.consume.toLocaleString()+' · בהמתנה ₪'+sAll.pending.toLocaleString()+' · העברות ₪'+sAll.transfer.toLocaleString()+' · מתקזז ₪'+sAll.washed);
console.log('  '+g.groups.length+' קבוצות + '+g.singles.length+' בודדים = '+(g.groups.length+g.singles.length)+' החלטות');
console.log('  '+inst.length+' תשלומים פתוחים · נותר לשלם ₪'+inst.reduce((a,x)=>a+x.remaining,0).toFixed(0));
console.log('');
console.log(fail===0 ? '✅ כל '+pass+' הבדיקות עברו' : '❌ '+fail+' נכשלו מתוך '+(pass+fail));
process.exit(fail?1:0);
