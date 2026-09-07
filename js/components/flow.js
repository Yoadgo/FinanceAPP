/* ===== PAGE: תזרים — כמה נשאר =====
   המסך שעונה על השאלה השלישית של יועד: **כמה אנחנו חוסכים.**

   היום הוא מציג רק את חצי ה״בפועל״. כשתיכנס תוכנית חודשית יתווסף
   כאן ״צפוי״ באותו מקום, ולכן המסך נבנה כתזרים ולא כמסך חיסכון
   נפרד — מסך כזה היה נזרק בסבב הבא.

   ⚠️ **זו מדידת תזרים ולא מאזן.** ״כמה הפרשנו״ (מהעו״ש) ו״כמה יש״
   (מהתיקים) הן שתי מדידות שונות של אותו חיסכון, ו**אסור לחבר
   אותן** — ההעברה לאיביאי הייתה נספרת גם כאן וגם כגידול בתיק.

   התוכנית יושבת כאן כטאב שני ולא כפריט ניווט: ״כמה תכננו״ בלי
   ״כמה יצא בפועל״ לידו מכריח לזכור מספר ולהשוות בראש.          */

Pages.flow = (() => {

  let _container = null, _bank = null, _credit = null, _wash = null, _open = {};
  let _tab = 'actual';

  /* מימוש אחד ב-`js/ui/money.js`. הכינוי המקומי נשאר כדי שאתרי הקריאה
     יישארו קצרים — מה שהיה כפול הוא הפורמט, לא השם. */
  const money = v => FA.money.ils(v);
  const signed = v => FA.money.signed(v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  function render(container) {
    _container = container; _open = {}; _tab = 'actual';
    container.innerHTML = FA.skel ? FA.skel.tablePage(6, 3) : '<div class="ex-load">טוען…</div>';
    _load();
  }

  async function _load() {
    try {
      App.setDataStatus('loading');
      const [b, e] = await Promise.all([
        DataService.getBank().catch(() => null),
        DataService.getExpenses().catch(() => null)
      ]);
      _bank = BankEngine.parseRows((b && b.values) || []);
      _credit = ExpensesEngine.parseRows((e && e.values) || []);
      _wash = ExpensesEngine.washPairs(_credit);
      App.setDataStatus('ok');
      _paint();
    } catch (err) {
      App.setDataStatus('error');
      if (err && err.unauthorized) return;
      _container.innerHTML = `<div class="ex-empty">
        <b>לא הצלחתי לטעון את התזרים</b>
        <p>${esc(err && err.message ? err.message : err)}</p>
        <button class="ex-btn" onclick="Pages.flow.reload()">נסה שוב</button></div>`;
    }
  }

  function _paint() {
    if (!_container) return;
    const m = FlowEngine.monthly(_bank, _credit, { washPairs: _wash });
    const s = FlowEngine.summary(m);

    if (!m.length) {
      _container.innerHTML = `<div class="ex-empty"><b>אין עדיין נתונים</b>
        <p>אחרי הקליטה הראשונה של עו״ש או אשראי המסך הזה יתמלא.</p></div>`;
      return;
    }

    _container.innerHTML = `<div class="fl">
      <div class="ex-head fl-head">
        <div class="ex-tabs">
          <button class="ex-tab${_tab==='actual'?' on':''}" data-ftab="actual">בפועל</button>
          <button class="ex-tab${_tab==='plan'?' on':''}" data-ftab="plan">תוכנית</button>
        </div>
      </div>
      ${_tab === 'plan' ? '<div class="fl-plan-host"></div>' : `
        ${_kpis(s)}
        ${s.unknownCount ? _warn(s) : ''}
        ${_monthsPanel(m, s)}
        ${_avgPanel(s)}
        ${_catsPanel()}
        <div class="ex-note fl-foot">זו מדידת <b>תזרים</b>: כמה הפרשנו בפועל מהחשבון. ״כמה <b>יש</b>״ נמדד במסך התיקים, והוא מספר אחר — <b>אסור לחבר את השניים</b>, כי ההעברה לחיסכון תיספר גם כאן וגם כגידול בתיק.</div>`}
    </div>`;
    _wire();

    if (_tab === 'plan') {
      const host = _container.querySelector('.fl-plan-host');
      if (host && typeof Pages !== 'undefined' && Pages.plan) {
        Pages.plan.render(host, { bank: _bank, credit: _credit, wash: _wash });
      }
    }
  }

  function _kpis(s) {
    const neg = s.saved < 0;
    return `<div class="ex-kpis fl-kpis">
      <div class="ex-kpi"><div class="l">נכנס</div><div class="v">${money(s.income)}</div>
        <div class="d">${s.months} ${s.months === 1 ? 'חודש' : 'חודשים'}</div></div>
      <div class="ex-kpi"><div class="l">יצא</div><div class="v">${money(s.spend)}</div>
        <div class="d">${money(s.spendBank)} מהעו״ש · ${money(s.spendCredit)} באשראי</div></div>
      <div class="ex-kpi fl-big${neg ? ' neg' : ''}"><div class="l">נשאר</div>
        <div class="v">${signed(s.saved)}</div>
        <div class="d">${s.rate === null ? '' : s.rate + '% מההכנסה'}</div></div>
    </div>`;
  }

  /* אזהרה ולא הסתרה: שורה בלי דלי היא כסף שזז ואיננו יודעים לאן.
     לספור אותה כהוצאה היה מנפח; להתעלם ממנה בשקט היה משקר.       */
  function _warn(s) {
    return `<div class="fl-warn">
      <b>${s.unknownCount} ${s.unknownCount === 1 ? 'שורת עו״ש' : 'שורות עו״ש'} בלי דלי</b>
      <span>${money(s.unknownSum)} שלא נספרים כאן — לא כהכנסה ולא כהוצאה. עד שיסווגו, ״נשאר״ אינו התמונה המלאה.</span>
      <button class="fl-go" type="button">לסיווג ←</button>
    </div>`;
  }

  function _monthsPanel(m, s) {
    const max = m.reduce((a, x) => Math.max(a, x.income, x.spend), 1);
    return `<div class="ex-panel">
      <div class="ex-panel-head"><h3>חודש אחר חודש</h3></div>
      ${m.map(x => `<div class="fl-m${_open[x.month] ? ' open' : ''}" data-m="${esc(x.month)}">
        <div class="fl-m-h">
          <span class="ex-chev">◀</span>
          <span class="fl-m-n">${esc(x.month)}</span>
          <span class="fl-bars">
            <i class="in"  style="width:${x.income / max * 100}%"></i>
            <i class="out" style="width:${x.spend  / max * 100}%"></i>
          </span>
          <span class="fl-m-v${x.saved < 0 ? ' neg' : ''}">${signed(x.saved)}</span>
          <span class="fl-m-r">${x.rate === null ? '—' : x.rate + '%'}</span>
        </div>
        <div class="fl-m-d">
          נכנס ${money(x.income)} · יצא ${money(x.spend)}
          (${money(x.spendBank)} עו״ש + ${money(x.spendCredit)} אשראי)${
            x.unknownCount ? ` · <b>${x.unknownCount} בלי דלי</b>` : ''}
        </div>
        <div class="fl-m-c" hidden></div>
      </div>`).join('')}
      <div class="ex-legend"><span><i class="ex-dot in"></i> נכנס</span><span><i class="ex-dot out"></i> יצא</span></div>
    </div>`;
  }

  /* הממוצע רץ רק על חודשים שנכנסה בהם הכנסה. חודש שנקלט חלקית היה
     מושך אותו למטה ומציג ״רגילות״ שמעולם לא קרתה.                */
  function _avgPanel(s) {
    return `<div class="ex-panel">
      <div class="ex-panel-head"><h3>חודש ממוצע</h3>
        <span class="fl-based">מבוסס על ${s.basedOn} ${s.basedOn === 1 ? 'חודש' : 'חודשים'}</span></div>
      <div class="fl-avg">
        <div><span class="l">נכנס</span><span class="v">${money(s.avgIncome)}</span></div>
        <div><span class="l">יצא</span><span class="v">${money(s.avgSpend)}</span></div>
        <div class="hi"><span class="l">נשאר</span><span class="v${s.avgSaved < 0 ? ' neg' : ''}">${signed(s.avgSaved)}</span></div>
      </div>
      ${s.best && s.worst && s.best.month !== s.worst.month ? `<div class="ex-note">
        הכי הרבה נשאר ב-<b>${esc(s.best.month)}</b> (${signed(s.best.saved)}), הכי מעט ב-<b>${esc(s.worst.month)}</b> (${signed(s.worst.saved)}).</div>` : ''}
      <div class="ex-note">שלושה חודשים הם בסיס דק, ואחד מהם עשוי להכיל אירוע חד-פעמי גדול. המספר הזה הוא נקודת פתיחה לתוכנית חודשית — לא תחזית.</div>
    </div>`;
  }

  function _catsPanel() {
    const cats = FlowEngine.spendByCategory(_bank, _credit, { washPairs: _wash });
    if (!cats.length) return '';
    const max = cats[0].sum || 1;
    return `<div class="ex-panel">
      <div class="ex-panel-head"><h3>לאן הלך הכסף</h3></div>
      ${cats.map(c => `<div class="ex-row">
        <div class="nm"><span class="ex-nm-t">${esc(c.cat)}</span>${
          c.bank && c.credit ? '<small class="fl-src">עו״ש + אשראי</small>'
          : c.bank ? '<small class="fl-src">עו״ש</small>' : ''}</div>
        <div class="ex-track">
          <i class="ex-fill" style="width:${Math.max(1.5, c.sum / max * 100)}%;background:${c.cat === 'בהמתנה' ? '#CBD5E1' : '#DC2626'}"></i>
        </div>
        <div class="vl">${money(c.sum)}</div></div>`).join('')}
      <div class="ex-note">הוצאות מהעו״ש ומהאשראי מאוחדות לפי קטגוריה — ״דיור״ בהוראת קבע ו״דיור״ בכרטיס הן אותה שאלה. סילוק האשראי אינו מופיע כאן: הכסף כבר נספר בפירוט שלו.</div>
    </div>`;
  }

  function _monthCats(month) {
    const cats = FlowEngine.spendByCategory(_bank, _credit, { month, washPairs: _wash });
    if (!cats.length) return '<div class="ex-note">אין הוצאות בחודש הזה.</div>';
    const max = cats[0].sum || 1;
    return cats.map(c => `<div class="ex-row">
      <div class="nm"><span class="ex-nm-t">${esc(c.cat)}</span></div>
      <div class="ex-track"><i class="ex-fill" style="width:${Math.max(1.5, c.sum / max * 100)}%;background:${c.cat === 'בהמתנה' ? '#CBD5E1' : '#DC2626'}"></i></div>
      <div class="vl">${money(c.sum)}</div></div>`).join('');
  }

  function _wire() {
    _container.querySelectorAll('[data-ftab]').forEach(b =>
      b.onclick = () => { _tab = b.dataset.ftab; _paint(); });

    _container.querySelectorAll('.fl-m').forEach(box => {
      const d = box.querySelector('.fl-m-c'), m = box.dataset.m;
      box.querySelector('.fl-m-h').onclick = () => {
        const open = d.hidden;
        if (open && !d.dataset.built) { d.innerHTML = _monthCats(m); d.dataset.built = '1'; }
        d.hidden = !open;
        box.classList.toggle('open', open);
        _open[m] = open;
      };
    });
    const go = _container.querySelector('.fl-go');
    if (go) go.onclick = () => App.navigateTo('expenses');
  }

  function reload() { if (_container) render(_container); }

  return { render, reload };
})();
