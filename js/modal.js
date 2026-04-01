let activeDate      = null;
let activeWeekStart = null;
let activeWeekEnd   = null;
let editingId       = null;

// ─── WEEK MODAL ───

function openWeek(startIso, endIso) {
  activeWeekStart = startIso;
  activeWeekEnd   = endIso;
  activeDate      = todayStr();
  editingId       = null;

  const fmtDate = iso => {
    const [y, m, d] = iso.split('-');
    return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  };
  const [ey, em, ed] = endIso.split('-');
  const endYear = new Date(+ey, +em - 1, +ed).toLocaleDateString('en-US', { year: 'numeric' });

  document.getElementById('modal-title').textContent = 'Weekly Trades';
  document.getElementById('modal-sub').textContent   = `${fmtDate(startIso)} – ${fmtDate(endIso)}, ${endYear}`;
  hideForm();
  refreshWeekModal();
  document.getElementById('day-overlay').classList.add('open');
}

function refreshWeekModal() {
  const trades = load().filter(t => {
    if (t.legs && t.legs.length)
      return t.legs.some(l => l.date && l.date.split('T')[0] >= activeWeekStart && l.date.split('T')[0] <= activeWeekEnd);
    return t.date >= activeWeekStart && t.date <= activeWeekEnd;
  });
  const pnl    = trades.reduce((s, t) => s + getPnl(t), 0);
  const wins   = trades.filter(t => getPnl(t) > 0).length;
  const loss   = trades.filter(t => getPnl(t) < 0).length;
  const pnlCls = pnl >= 0 ? 'pos' : 'neg';

  document.getElementById('day-summary').innerHTML = `
    <div class="ds-card">
      <div class="ds-label">Week P&amp;L</div>
      <div class="ds-value ${pnlCls}">${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
    </div>
    <div class="ds-card">
      <div class="ds-label">Trades</div>
      <div class="ds-value">${trades.length}</div>
    </div>
    <div class="ds-card">
      <div class="ds-label">Wins</div>
      <div class="ds-value pos">${wins}</div>
    </div>
    <div class="ds-card">
      <div class="ds-label">Losses</div>
      <div class="ds-value neg">${loss}</div>
    </div>`;

  if (!trades.length) {
    document.getElementById('trade-list').innerHTML =
      `<div style="text-align:center;padding:20px 0 12px;color:var(--text-muted);font-size:13px">No trades this week — add one below.</div>`;
    return;
  }

  const byDate = {};
  for (const t of trades) {
    if (!byDate[t.date]) byDate[t.date] = [];
    byDate[t.date].push(t);
  }
  document.getElementById('trade-list').innerHTML = Object.keys(byDate).sort().map(date => {
    const [y, m, d] = date.split('-');
    const dateLabel = new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin:10px 0 6px">${dateLabel}</div>
      ${byDate[date].map(t => tradeItemHtml(t)).join('')}`;
  }).join('');
}

// ─── SHARED TRADE ITEM RENDERER ───

function tradeItemHtml(t) {
  const p    = getPnl(t);
  const pCls = p >= 0 ? 'pos' : 'neg';
  const pStr = (p < 0 ? '-$' : '$') + Math.abs(p).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const openQty = getOpenQty(t);
  const unit    = t.type === 'option' ? 'contract' : 'share';
  const openHtml = openQty > 0
    ? `<div class="ti-open">${openQty} ${unit}${openQty !== 1 ? 's' : ''} open</div>`
    : '';

  const typeBadge = t.type === 'option'
    ? `<span class="badge b-option">OPT</span>
       <span class="badge b-${t.optionType||'call'}">${(t.optionType||'?').toUpperCase()}</span>
       <span style="font-size:11px;color:var(--text-muted)">$${t.strikePrice||'?'}</span>
       ${t.expiryDate ? `<span style="font-size:11px;color:var(--text-muted)">exp ${fmtExpiry(t.expiryDate)}</span>` : ''}`
    : `<span class="badge b-stock">Stock</span>`;

  let legsHtml = '';
  if (t.legs && t.legs.length) {
    // New format: show each leg
    legsHtml = `<div class="ti-legs">${t.legs.map(leg => {
      const cls  = leg.action === 'buy' ? 'leg-buy' : 'leg-sell';
      const lbl  = leg.action === 'buy' ? 'Buy' : 'Sell';
      const unit = t.type === 'option' ? 'c' : 'sh';
      const commFees = (parseFloat(leg.commission)||0) + (parseFloat(leg.fees)||0);
      return `<div class="ti-leg-row ${cls}">
        <span class="ti-leg-action">${lbl}</span>
        <span>${leg.quantity}${unit} @ $${parseFloat(leg.price).toFixed(2)}</span>
        ${commFees > 0 ? `<span style="color:var(--text-muted)">C+F $${commFees.toFixed(2)}</span>` : ''}
        <span style="color:var(--text-muted);font-size:11px">${formatLegDatetime(leg.date)}</span>
      </div>`;
    }).join('')}</div>`;
  } else {
    // Legacy format
    const unit = t.type === 'option' ? ' contract' : ' share';
    legsHtml = `<div class="ti-detail">
      <span class="badge b-${t.side}" style="margin-right:6px">${t.side.toUpperCase()}</span>
      $${parseFloat(t.entryPrice).toFixed(2)} &rarr; $${parseFloat(t.exitPrice).toFixed(2)}
      &nbsp;&bull;&nbsp;${t.quantity}${unit}${t.quantity!=1?'s':''}
      ${t.commission > 0 ? `&nbsp;&bull;&nbsp;Comm $${parseFloat(t.commission).toFixed(2)}` : ''}
      ${t.fees > 0 ? `&nbsp;&bull;&nbsp;Fees $${parseFloat(t.fees).toFixed(2)}` : ''}
    </div>`;
  }

  const badgesLine = (() => {
    const allTags     = loadTags();
    const allMistakes = loadMistakes();
    const allRules    = loadRules();
    const badges = [
      ...(t.tags     || []).map(id => { const tg = allTags.find(x => x.id === id);     return tg ? `<span class="trade-tag-badge">${escHtml(tg.text)}</span>`         : null; }),
      ...(t.mistakes || []).map(id => { const m  = allMistakes.find(x => x.id === id); return m  ? `<span class="trade-mistake-badge">${escHtml(m.text)}</span>`       : null; }),
      ...(t.rules    || []).map(id => { const r  = allRules.find(x => x.id === id);    return r  ? `<span class="trade-rule-badge">${escHtml(r.text)}</span>`           : null; }),
    ].filter(Boolean);
    return badges.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${badges.join('')}</div>` : '';
  })();

  const summaryHtml = tradeItemSummaryHtml(t);

  return `<div class="trade-item" data-trade-id="${t.id}">
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <div class="ti-sym">${t.symbol}</div>
        ${typeBadge}
      </div>
      ${legsHtml}
      ${t.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-style:italic">${escHtml(t.notes)}</div>` : ''}
      ${badgesLine}
    </div>
    ${summaryHtml}
    <div class="ti-pnl-wrap">
      <div class="ti-pnl ${pCls}">${pStr}</div>
      ${openHtml}
    </div>
    <div class="ti-actions">
      <button class="icon-btn" onclick="showForm('${t.id}')" title="Edit">&#9998;</button>
      <button class="icon-btn del" onclick="deleteTrade('${t.id}')" title="Delete">&#128465;</button>
    </div>
  </div>`;
}

function refreshCurrentModal() {
  if (activeWeekStart) refreshWeekModal();
  else refreshDayModal();
}

// ─── DAY MODAL ───

function openDay(dateStr) {
  activeDate      = dateStr;
  activeWeekStart = null;
  activeWeekEnd   = null;
  editingId       = null;
  const [y, m, d] = dateStr.split('-');
  const dt = new Date(+y, +m - 1, +d);
  document.getElementById('modal-title').textContent = 'Daily Trades';
  document.getElementById('modal-sub').textContent   = dt.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  hideForm();
  refreshDayModal();
  document.getElementById('day-overlay').classList.add('open');
}

function refreshDayModal() {
  // Include any trade that has at least one leg on this date (multi-day trades included)
  const trades = load().filter(t => {
    if (t.legs && t.legs.length)
      return t.legs.some(l => l.date && l.date.split('T')[0] === activeDate);
    return t.date === activeDate;
  });

  // Day P&L = only the realized P&L settled on this specific date
  let pnl = 0, wins = 0, loss = 0;
  for (const t of trades) {
    const dp = t.legs && t.legs.length
      ? (getRealizationsByDate(t)[activeDate] || 0)
      : getPnl(t);
    pnl += dp;
    if (dp > 0) wins++;
    if (dp < 0) loss++;
  }
  const pnlCls = pnl >= 0 ? 'pos' : 'neg';

  document.getElementById('day-summary').innerHTML = `
    <div class="ds-card">
      <div class="ds-label">Day P&amp;L</div>
      <div class="ds-value ${pnlCls}">${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
    </div>
    <div class="ds-card">
      <div class="ds-label">Trades</div>
      <div class="ds-value">${trades.length}</div>
    </div>
    <div class="ds-card">
      <div class="ds-label">Wins</div>
      <div class="ds-value pos">${wins}</div>
    </div>
    <div class="ds-card">
      <div class="ds-label">Losses</div>
      <div class="ds-value neg">${loss}</div>
    </div>`;

  if (!trades.length) {
    document.getElementById('trade-list').innerHTML =
      `<div style="text-align:center;padding:20px 0 12px;color:var(--text-muted);font-size:13px">No trades yet — add one below.</div>`;
    return;
  }
  document.getElementById('trade-list').innerHTML = trades.map(t => tradeItemHtml(t)).join('');
}

function closeModal() {
  document.getElementById('day-overlay').classList.remove('open');
  editingId = null;
}

// ─── TRADE FORM — LEGS ───

let currentLegs          = [];
let currentProfitTargets = [];
let currentStopLoss      = [];

function addLeg(action = 'buy') {
  // Default datetime: activeDate at current time, or now
  const base = activeDate
    ? activeDate + 'T' + nowDatetime().split('T')[1]
    : nowDatetime();
  currentLegs.push({
    id:         uid(),
    action,
    date:       base,
    price:      '',
    quantity:   '',
    commission: '',
    fees:       '',
  });
  renderLegsGrid();
}

function removeLeg(id) {
  currentLegs = currentLegs.filter(l => l.id !== id);
  renderLegsGrid();
}

function updateLeg(id, field, value) {
  const leg = currentLegs.find(l => l.id === id);
  if (leg) leg[field] = value;
  refreshCalcCells();
  calcPreview();
}

function refreshCalcCells() {
  const type = document.getElementById('f-type').value;
  const mult = type === 'option' ? 100 : 1;
  const fmt  = n => Math.round(n).toLocaleString('en-US');

  const buyQueue = [];
  let runningPnl = 0;

  for (const leg of currentLegs) {
    const price   = parseFloat(leg.price)    || 0;
    const qty     = parseFloat(leg.quantity) || 0;
    const costEl  = document.getElementById(`lc-cost-${leg.id}`);
    const procEl  = document.getElementById(`lc-proc-${leg.id}`);
    const pnlEl   = document.getElementById(`lc-pnl-${leg.id}`);
    if (!costEl || !procEl || !pnlEl) continue;

    if (leg.action === 'buy') {
      buyQueue.push({ price, totalQty: qty, remaining: qty });
      costEl.textContent = qty && price ? `$${fmt(qty * price * mult)}` : '—';
      procEl.textContent = '—';
      pnlEl.textContent  = '—';
    } else {
      let sellLeft = qty, buyCost = 0, matched = 0;
      for (const buy of buyQueue) {
        if (buy.remaining <= 0 || sellLeft <= 0) continue;
        const q = Math.min(buy.remaining, sellLeft);
        buyCost       += buy.price * q * mult;
        matched       += q;
        buy.remaining -= q;
        sellLeft      -= q;
      }
      costEl.textContent = '—';
      procEl.textContent = qty && price ? `$${fmt(qty * price * mult)}` : '—';
      if (matched > 0) {
        runningPnl    += (price * matched * mult) - buyCost;
        const rounded  = Math.round(runningPnl);
        const color    = rounded >= 0 ? 'var(--green)' : 'var(--red)';
        pnlEl.innerHTML = `<span style="color:${color}">${rounded < 0 ? '-$' : '$'}${fmt(Math.abs(rounded))}</span>`;
      } else {
        pnlEl.textContent = '—';
      }
    }
  }
}

function renderLegsGrid() {
  const body = document.getElementById('f-legs-body');
  if (!currentLegs.length) {
    body.innerHTML = '<div class="legs-empty">No legs yet — click + Buy or + Sell to add one.</div>';
    calcPreview();
    return;
  }

  // Pre-compute calculated columns (price-only, no fees — "gross")
  const type = document.getElementById('f-type').value;
  const mult = type === 'option' ? 100 : 1;
  const buyQueue = [];
  let runningPnl = 0;

  const legCalc = currentLegs.map(leg => {
    const price = parseFloat(leg.price)    || 0;
    const qty   = parseFloat(leg.quantity) || 0;

    if (leg.action === 'buy') {
      buyQueue.push({ price, totalQty: qty, remaining: qty });
      return { adjCost: qty * price * mult, adjProceed: null, grossPnl: null };
    } else {
      // Sell — FIFO match against buy queue (price only, no fees)
      let sellLeft = qty, buyCost = 0, matched = 0;
      for (const buy of buyQueue) {
        if (buy.remaining <= 0 || sellLeft <= 0) continue;
        const q = Math.min(buy.remaining, sellLeft);
        buyCost += buy.price * q * mult;
        matched  += q;
        buy.remaining -= q;
        sellLeft      -= q;
      }
      const proceed = price * qty * mult;
      let grossPnl = null;
      if (matched > 0) {
        runningPnl += (price * matched * mult) - buyCost;
        grossPnl = runningPnl;
      }
      return { adjCost: null, adjProceed: proceed, grossPnl };
    }
  });

  body.innerHTML = currentLegs.map((leg, i) => {
    const c = legCalc[i];

    const fmt = n => Math.round(n).toLocaleString('en-US');
    const adjCostHtml    = c.adjCost    !== null ? `$${fmt(c.adjCost)}`    : '—';
    const adjProceedHtml = c.adjProceed !== null ? `$${fmt(c.adjProceed)}` : '—';

    let grossPnlHtml = '—';
    if (c.grossPnl !== null) {
      const rounded = Math.round(c.grossPnl);
      const color   = rounded >= 0 ? 'var(--green)' : 'var(--red)';
      grossPnlHtml  = `<span style="color:${color}">${rounded < 0 ? '-$' : '$'}${fmt(Math.abs(rounded))}</span>`;
    }

    return `
    <div class="leg-row">
      <select class="leg-field leg-action-sel ${leg.action}"
        onchange="updateLeg('${leg.id}','action',this.value);this.className='leg-field leg-action-sel '+this.value">
        <option value="buy"  ${leg.action === 'buy'  ? 'selected' : ''}>Buy</option>
        <option value="sell" ${leg.action === 'sell' ? 'selected' : ''}>Sell</option>
      </select>
      <input type="datetime-local" class="leg-field" value="${leg.date}"
        onchange="updateLeg('${leg.id}','date',this.value)">
      <input type="number" class="leg-field" value="${leg.price}" placeholder="0.00" step="0.01"
        oninput="updateLeg('${leg.id}','price',this.value)">
      <input type="number" class="leg-field" value="${leg.quantity}" placeholder="0" min="0.01" step="any"
        oninput="updateLeg('${leg.id}','quantity',this.value)">
      <input type="number" class="leg-field" value="${leg.commission}" placeholder="0.00" step="0.01"
        oninput="updateLeg('${leg.id}','commission',this.value)">
      <input type="number" class="leg-field" value="${leg.fees}" placeholder="0.00" step="0.01"
        oninput="updateLeg('${leg.id}','fees',this.value)">
      <div class="leg-calc-cell" id="lc-cost-${leg.id}">${adjCostHtml}</div>
      <div class="leg-calc-cell" id="lc-proc-${leg.id}">${adjProceedHtml}</div>
      <div class="leg-calc-cell" id="lc-pnl-${leg.id}">${grossPnlHtml}</div>
      <button class="leg-del-btn" type="button" onclick="removeLeg('${leg.id}')">&#10005;</button>
    </div>`;
  }).join('');

  calcPreview();
}

// ─── PROFIT TARGETS & STOP LOSS ───

function addProfitTarget() {
  currentProfitTargets.push({ id: uid(), price: '', qty: '' });
  renderProfitTargets();
  updateTSPreview();
}
function removeProfitTarget(id) {
  currentProfitTargets = currentProfitTargets.filter(r => r.id !== id);
  renderProfitTargets();
  updateTSPreview();
}
function updateProfitTarget(id, field, value) {
  const r = currentProfitTargets.find(r => r.id === id);
  if (r) r[field] = value;
  updateTSPreview();
}
function renderProfitTargets() {
  const body = document.getElementById('f-profit-targets-body');
  if (!body) return;
  body.innerHTML = currentProfitTargets.map(r => `
    <div class="ts-row">
      <input type="number" class="ts-input" value="${r.price}" placeholder="0.00" step="0.01"
        oninput="updateProfitTarget('${r.id}','price',this.value)">
      <input type="number" class="ts-input ts-qty" value="${r.qty}" placeholder="0" min="0.01" step="any"
        oninput="updateProfitTarget('${r.id}','qty',this.value)">
      <button type="button" class="ts-del-btn" onclick="removeProfitTarget('${r.id}')">&#128465;</button>
    </div>`).join('');
}

function addStopLoss() {
  currentStopLoss.push({ id: uid(), price: '', qty: '' });
  renderStopLoss();
  updateTSPreview();
}
function removeStopLoss(id) {
  currentStopLoss = currentStopLoss.filter(r => r.id !== id);
  renderStopLoss();
  updateTSPreview();
}
function updateStopLoss(id, field, value) {
  const r = currentStopLoss.find(r => r.id === id);
  if (r) r[field] = value;
  updateTSPreview();
}
function renderStopLoss() {
  const body = document.getElementById('f-stop-loss-body');
  if (!body) return;
  body.innerHTML = currentStopLoss.map(r => `
    <div class="ts-row">
      <input type="number" class="ts-input" value="${r.price}" placeholder="0.00" step="0.01"
        oninput="updateStopLoss('${r.id}','price',this.value)">
      <input type="number" class="ts-input ts-qty" value="${r.qty}" placeholder="0" min="0.01" step="any"
        oninput="updateStopLoss('${r.id}','qty',this.value)">
      <button type="button" class="ts-del-btn" onclick="removeStopLoss('${r.id}')">&#128465;</button>
    </div>`).join('');
}

function updateTSPreview() {
  const typeEl = document.getElementById('f-type');
  if (!typeEl) return;
  const mult = typeEl.value === 'option' ? 100 : 1;

  // Weighted average entry from buy legs
  const buyLegs     = currentLegs.filter(l => l.action === 'buy');
  const totalBuyQty = buyLegs.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0);
  const avgEntry    = totalBuyQty > 0
    ? buyLegs.reduce((s, l) => s + (parseFloat(l.price) || 0) * (parseFloat(l.quantity) || 0), 0) / totalBuyQty
    : null;

  // Realized P&L via FIFO from current legs
  let realizedPnl = 0;
  const bq = currentLegs.filter(l => l.action === 'buy').map(l => ({
    price: parseFloat(l.price) || 0, comm: parseFloat(l.commission) || 0,
    fees:  parseFloat(l.fees)  || 0, totalQty: parseFloat(l.quantity) || 0,
    remaining: parseFloat(l.quantity) || 0,
  }));
  for (const leg of currentLegs) {
    if (leg.action !== 'sell') continue;
    const sp = parseFloat(leg.price) || 0, sc = parseFloat(leg.commission) || 0,
          sf = parseFloat(leg.fees)  || 0, sq = parseFloat(leg.quantity)   || 0;
    if (!sq || sp < 0) continue;
    let left = sq, rev = 0, bc = 0, bcom = 0, bfee = 0, matched = 0;
    for (const b of bq) {
      if (b.remaining <= 0 || left <= 0) continue;
      const q = Math.min(b.remaining, left), ratio = b.totalQty > 0 ? q / b.totalQty : 0;
      rev += sp * q * mult; bc += b.price * q * mult;
      bcom += b.comm * ratio; bfee += b.fees * ratio;
      matched += q; b.remaining -= q; left -= q;
    }
    if (matched > 0) {
      const sr = sq > 0 ? matched / sq : 1;
      realizedPnl += rev - bc - sc * sr - sf * sr - bcom - bfee;
    }
  }
  realizedPnl = Math.round(realizedPnl * 100) / 100;

  // Initial Target
  let initialTarget = null;
  if (avgEntry !== null) {
    const pts = currentProfitTargets.filter(r => parseFloat(r.price) > 0 && parseFloat(r.qty) > 0);
    if (pts.length)
      initialTarget = pts.reduce((s, r) => s + ((parseFloat(r.price) || 0) - avgEntry) * (parseFloat(r.qty) || 0) * mult, 0);
  }

  // Trade Risk
  let tradeRisk = null;
  if (avgEntry !== null) {
    const sls = currentStopLoss.filter(r => r.price !== '' && !isNaN(parseFloat(r.price)) && parseFloat(r.qty) > 0);
    if (sls.length)
      tradeRisk = sls.reduce((s, r) => s + ((parseFloat(r.price) || 0) - avgEntry) * (parseFloat(r.qty) || 0) * mult, 0);
  }

  const plannedR  = (initialTarget != null && tradeRisk != null && tradeRisk !== 0) ? initialTarget / Math.abs(tradeRisk) : null;
  const realizedR = (tradeRisk != null && tradeRisk !== 0) ? realizedPnl / Math.abs(tradeRisk) : null;

  const fmtMoney = n => n == null ? '—' : (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const setEl = (id, text, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.style.color = color || 'var(--text)';
  };

  const moneyColor = n => n == null ? 'var(--text-muted)' : n >= 0 ? 'var(--green)' : 'var(--red)';
  setEl('ts-prev-target',     fmtMoney(initialTarget), moneyColor(initialTarget));
  setEl('ts-prev-risk',       fmtMoney(tradeRisk),     moneyColor(tradeRisk));
  setEl('ts-prev-planned-r',  plannedR  != null ? plannedR.toFixed(2)  + 'R' : '—', plannedR  != null ? 'var(--accent)' : 'var(--text-muted)');
  setEl('ts-prev-realized-r', realizedR != null ? realizedR.toFixed(2) + 'R' : '—', realizedR != null ? moneyColor(realizedR) : 'var(--text-muted)');

  const preview = document.getElementById('ts-preview');
  if (preview) preview.style.display = (initialTarget != null || tradeRisk != null) ? '' : 'none';
}

// ─── TRADE SUMMARY CALCULATION ───

function getTradeSummary(t) {
  if (!t.legs || !t.legs.length) return {};
  const mult     = t.type === 'option' ? 100 : 1;
  const buyLegs  = t.legs.filter(l => l.action === 'buy');
  const sellLegs = t.legs.filter(l => l.action === 'sell');

  const totalBuyQty  = buyLegs.reduce((s, l)  => s + (parseFloat(l.quantity) || 0), 0);
  const totalSellQty = sellLegs.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0);

  const avgEntry = totalBuyQty > 0
    ? buyLegs.reduce((s, l) => s + (parseFloat(l.price) || 0) * (parseFloat(l.quantity) || 0), 0) / totalBuyQty
    : null;
  const avgExit = totalSellQty > 0
    ? sellLegs.reduce((s, l) => s + (parseFloat(l.price) || 0) * (parseFloat(l.quantity) || 0), 0) / totalSellQty
    : null;

  const entryTime = buyLegs.length  > 0 ? buyLegs[0].date                     : null;
  const exitTime  = sellLegs.length > 0 ? sellLegs[sellLegs.length - 1].date  : null;

  let initialTarget = null;
  if (avgEntry !== null && t.profitTargets && t.profitTargets.length) {
    initialTarget = t.profitTargets.reduce((s, pt) => {
      return s + ((parseFloat(pt.price) || 0) - avgEntry) * (parseFloat(pt.qty) || 0) * mult;
    }, 0);
  }

  let tradeRisk = null;
  if (avgEntry !== null && t.stopLoss && t.stopLoss.length) {
    tradeRisk = t.stopLoss.reduce((s, sl) => {
      return s + ((parseFloat(sl.price) || 0) - avgEntry) * (parseFloat(sl.qty) || 0) * mult;
    }, 0);
  }

  const plannedR = (initialTarget !== null && tradeRisk !== null && tradeRisk !== 0)
    ? initialTarget / Math.abs(tradeRisk)
    : null;
  const realizedPnl = getPnl(t);
  const realizedR   = (tradeRisk !== null && tradeRisk !== 0)
    ? realizedPnl / Math.abs(tradeRisk)
    : null;

  return { avgEntry, avgExit, entryTime, exitTime, initialTarget, tradeRisk, plannedR, realizedR };
}

function tradeItemSummaryHtml(t) {
  const s = getTradeSummary(t);

  const fmtTime = dt => {
    if (!dt || !dt.includes('T')) return '—';
    const p = dt.split('T')[1];
    return p ? p.substring(0, 5) : '—';
  };
  const fmtMoney = n => (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const clr  = n => ` style="color:${n >= 0 ? 'var(--green)' : 'var(--red)'}"`;
  const row  = (lbl, val) => `<div class="ti-summary-row"><span class="ti-summary-label">${lbl}</span><span class="ti-summary-val">${val}</span></div>`;

  // Col 2 — timing (always present when legs exist)
  const timingHtml = !t.legs || !t.legs.length ? '' : [
    s.avgEntry != null ? row('Avg Entry',   `$${s.avgEntry.toFixed(2)}`)  : '',
    s.avgExit  != null ? row('Avg Exit',    `$${s.avgExit.toFixed(2)}`)   : '',
    s.entryTime        ? row('Entry Time',  fmtTime(s.entryTime))         : '',
    s.exitTime         ? row('Exit Time',   fmtTime(s.exitTime))          : '',
  ].join('');

  // Col 3 — targets / risk (only when profit targets or stop loss are defined)
  const metricsHtml = [
    s.initialTarget != null ? row('Initial Target', `<span${clr(s.initialTarget)}>${fmtMoney(s.initialTarget)}</span>`) : '',
    s.tradeRisk     != null ? row('Trade Risk',     `<span${clr(s.tradeRisk)}>${fmtMoney(s.tradeRisk)}</span>`)         : '',
    s.plannedR      != null ? row('Planned R',      `<span style="color:var(--accent)">${s.plannedR.toFixed(2)}R</span>`) : '',
    s.realizedR     != null ? row('Realized R',     `<span${clr(s.realizedR)}>${s.realizedR.toFixed(2)}R</span>`)       : '',
  ].join('');

  return `<div class="ti-sum-timing">${timingHtml}</div>` +
         `<div class="ti-sum-metrics${metricsHtml ? '' : ' ti-sum-empty'}">${metricsHtml}</div>`;
}

// ─── TRADE FORM ───

function showForm(id) {
  // Toggle: clicking the same trade's edit button again closes the form
  if (id && id === editingId) {
    cancelForm();
    return;
  }

  editingId = id;
  document.getElementById('form-title').textContent = id ? 'Edit Trade' : 'New Trade';

  if (id) {
    const t = load().find(x => x.id === id);
    if (!t) return;
    document.getElementById('f-sym').value     = t.symbol;
    document.getElementById('f-type').value    = t.type;
    document.getElementById('f-opttype').value = t.optionType  || 'call';
    document.getElementById('f-strike').value  = t.strikePrice || '';
    document.getElementById('f-expiry').value  = t.expiryDate  || '';
    document.getElementById('f-notes').value   = t.notes       || '';
    renderTagsInForm(t.tags         || []);
    renderMistakesInForm(t.mistakes || []);
    renderRulesInForm(t.rules       || []);
    currentProfitTargets = (t.profitTargets || []).map(pt => ({ id: uid(), price: pt.price, qty: pt.qty }));
    currentStopLoss      = (t.stopLoss      || []).map(sl => ({ id: uid(), price: sl.price, qty: sl.qty }));
    renderProfitTargets();
    renderStopLoss();

    if (t.legs && t.legs.length) {
      currentLegs = t.legs.map(l => ({
        ...l,
        date: l.date && l.date.includes('T') ? l.date : (l.date || todayStr()) + 'T09:30',
      }));
    } else {
      // Migrate legacy trade to legs
      const d = (t.date || todayStr()) + 'T09:30';
      if (t.side === 'long') {
        currentLegs = [
          { id: uid(), action: 'buy',  date: d, price: t.entryPrice, quantity: t.quantity, commission: t.commission || 0, fees: t.fees || 0 },
          { id: uid(), action: 'sell', date: d, price: t.exitPrice,  quantity: t.quantity, commission: 0, fees: 0 },
        ];
      } else {
        currentLegs = [
          { id: uid(), action: 'sell', date: d, price: t.entryPrice, quantity: t.quantity, commission: t.commission || 0, fees: t.fees || 0 },
          { id: uid(), action: 'buy',  date: d, price: t.exitPrice,  quantity: t.quantity, commission: 0, fees: 0 },
        ];
      }
    }
    renderLegsGrid();
  } else {
    clearForm();
  }

  onTypeChange();

  document.getElementById('add-row-btn').style.display = 'none';
  const form = document.getElementById('trade-form');
  form.style.display = 'block';

  if (id) {
    // Place form inline directly after the trade item, keeping the summary visible
    const tradeEl = document.querySelector(`[data-trade-id="${id}"]`);
    if (tradeEl) {
      // Clear highlight from any previously edited item
      document.querySelectorAll('.trade-item.is-editing').forEach(el => el.classList.remove('is-editing'));
      tradeEl.classList.add('is-editing');
      tradeEl.insertAdjacentElement('afterend', form);
    }
  }

  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideForm() {
  document.querySelectorAll('.trade-item.is-editing').forEach(el => el.classList.remove('is-editing'));

  const form   = document.getElementById('trade-form');
  const addBtn = document.getElementById('add-row-btn');
  form.style.display   = 'none';
  addBtn.style.display = 'flex';

  // Return form to its original position (right after the Add button)
  if (form.previousElementSibling !== addBtn) {
    addBtn.insertAdjacentElement('afterend', form);
  }

  editingId = null;
}

function cancelForm() {
  hideForm();
  clearForm();
}

function clearForm() {
  ['f-sym', 'f-strike', 'f-expiry', 'f-notes'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-type').value    = 'stock';
  document.getElementById('f-opttype').value = 'call';
  const el = document.getElementById('pnl-prev');
  el.textContent = '—';
  el.style.color = 'var(--text-muted)';
  document.getElementById('open-pos-wrap').style.display = 'none';
  currentLegs          = [];
  currentProfitTargets = [];
  currentStopLoss      = [];
  renderLegsGrid();
  renderProfitTargets();
  renderStopLoss();
  renderTagsInForm([]);
  renderMistakesInForm([]);
  renderRulesInForm([]);
}

function onTypeChange() {
  const isOpt = document.getElementById('f-type').value === 'option';
  document.getElementById('opt-fields').classList.toggle('show', isOpt);
  calcPreview();
}

function calcPreview() {
  const type = document.getElementById('f-type').value;
  const mult = type === 'option' ? 100 : 1;
  const el   = document.getElementById('pnl-prev');

  // FIFO match — same logic as getRealizationsByDate
  const buyQueue = currentLegs
    .filter(l => l.action === 'buy')
    .map(l => ({
      price:     parseFloat(l.price)      || 0,
      comm:      parseFloat(l.commission) || 0,
      fees:      parseFloat(l.fees)       || 0,
      totalQty:  parseFloat(l.quantity)   || 0,
      remaining: parseFloat(l.quantity)   || 0,
    }));

  let pnl = 0, hasData = false;
  for (const leg of currentLegs) {
    if (leg.action !== 'sell') continue;
    const sellPrice = parseFloat(leg.price)      || 0;
    const sellComm  = parseFloat(leg.commission) || 0;
    const sellFees  = parseFloat(leg.fees)       || 0;
    const sellQty   = parseFloat(leg.quantity)   || 0;
    if (sellPrice < 0 || !sellQty) continue;
    hasData = true;
    let sellLeft = sellQty, revenue = 0, buyCost = 0, buyComm = 0, buyFees = 0, matched = 0;
    for (const buy of buyQueue) {
      if (buy.remaining <= 0 || sellLeft <= 0) continue;
      const qty   = Math.min(buy.remaining, sellLeft);
      const ratio = buy.totalQty > 0 ? qty / buy.totalQty : 0;
      revenue += sellPrice * qty * mult;
      buyCost += buy.price * qty * mult;
      buyComm += buy.comm * ratio;
      buyFees += buy.fees * ratio;
      matched += qty;
      buy.remaining -= qty;
      sellLeft      -= qty;
    }
    if (matched > 0) {
      const sellRatio = sellQty > 0 ? matched / sellQty : 1;
      pnl += revenue - buyCost - sellComm * sellRatio - sellFees * sellRatio - buyComm - buyFees;
    }
  }

  if (!hasData) {
    el.textContent = '—';
    el.style.color = 'var(--text-muted)';
  } else {
    pnl = Math.round(pnl * 100) / 100;
    el.textContent = (pnl < 0 ? '-$' : '$') + Math.abs(pnl).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
    el.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
  }

  // Show open (unmatched) position
  const openQty  = buyQueue.reduce((s, b) => s + b.remaining, 0);
  const openWrap = document.getElementById('open-pos-wrap');
  const openEl   = document.getElementById('open-pos');
  if (openQty > 0) {
    const unit = document.getElementById('f-type').value === 'option' ? 'contract' : 'share';
    openEl.textContent = `${openQty} ${unit}${openQty !== 1 ? 's' : ''} open`;
    openEl.style.color = 'var(--accent)';
    openWrap.style.display = '';
  } else {
    openWrap.style.display = 'none';
  }

  updateTSPreview();
}

function saveTrade() {
  const sym  = document.getElementById('f-sym').value.trim().toUpperCase();
  const type = document.getElementById('f-type').value;

  if (!sym)                  return alert('Please enter a symbol.');
  if (!currentLegs.length)   return alert('Please add at least one leg.');

  for (const leg of currentLegs) {
    if (!leg.date)                                                      return alert('Each leg needs a date.');
    if (leg.action !== 'sell' && !(parseFloat(leg.price) > 0))         return alert('Each leg needs a price.');
    if (leg.action === 'sell' && parseFloat(leg.price) < 0)            return alert('Price cannot be negative.');
    if (!(parseFloat(leg.quantity) > 0))                               return alert('Each leg needs a quantity greater than 0.');
  }

  const legs = currentLegs.map(l => ({
    id:         l.id,
    action:     l.action,
    date:       l.date,
    price:      parseFloat(l.price)      || 0,
    quantity:   parseFloat(l.quantity)   || 0,
    commission: parseFloat(l.commission) || 0,
    fees:       parseFloat(l.fees)       || 0,
  }));

  const tradeDate = datetimeToDateStr(legs[0].date);

  const trade = {
    date:          tradeDate,
    symbol:        sym,
    type,
    legs,
    notes:         document.getElementById('f-notes').value.trim(),
    tags:          getCheckedTagIds(),
    mistakes:      getCheckedMistakeIds(),
    rules:         getCheckedRuleIds(),
    profitTargets: currentProfitTargets
      .map(r => ({ price: parseFloat(r.price) || 0, qty: parseFloat(r.qty) || 0 }))
      .filter(r => r.price > 0 && r.qty > 0),
    stopLoss:      currentStopLoss
      .filter(r => r.price !== '' && !isNaN(parseFloat(r.price)) && parseFloat(r.qty) > 0)
      .map(r => ({ price: parseFloat(r.price), qty: parseFloat(r.qty) })),
  };

  if (type === 'option') {
    trade.optionType  = document.getElementById('f-opttype').value;
    trade.strikePrice = parseFloat(document.getElementById('f-strike').value) || 0;
    trade.expiryDate  = document.getElementById('f-expiry').value;
  }

  const trades = load();
  if (editingId) {
    const idx = trades.findIndex(t => t.id === editingId);
    if (idx !== -1) { trade.id = editingId; trades[idx] = trade; }
  } else {
    trade.id = uid();
    trades.push(trade);
  }

  save(trades);
  hideForm();
  clearForm();

  if (!activeWeekStart) activeDate = tradeDate;
  refreshCurrentModal();
  renderStats();
  renderCalendar();
  if (state.view === 'trades') renderTrades();
}

function deleteTrade(id) {
  if (!confirm('Delete this trade?')) return;
  save(load().filter(t => t.id !== id));
  refreshCurrentModal();
  renderStats();
  renderCalendar();
  if (state.view === 'trades') renderTrades();
}

// ─── TRADING RULES ───

function renderRulesInForm(checkedIds = []) {
  const rules = loadRules();
  const list  = document.getElementById('f-rules-list');
  if (!rules.length) {
    list.innerHTML = '<div class="rules-empty">No rules yet — add one below.</div>';
    return;
  }
  list.innerHTML = rules.map(r => `
    <div class="rule-item" id="rule-row-${r.id}">
      <input type="checkbox" class="rule-check" value="${r.id}" ${checkedIds.includes(r.id) ? 'checked' : ''}>
      <span class="rule-text">${escHtml(r.text)}</span>
      <button class="rule-icon-btn" type="button" onclick="startEditRule('${r.id}',event)" title="Edit rule">&#9998;</button>
      <button class="rule-del-btn" type="button" onclick="deleteRule('${r.id}',event)" title="Remove rule">&#10005;</button>
    </div>`
  ).join('');
}

function startEditRule(id, e) {
  e.preventDefault();
  e.stopPropagation();
  const row  = document.getElementById(`rule-row-${id}`);
  const rule = loadRules().find(r => r.id === id);
  if (!row || !rule) return;
  const checked = row.querySelector('.rule-check').checked;
  row.innerHTML = `
    <input type="checkbox" class="rule-check" value="${id}" ${checked ? 'checked' : ''}>
    <input type="text" class="rule-edit-input" value="${escHtml(rule.text)}"
      onkeydown="onRuleEditKey('${id}',event)" onclick="event.stopPropagation()">
    <button class="rule-icon-btn rule-save-btn" type="button" onclick="saveRuleEdit('${id}',event)" title="Save">&#10003;</button>
    <button class="rule-del-btn" type="button" onclick="cancelRuleEdit(event)" title="Cancel">&#10005;</button>`;
  row.querySelector('.rule-edit-input').focus();
}

