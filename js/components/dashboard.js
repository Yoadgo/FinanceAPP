/* ===== PAGE: לוח בקרה — דשבורד בית מאוחד ===== */

Pages.dashboard = (() => {

  let _container = null;
  let _fxRate = null;
  let _currHandler = null;

  const n = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;
  const fmtMoney = (v, d = 2) => (v === null || !isFinite(v)) ? '—' : Math.abs(v).toLocaleString('he-IL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtPct = v => (v === null || !isFinite(v)) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`;
  const currSym = () => App.getCurrency() === 'ILS' ? '₪' : '$';
  const toDisplay = usd => (usd === null || usd === undefined || !isFinite(usd)) ? null : (App.getCurrency() === 'ILS' && _fxRate ? usd * _fxRate : usd);

  /* Minimal symbol→{price,change} map from the realtime payload. */
  function _rtMap(rtData) {
    const map = {};
    if (rtData && rtData.values && rtData.values.length > 1) {
      const h = rtData.values[0].map(x => x.toString().toLowerCase().trim());
      const si = Math.max(0, h.findIndex(x => x.includes('symbol')));
      const pi = Math.max(1, h.findIndex(x => x.includes('price') || x.includes('rate')));
      const ci = Math.max(2, h.findIndex(x => x.includes('change') || x.includes('%')));
      rtData.values.slice(1).forEach(r => {
        const s = (r[si] || '').toString().trim().toUpperCase();
        if (!/^[A-Z]{1,5}$/.test(s)) return;
        const price = parseFloat((r[pi] || '').toString().replace(/[$,]/g, '')) || null;
        const chg = parseFloat((r[ci] || '').toString().replace(/[%,\s]/g, ''));
        map[s] = { price: price || null, change: isNaN(chg) ? null : chg };
      });
    }
    return map;
  }

  function render(container) {
    _container = container;
    if (_currHandler) document.removeEventListener('app:currencychange', _currHandler);
    _currHandler = () => { if (_state) _paint(); };
    document.addEventListener('app:currencychange', _currHandler);
    container.innerHTML = `<div class="pf-loading"><p style="color:var(--text-muted);font-size:13px">טוען לוח בקרה...</p></div>`;
    _load();
  }

  let _state = null;

  async function _load() {
    try {
      App.setDataStatus('loading');
      const [txns, rtData, fx] = await Promise.all([
        DataService.getTransactions(),
        DataService.getRealTimeData().catch(() => null),
        DataService.getFxRate().catch(() => null),
      ]);
      _fxRate = fx; if (_fxRate) App.setFxRate(_fxRate);

      const enriched = Classifier.enrichAll(txns);
      const rt = _rtMap(rtData);
      const positions = PortfolioEngine.computePositions(enriched);

      let mktVal = 0, cost = 0, dayChange = 0, priced = 0;
      positions.forEach(p => {
        cost += p.totalCost;
        const q = rt[p.symbol];
        if (q && q.price != null) {
          const mv = p.qty * q.price;
          mktVal += mv; priced++;
          if (q.change != null && (100 + q.change) !== 0) dayChange += mv * (q.change / (100 + q.change));
        } else { mktVal += p.totalCost; }
      });

      const cash = Analytics.cashSummary(enriched, _fxRate);
      const closed = PortfolioEngine.computeClosedTrades(enriched);
      const realized = closed.reduce((s, t) => s + t.pnl, 0);
      const cashILS = Analytics.latestCashILS(txns);
      const cashUSD = cashILS == null ? null : (_fxRate ? cashILS / _fxRate : cashILS);

      _state = {
        mktVal, cost, dayChange, posCount: positions.length, priced,
        unrealized: mktVal - cost,
        unrealizedPct: cost > 0 ? ((mktVal - cost) / cost) * 100 : 0,
        dayChangePct: (mktVal - dayChange) > 0 ? (dayChange / (mktVal - dayChange)) * 100 : 0,
        realized, cash, cashUSD,
        netWorth: mktVal + (cashUSD || 0),
      };
      App.setDataStatus('live');
      _paint();
    } catch (err) {
      App.setDataStatus('error', err.message);
      _container.innerHTML = `<div class="pf-loading"><p style="color:var(--danger);font-size:13px">שגיאה: ${err.message}</p></div>`;
    }
  }

  function _stat(label, valHTML, sub, color) {
    return `<div class="pf-macro-card">
      <div class="pf-macro-label">${label}</div>
      <div class="pf-macro-value"${color ? ` style="color:${color}"` : ''}>${valHTML}</div>
      <div class="pf-macro-sub"${color ? ` style="color:${color}"` : ''}>${sub || ''}</div>
    </div>`;
  }

  function _money(usd) { const sym = currSym(); const v = toDisplay(usd); return `${sym}${fmtMoney(v)}`; }
  function _signed(usd) { const sym = currSym(); const v = toDisplay(usd); return `${usd >= 0 ? '+' : '−'}${sym}${fmtMoney(Math.abs(v))}`; }

  function _paint() {
    const s = _state, sym = currSym();
    const dayColor = s.dayChange >= 0 ? 'var(--success)' : 'var(--danger)';
    const unColor  = s.unrealized >= 0 ? 'var(--success)' : 'var(--danger)';
    const reColor  = s.realized >= 0 ? 'var(--success)' : 'var(--danger)';

    const hero = `
      <div class="db-hero">
        <div class="db-hero-label">שווי נטו כולל</div>
        <div class="db-hero-value">${_money(s.netWorth)}</div>
        <div class="db-hero-sub">מניות ${_money(s.mktVal)}${s.cashUSD != null ? ` · ${s.cashUSD < 0 ? 'אשראי' : 'מזומן'} ${s.cashUSD < 0 ? '−' : ''}${currSym()}${fmtMoney(toDisplay(s.cashUSD))}` : ''}</div>
      </div>`;

    const row1 = `<div class="pf-macros-row">
      ${_stat('שווי מניות', _money(s.mktVal), `עלות: ${_money(s.cost)}`)}
      ${_stat('שינוי יומי', _signed(s.dayChange), fmtPct(s.dayChangePct), dayColor)}
      ${_stat('רווח / הפסד לא ממומש', _signed(s.unrealized), fmtPct(s.unrealizedPct), unColor)}
      ${_stat('רווח / הפסד ממומש', _signed(s.realized), 'מעסקאות שנסגרו', reColor)}
    </div>`;

    const row2 = `<div class="pf-macros-row" style="margin-top:12px">
      ${_stat('דיבידנדים שהתקבלו', _money(s.cash.dividends), 'מתחילת התקופה', 'var(--success)')}
      ${_stat('עמלות + מיסים', _money(s.cash.fees + s.cash.taxes + s.cash.debitInterest), 'עלויות מצטברות', 'var(--danger)')}
      ${_stat('הפקדות הון', _money(s.cash.deposits), 'הועבר מהבנק')}
      ${_stat('פוזיציות פתוחות', `${s.posCount}`, s.priced < s.posCount ? `${s.posCount - s.priced} ללא שער` : 'כולן עם שער')}
    </div>`;

    const links = `
      <div class="db-links">
        ${_link('portfolio', 'תיקי השקעות', 'אחזקות, גרפים וניתוח מניה')}
        ${_link('performance', 'ביצועים', 'עסקאות סגורות ורווח ממומש')}
        ${_link('cashflow', 'הכנסות והוצאות', 'דיבידנדים, עמלות ומיסים')}
        ${_link('journal', 'יומן תנועות', 'כל התנועות הגולמיות')}
      </div>`;

    _container.innerHTML = hero + row1 + row2 + links;
    _container.querySelectorAll('.db-link').forEach(el =>
      el.addEventListener('click', () => App.navigateTo(el.dataset.page)));
  }

  function _link(page, title, sub) {
    return `<div class="db-link" data-page="${page}">
      <div class="db-link-title">${title}</div>
      <div class="db-link-sub">${sub}</div>
    </div>`;
  }

  return { render };
})();
