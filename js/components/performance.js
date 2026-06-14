/* ===== PAGE: ביצועים — עסקאות סגורות + מיסים ===== */

Pages.performance = (() => {

  let _trades = [];
  let _tax = null;
  let _fxRate = null;
  let _filter = 'all';
  let _tab = 'trades';        // 'trades' | 'tax'
  let _container = null;
  let _currHandler = null;

  const CGT_RATE = 0.25;      // שיעור מס רווחי הון בישראל (להערכה בלבד)

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
      const enriched = Classifier.enrichAll(txns);
      _trades = PortfolioEngine.computeClosedTrades(enriched);
      _tax = Analytics.taxSummary(enriched, _fxRate);
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

  function _paint(container) {
    _container = container;
    container.innerHTML = _tabBar() + (_tab === 'trades' ? _renderTrades() : _renderTax());

    container.querySelectorAll('[data-tab]').forEach(btn =>
      btn.addEventListener('click', () => { if (btn.dataset.tab !== _tab) { _tab = btn.dataset.tab; _paint(_container); } }));
    container.querySelectorAll('.pf-port-btn[data-port]').forEach(btn =>
      btn.addEventListener('click', () => { if (btn.dataset.port !== _filter) { _filter = btn.dataset.port; _paint(_container); } }));
    container.querySelectorAll('.pf-sym-click').forEach(el =>
      el.addEventListener('click', () => Pages.portfolio.openStock(el.dataset.sym)));
  }

  return { render };
})();
