/* ===== PAGE: ביצועים — עסקאות סגורות + מיסים ===== */

Pages.performance = (() => {

  let _trades = [];
  let _tax = null;
  let _enriched = null;       // classified transactions (for the returns chart)
  let _daily = null;          // daily equity series for the active portfolio
  let _dailyByPort = {};       // cache: portfolio → daily series
  let _histMap = null;         // cache: symbol → price history (shared)
  let _lastBuckets = [];       // last rendered returns buckets (for tooltip lookup)
  let _fxRate = null;
  let _filter = 'all';        // closed-trades portfolio filter
  let _tab = 'trades';        // 'trades' | 'returns' | 'tax'
  let _range = 'year';        // returns view range: day | quarter | year | all
  let _bucket = 'day';        // returns bar size: day | week | month | quarter | year
  let _metric = 'pct';        // returns metric: pct | amount
  let _retPort = 'all';       // returns portfolio filter
  let _container = null;
  let _currHandler = null;

  const CGT_RATE = 0.25;      // שיעור מס רווחי הון בישראל (להערכה בלבד)
  const RANGE_DAYS = { day: 1, quarter: 92, year: 365, all: Infinity };
  const HE_MON = ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'];

  const n = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;
  const fmtMoney = (v, d = 2) => (v === null || !isFinite(v)) ? '—' : Math.abs(v).toLocaleString('he-IL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtPct = v => (v === null || !isFinite(v)) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`;
  const currSym = () => App.getCurrency() === 'ILS' ? '₪' : '$';
  const toDisplay = usd => (usd === null || usd === undefined || !isFinite(usd)) ? null : (App.getCurrency() === 'ILS' && _fxRate ? usd * _fxRate : usd);
  const fmtDate = raw => { const d = new Date(raw); return isNaN(d) ? '—' : `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`; };

  function render(container) {
    _container = container; _filter = 'all'; _tab = 'trades';
    if (_currHandler) document.removeEventListener('app:currencychange', _currHandler);
    _currHandler = () => { if (_container) _paint(_container); };
    document.addEventListener('app:currencychange', _currHandler);
    container.innerHTML = FA.skel.tablePage(10, 6);
    _load();
  }

  async function _load() {
    try {
      App.setDataStatus('loading');
      const [txns, fx] = await Promise.all([
        DataService.getTransactions(),
        DataService.getFxRate().catch(() => null),
      ]);
      _fxRate = fx; if (_fxRate) App.setFxRate(_fxRate);
      _enriched = Classifier.enrichAll(txns);
      _trades = PortfolioEngine.computeClosedTrades(_enriched);
      _tax = Analytics.taxSummary(_enriched, _fxRate);
      _daily = null; _dailyByPort = {}; _histMap = null;
      App.setDataStatus('live');
      _paint(_container);
    } catch (err) {
      App.setDataStatus('error', err.message);
      // מצב שגיאה מלא: מה קרה, מה זה אומר, ומה הצעד הבא. בלי כפתור ניסיון חוזר
      // המשתמש נשאר תקוע מול מסך מת.
      _container.innerHTML = FA.ui.errorState({ detail: err.message, actionId: 'pf2-retry' });
      const _rb = document.getElementById('pf2-retry');
      if (_rb) _rb.addEventListener('click', () => { _container.innerHTML = FA.skel.tablePage(10, 6); _load(); });
    }
  }

  function _visible() { return _filter === 'all' ? _trades : _trades.filter(t => t.portfolio === _filter); }

  function _tabBar() {
    return `<div class="pf-filter-bar" style="margin-bottom:14px">
      <button class="pf-port-btn${_tab === 'trades' ? ' active' : ''}" data-tab="trades">עסקאות סגורות</button>
      <button class="pf-port-btn${_tab === 'returns' ? ' active' : ''}" data-tab="returns">תשואות</button>
      <button class="pf-port-btn${_tab === 'tax' ? ' active' : ''}" data-tab="tax">מיסים</button>
    </div>`;
  }

  /* ── TAB: closed trades ── */
  function _renderTrades() {
    const vis = _visible(), sym = currSym();
    const ports = [...new Set(_trades.map(t => t.portfolio).filter(Boolean))].sort();
    let pnl = 0, wins = 0, hold = 0, proceeds = 0;
    vis.forEach(t => { pnl += t.pnl; if (t.pnl > 0) wins++; hold += t.holdDays; proceeds += t.proceeds; });
    const winRate = vis.length ? (wins / vis.length) * 100 : 0;
    const avgHold = vis.length ? hold / vis.length : 0;
    const pnlColor = pnl >= 0 ? 'var(--success)' : 'var(--danger)';

    const filterBar = ports.length > 1 ? `
      <div class="pf-filter-bar">
        <span class="pf-filter-label">תיק:</span>
        <button class="pf-port-btn${_filter === 'all' ? ' active' : ''}" data-port="all">כל התיקים</button>
        ${ports.map(p => `<button class="pf-port-btn${_filter === p ? ' active' : ''}" data-port="${p}">${p}</button>`).join('')}
      </div>` : '';

    const macros = `<div class="pf-macros-row">
      <div class="pf-macro-card"><div class="pf-macro-label">רווח / הפסד ממומש (סה״כ)</div>
        <div class="pf-macro-value" style="color:${pnlColor}">${pnl >= 0 ? '+' : '−'}${sym}${fmtMoney(toDisplay(pnl))}</div>
        <div class="pf-macro-sub">מ-${vis.length} עסקאות סגורות</div></div>
      <div class="pf-macro-card"><div class="pf-macro-label">אחוז עסקאות מנצחות</div>
        <div class="pf-macro-value">${winRate.toFixed(0)}%</div><div class="pf-macro-sub">${wins}/${vis.length}</div></div>
      <div class="pf-macro-card"><div class="pf-macro-label">ממוצע ימי החזקה</div>
        <div class="pf-macro-value">${avgHold.toFixed(0)}</div><div class="pf-macro-sub">ימים לעסקה</div></div>
      <div class="pf-macro-card"><div class="pf-macro-label">סך תמורות מכירה</div>
        <div class="pf-macro-value">${sym}${fmtMoney(toDisplay(proceeds))}</div><div class="pf-macro-sub">היקף מסחר</div></div>
    </div>`;

    const showPort = ports.length > 1 && _filter === 'all';
    const colspan = showPort ? 8 : 7;
    const rows = vis.map(t => {
      const cls = t.pnl >= 0 ? 'pos' : 'neg';
      return `<tr>
        <td class="pf-td-center">${fmtDate(t.sellDate)}</td>
        <td class="pf-td-center"><span class="pf-sym-badge pf-sym-click" data-sym="${t.symbol}" title="גרף ניתוח">${t.symbol}</span></td>
        ${showPort ? `<td class="pf-td-center pf-td-muted">${t.portfolio}</td>` : ''}
        <td class="pf-td-center pf-td-num">${t.qty.toLocaleString('he-IL', { maximumFractionDigits: 4 })}</td>
        <td class="pf-td-center pf-td-num">${sym}${fmtMoney(toDisplay(t.buyAvg))}</td>
        <td class="pf-td-center pf-td-num">${sym}${fmtMoney(toDisplay(t.sellPrice))}</td>
        <td class="pf-td-center"><div class="pf-pnl-cell ${cls}">
          <span class="pf-pnl-amt">${t.pnl >= 0 ? '+' : '−'}${sym}${fmtMoney(toDisplay(t.pnl))}</span>
          <span class="pf-pnl-pct">${fmtPct(t.pnlPct)}</span></div></td>
        <td class="pf-td-center pf-td-num pf-td-muted">${t.holdDays.toFixed(0)} ימים</td>
      </tr>`;
    }).join('');

    return filterBar + macros + `
      <div class="pf-table-wrap" style="margin-top:14px"><table class="pf-table">
        <thead><tr>
          <th>תאריך מכירה</th><th>סימבול</th>${showPort ? '<th>תיק</th>' : ''}
          <th>כמות</th><th>מחיר קנייה ממוצע</th><th>מחיר מכירה</th><th>רווח / הפסד</th><th>משך החזקה</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="${colspan}" class="pf-no-data">אין עסקאות סגורות</td></tr>`}</tbody>
      </table></div>`;
  }

  /* ── TAB: taxes ── */
  function _renderTax() {
    const t = _tax, sym = currSym();
    // Realized P&L for the current calendar year (basis for estimated CGT).
    const curYear = new Date().getFullYear();
    const realizedThisYear = _trades.filter(tr => new Date(tr.sellDate).getFullYear() === curYear).reduce((s, tr) => s + tr.pnl, 0);
    const estCGT = Math.max(0, realizedThisYear) * CGT_RATE;

    const cards = `<div class="pf-macros-row">
      <!-- היה כאן "מס רווח הון שנוכה במקור". בחשבון הזה שום מס רווח הון
           לא נוכה במקור אי פעם — כל 72 הניכויים הזרים הם על דיבידנד (25%
           בדיוק, מזווגים 1:1 לתקבול). מס רווח הון משולם בדיעבד דרך מגן
           המס, וזה הסכום שבאמת יצא מהחשבון — עד עכשיו הוא הוצג כאפס. -->
      <div class="pf-macro-card"><div class="pf-macro-label">מס רווח הון ששולם בפועל</div>
        <div class="pf-macro-value" style="color:var(--danger)">${sym}${fmtMoney(toDisplay(t.payment))}</div>
        <div class="pf-macro-sub">נמשך ממגן המס, מצטבר</div></div>
      <div class="pf-macro-card"><div class="pf-macro-label">מס דיבידנד שנוכה</div>
        <div class="pf-macro-value" style="color:var(--danger)">${sym}${fmtMoney(toDisplay(t.dividend))}</div>
        <div class="pf-macro-sub">במקור, מצטבר</div></div>
      <div class="pf-macro-card"><div class="pf-macro-label">עתודת מס (מגן מס)</div>
        <div class="pf-macro-value">${sym}${fmtMoney(toDisplay(t.provision))}</div>
        <div class="pf-macro-sub">מופקד לקרן</div></div>
      <div class="pf-macro-card"><div class="pf-macro-label">אומדן מס על ${curYear}</div>
        <div class="pf-macro-value">${sym}${fmtMoney(toDisplay(estCGT))}</div>
        <div class="pf-macro-sub">25% על רווח ממומש ${realizedThisYear >= 0 ? '+' : '−'}${sym}${fmtMoney(toDisplay(Math.abs(realizedThisYear)))}</div></div>
    </div>`;

    const yearRows = (t.byYear || []).map(y => {
      const realizedY = _trades.filter(tr => new Date(tr.sellDate).getFullYear() === y.year).reduce((s, tr) => s + tr.pnl, 0);
      return `<tr>
        <td class="pf-td-center pf-td-bold">${y.year}</td>
        <td class="pf-td-center pf-td-num"><div class="pf-pnl-cell ${realizedY >= 0 ? 'pos' : 'neg'}"><span class="pf-pnl-amt">${realizedY >= 0 ? '+' : '−'}${sym}${fmtMoney(toDisplay(realizedY))}</span></div></td>
        <td class="pf-td-center pf-td-num">${sym}${fmtMoney(toDisplay(y.payment))}</td>
        <td class="pf-td-center pf-td-num">${sym}${fmtMoney(toDisplay(y.dividend))}</td>
        <td class="pf-td-center pf-td-num pf-td-muted">${sym}${fmtMoney(toDisplay(y.provision))}</td>
      </tr>`;
    }).join('');

    return cards + `
      <div class="pf-table-wrap" style="margin-top:14px"><table class="pf-table">
        <thead><tr><th>שנה</th><th>רווח ממומש</th><th>מס ששולם</th><th>מס דיבידנד שנוכה</th><th>מגן מס</th></tr></thead>
        <tbody>${yearRows || `<tr><td colspan="5" class="pf-no-data">אין נתוני מס</td></tr>`}</tbody>
      </table></div>
      <p style="color:var(--text-muted);font-size:12px;margin-top:10px;text-align:center;line-height:1.5">
        ⚠️ אומדן בלבד לפי 25% על רווח הון ממומש; אינו מתחשב בקיזוז הפסדים, פטורים או ניכוי במקור שכבר שולם. אינו ייעוץ מס.</p>`;
  }

  /* ── TAB: returns (תשואות) ── */
  function _retPorts() { return [...new Set(_enriched.filter(r => r.category === 'STOCKS').map(r => (r.Portfolio || '').trim()).filter(Boolean))].sort(); }

  async function _ensureDaily() {
    if (_dailyByPort[_retPort]) { _daily = _dailyByPort[_retPort]; return; }
    // Price history is per-symbol (portfolio-independent) → fetch once, cache.
    if (!_histMap) {
      const syms = [...new Set(_enriched.filter(r => r.category === 'STOCKS')
        .map(r => (r.Symbol || '').toString().trim().toUpperCase()).filter(s => /^[A-Z]{1,5}$/.test(s)))];
      _histMap = {};
      await Promise.all(syms.map(async s => { try { _histMap[s] = await DataService.getStockHistory(s); } catch (_) { _histMap[s] = []; } }));
    }
    const src = _retPort === 'all' ? _enriched : _enriched.filter(r => (r.Portfolio || '').trim() === _retPort);
    _daily = _dailyByPort[_retPort] = PortfolioEngine.computeEquityCurve(src, _histMap, _fxRate, 'day');
  }

  function _bucketKey(t) {
    const d = new Date(t), y = d.getFullYear(), m = d.getMonth();
    if (_bucket === 'year')    return { key: `${y}`, label: `${y}` };
    if (_bucket === 'quarter') { const q = Math.floor(m / 3) + 1; return { key: `${y}-Q${q}`, label: `Q${q}/${String(y).slice(2)}` }; }
    if (_bucket === 'month')   return { key: `${y}-${m}`, label: `${HE_MON[m]} ${String(y).slice(2)}` };
    if (_bucket === 'week')    { const oj = new Date(y, 0, 1); const wk = Math.ceil(((d - oj) / 86400000 + oj.getDay() + 1) / 7); return { key: `${y}-W${wk}`, label: `ש${wk}/${String(y).slice(2)}` }; }
    return { key: `${y}-${m}-${d.getDate()}`, label: `${d.getDate()}/${m + 1}` };
  }

  function _computeBuckets() {
    if (!_daily || _daily.length < 2) return [];
    const tp = p => p.unrealized + p.realized;
    const cutoff = _range === 'all' ? -Infinity : Date.now() - RANGE_DAYS[_range] * 86400000;
    const map = new Map();
    for (let i = 1; i < _daily.length; i++) {
      const day = _daily[i], prev = _daily[i - 1];
      if (day.t < cutoff) continue;
      const delta = tp(day) - tp(prev);
      if (_bucket === 'day' && Math.abs(delta) < 0.01) continue;   // skip non-trading days
      const baseMV = prev.marketValue || day.marketValue || 0;
      const { key, label } = _bucketKey(day.t);
      if (!map.has(key)) map.set(key, { key, label, t: day.t, pnl: 0, base: baseMV > 0 ? baseMV : 0, contrib: {} });
      const b = map.get(key);
      b.pnl += delta;
      // Per-symbol contribution to this bucket's P&L.
      const cur = day.bySym || {}, pv = prev.bySym || {};
      new Set([...Object.keys(cur), ...Object.keys(pv)]).forEach(s => {
        const d = (cur[s] || 0) - (pv[s] || 0);
        if (Math.abs(d) > 0.005) b.contrib[s] = (b.contrib[s] || 0) + d;
      });
    }
    return [...map.values()].sort((a, b) => a.t - b.t).map(b => ({
      ...b,
      ret: b.base > 0 ? (b.pnl / b.base) * 100 : 0,
      top: Object.entries(b.contrib).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 3),
    }));
  }

  const _val = b => _metric === 'pct' ? b.ret : (toDisplay(b.pnl) ?? 0);
  const _fmtVal = v => _metric === 'pct'
    ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`
    : `${v >= 0 ? '+' : '−'}${currSym()}${fmtMoney(Math.abs(v))}`;

  function _returnsSVG() {
    const buckets = _computeBuckets();
    _lastBuckets = buckets;
    if (!buckets.length) return '<p class="pf-no-data">אין נתונים לטווח שנבחר</p>';

    const W = 920, H = 320, padL = 56, padR = 12, padT = 14, padB = 34;
    const maxAbs = Math.max(1e-6, ...buckets.map(b => Math.abs(_val(b))));
    const chartH = H - padT - padB, chartW = W - padL - padR;
    const bw = Math.max(2, Math.min(26, chartW / buckets.length - 3));
    const step = chartW / buckets.length;
    const y0 = padT + chartH / 2;
    const yS = v => y0 - (v / maxAbs) * (chartH / 2);
    const fmtAxis = v => _metric === 'pct'
      ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`
      : `${v >= 0 ? '+' : '−'}${currSym()}${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(0) + 'K' : Math.abs(v).toFixed(0)}`;

    let grid = '', yLbls = '';
    [-1, -0.5, 0, 0.5, 1].forEach(f => {
      const v = maxAbs * f, y = yS(v);
      grid  += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="${f === 0 ? 1 : 0.5}"/>`;
      yLbls += `<text x="${padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-muted)" font-family="Inter,sans-serif">${fmtAxis(v)}</text>`;
    });

    let bars = '', xLbls = '';
    const labelEvery = Math.ceil(buckets.length / 14);
    buckets.forEach((b, i) => {
      const v = _val(b);
      const cx = padL + i * step + step / 2, x = cx - bw / 2;
      const y = v >= 0 ? yS(v) : y0;
      const h = Math.max(1, Math.abs(yS(v) - y0));
      const col = v >= 0 ? '#16A34A' : '#DC2626';
      bars += `<rect class="ret-bar" data-i="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}" rx="1.5"/>`;
      if (i % labelEvery === 0) xLbls += `<text x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="8.5" fill="var(--text-muted)" font-family="Inter,sans-serif">${b.label}</text>`;
    });

    return `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block;height:320px">${grid}${yLbls}${bars}${xLbls}</svg>`;
  }

  function _tipHTML(b) {
    const sym = currSym();
    const rows = (b.top || []).map(([s, v]) => `
      <div class="ret-tip-row">
        <span class="ret-tip-sym">${s}</span>
        <span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : '−'}${sym}${fmtMoney(toDisplay(v))}</span>
      </div>`).join('');
    return `
      <div class="ret-tip-head">${b.label}</div>
      <div class="ret-tip-total ${b.pnl >= 0 ? 'pos' : 'neg'}">${_metric === 'pct' ? `${_fmtVal(b.ret)} · ` : ''}${b.pnl >= 0 ? '+' : '−'}${sym}${fmtMoney(toDisplay(b.pnl))}</div>
      ${rows ? `<div class="ret-tip-sub">תרומה מובילה:</div>${rows}` : '<div class="ret-tip-sub">אין פירוט</div>'}`;
  }

  function _renderReturns() {
    const opt = (val, cur, label) => `<option value="${val}"${val === cur ? ' selected' : ''}>${label}</option>`;
    const ports = _retPorts();
    const portSel = ports.length > 1 ? `
        <label class="ret-ctl">תיק:
          <select id="ret-port">${opt('all', _retPort, 'כל התיקים')}${ports.map(p => opt(p, _retPort, p)).join('')}</select>
        </label>` : '';
    const controls = `
      <div class="pf-filter-bar" style="justify-content:flex-start;gap:18px;flex-wrap:wrap">
        ${portSel}
        <label class="ret-ctl">מדד:
          <select id="ret-metric">${opt('pct', _metric, 'תשואה %')}${opt('amount', _metric, `סכום (${currSym()})`)}</select>
        </label>
        <label class="ret-ctl">טווח תצוגה:
          <select id="ret-range">${opt('day', _range, 'יום')}${opt('quarter', _range, 'רבעון')}${opt('year', _range, 'שנה')}${opt('all', _range, 'מההתחלה')}</select>
        </label>
        <label class="ret-ctl">כל עמודה:
          <select id="ret-bucket">${opt('day', _bucket, 'יומי')}${opt('week', _bucket, 'שבועי')}${opt('month', _bucket, 'חודשי')}${opt('quarter', _bucket, 'רבעוני')}${opt('year', _bucket, 'שנתי')}</select>
        </label>
      </div>`;
    const body = !_daily
      ? `<div class="pf-loading" style="min-height:280px"><p style="color:var(--text-muted);font-size:13px">מחשב תשואות...</p></div>`
      : `<div class="pf-chart-card">
           <div class="pf-chart-title">תשואת התיק המנייתי${_retPort !== 'all' ? ' — ' + _retPort : ''} (${_metric === 'pct' ? '%' : 'סכום'})</div>
           <div class="ret-chart-wrap">${_returnsSVG()}<div class="ret-tip" id="ret-tip"></div></div>
         </div>`;
    return controls + body;
  }

  function _paint(container) {
    _container = container;
    const content = _tab === 'trades' ? _renderTrades() : _tab === 'tax' ? _renderTax() : _renderReturns();
    container.innerHTML = _tabBar() + content;

    container.querySelectorAll('[data-tab]').forEach(btn =>
      btn.addEventListener('click', () => { if (btn.dataset.tab !== _tab) { _tab = btn.dataset.tab; _paint(_container); } }));
    container.querySelectorAll('.pf-port-btn[data-port]').forEach(btn =>
      btn.addEventListener('click', () => { if (btn.dataset.port !== _filter) { _filter = btn.dataset.port; _paint(_container); } }));
    container.querySelectorAll('.pf-sym-click').forEach(el =>
      el.addEventListener('click', () => Pages.portfolio.openStock(el.dataset.sym)));

    const bind = (id, fn) => { const el = container.querySelector(id); if (el) el.addEventListener('change', () => { fn(el.value); _paint(_container); }); };
    bind('#ret-range',  v => _range = v);
    bind('#ret-bucket', v => _bucket = v);
    bind('#ret-metric', v => _metric = v);
    bind('#ret-port',   v => { _retPort = v; _daily = null; });   // triggers lazy recompute below

    // Tooltip: show holdings breakdown + top-3 for the hovered bar.
    const wrap = container.querySelector('.ret-chart-wrap');
    const tip = container.querySelector('#ret-tip');
    if (wrap && tip) {
      wrap.addEventListener('mousemove', e => {
        const bar = e.target.closest('.ret-bar');
        if (!bar) { tip.style.display = 'none'; return; }
        const b = _lastBuckets[+bar.dataset.i];
        if (!b) { tip.style.display = 'none'; return; }
        tip.innerHTML = _tipHTML(b);
        tip.style.display = 'block';
        const r = wrap.getBoundingClientRect();
        let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
        if (x + 200 > r.width) x = e.clientX - r.left - 200 - 14;   // flip near right edge
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
      });
      wrap.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    }

    // Lazy-load / recompute the daily series for the active portfolio.
    if (_tab === 'returns' && !_daily) {
      _ensureDaily().then(() => { if (_tab === 'returns' && _container) _paint(_container); });
    }
  }

  return { render };
})();