function onRuleEditKey(id, e) {
  if (e.key === 'Enter')  { e.preventDefault(); saveRuleEdit(id, e); }
  if (e.key === 'Escape') { e.preventDefault(); cancelRuleEdit(e); }
}

function saveRuleEdit(id, e) {
  e.preventDefault();
  e.stopPropagation();
  const row  = document.getElementById(`rule-row-${id}`);
  const text = row.querySelector('.rule-edit-input').value.trim();
  if (!text) return;
  const rules = loadRules();
  const idx   = rules.findIndex(r => r.id === id);
  if (idx !== -1) rules[idx].text = text;
  saveRules(rules);
  renderRulesInForm(getCheckedRuleIds());
}

function cancelRuleEdit(e) {
  e.preventDefault();
  e.stopPropagation();
  renderRulesInForm(getCheckedRuleIds());
}

function getCheckedRuleIds() {
  return Array.from(document.querySelectorAll('.rule-check:checked')).map(el => el.value);
}

function addRuleOnTheFly() {
  const input = document.getElementById('f-new-rule');
  const text  = input.value.trim();
  if (!text) return;
  const rules = loadRules();
  rules.push({ id: uid(), text });
  saveRules(rules);
  input.value = '';
  renderRulesInForm(getCheckedRuleIds());
}

