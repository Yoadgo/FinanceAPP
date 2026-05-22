/* ===== PAGE: יומן תנועות ===== */

Pages.journal = (() => {

  const PER_PAGE = 50;

  /* ── State ── */
  let _all        = [];
  let _filtered   = [];
  let _page       = 1;
  let _dateRange  = 'year';
  let _catFilter  = 'all';   // 'all' | 'cat:TAXES' (parent) | 'CAPITAL_GAIN_TAX' (sub)
  let _portFilter = 'all';
  let _search     = '';
  let _sortField  = 'date';  // 'date' | 'amount'
  let _sortDir    = 'desc';  // 'asc'  | 'desc'

  /* ── Sub-category visual config ── */
  const CAT = {
    // Stocks
    BUY_STOCK:        { label: 'קניה',          color: '#2563EB', bg: 'rgba(37,99,235,0.10)',   svg: '<path d="M12 19V5M5 12l7-7 7 7"/>' },
    SELL_STOCK:       { label: 'מכירה',         color: '#059669', bg: 'rgba(5,150,105,0.10)',   svg: '<path d="M12 5v14M19 12l-7 7-7-7"/>' },
    // Cash & dividends & corporate actions
    CASH_DIVIDEND:    { label: 'דיבידנד',       color: '#D97706', bg: 'rgba(217,119,6,0.10)',   svg: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83"/>' },
    DEPOSIT:          { label: 'הפקדה',         color: '#2563EB', bg: 'rgba(37,99,235,0.10)',   svg: '<path d="M12 19V5M5 12l7-7 7 7"/>' },
    FX_CONVERSION:    { label: 'המרת מט"ח',     color: '#7C3AED', bg: 'rgba(124,58,237,0.10)', svg: '<path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/>' },
    SPLIT:            { label: 'ספליט',         color: '#7C3AED', bg: 'rgba(124,58,237,0.10)', svg: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>' },
    BONUS:            { label: 'בונוס',         color: '#7C3AED', bg: 'rgba(124,58,237,0.10)', svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
    // Interest (credit only)
    CREDIT_INTEREST:  { label: 'ריבית זכות',    color: '#059669', bg: 'rgba(5,150,105,0.10)',   svg: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    // Fees (debit interest is a cost = fee)
    MGMT_FEE:         { label: 'דמי ניהול',     color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>' },
    TRADE_COMMISSION: { label: 'עמלה',          color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>' },
    DEBIT_INTEREST:   { label: 'ריבית חובה',    color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    // Taxes
    CAPITAL_GAIN_TAX: { label: 'מס רווח הון',   color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    DIVIDEND_TAX:     { label: 'מס דיבידנד',    color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    TAX_PROVISION:    { label: 'עתודת מס',      color: '#EA580C', bg: 'rgba(234,88,12,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    TAX_PAYMENT:      { label: 'תשלום מס',      color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    TAX_REFUND:       { label: 'זיכוי מס',      color: '#059669', bg: 'rgba(5,150,105,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    // Fallback
    UNKNOWN:          { label: 'לא מסווג',      color: '#9CA3AF', bg: 'rgba(156,163,175,0.10)', svg: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
  };

  /* ── Parent-category groups (display order, filter structure) ──
     "cat:KEY" filters by row.category === KEY.
     subs[] lists which subCategories belong here in the UI.          */
  const CAT_GROUPS = [
    { key: 'STOCKS',       label: 'מניות',            subs: ['BUY_STOCK', 'SELL_STOCK'] },
    { key: 'TAXES',        label: 'מיסים',            subs: ['CAPITAL_GAIN_TAX', 'DIVIDEND_TAX', 'TAX_PROVISION', 'TAX_PAYMENT', 'TAX_REFUND'] },
    { key: 'INTEREST',     label: 'ריביות',           subs: ['CREDIT_INTEREST'] },
    { key: 'CASH',         label: 'מזומן ותזרים',     subs: ['DEPOSIT', 'CASH_DIVIDEND', 'FX_CONVERSION', 'SPLIT', 'BONUS'] },
    { key: 'FEES',         label: 'עמלות ודמי ניהול', subs: ['MGMT_FEE', 'TRADE_COMMISSION', 'DEBIT_INTEREST'] },
    { key: 'UNCLASSIFIED', label: 'לא מסווג',         subs: ['UNKNOWN'] },
  ];

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
      maximumFractionDigits: decimals,
    });
  }

  /* ── Which parent group is currently active ── */
  function getActiveCatGroup() {
    if (_catFilter === 'all') return null;
    if (_catFilter.startsWith('cat:')) return _catFilter.slice(4);
    const g = CAT_GROUPS.find(g => g.subs.includes(_catFilter));
    return g ? g.key : null;
  }

  /* ── Human-readable description ── */
  function generateDescription(row) {
    const sym  = (row.Symbol || '').trim();
    const name = (row.Name   || '').trim();
    const qty  = n(row.Qty);

    switch (row.subCategory) {
      case 'BUY_STOCK':       return `קניית מניה${sym ? ' — ' + sym : ''}`;
      case 'SELL_STOCK':      return `מכירת מניה${sym ? ' — ' + sym : ''}`;
      case 'CASH_DIVIDEND':   return `דיבידנד${sym ? ' מ-' + sym : ''}`;
      case 'CREDIT_INTEREST': return 'זיכוי ריבית';
      case 'DEBIT_INTEREST':  return 'חיוב ריבית חובה';
      case 'DEPOSIT':         return 'הפקדת מזומן מהבנק';
      case 'FX_CONVERSION': {
        const buying = name.toUpperCase().startsWith('B ');
        const dir    = buying ? 'המרת שקל ← דולר' : 'המרת דולר ← שקל';
        const rate   = name.match(/[\d.]+$/);
        return rate ? `${dir}  (${rate[0]})` : dir;
      }
      case 'MGMT_FEE':        return 'דמי ניהול תיק';
      case 'CAPITAL_GAIN_TAX':return `ניכוי מס רווח הון במקור${sym ? ' — ' + sym : ''}`;
      case 'DIVIDEND_TAX':    return `ניכוי מס דיבידנד במקור${sym ? ' — ' + sym : ''}`;
      case 'TAX_PROVISION':   return 'הפקדה לקרן מגן מס (עתודת מס)';
      case 'TAX_PAYMENT':     return 'תשלום מס לרשות המיסים';
      case 'TAX_REFUND':      return 'זיכוי / החזר מס';
      case 'SPLIT': {
        const shares = qty ? ` (+${qty.toLocaleString('he-IL', {maximumFractionDigits:0})} מניות)` : '';
        return `פיצול מניות${sym ? ' — ' + sym : ''}${shares}`;
      }
      case 'BONUS':           return `בונוס מניות${sym ? ' — ' + sym : ''}`;
      default:                return name || '—';
    }
  }

  /* ── Amount logic ── */
  function getAmount(row) {
    const fx  = n(row.TotalFX);
    const ils = n(row.TotalILS);
    const qty = n(row.Qty);
    const curr = (row.Currency || '₪').toString().trim();

    if (row.subCategory === 'SPLIT')
      return { val: 0, sym: '', style: 'split' };
    if (Math.abs(fx)  > 0.001) return { val: fx,  sym: '$' };
    if (Math.abs(ils) > 0.001) return { val: ils, sym: '₪' };
    if (row.subCategory === 'TAX_PROVISION')
      return { val: qty, sym: '₪', style: 'neutral' };
    if (Math.abs(qty) > 0.001) return { val: -qty, sym: '₪' };
    return { val: 0, sym: curr === '₪' ? '₪' : '$' };
  }

  function amtHTML(val, sym, style) {
    if (style === 'split')   return '<span class="amt-neutral" title="ספליט — אין ערך כספי">—</span>';
    if (val === 0)           return '<span class="amt-neutral">—</span>';
    if (style === 'neutral') return `<span class="amt-neutral">${sym}${fmtMoney(Math.abs(val))}</span>`;
    const cls  = val > 0 ? 'amt-positive' : 'amt-negative';
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

  /* ── Date range helper ── */
  function getRange(key) {
    const now = new Date();
    if (key === '30d')     { const f = new Date(now); f.setDate(f.getDate() - 30);  return { from: f, to: now }; }
    if (key === 'quarter') { const f = new Date(now); f.setMonth(f.getMonth() - 3); return { from: f, to: now }; }
    if (key === 'year')    { return { from: new Date(now.getFullYear(), 0, 1), to: now }; }
    return null;
  }

  /* ── Filter + Sort ── */
  function applyFilters() {
    const range = getRange(_dateRange);
    const q     = _search.trim().toLowerCase();

    _filtered = _all.filter(row => {
      // Date
      if (range) {
        const d = new Date(row.Date);
        if (d < range.from || d > range.to) return false;
      }
      // Category ('all' | 'cat:KEY' parent | 'SUBCAT' sub)
      if (_catFilter !== 'all') {
        if (_catFilter.startsWith('cat:')) {
          if (row.category !== _catFilter.slice(4)) return false;
        } else {
          if (row.subCategory !== _catFilter) return false;
        }
      }
      // Portfolio
      if (_portFilter !== 'all' && row.Portfolio !== _portFilter) return false;
      // Search
      if (q) {
        const inName = (row.Name   || '').toLowerCase().includes(q);
        const inSym  = (row.Symbol || '').toLowerCase().includes(q);
        if (!inName && !inSym) return false;
      }
      return true;
    });

    // Sort
    _filtered.sort((a, b) => {
      let diff = 0;
      if (_sortField === 'date') {
        diff = new Date(b.Date) - new Date(a.Date);
      } else if (_sortField === 'amount') {
        diff = Math.abs(getAmount(b).val) - Math.abs(getAmount(a).val);
      }
      return _sortDir === 'asc' ? -diff : diff;
    });

    _page = 1;
  }

  /* ── Render entry point ── */
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
      App.setDataStatus('error', err.message);
      console.error('Journal error:', err);
      const loading = document.getElementById('jnl-loading');
      if (loading) {
        loading.innerHTML = `
          <div class="empty-icon" style="margin:0 auto;background:rgba(217,48,37,0.08)">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <p style="color:var(--danger);font-size:13px;margin-top:10px;font-weight:600">שגיאה בטעינת הנתונים</p>
          <p style="color:var(--text-muted);font-size:12px;margin-top:4px;max-width:340px;text-align:center;line-height:1.5">${err.message}</p>`;
      }
    }
  }

  /* ── Build filter bar HTML ── */
  function _filterBarHTML() {
    const activeCatGroup = getActiveCatGroup();
    const presentCats    = new Set(_all.map(r => r.category));
    const presentSubs    = new Set(_all.map(r => r.subCategory));
    const ports          = [...new Set(_all.map(r => r.Portfolio).filter(Boolean))].sort();

    // ── Sort direction arrows
    const sortArrow = field => _sortField === field ? (_sortDir === 'desc' ? ' ↓' : ' ↑') : '';

    // ── Row 1: Date buttons + Search + Sort
    const row1 = `
      <div class="journal-filters">
        <div class="date-filter-group">
          ${['30d','quarter','year','all'].map((k, i) => {
            const labels = ['30 יום', 'רבעון', 'שנה שוטפת', 'הכל'];
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

        <div class="sort-group">
          <span class="sort-label">מיין:</span>
          <button class="sort-btn${_sortField==='date'?' active':''}" data-sort="date">תאריך${sortArrow('date')}</button>
          <button class="sort-btn${_sortField==='amount'?' active':''}" data-sort="amount">סכום${sortArrow('amount')}</button>
        </div>
      </div>`;

    // ── Row 2: Category parent buttons
    const catBtns = CAT_GROUPS
      .filter(g => presentCats.has(g.key))
      .map(g => `<button class="filter-btn${activeCatGroup===g.key?' active':''}" data-cat="cat:${g.key}">${g.label}</button>`)
      .join('');

    const row2 = `
      <div class="filter-btn-row" style="margin-bottom:${activeCatGroup ? 4 : 8}px">
        <button class="filter-btn${_catFilter==='all'?' active':''}" data-cat="all">הכל</button>
        ${catBtns}
      </div>`;

    // ── Row 2b: Sub-category buttons (only when a parent is selected)
    const activeGroup  = CAT_GROUPS.find(g => g.key === activeCatGroup);
    const availableSubs = activeGroup
      ? activeGroup.subs.filter(s => presentSubs.has(s))
      : [];
    const row2b = availableSubs.length > 0 ? `
      <div class="filter-btn-row subcat-row">
        ${availableSubs.map(s =>
          `<button class="filter-btn filter-btn-sub${_catFilter===s?' active':''}" data-subcat="${s}">${(CAT[s]||CAT.UNKNOWN).label}</button>`
        ).join('')}
      </div>` : '';

    // ── Row 3: Portfolio buttons (only if multiple portfolios exist)
    const row3 = ports.length > 1 ? `
      <div class="filter-btn-row port-row">
        <span class="sort-label">תיק:</span>
        <button class="filter-btn${_portFilter==='all'?' active':''}" data-port="all">כל התיקים</button>
        ${ports.map(p =>
          `<button class="filter-btn${_portFilter===p?' active':''}" data-port="${p}">${p}</button>`
        ).join('')}
      </div>` : '';

    return row1 + row2 + row2b + row3;
  }

  function _paint(container) {
    const totalPages = Math.ceil(_filtered.length / PER_PAGE);
    const slice      = _filtered.slice((_page - 1) * PER_PAGE, _page * PER_PAGE);

    container.innerHTML = `
      <!-- ── Sticky filter bar ── -->
      <div class="journal-sticky-bar">
        ${_filterBarHTML()}

        <!-- Stats row -->
        <div class="journal-meta">
          <span><strong>${_filtered.length.toLocaleString('he-IL')}</strong> תנועות</span>
          ${_filtered.length !== _all.length ? `<span>מתוך ${_all.length.toLocaleString('he-IL')} סה"כ</span>` : ''}
          ${_portFilter !== 'all' ? `<span>תיק: <strong>${_portFilter}</strong></span>` : ''}
          ${totalPages > 1 ? `<span>עמוד ${_page} מתוך ${totalPages}</span>` : ''}
        </div>
      </div>

      <!-- ── Table ── -->
      <div class="journal-table-wrap">
        <table class="journal-table">
          <thead>
            <tr>
              <th class="col-num">#</th>
              <th class="col-date">תאריך</th>
              <th class="col-cat">קטגוריה</th>
              <th class="col-sym">סימבול</th>
              <th class="col-port">תיק</th>
              <th class="col-qty">כמות</th>
              <th class="col-comm">עמלה</th>
              <th class="col-tax">מס</th>
              <th class="col-amt">סכום</th>
              <th class="col-desc">תיאור</th>
            </tr>
          </thead>
          <tbody>
            ${slice.length
              ? slice.map((row, i) => _row(row, (_page - 1) * PER_PAGE + i + 1)).join('')
              : `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">אין תנועות לתקופה הזו</td></tr>`}
          </tbody>
        </table>
      </div>

      ${totalPages > 1 ? _pagination(totalPages) : ''}`;

    _bind(container);
  }

  function _row(row, idx) {
    const { val, sym, style } = getAmount(row);
    const comm = n(row.Commission);
    const tax  = n(row.EstimatedTax);
    const qty  = n(row.Qty);

    const isTicker   = /^[A-Z]{1,5}$/.test((row.Symbol || '').toString().trim());
    const symDisplay = isTicker ? row.Symbol : '—';
    const showQty    = ['BUY_STOCK', 'SELL_STOCK', 'SPLIT', 'BONUS'].includes(row.subCategory);
    const commSym    = sym || '₪';

    return `<tr>
      <td class="col-num">${idx}</td>
      <td class="col-date">${fmtDate(row.Date)}</td>
      <td class="col-cat">${catBadge(row.subCategory)}</td>
      <td class="col-sym">${symDisplay}</td>
      <td class="col-port">${(row.Portfolio || '—').trim()}</td>
      <td class="col-qty">${showQty && qty ? qty.toLocaleString('he-IL', { maximumFractionDigits: 4 }) : '—'}</td>
      <td class="col-comm">${comm > 0 ? `<span style="color:var(--danger)">−${commSym}${fmtMoney(comm)}</span>` : '—'}</td>
      <td class="col-tax">${tax  > 0 ? `<span style="color:var(--danger)">−₪${fmtMoney(tax)}</span>`          : '—'}</td>
      <td class="col-amt">${amtHTML(val, sym, style)}</td>
      <td class="col-desc" title="${(row.Name || '').replace(/"/g, '&quot;')}">${generateDescription(row)}</td>
    </tr>`;
  }

  function _pagination(totalPages) {
    const MAX = 7;
    let pages = [];
    if (totalPages <= MAX) {
      pages = Array.from({ length: totalPages }, (_, i) => i + 1);
    } else {
      pages = [1];
      if (_page > 3) pages.push('…');
      for (let p = Math.max(2, _page-1); p <= Math.min(totalPages-1, _page+1); p++) pages.push(p);
      if (_page < totalPages - 2) pages.push('…');
      pages.push(totalPages);
    }
    return `<div class="journal-pagination">
      <button class="pg-btn" data-pg="${_page-1}" ${_page===1?'disabled':''}>‹</button>
      ${pages.map(p => p==='…'
        ? `<span class="pg-btn" style="border:none;cursor:default">…</span>`
        : `<button class="pg-btn${p===_page?' active':''}" data-pg="${p}">${p}</button>`
      ).join('')}
      <button class="pg-btn" data-pg="${_page+1}" ${_page===totalPages?'disabled':''}>›</button>
    </div>`;
  }

  function _bind(container) {
    // Date range
    container.querySelectorAll('.date-filter-btn').forEach(btn =>
      btn.addEventListener('click', () => { _dateRange = btn.dataset.range; applyFilters(); _paint(container); })
    );

    // Search (debounced)
    const searchEl = container.querySelector('#jnl-search');
    if (searchEl) {
      let t;
      searchEl.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { _search = searchEl.value; applyFilters(); _paint(container); }, 280);
      });
    }

    // Category parent buttons
    container.querySelectorAll('[data-cat]').forEach(btn =>
      btn.addEventListener('click', () => { _catFilter = btn.dataset.cat; applyFilters(); _paint(container); })
    );

    // Sub-category buttons
    container.querySelectorAll('[data-subcat]').forEach(btn =>
      btn.addEventListener('click', () => { _catFilter = btn.dataset.subcat; applyFilters(); _paint(container); })
    );

    // Portfolio buttons
    container.querySelectorAll('[data-port]').forEach(btn =>
      btn.addEventListener('click', () => { _portFilter = btn.dataset.port; applyFilters(); _paint(container); })
    );

    // Sort buttons — click active → reverse direction; click inactive → activate (desc)
    container.querySelectorAll('[data-sort]').forEach(btn =>
      btn.addEventListener('click', () => {
        const f = btn.dataset.sort;
        if (f === _sortField) { _sortDir = _sortDir === 'desc' ? 'asc' : 'desc'; }
        else                  { _sortField = f; _sortDir = 'desc'; }
        applyFilters(); _paint(container);
      })
    );

    // Pagination
    container.querySelectorAll('.pg-btn[data-pg]').forEach(btn =>
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.pg);
        const max = Math.ceil(_filtered.length / PER_PAGE);
        if (p < 1 || p > max || p === _page) return;
        _page = p;
        _paint(container);
        container.closest('#content')?.scrollTo({ top: 0, behavior: 'smooth' });
      })
    );
  }

  return { render };
})();
