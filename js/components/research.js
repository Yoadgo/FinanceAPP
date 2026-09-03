/* ===== PAGE: תחקור — מול המדד · מה עבד · כמה עולה החיכוך =====
   שלוש השאלות שיועד בחר, כולן נגזרות מנתונים שכבר קיימים בגיליון.
   המסך הזה לא כותב כלום. ר' זיכרון הפרויקט: phase3_research.md            */

Pages.research = (() => {

  let _enriched = null;
  let _slices   = null;
  let _seriesMap= null;
  let _friction = null;
  let _closed   = null;
  let _fxRate   = null;
  let _container= null;
  let _currHandler = null;

  let _tab   = 'bench';     // bench | trades | friction
  let _bench = 'IVV';
  let _port  = 'all';
  let _seg   = 'byHold';    // byHold | bySize | byPortfolio | byYear
  let _benchAvailable = [];

  const n = v => parseFloat((v || '0').toString().replace(/[^\d.-]/g, '')) || 0;
  const fmtMoney = (v, d = 2) => (v === null || !isFinite(v)) ? '—' : Math.abs(v).toLocaleString('he-IL', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtPct = (v, d = 1) => (v === null || !isFinite(v)) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)}%`;
  const fmtPctPlain = (v, d = 1) => (v === null || !isFinite(v)) ? '—' : `${(v * 100).toFixed(d)}%`;
  const currSym = () => App.getCurrency() === 'ILS' ? '₪' : '$';
  const toDisplay = usd => (usd === null || usd === undefined || !isFinite(usd)) ? null : (App.getCurrency() === 'ILS' && _fxRate ? usd * _fxRate : usd);
  const money = usd => `${currSym()}${fmtMoney(toDisplay(usd))}`;
  const signedMoney = usd => `${usd >= 0 ? '+' : '−'}${money(usd)}`;
  const fmtDate = raw => { const d = new Date(raw); return isNaN(d) ? '—' : `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`; };
  const col = v => v > 0 ? 'var(--success)' : v < 0 ? 'var(--danger)' : '';

  /* ── The benchmarks we are willing to offer ──
     A benchmark whose history starts after the first trade would silently
     drop every early position from the comparison, and the total would
     look better or worse for a reason that has nothing to do with skill.
     So a candidate is offered only if its series starts on or before the
     earliest buy. Verified 3.9.2026: IVV from 17/09/2021 and QQQ from
     01/03/2022 both clear a first trade of 03/03/2022; TQQQ (14/07/2022)
     does not, and is therefore not offered.                              */
  const BENCH_CANDIDATES = [
    { sym: 'IVV', label: 'S&P 500 (IVV)' },
    { sym: 'QQQ', label: 'נאסד"ק 100 (QQQ)' },
  ];

  function render(container) {
    _container = container; _tab = 'bench'; _port = 'all'; _seg = 'byHold';
    if (_currHandler) document.removeEventListener('app:currencychange', _currHandler);
    _currHandler = () => { if (_container) _paint(_container); };
    document.addEventListener('app:currencychange', _currHandler);
    container.innerHTML = FA.skel.tablePage(10, 6);
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
      _enriched = Classifier.enrichAll(txns);
      _slices   = PortfolioEngine.computeLotSlices(_enriched);
      _closed   = PortfolioEngine.computeClosedTrades(_enriched);
      _friction = Analytics.frictionSummary(_enriched, _fxRate);

      /* One request for every symbol plus the benchmarks — it rides the
         nightly history cache (2.4s for all 25+), so asking for two more
         costs nothing extra. */
      const want = [...new Set([
        ..._slices.map(s => s.symbol),
        ...BENCH_CANDIDATES.map(b => b.sym),
      ])];
      const hist = await DataService.getStockHistories(want);
      _seriesMap = Research.buildSeriesMap(hist);

      const firstBuy = _slices.reduce((m, s) => {
        const t = new Date(s.buyDate).getTime();
        return isFinite(t) && (m === null || t < m) ? t : m;
      }, null);
      _benchAvailable = BENCH_CANDIDATES.filter(b => {
        const ser = _seriesMap[b.sym];
        return ser && ser.first != null && (firstBuy === null || ser.first <= firstBuy);
      });
      if (_benchAvailable.length && !_benchAvailable.some(b => b.sym === _bench)) _bench = _benchAvailable[0].sym;

      App.setDataStatus('live');
      _paint(_container);
    } catch (err) {
      App.setDataStatus('error', err.message);
      _container.innerHTML = FA.ui.errorState({ detail: err.message, actionId: 'rs-retry' });
      const rb = document.getElementById('rs-retry');
      if (rb) rb.addEventListener('click', () => { _container.innerHTML = FA.skel.tablePage(10, 6); _load(); });
    }
  }

  /* ── Shared bits ── */
  function _ports() { return [...new Set(_slices.map(s => s.portfolio).filter(Boolean))].sort(); }
  function _visibleSlices() { return _port === 'all' ? _slices : _slices.filter(s => s.portfolio === _port); }

  function _alpha() { return Research.alpha(_visibleSlices(), _seriesMap, _bench); }

  function _tabBar() {
    return `<div class="pf-filter-bar" style="margin-bottom:14px">
      <button class="pf-port-btn${_tab === 'bench' ? ' active' : ''}" data-tab="bench">מול המדד</button>
      <button class="pf-port-btn${_tab === 'trades' ? ' active' : ''}" data-tab="trades">מה עבד</button>
      <button class="pf-port-btn${_tab === 'friction' ? ' active' : ''}" data-tab="friction">כמה עולה החיכוך</button>
    </div>`;
  }

  function _portBar() {
    const ports = _ports();
    if (ports.length < 2) return '';
    return `<div class="pf-filter-bar">
      <span class="pf-filter-label">תיק:</span>
      <button class="pf-port-btn${_port === 'all' ? ' active' : ''}" data-port="all">כל התיקים</button>
      ${ports.map(p => `<button class="pf-port-btn${_port === p ? ' active' : ''}" data-port="${p}">${p}</button>`).join('')}
    </div>`;
  }

  function _benchBar() {
    if (_benchAvailable.length < 2) return '';
    return `<div class="pf-filter-bar">
      <span class="pf-filter-label">מדד ייחוס:</span>
      ${_benchAvailable.map(b => `<button class="pf-port-btn${_bench === b.sym ? ' active' : ''}" data-bench="${b.sym}">${b.label}</button>`).join('')}
    </div>`;
  }

  function _card(label, value, sub, color) {
    return `<div class="pf-macro-card">
      <div class="pf-macro-label">${label}</div>
      <div class="pf-macro-value"${color ? ` style="color:${color}"` : ''}>${value}</div>
      <div class="pf-macro-sub">${sub}</div>
    </div>`;
  }

  /* A row that could not be measured is named, never dropped in silence. */
  function _coverageNote(a) {
    const s = a.skipped;
    const bits = [];
    if (s.noBench.length) bits.push(`${s.noBench.length} פרוסות נקנו לפני שהמדד מתחיל`);
    if (s.noPrice.length) {
      const syms = [...new Set(s.noPrice.map(x => x.symbol))].join(', ');
      bits.push(`${s.noPrice.length} פוזיציות פתוחות בלי היסטוריית מחירים (${syms})`);
    }
    if (s.badData.length) bits.push(`${s.badData.length} שורות עם נתון חסר`);
    if (!bits.length) return '';
    return `<p class="rs-note">לא נכללו בחישוב: ${bits.join(' · ')}. מוטב להשמיט מאשר לנחש.</p>`;
  }

  function _asOfNote(a) {
    const ser = _seriesMap[_bench];
    if (!ser || ser.last == null) return '';
    return `<p class="rs-note">פוזיציות פתוחות מוערכות במחיר הסגירה של ${fmtDate(ser.last)} — אותו יום שבו נקרא המדד.
      לכן המספרים כאן עשויים להיות שונים במעט ממסך תיקי ההשקעות, שמציג מחיר חי.</p>`;
  }

  /* ═════════ TAB 1 — מול המדד ═════════ */
  function _renderBench() {
    if (!_benchAvailable.length) {
      return _portBar() + FA.ui.emptyState({
        title: 'אין מדד ייחוס זמין',
        text: 'כדי להשוות למדד צריך היסטוריית מחירים של IVV או QQQ שמתחילה לפני העסקה הראשונה שלך.\nהיא נבנית ע"י buildRefreshAll בגיליון.',
      });
    }
    const a = _alpha();
    if (!a.rows.length) {
      return _benchBar() + _portBar() + FA.ui.emptyState({
        title: 'אין עדיין מה להשוות',
        text: 'לא נמצאה אף פרוסת החזקה שאפשר למדוד מול המדד.',
      });
    }
    const t = Research.totals(a.rows);
    const label = (BENCH_CANDIDATES.find(b => b.sym === _bench) || {}).label || _bench;

    const macros = `<div class="pf-macros-row">
      ${_card('אלפא — כמה הכית את המדד', signedMoney(t.alphaUsd),
              `הרווח שלך ${signedMoney(t.pnl)} מול ${signedMoney(t.benchPnl)} של המדד`, col(t.alphaUsd))}
      ${_card('התשואה שלך', fmtPct(t.ret), 'משוקללת לפי בסיס עלות', col(t.ret))}
      ${_card(`${label} באותם ימים`, fmtPct(t.benchRet), 'אותו כסף, אותם תאריכים', col(t.benchRet))}
      ${_card('פוזיציות שהכו את המדד', `${(t.beatRate * 100).toFixed(0)}%`,
              `${t.beats} מתוך ${t.count} · ${(t.winRate * 100).toFixed(0)}% פשוט היו רווחיות`)}
    </div>`;

    const split = `<div class="pf-macros-row" style="grid-template-columns:repeat(2,1fr)">
      ${_card('פוזיציות סגורות', signedMoney(t.pnlClosed - t.benchPnlClosed),
              `${t.closed} פרוסות · הון ${money(t.costClosed)}`, col(t.pnlClosed - t.benchPnlClosed))}
      ${_card('פוזיציות פתוחות', signedMoney(t.pnlOpen - t.benchPnlOpen),
              `${t.open} פרוסות · הון ${money(t.costOpen)}`, col(t.pnlOpen - t.benchPnlOpen))}
    </div>`;

    const bySym = Research.groupBy(a.rows, r => r.symbol).sort((x, y) => y.alphaUsd - x.alphaUsd);
    const rows = bySym.map(g => `<tr>
      <td class="pf-td-center"><span class="pf-sym-badge pf-sym-click" data-sym="${g.key}">${g.key}</span></td>
      <td class="pf-td-center pf-td-num pf-td-muted">${g.count}</td>
      <td class="pf-td-center pf-td-num">${money(g.cost)}</td>
      <td class="pf-td-center pf-td-num" style="color:${col(g.ret)}">${fmtPct(g.ret)}</td>
      <td class="pf-td-center pf-td-num pf-td-muted">${fmtPct(g.benchRet)}</td>
      <td class="pf-td-center"><div class="pf-pnl-cell ${g.alphaUsd >= 0 ? 'pos' : 'neg'}">
        <span class="pf-pnl-amt">${signedMoney(g.alphaUsd)}</span>
        <span class="pf-pnl-pct">${fmtPct(g.alphaPct)}</span></div></td>
    </tr>`).join('');

    return _benchBar() + _portBar() + macros + split + `
      <div class="pf-table-wrap" style="margin-top:14px"><table class="pf-table">
        <thead><tr><th>נייר</th><th>פרוסות</th><th>הון שהושקע</th><th>התשואה שלך</th><th>המדד</th><th>אלפא</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` + _asOfNote(a) + _coverageNote(a);
  }

  /* ═════════ TAB 2 — מה עבד ═════════ */
  const SEG_LABEL = { byHold: 'משך החזקה', bySize: 'גודל פוזיציה', byPortfolio: 'תיק', byYear: 'שנה' };

  /* The sentence. A table of buckets is data; naming the gap is the point of
     the screen. Only stated when there is enough capital on both sides to
     mean anything — a 2-slice bucket is noise, and saying so out loud is
     better than a confident sentence built on it. */
  function _headline(groups) {
    const material = groups.filter(g => g.count >= 3 && g.cost > 0);
    if (material.length < 2) return '';
    const sorted = [...material].sort((a, b) => b.alphaPct - a.alphaPct);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    if (best.key === worst.key) return '';
    const gap = (best.alphaPct - worst.alphaPct) * 100;
    if (gap < 2) return `<p class="rs-headline rs-headline--flat">לפי ${SEG_LABEL[_seg]} אין פער משמעותי — כל הקבוצות נעות באותו טווח מול המדד. הפילוח הזה לא מסביר את התוצאות שלך.</p>`;
    const thin = (best.count < 8 || worst.count < 8)
      ? ' <span class="rs-caveat">(מדגם קטן — לפחות אחת מהקבוצות מתחת ל-8 פרוסות)</span>' : '';
    return `<p class="rs-headline">
      <strong>${best.label}</strong> הניבו <strong style="color:${col(best.alphaPct)}">${fmtPct(best.alphaPct)}</strong> מול המדד,
      ו<strong>${worst.label}</strong> הניבו <strong style="color:${col(worst.alphaPct)}">${fmtPct(worst.alphaPct)}</strong> —
      פער של ${gap.toFixed(1)} נקודות אחוז.${thin}</p>`;
  }

  function _renderTrades() {
    if (!_benchAvailable.length) return _portBar() + FA.ui.emptyState({ title: 'אין מדד ייחוס זמין', text: 'הפילוח כאן נשען על ההשוואה למדד.' });
    const a = _alpha();
    if (!a.rows.length) return _benchBar() + _portBar() + FA.ui.emptyState({ title: 'אין עדיין מה לפלח' });

    const segs = Research.segments(a.rows);
    const groups = segs[_seg] || [];

    const segBar = `<div class="pf-filter-bar">
      <span class="pf-filter-label">פילוח לפי:</span>
      ${Object.keys(SEG_LABEL).map(k => `<button class="pf-port-btn${_seg === k ? ' active' : ''}" data-seg="${k}">${SEG_LABEL[k]}</button>`).join('')}
    </div>`;

    const rows = groups.map(g => `<tr>
      <td class="pf-td-center">${g.label}</td>
      <td class="pf-td-center pf-td-num pf-td-muted">${g.count}</td>
      <td class="pf-td-center pf-td-num">${money(g.cost)}</td>
      <td class="pf-td-center pf-td-num" style="color:${col(g.ret)}">${fmtPct(g.ret)}</td>
      <td class="pf-td-center pf-td-num pf-td-muted">${fmtPct(g.benchRet)}</td>
      <td class="pf-td-center"><div class="pf-pnl-cell ${g.alphaUsd >= 0 ? 'pos' : 'neg'}">
        <span class="pf-pnl-amt">${signedMoney(g.alphaUsd)}</span>
        <span class="pf-pnl-pct">${fmtPct(g.alphaPct)}</span></div></td>
      <td class="pf-td-center pf-td-num">${(g.beatRate * 100).toFixed(0)}%</td>
      <td class="pf-td-center pf-td-num pf-td-muted">${(g.winRate * 100).toFixed(0)}%</td>
    </tr>`).join('');

    /* Two rates side by side on purpose: "רווחיות" is the number that feels
       good, "הכו את המדד" is the number that matters. Where they diverge is
       the finding. */
    return _benchBar() + _portBar() + segBar + _headline(groups) + `
      <div class="pf-table-wrap" style="margin-top:14px"><table class="pf-table">
        <thead><tr><th>${SEG_LABEL[_seg]}</th><th>פרוסות</th><th>הון</th><th>התשואה שלך</th><th>המדד</th><th>אלפא</th><th>הכו את המדד</th><th>היו רווחיות</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8" class="pf-no-data">אין נתונים</td></tr>`}</tbody>
      </table></div>` + _asOfNote(a) + _coverageNote(a);
  }

  /* ═════════ TAB 3 — כמה עולה החיכוך ═════════ */
  function _renderFriction() {
    const f = _friction, fx = _fxRate;
    const conv = b => b.usd + (fx ? b.ils / fx : b.ils);
    const grossRealized = (_closed || []).reduce((s, t) => s + t.pnl, 0);

    /* Native amounts, so a four-year total is not quietly restated at
       today's rate. USD/ILS moved 2.80–4.08 over this data's life. */
    const native = b => {
      const parts = [];
      if (b.usd > 0.005) parts.push(`$${fmtMoney(b.usd)}`);
      if (b.ils > 0.005) parts.push(`₪${fmtMoney(b.ils)}`);
      return parts.join(' + ') || '—';
    };

    const COSTS = [
      { key: 'commission',    label: 'עמלות מסחר',              b: f.commission,    note: `${f.commission.count} עסקאות · ${money(f.avgCommission)} בממוצע` },
      { key: 'capGainTax',    label: 'מס רווח הון ששולם',        b: f.capGainTax,    note: `${f.capGainTax.count} תשלומים` },
      { key: 'debitInterest', label: 'ריבית חובה',               b: f.debitInterest, note: `${f.debitInterest.count} חיובים על אשראי` },
      { key: 'withholding',   label: 'מס שנוכה במקור',           b: f.withholding,   note: `${f.withholding.count} ניכויים על דיבידנד` },
      { key: 'mgmtFee',       label: 'דמי טיפול',                b: f.mgmtFee,       note: `${f.mgmtFee.count} חיובים` },
    ].filter(c => conv(c.b) > 0.005);

    const INCOME = [
      { label: 'דיבידנדים',        b: f.dividends,      note: `${f.dividends.count} תקבולים` },
      { label: 'ריבית זכות',       b: f.creditInterest, note: `${f.creditInterest.count} תקבולים` },
      { label: 'זיכויים מהברוקר',  b: f.brokerCredit,   note: `${f.brokerCredit.count} זיכויים` },
    ].filter(c => conv(c.b) > 0.005);

    const totalCost = f.totalCost;
    const dragOfGross = grossRealized > 0 ? (totalCost / grossRealized) : null;
    const commOfGross = grossRealized > 0 ? (f.commissionConv / grossRealized) : null;

    const macros = `<div class="pf-macros-row">
      ${_card('סך העלויות', money(totalCost), 'עמלות + מיסים + ריבית + דמי טיפול', 'var(--danger)')}
      ${_card('מזה בשליטתך', money(f.totalCostExTax), 'עמלות, ריבית חובה ודמי טיפול — בלי מס', 'var(--danger)')}
      ${_card('עמלה כאחוז מהמחזור', `${f.commissionPctOfTurnover.toFixed(3)}%`, `על מחזור של ${money(f.turnover.total)}`)}
      ${_card('סך ההכנסות', money(f.totalIncome), 'דיבידנד + ריבית זכות + זיכויים', 'var(--success)')}
    </div>`;

    /* The one line that changes behaviour: what share of the gross profit
       the friction consumed. Only shown when there IS gross profit —
       a ratio against a loss is a meaningless number. */
    const verdict = dragOfGross === null
      ? `<p class="rs-headline rs-headline--flat">הרווח הממומש עד היום שלילי, ולכן אין טעם להציג את החיכוך כאחוז ממנו. הסכומים למטה נכונים בפני עצמם.</p>`
      : `<p class="rs-headline">מתוך רווח ממומש גולמי של <strong>${money(grossRealized)}</strong>,
         החיכוך לקח <strong style="color:var(--danger)">${money(totalCost)}</strong> —
         <strong>${(dragOfGross * 100).toFixed(1)}%</strong>.
         העמלות לבדן הן <strong>${(commOfGross * 100).toFixed(1)}%</strong> מהרווח הגולמי.</p>`;

    const costRows = COSTS.map(c => `<tr>
      <td class="pf-td-center">${c.label}</td>
      <td class="pf-td-center pf-td-num" dir="ltr">${native(c.b)}</td>
      <td class="pf-td-center pf-td-num" style="color:var(--danger)">${money(conv(c.b))}</td>
      <td class="pf-td-center pf-td-num pf-td-muted">${totalCost > 0 ? ((conv(c.b) / totalCost) * 100).toFixed(1) + '%' : '—'}</td>
      <td class="pf-td-center pf-td-muted">${c.note}</td>
    </tr>`).join('');

    const incomeRows = INCOME.map(c => `<tr>
      <td class="pf-td-center">${c.label}</td>
      <td class="pf-td-center pf-td-num" dir="ltr">${native(c.b)}</td>
      <td class="pf-td-center pf-td-num" style="color:var(--success)">${money(conv(c.b))}</td>
      <td class="pf-td-center pf-td-muted" colspan="2">${c.note}</td>
    </tr>`).join('');

    const yearRows = f.byYear.map(y => `<tr>
      <td class="pf-td-center">${y.year}</td>
      <td class="pf-td-center pf-td-num pf-td-muted">${y.trades}</td>
      <td class="pf-td-center pf-td-num">${money(y.turnover)}</td>
      <td class="pf-td-center pf-td-num" style="color:var(--danger)">${money(y.commission)}</td>
      <td class="pf-td-center pf-td-num" style="color:var(--danger)">${money(y.debitInterest + y.mgmtFee)}</td>
      <td class="pf-td-center pf-td-num" style="color:var(--danger)">${money(y.capGainTax + y.withholding)}</td>
      <td class="pf-td-center pf-td-num" style="color:var(--success)">${money(y.income)}</td>
    </tr>`).join('');

    const topSym = f.bySymbol.slice(0, 10).map(s => `<tr>
      <td class="pf-td-center"><span class="pf-sym-badge pf-sym-click" data-sym="${s.symbol}">${s.symbol}</span></td>
      <td class="pf-td-center pf-td-num pf-td-muted">${s.trades}</td>
      <td class="pf-td-center pf-td-num">${money(s.turnover)}</td>
      <td class="pf-td-center pf-td-num" style="color:var(--danger)">${money(s.commission)}</td>
      <td class="pf-td-center pf-td-num pf-td-muted">${s.turnover > 0 ? ((s.commission / s.turnover) * 100).toFixed(3) + '%' : '—'}</td>
    </tr>`).join('');

    return macros + verdict + `
      <div class="pf-table-wrap" style="margin-top:14px"><table class="pf-table">
        <thead><tr><th>מה נלקח</th><th>במטבע המקורי</th><th>${currSym()}</th><th>חלק מהעלות</th><th></th></tr></thead>
        <tbody>${costRows || `<tr><td colspan="5" class="pf-no-data">אין עלויות</td></tr>`}</tbody>
      </table></div>

      <div class="pf-table-wrap" style="margin-top:14px"><table class="pf-table">
        <thead><tr><th>מה התקבל</th><th>במטבע המקורי</th><th>${currSym()}</th><th></th></tr></thead>
        <tbody>${incomeRows || `<tr><td colspan="4" class="pf-no-data">אין הכנסות</td></tr>`}</tbody>
      </table></div>

      <h3 class="rs-h3">לפי שנה</h3>
      <div class="pf-table-wrap"><table class="pf-table">
        <thead><tr><th>שנה</th><th>עסקאות</th><th>מחזור</th><th>עמלות</th><th>ריבית ודמי טיפול</th><th>מיסים</th><th>הכנסות</th></tr></thead>
        <tbody>${yearRows || `<tr><td colspan="7" class="pf-no-data">אין נתונים</td></tr>`}</tbody>
      </table></div>

      <h3 class="rs-h3">עשרת הניירות היקרים בעמלות</h3>
      <div class="pf-table-wrap"><table class="pf-table">
        <thead><tr><th>נייר</th><th>עסקאות</th><th>מחזור</th><th>עמלות</th><th>אחוז מהמחזור</th></tr></thead>
        <tbody>${topSym || `<tr><td colspan="5" class="pf-no-data">אין נתונים</td></tr>`}</tbody>
      </table></div>

      <p class="rs-note">סכומים שקליים ודולריים מוצגים גם במטבע המקורי, כי ההמרה לעמודה המאוחדת נעשית לפי שער היום —
        והשער נע בין 2.80 ל-4.08 בתקופה שהנתונים מכסים. הטור "במטבע המקורי" הוא המדויק.</p>`;
  }

  /* ═════════ paint ═════════ */
  function _paint(container) {
    _container = container;
    const content = _tab === 'bench' ? _renderBench()
                  : _tab === 'trades' ? _renderTrades()
                  : _renderFriction();
    container.innerHTML = _tabBar() + content;

    const on = (sel, fn) => container.querySelectorAll(sel).forEach(el => el.addEventListener('click', () => fn(el)));
    on('[data-tab]',   el => { if (el.dataset.tab   !== _tab)   { _tab   = el.dataset.tab;   _paint(_container); } });
    on('[data-port]',  el => { if (el.dataset.port  !== _port)  { _port  = el.dataset.port;  _paint(_container); } });
    on('[data-bench]', el => { if (el.dataset.bench !== _bench) { _bench = el.dataset.bench; _paint(_container); } });
    on('[data-seg]',   el => { if (el.dataset.seg   !== _seg)   { _seg   = el.dataset.seg;   _paint(_container); } });
    on('.pf-sym-click', el => Pages.portfolio.openStock(el.dataset.sym));
  }

  return { render };
})();
