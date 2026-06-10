/* ===== PAGE: הכנסות והוצאות — תזרים מזומנים ===== */

Pages.cashflow = (() => {

  let _sum = null;
  let _fxRate = null;
  let _container = null;
  let _currHandler = null;

  const fmtMoney = (v, d = 2) => (v === null || !isFinite(v)) ? '—' : Math.abs(v).toLocaleString('he-IL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const currSym  = () => App.getCurrency() === 'ILS' ? '₪' : '$';
  const toDisplay = usd => (usd === null || usd === undefined || !isFinite(usd)) ? null : (App.getCurrency() === 'ILS' && _fxRate ? usd * _fxRate : usd);
  const fmtDate = raw => { const d = new Date(raw); return isNaN(d) ? '—' : `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`; };

  const SUB_LABEL = {
    DEPOSIT: 'הפקדת מזומן', CASH_DIVIDEND: 'דיבידנד', CREDIT_INTEREST: 'ריבית זכות',
    TAX_REFUND: 'זיכוי מס', TRADE_COMMISSION: 'עמלת מסחר', MGMT_FEE: 'דמי ניהול',
    DEBIT_INTEREST: 'ריבית חובה', CAPITAL_GAIN_TAX: 'מס רווח הון', DIVIDEND_TAX: 'מס דיבידנד',
    TAX_PAYMENT: 'תשלום מס', TAX_PROVISION: 'עתודת מס (מגן מס)',
  };

  function render(container) {
    _container = container;
    if (_currHandler) document.removeEventListener('app:currencychange', _currHandler);
    _currHandler = () => { if (_container) _paint(_container); };
    document.addEventListener('app:currencychange', _currHandler);
    container.innerHTML = `<div class="pf-loading"><p style="color:var(--text-muted);font-size:13px">טוען תזרים...</p></div>`;
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
      _sum = Analytics.cashSummary(Classifier.enrichAll(txns), _fxRate);
      App.setDataStatus('live');
      _paint(_container);
    } catch (err) {
      App.setDataStatus('error', err.message);
      _container.innerHTML = `<div class="pf-loading"><p style="color:var(--danger);font-size:13px">שגיאה: ${err.message}</p></div>`;
    }
  }

  function _card(label, usd, sub, color, signed) {
    const sym = currSym();
    const prefix = signed ? (usd >= 0 ? '+' : '−') : '';
    return `<div class="pf-macro-card">
      <div class="pf-macro-label">${label}</div>
      <div class="pf-macro-value"${color ? ` style="color:${color}"` : ''}>${prefix}${sym}${fmtMoney(toDisplay(usd))}</div>
      <div class="pf-macro-sub">${sub}</div>
    </div>`;
  }

  function _paint(container) {
    _container = container;
    const s = _sum, sym = currSym();
    const income = s.dividends + s.interest + s.taxRefund;
    const incomeColor = s.incomeNet >= 0 ? 'var(--success)' : 'var(--danger)';

    const topCards = `
      <div class="pf-macros-row">
        ${_card('תזרים נטו (הכנסות פחות עלויות)', s.incomeNet, 'דיבידנדים+ריבית פחות עמלות+מיסים', incomeColor, true)}
        ${_card('סך הכנסות', income, 'דיבידנד + ריבית זכות + זיכוי מס', 'var(--success)')}
        ${_card('סך עלויות', -(s.fees + s.taxes + s.debitInterest), 'עמלות + מיסים + ריבית חובה', 'var(--danger)')}
        ${_card('הפקדות הון (נטו)', s.deposits, 'העברות מזומן מהבנק', null)}
      </div>`;

    const breakdown = `
      <div class="pf-macros-row" style="grid-template-columns:repeat(4,1fr)">
        ${_card('דיבידנדים', s.dividends, 'התקבל', 'var(--success)')}
        ${_card('ריבית זכות', s.interest, 'התקבל', 'var(--success)')}
        ${_card('עמלות', -s.fees, 'מסחר + ניהול', 'var(--danger)')}
        ${_card('מיסים', -s.taxes, 'רווח הון + דיבידנד + תשלום', 'var(--danger)')}
      </div>`;

    const rows = s.events.slice(0, 200).map(e => {
      const cls = e.amountUSD > 0 ? 'pos' : e.amountUSD < 0 ? 'neg' : '';
      const amt = e.sign === 0 ? '—' : `${e.amountUSD >= 0 ? '+' : '−'}${sym}${fmtMoney(toDisplay(e.amountUSD))}`;
      return `<tr>
        <td class="pf-td-center">${fmtDate(e.date)}</td>
        <td class="pf-td-center">${SUB_LABEL[e.sub] || e.sub}</td>
        <td class="pf-td-center pf-td-muted">${e.symbol || '—'}</td>
        <td class="pf-td-center"><div class="pf-pnl-cell ${cls}"><span class="pf-pnl-amt">${amt}</span></div></td>
      </tr>`;
    }).join('');

    container.innerHTML = topCards + breakdown + `
      <div class="pf-table-wrap" style="margin-top:14px">
        <table class="pf-table">
          <thead><tr><th>תאריך</th><th>סוג</th><th>סימבול</th><th>סכום</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="pf-no-data">אין תנועות מזומן</td></tr>`}</tbody>
        </table>
      </div>
      ${s.provision > 0 ? `<p style="color:var(--text-muted);font-size:12px;margin-top:10px;text-align:center">בנוסף: ${sym}${fmtMoney(toDisplay(s.provision))} הופקדו לעתודת מס (מגן מס) — אינם הכנסה או הוצאה.</p>` : ''}`;
  }

  return { render };
})();
