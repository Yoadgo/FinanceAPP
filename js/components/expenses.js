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
  let _busy = {};

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
    _container = container; _tab = 'sort'; _month = 'all';
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
  function _paint() {
    if (!_container) return;
    const s = ExpensesEngine.summarize(_rows, { basis: _basis, washPairs: _wash });
    const decisions = _groups.length + _singles.length;
    _container.innerHTML = `
      <div class="ex">
        <div class="ex-head">
          <div>
            <div class="ex-sub">${_rows.length} שורות אשראי · ${s.byMonth.length} חודשי חיוב · ${money(s.total)}</div>
          </div>
          <div class="ex-tabs">
            <button class="ex-tab${_tab==='sort'?' on':''}" data-tab="sort">לסיווג${decisions?` <i>${decisions}</i>`:''}</button>
            <button class="ex-tab${_tab==='spend'?' on':''}" data-tab="spend">על מה הוצאנו</button>
          </div>
        </div>
        ${_tab === 'sort' ? _paintSort(s) : _paintSpend(s)}
      </div>${_tagList()}`;
    _wire();
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
      ${_groups.map((g, i) => _card(g, 'g' + i)).join('')}
      ${_singles.length ? `<div class="ex-sect">${_singles.length} סוחרים בודדים</div>` : ''}
      ${_singles.map((m, i) => _card(m, 's' + i)).join('')}`;
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
    return `<div class="ex-card" data-k="${key}">
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
        <select class="ex-r-cat">${_catOpts('', true)}</select>
        <select class="ex-r-sub"><option value="">—</option></select>
        <input class="ex-r-tag" list="ex-taglist" placeholder="תג">
      </div>`).join('');
  }

  function _catOpts(sel, rowLevel) {
    const m = _catMap();
    return `<option value="">${rowLevel ? 'כמו הקבוצה' : 'קטגוריה…'}</option>` +
      Object.keys(m).map(c => `<option${c===sel?' selected':''}>${esc(c)}</option>`).join('') +
      (rowLevel ? '' : '<option value="__new">+ קטגוריה חדשה…</option>');
  }
  function _subOpts(cat, sel, rowLevel) {
    const m = _catMap();
    const head = `<option value="">${rowLevel ? '—' : '—'}</option>`;
    if (!cat) return head;
    const list = (m[cat] || []).map(x => `<option${x===sel?' selected':''}>${esc(x)}</option>`).join('');
    return head + list + (rowLevel ? '' : '<option value="__new">+ תת-קטגוריה חדשה…</option>');
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
          <div class="ex-basis">
            <button class="${_basis==='billing'?'on':''}" data-basis="billing">לפי חיוב</button>
            <button class="${_basis==='date'?'on':''}" data-basis="date">לפי עסקה</button>
          </div></div>
        <div class="ex-mo">
          <button class="${_month==='all'?'on':''}" data-m="all">כל התקופה</button>
          ${months.map(m => `<button class="${_month===m?'on':''}" data-m="${esc(m)}">${esc(String(m))}</button>`).join('')}
        </div>
        ${rows.map(c => `<div class="ex-row">
            <div class="nm">${esc(c.cat)}</div>
            <div class="ex-track"><i class="ex-fill" style="width:${Math.max(1.5, c.sum/max*100)}%;background:${_catColor(c.cat)}"></i></div>
            <div class="vl">${money(c.sum)}</div></div>`).join('')}
        <div class="ex-note">${sm.pending > 1
          ? `${money(sm.pending)} עדיין לא מסווגים — זה הפס האפור. כל קבוצה שתאשר מעבירה סכום ממנו לקטגוריה אמיתית.`
          : 'כל שקל מסווג. זו התמונה המלאה.'}</div>
      </div>
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
      rc.onchange = () => { rs.innerHTML = _subOpts(rc.value, '', true); _btn(c, item); };
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
        c.querySelectorAll('.ex-r-cat').forEach(s => { const v = s.value; s.innerHTML = _catOpts('', true); s.value = v; });
        box.hidden = true;
        _btn(c, item);
      } catch (e) {
        if (e && e.unauthorized) return;
        msg.textContent = 'לא נשמר: ' + (e && e.message ? e.message : e);
      }
    };
  }

  function _itemOf(k) { return k[0] === 'g' ? _groups[+k.slice(1)] : _singles[+k.slice(1)]; }
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
    btn.disabled = !chosen.length || (!cat && uncovered > 0) || _busy[c.dataset.k];
    btn.textContent = _busy[c.dataset.k] ? 'שומר…'
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

    _busy[c.dataset.k] = true; _btn(c, item);
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
      _recompute();
      c.classList.add('gone');
      setTimeout(() => { _paint(); }, 380);
    } catch (e) {
      _busy[c.dataset.k] = false; _btn(c, item);
      if (e && e.unauthorized) return;
      alert('השמירה נכשלה: ' + (e && e.message ? e.message : e) + '\nשום דבר לא נכתב.');
    }
  }


  function reload() { if (_container) render(_container); }

  return { render, reload };
})();
