/* accounts.js — ניהול חשבונות.
   ============================================================================
   רכיב אחד שמשרת כמה מסכים, ומסונן לפי סוג: תיקי השקעות פותחים אותו עם
   `types: ['brokerage']`, חסכונות עם `['pension']`, ובהמשך מסך ההוצאות
   יפתח אותו עם `['bank','card']`. זה מה שיועד ביקש — חשבון מנוהל במסך של
   העולם שלו, לא במסך הגדרות מרכזי.

   שלוש החלטות שנראות שרירותיות ואינן:

   1. **שינוי שם הוא פעולה נפרדת עם תצוגה מקדימה.** `Transactions.Portfolio`
      מפנה לחשבון **לפי מחרוזת שם**, ומפתח מנוע ה-FIFO הוא (portfolio,
      symbol). שינוי שם בלי לכתוב מחדש את התנועות מוחק את ההיסטוריה בשקט.
      השרת מחזיר קודם כמה שורות ישתנו, והמשתמש מאשר מספר — לא הבטחה.

   2. **אין עדכון אופטימי.** השורה מסומנת "נשמר…" ומתעדכנת רק אחרי אישור
      מהשרת. באפליקציה פיננסית להראות מספר כאילו נשמר כשהוא לא זה בדיוק
      הכשל שהאפיון אוסר.

   3. **המודאל הוא ילד ישיר של body.** `backdrop-filter` על הורה חוסם
      ילדים — מלכודת ששילמנו עליה כבר ב-CBA.
   ========================================================================== */
window.FA = window.FA || {};

