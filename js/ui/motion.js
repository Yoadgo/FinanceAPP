/* motion.js — שכבת תנועה, נפרדת לגמרי מלוגיקת האפליקציה.
   ============================================================================
   לא נוגעת בנתונים, במסכים או ב-DataService. רק מוסיפה התנהגות ויזואלית על
   אלמנטים קיימים. אם הקובץ הזה לא היה נטען, האפליקציה הייתה עובדת בדיוק
   אותו דבר — פשוט בלי המחוון הנוזלי ובלי הבהק.

   שני דברים:
   1. מחוון ניווט נוזלי — כמוסת זכוכית שגולשת אנכית בין פריטי הרייל.
   2. בהק ספקולרי עוקב-סמן על כרטיסים (כותב --mx/--my, ה-CSS עושה את השאר).
   ========================================================================== */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 1. מחוון הניווט ---------- */
  function setupNavIndicator() {
    var nav = document.querySelector(".sidebar-nav");
    if (!nav) return;

    var ind = nav.querySelector(".nav-indicator");
    if (!ind) {
      ind = document.createElement("div");
      ind.className = "nav-indicator";
      nav.insertBefore(ind, nav.firstChild);
    }

    function position(animate) {
      var active = nav.querySelector(".nav-item.active");
      // פריט פעיל שלא נמצא/מוסתר → מסתירים את המחוון במקום למקם אותו על אוויר
      if (!active || !active.offsetHeight) { ind.style.opacity = "0"; return ind; }

      if (!animate) ind.style.transition = "none";
      ind.style.height = active.offsetHeight + "px";
      ind.style.transform = "translateY(" + active.offsetTop + "px)";
      ind.style.opacity = "1";
      if (!animate) { void ind.offsetWidth; ind.style.transition = ""; }
      return ind;
    }

    // מיקום ראשוני בלי אנימציה — אחרת המחוון "עף" מלמעלה בכל טעינה
    position(false);

    // הרייל נבנה מחדש ב-app.js בכל ניווט; observer שורד את זה בלי לדעת עליו
    new MutationObserver(function () { position(!reduceMotion); })
      .observe(nav, { attributes: true, attributeFilter: ["class"], subtree: true, childList: true });

    nav.addEventListener("scroll", function () { position(false); }, { passive: true });
    window.addEventListener("resize", function () { position(false); }, { passive: true });
  }

  /* ---------- 2. בהק עוקב-סמן ---------- */
  function setupSpecular() {
    if (reduceMotion) return;
    var SEL = ".db-link, .stat-card, .pf-macro-card";
    document.addEventListener("pointermove", function (e) {
      var el = e.target && e.target.closest ? e.target.closest(SEL) : null;
      if (!el) return;
      var r = el.getBoundingClientRect();
      el.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100) + "%");
      el.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100) + "%");
    }, { passive: true });
  }

  /* ---------- 3. סרגל עליון מוקפא בגלילה ----------
     מאזינים ל-#content ולא ל-window: #app הוא flex בגובה 100vh עם overflow
     hidden, כלומר העמוד עצמו לא נגלל — רק אזור התוכן. */
  function setupTopbarScroll() {
    var bar = document.getElementById("topbar");
    var content = document.getElementById("content");
    if (!bar || !content) return;

    var ticking = false;
    function apply() {
      bar.classList.toggle("is-scrolled", content.scrollTop > 4);
      ticking = false;
    }
    content.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(apply);
    }, { passive: true });
    apply();
  }

  function boot() { setupNavIndicator(); setupSpecular(); setupTopbarScroll(); }

  // app.js מצייר את הרייל ב-DOMContentLoaded; רצים אחריו
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 0); });
  } else {
    setTimeout(boot, 0);
  }
})();
