/* savings.js — חסכונות, פנסיה וקרנות.
   ============================================================================
   המסך הזה היה קיים בניווט וריק לחלוטין. יועד ביקש במפורש לשמור אותו
   ("לא הבנתי למה להסיר, אני רוצה שיהיה מקום לנהל את זה") — הבעיה מעולם
   לא הייתה שהוא מיותר, אלא שלא היה בו כלום.

   מה שיש בו עכשיו: ניהול החשבונות מסוג פנסיה וקרן. זה מה שיועד ביקש —
   כל סוג חשבון מנוהל במסך של העולם שלו.

   מה שאין בו, ובכוונה: **מספרים.** צבירה ותשואה דורשות נתוני יתרות
   שעדיין לא נקלטים, וזה שלב 5. מסך שמראה אפס או מספר משוער נראה בדיוק
   כמו מסך שמראה נתון אמיתי — וזה הכשל שהאפיון אוסר במפורש. עד שיהיו
   נתונים, המסך אומר מה חסר במקום להמציא.
   ========================================================================== */
Pages.savings = (() => {

  let _container = null;

  function render(container) {
    _container = container;
    container.innerHTML = FA.skel.cards(3, 3);
    _load();
  }

  async function _load() {
    try {
      App.setDataStatus('loading');
      const res = await DataService.post('accounts.list', {});
      const rows = (res.accounts || []).filter(a => a.type === 'pension');
      App.setDataStatus('live');
      _paint(rows);
    } catch (err) {
      if (err && err.unauthorized) return;   // השער עלה; refreshData יצייר מחדש
      App.setDataStatus('error', err.message);
      _container.innerHTML = FA.ui.errorState({ detail: err.message, actionId: 'sv-retry' });
      const b = document.getElementById('sv-retry');
      if (b) b.addEventListener('click', () => { _container.innerHTML = FA.skel.cards(3, 3); _load(); });
    }
  }

  function _card(a) {
    const sub = [a.institution, a.currency].filter(Boolean).join(' · ');
    return `<div class="pf-macro-card sv-card${a.status === 'archived' ? ' is-archived' : ''}">
      <div class="pf-macro-label">${FA.ui.esc(sub || 'פנסיה / קרן')}</div>
      <div class="sv-card__name">${FA.ui.esc(a.name)}</div>
      <div class="pf-macro-sub">${a.status === 'archived' ? 'בארכיון' : 'פעיל'}</div>
    </div>`;
  }

  function _paint(rows) {
    const active = rows.filter(a => a.status !== 'archived');

    const body = rows.length
      ? `<div class="sv-grid">${rows.map(_card).join('')}</div>`
      : FA.ui.emptyState({
          title: 'עוד לא הגדרת קרנות',
          text: 'הוסף כאן את קרנות הפנסיה, ההשתלמות והגמל שלך. בשלב הבא הן יקבלו צבירה, הפקדות ותשואה.',
          actionLabel: 'הוספת קרן', actionId: 'sv-add'
        });

    _container.innerHTML =
      `<div class="sv-head">
         <div>
           <div class="sv-head__title">קרנות וחסכונות</div>
           <div class="sv-head__sub">${active.length} ${active.length === 1 ? 'קרן פעילה' : 'קרנות פעילות'}</div>
         </div>
         <button class="fa-btn fa-btn--primary" id="sv-manage">ניהול קרנות</button>
       </div>
       ${body}
       <div class="fa-state sv-note">
         <div class="fa-state__title">צבירה ותשואה עדיין לא כאן</div>
         <div class="fa-state__text">המספרים דורשים יתרות תקופתיות מהדוחות של הגופים המנהלים, וזו קליטה שעוד לא נבנתה. עד אז המסך מנהל את רשימת הקרנות בלבד — ולא מציג מספר שאי אפשר לעמוד מאחוריו.</div>
       </div>`;

    const openMgr = () => FA.accounts.open({
      types: ['pension'],
      title: 'ניהול קרנות וחסכונות',
      onChange: () => { _container.innerHTML = FA.skel.cards(3, 3); _load(); }
    });
    const m = document.getElementById('sv-manage'); if (m) m.addEventListener('click', openMgr);
    const a = document.getElementById('sv-add');    if (a) a.addEventListener('click', openMgr);
  }

  return { render };
})();