FA.accounts = (function () {
  "use strict";

  var TYPE_LABEL = {
    brokerage: 'תיק השקעות',
    pension:   'פנסיה / קרן',
    bank:      'חשבון בנק',
    card:      'כרטיס אשראי',
    loan:      'הלוואה'
  };

  var el = null, state = null;

  function esc(s) { return FA.ui.esc(String(s == null ? '' : s)); }

  /* ---------- פתיחה ---------- */
  /* opts: { types: ['brokerage'], title, onChange } */
  function open(opts) {
    if (el) return;
    opts = opts || {};
    state = {
      types: opts.types && opts.types.length ? opts.types : Object.keys(TYPE_LABEL),
      title: opts.title || 'ניהול חשבונות',
      onChange: typeof opts.onChange === 'function' ? opts.onChange : function () {},
      rows: null,
      editing: null,      // null | {} חדש | רשומה קיימת
      busy: false,
      dirty: false        // האם שינינו משהו — קובע אם לרענן את המסך בסגירה
    };

    el = document.createElement('div');
    el.className = 'fa-dlg-backdrop';
    el.innerHTML = '<div class="fa-dlg fa-acc" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(el);

    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    document.addEventListener('keydown', onKey);

    paint();
    load();
  }

  function onKey(e) { if (e.key === 'Escape') close(); }

  function close() {
    if (!el) return;
    document.removeEventListener('keydown', onKey);
    if (el.parentNode) el.parentNode.removeChild(el);
    var changed = state && state.dirty, cb = state && state.onChange;
    el = null; state = null;
    if (changed && cb) cb();
  }

  function isOpen() { return !!el; }

  async function load() {
    try {
      var res = await DataService.post('accounts.list', {});
      state.rows = (res.accounts || []).filter(function (a) {
        return state.types.indexOf(a.type) !== -1;
      });
      paint();
    } catch (e) {
      if (e && e.unauthorized) { close(); return; }   // השער כבר עלה
      state.rows = [];
      paint(String(e && e.message ? e.message : e));
    }
  }

  /* ---------- ציור ---------- */
  function paint(errMsg) {
    if (!el) return;
    var box = el.querySelector('.fa-dlg');

    if (state.rows === null) {
      box.innerHTML = head() + '<div class="fa-acc__body">' + FA.skel.lines(4) + '</div>';
      bindHead();
      return;
    }

    if (state.editing) { box.innerHTML = head() + form(); bindHead(); bindForm(); return; }

    var body = errMsg
      ? FA.ui.errorState({ detail: errMsg, actionId: 'acc-retry' })
      : (state.rows.length ? list() : FA.ui.emptyState({
          title: 'אין כאן חשבונות עדיין',
          text: 'הוסף חשבון כדי שתנועות יוכלו להשתייך אליו.'
        }));

    box.innerHTML = head() +
      '<div class="fa-acc__body">' + body + '</div>' +
      '<div class="fa-acc__foot">' +
        '<button class="fa-btn fa-btn--primary" id="acc-add">חשבון חדש</button>' +
      '</div>';
    bindHead();

    var retry = box.querySelector('#acc-retry');
    if (retry) retry.addEventListener('click', function () { state.rows = null; paint(); load(); });

    var add = box.querySelector('#acc-add');
    if (add) add.addEventListener('click', function () {
      state.editing = { isNew: true, type: state.types[0] };
      paint();
    });

    box.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var row = state.rows.filter(function (r) { return r.id === b.dataset.edit; })[0];
        if (row) { state.editing = Object.assign({}, row); paint(); }
      });
    });
  }

  function head() {
    return '<div class="fa-acc__head">' +
      '<div class="fa-dlg__title">' + esc(state.title) + '</div>' +
      '<button class="fa-acc__x" id="acc-close" aria-label="סגירה">✕</button>' +
    '</div>';
  }
  function bindHead() {
    var x = el.querySelector('#acc-close');
    if (x) x.addEventListener('click', close);
  }

  function list() {
    return '<ul class="fa-acc__list">' + state.rows.map(function (a) {
      var sub = [TYPE_LABEL[a.type] || a.type];
      if (a.institution) sub.push(a.institution);
      if (a.last4) sub.push('•••• ' + a.last4);
      if (a.currency) sub.push(a.currency);
      return '<li class="fa-acc__row' + (a.status === 'archived' ? ' is-archived' : '') + '">' +
        '<div class="fa-acc__main">' +
          '<div class="fa-acc__name">' + esc(a.name) +
            (a.status === 'archived' ? ' <span class="fa-acc__tag">בארכיון</span>' : '') + '</div>' +
          '<div class="fa-acc__sub">' + esc(sub.join(' · ')) + '</div>' +
        '</div>' +
        '<button class="fa-btn" data-edit="' + esc(a.id) + '">עריכה</button>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function form() {
    var e = state.editing, isNew = !!e.isNew;
    var typeOpts = state.types.map(function (t) {
      return '<option value="' + t + '"' + (t === e.type ? ' selected' : '') + '>' + esc(TYPE_LABEL[t] || t) + '</option>';
    }).join('');

    return '<div class="fa-acc__body">' +
      '<label class="fa-acc__f"><span>שם</span>' +
        (isNew
          ? '<input id="f-name" class="fa-acc__in" value="' + esc(e.name || '') + '" placeholder="למשל: איביאי-יועד" />'
          : '<div class="fa-acc__ro">' + esc(e.name) +
            '<button class="fa-btn" id="f-rename">שנה שם</button></div>') +
      '</label>' +
      '<label class="fa-acc__f"><span>סוג</span><select id="f-type" class="fa-acc__in">' + typeOpts + '</select></label>' +
      '<label class="fa-acc__f"><span>גוף מנהל</span><input id="f-inst" class="fa-acc__in" value="' + esc(e.institution || '') + '" placeholder="אופציונלי" /></label>' +
      '<label class="fa-acc__f"><span>מטבע</span><input id="f-curr" class="fa-acc__in" value="' + esc(e.currency || '') + '" placeholder="₪ / $" /></label>' +
      '<label class="fa-acc__f"><span>4 ספרות אחרונות</span><input id="f-last4" class="fa-acc__in" inputmode="numeric" maxlength="4" value="' + esc(e.last4 || '') + '" placeholder="לכרטיס בלבד" /></label>' +
      '<label class="fa-acc__f"><span>הערה</span><input id="f-notes" class="fa-acc__in" value="' + esc(e.notes || '') + '" /></label>' +
      '<div class="fa-acc__err" role="alert"></div>' +
    '</div>' +
    '<div class="fa-acc__foot">' +
      '<button class="fa-btn" id="f-back">חזרה</button>' +
      (isNew ? '' : '<button class="fa-btn" id="f-archive">' + (e.status === 'archived' ? 'החזרה מארכיון' : 'העברה לארכיון') + '</button>') +
      '<button class="fa-btn fa-btn--primary" id="f-save">שמירה</button>' +
    '</div>';
  }

  function val(id) { var n = el.querySelector(id); return n ? n.value.trim() : ''; }
  function showErr(msg) {
    var n = el.querySelector('.fa-acc__err');
    if (n) n.textContent = msg || '';
  }

  function bindForm() {
    el.querySelector('#f-back').addEventListener('click', function () { state.editing = null; paint(); });
    el.querySelector('#f-save').addEventListener('click', save);

    var ren = el.querySelector('#f-rename');
    if (ren) ren.addEventListener('click', rename);

    var arc = el.querySelector('#f-archive');
    if (arc) arc.addEventListener('click', archive);
  }

  async function save() {
    var btn = el.querySelector('#f-save');
    var e = state.editing;
    var payload = {
      name: e.isNew ? val('#f-name') : e.name,
      type: val('#f-type'),
      institution: val('#f-inst'),
      currency: val('#f-curr'),
      last4: val('#f-last4'),
      notes: val('#f-notes')
    };
    if (!e.isNew) payload.id = e.id;
    if (!payload.name) { showErr('שם חשבון הוא שדה חובה.'); return; }

    showErr('');
    FA.ui.busy(btn, 'נשמר…');
    try {
      await DataService.post('accounts.upsert', payload);
      state.dirty = true;
      state.editing = null;
      state.rows = null;
      paint();
      await load();
      FA.ui.toast('נשמר', 'ok');
    } catch (err) {
      FA.ui.idle(btn);
      if (err && err.unauthorized) { close(); return; }
      showErr(String(err && err.message ? err.message : err));
    }
  }

  /* שינוי שם: קודם תצוגה מקדימה מהשרת, ורק אחרי אישור מספרי — ביצוע. */
  async function rename() {
    var e = state.editing;
    var next = window.prompt('שם חדש לחשבון "' + e.name + '":', e.name);
    if (next === null) return;
    next = String(next).trim();
    if (!next || next === e.name) return;

    try {
      var pv = await DataService.post('accounts.rename', { id: e.id, newName: next });
      var n = pv.rowsAffected || 0;
      var msg = n === 0
        ? 'אין תנועות שמפנות לחשבון הזה. לשנות את השם ל"' + next + '"?'
        : n + ' תנועות מפנות לחשבון הזה לפי שמו, וכולן ייכתבו מחדש ל"' + next + '".\n\nבלי זה ההיסטוריה של התיק תישבר. להמשיך?';
      var okGo = await FA.ui.confirm(msg, { title: 'שינוי שם חשבון', okLabel: 'שנה שם' });
      if (!okGo) return;

      var res = await DataService.post('accounts.rename', { id: e.id, newName: next, confirm: true });
      state.dirty = true;
      state.editing = null;
      state.rows = null;
      paint();
      await load();
      FA.ui.toast('השם שונה — ' + (res.rowsAffected || 0) + ' תנועות עודכנו', 'ok');
    } catch (err) {
      if (err && err.unauthorized) { close(); return; }
      showErr(String(err && err.message ? err.message : err));
    }
  }

  async function archive() {
    var e = state.editing;
    var back = e.status === 'archived';
    if (back) {
      state.editing = Object.assign({}, e, { status: 'active' });
      await save();
      return;
    }
    var okGo = await FA.ui.confirm(
      'החשבון "' + e.name + '" יועבר לארכיון ולא יוצג ברשימות הפעילות. התנועות שלו נשארות במקומן.',
      { title: 'העברה לארכיון', okLabel: 'העבר לארכיון' });
    if (!okGo) return;
    try {
      var res = await DataService.post('accounts.archive', { id: e.id });
      state.dirty = true;
      state.editing = null;
      state.rows = null;
      paint();
      await load();
      FA.ui.toast(res.deleted ? 'החשבון נמחק' : 'הועבר לארכיון', 'ok');
    } catch (err) {
      if (err && err.unauthorized) { close(); return; }
      showErr(String(err && err.message ? err.message : err));
    }
  }

  return { open: open, close: close, isOpen: isOpen, TYPE_LABEL: TYPE_LABEL };
})();
