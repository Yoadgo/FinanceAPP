/* ui.js — רכיבי הממשק המשותפים.
   ============================================================================
   עד עכשיו כל מסך ייצר בעצמו HTML לטעינה, לריק ולשגיאה, ולכן כל מסך נראה
   קצת אחרת ואף אחד לא טיפל בכל המצבים. כאן יושבת החלופה: FA.ui.

   כל הבנאים (emptyState / errorState) מחזירים **מחרוזת HTML** ולא נוגעים
   ב-DOM — כך אפשר להרכיב אותם לתוך כל מסך בלי לשנות את מבנה הציור שלו.
   הדיאלוגים לעומת זאת יוצרים DOM בעצמם, תמיד כילד ישיר של <body>: אלמנט עם
   backdrop-filter הופך ל"שורש רקע" וחוסם את הטשטוש של ילדיו (מלכודת ידועה
   מ-CBA, שם מגש המשתמש נראה אטום עד שהעבירו אותו ל-body).

   alert/confirm מחזירים Promise, כי מודל אמיתי הוא א-סינכרוני מטבעו:
       if (!confirm("...")) return;
   הופך ל-
       FA.ui.confirm("...").then(ok => { if (!ok) return; ... });
   ========================================================================== */
window.FA = window.FA || {};

FA.ui = (function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function nl2br(s) { return esc(s).replace(/\n/g, "<br>"); }

  /* ---------- אייקונים ---------- */
  var ICON = {
    empty: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8M8 16h5"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.2v.1"/>',
    offline: '<path d="M2 8.8a16 16 0 0 1 20 0"/><path d="M5.5 12.4a11 11 0 0 1 13 0"/><path d="M9 16a6 6 0 0 1 6 0"/><path d="M12 20v.1"/><path d="m3 3 18 18"/>'
  };
  function svg(name) {
    return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
           'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (ICON[name] || ICON.empty) + '</svg>';
  }

  /* ---------- מצב ריק ----------
     opts: { title, text, icon, actionLabel, actionId } */
  function emptyState(opts) {
    opts = opts || {};
    return '<div class="fa-state">' +
      '<div class="fa-state__icon">' + svg(opts.icon || "empty") + '</div>' +
      '<div class="fa-state__title">' + esc(opts.title || "אין כאן עדיין כלום") + '</div>' +
      (opts.text ? '<div class="fa-state__text">' + nl2br(opts.text) + '</div>' : "") +
      (opts.actionLabel
        ? '<button class="fa-btn fa-btn--primary" ' +
          (opts.actionId ? 'id="' + esc(opts.actionId) + '" ' : "") +
          'style="margin-top:6px">' + esc(opts.actionLabel) + '</button>'
        : "") +
    '</div>';
  }

  /* ---------- מצב שגיאה ----------
     שלושה חלקים, וכולם נדרשים: מה קרה, מה זה אומר, ומה הצעד הבא. הודעת
     המערכת עצמה נשמרת בשורה נפרדת ובכיוון LTR — היא לרוב באנגלית.
     opts: { title, text, detail, actionLabel, actionId } */
  function errorState(opts) {
    opts = opts || {};
    return '<div class="fa-state fa-state--error">' +
      '<div class="fa-state__icon">' + svg(opts.icon || "error") + '</div>' +
      '<div class="fa-state__title">' + esc(opts.title || "לא הצלחנו לטעון את הנתונים") + '</div>' +
      '<div class="fa-state__text">' + nl2br(opts.text ||
        "הגיליון לא ענה. זה קורה לרוב כשאין חיבור לרשת, או כשהשרת עסוק לרגע.") + '</div>' +
      (opts.detail ? '<div class="fa-state__detail">' + esc(opts.detail) + '</div>' : "") +
      '<button class="fa-btn fa-btn--primary" ' +
        (opts.actionId ? 'id="' + esc(opts.actionId) + '" ' : "") +
        'style="margin-top:8px">' + esc(opts.actionLabel || "נסה שוב") + '</button>' +
    '</div>';
  }

  /* ---------- טוסט ---------- */
  var toastWrap = null;
  function toast(message, kind, ms) {
    if (!toastWrap) {
      toastWrap = document.createElement("div");
      toastWrap.className = "fa-toast-wrap";
      document.body.appendChild(toastWrap);
    }
    var t = document.createElement("div");
    t.className = "fa-toast" + (kind ? " fa-toast--" + kind : "");
    t.setAttribute("role", "status");
    t.textContent = String(message == null ? "" : message);
    toastWrap.appendChild(t);
    setTimeout(function () {
      t.classList.add("is-out");
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, ms || 2800);
    return t;
  }

  /* ---------- דיאלוג ---------- */
  function open(opts) {
    return new Promise(function (resolve) {
      var lastFocus = document.activeElement;

      var back = document.createElement("div");
      back.className = "fa-dlg-backdrop";
      back.innerHTML =
        '<div class="fa-dlg" role="dialog" aria-modal="true">' +
          (opts.title ? '<div class="fa-dlg__title">' + nl2br(opts.title) + '</div>' : "") +
          (opts.message ? '<div class="fa-dlg__msg">' + nl2br(opts.message) + '</div>' : "") +
          '<div class="fa-dlg__actions">' +
            '<button class="fa-btn fa-btn--primary" data-ok>' + esc(opts.okLabel || "אישור") + '</button>' +
            (opts.cancel ? '<button class="fa-btn" data-cancel>' + esc(opts.cancelLabel || "ביטול") + '</button>' : "") +
          '</div>' +
        '</div>';

      // תמיד ילד ישיר של body — ר' ההערה בראש הקובץ
      document.body.appendChild(back);

      function close(result) {
        document.removeEventListener("keydown", onKey, true);
        if (back.parentNode) back.parentNode.removeChild(back);
        if (lastFocus && lastFocus.focus) lastFocus.focus();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.stopPropagation(); close(opts.cancel ? false : true); }
        else if (e.key === "Enter") { e.stopPropagation(); close(true); }
      }

      back.querySelector("[data-ok]").addEventListener("click", function () { close(true); });
      var c = back.querySelector("[data-cancel]");
      if (c) c.addEventListener("click", function () { close(false); });
      back.addEventListener("click", function (e) { if (e.target === back) close(opts.cancel ? false : true); });
      document.addEventListener("keydown", onKey, true);

      back.querySelector("[data-ok]").focus();
    });
  }

  function alertBox(message, title)   { return open({ message: message, title: title }); }
  function confirmBox(message, opts)  {
    opts = opts || {};
    return open({ message: message, title: opts.title, cancel: true,
                  okLabel: opts.okLabel, cancelLabel: opts.cancelLabel });
  }

  /* ---------- כפתור בעבודה ----------
     שומר את הטקסט המקורי על האלמנט עצמו, כדי ש-idle יחזיר בדיוק אותו. */
  function busy(btn, text) {
    if (!btn) return;
    if (btn.dataset.faLabel == null) btn.dataset.faLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = text ? String(text) : btn.dataset.faLabel;
  }
  function idle(btn) {
    if (!btn) return;
    if (btn.dataset.faLabel != null) { btn.innerHTML = btn.dataset.faLabel; delete btn.dataset.faLabel; }
    btn.disabled = false;
  }

  return {
    emptyState: emptyState,
    errorState: errorState,
    toast: toast,
    alert: alertBox,
    confirm: confirmBox,
    busy: busy,
    idle: idle,
    esc: esc
  };
})();