function deleteRule(id, e) {
  e.preventDefault();
  e.stopPropagation();
  if (!confirm('Remove this rule from all future trades?')) return;
  saveRules(loadRules().filter(r => r.id !== id));
  renderRulesInForm(getCheckedRuleIds());
}

// ─── CUSTOM TAGS ───

function renderTagsInForm(checkedIds = []) {
  const tags = loadTags();
  const list = document.getElementById('f-tags-list');
  if (!tags.length) {
    list.innerHTML = '<div class="tags-empty">No tags yet — add one below.</div>';
    return;
  }
  list.innerHTML = tags.map(tg => `
    <div class="tag-item" id="tag-row-${tg.id}">
      <input type="checkbox" class="tag-check" value="${tg.id}" ${checkedIds.includes(tg.id) ? 'checked' : ''}>
      <span class="tag-text">${escHtml(tg.text)}</span>
      <button class="tag-icon-btn" type="button" onclick="startEditTag('${tg.id}',event)" title="Edit tag">&#9998;</button>
      <button class="tag-del-btn"  type="button" onclick="deleteTag('${tg.id}',event)"   title="Remove tag">&#10005;</button>
    </div>`
  ).join('');
}

function startEditTag(id, e) {
  e.preventDefault();
  e.stopPropagation();
  const row = document.getElementById(`tag-row-${id}`);
  const tag = loadTags().find(tg => tg.id === id);
  if (!row || !tag) return;
  const checked = row.querySelector('.tag-check').checked;
  row.innerHTML = `
    <input type="checkbox" class="tag-check" value="${id}" ${checked ? 'checked' : ''}>
    <input type="text" class="tag-edit-input" value="${escHtml(tag.text)}"
      onkeydown="onTagEditKey('${id}',event)" onclick="event.stopPropagation()">
    <button class="tag-icon-btn tag-save-btn" type="button" onclick="saveTagEdit('${id}',event)" title="Save">&#10003;</button>
    <button class="tag-del-btn" type="button" onclick="cancelTagEdit(event)" title="Cancel">&#10005;</button>`;
  row.querySelector('.tag-edit-input').focus();
}

