/* ===== PAGE: תיקי השקעות ===== */

Pages.portfolio = (() => {

  /* ── State ── */
  let _positions    = [];
  let _rtMap        = {};
  let _fxRate       = null;
  let _portFilter   = 'all';
  let _container    = null;
  let _enrichedTxns = null;
  let _currHandler  = null;   // app:currencychange listener ref
  let _pollTimer    = null;   // live-price polling interval
  let _prevPrices   = {};     // symbol → last seen price (for blink-on-change)
  let _modalEl      = null;   // stock-detail modal overlay
  let _escHandler   = null;   // Esc-to-close listener
  let _visHandler   = null;   // visibilitychange listener ref

  const POLL_MS = 10000;      // live price refresh cadence

  /* ── Helpers ── */
  const n = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;

  function _currency() { return App.getCurrency(); }

  const PIE_COLORS = [
    '#2563EB','#7C3AED','#059669','#D97706','#EF4444',
    '#0EA5E9','#8B5CF6','#10B981','#F59E0B','#EC4899',
  ];

  function fmtMoney(val, dec = 2) {
    if (val === null || !isFinite(val)) return '—';
    return Math.abs(val).toLocaleString('he-IL', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    });
  }

  function fmtPct(val) {
    if (val === null || !isFinite(val)) return '—';
    const sign = val >= 0 ? '+' : '−';
    return `${sign}${Math.abs(val).toFixed(2)}%`;
  }

  function currSym() { return _currency() === 'ILS' ? '₪' : '$'; }

  function toDisplay(usdVal) {
    if (usdVal === null || usdVal === undefined || !isFinite(usdVal)) return null;
    return (_currency() === 'ILS' && _fxRate) ? usdVal * _fxRate : usdVal;
  }

  /* ═══════════════════════════════════════════════════
     Position calculation lives in PortfolioEngine
     (js/modules/portfolioEngine.js) — a shared, UI-free
     FIFO engine. See that file for the design rationale
     (per-portfolio ledger, broker-driven splits, etc.).
     ══════════════════════════════════════════════════ */

  /* ── Enrich with real-time prices ── */
  function _enrich(positions) {
    return positions.map(pos => {
      const rt     = _rtMap[pos.symbol] || {};
      const price  = rt.price  ?? null;
      const change = rt.change ?? null;
      const mktVal = price !== null ? pos.qty * price : null;
      const pnl    = mktVal !== null ? mktVal - pos.totalCost : null;
      const pnlPct = pos.totalCost > 0 && pnl !== null ? (pnl / pos.totalCost) * 100 : null;
      return { ...pos, currentPrice: price, changePercent: change, marketValue: mktVal, pnl, pnlPct };
    });
  }

  function _visible() {
    if (_portFilter === 'all') return _aggregateBySymbol(_positions);
    return _positions.filter(p => p.portfolio === _portFilter);
  }

  /* ── Integrated "all portfolios" view ──
     Merge positions that share a ticker across portfolios into a single
     holding (e.g. TSLA 150 in איביאי-יועד + 55 in איביאי-דר → one 205-share
     line). Quantities and cost basis sum; avg cost is re-weighted; market
     value and P&L are recomputed from the combined qty so every figure is
     consistent with a single 205-share position. The per-portfolio split
     is still available via the portfolio filter. */
  function _aggregateBySymbol(positions) {
    const map = {};
    positions.forEach(p => {
      let a = map[p.symbol];
      if (!a) {
        a = map[p.symbol] = {
          symbol: p.symbol, qty: 0, totalCost: 0, lots: [],
          realizedPnl: 0, currentPrice: null, changePercent: null, _ports: new Set(),
        };
      }
      a.qty       += p.qty;
      a.totalCost += p.totalCost;
      a.realizedPnl += p.realizedPnl || 0;
      if (Array.isArray(p.lots)) a.lots = a.lots.concat(p.lots);
      // Price/change are per-symbol (identical across portfolios) — take first non-null.
      if (a.currentPrice  === null && (p.currentPrice  ?? null) !== null) a.currentPrice  = p.currentPrice;
      if (a.changePercent === null && (p.changePercent ?? null) !== null) a.changePercent = p.changePercent;
      if (p.portfolio) a._ports.add(p.portfolio);
    });

    return Object.values(map).map(a => {
      const avgCost     = a.qty > 0 ? a.totalCost / a.qty : 0;
      const marketValue = a.currentPrice !== null ? a.qty * a.currentPrice : null;
      const pnl         = marketValue !== null ? marketValue - a.totalCost : null;
      const pnlPct      = a.totalCost > 0 && pnl !== null ? (pnl / a.totalCost) * 100 : null;
      return {
        symbol: a.symbol,
        portfolio: [...a._ports].join(', '),   // shows which portfolios the holding spans
        qty: a.qty, totalCost: a.totalCost, avgCost,
        lots: a.lots, realizedPnl: a.realizedPnl,
        currentPrice: a.currentPrice, changePercent: a.changePercent,
        marketValue, pnl, pnlPct,
      };
    });
  }

  function _macros(positions) {
    let totalValue = 0, totalCost = 0, priced = 0;
    positions.forEach(p => {
      totalCost  += p.totalCost;
      totalValue += p.marketValue !== null ? p.marketValue : p.totalCost;
      if (p.marketValue !== null) priced++;
    });
    const pnl    = totalValue - totalCost;
    const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
    return { totalValue, totalCost, pnl, pnlPct, count: positions.length, priced };
  }

  /* ═══════════════════════════════════════════════════
     Render entry point
     ══════════════════════════════════════════════════ */
  function render(container) {
    _container  = container;
    _portFilter = 'all';
    _enrichedTxns = null;
    _stopPolling();             // clear any timer from a previous mount
    _closeModal();              // close a stray modal if navigating back in

    // Register currency-change listener (remove previous to avoid stacking)
    if (_currHandler) document.removeEventListener('app:currencychange', _currHandler);
    _currHandler = () => { if (_container) _paint(_container); };
    document.addEventListener('app:currencychange', _currHandler);

    // When the tab becomes visible again, refresh prices immediately
    // (instead of waiting for the next 10s tick).
    if (_visHandler) document.removeEventListener('visibilitychange', _visHandler);
    _visHandler = () => { if (!document.hidden && _pollTimer) _pollPrices(); };
    document.addEventListener('visibilitychange', _visHandler);

    container.innerHTML = `
      <div class="pf-loading" id="pf-loading">
        <div class="empty-icon" style="margin:0 auto">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
            <polyline points="17 6 23 6 23 12"/>
          </svg>
        </div>
        <p style="color:var(--text-muted);font-size:13px;margin-top:8px">טוען תיק השקעות...</p>
      </div>
      <div id="pf-body" style="display:none"></div>`;

    _loadData();
  }

  /* ── Build the symbol→{price,change} map from a raw realtime response ── */
  function _buildRtMap(rtData) {
    const map = {};
    if (rtData && rtData.values && rtData.values.length > 1) {
      const headers = rtData.values[0].map(h => h.toString().toLowerCase().trim());
      const sIdx = Math.max(0, headers.findIndex(h => h.includes('symbol')));
      const pIdx = Math.max(1, headers.findIndex(h => h.includes('price') || h.includes('rate') || h.includes('מחיר') || h.includes('שער')));
      const cIdx = Math.max(2, headers.findIndex(h => h.includes('change') || h.includes('%') || h.includes('שינוי')));
      rtData.values.slice(1).forEach(r => {
        const sym = (r[sIdx] || '').toString().trim().toUpperCase();
        if (!sym || !/^[A-Z]{1,5}$/.test(sym)) return;
        const price  = parseFloat((r[pIdx] || '').toString().replace(/[$,]/g,  '')) || null;
        const change = parseFloat((r[cIdx] || '').toString().replace(/[%,\s]/g, ''));
        map[sym] = { price: price || null, change: isNaN(change) ? null : change };
      });
    } else if (rtData && Array.isArray(rtData)) {
      rtData.forEach(row => {
        const sym = (row.Symbol || row.symbol || '').toString().trim().toUpperCase();
        if (!sym || !/^[A-Z]{1,5}$/.test(sym)) return;
        const keys   = Object.keys(row);
        const pKey   = keys.find(k => /price|rate|מחיר|שער/i.test(k))   || 'Price';
        const cKey   = keys.find(k => /change|%|שינוי/i.test(k))        || 'Change';
        const price  = parseFloat((row[pKey] || '').toString().replace(/[$,]/g,  '')) || null;
        const change = parseFloat((row[cKey] || '').toString().replace(/[%,\s]/g, ''));
        map[sym]  = { price: price || null, change: isNaN(change) ? null : change };
      });
    }
    return map;
  }

  /* ── Single-phase loading ──
     Nothing is painted until ALL data (transactions + live prices + FX) is
     ready, so no window ever shows partial/intermediate figures. */
  async function _loadData() {
    const loading = document.getElementById('pf-loading');
    const body    = document.getElementById('pf-body');

    try {
      App.setDataStatus('loading');

      const [txns, rtData, fxRate] = await Promise.all([
        DataService.getTransactions(),
        DataService.getRealTimeData().catch(() => null),
        DataService.getFxRate().catch(() => null),
      ]);

      _enrichedTxns = Classifier.enrichAll(txns);
      _fxRate = fxRate;
      if (_fxRate) App.setFxRate(_fxRate);

      _rtMap = _buildRtMap(rtData);
      _prevPrices = {};
      Object.entries(_rtMap).forEach(([s, v]) => { if (v.price != null) _prevPrices[s] = v.price; });

      _positions = _enrich(PortfolioEngine.computePositions(_enrichedTxns));

      App.setDataStatus('live');
      if (loading) loading.style.display = 'none';
      if (body) { body.style.display = 'block'; _paint(body); }

      _startPolling();   // begin live price refresh

    } catch (err) {
      App.setDataStatus('error', err.message);
      if (loading) { loading.style.display = ''; loading.innerHTML = `
        <div class="empty-icon" style="margin:0 auto;background:rgba(217,48,37,0.08)">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <p style="color:var(--danger);font-size:13px;margin-top:10px;font-weight:600">שגיאה בטעינת הנתונים</p>
        <p style="color:var(--text-muted);font-size:12px;margin-top:4px;max-width:340px;text-align:center;line-height:1.5">${err.message}</p>`; }
    }
  }

  /* ═══════════════════════════════════════════════════
     Live price polling + in-place blink updates
     ══════════════════════════════════════════════════ */
  function _startPolling() {
    _stopPolling();
    _pollTimer = setInterval(_pollPrices, POLL_MS);
  }
  function _stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  async function _pollPrices() {
    // Skip if the page is hidden or the portfolio body is gone (navigated away)
    if (document.hidden) return;
    if (!_container || !document.body.contains(_container)) { _stopPolling(); return; }
    try {
      const rtData = await DataService.getRealTimeData(true);   // force fresh
      const fresh  = _buildRtMap(rtData);
      if (Object.keys(fresh).length) {
        _rtMap = fresh;
        _positions = _enrich(PortfolioEngine.computePositions(_enrichedTxns));
        _patchPrices();
      }
    } catch (_) { /* transient network error — keep last values */ }
  }

  /* Update price/value/P&L cells in place (no full repaint) and blink any
     cell whose price actually changed. Also refreshes the macro totals. */
  function _patchPrices() {
    if (!_container) return;
    const sym = currSym();
    const vis = _visible();

    vis.forEach(p => {
      const row = _container.querySelector(`tr[data-key="${_rowKey(p)}"]`);
      const prev = _prevPrices[p.symbol];
      const curr = p.currentPrice;

      if (row) {
        const priceCell = row.querySelector('.pf-price-cell');
        const valCell   = row.querySelector('.pf-val-cell');
        const pnlCell   = row.querySelector('.pf-pnl-cell');
        if (priceCell) priceCell.outerHTML = _priceCellHTML(p, sym);
        if (valCell)   valCell.innerHTML   = _valCellInner(p, sym);
        if (pnlCell)   pnlCell.outerHTML    = _pnlCellHTML(p, sym);

        // Blink only when the price genuinely moved
        if (curr != null && prev != null && curr !== prev) {
          const freshCell = row.querySelector('.pf-price-cell');
          if (freshCell) {
            const cls = curr > prev ? 'pf-blink-up' : 'pf-blink-down';
            freshCell.classList.add(cls);
            setTimeout(() => freshCell.classList.remove(cls), 1000);
          }
        }
      }
      if (curr != null) _prevPrices[p.symbol] = curr;
    });

    // Refresh macro totals (value + P&L) without disturbing the layout
    const mac = _macros(vis);
    _patchMacros(mac, sym);
  }

  function _patchMacros(m, sym) {
    const tv  = toDisplay(m.totalValue);
    const tc  = toDisplay(m.totalCost);
    const pnl = toDisplay(m.pnl);
    const cards = _container.querySelectorAll('.pf-macro-card');
    if (cards[0]) {
      const v = cards[0].querySelector('.pf-macro-value');
      const s = cards[0].querySelector('.pf-macro-sub');
      if (v) v.textContent = `${sym}${tv !== null ? fmtMoney(tv) : '—'}`;
      if (s) s.textContent = `עלות: ${sym}${tc !== null ? fmtMoney(tc) : '—'}`;
    }
    if (cards[1]) {
      const color = m.pnl >= 0 ? 'var(--success)' : 'var(--danger)';
      const sign  = m.pnl >= 0 ? '+' : '−';
      const v = cards[1].querySelector('.pf-macro-value');
      const s = cards[1].querySelector('.pf-macro-sub');
      if (v) { v.textContent = pnl !== null ? `${sign}${sym}${fmtMoney(Math.abs(pnl))}` : '—'; v.style.color = color; }
      if (s) { s.textContent = fmtPct(m.pnlPct); s.style.color = color; }
    }
  }

  /* ═══════════════════════════════════════════════════
     Paint (full repaint of pf-body)
     ══════════════════════════════════════════════════ */
  function _paint(container) {
    _container = container;
    const vis   = _visible();
    const mac   = _macros(vis);
    const ports = [...new Set(_positions.map(p => p.portfolio).filter(Boolean))].sort();

    container.innerHTML =
      (ports.length > 1 ? _renderPortFilter(ports) : '') +
      _renderMacros(mac) +
      `<div class="pf-main-grid">
        ${_renderTable(vis, ports.length > 1 && _portFilter === 'all')}
        <div class="pf-charts-col">
          <div class="pf-chart-card pf-chart-bar">
            <div class="pf-chart-title">עלות מושקעת מול שווי נוכחי</div>
            ${_renderBarChart(vis)}
          </div>
          <div class="pf-chart-card pf-chart-pie">
            <div class="pf-chart-title">חלוקת נכסים</div>
            ${_renderPieChart(vis)}
          </div>
        </div>
      </div>` +
      _renderCards(vis);

    _bindEvents(container);
  }

  /* ── Portfolio Filter ── */
  function _renderPortFilter(ports) {
    return `
      <div class="pf-filter-bar">
        <span class="pf-filter-label">תיק:</span>
        <button class="pf-port-btn${_portFilter === 'all' ? ' active' : ''}" data-port="all">כל התיקים</button>
        ${ports.map(p => `<button class="pf-port-btn${_portFilter === p ? ' active' : ''}" data-port="${p}">${p}</button>`).join('')}
      </div>`;
  }

  /* ── Macro Cards ── */
  function _renderMacros(m) {
    const sym      = currSym();
    const tv       = toDisplay(m.totalValue);
    const tc       = toDisplay(m.totalCost);
    const pnl      = toDisplay(m.pnl);
    const pnlColor = m.pnl >= 0 ? 'var(--success)' : 'var(--danger)';
    const pnlSign  = m.pnl >= 0 ? '+' : '−';
    const noPrice  = m.count - m.priced;

    return `
      <div class="pf-macros-row">
        <div class="pf-macro-card">
          <div class="pf-macro-label">שווי תיק כולל</div>
          <div class="pf-macro-value">${sym}${tv !== null ? fmtMoney(tv) : '—'}</div>
          <div class="pf-macro-sub">עלות: ${sym}${tc !== null ? fmtMoney(tc) : '—'}</div>
        </div>
        <div class="pf-macro-card">
          <div class="pf-macro-label">רווח / הפסד לא ממומש</div>
          <div class="pf-macro-value" style="color:${pnlColor}">
            ${pnl !== null ? `${pnlSign}${sym}${fmtMoney(Math.abs(pnl))}` : '—'}
          </div>
          <div class="pf-macro-sub" style="color:${pnlColor}">${fmtPct(m.pnlPct)}</div>
        </div>
        <div class="pf-macro-card">
          <div class="pf-macro-label">פוזיציות פתוחות</div>
          <div class="pf-macro-value">${m.count}</div>
          <div class="pf-macro-sub">${noPrice > 0 ? `${noPrice} ללא שער` : 'כולן עם שער'}</div>
        </div>
      </div>`;
  }

  /* ── Bar Chart (SVG) ── */
  function _renderBarChart(positions) {
    const sym   = currSym();
    const items = positions.map(p => ({
      symbol: p.symbol,
      cost:   toDisplay(p.totalCost)   ?? 0,
      value:  toDisplay(p.marketValue) ?? toDisplay(p.totalCost) ?? 0,
      pnl:    p.pnl,
    })).filter(it => it.cost > 0 || it.value > 0);

    if (!items.length) return '<p class="pf-no-data">אין נתונים</p>';

    const maxVal = Math.max(...items.map(it => Math.max(it.cost, it.value))) * 1.08;
    const H = 162, padL = 54, padB = 32, padT = 8;
    const chartH = H - padB - padT;
    const barW = 20, grpW = 56;
    const yS = v => padT + chartH - (v / maxVal) * chartH;

    let grid = '', yLbls = '';
    for (let i = 0; i <= 4; i++) {
      const v = (maxVal / 4) * i;
      const y = yS(v);
      const l = v >= 1e6 ? `${sym}${(v/1e6).toFixed(1)}M`
              : v >= 1e3 ? `${sym}${(v/1e3).toFixed(0)}K`
              : `${sym}${v.toFixed(0)}`;
      grid  += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL+items.length*grpW+10}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="0.6"/>`;
      yLbls += `<text x="${padL-5}" y="${(y+3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-muted)" font-family="Inter,sans-serif">${l}</text>`;
    }

    let bars = '', xLbls = '';
    items.forEach((it, i) => {
      const gX   = padL + i * grpW + 4;
      const cH   = Math.max((it.cost  / maxVal) * chartH, 1);
      const vH   = Math.max((it.value / maxVal) * chartH, 1);
      const cY   = padT + chartH - cH;
      const vY   = padT + chartH - vH;
      const vCol = it.pnl !== null ? (it.pnl >= 0 ? '#059669' : '#DC2626') : '#64748B';
      const midX = gX + barW + 3;
      bars  += `<rect x="${gX}" y="${cY.toFixed(1)}" width="${barW}" height="${cH.toFixed(1)}" fill="#94A3B8" rx="2"/>
                <rect x="${gX+barW+4}" y="${vY.toFixed(1)}" width="${barW}" height="${vH.toFixed(1)}" fill="${vCol}" rx="2" opacity="0.88"/>`;
      xLbls += `<text x="${midX}" y="${H-8}" text-anchor="middle" font-size="9.5" font-weight="500" fill="var(--text-secondary)" font-family="Inter,sans-serif">${it.symbol}</text>`;
    });

    return `
      <div class="pf-bar-scroll">
        <svg width="${padL+items.length*grpW+18}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          ${grid}${yLbls}
          <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT+chartH}" stroke="var(--border)" stroke-width="1"/>
          ${bars}${xLbls}
        </svg>
      </div>
      <div class="pf-bar-legend">
        <span><span class="pf-leg-dot" style="background:#94A3B8"></span>עלות</span>
        <span><span class="pf-leg-dot" style="background:#059669"></span>שווי</span>
      </div>`;
  }

  /* ── Pie / Donut Chart (SVG) ── */
  function _renderPieChart(positions) {
    const items = positions.map((p, i) => ({
      symbol: p.symbol,
      value:  p.marketValue ?? p.totalCost,
      color:  PIE_COLORS[i % PIE_COLORS.length],
    })).filter(it => it.value > 0);

    if (!items.length) return '<p class="pf-no-data">אין נתונים</p>';

    const total = items.reduce((s, it) => s + it.value, 0);
    const cx = 76, cy = 76, r = 66, ir = 40;
    let paths = '';

    if (items.length === 1) {
      paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${items[0].color}"/>
               <circle cx="${cx}" cy="${cy}" r="${ir}" fill="var(--bg-surface)"/>`;
    } else {
      let angle = -Math.PI / 2;
      items.forEach(it => {
        const sweep = (it.value / total) * 2 * Math.PI;
        const end   = angle + sweep;
        const large = sweep > Math.PI ? 1 : 0;
        const x1  = cx + r  * Math.cos(angle), y1  = cy + r  * Math.sin(angle);
        const x2  = cx + r  * Math.cos(end),   y2  = cy + r  * Math.sin(end);
        const ix1 = cx + ir * Math.cos(angle), iy1 = cy + ir * Math.sin(angle);
        const ix2 = cx + ir * Math.cos(end),   iy2 = cy + ir * Math.sin(end);
        const d = `M${ix1.toFixed(2)} ${iy1.toFixed(2)} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L${ix2.toFixed(2)} ${iy2.toFixed(2)} A${ir} ${ir} 0 ${large} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)}Z`;
        paths += `<path d="${d}" fill="${it.color}" stroke="var(--bg-surface)" stroke-width="1.5"><title>${it.symbol}: ${((it.value/total)*100).toFixed(1)}%</title></path>`;
        angle = end;
      });
    }

    const legend = items.map(it => `
      <div class="pf-pie-row">
        <span class="pf-pie-dot" style="background:${it.color}"></span>
        <span class="pf-pie-sym">${it.symbol}</span>
        <span class="pf-pie-pct">${((it.value/total)*100).toFixed(1)}%</span>
      </div>`).join('');

    return `
      <div class="pf-pie-wrap">
        <svg width="152" height="152" viewBox="0 0 152 152" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">
          ${paths}
          <text x="${cx}" y="${cy-4}"  text-anchor="middle" font-size="9.5" fill="var(--text-muted)"    font-family="Inter,sans-serif">סה"כ</text>
          <text x="${cx}" y="${cy+11}" text-anchor="middle" font-size="11"  font-weight="600" fill="var(--text-primary)" font-family="Inter,sans-serif">${items.length} מניות</text>
        </svg>
        <div class="pf-pie-legend">${legend}</div>
      </div>`;
  }

  /* ── Row key & shared cell builders (reused by _patchPrices for live updates) ── */
  function _rowKey(p) { return p.symbol; }   // symbol is unique within any single view

  function _priceCellHTML(p, sym) {
    const price  = toDisplay(p.currentPrice);
    const chgCls = p.changePercent === null || p.changePercent === undefined ? '' : p.changePercent >= 0 ? 'pos' : 'neg';
    if (price === null) return `<div class="pf-price-cell"><span class="pf-td-muted">—</span></div>`;
    return `<div class="pf-price-cell">
        <span class="pf-price-main ${chgCls}">${sym}${fmtMoney(price)}</span>
        ${p.changePercent !== null && p.changePercent !== undefined
          ? `<span class="pf-price-chg ${chgCls}">${fmtPct(p.changePercent)}</span>` : ''}
      </div>`;
  }

  function _pnlCellHTML(p, sym) {
    const pnl    = toDisplay(p.pnl);
    const pnlCls = p.pnl === null || p.pnl === undefined ? '' : p.pnl >= 0 ? 'pos' : 'neg';
    if (pnl === null) return `<div class="pf-pnl-cell"><span class="pf-td-muted">—</span></div>`;
    return `<div class="pf-pnl-cell ${pnlCls}">
        <span class="pf-pnl-amt">${p.pnl >= 0 ? '+' : '−'}${sym}${fmtMoney(Math.abs(pnl))}</span>
        <span class="pf-pnl-pct">${fmtPct(p.pnlPct)}</span>
      </div>`;
  }

  function _valCellInner(p, sym) {
    const mktVal = toDisplay(p.marketValue);
    return mktVal !== null ? `${sym}${fmtMoney(mktVal)}` : '—';
  }

  /* ── Holdings Table (desktop) ── */
  function _renderTable(positions, showPort) {
    const sym = currSym();

    const rows = positions.map(p => {
      const avgCost = toDisplay(p.avgCost);
      return `<tr data-key="${_rowKey(p)}">
        <td class="pf-td-center"><span class="pf-sym-badge pf-sym-click" data-sym="${p.symbol}" title="פרטי מניה">${p.symbol}</span></td>
        ${showPort ? `<td class="pf-td-center pf-td-muted">${p.portfolio}</td>` : ''}
        <td class="pf-td-center pf-td-num">${p.qty.toLocaleString('he-IL', { maximumFractionDigits: 4 })}</td>
        <td class="pf-td-center">${_priceCellHTML(p, sym)}</td>
        <td class="pf-td-center pf-td-num">${avgCost !== null ? `${sym}${fmtMoney(avgCost)}` : '—'}</td>
        <td class="pf-td-center pf-td-num pf-td-bold pf-val-cell">${_valCellInner(p, sym)}</td>
        <td class="pf-td-center">${_pnlCellHTML(p, sym)}</td>
      </tr>`;
    }).join('');

    const colspan = showPort ? 7 : 6;
    return `
      <div class="pf-table-wrap">
        <table class="pf-table">
          <thead>
            <tr>
              <th>סימבול</th>
              ${showPort ? '<th>תיק</th>' : ''}
              <th>כמות</th>
              <th>שער אחרון</th>
              <th>מחיר כניסה</th>
              <th>שווי שוק</th>
              <th>רווח / הפסד</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="${colspan}" class="pf-no-data">אין פוזיציות פתוחות</td></tr>`}
          </tbody>
        </table>
      </div>`;
  }

  /* ── Holdings Cards (mobile) ── */
  function _renderCards(positions) {
    const sym = currSym();

    if (!positions.length) {
      return `<div class="pf-cards"><p class="pf-no-data">אין פוזיציות פתוחות</p></div>`;
    }

    const cards = positions.map(p => {
      const price  = toDisplay(p.currentPrice);
      const mktVal = toDisplay(p.marketValue);
      const pnl    = toDisplay(p.pnl);
      const pnlCls = p.pnl === null ? '' : p.pnl >= 0 ? 'pos' : 'neg';
      const chgCls = p.changePercent === null ? '' : p.changePercent >= 0 ? 'pos' : 'neg';

      return `<div class="pf-card">
        <div class="pf-card-top">
          <span class="pf-sym-badge pf-sym-click" data-sym="${p.symbol}" title="פרטי מניה">${p.symbol}</span>
          ${p.changePercent !== null
            ? `<span class="pf-chg-badge ${chgCls}">${fmtPct(p.changePercent)}</span>`
            : ''}
          <span class="pf-card-port">${p.portfolio}</span>
        </div>
        <div class="pf-card-grid">
          <div class="pf-card-cell">
            <span class="pf-card-lbl">כמות</span>
            <span>${p.qty.toLocaleString('he-IL', { maximumFractionDigits: 4 })}</span>
          </div>
          <div class="pf-card-cell">
            <span class="pf-card-lbl">שער</span>
            <div class="pf-price-cell" style="align-items:flex-start">
              <span class="pf-price-main ${chgCls}">${price !== null ? `${sym}${fmtMoney(price)}` : '—'}</span>
              ${p.changePercent !== null ? `<span class="pf-price-chg ${chgCls}">${fmtPct(p.changePercent)}</span>` : ''}
            </div>
          </div>
          <div class="pf-card-cell">
            <span class="pf-card-lbl">שווי שוק</span>
            <span class="pf-td-bold">${mktVal !== null ? `${sym}${fmtMoney(mktVal)}` : '—'}</span>
          </div>
          <div class="pf-card-cell">
            <span class="pf-card-lbl">רווח / הפסד</span>
            <div class="pf-pnl-cell ${pnlCls}" style="align-items:flex-start">
              ${pnl !== null
                ? `<span class="pf-pnl-amt">${p.pnl >= 0 ? '+' : '−'}${sym}${fmtMoney(Math.abs(pnl))}</span>
                   <span class="pf-pnl-pct">${fmtPct(p.pnlPct)}</span>`
                : '—'}
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    return `<div class="pf-cards">${cards}</div>`;
  }

  /* ── Events ── */
  function _bindEvents(container) {
    container.querySelectorAll('.pf-port-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        if (btn.dataset.port === _portFilter) return;
        _portFilter = btn.dataset.port;
        _paint(_container);
      })
    );

    // Click a ticker → open the stock-detail modal
    container.querySelectorAll('.pf-sym-click').forEach(el =>
      el.addEventListener('click', () => _openStockModal(el.dataset.sym))
    );
  }

  /* ═══════════════════════════════════════════════════
     STOCK DETAIL MODAL
     ══════════════════════════════════════════════════ */
  let _modalState = null;   // { symbol, history, trades, range }

  /* All STOCKS + SPLIT rows for a symbol, chronological. */
  function _symbolRows(symbol) {
    return _enrichedTxns
      .filter(r => (r.Symbol || '').toString().trim().toUpperCase() === symbol)
      .filter(r => r.category === 'STOCKS' || r.subCategory === 'SPLIT')
      .map((r, i) => ({ ...r, _i: i }))
      .sort((a, b) => (new Date(a.Date) - new Date(b.Date)) || (a._i - b._i));
  }

  /* Split events as [{date(ms), ratio}], derived from broker הטבה rows.
     Ratio = (held + delta) / held within the same portfolio; deduped by date
     (both portfolios' rows on a split date carry the same ratio). */
  function _splitEvents(symbol) {
    const runByPort = {};
    const events = [];
    const seen = new Set();
    _symbolRows(symbol).forEach(r => {
      const port = (r.Portfolio || '').trim();
      const q = Math.abs(n(r.Qty));
      if (r.subCategory === 'SPLIT') {
        const held = runByPort[port] || 0;
        if (held > 0.001 && q > 0) {
          const key = (r.Date || '').toString().slice(0, 10);
          if (!seen.has(key)) { events.push({ date: new Date(r.Date).getTime(), ratio: (held + q) / held }); seen.add(key); }
          runByPort[port] = held + q;
        }
        return;
      }
      const isBuy = r.subCategory === 'BUY_STOCK' || (r.Type || '').includes('קני');
      runByPort[port] = (runByPort[port] || 0) + (isBuy ? q : -q);
    });
    return events;
  }

  /* Buy/sell trades with prices split-adjusted to align with the
     (split-adjusted) history line. Respects the active portfolio filter. */
  function _splitAdjustedTrades(symbol, portFilter) {
    const events = _splitEvents(symbol);
    return _symbolRows(symbol)
      .filter(r => r.category === 'STOCKS')
      .filter(r => portFilter === 'all' || (r.Portfolio || '').trim() === portFilter)
      .map(r => {
        const t = new Date(r.Date).getTime();
        let factor = 1;
        events.forEach(e => { if (t < e.date) factor *= e.ratio; });
        const isBuy = r.subCategory === 'BUY_STOCK' || (r.Type || '').includes('קני');
        const rawPrice = Math.abs(n(r.ExecutionRate));
        const rawQty   = Math.abs(n(r.Qty));
        return {
          date: t, dateStr: (r.Date || '').toString().slice(0, 10),
          side: isBuy ? 'BUY' : 'SELL',
          rawPrice, rawQty,
          adjPrice: (factor !== 1 && rawPrice > 0) ? rawPrice / factor : rawPrice,
          portfolio: (r.Portfolio || '').trim(),
        };
      });
  }

  const RANGE_DAYS = { '1M': 30, '6M': 182, '1Y': 365, 'ALL': Infinity };

  async function _openStockModal(symbol) {
    symbol = (symbol || '').toString().trim().toUpperCase();
    if (!symbol) return;
    _closeModal();

    // Build overlay shell with a spinner
    _modalEl = document.createElement('div');
    _modalEl.className = 'pf-modal-overlay';
    _modalEl.innerHTML = `
      <div class="pf-modal" role="dialog" aria-modal="true">
        <button class="pf-modal-close" title="סגור">✕</button>
        <div class="pf-modal-loading">
          <div class="empty-icon" style="margin:0 auto">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          </div>
          <p style="color:var(--text-muted);font-size:13px;margin-top:8px">טוען נתוני ${symbol}...</p>
        </div>
      </div>`;
    document.body.appendChild(_modalEl);

    // Close interactions
    _modalEl.addEventListener('click', e => { if (e.target === _modalEl) _closeModal(); });
    _modalEl.querySelector('.pf-modal-close').addEventListener('click', _closeModal);
    _escHandler = e => { if (e.key === 'Escape') _closeModal(); };
    document.addEventListener('keydown', _escHandler);

    // Load history (transactions already in memory)
    let history = [];
    try { history = await DataService.getStockHistory(symbol); } catch (_) { history = []; }
    if (!_modalEl) return;   // closed while loading

    const trades = _splitAdjustedTrades(symbol, _portFilter);
    _modalState = { symbol, history: history || [], trades, range: 'ALL' };
    _renderModalBody();
  }

  function _closeModal() {
    if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
    if (_modalEl && _modalEl.parentNode) _modalEl.parentNode.removeChild(_modalEl);
    _modalEl = null;
    _modalState = null;
  }

  function _renderModalBody() {
    if (!_modalEl || !_modalState) return;
    const { symbol, range } = _modalState;
    const sym = currSym();

    // Position under the active filter (aggregated when 'all')
    const pos = _visible().find(p => p.symbol === symbol);
    const rt  = _rtMap[symbol] || {};
    const chgCls = rt.change == null ? '' : rt.change >= 0 ? 'pos' : 'neg';

    const modal = _modalEl.querySelector('.pf-modal');
    modal.innerHTML = `
      <button class="pf-modal-close" title="סגור">✕</button>
      <div class="pf-modal-head">
        <span class="pf-sym-badge" style="font-size:15px">${symbol}</span>
        <div class="pf-modal-price">
          <span class="pf-price-main ${chgCls}" style="font-size:20px">${rt.price != null ? '$' + fmtMoney(rt.price) : '—'}</span>
          ${rt.change != null ? `<span class="pf-price-chg ${chgCls}">${fmtPct(rt.change)}</span>` : ''}
        </div>
        ${pos ? `<span class="pf-modal-port">${pos.portfolio || ''}</span>` : ''}
      </div>
      ${pos ? _renderModalSummary(pos, sym) : '<p class="pf-no-data">הפוזיציה סגורה — מוצגות עסקאות היסטוריות בלבד</p>'}
      <div class="pf-modal-chart-head">
        <span class="pf-chart-title">גרף מחיר ונקודות עסקה</span>
        <div class="pf-range-btns">
          ${Object.keys(RANGE_DAYS).map(k => `<button class="pf-range-btn${k === range ? ' active' : ''}" data-range="${k}">${k === 'ALL' ? 'הכל' : k.replace('M','ח').replace('Y','ש')}</button>`).join('')}
        </div>
      </div>
      <div class="pf-modal-chart">${_renderStockChart()}</div>
      <div class="pf-modal-legend">
        <span><span class="pf-dot" style="background:#059669"></span>קנייה</span>
        <span><span class="pf-dot" style="background:#DC2626"></span>מכירה</span>
        <span><span class="pf-dot" style="background:#2563EB"></span>מחיר סגירה</span>
      </div>
      ${_renderModalTxns()}`;

    // Rebind close + range buttons (innerHTML replaced)
    modal.querySelector('.pf-modal-close').addEventListener('click', _closeModal);
    modal.querySelectorAll('.pf-range-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        if (!_modalState) return;
        _modalState.range = btn.dataset.range;
        _renderModalBody();
      })
    );
  }

  function _renderModalSummary(pos, sym) {
    const cells = [
      ['כמות',        pos.qty.toLocaleString('he-IL', { maximumFractionDigits: 4 })],
      ['עלות ממוצעת', `${sym}${fmtMoney(toDisplay(pos.avgCost))}`],
      ['שווי שוק',    pos.marketValue != null ? `${sym}${fmtMoney(toDisplay(pos.marketValue))}` : '—'],
      ['רווח לא ממומש', pos.pnl != null ? `${pos.pnl >= 0 ? '+' : '−'}${sym}${fmtMoney(Math.abs(toDisplay(pos.pnl)))}` : '—', pos.pnl == null ? '' : pos.pnl >= 0 ? 'pos' : 'neg'],
      ['רווח ממומש',  pos.realizedPnl != null ? `${pos.realizedPnl >= 0 ? '+' : '−'}${sym}${fmtMoney(Math.abs(toDisplay(pos.realizedPnl)))}` : '—', !pos.realizedPnl ? '' : pos.realizedPnl >= 0 ? 'pos' : 'neg'],
    ];
    return `<div class="pf-modal-summary">
      ${cells.map(([l, v, cls]) => `
        <div class="pf-modal-stat">
          <span class="pf-modal-stat-lbl">${l}</span>
          <span class="pf-modal-stat-val ${cls || ''}">${v}</span>
        </div>`).join('')}
    </div>`;
  }

  /* SVG price line + buy/sell markers. Chart is in native USD. */
  function _renderStockChart() {
    const { history, trades, range } = _modalState;
    if (!history || !history.length) return '<p class="pf-no-data">אין היסטוריית מחירים</p>';

    const pts = history
      .map(h => ({ t: new Date(h.date).getTime(), c: parseFloat(h.close) }))
      .filter(p => isFinite(p.t) && isFinite(p.c))
      .sort((a, b) => a.t - b.t);
    if (!pts.length) return '<p class="pf-no-data">אין היסטוריית מחירים</p>';

    const lastT = pts[pts.length - 1].t;
    const days  = RANGE_DAYS[range] ?? Infinity;
    const minT  = days === Infinity ? pts[0].t : lastT - days * 86400000;
    const vp    = pts.filter(p => p.t >= minT);
    const series = vp.length ? vp : pts;
    const vt = trades.filter(tr => tr.date >= series[0].t - 86400000);

    const W = 640, H = 260, padL = 52, padR = 12, padT = 12, padB = 26;
    const t0 = series[0].t, t1 = series[series.length - 1].t || (t0 + 1);
    const allC = series.map(p => p.c).concat(vt.map(tr => tr.adjPrice).filter(v => v > 0));
    let minC = Math.min(...allC), maxC = Math.max(...allC);
    if (!isFinite(minC) || !isFinite(maxC)) return '<p class="pf-no-data">אין נתונים</p>';
    const pad = (maxC - minC) * 0.08 || maxC * 0.05 || 1;
    minC -= pad; maxC += pad;

    const xS = t => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
    const yS = c => padT + (1 - (c - minC) / (maxC - minC || 1)) * (H - padT - padB);

    // Grid + y labels
    let grid = '', yLbls = '';
    for (let i = 0; i <= 4; i++) {
      const c = minC + ((maxC - minC) / 4) * i;
      const y = yS(c);
      grid  += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="0.6"/>`;
      yLbls += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-muted)" font-family="Inter,sans-serif">$${c.toFixed(0)}</text>`;
    }
    // x labels (start / mid / end dates)
    const fmtD = ms => { const d = new Date(ms); return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`; };
    let xLbls = '';
    [0, 0.5, 1].forEach(f => {
      const t = t0 + (t1 - t0) * f;
      xLbls += `<text x="${xS(t).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--text-muted)" font-family="Inter,sans-serif">${fmtD(t)}</text>`;
    });

    const line = series.map((p, i) => `${i ? 'L' : 'M'}${xS(p.t).toFixed(1)} ${yS(p.c).toFixed(1)}`).join(' ');
    const area = `${line} L${xS(t1).toFixed(1)} ${(H - padB).toFixed(1)} L${xS(t0).toFixed(1)} ${(H - padB).toFixed(1)} Z`;

    const markers = vt.map(tr => {
      if (!(tr.adjPrice > 0)) return '';
      const x = xS(tr.date), y = yS(tr.adjPrice);
      const col = tr.side === 'BUY' ? '#059669' : '#DC2626';
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${col}" stroke="#fff" stroke-width="1.2">
        <title>${tr.side === 'BUY' ? 'קנייה' : 'מכירה'} ${tr.dateStr} · ${tr.rawQty} @ $${tr.rawPrice.toFixed(2)}</title></circle>`;
    }).join('');

    return `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      ${grid}${yLbls}
      <path d="${area}" fill="rgba(37,99,235,0.07)" stroke="none"/>
      <path d="${line}" fill="none" stroke="#2563EB" stroke-width="1.6"/>
      ${markers}${xLbls}
    </svg>`;
  }

  function _renderModalTxns() {
    const { trades } = _modalState;
    if (!trades.length) return '<p class="pf-no-data">אין עסקאות</p>';
    const rows = [...trades].sort((a, b) => b.date - a.date).map(tr => `
      <tr>
        <td class="pf-td-center">${tr.dateStr}</td>
        <td class="pf-td-center"><span class="pf-side ${tr.side === 'BUY' ? 'buy' : 'sell'}">${tr.side === 'BUY' ? 'קנייה' : 'מכירה'}</span></td>
        <td class="pf-td-center pf-td-num">${tr.rawQty.toLocaleString('he-IL', { maximumFractionDigits: 4 })}</td>
        <td class="pf-td-center pf-td-num">$${fmtMoney(tr.rawPrice)}</td>
        <td class="pf-td-center pf-td-num">$${fmtMoney(tr.rawQty * tr.rawPrice)}</td>
        <td class="pf-td-center pf-td-muted">${tr.portfolio}</td>
      </tr>`).join('');
    return `
      <div class="pf-modal-txns-head">היסטוריית עסקאות (${trades.length})</div>
      <div class="pf-modal-txns-wrap">
        <table class="pf-table">
          <thead><tr><th>תאריך</th><th>סוג</th><th>כמות</th><th>מחיר</th><th>שווי</th><th>תיק</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  /* ═══════════════════════════════════════════════════
     FIFO Debugger — Pages.portfolio.debugFifo('TSLA')
     Traces every transaction for a symbol through the
     engine logic, PER PORTFOLIO, so you can see exactly
     what's included, excluded, and the running qty at
     each step (matching PortfolioEngine.computePositions).
     ══════════════════════════════════════════════════ */
  function debugFifo(symbols) {
    if (!_enrichedTxns || !_enrichedTxns.length) {
      console.warn('debugFifo: no enriched transactions yet — navigate to the portfolio page first.');
      return;
    }
    const num = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;
    const list = Array.isArray(symbols) ? symbols : [symbols];

    list.forEach(sym => {
      const target = sym.trim().toUpperCase();
      const rows   = _enrichedTxns
        .filter(r => (r.Symbol || '').toString().trim().toUpperCase() === target)
        .sort((a, b) => new Date(a.Date) - new Date(b.Date));

      if (!rows.length) { console.warn(`debugFifo: no transactions found for ${target}`); return; }

      // Trace each portfolio separately — the engine keys by (portfolio, symbol).
      const ports = [...new Set(rows.map(r => (r.Portfolio || '').trim()))];

      ports.forEach(port => {
        const pRows = rows.filter(r => (r.Portfolio || '').trim() === port);
        console.group(`🔍 FIFO trace: ${target} @ ${port || '(no portfolio)'} (${pRows.length} rows)`);

        let runningQty = 0;
        pRows.forEach(r => {
          const cat = r.category, sub = r.subCategory;
          const inFifo = (cat === 'STOCKS') || (sub === 'SPLIT') ||
            ((cat === 'UNCLASSIFIED' || !sub) && ((r.Type||'').includes('קני') || (r.Type||'').includes('מכיר')));

          const rawQty = num(r.Qty), absQty = Math.abs(rawQty), rawRate = num(r.ExecutionRate);

          let note = '';
          if (inFifo && sub === 'SPLIT') {
            // Broker-driven split: ratio derived from the reported share delta.
            if (runningQty > 0.001 && absQty > 0) {
              const ratio = (runningQty + absQty) / runningQty;
              runningQty += absQty;
              note = `SPLIT ×${ratio.toFixed(3)} (broker +${absQty})`;
            } else {
              note = 'SPLIT skipped (no open qty)';
            }
          } else if (inFifo) {
            let action = null;
            if      (sub === 'BUY_STOCK')  action = 'BUY';
            else if (sub === 'SELL_STOCK') action = 'SELL';
            else {
              const t = (r.Type||'');
              if (t.includes('קני'))  action = 'BUY';
              if (t.includes('מכיר')) action = 'SELL';
            }
            if (action === 'BUY')  runningQty += absQty;
            if (action === 'SELL') { runningQty -= absQty; if (runningQty < -0.0001) runningQty = 0; }
          }

          const flag   = inFifo ? '✅' : '⛔';
          const qtyStr = rawQty !== absQty ? `${rawQty} (abs ${absQty})` : `${rawQty}`;
          console.log(
            flag, (r.Date || '').toString().slice(0, 10), `"${r.Type}"`,
            `[${cat} / ${sub}]`,
            `qty=${qtyStr}  rate=${rawRate}`,
            inFifo ? `→ running qty: ${runningQty.toFixed(4)}${note ? '  ' + note : ''}` : ''
          );
        });

        console.log(`%cFinal qty: ${runningQty.toFixed(4)}`, 'font-weight:bold;color:' + (runningQty > 0.01 ? 'orange' : 'green'));
        console.groupEnd();
      });
    });
  }

  return { render, debugFifo, openStock: _openStockModal };
})();
