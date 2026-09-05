const P=require('./load').load('creditParser.gs'); const fs=require('fs');
const revive=g=>g.map(r=>r.map(c=>(c&&typeof c==='object'&&c.__d)?new Date(c.__d+'T00:00:00'):c));
const fx=JSON.parse(fs.readFileSync(__dirname+'/fixtures.json','utf8'));
let pass=0,fail=0;
const ok=(c,m)=>{c?pass++:(fail++,console.log('  ✗ '+m));};
const eq=(a,b,m)=>ok(a===b,`${m} — got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

console.log('═══ פענוח שלושת הקבצים האמיתיים ═══');
const parsed={};
for (const [name,grid] of Object.entries(fx)) {
  const p=P.parseCreditSheet_(revive(grid));
  parsed[name]=p;
  const bal=p.sections.filter(s=>s.balanced===true).length;
  const unbal=p.sections.filter(s=>s.balanced===false).length;
  console.log(`  ${name}  חודש ${p.billingMonth} · ${p.sections.length} מקטעים (${bal} מאוזנים, ${unbal} לא) · ${p.rows.length} שורות · ${p.warnings.length} אזהרות`);
  p.warnings.forEach(w=>console.log('      ⚠ '+w));
  ok(unbal===0, name+': כל המקטעים מאוזנים');
  ok(p.warnings.length===0, name+': בלי אזהרות');
}
const all=Object.values(parsed).flatMap(p=>p.rows);
console.log(`  → סה"כ ${all.length} שורות הוצאה משלושת הקבצים`);
eq(all.length,574,'סך השורות');

console.log('\n═══ הסיכומים המוצהרים ═══');
const secs=Object.values(parsed).flatMap(p=>p.sections);
eq(secs.length,14,'14 מקטעים');
ok(secs.every(s=>s.balanced===true),'כל 14 המקטעים נסגרים מול הסיכום המוצהר');
const byCard={};
secs.forEach(s=>{const k=s.billing+'|'+s.card; byCard[k]=Math.round(((byCard[k]||0)+s.stated)*100)/100;});
const EXP={'02/07/2026|5519':12185.5,'02/07/2026|5701':5646.6,'02/07/2026|7487':16862.31,
           '02/08/2026|5519':17606.1,'02/08/2026|5701':5194.11,'02/08/2026|7487':563.38};
for(const [k,v] of Object.entries(EXP)) eq(byCard[k],v,'חיוב '+k+' תואם את העו"ש');

console.log('\n═══ פירוק שדה "פירוט" ═══');
const n1=P.parseNote_('תשלום 6 מתוך 48');
eq(n1.kind,'installment','תשלומים'); eq(n1.installment,6,'מספר תשלום'); eq(n1.installments,48,'סך תשלומים');
const n2=P.parseNote_('קרדיט - תשלום 7 מתוך 9');
eq(n2.kind,'installment','קרדיט הוא גם תשלומים'); eq(n2.credit,true,'מסומן כקרדיט'); eq(n2.installments,9,'7 מתוך 9');
const n3=P.parseNote_('הנחה 2.52 ש"ח חבר');
eq(n3.kind,'discount','הנחה'); eq(n3.discount,2.52,'סכום ההנחה');
eq(P.parseNote_('זיכוי').kind,'refund','זיכוי');
eq(P.parseNote_('ורד גולד ביטון').kind,'payee','שם מקבל בהעברת BIT');
eq(P.parseNote_('').kind,'plain','ריק');

console.log('\n═══ תשלומים: כמה מתוך השורות ═══');
const inst=all.map(r=>P.parseNote_(r.note)).filter(n=>n.kind==='installment');
console.log(`  ${inst.length} שורות תשלומים · ${all.filter(r=>P.parseNote_(r.note).kind==='discount').length} הנחות · ${all.filter(r=>P.parseNote_(r.note).kind==='refund').length} זיכויים · ${all.filter(r=>P.parseNote_(r.note).kind==='payee').length} העברות BIT`);
const gap=all.filter(r=>r.amount!==null && Math.abs(r.amount-r.charge)>0.005);
console.log(`  ${gap.length} שורות שבהן סכום עסקה ≠ סכום חיוב`);
ok(gap.length>0,'מלכודת התשלומים קיימת בנתונים');
// כל פער בין סכום עסקה לסכום חיוב חייב הסבר: תשלומים, הנחה, זיכוי, או מט"ח
const kinds=gap.map(r=>r.kind==='fx'?'fx':P.parseNote_(r.note).kind);
const tally=kinds.reduce((a,k)=>(a[k]=(a[k]||0)+1,a),{});
console.log('  פילוח הפערים:', JSON.stringify(tally));
eq(kinds.filter(k=>k==='plain').length,0,'אין ולו פער אחד בלי הסבר');
eq(gap.length,(tally.installment||0)+(tally.discount||0)+(tally.refund||0)+(tally.fx||0),'הפילוח ממצה את כל הפערים');

console.log('\n═══ טביעת אצבע + מונה מופעים ═══');
const withOcc=P.withOccurrence_(all.slice());
const dupKeys={}; withOcc.forEach(r=>{dupKeys[r.key]=(dupKeys[r.key]||0)+1;});
const repeats=Object.values(dupKeys).filter(v=>v>1).length;
console.log(`  ${Object.keys(dupKeys).length} מפתחות ייחודיים · ${repeats} מהם חוזרים יותר מפעם אחת`);
ok(withOcc.every(r=>r.occ>=1),'לכל שורה יש מונה');

console.log('\n═══ אידמפוטנטיות ═══');
const one=P.withOccurrence_(parsed[Object.keys(parsed)[0]].rows.slice());
const counts={}; one.forEach(r=>{counts[r.key]=Math.max(counts[r.key]||0,r.occ);});
const again=P.diffAgainstExisting_(one,counts);
eq(again.add.length,0,'קליטה חוזרת של אותו קובץ לא מוסיפה כלום');
eq(again.skipped,one.length,'וכל השורות דולגו');
const empty=P.diffAgainstExisting_(one,{});
eq(empty.add.length,one.length,'קליטה ראשונה מוסיפה הכל');
// חצי מהמופעים כבר קיימים
const half={}; Object.keys(counts).forEach((k,i)=>{ if(i%2===0) half[k]=counts[k]; });
const part=P.diffAgainstExisting_(one,half);
ok(part.add.length>0 && part.add.length<one.length,'קליטה חלקית מוסיפה רק את החסר');
ok(part.add.every(r=>r.occ>(half[r.key]||0)),'ורק מופעים שמעבר למה שקיים');

console.log('\n'+'─'.repeat(50));
console.log(fail? `❌ ${pass} עברו, ${fail} נפלו` : `✅ כל ${pass} הבדיקות עברו`);
process.exit(fail?1:0);
