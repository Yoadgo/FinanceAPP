/* ===== PAGE: תיקי השקעות ===== */

Pages.portfolio = (() => {

  /* ── State ── */
  let _positions    = [];
  let _rtMap        = {};
  let _fxRate       = null;
  let _portFilter   = 'all';
  let _currency     = 'USD';
  let _container    = null;
  let _enrichedTxns = null;

  /* ── Helpers ── */
  const n = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;

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

  function currSym() { return _currency === 'ILS' ? '₪' : '$'; }

  function toDisplay(usdVal) {
    if (usdVal === null || usdVal === undefined || !isFinite(usdVal)) return null;
    return (_currency === 'ILS' && _fxRate) ? usdVal * _fxRate : usdVal;
  }

  /* ═══════════════════════════════════════════════════
     FIFO Position Calculator
     ── Key by symbol only (global ledger).
     ── Uses ExecutionRate as cost-per-share; falls back
        to TotalFX/Qty if ExecutionRate is missing.
     ── Sells consume the oldest lots first (FIFO).
     ── Splits adjust all existing lots proportionally.
     ══════════════════════════════════════════════════ */
  function _computePositions(transactions) {
    const ledger = {};

    const relevant = transactions
      .filter(r => ['BUY_STOCK', 'SELL_STOCK', 'SPLIT', 'BONUS'].includes(r.subCategory))
      .sort((a, b) => new Date(a.Date) - new Date(b.Date));

    relevant.forEach(row => {
      const sym = (row.Symbol || '').trim();
      if (!sym || !/^[A-Z]{1,5}$/.test(sym)) return;

      const rawQty = n(row.Qty);
      if (rawQty <= 0) return;

      const rawPrice = n(row.ExecutionRate);
      // Fallback: derive per-share cost from TotalFX when ExecutionRate is absent
      const costPerShare = rawPrice > 0
        ? rawPrice
        : (rawQty > 0 ? Math.abs(n(row.TotalFX)) / rawQty : 0);

      const port = (row.Portfolio || '').trim();

      if (!ledger[sym]) {
        ledger[sym] = { symbol: sym, portfolio: port, qty: 0, lots: [] };
      }
      const item = ledger[sym];
      if (port) item.portfolio = port; // keep most-recent non-empty portfolio name

      /* ── BUY: push a new lot ── */
      if (row.subCategory === 'BUY_STOCK') {
        item.qty += rawQty;
        item.lots.push({ qty: rawQty, costPerShare, date: row.Date });

      /* ── SELL: FIFO consume oldest lots ── */
      } else if (row.subCategory === 'SELL_STOCK') {
        let remaining = rawQty;
        while (remaining > 0.0001 && item.lots.length > 0) {
          if (item.lots[0].qty > remaining) {
            item.lots[0].qty -= remaining;
            remaining = 0;
          } else {
            remaining -= item.lots[0].qty;
            item.lots.shift();
          }
        }
        item.qty -= rawQty;
        if (item.qty < 0) item.qty = 0;

      /* ── SPLIT: scale existing lots (qty×ratio, cost÷ratio) ── */
      } else if (row.subCategory === 'SPLIT') {
        if (item.qty > 0.0001) {
          const newTotal = item.qty + rawQty;
          const ratio    = newTotal / item.qty;
          item.lots.forEach(lot => {
            lot.qty          *= ratio;
            lot.costPerShare /= ratio;
          });
        }
        item.qty += rawQty;

      /* ── BONUS: add shares at zero cost ── */
      } else if (row.subCategory === 'BONUS') {
        item.qty += rawQty;
        item.lots.push({ qty: rawQty, costPerShare: 0, date: row.Date });
      }
    });

    return Object.values(ledger)
      .filter(p => p.qty > 0.01)
      .map(p => {
        const totalCost = p.lots.reduce((s, l) => s + l.qty * l.costPerShare, 0);
        return {
          symbol:    p.symbol,
          portfolio: p.portfolio,
          qty:       p.qty,
          totalCost,
          avgCost:   p.qty > 0 ? totalCost / p.qty : 0,
        };
      });
  }

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
    if (_portFilter === 'all') return _positions;
    return _positions.filter(p => p.portfolio === _portFilter);
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
    _container    = container;
    _portFilter   = 'all';
    _currency     = 'USD';
    _enrichedTxns = null;

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

  /* ── Two-phase loading ──
     Phase 1 — transactions (often from localStorage cache → instant)
     Phase 2 — real-time prices + FX (network, fills in prices) */
  async function _loadData() {
    const loading = document.getElementById('pf-loading');
    const body    = document.getElementById('pf-body');

    try {
      App.setDataStatus('loading');

      /* Phase 1: positions without prices (fast from cache) */
      const txns    = await DataService.getTransactions();
      _enrichedTxns = Classifier.enrichAll(txns);
      _positions    = _computePositions(_enrichedTxns);

      if (loading) loading.style.display = 'none';
      if (body) { body.style.display = 'block'; _paint(body); }

      /* Phase 2: live prices + FX in parallel */
      const [rtRows, fxRate] = await Promise.all([
        DataService.getRealTimeData().catch(() => []),
        DataService.getFxRate().catch(() => null),
      ]);

      _fxRate = fxRate;
      if (_fxRate) App.setFxRate(_fxRate);

      _rtMap = {};
      (rtRows || []).forEach(row => {
        const sym = (row.Symbol || row.symbol || '').toString().trim().toUpperCase();
        if (!sym) return;
        const price  = parseFloat((row.Price  || row.price  || '').toString().replace(/[^\d.-]/g, '')) || null;
        const change = parseFloat((row.Change || row.change || row['Change%'] || row['change%'] || '').toString().replace(/[^\d.-]/g, ''));
        _rtMap[sym] = { price: price || null, change: isNaN(change) ? null : change };
      });

      _positions = _enrich(_computePositions(_enrichedTxns));
      App.setDataStatus('live');
      if (body) _paint(body);

    } catch (err) {
      App.setDataStatus('error', err.message);
      if (loading) loading.innerHTML = `
        <div class="empty-icon" style="margin:0 auto;background:rgba(217,48,37,0.08)">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <p style="color:var(--danger);font-size:13px;margin-top:10px;font-weight:600">שגיאה בטעינת הנתונים</p>
        <p style="color:var(--text-muted);font-size:12px;margin-top:4px;max-width:340px;text-align:center;line-height:1.5">${err.message}</p>`;
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
      _renderToolbar(ports) +
      _renderMacros(mac) +
      `<div class="pf-charts-row">
        <div class="pf-chart-card pf-chart-bar">
          <div class="pf-chart-title">עלות מושקעת מול שווי נוכחי</div>
          ${_renderBarChart(vis)}
        </div>
        <div class="pf-chart-card pf-chart-pie">
          <div class="pf-chart-title">חלוקת נכסים</div>
          ${_renderPieChart(vis)}
        </div>
      </div>` +
      _renderTable(vis, ports.length > 1 && _portFilter === 'all') +
      _renderCards(vis);

    _bindEvents(container);
  }

  /* ── Toolbar: portfolio tabs + currency toggle ── */
  function _renderToolbar(ports) {
    const usdActive = _currency === 'USD' ? 'active' : '';
    const ilsActive = _currency === 'ILS' ? 'active' : '';

    const portTabs = ports.length > 1 ? `
      <div class="pf-filter-bar">
        <span class="pf-filter-label">תיק:</span>
        <button class="pf-port-btn${_portFilter === 'all' ? ' active' : ''}" data-port="all">כל התיקים</button>
        ${ports.map(p => `<button class="pf-port-btn${_portFilter === p ? ' active' : ''}" data-port="${p}">${p}</button>`).join('')}
      </div>` : '<div></div>';

    return `
      <div class="pf-toolbar">
        ${portTabs}
        <div class="pf-curr-toggle">
          <span class="pf-toggle-label">תצוגה:</span>
          <button class="pf-curr-btn ${usdActive}" data-curr="USD">$ USD</button>
          <button class="pf-curr-btn ${ilsActive}" data-curr="ILS">₪ ILS</button>
        </div>
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
    const H      = 162, padL = 54, padB = 32, padT = 8;
    const chartH = H - padB - padT;
    const barW   = 20, grpW = 56;
    const yS     = v => padT + chartH - (v / maxVal) * chartH;

    let grid = '', yLbls = '';
    for (let i = 0; i <= 4; i++) {
      const v = (maxVal / 4) * i;
      const y = yS(v);
      const l = v >= 1e6 ? `${sym}${(v/1e6).toFixed(1)}M`
              : v >= 1e3 ? `${sym}${(v/1e3).toFixed(0)}K`
              : `${sym}${v.toFixed(0)}`;
      grid  += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + items.length*grpW + 10}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="0.6"/>`;
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

    const svgW = padL + items.length * grpW + 18;

    return `
      <div class="pf-bar-scroll">
        <svg width="${svgW}" height="${H}" xmlns="http://www.w3.org/2000/svg">
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

  /* ── Holdings Table (desktop) ── */
  function _renderTable(positions, showPort) {
    const sym = currSym();

    const rows = positions.map(p => {
      const price   = toDisplay(p.currentPrice);
      const avgCost = toDisplay(p.avgCost);
      const mktVal  = toDisplay(p.marketValue);
      const pnl     = toDisplay(p.pnl);
      const pnlCls  = p.pnl === null ? '' : p.pnl >= 0 ? 'pos' : 'neg';
      const chgCls  = p.changePercent === null ? '' : p.changePercent >= 0 ? 'pos' : 'neg';

      /* Price cell: bigger font colored by daily direction + % change below */
      const priceCell = price !== null
        ? `<div class="pf-price-cell">
             <span class="pf-price-main ${chgCls}">${sym}${fmtMoney(price)}</span>
             ${p.changePercent !== null
               ? `<span class="pf-price-chg ${chgCls}">${fmtPct(p.changePercent)}</span>`
               : ''}
           </div>`
        : '<span class="pf-td-muted">—</span>';

      /* P&L cell: amount + % stacked */
      const pnlCell = pnl !== null
        ? `<div class="pf-pnl-cell ${pnlCls}">
             <span class="pf-pnl-amt">${p.pnl >= 0 ? '+' : '−'}${sym}${fmtMoney(Math.abs(pnl))}</span>
             <span class="pf-pnl-pct">${fmtPct(p.pnlPct)}</span>
           </div>`
        : '<span class="pf-td-muted">—</span>';

      return `<tr>
        <td><span class="pf-sym-badge">${p.symbol}</span></td>
        ${showPort ? `<td class="pf-td-muted">${p.portfolio}</td>` : ''}
        <td class="pf-td-num">${p.qty.toLocaleString('he-IL', { maximumFractionDigits: 4 })}</td>
        <td>${priceCell}</td>
        <td class="pf-td-num">${avgCost !== null ? `${sym}${fmtMoney(avgCost)}` : '—'}</td>
        <td class="pf-td-num pf-td-bold">${mktVal !== null ? `${sym}${fmtMoney(mktVal)}` : '—'}</td>
        <td>${pnlCell}</td>
      </tr>`;
    }).join('');

    const colspan = showPort ? 8 : 7;
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
          <span class="pf-sym-badge">${p.symbol}</span>
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
            <span class="pf-price-main ${chgCls}" style="font-size:14px">
              ${price !== null ? `${sym}${fmtMoney(price)}` : '—'}
            </span>
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
    container.querySelectorAll('.pf-curr-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        if (btn.dataset.curr === _currency) return;
        _currency = btn.dataset.curr;
        _paint(_container);
      })
    );

    container.querySelectorAll('.pf-port-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        if (btn.dataset.port === _portFilter) return;
        _portFilter = btn.dataset.port;
        _paint(_container);
      })
    );
  }

  return { render };
})();
