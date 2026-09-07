/* ===== PAGE: הוצאות — סיווג · על מה הוצאנו =====
   שני מסכים שעונים על שאלה אחת: **על מה הוצאנו כסף.**

   ההכרעה שמעצבת את המסך: **כלל אינו מוחל אחורה.** הוא הופך המלצה,
   ויועד מאשר בקבוצות. ר' phase5_expenses_screen.md.

   הקיבוץ, ההצעות והקיזוזים רצים **כאן ולא בשרת** — 574 שורות זה כלום,
   וכל כוונון של הקיבוץ לא דורש פריסה מחדש של Apps Script.

   ⚠️ המסך **לא** מנרמל שמות סוחרים. הנירמול חי בשרת ונכתב ל-MerchantNorm.  */

Pages.expenses = (() => {

  let _rows = null, _container = null, _cats = null, _stop = null;
  let _tab = 'sort', _month = 'all', _basis = 'billing';
  let _groups = null, _singles = null, _wash = null, _anchors = null;
  let _busy = {}, _mgr = false, _mgrMsg = '';

  /* ⛔ `_busy` **לא** ממופתח לפי `data-k`. המפתח הזה הוא מיקום ברשימה
     (`g0`, `s3`), והרשימה נבנית מחדש אחרי כל אישור — כך שסימון ״שומר״
     של קבוצה שנשמרה היה עובר לקבוצה **אחרת** שתפסה את המיקום, ונועל
     לה את הכפתור לתמיד. המפתח חייב להיות תכונה של הקבוצה עצמה.      */
  const _busyKey = item => (item.members ? 'g:' + item.token : 's:' + item.norm);

  const money = v => '₪' + Math.round(Math.abs(v)).toLocaleString('he-IL');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  /* מילות עצירה. הבסיס כאן, והרחבות מגיעות מהגיליון — ערים וסיומות
     מסלקה הן ידע של יועד. `יבנה` לבדה קישרה 13 סוחרים שאין ביניהם דבר. */
  const STOP_SEED = ['בעמ','בע','בית','של','רשת','ישראל','אתר','סנטר','טאון','מרכז','חנות',
    'יבנה','ציונה','גבעתיים','מידטאון','איכילוב','רמבם','גמא','יציל','ראשלצ','רחובות',
    'אשדוד','חיפה','ירושלים','בעיר','העמק','השרון','דיזנגוף','הקישון','נתבג','אילון',
    'LTD','THE','AND','INC','CO'];

  const KEYWORDS = [
    ['בייקרי|רולדין|מאפ|לחם|קייזר|קונדיטור|לוליטה|בייקר|כהנים|בבקה', 'מזון','מאפייה'],
    ['קפה|ארומה|אספרסו|CAFE|COFFEE',                                  'מזון','בית קפה'],
    ['בורגר|פיצה|חומוס|מסעדת|סושי|גריל|שווארמה|פלאפל|WOLT',           'מזון','מסעדה'],
    ['גלידה|גלידת|ממתקים|סוויט',                                       'מזון','ממתקים'],
    ['מרקט|צרכני|מכולת|סופרמרקט|שופרסל|רמי לוי',                       'מזון','סופרמרקט'],
    ['חניון|חניה|פנגו',                                                'תחבורה','חניה'],
    ['דלק|סונול|YELLOW|מנטה|פז ',                                      'תחבורה','דלק'],
    ['מוביט|רכבת|תחבורה',                                              'תחבורה','תחבורה ציבורית'],
    ['ביטוח|פספורטכארד|דיירקט',                                        'ביטוח','ביטוח'],
    ['רפואי|מכבי|כללית|שיבא|קופת',                                     'בריאות','רפואה'],
    ['פארם|טבע בריא',                                                  'בריאות','פארם'],
    ['שיער|קוסמט',                                                     'טיפוח','טיפוח'],
    ['מלון|HOTEL|נופש|DUTY FREE|טרמינל',                               'נסיעות','נסיעות'],
    ['משתלה|משתלות|גינון|הום|טרלידור',                                 'בית','בית וגינון'],
    ['זארה|אינטימה|גוטקס|VICTORIA|ביגוד',                              'קניות','ביגוד'],
    ['KSP|K S P|מחשב|אלקטרו',                                          'קניות','אלקטרוניקה'],
    ['PAYBOX|BIT |ביט |העברה',                                         'העברות','העברה אישית'],
    ['SPOTIFY|PRIME|APPLECOM|ANTHROPIC|TRADINGVIEW|RISEUP|YES',        'מנויים','תוכנה'],
  ];

  const CATS_FALLBACK = {
    'מזון':['סופרמרקט','מסעדה','בית קפה','מאפייה','משלוחים','ממתקים'],
    'תחבורה':['חניה','דלק','רכב','תחבורה ציבורית'],
    'בריאות':['פארם','רפואה','כושר'],
    'מנויים':['מדיה','תוכנה','תקשורת'],
    'ביטוח':['ביטוח','ביטוח חיים','ביטוח רכב'],
    'קניות':['ביגוד','אלקטרוניקה','כללי'],
    'בית':['בית וגינון','שירותים לבית','ועד בית'],
    'טיפוח':['טיפוח'], 'נסיעות':['נסיעות','מלונות'],
    'חינוך':['לימודים','חוגים'], 'העברות':['העברה אישית'], 'הטבות':['טעינת כרטיס'],
  };
  const PAL = {'מזון':'#DB2777','תחבורה':'#4F46E5','בריאות':'#0891B2','מנויים':'#7C3AED',
    'ביטוח':'#D97706','קניות':'#DC2626','בית':'#059669','טיפוח':'#DB2777','נסיעות':'#0284C7',
    'חינוך':'#65A30D','העברות':'#64748B','הטבות':'#CA8A04','בהמתנה':'#CBD5E1'};

  /* קטגוריה שיועד יצר בעצמו אינה ברשימה. צבע נופל אחד לכולן היה נותן
     לכל קטגוריה חדשה בדיוק את האפור של "בהמתנה" — שתי משמעויות שונות
     באותו צבע. גוון נגזר מהשם: יציב בין טעינות, ושונה בין שמות.      */
  function _catColor(name) {
    if (PAL[name]) return PAL[name];
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return 'hsl(' + h + ' 62% 45%)';
  }

  function render(container) {
    _container = container; _tab = 'sort'; _month = 'all'; _busy = {};
    container.innerHTML = FA.skel ? FA.skel.tablePage(8, 4) : '<div class="ex-load">טוען…</div>';
    _load();
  }

  async function _load() {
    try {
      App.setDataStatus('loading');
      const raw = await DataService.getExpenses();
      _rows = ExpensesEngine.parseRows(raw && raw.values ? raw.values : []);
      _cats = await DataService.getCategories().catch(() => null);
      _stop = STOP_SEED;
      _recompute();
      App.setDataStatus('ok');
      _paint();
    } catch (e) {
      App.setDataStatus('error');
      if (e && e.unauthorized) return;
      _container.innerHTML = `<div class="ex-empty">
        <b>לא הצלחתי לטעון את ההוצאות</b>
        <p>${esc(e && e.message ? e.message : e)}</p>
        <button class="ex-btn" onclick="Pages.expenses.reload()">נסה שוב</button></div>`;
    }
  }

  /* כל החישוב במקום אחד, כדי שאחרי אישור לא יישאר מסך שמציג נתון ישן */
  function _recompute() {
    _wash = ExpensesEngine.washPairs(_rows);
    _anchors = ExpensesEngine.buildAnchors(_rows.filter(r => r.cat), _stop);
    const pend = ExpensesEngine.byMerchant(_rows.filter(r => !r.cat));
    const g = ExpensesEngine.group(pend, { stopwords: _stop });
    const ctx = { keywords: KEYWORDS, anchors: _anchors, stopwords: _stop };
    g.groups.forEach(x => { const s = ExpensesEngine.suggest(x.members[0].norm, ctx); x.sug = s.cat ? s : ExpensesEngine.suggest(x.token, ctx); });
    g.singles.forEach(x => { x.sug = ExpensesEngine.suggest(x.norm, ctx); });
    _groups = g.groups; _singles = g.singles;
  }

  function _catMap() {
    if (!_cats || !_cats.length) return CATS_FALLBACK;
    const m = {};
    _cats.forEach(c => { if (!c.category) return; (m[c.category] = m[c.category] || []); if (c.subcategory) m[c.category].push(c.subcategory); });
    return Object.keys(m).length ? m : CATS_FALLBACK;
  }

  /* ---------------- ציור ---------------- */
  function _paint(keep) {
    if (!_container) return;
    const s = ExpensesEngine.summarize(_rows, { basis: _basis, washPairs: _wash });
    const decisions = _groups.length + _singles.length;
    /* מונה העו״ש מופיע רק אחרי שהטאב נטען פעם אחת. לא שולחים בקשה
       לשרת רק כדי לצייר תג על טאב שאולי לא ייפתח היום.            */
    const bp = (typeof BankView !== 'undefined' && BankView.pendingCount) ? BankView.pendingCount() : 0;
    _container.innerHTML = `
      <div class="ex">
        <div class="ex-head">
          <div>
            <div class="ex-sub">${_tab === 'bank'
              ? 'עובר ושב — כל תנועה מקבלת דלי אחד'
              : `${_rows.length} שורות אשראי · ${s.byMonth.length} חודשי חיוב · ${money(s.total)}`}</div>
          </div>
          <div class="ex-tabs">
            <button class="ex-tab${_tab==='sort'?' on':''}" data-tab="sort">לסיווג${decisions?` <i>${decisions}</i>`:''}</button>
            <button class="ex-tab${_tab==='spend'?' on':''}" data-tab="spend">על מה הוצאנו</button>
            <button class="ex-tab${_tab==='bank'?' on':''}" data-tab="bank">עו״ש${bp?` <i>${bp}</i>`:''}</button>
          </div>
        </div>
        ${_tab === 'bank' ? '<div class="ex-bank-host"></div>'
          : _tab === 'sort' ? _paintSort(s) : _paintSpend(s)}
      </div>${_tagList()}`;
    _wire();
    _restore(keep);
    /* העו״ש הוא רכיב עצמאי עם המצב שלו. המסך הזה רק נותן לו מקום. */
    if (_tab === 'bank') {
      const host = _container.querySelector('.ex-bank-host');
      if (host && typeof BankView !== 'undefined') BankView.render(host);
    }
  }

  function _paintSort(s) {
    const okRows = _rows.filter(r => r.status === 'ok').length;
    const autoRows = _rows.filter(r => r.status === 'auto').length;
    const tot = _rows.length || 1;
    if (!_groups.length && !_singles.length) {
      return `${_progress(okRows, autoRows, tot, s)}
        <div class="ex-empty"><b>הכול מסווג ✓</b><p>אין שורות שממתינות להחלטה.</p></div>`;
    }
    return `${_progress(okRows, autoRows, tot, s)}
      ${_groups.length ? `<div class="ex-sect">${_groups.length} קבוצות מזוהות</div>` : ''}
      ${_groups.map(g => _card(g, _busyKey(g))).join('')}
      ${_singles.length ? `<div class="ex-sect">${_singles.length} סוחרים בודדים</div>` : ''}
      ${_singles.map(m => _card(m, _busyKey(m))).join('')}`;
  }

  function _progress(ok, auto, tot, s) {
    return `<div class="ex-prog">
      <div class="ex-prog-top">
        <div><span class="ex-prog-n">${ok + auto}</span><small>מתוך ${tot} שורות סווגו</small></div>
        <div class="ex-prog-side">${money(s.pending)} עדיין לא מסווגים</div>
      </div>
      <div class="ex-bar"><i class="ok" style="width:${ok/tot*100}%"></i><i class="auto" style="width:${auto/tot*100}%"></i></div>
      <div class="ex-legend">
        <span><i class="ex-dot ok"></i> אישרת (${ok})</span>
        <span><i class="ex-dot auto"></i> סווג אוטומטית — לסקירה (${auto})</span>
        <span><i class="ex-dot pend"></i> בהמתנה (${tot-ok-auto})</span>
      </div></div>`;
  }

  /* הכרטיס נותן שתי רמות: הסוחר (מהיר) והשורה (מדויק). מקור האמת
     לבחירה הוא **תמיד מפת השורות** `c._sel`; תיבת הסוחר היא קיצור
     שמסמן או מנקה את השורות שלו. שני מנגנוני בחירה מקבילים היו נפרדים
     בשקט ברגע שנוגעים בשורה בודדת.                                    */
  function _card(item, key) {
    const solo = !item.members;
    const mem = solo ? [item] : item.members;
    const on = solo ? true : item.confident;
    const sug = item.sug || { cat: '', sub: '' };
    const pill = solo ? '<span class="ex-pill solo">סוחר יחיד</span>'
      : (item.confident ? '<span class="ex-pill high">ביטחון גבוה</span>'
                        : '<span class="ex-pill low">בדוק — ייתכן שם מקום</span>');
    const why = solo
      ? `<div class="ex-why">סוחר בודד — לא נמצא סוחר אחר שנראה כמוהו.${sug.cat ? ` ההצעה <b>${esc(sug.cat)}</b> ${sug.via && sug.via.indexOf('neighbor')===0 ? 'מבוססת על סוחר דומה שכבר סיווגת' : 'מבוססת על מילה בשם'}.` : ' אין הצעה אוטומטית.'}</div>`
      : `<div class="ex-why${item.confident?'':' warn'}">מקובץ לפי המילה <b>${esc(item.token)}</b> — היא פותחת את שם הסוחר ב־<b>${item.lead}%</b> מהמקרים.
         ${item.confident ? 'לכן כל החברים מסומנים מראש.' : 'אחוז נמוך מרמז על שם מקום ולא על עסק — <b>לכן שום דבר לא סומן</b>.'}</div>`;
    return `<div class="ex-card" data-k="${esc(key)}">
      <div class="ex-c-head"><span class="ex-chev">◀</span>
        <div class="ex-c-title">
          <div class="ex-c-name">${esc(solo ? item.norm : item.token)} ${pill}</div>
          <div class="ex-c-meta">${solo ? `${item.rows} שורות` : `${item.members.length} סוחרים · ${item.rows} שורות`}</div>
        </div>
        <div class="ex-c-amt">${money(item.total)}</div></div>
      <div class="ex-body">
        ${why}
        ${mem.map((m, j) => `<label class="ex-mem${on?'':' off'}">
            <input type="checkbox" ${on?'checked':''} data-j="${j}">
            <span class="ex-mem-n">${esc(m.norm)}</span>
            <span class="ex-mem-r">${m.rows} ${m.rows===1?'שורה':'שורות'}</span>
            <span class="ex-mem-a">${money(m.total)}</span></label>`).join('')}
        <button class="ex-detail" type="button">פירוט שורות — לדייק אחת-אחת ▾</button>
        <div class="ex-rows" hidden></div>
        <div class="ex-foot">
          <select class="ex-cat">${_catOpts(sug.cat)}</select>
          <select class="ex-sub">${_subOpts(sug.cat, sug.sub)}</select>
          <input class="ex-tagin" list="ex-taglist" placeholder="תג — טיול או אירוע (לא חובה)">
          <label class="ex-rule"><input type="checkbox" checked> צור כלל לעתיד</label>
          <button class="ex-go">אשר</button>
        </div>
        <div class="ex-new" hidden>
          <span class="ex-new-lbl"></span>
          <input class="ex-new-in" placeholder="שם חדש">
          <button class="ex-new-ok" type="button">הוסף</button>
          <button class="ex-new-x" type="button">ביטול</button>
          <span class="ex-new-msg"></span>
        </div>
      </div></div>`;
  }

  /* שורות הכרטיס: רק מה שעדיין לא מסווג, בסדר תאריך. הסלקטים של השורה
     מתחילים ריקים — "כמו הקבוצה" — כדי שמי שלא נוגע יקבל בדיוק את
     ההתנהגות הישנה, ומי שכן נוגע יחרוג רק בשורה שבחר.                 */
  function _rowsOf(item) {
    const names = {};
    _memsOf(item).forEach(m => { names[m.norm] = 1; });
    return _rows.filter(r => names[r.norm] && !r.cat)
                .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  }

  function _dm(d) {
    const x = new Date(d);
    return isNaN(x.getTime()) ? '—'
      : ('0' + x.getDate()).slice(-2) + '/' + ('0' + (x.getMonth() + 1)).slice(-2);
  }

  function _rowsHtml(item, c) {
    const sel = c._sel || {};
    return _rowsOf(item).map(r => `<div class="ex-r${sel[r.id] ? '' : ' off'}" data-id="${esc(r.id)}">
        <label class="ex-r-pick"><input type="checkbox" class="ex-r-b" ${sel[r.id] ? 'checked' : ''}></label>
        <span class="ex-r-d">${_dm(r.date)}</span>
        <span class="ex-r-n" title="${esc(r.merchant)}">${esc(r.norm)}</span>
        <span class="ex-r-note">${esc(r.installments > 1 ? `תשלום ${r.installment}/${r.installments}` : (r.noteKind === 'refund' ? 'זיכוי' : ''))}</span>
        <span class="ex-r-a">${money(r.charge)}</span>
        <select class="ex-r-cat">${_catOpts('', 'row')}</select>
        <select class="ex-r-sub"><option value="">—</option></select>
        <input class="ex-r-tag" list="ex-taglist" placeholder="תג">
      </div>`).join('');
  }

  /* שלושה מצבים ולא שניים. `edit` הוא עריכה אחורה של שורה שכבר סווגה:
     שם אין "כמו הקבוצה" (אין קבוצה), ואין "+ חדשה" (הטופס שיוצר קטגוריה
     חי בתוך כרטיס סיווג ואינו קיים שם). שורה שעדיין בהמתנה כן מקבלת
     ערך ריק, אחרת הבורר היה מציג קטגוריה שרירותית כאילו נבחרה.       */
  function _catOpts(sel, mode) {
    const m = _catMap();
    const head = mode === 'row'  ? '<option value="">כמו הקבוצה</option>'
               : mode === 'edit' ? (sel ? '' : '<option value="">— בחר —</option>')
               :                   '<option value="">קטגוריה…</option>';
    return head +
      Object.keys(m).map(c => `<option${c===sel?' selected':''}>${esc(c)}</option>`).join('') +
      (mode ? '' : '<option value="__new">+ קטגוריה חדשה…</option>');
  }
  function _subOpts(cat, sel, mode) {
    const m = _catMap();
    const head = '<option value="">—</option>';
    if (!cat) return head;
    const list = (m[cat] || []).map(x => `<option${x===sel?' selected':''}>${esc(x)}</option>`).join('');
    return head + list + (mode ? '' : '<option value="__new">+ תת-קטגוריה חדשה…</option>');
  }

  /* כל התגים שכבר בשימוש — משלימים אוטומטית, כדי ששני טיולים לא ייכתבו
     בשתי צורות ("יוון 08.26" ו-"יוון אוגוסט") ויתפצלו לשני סכומים. */
  function _tagList() {
    const seen = {};
    _rows.forEach(r => { if (r.tag) seen[r.tag] = 1; });
    return `<datalist id="ex-taglist">${Object.keys(seen).sort()
      .map(t => `<option value="${esc(t)}">`).join('')}</datalist>`;
  }


  function _paintSpend(s) {
    const mk = m => String(m).slice(3) + String(m).slice(0, 2);   // MM/YYYY -> YYYYMM
    const months = s.byMonth.map(x => x.month).sort((a, b) => mk(a).localeCompare(mk(b)));
    const sm = ExpensesEngine.summarize(_rows, { basis: _basis, month: _month, washPairs: _wash });
    const inst = ExpensesEngine.openInstallments(_rows);
    const owed = inst.reduce((a, x) => a + x.remaining, 0);
    const rows = sm.byCat;
    const max = rows.length ? rows[0].sum : 1;
    return `
      <div class="ex-kpis">
        <div class="ex-kpi"><div class="l">${_month==='all'?'סך הוצאות':'הוצאות החודש'}</div>
          <div class="v">${money(sm.consume + sm.pending)}</div>
          <div class="d">צריכה בלבד — בלי העברות</div></div>
        <div class="ex-kpi"><div class="l">העברות</div><div class="v">${money(sm.transfer)}</div>
          <div class="d">כסף שזז, לא צריכה</div></div>
        <div class="ex-kpi"><div class="l">תשלומים פתוחים</div><div class="v">${money(owed)}</div>
          <div class="d">${inst.length} עסקאות שעוד משלמים</div></div>
      </div>
      <div class="ex-panel">
        <div class="ex-panel-head"><h3>לפי קטגוריה</h3>
          <button class="ex-mgr-t" type="button">ניהול קטגוריות ✎</button>
          <div class="ex-basis">
            <button class="${_basis==='billing'?'on':''}" data-basis="billing">לפי חיוב</button>
            <button class="${_basis==='date'?'on':''}" data-basis="date">לפי עסקה</button>
          </div></div>
        <div class="ex-mo">
          <button class="${_month==='all'?'on':''}" data-m="all">כל התקופה</button>
          ${months.map(m => `<button class="${_month===m?'on':''}" data-m="${esc(m)}">${esc(String(m))}</button>`).join('')}
        </div>
        ${rows.map(c => `<div class="ex-crow" data-cat="${esc(c.cat)}">
            <div class="ex-row is-tap">
              <div class="nm"><span class="ex-chev">◀</span><span class="ex-nm-t">${esc(c.cat)}</span></div>
              <div class="ex-track"><i class="ex-fill" style="width:${Math.max(1.5, c.sum/max*100)}%;background:${_catColor(c.cat)}"></i></div>
              <div class="vl">${money(c.sum)}</div>
            </div>
            <div class="ex-edit" hidden></div>
          </div>`).join('')}
        <div class="ex-note">${sm.pending > 1
          ? `${money(sm.pending)} עדיין לא מסווגים — זה הפס האפור. כל קבוצה שתאשר מעבירה סכום ממנו לקטגוריה אמיתית.`
          : 'כל שקל מסווג. זו התמונה המלאה.'}</div>
        <div class="ex-note">לחיצה על קטגוריה פותחת את השורות שמרכיבות אותה — שם מתקנים טעות שכבר אושרה.</div>
      </div>
      ${_mgrHtml()}
      ${sm.byTag.length ? `<div class="ex-panel"><h3>לפי תג</h3>
        ${sm.byTag.map(t => `<div class="ex-row">
            <div class="nm">${esc(t.tag)}</div>
            <div class="ex-track"><i class="ex-fill" style="width:${Math.max(1.5, t.sum/sm.byTag[0].sum*100)}%;background:#0284C7"></i></div>
            <div class="vl">${money(t.sum)}</div></div>`).join('')}
        <div class="ex-note">תג הוא ציר שני וחוצה קטגוריות — טיול אחד אוסף קניות, מסעדות ומלונות. לכן הסכומים כאן חופפים לקטגוריות שלמעלה ואינם מתחברים אליהן.</div>
      </div>` : ''}
      ${inst.length ? `<div class="ex-panel"><h3>תשלומים פתוחים</h3>
        ${inst.slice(0,8).map(x => `<div class="ex-inst">
          <span class="nm">${esc(x.merchant)}</span>
          <span class="pr">${money(x.per)} × ${x.left}</span>
          <span class="vl">${money(x.remaining)}</span></div>`).join('')}
        <div class="ex-note">נספר בהוצאות רק מה שחויב בפועל. זה מה שעוד לפניך.</div></div>` : ''}`;
  }

  /* ---------------- אירועים ---------------- */
  function _wire() {
    const $ = sel => _container.querySelectorAll(sel);
    $('.ex-tab').forEach(b => b.onclick = () => { _tab = b.dataset.tab; _paint(); });
    $('.ex-mo button').forEach(b => b.onclick = () => { _month = b.dataset.m; _paint(); });
    $('.ex-basis button').forEach(b => b.onclick = () => { _basis = b.dataset.basis; _month = 'all'; _paint(); });

    $('.ex-card').forEach(c => {
      const item = _itemOf(c.dataset.k);
      if (!item) return;
      const mems = _memsOf(item);
      const on = item.members ? item.confident : true;

      /* מפת הבחירה נבנית פעם אחת לכרטיס, לפי אותה החלטה שקבעה את
         תיבות הסוחר — כך שהמסך והשליחה מסכימים מהרגע הראשון. */
      c._sel = {};
      _rowsOf(item).forEach(r => { c._sel[r.id] = on; });

      c.querySelector('.ex-c-head').onclick = () => c.classList.toggle('open');

      c.querySelectorAll('.ex-mem input').forEach((b, j) => b.onchange = () => {
        b.closest('.ex-mem').classList.toggle('off', !b.checked);
        const nm = mems[j].norm;
        _rowsOf(item).forEach(r => { if (r.norm === nm) c._sel[r.id] = b.checked; });
        _syncRows(c); _btn(c, item);
      });

      const detail = c.querySelector('.ex-detail'), box = c.querySelector('.ex-rows');
      detail.onclick = () => {
        const open = box.hidden;
        if (open && !box.dataset.built) { box.innerHTML = _rowsHtml(item, c); box.dataset.built = '1'; _wireRows(c, item); }
        box.hidden = !open;
        detail.textContent = open ? 'הסתר פירוט ▴' : 'פירוט שורות — לדייק אחת-אחת ▾';
        _syncRows(c);
      };

      const cat = c.querySelector('.ex-cat'), sub = c.querySelector('.ex-sub');
      cat.onchange = () => {
        if (cat.value === '__new') { _openNew(c, item, 'cat'); return; }
        sub.innerHTML = _subOpts(cat.value); _btn(c, item);
      };
      sub.onchange = () => {
        if (sub.value === '__new') { _openNew(c, item, 'sub'); return; }
        _btn(c, item);
      };
      c.querySelector('.ex-go').onclick = () => _approve(c, item);
      _wireNew(c, item);
      _btn(c, item);
    });
    _wireSpend();
  }

  function _wireRows(c, item) {
    c.querySelectorAll('.ex-r').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('.ex-r-b').onchange = e => {
        c._sel[id] = e.target.checked;
        el.classList.toggle('off', !e.target.checked);
        _syncMems(c, item); _btn(c, item);
      };
      const rc = el.querySelector('.ex-r-cat'), rs = el.querySelector('.ex-r-sub');
      rc.onchange = () => { rs.innerHTML = _subOpts(rc.value, '', 'row'); _btn(c, item); };
    });
  }

  /* אחרי שינוי בסוחר — לסמן מחדש את תיבות השורה; אחרי שינוי בשורה —
     לעדכן את תיבת הסוחר, כולל מצב ביניים. בלי זה המסך מציג סוחר מסומן
     שחלק משורותיו לא ייכתבו, וזה בדיוק סוג הפער שמסתיים בהפתעה.      */
  function _syncRows(c) {
    c.querySelectorAll('.ex-r').forEach(el => {
      const v = !!c._sel[el.dataset.id];
      el.querySelector('.ex-r-b').checked = v;
      el.classList.toggle('off', !v);
    });
  }

  function _syncMems(c, item) {
    const mems = _memsOf(item), all = _rowsOf(item);
    c.querySelectorAll('.ex-mem input').forEach((b, j) => {
      const mine = all.filter(r => r.norm === mems[j].norm);
      const nOn = mine.filter(r => c._sel[r.id]).length;
      b.checked = nOn > 0;
      b.indeterminate = nOn > 0 && nOn < mine.length;
      b.closest('.ex-mem').classList.toggle('off', nOn === 0);
    });
  }

  /* יצירת קטגוריה תוך כדי סיווג. נשמרת בגיליון מיד — הבורר לא מציג
     ערך שאינו קיים בשרת, כי ערך כזה היה נעלם בטעינה הבאה.            */
  function _openNew(c, item, kind) {
    const box = c.querySelector('.ex-new');
    const catSel = c.querySelector('.ex-cat');
    if (kind === 'sub' && !catSel.value) {
      catSel.value = ''; c.querySelector('.ex-sub').value = '';
      box.querySelector('.ex-new-msg').textContent = 'בחר קטגוריה קודם.';
      box.hidden = false; return;
    }
    box.dataset.kind = kind;
    box.querySelector('.ex-new-lbl').textContent =
      kind === 'cat' ? 'קטגוריה חדשה:' : `תת-קטגוריה חדשה תחת "${catSel.value}":`;
    box.querySelector('.ex-new-msg').textContent = '';
    box.querySelector('.ex-new-in').value = '';
    box.hidden = false;
    box.querySelector('.ex-new-in').focus();
    (kind === 'cat' ? catSel : c.querySelector('.ex-sub')).value = '';
    _btn(c, item);
  }

  function _wireNew(c, item) {
    const box = c.querySelector('.ex-new');
    const inp = box.querySelector('.ex-new-in'), msg = box.querySelector('.ex-new-msg');
    box.querySelector('.ex-new-x').onclick = () => { box.hidden = true; };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); box.querySelector('.ex-new-ok').click(); } };
    box.querySelector('.ex-new-ok').onclick = async () => {
      const name = inp.value.trim();
      if (!name) { msg.textContent = 'צריך שם.'; return; }
      const kind = box.dataset.kind;
      const catSel = c.querySelector('.ex-cat'), subSel = c.querySelector('.ex-sub');
      const category = kind === 'cat' ? name : catSel.value;
      const subcategory = kind === 'cat' ? '' : name;
      msg.textContent = 'שומר…';
      try {
        await DataService.post('categories.upsert', { category, subcategory });
        DataService.clearCache && DataService.clearCache();
        _cats = await DataService.getCategories().catch(() => _cats);
        catSel.innerHTML = _catOpts(category);
        catSel.value = category;
        subSel.innerHTML = _subOpts(category, subcategory);
        subSel.value = subcategory;
        c.querySelectorAll('.ex-r-cat').forEach(s => { const v = s.value; s.innerHTML = _catOpts('', 'row'); s.value = v; });
        box.hidden = true;
        _btn(c, item);
      } catch (e) {
        if (e && e.unauthorized) return;
        msg.textContent = 'לא נשמר: ' + (e && e.message ? e.message : e);
      }
    };
  }

  /* ---------------- שמירת מצב תצוגה ----------------
     `#content` הוא שנגלל, לא החלון: `#app` הוא flex בגובה 100vh עם
     overflow hidden. `window.scrollTo` פשוט לא היה עושה כלום.        */
  const _scrollBox = () => document.getElementById('content') || document.scrollingElement;

  const _erVal = el => ({
    cat: el.querySelector('.ex-er-cat').value,
    sub: el.querySelector('.ex-er-sub').value,
    tag: el.querySelector('.ex-er-tag').value.trim(),
  });

  function _snap() {
    if (!_container) return null;
    const box = _scrollBox();
    const st = { cards: {}, cats: {}, y: box ? box.scrollTop : 0 };
    _container.querySelectorAll('.ex-card').forEach(c => {
      const rows = c.querySelector('.ex-rows');
      st.cards[c.dataset.k] = {
        open: c.classList.contains('open'),
        detail: !!(rows && !rows.hidden),
        sel: c._sel || null,
        cat: c.querySelector('.ex-cat').value,
        sub: c.querySelector('.ex-sub').value,
        tag: c.querySelector('.ex-tagin').value,
        rows: [...c.querySelectorAll('.ex-r')].map(el => ({
          id: el.dataset.id,
          cat: el.querySelector('.ex-r-cat').value,
          sub: el.querySelector('.ex-r-sub').value,
          tag: el.querySelector('.ex-r-tag').value,
        })),
      };
    });
    _container.querySelectorAll('.ex-crow').forEach(b => {
      const ed = b.querySelector('.ex-edit');
      if (!ed || ed.hidden) return;
      st.cats[b.dataset.cat] = [...ed.querySelectorAll('.ex-er')]
        .map(el => Object.assign({ id: el.dataset.id }, _erVal(el)));
    });
    return st;
  }

  function _restore(st) {
    if (!st || !_container) return;

    _container.querySelectorAll('.ex-card').forEach(c => {
      const s = st.cards[c.dataset.k], item = _itemOf(c.dataset.k);
      if (!s || !item) return;
      /* בחירה משוחזרת **רק** לשורות שעדיין ממתינות. שורה שאושרה בינתיים
         כבר אינה ברשימה, וסימון שלה היה נשאר תלוי באוויר. */
      if (s.sel) {
        const live = {};
        _rowsOf(item).forEach(r => { live[r.id] = 1; });
        Object.keys(s.sel).forEach(id => { if (live[id]) c._sel[id] = s.sel[id]; });
      }
      if (s.cat) {
        c.querySelector('.ex-cat').value = s.cat;
        const sub = c.querySelector('.ex-sub');
        sub.innerHTML = _subOpts(s.cat, s.sub);
        sub.value = s.sub || '';
      }
      c.querySelector('.ex-tagin').value = s.tag || '';
      if (s.open) c.classList.add('open');
      if (s.detail) c.querySelector('.ex-detail').click();
      (s.rows || []).forEach(r => {
        const el = [...c.querySelectorAll('.ex-r')].find(x => x.dataset.id === r.id);
        if (!el) return;
        if (r.cat) {
          el.querySelector('.ex-r-cat').value = r.cat;
          const s2 = el.querySelector('.ex-r-sub');
          s2.innerHTML = _subOpts(r.cat, r.sub, 'row');
          s2.value = r.sub || '';
        }
        el.querySelector('.ex-r-tag').value = r.tag || '';
      });
      _syncRows(c); _btn(c, item);
    });

    Object.keys(st.cats || {}).forEach(cat => {
      const b = [..._container.querySelectorAll('.ex-crow')].find(x => x.dataset.cat === cat);
      if (!b) return;
      b.querySelector('.ex-row').click();          /* בונה, מחווט ופותח */
      const ed = b.querySelector('.ex-edit');
      st.cats[cat].forEach(r => {
        const el = [...ed.querySelectorAll('.ex-er')].find(x => x.dataset.id === r.id);
        if (!el) return;
        el.querySelector('.ex-er-cat').value = r.cat;
        const s2 = el.querySelector('.ex-er-sub');
        s2.innerHTML = _subOpts(r.cat, r.sub, 'edit');
        s2.value = r.sub || '';
        el.querySelector('.ex-er-tag').value = r.tag || '';
      });
      if (ed._mark) ed._mark();
    });

    /* קריאת `scrollHeight` מאלצת פריסה. בלעדיה הדפדפן עדיין מחזיק את
       הגובה שלפני הציור מחדש, קוצץ את ההשמה לגובה הישן, והמסך קופץ
       לראש הרשימה — בדיוק מה שהתיקון הזה בא למנוע. ה-rAF תופס את
       המקרה שבו הפריסה נדחית בכל זאת (תמונות, גופנים).             */
    const box = _scrollBox();
    if (box) {
      void box.scrollHeight;
      box.scrollTop = st.y;
      requestAnimationFrame(() => { if (box.scrollTop !== st.y) box.scrollTop = st.y; });
    }
  }

  /* ---------------- עריכה אחורה ----------------
     שורה שכבר אושרה נעלמת ממסך הסיווג — וזה נכון, אחרת הרשימה לא
     הייתה מתקצרת לעולם. אבל בלי דרך חזרה, טעות אחת נשארת בנתונים
     לתמיד. הכניסה היא דרך המספר שנראה שגוי: לוחצים על הקטגוריה
     ומקבלים בדיוק את השורות שמרכיבות אותו, באותו סינון בדיוק.       */
  const _rowsInCat = cat =>
    ExpensesEngine.rowsIn(_rows, { basis: _basis, month: _month, washPairs: _wash, cat })
      .sort((a, b) => Math.abs(b.charge) - Math.abs(a.charge));

  function _editHtml(cat) {
    const list = _rowsInCat(cat);
    if (!list.length) return '<div class="ex-note">אין שורות בקטגוריה הזו בתקופה שנבחרה.</div>';
    return `${list.map(r => `<div class="ex-er" data-id="${esc(r.id)}">
        <span class="ex-er-d">${_dm(r.date)}</span>
        <span class="ex-er-n" title="${esc(r.merchant)}">${esc(r.norm)}</span>
        <span class="ex-er-a">${money(r.charge)}</span>
        <select class="ex-er-cat">${_catOpts(r.cat, 'edit')}</select>
        <select class="ex-er-sub">${_subOpts(r.cat, r.sub, 'edit')}</select>
        <input class="ex-er-tag" list="ex-taglist" placeholder="תג" value="${esc(r.tag || '')}">
      </div>`).join('')}
      <div class="ex-er-foot">
        <button class="ex-er-save" type="button" disabled>אין שינויים</button>
        <span class="ex-er-msg">${list.length} ${list.length === 1 ? 'שורה' : 'שורות'} · שינוי נשמר רק בלחיצה</span>
      </div>`;
  }

  function _wireEdit(ed) {
    const save = ed.querySelector('.ex-er-save'), msg = ed.querySelector('.ex-er-msg');
    if (!save) return;
    /* מצב הפתיחה הוא נקודת האמת. "מה השתנה" נמדד מולו, ולכן שינוי
       וחזרה לערך המקורי אינם נחשבים שינוי — ולא נשלחים לשרת.        */
    const base = {};
    const cards = () => [...ed.querySelectorAll('.ex-er')];
    const dirty = () => cards().filter(el => {
      const a = base[el.dataset.id], b = _erVal(el);
      return a && (a.cat !== b.cat || a.sub !== b.sub || a.tag !== b.tag);
    });
    function mark() {
      const d = dirty(), blank = d.filter(el => !_erVal(el).cat).length;
      save.disabled = !d.length || blank > 0;
      save.textContent = !d.length ? 'אין שינויים'
        : blank ? `${blank} שורות בלי קטגוריה`
        : `שמור ${d.length} ${d.length === 1 ? 'שינוי' : 'שינויים'}`;
    }
    ed._mark = mark;
    cards().forEach(el => {
      base[el.dataset.id] = _erVal(el);
      el.querySelector('.ex-er-cat').onchange = e => {
        const s = el.querySelector('.ex-er-sub');
        s.innerHTML = _subOpts(e.target.value, '', 'edit');
        mark();
      };
      el.querySelector('.ex-er-sub').onchange = mark;
      el.querySelector('.ex-er-tag').oninput = mark;
    });

    save.onclick = async () => {
      const d = dirty();
      if (!d.length) return;
      const items = d.map(el => {
        const v = _erVal(el);
        return { id: el.dataset.id, category: v.cat, subcategory: v.sub, tag: v.tag };
      });
      save.disabled = true; save.textContent = 'שומר…';
      try {
        /* בלי `rule`. תיקון של טעות אינו הצהרה על כל העתיד — כלל נוצר
           רק במסך הסיווג, שם זו בחירה מפורשת עם תיבת סימון.          */
        await DataService.post('expenses.approve', { items, rule: null },
          { writeId: 'ed-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) });
        const by = {};
        items.forEach(x => { by[x.id] = x; });
        _rows.forEach(r => {
          const x = by[r.id];
          if (!x) return;
          r.cat = x.category; r.sub = x.subcategory; r.tag = x.tag; r.status = 'ok';
        });
        _recompute();
        _paint(_snap());
      } catch (e) {
        save.disabled = false; mark();
        if (e && e.unauthorized) return;
        msg.textContent = 'לא נשמר: ' + (e && e.message ? e.message : e);
      }
    };
    mark();
  }

  /* ---------------- ניהול קטגוריות ----------------
     אין פעולת "מזג" נפרדת: שינוי שם לשם שכבר קיים **הוא** האיחוד.
     שתי פעולות שעושות אותו דבר היו רק מכריחות לבחור ביניהן. הספירה
     מוצגת לפני האישור, כי זו הפעולה היחידה במערכת שנוגעת בשורות
     שכבר אושרו — ואין לה ביטול.                                     */
  const _countCat = (cat, sub) =>
    _rows.filter(r => r.cat === cat && (!sub || (r.sub || '') === sub)).length;

  function _mgrHtml() {
    if (!_mgr) return '';
    const m = _catMap();
    return `<div class="ex-panel ex-mgr">
      <div class="ex-panel-head"><h3>ניהול קטגוריות</h3>
        <button class="ex-mgr-x" type="button">סגור</button></div>
      ${_mgrMsg ? `<div class="ex-mgr-ok">${esc(_mgrMsg)}</div>` : ''}
      ${Object.keys(m).map(cat => `
        <div class="ex-mg" data-cat="${esc(cat)}">
          <div class="ex-mg-h" data-sub="">
            <i class="ex-dotc" style="background:${_catColor(cat)}"></i>
            <b class="ex-mg-n">${esc(cat)}</b>
            <span class="ex-mg-c">${_countCat(cat)} שורות</span>
            <button class="ex-mg-e" type="button" title="שנה שם לקטגוריה">✎</button>
          </div>
          ${(m[cat] || []).filter(Boolean).map(sub => `
            <div class="ex-mg-h ex-mg-s" data-sub="${esc(sub)}">
              <span class="ex-mg-n">${esc(sub)}</span>
              <span class="ex-mg-c">${_countCat(cat, sub)}</span>
              <button class="ex-mg-e" type="button" title="שנה שם או אחד עם קיים">✎</button>
            </div>`).join('')}
        </div>`).join('')}
      <div class="ex-note">שם חדש שכבר קיים = <b>איחוד</b>. כל השורות של הישן עוברות אליו, והשם הישן נעלם מהרשימה ומהכללים. אין ביטול — לכן מוצג כמה שורות יזוזו לפני האישור.</div>
    </div>`;
  }

  function _mgrEdit(host, cat, sub) {
    if (host.querySelector('.ex-mg-in')) return;
    const cur = sub || cat, keep = host.innerHTML;
    const back = () => { host.innerHTML = keep; _wireMgr(); };
    host.innerHTML = `<input class="ex-mg-in" value="${esc(cur)}">
      <button class="ex-mg-ok" type="button">שמור</button>
      <button class="ex-mg-no" type="button">ביטול</button>
      <span class="ex-mg-msg"></span>`;
    const inp = host.querySelector('.ex-mg-in'), msg = host.querySelector('.ex-mg-msg');

    const exists = v => {
      const m = _catMap();
      return sub ? (m[cat] || []).indexOf(v) >= 0 : Object.keys(m).indexOf(v) >= 0;
    };
    const preview = () => {
      const v = inp.value.trim(), n = _countCat(cat, sub);
      msg.textContent = !v ? 'צריך שם.'
        : v === cur ? ''
        : exists(v) ? `יאוחד עם "${v}" — ${n} ${n === 1 ? 'שורה תעבור' : 'שורות יעברו'}.`
        : `${n} ${n === 1 ? 'שורה תשנה' : 'שורות ישנו'} שם.`;
    };
    inp.oninput = preview; preview();
    inp.focus(); inp.select();
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); host.querySelector('.ex-mg-ok').click(); }
      if (e.key === 'Escape') back();
    };
    host.querySelector('.ex-mg-no').onclick = back;
    host.querySelector('.ex-mg-ok').onclick = async () => {
      const v = inp.value.trim();
      if (!v) { msg.textContent = 'צריך שם.'; return; }
      if (v === cur) { back(); return; }
      msg.textContent = 'שומר…';
      try {
        const res = await DataService.post('categories.rename',
          sub ? { category: cat, subcategory: sub, toCategory: cat, toSubcategory: v }
              : { category: cat, toCategory: v },
          { writeId: 'rn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) });
        DataService.clearCache && DataService.clearCache();
        const n = (res && res.moved) || 0;
        _mgrMsg = `"${cur}" → "${v}" · ${n} ${n === 1 ? 'שורה עודכנה' : 'שורות עודכנו'}` +
                  (res && res.merged ? ' (אוחד).' : '.');
        await _load();
      } catch (e) {
        if (e && e.unauthorized) return;
        msg.textContent = 'לא נשמר: ' + (e && e.message ? e.message : e);
      }
    };
  }

  function _wireMgr() {
    _container.querySelectorAll('.ex-mgr .ex-mg-e').forEach(b => {
      b.onclick = () => {
        const host = b.closest('.ex-mg-h');
        _mgrEdit(host, host.closest('.ex-mg').dataset.cat, host.dataset.sub || '');
      };
    });
  }

  function _wireSpend() {
    _container.querySelectorAll('.ex-crow').forEach(b => {
      const ed = b.querySelector('.ex-edit');
      b.querySelector('.ex-row').onclick = () => {
        const open = ed.hidden;
        if (open && !ed.dataset.built) {
          ed.innerHTML = _editHtml(b.dataset.cat);
          ed.dataset.built = '1';
          _wireEdit(ed);
        }
        ed.hidden = !open;
        b.classList.toggle('open', open);
      };
    });
    const t = _container.querySelector('.ex-mgr-t');
    if (t) t.onclick = () => { _mgr = !_mgr; if (!_mgr) _mgrMsg = ''; _paint(_snap()); };
    const x = _container.querySelector('.ex-mgr-x');
    if (x) x.onclick = () => { _mgr = false; _mgrMsg = ''; _paint(_snap()); };
    _wireMgr();
  }

  /* ⛔ המפתח **אינו** מיקום ברשימה. `g0`/`s3` נראו תמימים, אבל הרשימה
     נבנית מחדש אחרי כל אישור — ולכן כל שחזור של מצב תצוגה לפי מיקום
     היה מחזיר את הפתיחה, הבחירה והסימון לכרטיס **אחר** שתפס את המקום.
     המפתח חייב להיות תכונה של הקבוצה עצמה — אותו מפתח בדיוק כמו `_busy`. */
  function _itemOf(k) {
    const all = (_groups || []).concat(_singles || []);
    for (let i = 0; i < all.length; i++) if (_busyKey(all[i]) === k) return all[i];
    return null;
  }
  function _memsOf(item) { return item.members || [item]; }

  function _btn(c, item) {
    const chosen = _rowsOf(item).filter(r => c._sel && c._sel[r.id]);
    const sum = chosen.reduce((a, r) => a + r.charge, 0);
    const cat = c.querySelector('.ex-cat').value;
    const perRow = [...c.querySelectorAll('.ex-r')]
      .filter(el => c._sel[el.dataset.id] && el.querySelector('.ex-r-cat').value).length;
    /* שורה עם קטגוריה משלה עומדת בפני עצמה — לכן מותר לאשר גם בלי
       קטגוריה קבוצתית, כל עוד לכל שורה נבחרת יש אחת.                 */
    const uncovered = chosen.length - perRow;
    const btn = c.querySelector('.ex-go');
    const busy = _busy[_busyKey(item)];
    btn.disabled = !chosen.length || (!cat && uncovered > 0) || busy;
    btn.textContent = busy ? 'שומר…'
      : !chosen.length ? 'לא נבחר דבר'
      : (!cat && uncovered > 0) ? `בחר קטגוריה (${uncovered} שורות בלי)`
      : `אשר ${chosen.length} ${chosen.length === 1 ? 'שורה' : 'שורות'} · ${money(sum)}`;
  }

  /* אישור: שולח **שורה-שורה** — מזהה, קטגוריה, תת-קטגוריה ותג. ברירת
     המחדל לכל שורה היא בחירת הקבוצה; שורה שנגעו בה שולחת את שלה.
     הכלל נכתב בנפרד ומשפיע רק על קליטות עתידיות.                      */
  async function _approve(c, item) {
    const cat = c.querySelector('.ex-cat').value;
    const sub = c.querySelector('.ex-sub').value;
    const tag = c.querySelector('.ex-tagin').value.trim();
    const mkRule = c.querySelector('.ex-rule input').checked;
    const chosen = _rowsOf(item).filter(r => c._sel && c._sel[r.id]);
    if (!chosen.length) return;

    const over = {};
    c.querySelectorAll('.ex-r').forEach(el => {
      over[el.dataset.id] = {
        cat: el.querySelector('.ex-r-cat').value,
        sub: el.querySelector('.ex-r-sub').value,
        tag: el.querySelector('.ex-r-tag').value.trim(),
      };
    });

    const items = chosen.map(r => {
      const o = over[r.id] || {};
      return { id: r.id,
               category: o.cat || cat,
               subcategory: o.cat ? o.sub : sub,
               tag: o.tag || tag };
    });
    if (items.some(x => !x.category)) return;

    const bk = _busyKey(item);
    _busy[bk] = true; _btn(c, item);
    try {
      await DataService.post('expenses.approve', {
        items,
        rule: mkRule && cat ? { pattern: item.members ? item.token : item.norm,
                                match: item.members ? 'contains' : 'equals', field: 'merchant' } : null,
      }, { writeId: 'ap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) });
      const by = {};
      items.forEach(x => { by[x.id] = x; });
      _rows.forEach(r => {
        const x = by[r.id];
        if (!x) return;
        r.cat = x.category; r.sub = x.subcategory; r.tag = x.tag; r.status = 'ok';
      });
      /* ניקוי גם במסלול ההצלחה. בלעדיו הסימון נשאר לנצח, וכיוון
         שהרשימה נבנית מחדש — כפתור של קבוצה אחרת ננעל על ״שומר״. */
      delete _busy[bk];
      /* צילום **לפני** הציור מחדש: כרטיסים פתוחים, בחירות שורה, בוררים
         שכבר נגעו בהם ומקום הגלילה. בלעדיו כל שמירה החזירה את המסך
         לראש הרשימה וסגרה כרטיסים שנפתחו לעריכה — בדיוק המצב שבו
         מדייקים כמה שורות ברצף.                                       */
      const keep = _snap();
      delete keep.cards[bk];
      _recompute();
      c.classList.add('gone');
      setTimeout(() => { _paint(keep); }, 380);
    } catch (e) {
      delete _busy[bk]; _btn(c, item);
      if (e && e.unauthorized) return;
      alert('השמירה נכשלה: ' + (e && e.message ? e.message : e) + '\nשום דבר לא נכתב.');
    }
  }


  function reload() { if (_container) render(_container); }

  /* פירוט האשראי, לשימוש מסך העו״ש בקיזוז מול שורות הסילוק. חשיפה
     של קריאה בלבד — הקיזוז לא נוגע בנתונים, רק מציג התלכדות.      */
  function rows() { return _rows || []; }

  return { render, reload, rows };
})();
