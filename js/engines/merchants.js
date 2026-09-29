/* ================================================================
   MERCHANTS — נירמול שמות סוחרים, כללי סיווג והצעות.
   הוסב מ-FinanceAPP v3 (apps-script/ingest.gs) ב-29.9.2026. הפונקציות
   הועתקו כמו שהן; רק loadRules_ (שקרא מהגיליון) הוחלף ב-prepRules
   שמקבל את מסמכי הכללים מ-Firestore.
   ================================================================ */

/* ── נירמול שם סוחר ──
   שם הסוחר בקובץ קטוע ל-20 תווים, לפעמים הפוך (RTL), ולפעמים מכיל ישויות
   HTML (`&amp;`). הנירמול חייב להיות **דטרמיניסטי ולא הרסני**: הוא מפתח
   התאמה, לא שם לתצוגה. השם המקורי נשמר לצד המנורמל.                      */
function normMerchant_(s) {
  var t = String(s == null ? '' : s);
  t = t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
  t = t.replace(/[‎‏‪-‮⁦-⁩]/g, '');   // סימני כיוון
  t = t.replace(/[()\[\]{}"'`.,;:*]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}


/* זרע הכללים. **רק מה שאינו שנוי במחלוקת.** כל דבר שדורש שיפוט — לאן שייכת
   "טעינות חבר", האם "פספורטכארד" ביטוח או נסיעות — הולך ל`pending` ויועד
   מכריע. כלל זרע מסומן `seed` ב-Source כדי שיהיה אפשר לראות מה בא ממני. */
var SEED_RULES_ = [
  // [pattern, category, subcategory]
  ['חניון',            'תחבורה', 'חניה'],
  ['פנגו',             'תחבורה', 'חניה'],
  ['חניונים',          'תחבורה', 'חניה'],
  ['סונול',            'תחבורה', 'דלק'],
  ['YELLOW',           'תחבורה', 'דלק'],
  ['פז בחן',           'תחבורה', 'דלק'],
  ['דלק מנטה',         'תחבורה', 'דלק'],
  ['מכון רישוי',       'תחבורה', 'רכב'],
  ['איתוראן',          'תחבורה', 'רכב'],
  ['רמי לוי',          'מזון', 'סופרמרקט'],
  ['שופרסל',           'מזון', 'סופרמרקט'],
  ['סטופ מרקט',        'מזון', 'סופרמרקט'],
  ['כלל מרקט',         'מזון', 'סופרמרקט'],
  ['פמילי מרקט',       'מזון', 'סופרמרקט'],
  ['מרכולית',          'מזון', 'סופרמרקט'],
  ['צרכניית',          'מזון', 'סופרמרקט'],
  ['סופר פארם',        'בריאות', 'פארם'],
  ['סופרפארם',         'בריאות', 'פארם'],
  ['WOLT',             'מזון', 'משלוחים'],
  ['SPOTIFY',          'מנויים', 'מדיה'],
  ['PRIME VIDEO',      'מנויים', 'מדיה'],
  ['YES',              'מנויים', 'מדיה'],
  ['ANTHROPIC',        'מנויים', 'תוכנה'],
  ['TRADINGVIEW',      'מנויים', 'תוכנה'],
  ['APPLECOM',         'מנויים', 'תוכנה'],
  ['RISEUP',           'מנויים', 'תוכנה'],
  ['PAYBOX',           'העברות', 'העברה אישית'],
  ['BIT העברה',        'העברות', 'העברה אישית'],
  ['ביטוח חיים',       'ביטוח',  'ביטוח חיים'],
  ['אוניברסיטת',       'חינוך',  'לימודים']
];

/* מחליף את loadRules_ של הגיליון. rules = מסמכי rules מ-Firestore
   ({ id, active, priority, field, match, pattern, card, category, subcategory }).
   הכלל של יועד או דרי (priority 50) גובר תמיד על כלל זרע (100).     */
function prepRules(rules) {
  return (rules || [])
    .filter(function (r) { return r.active !== false && String(r.pattern || '').trim() !== '' && !r.voided; })
    .map(function (r) {
      return {
        Id: r.id, Card: r.card || '', Category: r.category, Subcategory: r.subcategory || '',
        _pat: String(r.pattern).trim(), _patU: String(r.pattern).trim().toUpperCase(),
        _field: String(r.field || 'merchant').toLowerCase(),
        _match: String(r.match || 'contains').toLowerCase(),
        _prio: Number(r.priority) || 100
      };
    })
    .sort(function (a, b) { return a._prio - b._prio; });
}

/* כללי הזרע כמסמכים, לזריעה ראשונה של אוסף rules. */
function seedRuleDocs() {
  return SEED_RULES_.map(function (s, i) {
    return { id: 'seed-' + ('00' + (i + 1)).slice(-3), active: true, priority: 100, field: 'merchant',
             match: 'contains', pattern: s[0], card: '', category: s[1], subcategory: s[2], source: 'seed' };
  });
}

function ruleHits_(rule, rec) {
  var hay = rule._field === 'note' ? String(rec.note || '') : String(rec.merchantNorm || '');
  if (rule.Card && String(rule.Card).trim() && String(rule.Card).trim() !== String(rec.card)) return false;
  var H = hay.toUpperCase(), P = rule._patU;
  if (rule._match === 'equals') return H === P;
  if (rule._match === 'starts') return H.indexOf(P) === 0;
  if (rule._match === 'regex')  { try { return new RegExp(rule._pat, 'i').test(hay); } catch (e) { return false; } }
  return H.indexOf(P) !== -1;
}

function applyRules_(rec, rules) {
  for (var i = 0; i < rules.length; i++) {
    if (ruleHits_(rules[i], rec)) {
      return { category: rules[i].Category, subcategory: rules[i].Subcategory, ruleId: rules[i].Id };
    }
  }
  return null;
}

/* ── הצעה ── לא כלל, לא נכתבת לשום מקום. משמשת **רק** למילוי מראש של מסך
   הסיווג. אם ההצעה שגויה יועד משנה אותה במקום, ומה שנכתב הוא בחירתו.       */
var SUGGEST_ = [
  ['בייקרי|רולדין|מאפ|לחם|קייזר|קונדיטור|לוליטה|בייקר|כהנים',  'מזון', 'מאפייה'],
  ['קפה|ארומה|אספרסו|CAFE|COFFEE|קפה',                          'מזון', 'בית קפה'],
  ['בורגר|פיצה|חומוס|מסעדת|בר |סושי|גריל|שווארמה|פלאפל',        'מזון', 'מסעדה'],
  ['גלידה|גלידת|ממתקים|סוויט|דלי קרים',                          'מזון', 'ממתקים'],
  ['מרקט|צרכניה|מכולת|סופר',                                     'מזון', 'סופרמרקט'],
  ['חניון|חניה|פנגו',                                            'תחבורה', 'חניה'],
  ['דלק|פז|סונול|YELLOW|מנטה',                                   'תחבורה', 'דלק'],
  ['רכבת|מוביט|תחבורה',                                          'תחבורה', 'תחבורה ציבורית'],
  ['ביטוח|פספורטכארד|דיירקט',                                    'ביטוח', 'ביטוח'],
  ['רפואי|מכבי|כללית|שיבא|איכילוב|רמבם|קופת',                    'בריאות', 'רפואה'],
  ['פארם|טבע בריא',                                              'בריאות', 'פארם'],
  ['שיער|עיצוב|ספר |קוסמט',                                      'טיפוח', 'טיפוח'],
  ['מלון|HOTEL|נופש|DUTY FREE|טרמינל|נתבג',                      'נסיעות', 'נסיעות'],
  ['משתלה|משתלות|גינון|משק |הום|טרלידור|אקסלר',                  'בית', 'בית וגינון'],
  ['זארה|אינטימה|גוטקס|VICTORIA|ביגוד|אופנה',                    'קניות', 'ביגוד'],
  ['KSP|באג |מחשב|אלקטרו',                                        'קניות', 'אלקטרוניקה'],
  ['טעינות|חבר |מועדון|הטבות',                                   'הטבות', 'טעינת כרטיס'],
  ['מים|שטראוס',                                                 'בית', 'שירותים לבית']
];

function suggestCategory_(merchantNorm) {
  var s = String(merchantNorm || '');
  for (var i = 0; i < SUGGEST_.length; i++) {
    try { if (new RegExp(SUGGEST_[i][0], 'i').test(s)) return { category: SUGGEST_[i][1], subcategory: SUGGEST_[i][2], via: 'keyword' }; }
    catch (e) {}
  }
  return { category: '', subcategory: '', via: '' };
}

/* מילים שחוזרות אצל כולם ולכן אינן מעידות על דבר. בלעדיהן "בעמ" היה מקשר
   כל חברה בישראל לכל חברה אחרת.                                          */
var STOP_TOKENS_ = { 'בעמ':1, 'בע':1, 'מ':1, 'בית':1, 'ה':1, 'של':1, 'רשת':1,
  'LTD':1, 'THE':1, 'AND':1, 'INC':1, 'CO':1 };

function tokens_(s) {
  return String(s || '').toUpperCase().split(/[\s\-\u2013\u2014\/]+/)
    .filter(function (t) { return t.length >= 3 && !STOP_TOKENS_[t]; });
}

/* הצעה מתוך מה שכבר סווג. **זה החלק שמצטבר**: כל סוחר שיועד מסווג הופך
   לעוגן שמושך אליו סוחרים דומים בפעם הבאה. "בבקה בייקרי" מסווג → "בבקה
   הבימה" מקבל הצעה, בלי שאף אחד כתב כלל ל"בבקה".
   דורש **חפיפת אסימון מובהק** ולא דמיון מחרוזות — דמיון מחרוזות היה מקשר
   "סופר פארם" ל"סופר מרקט".                                              */
function suggestFromNeighbors_(merchantNorm, anchors) {
  var t = tokens_(merchantNorm);
  if (!t.length) return null;
  var best = null;
  for (var i = 0; i < t.length; i++) {
    var a = anchors[t[i]];
    if (!a) continue;
    if (!best || a.n > best.n) best = a;
  }
  return best ? { category: best.category, subcategory: best.subcategory, via: 'neighbor:' + best.token } : null;
}

/* בונה את מפת העוגנים מהשורות שכבר סווגו. אסימון שמופיע בשתי קטגוריות
   שונות **נפסל** — הוא לא מבחין, ולכן הצעה שמבוססת עליו תזיק.            */
function buildAnchors_(rows) {
  var m = {};
  rows.forEach(function (r) {
    var cat = String(r.Category || '').trim();
    if (!cat) return;
    var sub = String(r.Subcategory || '').trim();
    tokens_(r.MerchantNorm || r.Merchant).forEach(function (t) {
      if (!m[t]) { m[t] = { token: t, category: cat, subcategory: sub, n: 0, conflict: false }; }
      if (m[t].category !== cat) m[t].conflict = true;
      m[t].n++;
    });
  });
  var out = {};
  Object.keys(m).forEach(function (k) { if (!m[k].conflict) out[k] = m[k]; });
  return out;
}

export { normMerchant_ as normMerchant, prepRules, seedRuleDocs, ruleHits_ as ruleHits, applyRules_ as applyRules,
  suggestCategory_ as suggestCategory, tokens_ as tokens, suggestFromNeighbors_ as suggestFromNeighbors,
  buildAnchors_ as buildAnchors, SEED_RULES_ };
