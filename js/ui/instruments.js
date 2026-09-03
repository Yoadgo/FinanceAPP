/* instruments.js — ניהול ניירות ערך.
   ============================================================================
   הרשימה כאן היא **איחוד** של שני מקורות: מה שרשום בטאב `Symbols`, ומה
   שנסחר בפועל לפי התנועות. זה מכוון — הטאב נוצר ריק, ואילו הרשימה
   שמעניינת את יועד היא הניירות שהוא באמת קנה.

   הערך המרכזי של המסך הזה הוא לא העריכה אלא **החשיפה**: נייר שנסחר אבל
   אין לו היסטוריה מוערך בגרף ההתפתחות לפי **עלות ולא לפי שווי**. זה עיוות
   שקט — הגרף נראה תקין לגמרי — ואי אפשר לגלות אותו בלי לחפש אותו במפורש.
   כך התגלה ש-IBIT, שעדיין מוחזק, מוערך לפי עלות.

   התיקון הוא `GoogleSymbol`: אם GOOGLEFINANCE לא מזהה את הסימבול, מזינים
   כאן את הצורה שהוא כן מזהה (למשל `NASDAQ:IBIT`), ואז מריצים
   `buildRefreshAll` בגיליון.
   ========================================================================== */
window.FA = window.FA || {};

