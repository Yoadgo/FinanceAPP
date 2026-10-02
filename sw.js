/* ================================================================
   SERVICE WORKER — "תמיד הגרסה האחרונה". (2.10.2026)

   הבעיה: ?v= ב-index.html חל רק על app.js. כל שאר הקבצים מיובאים
   ממנו בלי גרסה, ו-GitHub Pages אומר לדפדפן לשמור אותם 10 דקות
   (max-age=600). אחרי דחיפה הדפדפן הריץ תערובת של קבצים חדשים
   וישנים — וגם Cmd+Shift+R לא עזר למודולים שנטענים מאוחר.

   הפתרון: כל בקשה לקובץ של האתר עצמו יוצאת עם cache:'no-cache' —
   הדפדפן שואל את GitHub "השתנה?" ומקבל 304 קצר אם לא. תמיד עדכני,
   בלי רשימת קבצים לתחזק ובלי שלב בנייה.

   מה הוא לא עושה: לא נוגע ב-Firebase, בגוגל או ב-CDN (מקור אחר),
   לא שומר שום דבר לעבודה בלי רשת (זה שלב 7 — PWA), ולא נוגע בניווט
   עצמו (index.html) — את זה הדפדפן כבר מאמת לבד.
   ביטול: למחוק את הקובץ ואת שורת הרישום ב-js/app.js — וב-sw.js ריק
   שנשאר בדפדפנים: self.registration.unregister().
   ================================================================ */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || r.mode === 'navigate') return;
  if (new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(fetch(r, { cache: 'no-cache' }).then(res => {
    /* גם התשובה עצמה מסומנת no-cache: אחרת הזיכרון הפנימי של הדפדפן
       מגיש את המודול שוב בלי לעבור כאן (נמצא בבדיקה, 2.10.2026). */
    if (res.type !== 'basic') return res;
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-cache');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }));
});
