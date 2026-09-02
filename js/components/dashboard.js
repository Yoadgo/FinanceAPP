/* ===== PAGE: לוח בקרה — דשבורד בית מאוחד ===== */

Pages.dashboard = (() => {

  let _container = null;
  let _fxRate = null;
  let _currHandler = null;
  let _eqRange = 'all';       // equity chart range: quarter | year | all
  let _eqStep = 'month';      // equity chart point spacing: day | week | month
  const EQ_RANGE_DAYS = { quarter: 92, year: 365, all: Infinity };

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
    container.innerHTML = FA.skel.dashboard();
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

      // Equity curve: fetch price history for every traded symbol, then build
      // the cash / realized / unrealized time series.
      const symbols = [...new Set(enriched
        .filter(r => r.category === 'STOCKS')
        .map(r => (r.Symbol || '').toString().trim().toUpperCase())
        .filter(s => /^[A-Z]{1,5}$/.test(s)))];
      const historyMap = {};
      await Promise.all(symbols.map(async s => {
        try { historyMap[s] = await DataService.getStockHistory(s); } catch (_) { historyMap[s] = []; }
      }));
      const curve = PortfolioEngine.computeEquityCurve(enriched, historyMap, _fxRate, 'day');
      // Coherent net worth (accounting identity, currency-consistent):
      //   netWorth = invested + realized + unrealized + cashAdj  (= holdings + total cash)
      // Avoids the ILS-only CashBalanceILS which understated cash (margin overdraft).
      const lastPt   = curve.length ? curve[curve.length - 1] : { invested: 0, cashAdj: 0 };
      const invested = lastPt.invested || 0;
      const cashAdj  = lastPt.cashAdj || 0;
      const netWorth = invested + realized + (mktVal - cost) + cashAdj;
      const impliedCash = netWorth - mktVal;   // total cash (uninvested + realized + income − costs)

      _state = {
        mktVal, cost, dayChange, posCount: positions.length, priced,
        unrealized: mktVal - cost,
        unrealizedPct: cost > 0 ? ((mktVal - cost) / cost) * 100 : 0,
        dayChangePct: (mktVal - dayChange) > 0 ? (dayChange / (mktVal - dayChange)) * 100 : 0,
        realized, cash, cashUSD: impliedCash, invested, cashAdj, curve, netWorth,
      };
      App.setDataStatus('live');
      _paint();
    } catch (err) {
      App.setDataStatus('error', err.message);
      // מצב שגיאה מלא: מה קרה, מה זה אומר, ומה הצעד הבא. בלי כפתור ניסיון חוזר
      // המשתמש נשאר תקוע מול מסך מת.
      _container.innerHTML = FA.ui.errorState({ detail: err.message, actionId: 'db-retry' });
      const _rb = document.getElementById('db-retry');
      if (_rb) _rb.addEventListener('click', () => { _container.innerHTML = FA.skel.dashboard(); _load(); });
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

    const opt = (v, cur, l) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    const chart = `
      <div class="pf-chart-card" style="margin-top:14px">
        <div class="pf-chart-head">
          <div class="pf-chart-title">התפתחות לאורך זמן — הון שהושקע מול שווי התיק</div>
          <div class="pf-chart-ctls">
            <label class="ret-ctl">טווח:
              <select id="eq-range">${opt('quarter', _eqRange, 'רבעון')}${opt('year', _eqRange, 'שנה')}${opt('all', _eqRange, 'מההתחלה')}</select>
            </label>
            <label class="ret-ctl">רזולוציה:
              <select id="eq-step">${opt('day', _eqStep, 'יומי')}${opt('week', _eqStep, 'שבועי')}${opt('month', _eqStep, 'חודשי')}</select>
            </label>
          </div>
        </div>
        ${_renderEquityChart()}
        <div class="pf-bar-legend" style="margin-top:6px">
          <span><span class="pf-leg-dot" style="background:#059669"></span>שווי התיק</span>
          <span><span class="pf-leg-dot" style="background:#2563EB"></span>הון שהושקע (הפקדות מצטברות)</span>
          <span style="color:var(--text-muted)">הפער = רווח/הפסד</span>
        </div>
      </div>`;

    _container.innerHTML = hero + row1 + chart + row2 + links;
    _container.querySelectorAll('.db-link').forEach(el =>
      el.addEventListener('click', () => App.navigateTo(el.dataset.page)));
    const rSel = _container.querySelector('#eq-range');
    const sSel = _container.querySelector('#eq-step');
    if (rSel) rSel.addEventListener('change', () => { _eqRange = rSel.value; _paint(); });
    if (sSel) sSel.addEventListener('change', () => { _eqStep = sSel.value; _paint(); });
  }

  /* Downsample the daily curve to the selected spacing within the range. */
  function _eqPoints() {
    const all = (_state.curve || []).filter(p => isFinite(p.t));
    if (all.length < 2) return [];
    const cutoff = _eqRange === 'all' ? -Infinity : Date.now() - EQ_RANGE_DAYS[_eqRange] * 86400000;
    const inRange = all.filter(p => p.t >= cutoff);
    const src = inRange.length >= 2 ? inRange : all.slice(-2);
    if (_eqStep === 'day') return src;
    // keep the last point of each week/month bucket (plus the very last point)
    const seen = new Map();
    src.forEach(p => {
      const d = new Date(p.t);
      const key = _eqStep === 'week'
        ? `${d.getFullYear()}-${Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 604800000)}`
        : `${d.getFullYear()}-${d.getMonth()}`;
      seen.set(key, p);                 // later overwrites earlier → last in bucket
    });
    const out = [...seen.values()];
    if (out[out.length - 1] !== src[src.length - 1]) out.push(src[src.length - 1]);
    return out;
  }

  /* Time chart: invested capital vs total portfolio value (gap = profit).
     value = invested + realized + unrealized + cashAdj  (accounting identity,
     so it doesn't depend on the unreliable ILS-only cash balance). */
  const _eqValue = p => (p.invested || 0) + (p.realized || 0) + (p.unrealized || 0) + (p.cashAdj || 0);
  function _renderEquityChart() {
    const pts = _eqPoints();
    if (pts.length < 2) return '<p class="pf-no-data">אין מספיק היסטוריה להצגת גרף</p>';

    const series = [
      { key: 'value',    color: '#059669', fill: 'rgba(5,150,105,0.12)' },
      { key: 'invested', color: '#2563EB', fill: 'rgba(37,99,235,0.06)' },
    ];
    const val = (p, k) => toDisplay(k === 'value' ? _eqValue(p) : (p.invested || 0)) ?? 0;

    const W = 900, H = 280, padL = 62, padR = 16, padT = 14, padB = 26;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || (t0 + 1);
    let lo = Infinity, hi = -Infinity;
    pts.forEach(p => series.forEach(s => { const v = val(p, s.key); if (v < lo) lo = v; if (v > hi) hi = v; }));
    if (lo > 0) lo = 0;
    if (hi < 0) hi = 0;
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;

    const xS = t => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
    const yS = v => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
    const sym = currSym();

    let grid = '', yLbls = '';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) / 4) * i, y = yS(v);
      const lbl = Math.abs(v) >= 1000 ? `${sym}${(v / 1000).toFixed(0)}K` : `${sym}${v.toFixed(0)}`;
      grid  += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="0.5"/>`;
      yLbls += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-muted)" font-family="Inter,sans-serif">${lbl}</text>`;
    }
    const y0 = yS(0);
    const zero = (0 >= lo && 0 <= hi) ? `<line x1="${padL}" y1="${y0.toFixed(1)}" x2="${W - padR}" y2="${y0.toFixed(1)}" stroke="var(--text-secondary)" stroke-width="1" stroke-dasharray="3 3" opacity="0.5"/>` : '';

    const baseY = yS(Math.max(lo, Math.min(hi, 0)));
    const areas = series.map(s => {
      const top = pts.map((p, i) => `${i ? 'L' : 'M'}${xS(p.t).toFixed(1)} ${yS(val(p, s.key)).toFixed(1)}`).join(' ');
      return `<path d="${top} L${xS(t1).toFixed(1)} ${baseY.toFixed(1)} L${xS(t0).toFixed(1)} ${baseY.toFixed(1)} Z" fill="${s.fill}" stroke="none"/>`;
    }).join('');
    const lines = series.map(s => {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xS(p.t).toFixed(1)} ${yS(val(p, s.key)).toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');
    // End dots at the latest point.
    const last = pts[pts.length - 1];
    const dots = series.map(s => `<circle cx="${xS(last.t).toFixed(1)}" cy="${yS(val(last, s.key)).toFixed(1)}" r="3" fill="${s.color}" stroke="#fff" stroke-width="1.2"/>`).join('');

    const fmtD = ms => { const d = new Date(ms); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`; };
    let xLbls = '';
    [0, 0.5, 1].forEach(f => { const t = t0 + (t1 - t0) * f; xLbls += `<text x="${xS(t).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--text-muted)" font-family="Inter,sans-serif">${fmtD(t)}</text>`; });

    return `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block;height:280px">${grid}${zero}${yLbls}${areas}${lines}${dots}${xLbls}</svg>`;
  }

  function _link(page, title, sub) {
    return `<div class="db-link" data-page="${page}">
      <div class="db-link-title">${title}</div>
      <div class="db-link-sub">${sub}</div>
    </div>`;
  }

  return { render };
})();