function onTagEditKey(id, e) {
  if (e.key === 'Enter')  { e.preventDefault(); saveTagEdit(id, e); }
  if (e.key === 'Escape') { e.preventDefault(); cancelTagEdit(e); }
}

function saveTagEdit(id, e) {
  e.preventDefault();
  e.stopPropagation();
  const row  = document.getElementById(`tag-row-${id}`);
  const text = row.querySelector('.tag-edit-input').value.trim();
  if (!text) return;
  const tags = loadTags();
  const idx  = tags.findIndex(tg => tg.id === id);
  if (idx !== -1) tags[idx].text = text;
  saveTags(tags);
  renderTagsInForm(getCheckedTagIds());
}

function cancelTagEdit(e) {
  e.preventDefault();
  e.stopPropagation();
  renderTagsInForm(getCheckedTagIds());
}

function getCheckedTagIds() {
  return Array.from(document.querySelectorAll('.tag-check:checked')).map(el => el.value);
}

function addTagOnTheFly() {
  const input = document.getElementById('f-new-tag');
  const text  = input.value.trim();
  if (!text) return;
  const tags = loadTags();
  tags.push({ id: uid(), text });
  saveTags(tags);
  input.value = '';
  renderTagsInForm(getCheckedTagIds());
}

function deleteTag(id, e) {
  e.preventDefault();
  e.stopPropagation();
  if (!confirm('Remove this tag?')) return;
  saveTags(loadTags().filter(tg => tg.id !== id));
  renderTagsInForm(getCheckedTagIds());
}

