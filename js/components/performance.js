/* ===== PAGE: ביצועים — עסקאות סגורות + מיסים ===== */

Pages.performance = (() => {

  let _trades = [];
  let _tax = null;
  let _enriched = null;       // classified transactions (for the returns chart)
  let _daily = null;          // daily equity series (lazy-loaded for returns tab)
  let _fxRate = null;
  let _filter = 'all';
  let _tab = 'trades';        // 'trades' | 'returns' | 'tax'
  let _range = 'year';        // returns view range: day | quarter | year | all
  let _bucket = 'day';        // returns bar size: day | week | month | quarter | year
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
    container.innerHTML = `<div class="pf-loading"><p style="color:var(--text-muted);font-size:13px">טוען ביצועים...</p></div>`;
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
      _daily = null;
      App.setDataStatus('live');
      _paint(_container);
    } catch (err) {
      App.setDataStatus('error', err.message);
      _container.innerHTML = `<div class="pf-loading"><p style="color:var(--danger);font-size:13px">שגיאה: ${err.message}</p></div>`;
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
      <div class="pf-macro-card"><div class="pf-macro-label">מס רווח הון שנוכה</div>
        <div class="pf-macro-value" style="color:var(--danger)">${sym}${fmtMoney(toDisplay(t.capitalGain))}</div>
        <div class="pf-macro-sub">במקור, מצטבר</div></div>
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
        <td class="pf-td-center pf-td-num">${sym}${fmtMoney(toDisplay(y.capitalGain))}</td>
        <td class="pf-td-center pf-td-num">${sym}${fmtMoney(toDisplay(y.dividend))}</td>
        <td class="pf-td-center pf-td-num pf-td-muted">${sym}${fmtMoney(toDisplay(y.provision))}</td>
      </tr>`;
    }).join('');

    return cards + `
      <div class="pf-table-wrap" style="margin-top:14px"><table class="pf-table">
        <thead><tr><th>שנה</th><th>רווח ממומש</th><th>מס רווח הון</th><th>מס דיבידנד</th><th>מגן מס</th></tr></thead>
        <tbody>${yearRows || `<tr><td colspan="5" class="pf-no-data">אין נתוני מס</td></tr>`}</tbody>
      </table></div>
      <p style="color:var(--text-muted);font-size:12px;margin-top:10px;text-align:center;line-height:1.5">
        ⚠️ אומדן בלבד לפי 25% על רווח הון ממומש; אינו מתחשב בקיזוז הפסדים, פטורים או ניכוי במקור שכבר שולם. אינו ייעוץ מס.</p>`;
  }

  /* ── TAB: returns (תשואות) ── */
  async function _ensureDaily() {
    if (_daily) return;
    const syms = [...new Set(_enriched
      .filter(r => r.category === 'STOCKS')
      .map(r => (r.Symbol || '').toString().trim().toUpperCase())
      .filter(s => /^[A-Z]{1,5}$/.test(s)))];
    const hist = {};
    await Promise.all(syms.map(async s => { try { hist[s] = await DataService.getStockHistory(s); } catch (_) { hist[s] = []; } }));
    _daily = PortfolioEngine.computeEquityCurve(_enriched, hist, _fxRate, 'day');
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
      const day = _daily[i];
      if (day.t < cutoff) continue;
      const delta = tp(day) - tp(_daily[i - 1]);
      // Daily view: skip non-trading days (weekends/holidays → no price move).
      if (_bucket === 'day' && Math.abs(delta) < 0.01) continue;
      const baseMV = _daily[i - 1].marketValue || day.marketValue || 0;
      const { key, label } = _bucketKey(day.t);
      if (!map.has(key)) map.set(key, { key, label, t: day.t, pnl: 0, base: baseMV > 0 ? baseMV : 0 });
      map.get(key).pnl += delta;
    }
    return [...map.values()]
      .sort((a, b) => a.t - b.t)
      .map(b => ({ ...b, ret: b.base > 0 ? (b.pnl / b.base) * 100 : 0 }));
  }

  function _returnsSVG() {
    const buckets = _computeBuckets();
    if (!buckets.length) return '<p class="pf-no-data">אין נתונים לטווח שנבחר</p>';

    const W = 920, H = 320, padL = 46, padR = 12, padT = 14, padB = 34;
    const maxAbs = Math.max(0.5, ...buckets.map(b => Math.abs(b.ret)));
    const chartH = H - padT - padB, chartW = W - padL - padR;
    const bw = Math.max(2, Math.min(26, chartW / buckets.length - 3));
    const step = chartW / buckets.length;
    const y0 = padT + chartH / 2;
    const yS = v => y0 - (v / maxAbs) * (chartH / 2);

    let grid = '', yLbls = '';
    [-1, -0.5, 0, 0.5, 1].forEach(f => {
      const v = maxAbs * f, y = yS(v);
      grid  += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="${f === 0 ? 1 : 0.5}"/>`;
      yLbls += `<text x="${padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-muted)" font-family="Inter,sans-serif">${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%</text>`;
    });

    let bars = '', xLbls = '';
    const labelEvery = Math.ceil(buckets.length / 14);
    buckets.forEach((b, i) => {
      const cx = padL + i * step + step / 2;
      const x = cx - bw / 2;
      const y = b.ret >= 0 ? yS(b.ret) : y0;
      const h = Math.max(1, Math.abs(yS(b.ret) - y0));
      const col = b.ret >= 0 ? '#16A34A' : '#DC2626';
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}" rx="1.5"><title>${b.label}: ${b.ret >= 0 ? '+' : '−'}${Math.abs(b.ret).toFixed(2)}%</title></rect>`;
      if (i % labelEvery === 0) xLbls += `<text x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="8.5" fill="var(--text-muted)" font-family="Inter,sans-serif">${b.label}</text>`;
    });

    return `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block;height:320px">${grid}${yLbls}${bars}${xLbls}</svg>`;
  }

  function _renderReturns() {
    const opt = (val, cur, label) => `<option value="${val}"${val === cur ? ' selected' : ''}>${label}</option>`;
    const controls = `
      <div class="pf-filter-bar" style="justify-content:flex-start;gap:18px">
        <label class="ret-ctl">טווח תצוגה:
          <select id="ret-range">
            ${opt('day', _range, 'יום')}${opt('quarter', _range, 'רבעון')}${opt('year', _range, 'שנה')}${opt('all', _range, 'מההתחלה')}
          </select>
        </label>
        <label class="ret-ctl">כל עמודה:
          <select id="ret-bucket">
            ${opt('day', _bucket, 'יומי')}${opt('week', _bucket, 'שבועי')}${opt('month', _bucket, 'חודשי')}${opt('quarter', _bucket, 'רבעוני')}${opt('year', _bucket, 'שנתי')}
          </select>
        </label>
      </div>`;
    const body = !_daily
      ? `<div class="pf-loading" style="min-height:280px"><p style="color:var(--text-muted);font-size:13px">מחשב תשואות...</p></div>`
      : `<div class="pf-chart-card"><div class="pf-chart-title">תשואת התיק המנייתי (לפי שינוי ברווח הכולל)</div>${_returnsSVG()}</div>`;
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

    const rangeSel = container.querySelector('#ret-range');
    const bucketSel = container.querySelector('#ret-bucket');
    if (rangeSel)  rangeSel.addEventListener('change', () => { _range = rangeSel.value; _paint(_container); });
    if (bucketSel) bucketSel.addEventListener('change', () => { _bucket = bucketSel.value; _paint(_container); });

    // Lazy-load the daily series the first time the returns tab is shown.
    if (_tab === 'returns' && !_daily) {
      _ensureDaily().then(() => { if (_tab === 'returns' && _container) _paint(_container); });
    }
  }

  return { render };
})();
