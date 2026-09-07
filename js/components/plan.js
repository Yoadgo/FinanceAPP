/* ===== PAGE: תוכנית — צפוי מול בפועל =====
   הטאב השני בתוך מסך התזרים. לא פריט ניווט משלו: התשובה ל״כמה
   תכננו״ חסרת ערך בלי ״כמה יצא בפועל״ לידה, ומסך נפרד היה מכריח
   לזכור שני מספרים ולהשוות בראש.

   שני מצבים:
     • **הצעה** — כשאין עדיין תוכנית. נגזרת מההיסטוריה, מוצגת
       כהצעה לעריכה, ונשמרת רק בלחיצה. אף מספר כאן אינו מומצא.
     • **השוואה** — כשיש תוכנית. הבפועל מגיע מ-`FlowEngine`, אותו
       מקור בדיוק כמו הטאב שלידו.                                */

Pages.plan = (() => {

  let _host = null, _plan = null, _bank = null, _credit = null, _wash = null;
  let _month = null, _edit = false, _draft = null, _busy = false, _msg = '';

  const money   = v => FA.money.ils(v);
  const signed  = v => FA.money.signed(v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const K = () => PlanEngine.KIND;

  /* ── טעינה ──
     העו״ש והאשראי כבר נטענו במסך התזרים; מקבלים אותם משם במקום
     למשוך שוב, כדי ששני הטאבים לא יראו שני מצבים שונים.        */
  async function render(host, ctx) {
    _host = host; _bank = ctx.bank; _credit = ctx.credit; _wash = ctx.wash;
    _msg = '';
    host.innerHTML = '<div class="ex-load">טוען תוכנית…</div>';
    try {
      const d = await DataService.getPlan();
      _plan = PlanEngine.parseRows((d && d.values) || []);
    } catch (e) {
      if (e && e.unauthorized) return;
      _plan = [];
    }
    _paint();
  }

  function _months() {
    return FlowEngine.months(_bank, _credit);
  }

  function _paint() {
    if (!_host) return;
    const live = PlanEngine.live(_plan || []);
    _host.innerHTML = live.length && !_edit ? _compareHtml()
                    : live.length ?  _editHtml(_draft || _fromPlan())
                    : _proposeHtml();
    _wire();
  }

  /* ══════════════ א. הצעה ══════════════ */

  function _fromPlan() {
    return PlanEngine.live(_plan).map(p => ({
      id: p.id, kind: p.kind, bucket: p.bucket, category: p.cat,
      subcategory: p.sub, label: p.label, key: p.key,
      amount: p.amount, on: true
    }));
  }

  function _proposeHtml() {
    const s = PlanEngine.suggest(_bank, _credit, { washPairs: _wash });
    if (!s.items.length) {
      return `<div class="ex-empty"><b>אין עדיין ממה לבנות תוכנית</b>
        <p>צריך לפחות חודשיים של עו״ש או אשראי כדי לזהות מה חוזר על עצמו.</p></div>`;
    }
    _draft = s.items.map(o => Object.assign({}, o, { on: true }));

    return `<div class="pl">
      <div class="pl-intro">
        <b>הצעה מ-${s.months} ${s.months === 1 ? 'חודש' : 'חודשי'} היסטוריה</b>
        <p>כל מספר כאן הוא <b>ממוצע ממה שבאמת קרה</b> — לא הערכה. פריט
        שהופיע בחודש אחד בלבד לא נכנס: הוא אירוע, לא הרגל. ערוך מה
        שצריך, כבה מה שלא רלוונטי, ושמור.</p>
      </div>
      ${s.unsortedAvg > 0 ? `<div class="fl-warn pl-warn">
        <b>${money(s.unsortedAvg)} בחודש עוד לא מסווגים</b>
        <span>עד שיסווגו, ההצעה מפספסת את החלק הזה והתוכנית תיראה זולה מהמציאות.</span>
        <button class="fl-go" type="button" data-go="expenses">לסיווג ←</button>
      </div>` : ''}
      ${_draftPanels(_draft)}
      ${_saveBar()}
    </div>`;
  }

  /* ══════════════ ב. עריכה ══════════════ */

  function _editHtml(draft) {
    _draft = draft;
    return `<div class="pl">
      <div class="pl-intro"><b>עריכת התוכנית</b>
        <p>סכום 0 או כיבוי מוציאים שורה מהתוכנית בלי למחוק אותה מהגיליון.</p></div>
      ${_draftPanels(draft)}
      <div class="pl-add">
        <button class="ex-btn ghost" type="button" data-add="line">+ פריט קבוע</button>
        <button class="ex-btn ghost" type="button" data-add="env">+ מעטפה</button>
        <button class="ex-btn ghost" type="button" data-suggest="1">הצע מההיסטוריה</button>
      </div>
      ${_saveBar(true)}
    </div>`;
  }

  function _draftPanels(d) {
    const inc = d.filter(o => o.bucket === 'הכנסה');
    const fix = d.filter(o => o.bucket === 'צריכה' && o.kind === K().line);
    const env = d.filter(o => o.kind === K().envelope);
    const sum = l => l.reduce((a, o) => a + (o.on ? Number(o.amount) || 0 : 0), 0);
    const si = sum(inc), ss = sum(fix) + sum(env);

    return `
      ${_panel('הכנסה קבועה', inc, d, 'מה שנכנס כל חודש. פריט שלא הגיע יבלוט בהשוואה.')}
      ${_panel('הוצאות קבועות', fix, d, 'שורה בשם מלא — הוראות קבע ותשלומים חוזרים.')}
      ${_panel('מעטפות', env, d, 'תקציב חודשי לקטגוריה שלמה. להוצאה משתנה אין טעם לנקוב בשם.')}
      <div class="pl-tot">
        <div><span class="l">נכנס</span><span class="v">${money(si)}</span></div>
        <div><span class="l">יוצא</span><span class="v">${money(ss)}</span></div>
        <div class="hi"><span class="l">אמור להישאר</span>
          <span class="v${si - ss < 0 ? ' neg' : ''}">${signed(si - ss)}</span></div>
      </div>`;
  }

  function _panel(title, list, all, note) {
    if (!list.length) return '';
    return `<div class="ex-panel">
      <div class="ex-panel-head"><h3>${esc(title)}</h3>
        <span class="pl-cnt">${list.length}</span></div>
      ${list.map(o => {
        const i = all.indexOf(o);
        return `<div class="pl-er${o.on ? '' : ' off'}" data-i="${i}">
          <input type="checkbox" class="pl-on" ${o.on ? 'checked' : ''} aria-label="לכלול">
          <div class="pl-er-n">
            <b>${esc(o.label || o.category || '—')}</b>
            <small>${esc(o.kind === K().envelope ? 'מעטפה · ' + (o.category || '')
                     : (o.category || 'ללא קטגוריה'))}${
              o.months ? ` · ${o.months} ${o.months === 1 ? 'חודש' : 'חודשים'}` : ''}</small>
          </div>
          <input type="number" class="pl-amt" value="${Number(o.amount) || 0}" step="10" min="0">
        </div>`;
      }).join('')}
      <div class="ex-note">${esc(note)}</div>
    </div>`;
  }

  function _saveBar(editing) {
    const n = (_draft || []).filter(o => o.on && Number(o.amount) > 0).length;
    return `<div class="pl-bar">
      ${_msg ? `<span class="pl-msg">${esc(_msg)}</span>` : ''}
      ${editing ? '<button class="ex-btn ghost" type="button" data-cancel="1">ביטול</button>' : ''}
      <button class="ex-btn" type="button" data-save="1" ${_busy ? 'disabled' : ''}>${
        _busy ? 'שומר…' : `שמור תוכנית (${n})`}</button>
    </div>`;
  }

  /* ══════════════ ג. צפוי מול בפועל ══════════════ */

  function _compareHtml() {
    const ms = _months();
    if (!ms.length) return `<div class="ex-empty"><b>יש תוכנית, אין עדיין תנועות</b>
      <p>אחרי הקליטה הבאה יופיע כאן צפוי מול בפועל.</p></div>`;
    if (!_month || ms.indexOf(_month) < 0) _month = ms[ms.length - 1];

    const c = PlanEngine.compare(_plan, _bank, _credit, _month, { washPairs: _wash });
    const t = c.totals;

    return `<div class="pl">
      <div class="pl-head">
        <select class="pl-mo">${ms.map(m =>
          `<option value="${esc(m)}"${m === _month ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>
        <button class="ex-btn ghost" type="button" data-editmode="1">עריכת התוכנית</button>
      </div>

      <div class="ex-kpis pl-kpis">
        ${_kpi('נכנס', t.actualIncome, t.plannedIncome, false)}
        ${_kpi('יצא', t.actualSpend, t.plannedSpend, true)}
        <div class="ex-kpi pl-big${t.actualSaved < t.plannedSaved ? ' warn' : ''}">
          <div class="l">נשאר</div><div class="v">${signed(t.actualSaved)}</div>
          <div class="d">תוכנן ${signed(t.plannedSaved)}</div></div>
      </div>

      ${c.missing.length ? `<div class="fl-warn pl-warn">
        <b>${c.missing.length} ${c.missing.length === 1 ? 'פריט קבוע לא הופיע' : 'פריטים קבועים לא הופיעו'} ב-${esc(_month)}</b>
        <span>${c.missing.map(m => esc(m.label)).join(' · ')} — או שהתשלום טרם נקלט, או שמשהו השתנה.</span>
      </div>` : ''}

      ${_cmpPanel('הכנסה', c.income, c.extraIncome ? [{ cat: 'הכנסה נוספת', actual: c.extraIncome }] : [])}
      ${_cmpPanel('הוצאות קבועות', c.fixed, [])}
      ${_cmpPanel('מעטפות', c.envelopes, c.extraSpend.map(e =>
        ({ cat: e.cat, actual: e.actual, pending: e.pending })))}

      <div class="ex-note pl-foot">הבפועל כאן הוא <b>אותו מספר</b> שבטאב ״בפועל״ —
      אותו מנוע, אותו חודש. פריט קבוע נמדד לפי התיאור בעו״ש בלי הספרות
      המשתנות, ומעטפה נמדדת לפי כל ההוצאה בקטגוריה <b>בניכוי</b> הפריטים
      הקבועים שכבר נספרו בנפרד.</div>
    </div>`;
  }

  function _kpi(label, actual, planned, lowerBetter) {
    const d = actual - planned;
    const bad = lowerBetter ? d > 0 : d < 0;
    return `<div class="ex-kpi"><div class="l">${esc(label)}</div>
      <div class="v">${money(actual)}</div>
      <div class="d">תוכנן ${money(planned)}${planned ? ` · <b class="${bad ? 'neg' : 'pos'}">${
        FA.money.delta(d)}</b>` : ''}</div></div>`;
  }

  function _cmpPanel(title, rows, extras) {
    if (!rows.length && !extras.length) return '';
    return `<div class="ex-panel">
      <div class="ex-panel-head"><h3>${esc(title)}</h3></div>
      ${rows.map(r => {
        const pct = r.planned > 0 ? Math.min(100, r.actual / r.planned * 100) : 0;
        const over = r.planned > 0 && r.actual > r.planned;
        return `<div class="pl-r${r.missing ? ' miss' : ''}">
          <div class="pl-r-n"><b>${esc(r.label)}</b>${
            r.missing ? '<small class="pl-miss">לא הופיע החודש</small>'
                      : `<small>${esc(r.kind === K().envelope && r.actual === 0
                          ? 'לא נוצל החודש' : (r.cat || ''))}</small>`}</div>
          <div class="pl-r-bar"><i style="width:${Math.max(pct, r.actual > 0 ? 2 : 0)}%" class="${
            over ? 'over' : ''}"></i>${over ? '<u></u>' : ''}</div>
          <div class="pl-r-v"><b>${money(r.actual)}</b><small>מתוך ${money(r.planned)}</small></div>
          <div class="pl-r-l${r.left < 0 ? ' neg' : ''}">${
            r.left < 0 ? 'חריגה ' + money(-r.left) : 'נשאר ' + money(r.left)}</div>
        </div>`;
      }).join('')}
      ${extras.map(e => `<div class="pl-r extra">
        <div class="pl-r-n"><b>${esc(e.cat)}</b><small>${
          e.pending ? 'עוד לא סווג' : 'לא בתוכנית'}</small></div>
        <div class="pl-r-bar"><i class="ghost" style="width:100%"></i></div>
        <div class="pl-r-v"><b>${money(e.actual)}</b><small>לא תוכנן</small></div>
        <div class="pl-r-l">—</div>
      </div>`).join('')}
    </div>`;
  }

  /* ══════════════ אירועים ══════════════ */

  function _wire() {
    const $ = s => Array.from(_host.querySelectorAll(s));

    const mo = _host.querySelector('.pl-mo');
    if (mo) mo.onchange = () => { _month = mo.value; _paint(); };

    const em = _host.querySelector('[data-editmode]');
    if (em) em.onclick = () => { _edit = true; _draft = _fromPlan(); _msg = ''; _paint(); };

    const cancel = _host.querySelector('[data-cancel]');
    if (cancel) cancel.onclick = () => { _edit = false; _draft = null; _msg = ''; _paint(); };

    /* ⚠️ עריכה בלי ציור מחדש. `_paint` בכל הקלדה היה מאבד את המיקוד
       באמצע הקלדת סכום — בדיוק התלונה שכבר תוקנה במסך ההוצאות.   */
    $('.pl-er').forEach(box => {
      const i = Number(box.dataset.i);
      const on = box.querySelector('.pl-on'), amt = box.querySelector('.pl-amt');
      on.onchange = () => { _draft[i].on = on.checked; box.classList.toggle('off', !on.checked); _tot(); };
      amt.oninput  = () => { _draft[i].amount = Number(amt.value) || 0; _tot(); };
    });

    $('[data-add]').forEach(b => b.onclick = () => _add(b.dataset.add));
    const sg = _host.querySelector('[data-suggest]');
    if (sg) sg.onclick = _mergeSuggestion;

    const save = _host.querySelector('[data-save]');
    if (save) save.onclick = _save;

    const go = _host.querySelector('[data-go]');
    if (go) go.onclick = () => App.navigateTo(go.dataset.go);
  }

  /* עדכון הסיכום והמונה בלי לצייר מחדש. */
  function _tot() {
    const inc = _draft.filter(o => o.on && o.bucket === 'הכנסה')
                      .reduce((a, o) => a + (Number(o.amount) || 0), 0);
    const out = _draft.filter(o => o.on && o.bucket === 'צריכה')
                      .reduce((a, o) => a + (Number(o.amount) || 0), 0);
    const box = _host.querySelector('.pl-tot');
    if (box) {
      const v = box.querySelectorAll('.v');
      v[0].textContent = money(inc); v[1].textContent = money(out);
      v[2].textContent = signed(inc - out);
      v[2].classList.toggle('neg', inc - out < 0);
    }
    const b = _host.querySelector('[data-save]');
    if (b && !_busy) b.textContent = 'שמור תוכנית (' +
      _draft.filter(o => o.on && Number(o.amount) > 0).length + ')';
  }

  function _add(kind) {
    const cats = (window.__cats || []).map(c => c.category);
    const name = prompt(kind === 'env' ? 'שם הקטגוריה למעטפה:' : 'שם הפריט הקבוע:');
    if (!name) return;
    _draft.push(kind === 'env'
      ? { kind: K().envelope, bucket: 'צריכה', category: name.trim(), label: '', key: '', amount: 0, on: true }
      : { kind: K().line, bucket: 'צריכה', category: '', label: name.trim(),
          key: PlanEngine.descKey(name), amount: 0, on: true });
    _paint();
  }

  /* מוסיף מההיסטוריה רק מה שעוד לא בטיוטה — לא דורס סכום שיועד ערך. */
  function _mergeSuggestion() {
    const s = PlanEngine.suggest(_bank, _credit, { washPairs: _wash });
    const has = {};
    _draft.forEach(o => { has[o.kind + '|' + (o.key || o.category)] = 1; });
    let n = 0;
    s.items.forEach(o => {
      const k = o.kind + '|' + (o.key || o.category);
      if (has[k]) return;
      _draft.push(Object.assign({}, o, { on: true })); n++;
    });
    _msg = n ? `נוספו ${n} פריטים מההיסטוריה` : 'אין מה להוסיף — הכול כבר בתוכנית';
    _paint();
  }

  async function _save() {
    if (_busy) return;
    const items = _draft
      .filter(o => o.on && Number(o.amount) > 0)
      .map(o => ({ id: o.id || '', kind: o.kind, bucket: o.bucket,
                   category: o.category || '', subcategory: o.subcategory || '',
                   label: o.label || '', key: o.key || '', amount: Number(o.amount), active: true }));

    /* שורות שכובו מגיעות כ-`active:false` ולא נמחקות — כדי שהשוואה
       לחודש קודם לא תשתנה למפרע.                                 */
    _draft.filter(o => o.id && (!o.on || !(Number(o.amount) > 0)))
      .forEach(o => items.push({ id: o.id, kind: o.kind, bucket: o.bucket,
        category: o.category || '', subcategory: o.subcategory || '',
        label: o.label || '', key: o.key || '', amount: Number(o.amount) || 0, active: false }));

    if (!items.length) { _msg = 'אין מה לשמור'; _paint(); return; }

    _busy = true; _msg = ''; _paint();
    try {
      const res = await DataService.post('plan.save', { items });
      DataService.clearCache('plan');
      const d = await DataService.getPlan(true);
      _plan = PlanEngine.parseRows((d && d.values) || []);
      _edit = false; _draft = null;
      _msg = `נשמרו ${(res.created || 0) + (res.updated || 0)} שורות`;
      if (res.skipped && res.skipped.length) _msg += ` · ${res.skipped.length} נדחו`;
    } catch (e) {
      if (e && e.unauthorized) { _busy = false; return; }
      _msg = 'לא נשמר: ' + (e && e.message ? e.message : e);
    }
    _busy = false;
    _paint();
  }

  function count() { return PlanEngine.live(_plan || []).length; }

  return { render, count };
})();