// ─── MISTAKES ───

function renderMistakesInForm(checkedIds = []) {
  const mistakes = loadMistakes();
  const list = document.getElementById('f-mistakes-list');
  if (!mistakes.length) {
    list.innerHTML = '<div class="mistakes-empty">No mistakes yet — add one below.</div>';
    return;
  }
  list.innerHTML = mistakes.map(m => `
    <div class="mistake-item" id="mistake-row-${m.id}">
      <input type="checkbox" class="mistake-check" value="${m.id}" ${checkedIds.includes(m.id) ? 'checked' : ''}>
      <span class="mistake-text">${escHtml(m.text)}</span>
      <button class="mistake-icon-btn" type="button" onclick="startEditMistake('${m.id}',event)" title="Edit mistake">&#9998;</button>
      <button class="mistake-del-btn"  type="button" onclick="deleteMistake('${m.id}',event)"   title="Remove mistake">&#10005;</button>
    </div>`
  ).join('');
}

function startEditMistake(id, e) {
  e.preventDefault();
  e.stopPropagation();
  const row     = document.getElementById(`mistake-row-${id}`);
  const mistake = loadMistakes().find(m => m.id === id);
  if (!row || !mistake) return;
  const checked = row.querySelector('.mistake-check').checked;
  row.innerHTML = `
    <input type="checkbox" class="mistake-check" value="${id}" ${checked ? 'checked' : ''}>
    <input type="text" class="mistake-edit-input" value="${escHtml(mistake.text)}"
      onkeydown="onMistakeEditKey('${id}',event)" onclick="event.stopPropagation()">
    <button class="mistake-icon-btn mistake-save-btn" type="button" onclick="saveMistakeEdit('${id}',event)" title="Save">&#10003;</button>
    <button class="mistake-del-btn" type="button" onclick="cancelMistakeEdit(event)" title="Cancel">&#10005;</button>`;
  row.querySelector('.mistake-edit-input').focus();
}

