/* ===== VIEW: עו״ש — תנועות החשבון =====
   טאב בתוך מסך ״תנועות״. עונה על שאלה אחרת מזו של האשראי: באשראי
   השאלה היא **על מה** הוצאנו, כאן היא קודם כול **האם זה בכלל כסף
   שנעלם** — ולכן הדלי הוא השדה הראשון, לא הקטגוריה.

   ⚠️ המסך אינו מחשב סכומים בעצמו. הכול מגיע מ-`BankEngine`, כדי
   שהמספר שלמעלה והרשימה שנפתחת מתחתיו לא ייפרדו לעולם.           */

const BankView = (() => {

  let _rows = null, _container = null, _month = 'all', _open = {}, _busy = false;

  /* מימוש אחד ב-`js/ui/money.js`. הכינוי המקומי נשאר כדי שאתרי הקריאה
     יישארו קצרים — מה שהיה כפול הוא הפורמט, לא השם. */
  const money = v => FA.money.ils(v);
  const signed = v => FA.money.signed(v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  const B = () => BankEngine.BUCKET;
  const FREQ = ['קבוע', 'חד-פעמי'];

  /* צבע לפי **משמעות**, לא לפי סדר: שני הדליים שמשנים כמה כסף יש
     מקבלים ירוק ואדום; שני אלה שרק מזיזים אותו מקבלים אפור-כחול,
     כדי שהעין תפריד ביניהם עוד לפני שקוראים מספר.                */
  const BPAL = { 'הכנסה':'#059669', 'צריכה':'#DC2626', 'העברה':'#64748B', 'הון':'#4F46E5', '':'#CBD5E1' };
  const BNOTE = {
    'הכנסה': 'כסף שנכנס. משנה כמה יש.',
    'צריכה': 'כסף שנעלם. משנה כמה יש.',
    'העברה': 'כסף שזז — כולל סילוק אשראי. לא משנה כמה יש.',
    'הון':   'חיסכון, הלוואות והשקעות. לא משנה כמה יש.',
    '':      'עוד לא סווג. זה מה שמחכה לך.'
  };

  function render(container) {
    _container = container; _month = 'all'; _open = {}; _busy = false;
    container.innerHTML = FA.skel ? FA.skel.tablePage(6, 3) : '<div class="ex-load">טוען…</div>';
    _load();
  }

  async function _load() {
    try {
      const raw = await DataService.getBank();
      _rows = BankEngine.parseRows(raw && raw.values ? raw.values : []);
      _paint();
    } catch (e) {
      if (e && e.unauthorized) return;
      _container.innerHTML = `<div class="ex-empty">
        <b>לא הצלחתי לטעון את העו״ש</b>
        <p>${esc(e && e.message ? e.message : e)}</p>
        <button class="ex-btn" onclick="BankView.reload()">נסה שוב</button></div>`;
    }
  }

  const _cats = () => {
    const seen = {};
    (_rows || []).forEach(r => { if (r.cat) seen[r.cat] = 1; });
    return Object.keys(seen).sort();
  };

  function _paint() {
    if (!_container || !_rows) return;
    const s = BankEngine.summarize(_rows, { month: _month });
    const rec = BankEngine.reconcile(BankEngine.rowsIn(_rows, { month: _month }), _credit());

    _container.innerHTML = `
      <div class="bk">
        ${_kpis(s)}
        ${_months(s)}
        ${s.pending.length ? _pendingBlock(s.pending) : ''}
        ${_buckets(s)}
        ${_incomeBlock(s)}
        ${s.spendByCat.length ? _spendBlock(s) : ''}
        ${rec.length ? _recBlock(rec) : ''}
      </div>
      <datalist id="bk-cats">${_cats().map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
    _wire();
  }

  /* פירוט האשראי, אם מסך ההוצאות כבר טען אותו. אין קריאה נוספת
     לשרת: הקיזוז הוא בונוס, לא סיבה לעוד סיבוב רשת.              */
  function _credit() {
    try { return (Pages.expenses && Pages.expenses.rows && Pages.expenses.rows()) || []; }
    catch (e) { return []; }
  }

  function _kpis(s) {
    return `<div class="ex-kpis">
      <div class="ex-kpi"><div class="l">נכנס</div><div class="v">${money(s.income)}</div>
        <div class="d">הכנסות בלבד</div></div>
      <div class="ex-kpi"><div class="l">צריכה מהעו״ש</div><div class="v">${money(s.spend)}</div>
        <div class="d">בלי אשראי, בלי העברות</div></div>
      <div class="ex-kpi"><div class="l">נטו</div>
        <div class="v${s.net < 0 ? ' neg' : ''}">${signed(s.net)}</div>
        <div class="d">נכנס פחות צריכה</div></div>
    </div>`;
  }

  function _months(s) {
    return `<div class="ex-mo">
      <button class="${_month==='all'?'on':''}" data-m="all">כל התקופה</button>
      ${s.allMonths.map(m => `<button class="${_month===m?'on':''}" data-m="${esc(m)}">${esc(m)}</button>`).join('')}
    </div>`;
  }

  /* ── מה שממתין להחלטה ──
     בראש המסך ופתוח, כי זו הפעולה היחידה שדורשת את יועד. שאר המסך
     הוא קריאה.                                                     */
  function _pendingBlock(pend) {
    const sum = pend.reduce((a, r) => a + r.amount, 0);
    return `<div class="ex-panel bk-pend">
      <div class="ex-panel-head"><h3>${pend.length} ${pend.length===1?'שורה ממתינה':'שורות ממתינות'} לדלי</h3>
        <span class="bk-pend-sum">${signed(sum)}</span></div>
      <div class="ex-note">בלי דלי השורה לא נספרת בשום מקום — לא בהכנסות, לא בצריכה, ולא בנטו. זו הסיבה היחידה שהיא כאן.</div>
      ${pend.map(r => _rowHtml(r)).join('')}
      <div class="ex-er-foot">
        <button class="bk-save" type="button" disabled>אין שינויים</button>
        <span class="bk-msg"></span>
      </div>
    </div>`;
  }

  function _rowHtml(r) {
    return `<div class="bk-r" data-id="${esc(r.id)}">
      <span class="bk-r-d">${_dm(r.date)}</span>
      <span class="bk-r-n" title="${esc(r.desc)}">${esc(r.desc)}</span>
      <span class="bk-r-a${r.amount<0?' out':''}">${signed(r.amount)}</span>
      <select class="bk-r-b">
        <option value="">— דלי —</option>
        ${BankEngine.ORDER.map(b => `<option${b===r.bucket?' selected':''}>${esc(b)}</option>`).join('')}
      </select>
      <input class="bk-r-c" list="bk-cats" placeholder="קטגוריה" value="${esc(r.cat)}">
      <select class="bk-r-f">
        <option value="">תדירות…</option>
        ${FREQ.map(f => `<option${f===r.freq?' selected':''}>${esc(f)}</option>`).join('')}
      </select>
    </div>`;
  }

  const _dm = d => {
    const x = new Date(d);
    return isNaN(x.getTime()) ? '—'
      : ('0' + x.getDate()).slice(-2) + '/' + ('0' + (x.getMonth() + 1)).slice(-2);
  };

  /* ── ארבעת הדליים ── */
  function _buckets(s) {
    const max = s.buckets.reduce((a, b) => Math.max(a, Math.abs(b.sum)), 1);
    return `<div class="ex-panel">
      <div class="ex-panel-head"><h3>לפי דלי</h3></div>
      ${s.buckets.map(b => {
        const rows = BankEngine.rowsIn(_rows, { month: _month, bucket: b.bucket });
        const key = b.bucket || '_none';
        return `<div class="bk-brow${_open[key]?' open':''}" data-b="${esc(b.bucket)}">
          <div class="ex-row is-tap">
            <div class="nm"><span class="ex-chev">◀</span>
              <span class="ex-nm-t">${esc(b.bucket || 'בהמתנה')}</span>
              <small class="bk-cnt">${rows.length}</small></div>
            <div class="ex-track"><i class="ex-fill" style="width:${Math.max(1.5, Math.abs(b.sum)/max*100)}%;background:${BPAL[b.bucket]||'#94A3B8'}"></i></div>
            <div class="vl">${signed(b.sum)}</div>
          </div>
          <div class="bk-note">${BNOTE[b.bucket] || ''}</div>
          <div class="bk-edit" hidden></div>
        </div>`;
      }).join('')}
      <div class="ex-note"><b>הכנסה</b> ו<b>צריכה</b> משנים כמה כסף יש. <b>העברה</b> ו<b>הון</b> רק מזיזים אותו — ולכן הם לא נספרים בנטו, ואסור לחבר אותם להוצאות.</div>
    </div>`;
  }

  /* ── הכנסות: קבוע מול חד-פעמי ──
     זו התשובה לשאלה על הלפרין מול נדלבאום. אותו סכום, אותה קטגוריה,
     ושתי משמעויות שונות לחלוטין לתחזית.                            */
  function _incomeBlock(s) {
    const f = s.incomeByFreq['קבוע'] || 0, o = s.incomeByFreq['חד-פעמי'] || 0;
    const u = s.incomeByFreq[''] || 0, tot = f + o + u || 1;
    if (!s.incomeByCat.length) return '';
    const max = Math.abs(s.incomeByCat[0].sum) || 1;
    return `<div class="ex-panel">
      <div class="ex-panel-head"><h3>מאיפה נכנס</h3></div>
      <div class="bk-split">
        <div class="bk-sp"><i style="width:${f/tot*100}%;background:#059669"></i><i style="width:${o/tot*100}%;background:#34D399"></i><i style="width:${u/tot*100}%;background:#CBD5E1"></i></div>
        <div class="bk-sp-l">
          <span><i style="background:#059669"></i> קבוע ${money(f)}</span>
          <span><i style="background:#34D399"></i> חד-פעמי ${money(o)}</span>
          ${u ? `<span><i style="background:#CBD5E1"></i> בלי תדירות ${money(u)}</span>` : ''}
        </div>
      </div>
      ${s.incomeByCat.map(c => `<div class="ex-row">
        <div class="nm"><span class="ex-nm-t">${esc(c.cat)}</span></div>
        <div class="ex-track"><i class="ex-fill" style="width:${Math.max(1.5, Math.abs(c.sum)/max*100)}%;background:#059669"></i></div>
        <div class="vl">${money(c.sum)}</div></div>`).join('')}
      <div class="ex-note">רק ה<b>קבוע</b> נכנס לבסיס החודשי שאפשר לסמוך עליו. הכנסה חד-פעמית נספרת בחודש שבו הגיעה ולא נמשכת קדימה.</div>
    </div>`;
  }

  function _spendBlock(s) {
    const max = Math.abs(s.spendByCat[0].sum) || 1;
    return `<div class="ex-panel">
      <div class="ex-panel-head"><h3>צריכה ישירה מהעו״ש</h3></div>
      ${s.spendByCat.map(c => `<div class="ex-row">
        <div class="nm"><span class="ex-nm-t">${esc(c.cat)}</span></div>
        <div class="ex-track"><i class="ex-fill" style="width:${Math.max(1.5, Math.abs(c.sum)/max*100)}%;background:#DC2626"></i></div>
        <div class="vl">${money(c.sum)}</div></div>`).join('')}
      <div class="ex-note">זו צריכה שלא עברה בכרטיס — הוראות קבע, ועד בית, עמלות. ההוצאות בכרטיס יושבות בטאב האשראי.</div>
    </div>`;
  }

  /* ── קיזוז מול האשראי ──
     הפאנל היחיד שלא מוסיף שום סכום. הוא עונה על שאלה אחת: האם החיוב
     שירד מהבנק שווה לסכום הפירוט של אותו חודש. אם לא — עדיף לראות. */
  function _recBlock(rec) {
    const noDetail = rec.filter(r => r.status === 'no-detail').length;
    return `<div class="ex-panel">
      <div class="ex-panel-head"><h3>סילוק אשראי מול הפירוט</h3></div>
      ${rec.map(r => `<div class="bk-rec ${r.status}">
        <span class="bk-rec-d">${_dm(r.date)}</span>
        <span class="bk-rec-n">${esc(r.desc)}</span>
        <span class="bk-rec-a">${money(r.bank)}</span>
        <span class="bk-rec-x">${r.detail === null ? '—' : money(r.detail)}</span>
        <span class="bk-rec-s">${r.status === 'match' ? '✓ תואם'
          : r.status === 'gap' ? 'פער ' + money(r.gap) : 'אין פירוט'}</span>
      </div>`).join('')}
      <div class="ex-note">השורות האלה יושבות בדלי <b>העברה</b> ואינן נספרות בצריכה — הכסף כבר נספר פעם אחת בפירוט האשראי. ${noDetail ? `${noDetail} מהן בלי פירוט תואם, כנראה חודש שעדיין לא נקלט.` : ''}</div>
    </div>`;
  }

  /* ---------------- אירועים ---------------- */
  function _wire() {
    const $ = sel => _container.querySelectorAll(sel);
    $('.ex-mo button').forEach(b => b.onclick = () => { _month = b.dataset.m; _open = {}; _paint(); });

    $('.bk-brow').forEach(box => {
      const ed = box.querySelector('.bk-edit'), key = box.dataset.b || '_none';
      box.querySelector('.ex-row').onclick = () => {
        const open = ed.hidden;
        if (open && !ed.dataset.built) {
          ed.innerHTML = _editHtml(box.dataset.b);
          ed.dataset.built = '1';
          _wireEdit(ed);
        }
        ed.hidden = !open;
        box.classList.toggle('open', open);
        _open[key] = open;
      };
      if (_open[key]) box.querySelector('.ex-row').click();
    });

    const pend = _container.querySelector('.bk-pend');
    if (pend) _wireEdit(pend);
  }

  function _editHtml(bucket) {
    const list = BankEngine.rowsIn(_rows, { month: _month, bucket: bucket })
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    if (!list.length) return '<div class="ex-note">אין שורות בדלי הזה בתקופה שנבחרה.</div>';
    return list.map(r => _rowHtml(r)).join('') + `
      <div class="ex-er-foot">
        <button class="bk-save" type="button" disabled>אין שינויים</button>
        <span class="bk-msg">${list.length} ${list.length===1?'שורה':'שורות'} · שינוי נשמר רק בלחיצה</span>
      </div>`;
  }

  const _val = el => ({
    bucket: el.querySelector('.bk-r-b').value,
    cat: el.querySelector('.bk-r-c').value.trim(),
    freq: el.querySelector('.bk-r-f').value,
  });

  function _wireEdit(host) {
    const save = host.querySelector('.bk-save'), msg = host.querySelector('.bk-msg');
    if (!save) return;
    const base = {}, cards = () => [...host.querySelectorAll('.bk-r')];

    const dirty = () => cards().filter(el => {
      const a = base[el.dataset.id], b = _val(el);
      return a && (a.bucket !== b.bucket || a.cat !== b.cat || a.freq !== b.freq);
    });
    function mark() {
      const d = dirty(), blank = d.filter(el => !_val(el).bucket).length;
      save.disabled = !d.length || blank > 0 || _busy;
      save.textContent = _busy ? 'שומר…'
        : !d.length ? 'אין שינויים'
        : blank ? `${blank} ${blank===1?'שורה בלי דלי':'שורות בלי דלי'}`
        : `שמור ${d.length} ${d.length === 1 ? 'שינוי' : 'שינויים'}`;
    }
    host._mark = mark;
    cards().forEach(el => {
      base[el.dataset.id] = _val(el);
      el.querySelector('.bk-r-b').onchange = mark;
      el.querySelector('.bk-r-c').oninput = mark;
      el.querySelector('.bk-r-f').onchange = mark;
    });

    save.onclick = async () => {
      const d = dirty();
      if (!d.length || _busy) return;
      const items = d.map(el => {
        const v = _val(el);
        return { id: el.dataset.id, bucket: v.bucket, category: v.cat, freq: v.freq };
      });
      _busy = true; mark();
      try {
        await DataService.post('bank.approve', { items },
          { writeId: 'bk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) });
        const by = {};
        items.forEach(x => { by[x.id] = x; });
        _rows.forEach(r => {
          const x = by[r.id];
          if (!x) return;
          r.bucket = x.bucket; r.cat = x.category; r.freq = x.freq; r.status = 'ok';
        });
        _busy = false;
        _paint();
      } catch (e) {
        _busy = false; mark();
        if (e && e.unauthorized) return;
        msg.textContent = 'לא נשמר: ' + (e && e.message ? e.message : e);
      }
    };
    mark();
  }

  function reload() { if (_container) render(_container); }

  /* כמה שורות עוד בלי דלי — לתג על הטאב. מחזיר 0 לפני הטעינה
     הראשונה, ולכן התג פשוט לא מופיע במקום להציג מספר שקרי.       */
  function pendingCount() { return (_rows || []).filter(r => !r.bucket).length; }

  return { render, reload, pendingCount };
})();
