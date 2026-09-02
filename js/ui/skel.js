/* skel.js — שלדי טעינה תואמי-צורה.
   ============================================================================
   במקום שורת "טוען..." במרכז מסך ריק, מציירים מיד את הצורה של התוכן שעומד
   להופיע. כשהנתונים חוזרים התוכן מתמלא לתוך אותו מקום בדיוק במקום לקפוץ.

   כלל לכל שימוש עתידי: בוחרים את הצורה שהכי דומה למה שבאמת יופיע שם.
   שלד שלא דומה לתוצאה גרוע יותר מגלגל — הוא מבטיח דבר אחד ומביא אחר.

   כל הפונקציות מחזירות מחרוזת HTML ולא נוגעות ב-DOM, בדיוק כמו FA.ui.
   המחלקות מוגדרות ב-css/ui.css (תחילית sk-).
   ========================================================================== */
window.FA = window.FA || {};

FA.skel = (function () {
  "use strict";

  /* רוחבי שורות משתנים — שורה שכל השורות בה באותו אורך נראית כמו טבלה ריקה,
     לא כמו טקסט שנטען. המחזוריות קבועה ולא אקראית, כדי ששני ציורים של אותו
     מסך ייראו זהים ולא "ירצדו" בין רענון לרענון. */
  var W = ["86%", "62%", "74%", "55%", "80%", "68%"];
  function w(i) { return W[i % W.length]; }

  function rep(n, fn) { var out = "", i; for (i = 0; i < n; i++) out += fn(i); return out; }
  function wrap(inner) {
    return '<div class="sk sk-stagger" role="status" aria-live="polite" aria-label="טוען">' + inner + '</div>';
  }
  function grid(cols, inner) {
    return '<div class="sk-row" style="grid-template-columns:repeat(' + cols + ',1fr)">' + inner + '</div>';
  }

  /* כותרת גדולה — הכרטיס הכחול של השווי הנקי */
  function hero() { return '<div class="skeleton sk-hero"></div>'; }

  /* שורת אריחי סטטיסטיקה */
  function stats(n) {
    return grid(n || 4, rep(n || 4, function () { return '<div class="skeleton sk-card"></div>'; }));
  }

  /* גרף */
  function chart() { return '<div class="skeleton sk-chart"></div>'; }

  /* כרטיסים בשורה */
  function cards(n, cols) {
    return grid(cols || n || 3, rep(n || 3, function () { return '<div class="skeleton sk-card"></div>'; }));
  }

  /* טבלה — כותרת ואז שורות */
  function table(rows, cols) {
    rows = rows || 8; cols = cols || 5;
    function line(i) {
      return grid(cols, rep(cols, function (c) {
        return '<div class="skeleton sk-cell" style="width:' + w(i + c) + '"></div>';
      }));
    }
    return '<div class="sk-row" style="gap:14px">' +
             grid(cols, rep(cols, function () { return '<div class="skeleton sk-cell lg"></div>'; })) +
             rep(rows, line) +
           '</div>';
  }

  /* שורות טקסט */
  function lines(n) {
    return rep(n || 3, function (i) {
      return '<div class="skeleton sk-line" style="width:' + w(i) + '"></div>';
    });
  }

  /* ── שלדים מוכנים למסכים ──
     כל אחד מצייר את הצורה של המסך שלו, לא צורה כללית. */
  function dashboard() {
    return wrap(hero() + stats(4) + chart() + stats(4));
  }
  function portfolio() {
    return wrap(stats(4) + grid(2, '<div class="skeleton sk-chart"></div>' +
                                   '<div class="skeleton sk-chart"></div>') + table(7, 6));
  }
  function tablePage(rows, cols) { return wrap(stats(3) + table(rows || 10, cols || 6)); }

  return {
    hero: hero, stats: stats, chart: chart, cards: cards,
    table: table, lines: lines, wrap: wrap,
    dashboard: dashboard, portfolio: portfolio, tablePage: tablePage
  };
})();
