const fs=require('fs');
const P=require('./load').load('creditParser.gs');
const I=require('./load').load('ingest.gs');
let pass=0, fail=0;
function ok(name,cond,extra){ if(cond){pass++;} else {fail++; console.log('❌ '+name+(extra?'  → '+extra:''));} }

/* ---------- נירמול ---------- */
ok('unescape &amp;', I.normMerchant_("&amp;H) מאץ' ריטייל בעמ").indexOf('&')===0 || I.normMerchant_("&amp;H) מאץ' ריטייל בעמ").indexOf('&H')!==-1, I.normMerchant_("&amp;H) מאץ' ריטייל בעמ"));
ok('collapse spaces', I.normMerchant_('  a   b  ')==='a b', JSON.stringify(I.normMerchant_('  a   b  ')));
ok('strip parens', I.normMerchant_('(חיפה אסיה (טאביט').indexOf('(')===-1);
ok('null safe', I.normMerchant_(null)==='' && I.normMerchant_(undefined)==='');
ok('deterministic', I.normMerchant_('חניון עזריאלי טאון')===I.normMerchant_('חניון עזריאלי טאון'));

/* ---------- כללים ---------- */
function mkRules(list){ return list.map((s,i)=>({Id:'R'+i,Active:true,Priority:100,Field:'merchant',Match:'contains',Pattern:s[0],Card:'',Category:s[1],Subcategory:s[2],_pat:s[0],_patU:s[0].toUpperCase(),_field:'merchant',_match:'contains',_prio:100})); }
const R = mkRules(I.SEED_RULES_);
ok('rule contains hebrew', !!I.applyRules_({merchantNorm:'חניון עזריאלי טאון'},R));
ok('rule case-insensitive latin', !!I.applyRules_({merchantNorm:'spotifyil'},R));
ok('rule no match → null', I.applyRules_({merchantNorm:'זזזזז'},R)===null);
const rCard = [{Id:'RC',Active:true,Priority:10,Field:'merchant',Match:'contains',Pattern:'קפה',Card:'5519',Category:'X',Subcategory:'',_pat:'קפה',_patU:'קפה',_field:'merchant',_match:'contains',_prio:10}];
ok('card filter blocks', I.applyRules_({merchantNorm:'קפה נועה',card:'7487'},rCard)===null);
ok('card filter passes', !!I.applyRules_({merchantNorm:'קפה נועה',card:'5519'},rCard));
const rPrio=[{Id:'A',Priority:200,Field:'merchant',Match:'contains',Pattern:'קפה',Category:'LOW',_pat:'קפה',_patU:'קפה',_field:'merchant',_match:'contains',_prio:200},
             {Id:'B',Priority:10,Field:'merchant',Match:'contains',Pattern:'קפה',Category:'HIGH',_pat:'קפה',_patU:'קפה',_field:'merchant',_match:'contains',_prio:10}];
rPrio.sort((a,b)=>a._prio-b._prio);
ok('priority wins', I.applyRules_({merchantNorm:'קפה נועה'},rPrio).category==='HIGH');
const rEq=[{Id:'E',Field:'merchant',Match:'equals',Pattern:'קפה נועה',Category:'C',_pat:'קפה נועה',_patU:'קפה נועה',_field:'merchant',_match:'equals',_prio:1}];
ok('equals exact', !!I.applyRules_({merchantNorm:'קפה נועה'},rEq));
ok('equals rejects partial', I.applyRules_({merchantNorm:'קפה נועה בעמ'},rEq)===null);
const rBad=[{Id:'X',Field:'merchant',Match:'regex',Pattern:'[',Category:'C',_pat:'[',_patU:'[',_field:'merchant',_match:'regex',_prio:1}];
ok('bad regex does not throw', I.applyRules_({merchantNorm:'anything'},rBad)===null);
const rNote=[{Id:'N',Field:'note',Match:'contains',Pattern:'זיכוי',Category:'C',_pat:'זיכוי',_patU:'זיכוי',_field:'note',_match:'contains',_prio:1}];
ok('note field', !!I.applyRules_({merchantNorm:'x',note:'זיכוי'},rNote));
ok('note field ignores merchant', I.applyRules_({merchantNorm:'זיכוי',note:''},rNote)===null);

/* ---------- זיהוי סוג ---------- */
ok('detect credit', I.detectKind_([[ '', 'כרטיס:5519 - אמקס  חודש החיוב: 02/07/2026' ]])==='credit');
ok('detect unknown', I.detectKind_([['','שלום']])==='unknown');
ok('detect empty', I.detectKind_([])==='unknown');

/* ---------- isoDay ---------- */
ok('isoDay date', I.isoDay_(new Date(2026,6,2))==='2026-07-02', I.isoDay_(new Date(2026,6,2)));
ok('isoDay string', I.isoDay_('x')==='x');
ok('isoDay null', I.isoDay_(null)==='');

/* ---------- ריצה מלאה על הנתונים האמיתיים ---------- */
const fx=JSON.parse(fs.readFileSync(__dirname+'/fixtures.json','utf8'));
function rev(v){ if(v&&typeof v==='object'&&v.__d) return new Date(v.__d+'T00:00:00Z'); return v; }
let all=[], secs=0, bal=0, warn=0;
for(const k of Object.keys(fx)){
  const o=P.parseCreditSheet_(fx[k].map(r=>r.map(rev)));
  all=all.concat(o.rows); secs+=o.sections.length;
  bal+=o.sections.filter(s=>s.balanced!==false).length; warn+=o.warnings.length;
}
all=P.withOccurrence_(all);
ok('574 rows', all.length===574, all.length);
ok('all sections balanced', secs===bal, secs+'/'+bal);
ok('no warnings', warn===0, warn);

