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
      </div>`;
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
        <div class="ex-foot">
          <select class="ex-cat">${_catOpts(sug.cat)}</select>
          <select class="ex-sub">${_subOpts(sug.cat, sug.sub)}</select>
          <label class="ex-rule"><input type="checkbox" checked> צור כלל לעתיד</label>
          <button class="ex-go">אשר</button>
        </div>
      </div></div>`;
  }

  function _catOpts(sel) {
    const m = _catMap();
    return '<option value="">קטגוריה…</option>' +
      Object.keys(m).map(c => `<option${c===sel?' selected':''}>${esc(c)}</option>`).join('');
  }
  function _subOpts(cat, sel) {
    const m = _catMap();
    if (!cat || !m[cat] || !m[cat].length) return '<option value="">—</option>';
    return '<option value="">—</option>' + m[cat].map(x => `<option${x===sel?' selected':''}>${esc(x)}</option>`).join('');
  }

  function _paintSpend(s) {
    const months = s.byMonth.map(x => x.month).sort();
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
          ${months.map(m => `<button class="${_month===m?'on':''}" data-m="${esc(m)}">${esc(String(m).slice(0,5))}</button>`).join('')}
        </div>
        ${rows.map(c => `<div class="ex-row">
            <div class="nm">${esc(c.cat)}</div>
            <div class="ex-track"><i class="ex-fill" style="width:${Math.max(1.5, c.sum/max*100)}%;background:${PAL[c.cat]||'#94A3B8'}"></i></div>
            <div class="vl">${money(c.sum)}</div></div>`).join('')}
        <div class="ex-note">${sm.pending > 1
          ? `${money(sm.pending)} עדיין לא מסווגים — זה הפס האפור. כל קבוצה שתאשר מעבירה סכום ממנו לקטגוריה אמיתית.`
          : 'כל שקל מסווג. זו התמונה המלאה.'}</div>
      </div>
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
      c.querySelector('.ex-c-head').onclick = () => c.classList.toggle('open');
      c.querySelectorAll('.ex-mem input').forEach(b => b.onchange = () => {
        b.closest('.ex-mem').classList.toggle('off', !b.checked); _btn(c, item);
      });
      const cat = c.querySelector('.ex-cat'), sub = c.querySelector('.ex-sub');
      cat.onchange = () => { sub.innerHTML = _subOpts(cat.value); _btn(c, item); };
      c.querySelector('.ex-go').onclick = () => _approve(c, item);
      _btn(c, item);
    });
  }

  function _itemOf(k) { return k[0] === 'g' ? _groups[+k.slice(1)] : _singles[+k.slice(1)]; }
  function _memsOf(item) { return item.members || [item]; }

  function _btn(c, item) {
    const mems = _memsOf(item);
    const boxes = [...c.querySelectorAll('.ex-mem input')];
    let rows = 0, sum = 0, picked = [];
    boxes.forEach((b, j) => { if (b.checked) { rows += mems[j].rows; sum += mems[j].total; picked.push(mems[j]); } });
    const btn = c.querySelector('.ex-go'), cat = c.querySelector('.ex-cat').value;
    btn.disabled = !rows || !cat || _busy[c.dataset.k];
    btn.textContent = _busy[c.dataset.k] ? 'שומר…'
      : !rows ? 'לא נבחר דבר' : !cat ? 'בחר קטגוריה' : `אשר ${rows} שורות · ${money(sum)}`;
    c._picked = picked;
  }

  /* אישור: שולח את **מזהי השורות שסומנו בפועל**, לא דפוס. הכלל נכתב
     בנפרד ומשפיע רק על קליטות עתידיות — לא נוגע בשום שורה קיימת.      */
  async function _approve(c, item) {
    const cat = c.querySelector('.ex-cat').value;
    const sub = c.querySelector('.ex-sub').value;
    const mkRule = c.querySelector('.ex-rule input').checked;
    const picked = c._picked || [];
    if (!cat || !picked.length) return;
    const ids = [];
    const names = {};
    picked.forEach(m => { names[m.norm] = 1; });
    _rows.forEach(r => { if (names[r.norm] && !r.cat) ids.push(r.id); });
    if (!ids.length) return;

    _busy[c.dataset.k] = true; _btn(c, item);
    try {
      await DataService.post({
        action: 'expenses.approve', ids, category: cat, subcategory: sub,
        rule: mkRule ? { pattern: item.members ? item.token : item.norm,
                         match: item.members ? 'contains' : 'equals', field: 'merchant' } : null,
        writeId: 'ap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      });
      _rows.forEach(r => { if (names[r.norm] && !r.cat) { r.cat = cat; r.sub = sub; r.status = 'ok'; } });
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
