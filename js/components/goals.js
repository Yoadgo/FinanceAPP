/* ===== PAGE: יעדים — למה הכסף נחסך =====
   הפריט השלישי במשק הבית, אחרי תנועות ותזרים, ובכוונה **אחריהם**:
   ״כמה להקצות ליעד״ היא שאלה בלי משמעות עד שיש מכנה, והמכנה הוא
   ״אמור להישאר בחודש״ מהתוכנית.

   ⚠️ **המסך הזה חייב להיות מסוגל להגיד ״לא״.** אם סך ההקצאות עולה
   על העודף המתוכנן — פס אדום למעלה שאומר בכמה חרגת. מסך יעדים
   שתמיד מאשר את מה שהקלדת הוא קישוט.

   ⚠️ **״נחסך״ כאן אינו ״כמה יש לי״.** הוא סכום ההעברות שסימנת ליעד,
   ועוד יתרת פתיחה שהקלדת. שווי תיק ההשקעות **אינו** מחובר לכאן —
   העברה לתיק שסומנה ליעד ושווי התיק הם אותו כסף.                 */

Pages.goals = (() => {

  let _c = null, _goals = null, _bank = null, _credit = null, _plan = null;
  let _wash = null, _surplus = null, _tab = 'list', _busy = false, _msg = '';
  let _draft = null, _pick = null, _sel = {};

  const money  = v => FA.money.ils(v);
  const signed = v => FA.money.signed(v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  function render(container) {
    _c = container; _tab = 'list'; _msg = ''; _draft = null; _pick = null; _sel = {};
    container.innerHTML = FA.skel ? FA.skel.tablePage(5, 3) : '<div class="ex-load">טוען…</div>';
    _load();
  }

  async function _load() {
    try {
      App.setDataStatus('loading');
      const [gd, bd, ed, pd] = await Promise.all([
        DataService.getGoals().catch(() => null),
        DataService.getBank().catch(() => null),
        DataService.getExpenses().catch(() => null),
        DataService.getPlan().catch(() => null)
      ]);
      _goals  = GoalsEngine.parseRows((gd && gd.values) || []);
      _bank   = BankEngine.parseRows((bd && bd.values) || []);
      _credit = ExpensesEngine.parseRows((ed && ed.values) || []);
      _plan   = PlanEngine.parseRows((pd && pd.values) || []);
      _wash   = ExpensesEngine.washPairs(_credit);
      _surplus = _planSurplus();
      App.setDataStatus('ok');
      _paint();
    } catch (err) {
      App.setDataStatus('error');
      if (err && err.unauthorized) return;
      _c.innerHTML = `<div class="ex-empty"><b>לא הצלחתי לטעון את היעדים</b>
        <p>${esc(err && err.message ? err.message : err)}</p>
        <button class="ex-btn" onclick="Pages.goals.reload()">נסה שוב</button></div>`;
    }
  }

  /* המכנה. **null ולא 0** כשאין תוכנית — אפס היה נראה כמו ״אין לך
     כסף פנוי״ במקום ״עוד לא אמרת כמה אתה מתכנן״.                 */
  function _planSurplus() {
    if (!PlanEngine.live(_plan || []).length) return null;
    const ms = FlowEngine.months(_bank, _credit);
    if (!ms.length) return null;
    const c = PlanEngine.compare(_plan, _bank, _credit, ms[ms.length - 1], { washPairs: _wash });
    return c.totals.plannedSaved;
  }

  function _paint() {
    if (!_c) return;
    const s = GoalsEngine.summarize(_goals, _bank, _surplus);
    _c.innerHTML = `<div class="gl">
      <div class="ex-head">
        <div class="ex-tabs">
          <button class="ex-tab${_tab==='list'?' on':''}" data-gtab="list">יעדים${
            s.count?` <i>${s.count}</i>`:''}</button>
          <button class="ex-tab${_tab==='assign'?' on':''}" data-gtab="assign">שיוך תנועות${
            _cands().length?` <i>${_cands().length}</i>`:''}</button>
        </div>
        <button class="ex-btn" type="button" data-new="1">+ יעד חדש</button>
      </div>
      ${_msg ? `<div class="gl-msg">${esc(_msg)}</div>` : ''}
      ${_draft ? _editor() : _tab === 'assign' ? _assign() : _list(s)}
    </div>`;
    _wire();
  }

  const _cands = () => GoalsEngine.candidates(_bank || []);

  /* ══════════ רשימת היעדים ══════════ */

  function _list(s) {
    if (!s.count) return `<div class="ex-empty"><b>אין עדיין יעדים</b>
      <p>יעד הוא סכום ותאריך: ״₪80,000 לרכב״, ״קרן חירום עד דצמבר״.
      ${s.hasSurplus ? `לפי התוכנית שלך נשאר <b>${money(s.surplus)}</b> בחודש להקצות.`
        : 'קודם כדאי לבנות תוכנית חודשית — בלעדיה אין מכנה להקצאה.'}</p>
      <button class="ex-btn" type="button" data-new="1">ליעד הראשון</button></div>`;

    return `
      ${_budget(s)}
      ${s.late.length ? `<div class="fl-warn gl-warn">
        <b>${s.late.length} ${s.late.length===1?'יעד לא בקצב':'יעדים לא בקצב'}</b>
        <span>${s.late.map(g => `${esc(g.name)} — דורש ${money(g.needMonthly)} בחודש, מוקצה ${money(g.monthly)}`).join(' · ')}</span>
      </div>` : ''}
      <div class="ex-panel">
        <div class="ex-panel-head"><h3>היעדים</h3>
          <span class="gl-sum">${money(s.saved)} מתוך ${money(s.target)}</span></div>
        ${s.goals.map(_row).join('')}
      </div>
      <div class="ex-note gl-foot">״נחסך״ הוא <b>סכום ההעברות שסימנת ליעד</b> ועוד יתרת
      פתיחה שהקלדת — לא שווי תיק ההשקעות. העברה לתיק שסומנה ליעד ושווי התיק הם
      אותו כסף, וחיבור שלהם היה מציג פי שניים.</div>`;
  }

  function _budget(s) {
    const over = s.over > 0;
    return `<div class="ex-kpis gl-kpis">
      <div class="ex-kpi"><div class="l">עודף חודשי מהתוכנית</div>
        <div class="v">${s.hasSurplus ? money(s.surplus) : '—'}</div>
        <div class="d">${s.hasSurplus ? 'אמור להישאר' : 'אין עדיין תוכנית'}</div></div>
      <div class="ex-kpi"><div class="l">מוקצה ליעדים</div>
        <div class="v">${money(s.allocated)}</div>
        <div class="d">${s.count} ${s.count===1?'יעד':'יעדים'}</div></div>
      <div class="ex-kpi gl-big${over?' over':''}">
        <div class="l">${over ? 'חריגה' : 'פנוי'}</div>
        <div class="v">${over ? money(s.over) : (s.hasSurplus ? money(s.free) : '—')}</div>
        <div class="d">${over ? 'הקצאת יותר ממה שנשאר' : s.hasSurplus ? 'עוד אפשר להקצות' : 'צריך תוכנית כדי לדעת'}</div></div>
    </div>`;
  }

  function _row(g) {
    const bar = g.done ? 100 : g.pct;
    return `<div class="gl-r${g.done?' done':''}${g.late?' late':''}" data-id="${esc(g.id)}">
      <div class="gl-r-n">
        <b>${esc(g.name)}</b>
        <small>${g.done ? 'הושלם'
          : g.deadline ? `עד ${esc(g.deadline.slice(5).split('-').reverse().join('/'))}/${esc(g.deadline.slice(0,4))}`
          : g.etaLabel ? `בקצב הזה — ${esc(g.etaLabel)}`
          : 'בלי הקצאה חודשית'}</small>
      </div>
      <div class="gl-r-bar"><i style="width:${Math.max(bar, g.saved>0?2:0)}%" class="${
        g.done?'done':g.late?'late':''}"></i></div>
      <div class="gl-r-v"><b>${money(g.saved)}</b><small>מתוך ${money(g.target)}</small></div>
      <div class="gl-r-m">
        <span class="pctv">${g.pct}%</span>
        <small>${g.done ? '—'
          : g.late && g.needMonthly ? `דורש ${money(g.needMonthly)}`
          : `${money(g.monthly)} בחודש`}</small>
      </div>
      <button class="gl-edit" type="button" data-edit="${esc(g.id)}" aria-label="עריכה">✎</button>
    </div>`;
  }

  /* ══════════ עורך יעד ══════════ */

  function _editor() {
    const d = _draft, isNew = !d.id;
    return `<div class="ex-panel gl-ed">
      <div class="ex-panel-head"><h3>${isNew ? 'יעד חדש' : 'עריכת יעד'}</h3></div>
      <label class="gl-f"><span>שם</span>
        <input type="text" data-f="name" value="${esc(d.name)}" placeholder="רכב, קרן חירום, טיול"></label>
      <label class="gl-f"><span>סכום היעד</span>
        <input type="number" data-f="target" value="${d.target||''}" step="500" min="0"></label>
      <label class="gl-f"><span>כמה כבר יש</span>
        <input type="number" data-f="opening" value="${d.opening||''}" step="500" min="0">
        <small>מה שנצבר לפני שהתחלת לסמן תנועות. העברות שתסמן ליעד מתווספות לזה.</small></label>
      <label class="gl-f"><span>הקצאה חודשית</span>
        <input type="number" data-f="monthly" value="${d.monthly||''}" step="100" min="0">
        <small>${_surplus === null ? 'אין עדיין תוכנית — בלי מכנה אי אפשר לדעת אם זה ריאלי.'
          : `מתוך ${money(_surplus)} שאמורים להישאר בחודש.`}</small></label>
      <label class="gl-f"><span>תאריך יעד <i>(לא חובה)</i></span>
        <input type="date" data-f="deadline" value="${esc(d.deadline||'')}">
        <small>עם תאריך, המסך אומר כמה <b>דרוש</b> בחודש במקום מתי זה יקרה.</small></label>
      <div class="pl-bar">
        ${!isNew ? '<button class="ex-btn ghost danger" type="button" data-off="1">בטל יעד</button>' : ''}
        <button class="ex-btn ghost" type="button" data-cancel="1">ביטול</button>
        <button class="ex-btn" type="button" data-save="1" ${_busy?'disabled':''}>${
          _busy ? 'שומר…' : 'שמור'}</button>
      </div>
    </div>`;
  }

  /* ══════════ שיוך תנועות ══════════ */

  function _assign() {
    const rows = _cands(), gs = GoalsEngine.live(_goals);
    if (!gs.length) return `<div class="ex-empty"><b>קודם יעד, אחר כך שיוך</b>
      <p>אין למה לשייך את התנועות עדיין.</p>
      <button class="ex-btn" type="button" data-new="1">ליעד הראשון</button></div>`;
    if (!rows.length) return `<div class="ex-empty"><b>אין תנועות לשייך</b>
      <p>כל ההעברות בדליים ״הון״ ו״העברה״ כבר משויכות, או שעוד לא סיווגת אותן
      במסך התנועות. סילוק אשראי לא מופיע כאן — הוא תשלום על מה שכבר הוצאנו.</p></div>`;

    const nSel = Object.keys(_sel).filter(k => _sel[k]).length;
    return `<div class="ex-panel">
      <div class="ex-panel-head"><h3>העברות שעוד לא שויכו</h3>
        <span class="gl-sum">${rows.length}</span></div>
      ${rows.map(r => `<div class="gl-a" data-rid="${esc(r.id)}">
        <input type="checkbox" class="gl-a-on" ${_sel[r.id]?'checked':''} aria-label="בחר">
        <div class="gl-a-n"><b>${esc(r.desc)}</b>
          <small>${esc(ExpensesEngine.monthKey(r.date))} · ${esc(r.bucket)}${
            r.cat?' · '+esc(r.cat):''}</small></div>
        <div class="gl-a-v">${money(Math.abs(r.amount))}</div>
      </div>`).join('')}
      <div class="pl-bar">
        <select class="gl-pick"><option value="">בחר יעד…</option>${
          gs.map(g => `<option value="${esc(g.id)}"${_pick===g.id?' selected':''}>${esc(g.name)}</option>`).join('')}</select>
        <button class="ex-btn" type="button" data-assign="1" ${_busy||!nSel||!_pick?'disabled':''}>${
          _busy ? 'משייך…' : `שייך ${nSel||''}`.trim()}</button>
      </div>
      <div class="ex-note">שיוך הוא הפיך: אפשר לבטל אותו מכאן בכל רגע, ולכן אין
      סיבה להתלבט על שורה בודדת.</div>
    </div>`;
  }

  /* ══════════ אירועים ══════════ */

  function _wire() {
    const $ = s => Array.from(_c.querySelectorAll(s));
    $('[data-gtab]').forEach(b => b.onclick = () => { _tab = b.dataset.gtab; _msg=''; _draft=null; _paint(); });

    $('[data-new]').forEach(b => b.onclick = () => {
      _draft = { id:'', name:'', target:0, opening:0,
                 monthly: _surplus !== null ? Math.max(0, Math.round(_surplus / 2 / 100) * 100) : 0,
                 deadline:'' };
      _msg = ''; _paint();
    });

    $('[data-edit]').forEach(b => b.onclick = () => {
      const g = (_goals || []).find(x => x.id === b.dataset.edit);
      if (!g) return;
      _draft = { id:g.id, name:g.name, target:g.target, opening:g.opening,
                 monthly:g.monthly, deadline:g.deadline };
      _msg = ''; _paint();
    });

    /* עריכה בלי ציור מחדש — אחרת המיקוד קופץ באמצע הקלדה. */
    $('.gl-ed [data-f]').forEach(i => i.oninput = () => {
      _draft[i.dataset.f] = i.type === 'number' ? (Number(i.value) || 0) : i.value;
    });

    const cancel = _c.querySelector('[data-cancel]');
    if (cancel) cancel.onclick = () => { _draft = null; _msg=''; _paint(); };
    const save = _c.querySelector('.gl-ed [data-save]');
    if (save) save.onclick = _save;
    const off = _c.querySelector('[data-off]');
    if (off) off.onclick = () => _save(false);

    $('.gl-a').forEach(box => {
      const cb = box.querySelector('.gl-a-on');
      cb.onchange = () => { _sel[box.dataset.rid] = cb.checked; _assignBtn(); };
    });
    const pick = _c.querySelector('.gl-pick');
    if (pick) pick.onchange = () => { _pick = pick.value; _assignBtn(); };
    const asg = _c.querySelector('[data-assign]');
    if (asg) asg.onclick = _assignNow;
  }

  function _assignBtn() {
    const b = _c.querySelector('[data-assign]');
    if (!b || _busy) return;
    const n = Object.keys(_sel).filter(k => _sel[k]).length;
    b.disabled = !n || !_pick;
    b.textContent = `שייך ${n || ''}`.trim();
  }

  async function _save(active) {
    if (_busy) return;
    const d = _draft;
    if (!d.name.trim()) { _msg = 'צריך שם ליעד'; _paint(); return; }
    if (!(d.target > 0)) { _msg = 'צריך סכום יעד'; _paint(); return; }

    _busy = true; _msg = ''; _paint();
    try {
      const res = await DataService.post('goals.save', { items: [{
        id: d.id || '', name: d.name.trim(), target: d.target, monthly: d.monthly,
        opening: d.opening, deadline: d.deadline || '',
        active: active === false ? false : true
      }] });
      if (res.skipped && res.skipped.length) throw new Error(res.skipped[0].why);
      await _refresh();
      _draft = null;
      _msg = active === false ? 'היעד בוטל' : 'נשמר';
    } catch (e) {
      if (e && e.unauthorized) { _busy = false; return; }
      _msg = 'לא נשמר: ' + (e && e.message ? e.message : e);
    }
    _busy = false; _paint();
  }

  async function _assignNow() {
    if (_busy) return;
    const ids = Object.keys(_sel).filter(k => _sel[k]);
    if (!ids.length || !_pick) return;
    _busy = true; _msg = ''; _paint();
    try {
      const res = await DataService.post('goals.assign', { goalId: _pick, ids });
      await _refresh();
      _sel = {};
      _msg = `שויכו ${res.updated} תנועות`;
      if (res.updated < ids.length) _msg += ` (מתוך ${ids.length})`;
    } catch (e) {
      if (e && e.unauthorized) { _busy = false; return; }
      _msg = 'לא שויך: ' + (e && e.message ? e.message : e);
    }
    _busy = false; _paint();
  }

  async function _refresh() {
    const [gd, bd] = await Promise.all([DataService.getGoals(true), DataService.getBank(true)]);
    _goals = GoalsEngine.parseRows((gd && gd.values) || []);
    _bank  = BankEngine.parseRows((bd && bd.values) || []);
    _surplus = _planSurplus();
  }

  function reload() { if (_c) render(_c); }

  return { render, reload };
})();
