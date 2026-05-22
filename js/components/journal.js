/* ===== PAGE: יומן תנועות ===== */

Pages.journal = (() => {

  const PER_PAGE = 50;

  /* ── State ── */
  let _all      = [];   // all rows, enriched + sorted newest-first
  let _filtered = [];   // after current filters
  let _page     = 1;
  let _dateRange   = 'year';    // '30d' | 'quarter' | 'year' | 'all'
  let _catFilter   = 'all';
  let _search      = '';

  /* ── Category visual config ── */
  const CAT = {
    BUY_STOCK:        { label: 'קניה',      color: '#2563EB', bg: 'rgba(37,99,235,0.10)',   svg: '<path d="M12 19V5M5 12l7-7 7 7"/>' },
    SELL_STOCK:       { label: 'מכירה',     color: '#059669', bg: 'rgba(5,150,105,0.10)',   svg: '<path d="M12 5v14M19 12l-7 7-7-7"/>' },
    CASH_DIVIDEND:    { label: 'דיבידנד',   color: '#D97706', bg: 'rgba(217,119,6,0.10)',   svg: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83"/>' },
    INTEREST:         { label: 'ריבית',     color: '#059669', bg: 'rgba(5,150,105,0.10)',   svg: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    DEPOSIT:          { label: 'הפקדה',     color: '#2563EB', bg: 'rgba(37,99,235,0.10)',   svg: '<path d="M12 19V5M5 12l7-7 7 7"/>' },
    FX_CONVERSION:    { label: 'המרה',      color: '#7C3AED', bg: 'rgba(124,58,237,0.10)', svg: '<path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/>' },
    MGMT_FEE:         { label: 'דמי ניהול', color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>' },
    TRADE_COMMISSION: { label: 'עמלה',      color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>' },
    CAPITAL_GAIN_TAX: { label: 'מס רווח',   color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    DIVIDEND_TAX:     { label: 'מס דיב׳',   color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    TAX_PROVISION:    { label: 'מגן מס',    color: '#EA580C', bg: 'rgba(234,88,12,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    TAX_PAYMENT:      { label: 'תשלום מס',  color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    TAX_REFUND:       { label: 'זיכוי מס',  color: '#059669', bg: 'rgba(5,150,105,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    SPLIT:            { label: 'ספליט',     color: '#7C3AED', bg: 'rgba(124,58,237,0.10)', svg: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>' },
    BONUS:            { label: 'בונוס',     color: '#7C3AED', bg: 'rgba(124,58,237,0.10)', svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
    UNKNOWN:          { label: 'לא מסווג', color: '#9CA3AF', bg: 'rgba(156,163,175,0.10)', svg: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
  };

  /* ── Helpers ── */
  const n = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;

  function fmtDate(raw) {
    const d = new Date(raw);
    if (isNaN(d)) return '—';
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`;
  }

  function fmtMoney(val, decimals = 2) {
    if (!isFinite(val) || val === 0) return '—';
    return Math.abs(val).toLocaleString('he-IL', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /* Main amount displayed for a row:
     - Foreign-currency rows: use TotalFX (e.g. stock trades in USD)
     - ILS rows: use TotalILS (e.g. deposits, fees)
     - Tax provisions/payments (TotalFX=0, TotalILS=0): use Qty (face value at par) */
  function getAmount(row) {
    const fx  = n(row.TotalFX);
    const ils = n(row.TotalILS);
    const qty = n(row.Qty);
    const curr = (row.Currency || '₪').trim();

    if (Math.abs(fx)  > 0.001) return { val: fx,   sym: '$'  };
    if (Math.abs(ils) > 0.001) return { val: ils,  sym: '₪'  };
    if (Math.abs(qty) > 0.001) return { val: -qty, sym: '₪'  }; // tax provision/payment
    return { val: 0, sym: curr === '₪' ? '₪' : '$' };
  }

  function amtHTML(val, sym) {
    if (val === 0) return '<span class="amt-neutral">—</span>';
    const cls = val > 0 ? 'amt-positive' : 'amt-negative';
    const sign = val > 0 ? '+' : '−';
    return `<span class="${cls}">${sign}${sym}${fmtMoney(val)}</span>`;
  }

  function catBadge(subCategory) {
    const cfg = CAT[subCategory] || CAT.UNKNOWN;
    return `<span class="cat-badge" style="color:${cfg.color};background:${cfg.bg}">
      <span class="cat-icon">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${cfg.svg}</svg>
      </span>${cfg.label}</span>`;
  }

  /* ── Date filter ── */
  function getRange(key) {
    const now = new Date();
    if (key === '30d') {
      const f = new Date(now); f.setDate(f.getDate() - 30);
      return { from: f, to: now };
    }
    if (key === 'quarter') {
      const f = new Date(now); f.setMonth(f.getMonth() - 3);
      return { from: f, to: now };
    }
    if (key === 'year') {
      return { from: new Date(now.getFullYear(), 0, 1), to: now };
    }
    return null; // all
  }

  function applyFilters() {
    const range = getRange(_dateRange);
    const q     = _search.trim().toLowerCase();

    _filtered = _all.filter(row => {
      // Date
      if (range) {
        const d = new Date(row.Date);
        if (d < range.from || d > range.to) return false;
      }
      // Category
      if (_catFilter !== 'all' && row.subCategory !== _catFilter) return false;
      // Search
      if (q) {
        const inName = (row.Name   || '').toLowerCase().includes(q);
        const inSym  = (row.Symbol || '').toLowerCase().includes(q);
        if (!inName && !inSym) return false;
      }
      return true;
    });

    _page = 1;
  }

  /* ── Render ── */
  function render(container) {
    container.innerHTML = `
      <div class="journal-loading" id="jnl-loading">
        <div class="empty-icon" style="margin:0 auto">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <p style="color:var(--text-muted);font-size:13px;margin-top:8px">טוען תנועות...</p>
      </div>
      <div id="jnl-body" style="display:none"></div>`;

    _loadData();
  }

  async function _loadData() {
    try {
      App.setDataStatus('loading');
      const raw = await DataService.getTransactions();
      _all = Classifier.enrichAll(raw).sort((a, b) => new Date(b.Date) - new Date(a.Date));
      applyFilters();
      App.setDataStatus('live');

      const loading = document.getElementById('jnl-loading');
      const body    = document.getElementById('jnl-body');
      if (loading) loading.style.display = 'none';
      if (body)    { body.style.display = 'block'; _paint(body); }
    } catch (err) {
      App.setDataStatus('error');
      console.error('Journal error:', err);
    }
  }

  function _paint(container) {
    const totalPages = Math.ceil(_filtered.length / PER_PAGE);
    const slice      = _filtered.slice((_page - 1) * PER_PAGE, _page * PER_PAGE);

    // Unique subCategories for filter dropdown
    const cats = [...new Set(_all.map(r => r.subCategory))].sort();

    container.innerHTML = `
      <!-- Filters -->
      <div class="journal-filters">
        <div class="date-filter-group">
          ${['30d','quarter','year','all'].map((k,i) => {
            const labels = ['30 יום','רבעון','שנה שוטפת','הכל'];
            return `<button class="date-filter-btn${_dateRange===k?' active':''}" data-range="${k}">${labels[i]}</button>`;
          }).join('')}
        </div>

        <div class="journal-search">
          <span class="search-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </span>
          <input type="text" id="jnl-search" placeholder="חפש סימבול או שם..." value="${_search}" />
        </div>

        <select class="journal-cat-select" id="jnl-cat">
          <option value="all">כל הקטגוריות</option>
          ${cats.map(c => {
            const lbl = (CAT[c] || CAT.UNKNOWN).label;
            return `<option value="${c}"${_catFilter===c?' selected':''}>${lbl}</option>`;
          }).join('')}
        </select>
      </div>

      <!-- Meta -->
      <div class="journal-meta">
        <span><strong>${_filtered.length.toLocaleString('he-IL')}</strong> תנועות</span>
        ${_filtered.length !== _all.length ? `<span>מתוך ${_all.length.toLocaleString('he-IL')} סה"כ</span>` : ''}
        ${totalPages > 1 ? `<span>עמוד ${_page} מתוך ${totalPages}</span>` : ''}
      </div>

      <!-- Table -->
      <div class="journal-table-wrap">
        <table class="journal-table">
          <thead>
            <tr>
              <th class="col-num">#</th>
              <th class="col-date">תאריך</th>
              <th class="col-cat">קטגוריה</th>
              <th>תיאור</th>
              <th class="col-sym">סימבול</th>
              <th class="col-qty">כמות</th>
              <th class="col-comm">עמלה</th>
              <th class="col-tax">מס</th>
              <th class="col-amt">סכום</th>
            </tr>
          </thead>
          <tbody>
            ${slice.length ? slice.map((row, i) => _row(row, (_page-1)*PER_PAGE + i + 1)).join('') :
              `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted)">אין תנועות לתקופה הזו</td></tr>`}
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      ${totalPages > 1 ? _pagination(totalPages) : ''}`;

    _bind(container);
  }

  function _row(row, idx) {
    const { val, sym } = getAmount(row);
    const comm = n(row.Commission);
    const tax  = n(row.EstimatedTax);
    const qty  = n(row.Qty);

    // Only show symbol if it looks like a real ticker
    const isTicker = /^[A-Z]{1,5}$/.test((row.Symbol || '').trim());
    const symDisplay = isTicker ? row.Symbol : '—';

    // Qty: only for stock trades
    const showQty = ['BUY_STOCK','SELL_STOCK','SPLIT','BONUS'].includes(row.subCategory);

    return `<tr>
      <td class="col-num">${idx}</td>
      <td class="col-date">${fmtDate(row.Date)}</td>
      <td class="col-cat">${catBadge(row.subCategory)}</td>
      <td class="col-desc" title="${(row.Name||'').replace(/"/g,'&quot;')}">${row.Name || '—'}</td>
      <td class="col-sym">${symDisplay}</td>
      <td class="col-qty">${showQty && qty ? qty.toLocaleString('he-IL', {maximumFractionDigits:4}) : '—'}</td>
      <td class="col-comm">${comm > 0 ? `<span style="color:var(--danger)">−${sym}${fmtMoney(comm)}</span>` : '—'}</td>
      <td class="col-tax">${tax > 0 ? `<span style="color:var(--danger)">−₪${fmtMoney(tax)}</span>` : '—'}</td>
      <td class="col-amt">${amtHTML(val, sym)}</td>
    </tr>`;
  }

  function _pagination(totalPages) {
    const MAX_VISIBLE = 7;
    let pages = [];

    if (totalPages <= MAX_VISIBLE) {
      pages = Array.from({length: totalPages}, (_, i) => i + 1);
    } else {
      pages = [1];
      if (_page > 3) pages.push('…');
      for (let p = Math.max(2, _page-1); p <= Math.min(totalPages-1, _page+1); p++) pages.push(p);
      if (_page < totalPages - 2) pages.push('…');
      pages.push(totalPages);
    }

    return `<div class="journal-pagination">
      <button class="pg-btn" data-pg="${_page-1}" ${_page===1?'disabled':''}>‹</button>
      ${pages.map(p => p === '…'
        ? `<span class="pg-btn" style="border:none;cursor:default">…</span>`
        : `<button class="pg-btn${p===_page?' active':''}" data-pg="${p}">${p}</button>`
      ).join('')}
      <button class="pg-btn" data-pg="${_page+1}" ${_page===totalPages?'disabled':''}>›</button>
    </div>`;
  }

  function _bind(container) {
    // Date range buttons
    container.querySelectorAll('.date-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _dateRange = btn.dataset.range;
        applyFilters();
        _paint(container);
      });
    });

    // Search
    const searchEl = container.querySelector('#jnl-search');
    if (searchEl) {
      let debounce;
      searchEl.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          _search = searchEl.value;
          applyFilters();
          _paint(container);
        }, 280);
      });
    }

    // Category select
    const catEl = container.querySelector('#jnl-cat');
    if (catEl) {
      catEl.addEventListener('change', () => {
        _catFilter = catEl.value;
        applyFilters();
        _paint(container);
      });
    }

    // Pagination
    container.querySelectorAll('.pg-btn[data-pg]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.pg);
        const max = Math.ceil(_filtered.length / PER_PAGE);
        if (p < 1 || p > max || p === _page) return;
        _page = p;
        _paint(container);
        container.closest('#content')?.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  return { render };
})();
