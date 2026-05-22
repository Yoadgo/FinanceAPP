/* ===== PAGE: יומן תנועות ===== */

Pages.journal = (() => {

  /* ── State ── */
  let _all        = [];
  let _filtered   = [];
  let _dateRange  = 'year';
  let _portFilter = 'all';
  let _search     = '';
  let _colFilters = {};     // { parentCat: Set|null, subCategory: Set|null, symbol: Set|null }
  let _sortField  = 'date';
  let _sortDir    = 'desc';
  let _container  = null;   // ref to #jnl-body, kept for popup callbacks
  let _popupEl    = null;   // singleton filter popup div
  let _popupCol   = null;   // which column's popup is open

  /* ── Parent-category config ── */
  const PARENT_CAT = {
    STOCKS:       { label: 'מניות',    color: '#2563EB', bg: 'rgba(37,99,235,0.09)'  },
    CASH:         { label: 'מזומן',    color: '#7C3AED', bg: 'rgba(124,58,237,0.09)' },
    INTEREST:     { label: 'ריביות',   color: '#059669', bg: 'rgba(5,150,105,0.09)'  },
    FEES:         { label: 'עמלות',    color: '#DC2626', bg: 'rgba(220,38,38,0.09)'  },
    TAXES:        { label: 'מיסים',    color: '#EA580C', bg: 'rgba(234,88,12,0.09)'  },
    UNCLASSIFIED: { label: 'לא מסווג', color: '#9CA3AF', bg: 'rgba(156,163,175,0.09)'},
  };

  /* ── Sub-category visual config ── */
  const CAT = {
    BUY_STOCK:        { label: 'קניה',          color: '#2563EB', bg: 'rgba(37,99,235,0.10)',   svg: '<path d="M12 19V5M5 12l7-7 7 7"/>' },
    SELL_STOCK:       { label: 'מכירה',         color: '#059669', bg: 'rgba(5,150,105,0.10)',   svg: '<path d="M12 5v14M19 12l-7 7-7-7"/>' },
    CASH_DIVIDEND:    { label: 'דיבידנד',       color: '#D97706', bg: 'rgba(217,119,6,0.10)',   svg: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83"/>' },
    DEPOSIT:          { label: 'הפקדה',         color: '#2563EB', bg: 'rgba(37,99,235,0.10)',   svg: '<path d="M12 19V5M5 12l7-7 7 7"/>' },
    FX_CONVERSION:    { label: 'המרת מט"ח',     color: '#7C3AED', bg: 'rgba(124,58,237,0.10)', svg: '<path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/>' },
    SPLIT:            { label: 'ספליט',         color: '#7C3AED', bg: 'rgba(124,58,237,0.10)', svg: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>' },
    BONUS:            { label: 'בונוס',         color: '#7C3AED', bg: 'rgba(124,58,237,0.10)', svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
    CREDIT_INTEREST:  { label: 'ריבית זכות',    color: '#059669', bg: 'rgba(5,150,105,0.10)',   svg: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    MGMT_FEE:         { label: 'דמי ניהול',     color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>' },
    TRADE_COMMISSION: { label: 'עמלה',          color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>' },
    DEBIT_INTEREST:   { label: 'ריבית חובה',    color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    CAPITAL_GAIN_TAX: { label: 'מס רווח הון',   color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    DIVIDEND_TAX:     { label: 'מס דיבידנד',    color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    TAX_PROVISION:    { label: 'עתודת מס',      color: '#EA580C', bg: 'rgba(234,88,12,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    TAX_PAYMENT:      { label: 'תשלום מס',      color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    TAX_REFUND:       { label: 'זיכוי מס',      color: '#059669', bg: 'rgba(5,150,105,0.10)',   svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    UNKNOWN:          { label: 'לא מסווג',      color: '#9CA3AF', bg: 'rgba(156,163,175,0.10)', svg: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
  };

  /* ── Helpers ── */
  const n = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;
  const hasFilter = col => _colFilters[col] && _colFilters[col].size > 0;

  function fmtDate(raw) {
    const d = new Date(raw);
    if (isNaN(d)) return '—';
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`;
  }

  function fmtMoney(val, decimals = 2) {
    if (!isFinite(val) || val === 0) return '—';
    return Math.abs(val).toLocaleString('he-IL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function getRange(key) {
    const now = new Date();
    if (key === '30d')     { const f = new Date(now); f.setDate(f.getDate() - 30);  return { from: f, to: now }; }
    if (key === 'quarter') { const f = new Date(now); f.setMonth(f.getMonth() - 3); return { from: f, to: now }; }
    if (key === 'year')    { return { from: new Date(now.getFullYear(), 0, 1), to: now }; }
    return null;
  }

  /* ── Amount logic ── */
  function getAmount(row) {
    const fx  = n(row.TotalFX);
    const ils = n(row.TotalILS);
    const qty = n(row.Qty);
    const curr = (row.Currency || '₪').toString().trim();
    if (row.subCategory === 'SPLIT')          return { val: 0,    sym: '',  style: 'split'   };
    if (Math.abs(fx)  > 0.001)               return { val: fx,   sym: '$'                   };
    if (Math.abs(ils) > 0.001)               return { val: ils,  sym: '₪'                   };
    if (row.subCategory === 'TAX_PROVISION')  return { val: qty,  sym: '₪', style: 'neutral' };
    if (Math.abs(qty) > 0.001)               return { val: -qty, sym: '₪'                   };
    return { val: 0, sym: curr === '₪' ? '₪' : '$' };
  }

  function amtHTML(val, sym, style) {
    if (style === 'split')   return '<span class="amt-neutral" title="ספליט — אין ערך כספי">—</span>';
    if (val === 0)           return '<span class="amt-neutral">—</span>';
    if (style === 'neutral') return `<span class="amt-neutral">${sym}${fmtMoney(Math.abs(val))}</span>`;
    const cls = val > 0 ? 'amt-positive' : 'amt-negative';
    return `<span class="${cls}">${val>0?'+':'−'}${sym}${fmtMoney(val)}</span>`;
  }

  function parentBadge(category) {
    const cfg = PARENT_CAT[category] || PARENT_CAT.UNCLASSIFIED;
    return `<span class="parent-badge" style="color:${cfg.color};background:${cfg.bg}">${cfg.label}</span>`;
  }

  function catBadge(sub) {
    const cfg = CAT[sub] || CAT.UNKNOWN;
    return `<span class="cat-badge" style="color:${cfg.color};background:${cfg.bg}">
      <span class="cat-icon"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${cfg.svg}</svg></span>${cfg.label}</span>`;
  }

  function generateDescription(row) {
    const sym  = (row.Symbol || '').trim();
    const name = (row.Name   || '').trim();
    const qty  = n(row.Qty);
    switch (row.subCategory) {
      case 'BUY_STOCK':       return `קניית מניה${sym?' — '+sym:''}`;
      case 'SELL_STOCK':      return `מכירת מניה${sym?' — '+sym:''}`;
      case 'CASH_DIVIDEND':   return `דיבידנד${sym?' מ-'+sym:''}`;
      case 'CREDIT_INTEREST': return 'זיכוי ריבית';
      case 'DEBIT_INTEREST':  return 'חיוב ריבית חובה';
      case 'DEPOSIT':         return 'הפקדת מזומן מהבנק';
      case 'FX_CONVERSION': {
        const dir  = name.toUpperCase().startsWith('B ') ? 'המרת שקל ← דולר' : 'המרת דולר ← שקל';
        const rate = name.match(/[\d.]+$/);
        return rate ? `${dir} (${rate[0]})` : dir;
      }
      case 'MGMT_FEE':         return 'דמי ניהול תיק';
      case 'CAPITAL_GAIN_TAX': return `ניכוי מס רווח הון במקור${sym?' — '+sym:''}`;
      case 'DIVIDEND_TAX':     return `ניכוי מס דיבידנד במקור${sym?' — '+sym:''}`;
      case 'TAX_PROVISION':    return 'הפקדה לקרן מגן מס (עתודת מס)';
      case 'TAX_PAYMENT':      return 'תשלום מס לרשות המיסים';
      case 'TAX_REFUND':       return 'זיכוי / החזר מס';
      case 'SPLIT': {
        const shares = qty ? ` (+${qty.toLocaleString('he-IL',{maximumFractionDigits:0})} מניות)` : '';
        return `פיצול מניות${sym?' — '+sym:''}${shares}`;
      }
      case 'BONUS':            return `בונוס מניות${sym?' — '+sym:''}`;
      default:                 return name || '—';
    }
  }

  /* ── Filter + Sort ── */
  function applyFilters() {
    const range = getRange(_dateRange);
    const q     = _search.trim().toLowerCase();

    _filtered = _all.filter(row => {
      // Date range
      if (range) { const d = new Date(row.Date); if (d < range.from || d > range.to) return false; }
      // Portfolio
      if (_portFilter !== 'all' && row.Portfolio !== _portFilter) return false;
      // Column filters
      if (hasFilter('parentCat')   && !_colFilters.parentCat.has(row.category))      return false;
      if (hasFilter('subCategory') && !_colFilters.subCategory.has(row.subCategory)) return false;
      if (hasFilter('symbol')      && !_colFilters.symbol.has(row.Symbol))            return false;
      // Search
      if (q) {
        const sym  = (row.Symbol || '').toLowerCase();
        const desc = generateDescription(row).toLowerCase();
        const name = (row.Name   || '').toLowerCase();
        if (!sym.includes(q) && !desc.includes(q) && !name.includes(q)) return false;
      }
      return true;
    });

    _filtered.sort((a, b) => {
      let d = 0;
      if      (_sortField === 'date')        d = new Date(b.Date) - new Date(a.Date);
      else if (_sortField === 'parentCat')   d = (a.category||'').localeCompare(b.category||'', 'he');
      else if (_sortField === 'subCategory') d = ((CAT[a.subCategory]||CAT.UNKNOWN).label).localeCompare((CAT[b.subCategory]||CAT.UNKNOWN).label, 'he');
      else if (_sortField === 'symbol')      d = (a.Symbol||'').localeCompare(b.Symbol||'');
      else if (_sortField === 'amount')      d = Math.abs(getAmount(b).val) - Math.abs(getAmount(a).val);
      else if (_sortField === 'qty')         d = n(b.Qty) - n(a.Qty);
      return _sortDir === 'asc' ? -d : d;
    });
  }

  /* ── SVG icons for sort state ── */
  function _sortSVG(col) {
    if (_sortField !== col)
      return `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 15l5 5 5-5M7 9l5-5 5 5"/></svg>`;
    return _sortDir === 'desc'
      ? `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 10l5 10 5-10"/></svg>`
      : `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 14l5-10 5 10"/></svg>`;
  }

  function _filterSVG(col) {
    const active = hasFilter(col);
    return `<button class="th-filter-btn${active?' th-filter-active':''}" data-filter-col="${col}" title="סנן">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
      </svg>
    </button>`;
  }

  /* Build a <th> with optional sort + optional filter buttons */
  function _th(label, cls, sortCol, filterCol) {
    const inner = sortCol
      ? `<div class="th-inner">
           <button class="th-sort-btn${_sortField===sortCol?' th-sort-active':''}" data-sort-col="${sortCol}">${label}${_sortSVG(sortCol)}</button>
           ${filterCol ? _filterSVG(filterCol) : ''}
         </div>`
      : label;
    return `<th class="${cls}">${inner}</th>`;
  }

  /* ── Popup data for each filterable column ── */
  function _popupData(col) {
    if (col === 'parentCat') {
      return [...new Set(_all.map(r => r.category))].sort()
        .map(c => ({ value: c, label: (PARENT_CAT[c] || PARENT_CAT.UNCLASSIFIED).label }));
    }
    if (col === 'subCategory') {
      return [...new Set(_all.map(r => r.subCategory))].sort()
        .map(s => ({ value: s, label: (CAT[s] || CAT.UNKNOWN).label }));
    }
    if (col === 'symbol') {
      return [...new Set(_all.map(r => r.Symbol).filter(s => /^[A-Z]{1,5}$/.test(s)))].sort()
        .map(s => ({ value: s, label: s }));
    }
    return [];
  }

  /* ── Singleton popup element ── */
  function _getPopup() {
    if (_popupEl) return _popupEl;
    _popupEl = document.createElement('div');
    _popupEl.id = 'jnl-col-popup';
    _popupEl.className = 'col-filter-popup';
    _popupEl.style.display = 'none';
    document.body.appendChild(_popupEl);

    document.addEventListener('mousedown', e => {
      if (_popupEl.style.display !== 'none'
          && !_popupEl.contains(e.target)
          && !e.target.closest('.th-filter-btn')) {
        _closePopup(false);
      }
    }, true);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') _closePopup(false);
    });
    return _popupEl;
  }

  function _openPopup(col, anchorBtn) {
    const popup = _getPopup();
    _popupCol = col;
    const items = _popupData(col);
    const cur   = _colFilters[col];
    const isAllChecked = !cur || cur.size === 0;

    const colLabels = { parentCat: 'קטגוריה', subCategory: 'תת-קטגוריה', symbol: 'סימבול' };

    popup.innerHTML = `
      <div class="cfp-title">${colLabels[col] || col}</div>
      <div class="cfp-sort-row">
        <button class="cfp-sort-btn${_sortField===col&&_sortDir==='asc'?' active':''}" data-cfp-sort="asc">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 4l-8 8h5v8h6v-8h5z"/></svg> מהקטן לגדול
        </button>
        <button class="cfp-sort-btn${_sortField===col&&_sortDir==='desc'?' active':''}" data-cfp-sort="desc">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20l8-8h-5V4h-6v8H4z"/></svg> מהגדול לקטן
        </button>
      </div>
      <div class="cfp-divider"></div>
      <label class="cfp-select-all">
        <input type="checkbox" class="cfp-all-cb" ${isAllChecked?'checked':''}/>
        <span>(בחר הכל)</span>
      </label>
      <div class="cfp-items">
        ${items.map(it => {
          const chk = isAllChecked || cur.has(it.value);
          return `<label class="cfp-item"><input type="checkbox" value="${it.value}" ${chk?'checked':''}/><span>${it.label}</span></label>`;
        }).join('')}
      </div>
      <div class="cfp-footer">
        <button class="cfp-ok">אישור</button>
        <button class="cfp-clear">נקה סינון</button>
      </div>`;

    popup.style.display = 'block';
    const r  = anchorBtn.getBoundingClientRect();
    const pw = popup.offsetWidth;
    let left = r.right - pw;
    if (left < 6) left = 6;
    if (left + pw > window.innerWidth - 6) left = window.innerWidth - pw - 6;
    popup.style.top  = `${r.bottom + 4}px`;
    popup.style.left = `${left}px`;

    const allCb = popup.querySelector('.cfp-all-cb');
    allCb.addEventListener('change', () => {
      popup.querySelectorAll('.cfp-items input').forEach(cb => cb.checked = allCb.checked);
    });
    popup.querySelectorAll('.cfp-items input').forEach(cb => {
      cb.addEventListener('change', () => {
        const all = popup.querySelectorAll('.cfp-items input');
        allCb.checked = [...all].every(c => c.checked);
      });
    });
    popup.querySelectorAll('[data-cfp-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        _sortField = col;
        _sortDir   = btn.dataset.cfpSort;
        _closePopup(false);
        applyFilters(); _paint(_container);
      });
    });
    popup.querySelector('.cfp-ok').addEventListener('click', () => _closePopup(true));
    popup.querySelector('.cfp-clear').addEventListener('click', () => {
      delete _colFilters[col];
      _closePopup(false);
      applyFilters(); _paint(_container);
    });
  }

  function _closePopup(apply) {
    const popup = _getPopup();
    if (apply && _popupCol) {
      const cbs     = popup.querySelectorAll('.cfp-items input');
      const checked = [...cbs].filter(c => c.checked).map(c => c.value);
      if (checked.length === 0 || checked.length === cbs.length) {
        delete _colFilters[_popupCol];
      } else {
        _colFilters[_popupCol] = new Set(checked);
      }
      applyFilters(); _paint(_container);
    }
    popup.style.display = 'none';
    _popupCol = null;
  }

  /* ── Render entry point ── */
  function render(container) {
    _container = container;
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
      if (body)    { _container = body; body.style.display = 'block'; _paint(body); }
    } catch (err) {
      App.setDataStatus('error', err.message);
      console.error('Journal error:', err);
      const loading = document.getElementById('jnl-loading');
      if (loading) {
        loading.innerHTML = `
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
  }

  function _paint(container) {
    _container = container;
    const ports     = [...new Set(_all.map(r => r.Portfolio).filter(Boolean))].sort();
    const anyFilter = Object.keys(_colFilters).some(k => hasFilter(k)) || !!_search.trim();

    /* ── Port buttons (inline with date row) ── */
    const portButtons = ports.length > 1
      ? `<div class="filter-separator"></div>
         <span class="sort-label">תיק:</span>
         <button class="filter-btn${_portFilter==='all'?' active':''}" data-port="all">הכל</button>
         ${ports.map(p => `<button class="filter-btn${_portFilter===p?' active':''}" data-port="${p}">${p}</button>`).join('')}`
      : '';

    container.innerHTML = `
      <!-- ── Sticky filter bar ── -->
      <div class="journal-sticky-bar">
        <div class="journal-filters">
          <!-- Date range -->
          <div class="date-filter-group">
            ${['30d','quarter','year','all'].map((k,i) => {
              const labels = ['30 יום','רבעון','שנה שוטפת','הכל'];
              return `<button class="date-filter-btn${_dateRange===k?' active':''}" data-range="${k}">${labels[i]}</button>`;
            }).join('')}
          </div>
          <!-- Portfolio (same row) -->
          ${portButtons}
          <!-- Search (pushed to right in RTL = left visually) -->
          <div class="journal-search">
            <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" id="jnl-search" placeholder="חיפוש סימבול, תיאור..." value="${_search.replace(/"/g,'&quot;')}"/>
          </div>
        </div>
        <!-- Stats row -->
        <div class="journal-meta">
          <span><strong>${_filtered.length.toLocaleString('he-IL')}</strong> תנועות</span>
          ${_filtered.length !== _all.length ? `<span>מתוך ${_all.length.toLocaleString('he-IL')}</span>` : ''}
          ${anyFilter ? `<span class="filter-active-note">סינון פעיל</span>` : ''}
        </div>
      </div>

      <!-- ── Table ── -->
      <div class="journal-table-wrap">
        <table class="journal-table">
          <thead>
            <tr>
              ${_th('#',           'col-num',     null,          null)}
              ${_th('תאריך',      'col-date',    'date',        null)}
              ${_th('קטגוריה',    'col-cat',     'parentCat',   'parentCat')}
              ${_th('תת-קטגוריה','col-subcat',  'subCategory', 'subCategory')}
              ${_th('סימבול',     'col-sym',     'symbol',      'symbol')}
              <th class="col-port">תיק</th>
              ${_th('כמות',       'col-qty',     'qty',         null)}
              <th class="col-comm">עמלה</th>
              <th class="col-tax">מס</th>
              ${_th('סכום',       'col-amt',     'amount',      null)}
              <th class="col-desc">תיאור</th>
            </tr>
          </thead>
          <tbody>
            ${_filtered.length
              ? _filtered.map((row, i) => _row(row, i + 1)).join('')
              : `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text-muted)">אין תנועות לתקופה הזו</td></tr>`}
          </tbody>
        </table>
      </div>`;

    _bind(container);
  }

  function _row(row, idx) {
    const { val, sym, style } = getAmount(row);
    const comm = n(row.Commission);
    const tax  = n(row.EstimatedTax);
    const qty  = n(row.Qty);
    const isTicker   = /^[A-Z]{1,5}$/.test((row.Symbol||'').toString().trim());
    const symDisplay = isTicker ? row.Symbol : '—';
    const showQty    = ['BUY_STOCK','SELL_STOCK','SPLIT','BONUS'].includes(row.subCategory);
    const commSym    = sym || '₪';
    return `<tr>
      <td class="col-num">${idx}</td>
      <td class="col-date">${fmtDate(row.Date)}</td>
      <td class="col-cat">${parentBadge(row.category)}</td>
      <td class="col-subcat">${catBadge(row.subCategory)}</td>
      <td class="col-sym">${symDisplay}</td>
      <td class="col-port">${(row.Portfolio||'—').trim()}</td>
      <td class="col-qty">${showQty&&qty ? qty.toLocaleString('he-IL',{maximumFractionDigits:4}) : '—'}</td>
      <td class="col-comm">${comm>0 ? `<span style="color:var(--danger)">−${commSym}${fmtMoney(comm)}</span>` : '—'}</td>
      <td class="col-tax">${tax >0 ? `<span style="color:var(--danger)">−₪${fmtMoney(tax)}</span>`          : '—'}</td>
      <td class="col-amt">${amtHTML(val,sym,style)}</td>
      <td class="col-desc" title="${(row.Name||'').replace(/"/g,'&quot;')}">${generateDescription(row)}</td>
    </tr>`;
  }

  function _bind(container) {
    // Date range
    container.querySelectorAll('.date-filter-btn').forEach(btn =>
      btn.addEventListener('click', () => { _dateRange = btn.dataset.range; applyFilters(); _paint(container); })
    );
    // Portfolio
    container.querySelectorAll('[data-port]').forEach(btn =>
      btn.addEventListener('click', () => { _portFilter = btn.dataset.port; applyFilters(); _paint(container); })
    );
    // Search — debounced
    const searchEl = container.querySelector('#jnl-search');
    if (searchEl) {
      let _debounce;
      searchEl.addEventListener('input', () => {
        clearTimeout(_debounce);
        _debounce = setTimeout(() => { _search = searchEl.value; applyFilters(); _paint(container); }, 220);
      });
      // Keep focus after re-paint (cursor at end)
      if (_search) {
        searchEl.focus();
        const len = searchEl.value.length;
        searchEl.setSelectionRange(len, len);
      }
    }
    // Column sort
    container.querySelectorAll('.th-sort-btn[data-sort-col]').forEach(btn =>
      btn.addEventListener('click', e => {
        if (e.target.closest('.th-filter-btn')) return;
        const col = btn.dataset.sortCol;
        if (col === _sortField) { _sortDir = _sortDir==='desc'?'asc':'desc'; }
        else { _sortField = col; _sortDir = col==='date' ? 'desc' : 'asc'; }
        applyFilters(); _paint(container);
      })
    );
    // Column filter popup
    container.querySelectorAll('.th-filter-btn[data-filter-col]').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const col   = btn.dataset.filterCol;
        const popup = _getPopup();
        if (popup.style.display !== 'none' && _popupCol === col) {
          _closePopup(false);
        } else {
          _openPopup(col, btn);
        }
      })
    );
  }

  return { render };
})();
