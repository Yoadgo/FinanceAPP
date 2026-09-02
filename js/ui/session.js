/* session.js — מושב הכניסה בצד הלקוח.
   ============================================================================
   האפליקציה היא אתר סטטי ציבורי שקורא cross-origin, ולכן ההגנה לא יכולה
   להישען על הפריסה של Apps Script — היא יושבת בתוך doGet. הצד הזה אחראי על
   שלושה דברים בלבד:
     1. להחזיק את המושב ב-localStorage.
     2. לצרף אותו לכל בקשה (DataService עושה את זה דרך FA.session.get).
     3. להציג שער כניסה כשהשרת עונה "unauthorized".

   השער מוצג **בתגובה לשגיאה**, לא מראש. כך, כל עוד המתג בשרת כבוי, אף אחד
   לא רואה מסך כניסה ושום דבר לא משתנה. ברגע שהמתג נדלק — הבקשה הראשונה
   נכשלת, השער עולה, ומאותו רגע הדגל נשמר מקומית כך שבטעינות הבאות הוא
   מוצג מיד ולא אחרי כישלון.
   ========================================================================== */
window.FA = window.FA || {};

FA.session = (function () {
  "use strict";

  var KEY  = 'fapp_session_v1';
  var FLAG = 'fapp_needs_auth_v1';

  function get() { try { return localStorage.getItem(KEY) || null; } catch (e) { return null; } }
  function set(t) { try { localStorage.setItem(KEY, t); localStorage.setItem(FLAG, '1'); } catch (e) {} }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function needsAuth() { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return false; } }
  function markNeedsAuth() { try { localStorage.setItem(FLAG, '1'); } catch (e) {} }

  /* התחברות: שולחת את הסיסמה, מקבלת מושב חתום. הסיסמה עצמה לא נשמרת בשום מקום. */
  function login(pass) {
    return DataService.login(pass).then(function (res) {
      if (!res || !res.session) throw new Error('unauthorized');
      set(res.session);
      return res.session;
    });
  }

  /* ---------- שער הכניסה ---------- */
  var el = null;

  function open(onSuccess) {
    if (el) return;                       // כבר פתוח — לא לפתוח שניים
    markNeedsAuth();

    el = document.createElement('div');
    el.className = 'fa-gate';
    el.innerHTML =
      '<div class="fa-gate__card">' +
        '<img class="fa-gate__logo" src="assets/logo.png" alt="" />' +
        '<div class="fa-gate__title">FinanceAPP</div>' +
        '<div class="fa-gate__sub">הנתונים מוגנים. הזן את קוד הגישה כדי להמשיך.</div>' +
        '<input class="fa-gate__input" type="password" inputmode="text" ' +
               'autocomplete="current-password" placeholder="קוד גישה" aria-label="קוד גישה" />' +
        '<button class="fa-btn fa-btn--primary fa-gate__btn">כניסה</button>' +
        '<div class="fa-gate__err" role="alert"></div>' +
      '</div>';
    document.body.appendChild(el);

    var input = el.querySelector('.fa-gate__input');
    var btn   = el.querySelector('.fa-gate__btn');
    var err   = el.querySelector('.fa-gate__err');

    function submit() {
      var pass = input.value.trim();
      if (!pass) { input.focus(); return; }
      err.textContent = '';
      FA.ui.busy(btn, 'בודק…');

      login(pass).then(function () {
        close();
        if (typeof onSuccess === 'function') onSuccess();
      }).catch(function (e) {
        FA.ui.idle(btn);
        // הודעה כללית בכוונה: "הקוד שגוי" ו"אין חיבור" נראים אותו דבר למי
        // שמנחש, ואין סיבה לעזור לו להבחין.
        err.textContent = /unauthorized/i.test(e && e.message ? e.message : '')
          ? 'קוד הגישה שגוי.'
          : 'לא הצלחנו להתחבר. בדוק חיבור לרשת ונסה שוב.';
        input.select();
      });
    }

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    setTimeout(function () { input.focus(); }, 30);
  }

  function close() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }

  function isOpen() { return !!el; }

  return { get: get, set: set, clear: clear, needsAuth: needsAuth,
           login: login, open: open, close: close, isOpen: isOpen };
})();
