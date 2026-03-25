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
      <div class="ds-value ${pnlCls}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</div>
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
  const pStr = (p < 0 ? '-$' : '$') + Math.abs(p).toFixed(2);
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

  const tagsLine = (() => {
    if (!t.tags || !t.tags.length) return '';
    const allTags = loadTags();
    const names = t.tags.map(id => { const tg = allTags.find(x => x.id === id); return tg ? escHtml(tg.text) : null; }).filter(Boolean);
    return names.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${names.map(n => `<span class="trade-tag-badge">${n}</span>`).join('')}</div>` : '';
  })();

  const rulesLine = (() => {
    if (!t.rules || !t.rules.length) return '';
    const allRules = loadRules();
    const names = t.rules.map(id => { const r = allRules.find(x => x.id === id); return r ? escHtml(r.text) : null; }).filter(Boolean);
    return names.length ? `<div style="color:var(--accent);font-size:11px;margin-top:4px">&#10003; ${names.join(' &bull; ')}</div>` : '';
  })();

  return `<div class="trade-item">
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <div class="ti-sym">${t.symbol}</div>
        ${typeBadge}
      </div>
      ${legsHtml}
      ${t.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-style:italic">${escHtml(t.notes)}</div>` : ''}
      ${tagsLine}
      ${rulesLine}
    </div>
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
      <div class="ds-value ${pnlCls}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</div>
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

let currentLegs = [];

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
  calcPreview();
}

function renderLegsGrid() {
  const body = document.getElementById('f-legs-body');
  if (!currentLegs.length) {
    body.innerHTML = '<div class="legs-empty">No legs yet — click + Buy or + Sell to add one.</div>';
    calcPreview();
    return;
  }
  body.innerHTML = currentLegs.map(leg => `
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
      <button class="leg-del-btn" type="button" onclick="removeLeg('${leg.id}')">&#10005;</button>
    </div>`
  ).join('');
  calcPreview();
}

// ─── TRADE FORM ───

function showForm(id) {
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
    renderTagsInForm(t.tags   || []);
    renderRulesInForm(t.rules || []);

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
  document.getElementById('trade-form').style.display  = 'block';
  document.getElementById('trade-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideForm() {
  document.getElementById('trade-form').style.display  = 'none';
  document.getElementById('add-row-btn').style.display = 'flex';
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
  currentLegs = [];
  renderLegsGrid();
  renderTagsInForm([]);
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
    if (!sellPrice || !sellQty) continue;
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
    el.textContent = (pnl < 0 ? '-$' : '$') + Math.abs(pnl).toFixed(2);
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
}

function saveTrade() {
  const sym  = document.getElementById('f-sym').value.trim().toUpperCase();
  const type = document.getElementById('f-type').value;

  if (!sym)                  return alert('Please enter a symbol.');
  if (!currentLegs.length)   return alert('Please add at least one leg.');

  for (const leg of currentLegs) {
    if (!leg.date)                            return alert('Each leg needs a date.');
    if (!parseFloat(leg.price) > 0)           return alert('Each leg needs a price.');
    if (!(parseFloat(leg.quantity) > 0))      return alert('Each leg needs a quantity greater than 0.');
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
    date:   tradeDate,
    symbol: sym,
    type,
    legs,
    notes: document.getElementById('f-notes').value.trim(),
    tags:  getCheckedTagIds(),
    rules: getCheckedRuleIds(),
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