FA.instruments = (function () {
  "use strict";

  var el = null, state = null;
  function esc(s) { return FA.ui.esc(String(s == null ? '' : s)); }

  function open(opts) {
    if (el) return;
    opts = opts || {};
    state = {
      onChange: typeof opts.onChange === 'function' ? opts.onChange : function () {},
      rows: null, editing: null, dirty: false, builtAt: null, onlyMissing: false
    };
    el = document.createElement('div');
    el.className = 'fa-dlg-backdrop';
    el.innerHTML = '<div class="fa-dlg fa-acc fa-ins" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    document.addEventListener('keydown', onKey);
    paint();
    load();
  }

  function onKey(e) { if (e.key === 'Escape' && !state.editing) close(); }

  function close() {
    if (!el) return;
    document.removeEventListener('keydown', onKey);
    if (el.parentNode) el.parentNode.removeChild(el);
    var changed = state && state.dirty, cb = state && state.onChange;
    el = null; state = null;
    if (changed && cb) cb();
  }
  function isOpen() { return !!el; }

  /* מאחד את הטאב עם מה שנסחר בפועל, ומסמן למי אין היסטוריה. */
  async function load() {
    try {
      var res  = await DataService.post('instruments.list', {});
      var txns = await DataService.getTransactions();
      var info = await DataService.getHistoryCacheInfo();

      var enriched = (window.Classifier ? Classifier.enrichAll(txns) : txns);
      var traded = {}, held = {};
      enriched.forEach(function (r) {
        var s = String(r.Symbol || '').trim().toUpperCase();
        if (/^[A-Z]{1,5}$/.test(s)) traded[s] = true;
      });
      try {
        (PortfolioEngine.computePositions(enriched) || []).forEach(function (p) { held[p.symbol] = true; });
      } catch (e) {}

      var known = {};
      (res.instruments || []).forEach(function (i) { known[String(i.symbol).toUpperCase()] = i; });

      var cached = info && Array.isArray(info.symbols)
        ? info.symbols.reduce(function (m, s) { m[String(s).toUpperCase()] = true; return m; }, {})
        : null;                                   // null = מצב המטמון לא ידוע

      var all = {};
      Object.keys(known).forEach(function (s) { all[s] = true; });
      Object.keys(traded).forEach(function (s) { all[s] = true; });

      state.builtAt = info ? info.builtAt : null;
      state.rows = Object.keys(all).sort().map(function (sym) {
        var rec = known[sym] || { symbol: sym };
        return {
          symbol: sym,
          googleSymbol: rec.googleSymbol || '',
          name: rec.name || '', type: rec.type || '',
          currency: rec.currency || '', sector: rec.sector || '',
          status: rec.status || 'active', notes: rec.notes || '',
          onSheet: !!known[sym], traded: !!traded[sym], held: !!held[sym],
          hasHistory: cached ? !!cached[sym] : null
        };
      });
      paint();
    } catch (e) {
      if (e && e.unauthorized) { close(); return; }
      state.rows = [];
      paint(String(e && e.message ? e.message : e));
    }
  }

  function head() {
    return '<div class="fa-acc__head">' +
      '<div><div class="fa-dlg__title">ניהול ניירות ערך</div>' +
      (state.builtAt ? '<div class="fa-ins__meta">מטמון ההיסטוריה נבנה ' + esc(fmtWhen(state.builtAt)) + '</div>' : '') +
      '</div><button class="fa-acc__x" id="ins-close" aria-label="סגירה">✕</button></div>';
  }
  function fmtWhen(iso) {
    try { var d = new Date(iso); return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', {hour:'2-digit',minute:'2-digit'}); }
    catch (e) { return iso; }
  }
  function bindHead() {
    var x = el.querySelector('#ins-close'); if (x) x.addEventListener('click', close);
  }

  function paint(errMsg) {
    if (!el) return;
    var box = el.querySelector('.fa-dlg');

    if (state.rows === null) { box.innerHTML = head() + '<div class="fa-acc__body">' + FA.skel.lines(6) + '</div>'; bindHead(); return; }
    if (state.editing) { box.innerHTML = head() + form(); bindHead(); bindForm(); return; }

    /* נייר שמוחזק היום ואין לו היסטוריה הוא המקרה שבאמת מעוות מספר על
       המסך. נייר סגור בלי היסטוריה כבר לא משפיע על שום דבר. */
    var broken = state.rows.filter(function (r) { return r.held && r.hasHistory === false; });
    var missing = state.rows.filter(function (r) { return r.traded && r.hasHistory === false; });

    var banner = broken.length
      ? '<div class="fa-ins__warn"><b>' + broken.length + ' ' +
        (broken.length === 1 ? 'נייר שאתה מחזיק היום חסר היסטוריה' : 'ניירות שאתה מחזיק היום חסרים היסטוריה') +
        '</b> — ' + esc(broken.map(function (r) { return r.symbol; }).join(', ')) +
        '. בגרף ההתפתחות הם מוערכים לפי <b>עלות ולא לפי שווי</b>. ' +
        'התיקון: להזין GoogleSymbol שגוגל מזהה (למשל <code>NASDAQ:IBIT</code>) ואז להריץ ' +
        '<code>buildRefreshAll</code> בגיליון.</div>'
      : '';

    var list = (state.onlyMissing ? missing : state.rows);
    var body = errMsg
      ? FA.ui.errorState({ detail: errMsg, actionId: 'ins-retry' })
      : (list.length ? rows(list) : FA.ui.emptyState({ title: 'אין ניירות להצגה' }));

    box.innerHTML = head() +
      '<div class="fa-acc__body">' + banner +
        (missing.length ? '<label class="fa-ins__filter"><input type="checkbox" id="ins-only"' +
          (state.onlyMissing ? ' checked' : '') + ' /> רק ניירות בלי היסטוריה (' + missing.length + ')</label>' : '') +
        body +
      '</div>' +
      '<div class="fa-acc__foot"><button class="fa-btn fa-btn--primary" id="ins-add">נייר חדש</button></div>';
    bindHead();

    var rt = box.querySelector('#ins-retry');
    if (rt) rt.addEventListener('click', function () { state.rows = null; paint(); load(); });
    var only = box.querySelector('#ins-only');
    if (only) only.addEventListener('change', function () { state.onlyMissing = only.checked; paint(); });
    var add = box.querySelector('#ins-add');
    if (add) add.addEventListener('click', function () { state.editing = { isNew: true }; paint(); });
    box.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var row = state.rows.filter(function (r) { return r.symbol === b.dataset.edit; })[0];
        if (row) { state.editing = Object.assign({}, row); paint(); }
      });
    });
  }

  function rows(list) {
    return '<ul class="fa-acc__list">' + list.map(function (r) {
      var tags = [];
      if (r.held) tags.push('<span class="fa-ins__tag is-held">מוחזק</span>');
      if (r.hasHistory === false) tags.push('<span class="fa-ins__tag is-warn">אין היסטוריה</span>');
      if (!r.onSheet) tags.push('<span class="fa-ins__tag">לא מוגדר</span>');
      if (r.status === 'archived') tags.push('<span class="fa-acc__tag">בארכיון</span>');
      var sub = [r.name, r.googleSymbol, r.sector].filter(Boolean).join(' · ');
      return '<li class="fa-acc__row' + (r.status === 'archived' ? ' is-archived' : '') + '">' +
        '<div class="fa-acc__main">' +
          '<div class="fa-acc__name">' + esc(r.symbol) + ' ' + tags.join(' ') + '</div>' +
          (sub ? '<div class="fa-acc__sub">' + esc(sub) + '</div>' : '') +
        '</div>' +
        '<button class="fa-btn" data-edit="' + esc(r.symbol) + '">עריכה</button>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function form() {
    var e = state.editing, isNew = !!e.isNew;
    return '<div class="fa-acc__body">' +
      '<label class="fa-acc__f"><span>סימבול</span>' +
        (isNew ? '<input id="i-sym" class="fa-acc__in" value="" placeholder="AAPL" />'
               : '<div class="fa-acc__ro">' + esc(e.symbol) + '</div>') + '</label>' +
      '<label class="fa-acc__f"><span>GoogleSymbol' +
        (e.hasHistory === false ? ' — <b style="color:var(--danger)">כאן התיקון</b>' : ' (רק אם גוגל לא מזהה את הסימבול)') +
        '</span><input id="i-goog" class="fa-acc__in" value="' + esc(e.googleSymbol || '') + '" placeholder="NASDAQ:AAPL" /></label>' +
      '<label class="fa-acc__f"><span>שם</span><input id="i-name" class="fa-acc__in" value="' + esc(e.name || '') + '" /></label>' +
      '<label class="fa-acc__f"><span>סוג</span><input id="i-type" class="fa-acc__in" value="' + esc(e.type || '') + '" placeholder="מניה / ETF / קריפטו" /></label>' +
      '<label class="fa-acc__f"><span>מטבע</span><input id="i-curr" class="fa-acc__in" value="' + esc(e.currency || '') + '" placeholder="$" /></label>' +
      '<label class="fa-acc__f"><span>סקטור</span><input id="i-sec" class="fa-acc__in" value="' + esc(e.sector || '') + '" /></label>' +
      '<label class="fa-acc__f"><span>הערה</span><input id="i-notes" class="fa-acc__in" value="' + esc(e.notes || '') + '" /></label>' +
      '<div class="fa-acc__err" role="alert"></div>' +
    '</div>' +
    '<div class="fa-acc__foot">' +
      '<button class="fa-btn" id="i-back">חזרה</button>' +
      (isNew || e.status === 'archived' ? '' : '<button class="fa-btn" id="i-arch">העברה לארכיון</button>') +
      '<button class="fa-btn fa-btn--primary" id="i-save">שמירה</button>' +
    '</div>';
  }

  function val(id) { var n = el.querySelector(id); return n ? n.value.trim() : ''; }
  function showErr(m) { var n = el.querySelector('.fa-acc__err'); if (n) n.textContent = m || ''; }

  function bindForm() {
    el.querySelector('#i-back').addEventListener('click', function () { state.editing = null; paint(); });
    el.querySelector('#i-save').addEventListener('click', save);
    var a = el.querySelector('#i-arch');
    if (a) a.addEventListener('click', archive);
  }

  async function save() {
    var btn = el.querySelector('#i-save'), e = state.editing;
    var payload = {
      symbol: e.isNew ? val('#i-sym') : e.symbol,
      googleSymbol: val('#i-goog'), name: val('#i-name'), type: val('#i-type'),
      currency: val('#i-curr'), sector: val('#i-sec'), notes: val('#i-notes')
    };
    if (!payload.symbol) { showErr('סימבול הוא שדה חובה.'); return; }
    showErr(''); FA.ui.busy(btn, 'נשמר…');
    try {
      await DataService.post('instruments.upsert', payload);
      state.dirty = true; state.editing = null; state.rows = null;
      paint(); await load();
      FA.ui.toast('נשמר', 'ok');
    } catch (err) {
      FA.ui.idle(btn);
      if (err && err.unauthorized) { close(); return; }
      showErr(String(err && err.message ? err.message : err));
    }
  }

  async function archive() {
    var e = state.editing;
    var go = await FA.ui.confirm('הנייר "' + e.symbol + '" יסומן בארכיון. התנועות שלו נשארות במקומן.',
      { title: 'העברה לארכיון', okLabel: 'העבר לארכיון' });
    if (!go) return;
    try {
      await DataService.post('instruments.archive', { symbol: e.symbol });
      state.dirty = true; state.editing = null; state.rows = null;
      paint(); await load();
      FA.ui.toast('הועבר לארכיון', 'ok');
    } catch (err) {
      if (err && err.unauthorized) { close(); return; }
      showErr(String(err && err.message ? err.message : err));
    }
  }

  return { open: open, close: close, isOpen: isOpen };
})();