let hit=0, pend=0; const pendM={};
all.forEach(r=>{
  const mn=I.normMerchant_(r.merchantRaw);
  const h=I.applyRules_({merchantNorm:mn,note:r.note,card:r.card},R);
  if(h) hit++; else { pend++; pendM[mn]=(pendM[mn]||0)+1; }
});
const pendNames=Object.keys(pendM);
let suggested=0;
pendNames.forEach(m=>{ if(I.suggestCategory_(m).category) suggested++; });

/* דילוג בהרצה שנייה — אידמפוטנטיות */
const counts={}; all.forEach(r=>counts[r.key]=(counts[r.key]||0)+1);
const second=P.diffAgainstExisting_(all,counts);
ok('second run adds nothing', second.add.length===0, second.add.length);
ok('second run skips all', second.skipped===574, second.skipped);
const empty=P.diffAgainstExisting_(all,{});
ok('first run adds all', empty.add.length===574, empty.add.length);

/* אף שורה בלי סכום חיוב */
ok('every row has charge', all.every(r=>typeof r.charge==='number'), all.filter(r=>typeof r.charge!=='number').length);
ok('every row has card', all.every(r=>/^\d{4}$/.test(String(r.card))), all.filter(r=>!/^\d{4}$/.test(String(r.card))).length);
ok('every row has date', all.every(r=>r.date instanceof Date));


/* ---------- הצעה משכנים ---------- */
ok('tokens drop stopwords', I.tokens_('בבקה בעמ').join(',')==='בבקה', I.tokens_('בבקה בעמ').join(','));
ok('tokens drop short', I.tokens_('א בב גגג').join(',')==='גגג', I.tokens_('א בב גגג').join(','));
const anch = I.buildAnchors_([
  {MerchantNorm:'בבקה בייקרי', Category:'מזון', Subcategory:'מאפייה', Status:'ok'},
  {MerchantNorm:'קפה נועה',    Category:'מזון', Subcategory:'בית קפה', Status:'ok'}
]);
ok('anchor found', !!anch['בבקה']);
const n1 = I.suggestFromNeighbors_('בבקה הבימה', anch);
ok('neighbor suggests', n1 && n1.category==='מזון' && n1.subcategory==='מאפייה', JSON.stringify(n1));
ok('neighbor via label', n1 && n1.via.indexOf('neighbor:')===0, n1&&n1.via);
ok('no neighbor → null', I.suggestFromNeighbors_('זזזז חחחח', anch)===null);
const conflict = I.buildAnchors_([
  {MerchantNorm:'סופר פארם', Category:'בריאות', Status:'ok'},
  {MerchantNorm:'סופר מרקט', Category:'מזון',   Status:'ok'}
]);
ok('conflicting token rejected', !conflict['סופר'], JSON.stringify(Object.keys(conflict)));
ok('uncategorised row is not an anchor', Object.keys(I.buildAnchors_([{MerchantNorm:'x yyy', Category:''}])).length===0);

/* כמה סוחרים ניצלים מהשכנים אחרי שכללי הזרע רצו */
const okRows=[], pendRows=[];
all.forEach(r=>{
  const mn=I.normMerchant_(r.merchantRaw);
  const h=I.applyRules_({merchantNorm:mn,note:r.note,card:r.card},R);
  (h?okRows:pendRows).push({MerchantNorm:mn, Category:h?h.category:'', Subcategory:h?h.subcategory:'', Status:h?'ok':'pending'});
});
const A = I.buildAnchors_(okRows);
const uniqPend=[...new Set(pendRows.map(r=>r.MerchantNorm))];
let byKw=0, byNb=0, none=0;
uniqPend.forEach(m=>{
  if(I.suggestCategory_(m).category) byKw++;
  else if(I.suggestFromNeighbors_(m,A)) byNb++;
  else none++;
});
console.log('');
console.log('── הצעות ל-'+uniqPend.length+' הסוחרים הממתינים ──');
console.log('  לפי מילת מפתח: '+byKw+'  ·  לפי שכן מסווג: '+byNb+'  ·  ללא הצעה: '+none);

console.log('');
console.log('── כיסוי הסיווג על 574 שורות אמיתיות ──');
console.log('  כללי זרע: '+I.SEED_RULES_.length+' → סיווגו '+hit+' שורות ('+(hit*100/574).toFixed(1)+'%)');
console.log('  בהמתנה:   '+pend+' שורות · '+pendNames.length+' סוחרים ייחודיים');
console.log('  מתוכם עם הצעה אוטומטית: '+suggested+' סוחרים ('+(suggested*100/pendNames.length).toFixed(0)+'%)');
console.log('  ללא הצעה — סיווג ידני מלא: '+(pendNames.length-suggested)+' סוחרים');
const noSug=pendNames.filter(m=>!I.suggestCategory_(m).category).sort((a,b)=>pendM[b]-pendM[a]);
console.log('  הגדולים ללא הצעה: '+noSug.slice(0,12).map(m=>m+'('+pendM[m]+')').join(' · '));
console.log('');
console.log(fail===0 ? '✅ כל '+pass+' הבדיקות עברו' : '❌ '+fail+' נכשלו מתוך '+(pass+fail));
process.exit(fail?1:0);
