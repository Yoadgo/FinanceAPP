/* ===== PAGE: ביצועים — עסקאות סגורות (Realized) ===== */

Pages.performance = (() => {

  let _trades   = [];
  let _fxRate   = null;
  let _filter   = 'all';
  let _container = null;
  let _currHandler = null;

  /* ── shared format helpers ── */
  const n = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;
  function fmtMoney(v, d = 2) { return (v === null || !isFinite(v)) ? '—' : Math.abs(v).toLocaleString('he-IL', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmtPct(v) { if (v === null || !isFinite(v)) return '—'; return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`; }
  function currSym() { return App.getCurrency() === 'ILS' ? '₪' : '$'; }
  function toDisplay(usd) { if (usd === null || usd === undefined || !isFinite(usd)) return null; return (App.getCurrency() === 'ILS' && _fxRate) ? usd * _fxRate : usd; }
  function fmtDate(raw) { const d = new Date(raw); return isNaN(d) ? '—' : `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`; }

  function render(container) {
    _container = container;
    _filter = 'all';
    if (_currHandler) document.removeEventListener('app:currencychange', _currHandler);
    _currHandler = () => { if (_container) _paint(_container); };
    document.addEventListener('app:currencychange', _currHandler);

    container.innerHTML = `<div class="pf-loading"><p style="color:var(--text-muted);font-size:13px">טוען עסקאות סגורות...</p></div>`;
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
      _trades = PortfolioEngine.computeClosedTrades(Classifier.enrichAll(txns));
      App.setDataStatus('live');
      _paint(_container);
    } catch (err) {
      App.setDataStatus('error', err.message);
      _container.innerHTML = `<div class="pf-loading"><p style="color:var(--danger);font-size:13px">שגיאה: ${err.message}</p></div>`;
    }
  }

  function _visible() { return _filter === 'all' ? _trades : _trades.filter(t => t.portfolio === _filter); }

  function _stats(trades) {
    let pnl = 0, wins = 0, holdSum = 0, proceeds = 0;
    trades.forEach(t => { pnl += t.pnl; if (t.pnl > 0) wins++; holdSum += t.holdDays; proceeds += t.proceeds; });
    return {
      count: trades.length, pnl,
      winRate: trades.length ? (wins / trades.length) * 100 : 0,
      avgHold: trades.length ? holdSum / trades.length : 0,
      proceeds,
    };
  }

  function _paint(container) {
    _container = container;
    const vis = _visible();
    const s   = _stats(vis);
    const sym = currSym();
    const ports = [...new Set(_trades.map(t => t.portfolio).filter(Boolean))].sort();
    const pnlColor = s.pnl >= 0 ? 'var(--success)' : 'var(--danger)';

    const filterBar = ports.length > 1 ? `
      <div class="pf-filter-bar">
        <span class="pf-filter-label">תיק:</span>
        <button class="pf-port-btn${_filter === 'all' ? ' active' : ''}" data-port="all">כל התיקים</button>
        ${ports.map(p => `<button class="pf-port-btn${_filter === p ? ' active' : ''}" data-port="${p}">${p}</button>`).join('')}
      </div>` : '';

    const macros = `
      <div class="pf-macros-row">
        <div class="pf-macro-card">
          <div class="pf-macro-label">רווח / הפסד ממומש (סה״כ)</div>
          <div class="pf-macro-value" style="color:${pnlColor}">${s.pnl >= 0 ? '+' : '−'}${sym}${fmtMoney(toDisplay(s.pnl))}</div>
          <div class="pf-macro-sub">מ-${s.count} עסקאות סגורות</div>
        </div>
        <div class="pf-macro-card">
          <div class="pf-macro-label">אחוז עסקאות מנצחות</div>
          <div class="pf-macro-value">${s.winRate.toFixed(0)}%</div>
          <div class="pf-macro-sub">${s.count} עסקאות</div>
        </div>
        <div class="pf-macro-card">
          <div class="pf-macro-label">ממוצע ימי החזקה</div>
          <div class="pf-macro-value">${s.avgHold.toFixed(0)}</div>
          <div class="pf-macro-sub">ימים לעסקה</div>
        </div>
        <div class="pf-macro-card">
          <div class="pf-macro-label">סך תמורות מכירה</div>
          <div class="pf-macro-value">${sym}${fmtMoney(toDisplay(s.proceeds))}</div>
          <div class="pf-macro-sub">היקף מסחר</div>
        </div>
      </div>`;

    const rows = vis.map(t => {
      const cls = t.pnl >= 0 ? 'pos' : 'neg';
      return `<tr>
        <td class="pf-td-center">${fmtDate(t.sellDate)}</td>
        <td class="pf-td-center"><span class="pf-sym-badge">${t.symbol}</span></td>
        ${ports.length > 1 && _filter === 'all' ? `<td class="pf-td-center pf-td-muted">${t.portfolio}</td>` : ''}
        <td class="pf-td-center pf-td-num">${t.qty.toLocaleString('he-IL', { maximumFractionDigits: 4 })}</td>
        <td class="pf-td-center pf-td-num">${sym}${fmtMoney(toDisplay(t.buyAvg))}</td>
        <td class="pf-td-center pf-td-num">${sym}${fmtMoney(toDisplay(t.sellPrice))}</td>
        <td class="pf-td-center"><div class="pf-pnl-cell ${cls}">
          <span class="pf-pnl-amt">${t.pnl >= 0 ? '+' : '−'}${sym}${fmtMoney(toDisplay(t.pnl))}</span>
          <span class="pf-pnl-pct">${fmtPct(t.pnlPct)}</span>
        </div></td>
        <td class="pf-td-center pf-td-num pf-td-muted">${t.holdDays.toFixed(0)} ימים</td>
      </tr>`;
    }).join('');

    const showPort = ports.length > 1 && _filter === 'all';
    const colspan = showPort ? 8 : 7;
    container.innerHTML = filterBar + macros + `
      <div class="pf-table-wrap" style="margin-top:14px">
        <table class="pf-table">
          <thead><tr>
            <th>תאריך מכירה</th><th>סימבול</th>${showPort ? '<th>תיק</th>' : ''}
            <th>כמות</th><th>מחיר קנייה ממוצע</th><th>מחיר מכירה</th><th>רווח / הפסד</th><th>משך החזקה</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="${colspan}" class="pf-no-data">אין עסקאות סגורות</td></tr>`}</tbody>
        </table>
      </div>`;

    container.querySelectorAll('.pf-port-btn').forEach(btn =>
      btn.addEventListener('click', () => { if (btn.dataset.port !== _filter) { _filter = btn.dataset.port; _paint(_container); } }));
  }

  return { render };
})();