function onMistakeEditKey(id, e) {
  if (e.key === 'Enter')  { e.preventDefault(); saveMistakeEdit(id, e); }
  if (e.key === 'Escape') { e.preventDefault(); cancelMistakeEdit(e); }
}

function saveMistakeEdit(id, e) {
  e.preventDefault();
  e.stopPropagation();
  const row  = document.getElementById(`mistake-row-${id}`);
  const text = row.querySelector('.mistake-edit-input').value.trim();
  if (!text) return;
  const mistakes = loadMistakes();
  const idx      = mistakes.findIndex(m => m.id === id);
  if (idx !== -1) mistakes[idx].text = text;
  saveMistakes(mistakes);
  renderMistakesInForm(getCheckedMistakeIds());
}

function cancelMistakeEdit(e) {
  e.preventDefault();
  e.stopPropagation();
  renderMistakesInForm(getCheckedMistakeIds());
}

function getCheckedMistakeIds() {
  return Array.from(document.querySelectorAll('.mistake-check:checked')).map(el => el.value);
}

function addMistakeOnTheFly() {
  const input = document.getElementById('f-new-mistake');
  const text  = input.value.trim();
  if (!text) return;
  const mistakes = loadMistakes();
  mistakes.push({ id: uid(), text });
  saveMistakes(mistakes);
  input.value = '';
  renderMistakesInForm(getCheckedMistakeIds());
}

function deleteMistake(id, e) {
  e.preventDefault();
  e.stopPropagation();
  if (!confirm('Remove this mistake?')) return;
  saveMistakes(loadMistakes().filter(m => m.id !== id));
  renderMistakesInForm(getCheckedMistakeIds());
}
