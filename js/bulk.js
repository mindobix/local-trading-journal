// ─── BULK TRADE ENTRY ───

let bulkRows = [];
let activeBulkCellDd = null;

// ─── OPEN / CLOSE ───

function openBulkTradesView() {
  state.prevView = state.view;
  initBulkRows();
  document.getElementById('view-bulk').style.display = 'flex';
  window.addEventListener('beforeunload', _bulkBeforeUnload);
}

function _bulkIsActive() {
  return document.getElementById('view-bulk')?.style.display !== 'none';
}

function _bulkHasData() {
  return bulkRows.some(r =>
    r.symbol.trim() || r.price !== '' || r.quantity !== '' || r.notes.trim()
  );
}

function _bulkBeforeUnload(e) {
  if (_bulkIsActive() && _bulkHasData()) {
    e.preventDefault();
    e.returnValue = '';
  }
}

function _bulkConfirmLeave() {
  if (!_bulkHasData()) return true;
  return confirm('You have unsaved bulk trades. Leave and discard them?');
}

function closeBulkView() {
  if (!_bulkConfirmLeave()) return;
  _bulkCleanup();
  switchView(state.prevView || 'calendar');
}

function _bulkCleanup() {
  closeBulkCellDd();
  document.getElementById('view-bulk').style.display = 'none';
  window.removeEventListener('beforeunload', _bulkBeforeUnload);
}

// ─── ROW MANAGEMENT ───

function initBulkRows() {
  bulkRows = [];
  bulkRows.push(_newBulkRow('T1'));
  _hideBulkMsg();
  renderBulkGrid();
}

function _newBulkRow(tradeId, src) {
  return {
    rowId:       uid(),
    tradeId,
    symbol:      src?.symbol      ?? '',
    type:        src?.type        ?? 'option',
    optionType:  src?.optionType  ?? '',
    strikePrice: src?.strikePrice ?? '',
    expiryDate:  src?.expiryDate  ?? '',
    action:      src?.action      ?? 'buy',
    datetime:    src?.datetime    ?? nowDatetime(),
    price:       '',
    quantity:    src?.quantity    ?? '',
    commission:  src?.commission  ?? '0',
    fees:        src?.fees        ?? '0',
    notes:       '',
    tags:        src ? [...src.tags]     : [],
    mistakes:    src ? [...src.mistakes] : [],
    rules:       src ? [...src.rules]    : [],
  };
}

function _copyBulkRow(src) {
  return _newBulkRow(src.tradeId, src);
}

function addBulkRow(count) {
  const last = bulkRows[bulkRows.length - 1];
  for (let i = 0; i < count; i++) {
    bulkRows.push(last ? _copyBulkRow(last) : _newBulkRow('T1'));
  }
  renderBulkGrid();
  _scrollBulkBottom();
}

function addNewBulkTrade() {
  let maxNum = 0;
  for (const r of bulkRows) {
    const m = r.tradeId.match(/^T(\d+)$/i);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
  }
  const last = bulkRows[bulkRows.length - 1];
  const row  = _newBulkRow('T' + (maxNum + 1));
  if (last) { row.commission = last.commission; row.fees = last.fees; }
  bulkRows.push(row);
  renderBulkGrid();
  _scrollBulkBottom();
}

function deleteBulkRow(rowId) {
  bulkRows = bulkRows.filter(r => r.rowId !== rowId);
  if (!bulkRows.length) bulkRows.push(_newBulkRow('T1'));
  renderBulkGrid();
}

function updateBulkField(rowId, field, value) {
  const row = bulkRows.find(r => r.rowId === rowId);
  if (row) row[field] = value;
}

function bulkToggleOptCells(rowId, isOpt) {
  const tr = document.querySelector(`.bulk-row[data-rowid="${rowId}"]`);
  if (!tr) return;
  tr.querySelectorAll('.bof').forEach(el => {
    el.disabled = !isOpt;
    el.closest('td').classList.toggle('bcd', !isOpt);
  });
}

function _scrollBulkBottom() {
  const outer = document.querySelector('.bulk-grid-outer');
  if (outer) setTimeout(() => { outer.scrollTop = outer.scrollHeight; }, 60);
}

// ─── RENDER ───

function renderBulkGrid() {
  closeBulkCellDd();
  const tbody = document.getElementById('bulk-tbody');
  if (!tbody) return;

  // Assign group index per unique tradeId (appearance order)
  const groupMap = {};
  let gi = 0;
  for (const row of bulkRows) {
    if (!(row.tradeId in groupMap)) groupMap[row.tradeId] = gi++;
  }

  const ev = s => escHtml(String(s ?? ''));

  tbody.innerHTML = bulkRows.map(r => {
    const isOpt  = r.type === 'option';
    const altCls = groupMap[r.tradeId] % 2 === 1 ? ' bulk-row-alt' : '';
    const tl = r.tags.length     ? r.tags.length     + ' ✓' : '—';
    const ml = r.mistakes.length ? r.mistakes.length + ' ✓' : '—';
    const rl = r.rules.length    ? r.rules.length    + ' ✓' : '—';
    const hst = r.tags.length     ? ' has-sel' : '';
    const hsm = r.mistakes.length ? ' has-sel' : '';
    const hsr = r.rules.length    ? ' has-sel' : '';

    // col indices: 0=del, 1=tid, 2=sym, 3=type, 4=opttype, 5=strike, 6=expiry, 7=action, 8=dt, 9=price, 10=qty, 11=comm, 12=fees, 13=tags, 14=mistakes, 15=rules, 16=notes
    return `<tr class="bulk-row${altCls}" data-rowid="${r.rowId}">
  <td><button class="bulk-del-btn" onclick="deleteBulkRow('${r.rowId}')" title="Remove row">&#10005;</button></td>
  <td><input class="bulk-input bulk-tid" value="${ev(r.tradeId)}" placeholder="T1"
    oninput="updateBulkField('${r.rowId}','tradeId',this.value.toUpperCase());this.value=this.value.toUpperCase()"></td>
  <td><input class="bulk-input bulk-sym" value="${ev(r.symbol)}" placeholder="AAPL"
    oninput="updateBulkField('${r.rowId}','symbol',this.value.toUpperCase());this.value=this.value.toUpperCase()"
    onblur="bulkAutoFillSymbol('${r.rowId}',this.value)"></td>
  <td><select class="bulk-select" onchange="updateBulkField('${r.rowId}','type',this.value);bulkToggleOptCells('${r.rowId}',this.value==='option')">
    <option value="stock"${r.type==='stock'?' selected':''}>Stock</option>
    <option value="option"${r.type==='option'?' selected':''}>Option</option>
  </select></td>
  <td class="${!isOpt?'bcd':''}"><select class="bulk-select bof"${!isOpt?' disabled':''} onchange="updateBulkField('${r.rowId}','optionType',this.value)">
    <option value="">—</option>
    <option value="call"${r.optionType==='call'?' selected':''}>Call</option>
    <option value="put"${r.optionType==='put'?' selected':''}>Put</option>
  </select></td>
  <td class="${!isOpt?'bcd':''}"><input class="bulk-input bulk-num bof"${!isOpt?' disabled':''} type="number" step="0.01" min="0" value="${ev(r.strikePrice)}" placeholder="0.00"
    oninput="updateBulkField('${r.rowId}','strikePrice',this.value)"></td>
  <td class="${!isOpt?'bcd':''}"><input class="bulk-input bulk-date bof"${!isOpt?' disabled':''} type="date" value="${ev(r.expiryDate)}"
    onchange="updateBulkField('${r.rowId}','expiryDate',this.value)"></td>
  <td><select class="bulk-select" onchange="updateBulkField('${r.rowId}','action',this.value);this.className='bulk-select '+(this.value==='buy'?'bulk-buy':'bulk-sell')">
    <option class="bulk-buy" value="buy"${r.action==='buy'?' selected':''}>Buy</option>
    <option class="bulk-sell" value="sell"${r.action==='sell'?' selected':''}>Sell</option>
  </select></td>
  <td><input class="bulk-input bulk-dt" type="datetime-local" value="${ev(r.datetime)}"
    onchange="updateBulkField('${r.rowId}','datetime',this.value)"></td>
  <td><input class="bulk-input bulk-num" type="number" step="0.01" min="0" value="${ev(r.price)}" placeholder="0.00"
    oninput="updateBulkField('${r.rowId}','price',this.value)"></td>
  <td><input class="bulk-input bulk-num" type="number" step="1" min="1" value="${ev(r.quantity)}" placeholder="0"
    oninput="updateBulkField('${r.rowId}','quantity',this.value)"></td>
  <td><input class="bulk-input bulk-num" type="number" step="0.01" min="0" value="${ev(r.commission)}"
    oninput="updateBulkField('${r.rowId}','commission',this.value)"></td>
  <td><input class="bulk-input bulk-num" type="number" step="0.01" min="0" value="${ev(r.fees)}"
    oninput="updateBulkField('${r.rowId}','fees',this.value)"></td>
  <td class="bulk-dd-cell"><button class="bulk-dd-btn${hst}" data-dtype="tags"
    onclick="toggleBulkCellDd(event,'${r.rowId}','tags')">${tl}</button></td>
  <td class="bulk-dd-cell"><button class="bulk-dd-btn${hsm}" data-dtype="mistakes"
    onclick="toggleBulkCellDd(event,'${r.rowId}','mistakes')">${ml}</button></td>
  <td class="bulk-dd-cell"><button class="bulk-dd-btn${hsr}" data-dtype="rules"
    onclick="toggleBulkCellDd(event,'${r.rowId}','rules')">${rl}</button></td>
  <td><input class="bulk-input bulk-notes" type="text" value="${ev(r.notes)}" placeholder="Optional…"
    oninput="updateBulkField('${r.rowId}','notes',this.value)"></td>
</tr>`;
  }).join('');

  // Apply buy/sell color to selects after render
  tbody.querySelectorAll('.bulk-row').forEach(tr => {
    const sel = tr.querySelectorAll('select')[2]; // action select
    if (sel) sel.className = 'bulk-select ' + (sel.value === 'buy' ? 'bulk-buy' : 'bulk-sell');
  });

  _updateBulkCountLabel();
}

// ─── CELL DROPDOWN (tags / mistakes / rules) ───

function toggleBulkCellDd(event, rowId, type) {
  event.stopPropagation();
  // Close if same cell re-clicked
  if (activeBulkCellDd && activeBulkCellDd.rowId === rowId && activeBulkCellDd.type === type) {
    closeBulkCellDd();
    return;
  }
  closeBulkCellDd();

  const row   = bulkRows.find(r => r.rowId === rowId);
  if (!row) return;
  const items = type === 'tags' ? loadTags() : type === 'mistakes' ? loadMistakes() : loadRules();
  const sel   = row[type];
  const btn   = event.currentTarget;
  const rect  = btn.getBoundingClientRect();

  const dd = document.createElement('div');
  dd.className = 'bulk-cell-dd';
  dd.id        = 'active-bulk-cell-dd';

  if (!items.length) {
    dd.innerHTML = `<div class="bulk-cell-dd-empty">No ${type} configured yet.<br>Add them in the trade entry form.</div>`;
  } else {
    const title = type.charAt(0).toUpperCase() + type.slice(1);
    dd.innerHTML = `<div class="bulk-cell-dd-title">${title}</div>` +
      items.map(item =>
        `<label class="bulk-cell-dd-item">
          <input type="checkbox" value="${item.id}"${sel.includes(item.id) ? ' checked' : ''}
            onchange="onBulkCellCheck('${rowId}','${type}','${item.id}',this.checked)">
          <span>${escHtml(item.text)}</span>
        </label>`
      ).join('');
  }

  document.body.appendChild(dd);

  // Position fixed relative to viewport
  const ddW = 220;
  let left = rect.left;
  if (left + ddW > window.innerWidth - 8) left = rect.right - ddW;
  let top = rect.bottom + 4;
  const ddH = Math.min(items.length * 34 + 44, 260);
  if (top + ddH > window.innerHeight - 8) top = rect.top - ddH - 4;

  dd.style.cssText = `position:fixed;top:${top}px;left:${Math.max(4,left)}px;width:${ddW}px`;
  activeBulkCellDd = { rowId, type, el: dd };
}

function onBulkCellCheck(rowId, type, itemId, checked) {
  const row = bulkRows.find(r => r.rowId === rowId);
  if (!row) return;
  if (checked) {
    if (!row[type].includes(itemId)) row[type].push(itemId);
  } else {
    row[type] = row[type].filter(id => id !== itemId);
  }
  // Update button label without full re-render
  const tr = document.querySelector(`.bulk-row[data-rowid="${rowId}"]`);
  if (tr) {
    const btn = tr.querySelector(`.bulk-dd-btn[data-dtype="${type}"]`);
    if (btn) {
      const count = row[type].length;
      btn.textContent = count ? `${count} ✓` : '—';
      btn.classList.toggle('has-sel', count > 0);
    }
  }
}

// Auto-fill symbol for other rows of the same trade that have no symbol yet
function bulkAutoFillSymbol(rowId, symbol) {
  const row = bulkRows.find(r => r.rowId === rowId);
  if (!row || !symbol) return;
  const tid = row.tradeId;
  for (const r of bulkRows) {
    if (r.rowId !== rowId && r.tradeId === tid && !r.symbol) {
      r.symbol = symbol;
      const tr = document.querySelector(`.bulk-row[data-rowid="${r.rowId}"]`);
      if (tr) {
        const inp = tr.querySelector('.bulk-sym');
        if (inp) inp.value = symbol;
      }
    }
  }
}

function closeBulkCellDd() {
  if (activeBulkCellDd?.el?.parentNode) activeBulkCellDd.el.remove();
  activeBulkCellDd = null;
  const existing = document.getElementById('active-bulk-cell-dd');
  if (existing) existing.remove();
}

document.addEventListener('click', function(e) {
  if (activeBulkCellDd && !activeBulkCellDd.el.contains(e.target)) {
    closeBulkCellDd();
  }
});

// ─── COUNT LABEL ───

function _updateBulkCountLabel() {
  const tradeIds = new Set(bulkRows.map(r => r.tradeId.trim()).filter(Boolean));
  const el = document.getElementById('bulk-count-label');
  if (el) el.textContent =
    `${tradeIds.size} trade${tradeIds.size !== 1 ? 's' : ''} · ${bulkRows.length} row${bulkRows.length !== 1 ? 's' : ''}`;
}

function _hideBulkMsg() {
  const p = document.getElementById('bulk-msg-panel');
  if (p) p.style.display = 'none';
}

// ─── SAVE ───

function saveBulkTrades() {
  // Clear previous highlights
  document.querySelectorAll('.bulk-row.bulk-row-err').forEach(tr => tr.classList.remove('bulk-row-err'));
  document.querySelectorAll('.bulk-cell-err').forEach(td => td.classList.remove('bulk-cell-err'));

  const errors = [];

  bulkRows.forEach((row, i) => {
    const tr     = document.querySelector(`.bulk-row[data-rowid="${row.rowId}"]`);
    const cells  = tr ? [...tr.querySelectorAll('td')] : [];
    const mark   = idx => { if (cells[idx]) cells[idx].classList.add('bulk-cell-err'); };
    const issues = [];

    // col: 0=del,1=tid,2=sym,3=type,4=opttype,5=strike,6=expiry,7=action,8=dt,9=price,10=qty,11=comm,12=fees,13=tags,14=mistakes,15=rules,16=notes
    if (!row.tradeId.trim())            { issues.push('Trade ID required');              mark(1); }
    if (!row.symbol.trim())             { issues.push('Symbol required');                mark(2); }
    if (!['buy','sell'].includes(row.action)) { issues.push('Action required');          mark(7); }
    if (!row.datetime || !isValidDatetime(row.datetime)) { issues.push('Valid date & time required'); mark(8); }

    const price = parseFloat(row.price);
    if (isNaN(price) || price < 0)      { issues.push('Price must be ≥ 0');              mark(9); }

    const qty = parseFloat(row.quantity);
    if (isNaN(qty)   || qty   <= 0)     { issues.push('Quantity must be > 0');           mark(10); }

    if (row.type === 'option') {
      if (!['call','put'].includes(row.optionType)) { issues.push('Option type required'); mark(4); }
      if (!row.strikePrice || isNaN(parseFloat(row.strikePrice))) { issues.push('Strike price required'); mark(5); }
      if (!isValidDate(row.expiryDate)) { issues.push('Expiry date required');            mark(6); }
    }

    if (issues.length) {
      if (tr) tr.classList.add('bulk-row-err');
      errors.push({ rowNum: i + 1, tradeId: row.tradeId || '?', issues });
    }
  });

  if (errors.length) {
    const panel = document.getElementById('bulk-msg-panel');
    panel.className = 'bulk-msg-panel bulk-msg-error';
    panel.style.display = 'block';
    panel.innerHTML =
      `<div class="bulk-msg-hdr">
        <span>&#9888;&nbsp; ${errors.length} row${errors.length !== 1 ? 's' : ''} with errors — fix highlighted fields and try again</span>
        <button class="bulk-msg-x" onclick="_hideBulkMsg()">&#10005;</button>
      </div>
      <div class="bulk-msg-errs">${
        errors.map(e =>
          `<div class="bulk-msg-err-row"><strong>${escHtml(e.tradeId)} Row ${e.rowNum}:</strong> ${escHtml(e.issues.join(' · '))}</div>`
        ).join('')
      }</div>`;
    const first = document.querySelector('.bulk-row-err');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Build trade objects grouped by tradeId (preserve entry order)
  const tradeMap   = {};
  const tradeOrder = [];
  for (const row of bulkRows) {
    const tid = row.tradeId.trim().toUpperCase();
    if (!tradeMap[tid]) {
      tradeMap[tid] = {
        id:           uid(),
        symbol:       row.symbol.trim().toUpperCase(),
        type:         row.type,
        optionType:   row.type === 'option' ? (row.optionType  || null) : null,
        strikePrice:  row.type === 'option' ? (parseFloat(row.strikePrice) || null) : null,
        expiryDate:   row.type === 'option' ? (row.expiryDate  || null) : null,
        notes:        row.notes || '',
        tags:         [...row.tags],
        mistakes:     [...row.mistakes],
        rules:        [...row.rules],
        profitTargets: [],
        stopLoss:     [],
        legs:         [],
      };
      tradeOrder.push(tid);
    }
    tradeMap[tid].legs.push({
      id:         uid(),
      action:     row.action,
      date:       normalizeDateTime(row.datetime),
      price:      parseFloat(row.price),
      quantity:   parseFloat(row.quantity),
      commission: parseFloat(row.commission) || 0,
      fees:       parseFloat(row.fees)       || 0,
    });
  }

  const newTrades = tradeOrder.map(tid => {
    const t = tradeMap[tid];
    t.date  = t.legs[0].date.split('T')[0];
    return t;
  });

  const dates    = newTrades.map(t => t.date).sort();
  const minDate  = dates[0];
  const maxDate  = dates[dates.length - 1];
  const legCount = newTrades.reduce((s, t) => s + t.legs.length, 0);

  save([...load(), ...newTrades]);
  renderStats();

  // Reset grid to empty, ready for the next batch
  initBulkRows();

  // Show persistent success toast with link — stay on bulk page
  const panel = document.getElementById('bulk-msg-panel');
  panel.className = 'bulk-msg-panel bulk-msg-success';
  panel.style.display = 'flex';
  panel.innerHTML =
    `<span>&#10003;&nbsp; ${newTrades.length} trade${newTrades.length !== 1 ? 's' : ''} (${legCount} leg${legCount !== 1 ? 's' : ''}) saved.</span>
     <a class="bulk-toast-link" href="#" onclick="closeBulkView();drFrom='${minDate}';drTo='${maxDate}';document.getElementById('gf-from').value='${minDate}';document.getElementById('gf-to').value='${maxDate}';document.getElementById('gf-date').value='custom';_updateDrBtn();switchView('trades');return false;">View Trades &rarr;</a>
     <button class="bulk-msg-x" onclick="_hideBulkMsg()" title="Dismiss">&#10005;</button>`;
}

// ─── PASTE & TRANSFORM ───

function toggleBulkPastePanel() {
  const panel = document.getElementById('bulk-paste-panel');
  const btn   = document.getElementById('bulk-paste-toggle-btn');
  const open  = panel.style.display === 'none';

  // Close the Tradezella panel if open
  if (open) {
    document.getElementById('bulk-tradezella-panel').style.display = 'none';
    document.getElementById('bulk-tz-toggle-btn').classList.remove('active');
  }

  panel.style.display = open ? 'block' : 'none';
  btn.classList.toggle('active', open);
}

function _parsePastedInstrument(raw) {
  const s = raw.trim();

  // Format A (old): "META 06-06-2025 670 CALL" — ticker + date + strike + optType
  const mA = s.match(/^(\S+)\s+(\d{2}-\d{2}-\d{4})\s+([\d.]+)\s+(CALL|PUT)$/i);
  if (mA) {
    const [, ticker, expRaw, strike, optType] = mA;
    const [mm, dd, yyyy] = expRaw.split('-');
    return {
      symbol:      ticker.toUpperCase(),
      type:        'option',
      optionType:  optType.toLowerCase(),
      strikePrice: strike,
      expiryDate:  `${yyyy}-${mm}-${dd}`,
    };
  }

  // Format B (new): "06-06-2025 300 CALL" — no ticker, date + strike + optType
  const mB = s.match(/^(\d{2}-\d{2}-\d{4})\s+([\d.]+)\s+(CALL|PUT)$/i);
  if (mB) {
    const [, expRaw, strike, optType] = mB;
    const [mm, dd, yyyy] = expRaw.split('-');
    return {
      symbol:      '',   // user fills in manually
      type:        'option',
      optionType:  optType.toLowerCase(),
      strikePrice: strike,
      expiryDate:  `${yyyy}-${mm}-${dd}`,
    };
  }

  // Plain stock / future — just a ticker symbol
  if (/^\S+$/.test(s)) {
    return { symbol: s.toUpperCase(), type: 'stock', optionType: '', strikePrice: '', expiryDate: '' };
  }
  return null;
}

function _parseMoney(val) {
  if (!val || val === '--') return '';
  return String(val).replace(/[$,\s]/g, '');
}

function _parseDatetime(raw) {
  // "06-04-2025 09:32:13" → "2025-06-04T09:33" (round up minute when seconds > 0)
  const m = raw.trim().match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const d = new Date(`${m[3]}-${m[1]}-${m[2]}T${m[4]}:${m[5]}:${m[6]}`);
    if (parseInt(m[6]) >= 50) d.setMinutes(d.getMinutes() + 1);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mo   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mo}-${dd}T${hh}:${mm}`;
  }
  // already ISO-ish — strip seconds if present, pass through trimmed
  return raw.trim().replace(' ', 'T').replace(/T(\d{2}:\d{2}):\d{2}$/, 'T$1');
}

function transformPastedTrades() {
  const ta   = document.getElementById('bulk-paste-ta');
  const raw  = ta.value.trim();
  if (!raw) return;

  const allLines = raw.split(/\r?\n/);
  const warn  = [];
  let added   = 0;

  // Determine next trade group number from existing rows
  let maxNum = 0;
  for (const r of bulkRows) {
    const m = r.tradeId.match(/^T(\d+)$/i);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
  }
  const hasRealData = _bulkHasData();

  // Map instrument key → tradeId for grouping legs of the same trade
  const instrTradeMap = {};

  // ── Detect format ──
  // New format: has date-only lines like "06-06-2025" (no tabs, no time)
  const hasDateOnlyLine = allLines.some(l => /^\d{2}-\d{2}-\d{4}\s*$/.test(l));

  if (hasDateOnlyLine) {
    // ── NEW FORMAT: 3-line groups: date / time / data ──
    const trimmed = allLines.map(l => l.trimEnd());
    let i = 0;
    while (i < trimmed.length) {
      const dateLine = trimmed[i]?.trim();
      const timeLine = trimmed[i + 1]?.trim();
      const dataLine = trimmed[i + 2]?.trim();

      if (!dateLine || !timeLine || !dataLine ||
          !/^\d{2}-\d{2}-\d{4}$/.test(dateLine) ||
          !/^\d{2}:\d{2}:\d{2}$/.test(timeLine)) {
        i++;
        continue;
      }

      const dt   = _parseDatetime(`${dateLine} ${timeLine}`);
      const cols = dataLine.split('\t').map(c => c.trim());

      // col 0 is instrument (option spec or stock ticker), col 1=qty, 2=price, 3=fee, 4=comm
      const instr = _parsePastedInstrument(cols[0]);
      if (!instr) {
        warn.push(`Skipped: unrecognised instrument "${cols[0]}"`);
        i += 3;
        continue;
      }

      const qtyNum = parseFloat((cols[1] ?? '').replace(/[$,]/g, ''));
      const action = qtyNum < 0 ? 'sell' : 'buy';
      const qty    = Math.abs(qtyNum);
      const price  = _parseMoney(cols[2]);
      const fees   = _parseMoney(cols[3]);
      const comm   = _parseMoney(cols[4]);

      // Group by instrument key
      const instrKey = `${instr.symbol}|${instr.optionType}|${instr.strikePrice}|${instr.expiryDate}`;
      if (!instrTradeMap[instrKey]) {
        maxNum++;
        instrTradeMap[instrKey] = 'T' + maxNum;
      }
      const tradeId = instrTradeMap[instrKey];

      const lastRow = bulkRows[bulkRows.length - 1];
      const reuseEmpty = !hasRealData && added === 0 &&
        !lastRow.symbol && lastRow.price === '' && lastRow.quantity === '';

      const newRow = _newBulkRow(tradeId, {
        ...instr,
        action,
        datetime:   dt,
        quantity:   isNaN(qty) ? '' : String(qty),
        commission: comm || '0',
        fees:       fees || '0',
        tags: [], mistakes: [], rules: [],
      });
      newRow.price = price || '';

      if (reuseEmpty) {
        bulkRows[bulkRows.length - 1] = newRow;
      } else {
        bulkRows.push(newRow);
      }
      added++;
      i += 3;
    }

  } else {
    // ── OLD FORMAT: single-line rows with datetime in col 0 ──
    const lines = allLines.filter(l => l.trim());

    // Detect and skip header row
    const firstCells = lines[0]?.split('\t').map(c => c.trim().toLowerCase()) ?? [];
    const isHeader   = firstCells.some(c => c.startsWith('date') || c === 'instrument' || c === 'quantity');
    const dataLines  = isHeader ? lines.slice(1) : lines;

    for (const line of dataLines) {
      const cols = line.split('\t').map(c => c.trim());
      if (cols.length < 3) continue;

      // col 0 = datetime, scan forward for instrument col
      const dtRaw = cols[0];
      if (!dtRaw || !dtRaw.match(/\d{2}[-/]\d{2}[-/]\d{4}/)) continue;

      let instrIdx = -1;
      for (let i = 1; i < cols.length; i++) {
        const c = cols[i];
        if (/^[A-Z]{1,6}\s+\d{2}-\d{2}-\d{4}/i.test(c) || /^[A-Z]{1,6}$/.test(c)) {
          instrIdx = i;
          break;
        }
      }
      if (instrIdx === -1) {
        warn.push(`Skipped: could not identify instrument in — "${line.slice(0, 60)}"`);
        continue;
      }

      const instr = _parsePastedInstrument(cols[instrIdx]);
      if (!instr) {
        warn.push(`Skipped: unrecognised instrument "${cols[instrIdx]}"`);
        continue;
      }

      const qtyRaw  = cols[instrIdx + 1] ?? '';
      const priceRaw = cols[instrIdx + 2] ?? '';
      const feeRaw  = cols[instrIdx + 3] ?? '';
      const commRaw = cols[instrIdx + 4] ?? '';

      const qtyNum = parseFloat(qtyRaw.replace(/[$,]/g, ''));
      const action = qtyNum < 0 ? 'sell' : 'buy';
      const qty    = Math.abs(qtyNum);
      const price  = _parseMoney(priceRaw);
      const fees   = _parseMoney(feeRaw);
      const comm   = _parseMoney(commRaw);
      const dt     = _parseDatetime(dtRaw);

      const instrKey = `${instr.symbol}|${instr.optionType}|${instr.strikePrice}|${instr.expiryDate}`;
      if (!instrTradeMap[instrKey]) {
        maxNum++;
        instrTradeMap[instrKey] = 'T' + maxNum;
      }
      const tradeId = instrTradeMap[instrKey];

      const lastRow = bulkRows[bulkRows.length - 1];
      const reuseEmpty = !hasRealData && added === 0 &&
        !lastRow.symbol && lastRow.price === '' && lastRow.quantity === '';

      const newRow = _newBulkRow(tradeId, {
        ...instr,
        action,
        datetime:   dt,
        quantity:   isNaN(qty) ? '' : String(qty),
        commission: comm || '0',
        fees:       fees || '0',
        tags: [], mistakes: [], rules: [],
      });
      newRow.price = price || '';

      if (reuseEmpty) {
        bulkRows[bulkRows.length - 1] = newRow;
      } else {
        bulkRows.push(newRow);
      }
      added++;
    }
  } // end old format

  renderBulkGrid();

  if (added > 0) {
    _scrollBulkBottom();
    // Collapse the panel after success
    document.getElementById('bulk-paste-panel').style.display = 'none';
    document.getElementById('bulk-paste-toggle-btn').classList.remove('active');
    ta.value = '';
    // Focus the first symbol input that has no symbol
    setTimeout(() => {
      const firstEmpty = document.querySelector('.bulk-row .bulk-sym[value=""]') ||
                         document.querySelector('.bulk-row .bulk-sym');
      if (firstEmpty) firstEmpty.focus();
    }, 60);
  }

  if (warn.length) {
    const panel = document.getElementById('bulk-msg-panel');
    panel.className = 'bulk-msg-panel bulk-msg-error';
    panel.style.display = 'block';
    panel.innerHTML =
      `<div class="bulk-msg-hdr">
        <span>&#9888;&nbsp; ${added} row${added !== 1 ? 's' : ''} added · ${warn.length} skipped</span>
        <button class="bulk-msg-x" onclick="_hideBulkMsg()">&#10005;</button>
      </div>
      <div class="bulk-msg-errs">${warn.map(w => `<div class="bulk-msg-err-row">${escHtml(w)}</div>`).join('')}</div>`;
  } else if (added > 0) {
    _hideBulkMsg();
  }
}

// ─── TRADEZELLA CSV IMPORT ───

function toggleTradezellaPanel() {
  const panel  = document.getElementById('bulk-tradezella-panel');
  const btn    = document.getElementById('bulk-tz-toggle-btn');
  const open   = panel.style.display === 'none';

  panel.style.display = open ? 'block' : 'none';
  btn.classList.toggle('active', open);
}

function onTradezellaFileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('bulk-tz-ta').value = e.target.result;
  };
  reader.readAsText(file);
  // Reset so the same file can be re-selected
  input.value = '';
}

// Parse a Tradezella datetime: dateStr="2025-05-27", timeStr="09:39:22 EDT"
// Returns "YYYY-MM-DDTHH:MM" with second round-up rule (secs > 50 → bump minute).
function _parseTzDatetime(dateStr, timeStr) {
  // Strip timezone suffix (e.g. " EDT", " EST", " UTC")
  const timePart = timeStr.trim().replace(/\s+[A-Z]{2,5}$/, '');
  const combined = `${dateStr.trim()}T${timePart}`;
  const d = new Date(combined);
  if (isNaN(d.getTime())) return combined.slice(0, 16);

  const secs = parseInt(timePart.split(':')[2] ?? '0', 10);
  if (secs > 50) d.setMinutes(d.getMinutes() + 1, 0, 0);

  const yyyy = d.getFullYear();
  const mo   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  const hh   = String(d.getHours()).padStart(2, '0');
  const mm   = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mo}-${dd}T${hh}:${mm}`;
}

// Extract HH and MM as integers from a time string like "09:39:22 EDT"
function _tzTimeToMinutes(timeStr) {
  const clean = timeStr.trim().replace(/\s+[A-Z]{2,5}$/, '');
  const parts = clean.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// Parse Tradezella Instrument column into bulk-row fields.
// symbol = Symbol column value (e.g. "TSLA", "SPXW")
// instrument = Instrument column (e.g. "2025-05-30 350 CALL" or "TSLA")
// spreadType = "single" | "stock"
function _parseTzInstrument(symbol, instrument, spreadType) {
  const instr = instrument.trim();

  // Option format: "2025-05-30 350 CALL" or "2025-05-30 5970 CALL"
  const mOpt = instr.match(/^(\d{4}-\d{2}-\d{2})\s+([\d.]+)\s+(CALL|PUT)$/i);
  if (mOpt) {
    return {
      symbol:      symbol.trim().toUpperCase(),
      type:        'option',
      optionType:  mOpt[3].toLowerCase(),
      strikePrice: mOpt[2],
      expiryDate:  mOpt[1],
    };
  }

  // Fallback: stock (spread type = "stock" or instrument is just a ticker)
  return {
    symbol:      symbol.trim().toUpperCase(),
    type:        'stock',
    optionType:  '',
    strikePrice: '',
    expiryDate:  '',
  };
}

// Look up a mistake by text (case-insensitive). If missing, create + persist it.
// mutates mistakesList in place and calls saveMistakes().
function _getOrCreateMistakeId(text, mistakesList) {
  const lower = text.toLowerCase();
  let entry = mistakesList.find(m => m.text.toLowerCase() === lower);
  if (!entry) {
    entry = { id: uid(), text };
    mistakesList.push(entry);
    saveMistakes(mistakesList);
  }
  return entry.id;
}

// Evaluate all auto-tagging rules and return an array of mistake IDs.
// openTimeStr = raw time string from CSV e.g. "09:39:22 EDT"
function _tzAutoMistakes(symbol, openTimeStr, quantity, entryPrice, type, mistakesList) {
  const ids  = [];
  const mins = _tzTimeToMinutes(openTimeStr);  // minutes since midnight (local)
  const sym  = symbol.trim().toUpperCase();
  const qty  = parseFloat(quantity) || 0;
  const ep   = parseFloat(entryPrice) || 0;

  const T930  = 9  * 60 + 30;
  const T1130 = 11 * 60 + 30;
  const T1600 = 16 * 60;       // 4:00 PM
  const T1630 = 16 * 60 + 30;  // 4:30 PM

  // 1. Always: Not Planned Trade
  ids.push(_getOrCreateMistakeId('Not Planned Trade', mistakesList));

  // 2. Pre & After Hours: open < 9:30 AM or open > 4:30 PM
  if (mins < T930 || mins > T1630) {
    ids.push(_getOrCreateMistakeId('Pre & After Hours', mistakesList));
  }

  // 3. SPXW after 11:30 AM
  if (sym === 'SPXW' && mins > T1130) {
    ids.push(_getOrCreateMistakeId('SPXW traded after 11:30am', mistakesList));
  }

  // 4. Other tickers after 11:30 AM (up to 4:00 PM — beyond that is "After Hours")
  if (sym !== 'SPXW' && mins > T1130 && mins <= T1600) {
    ids.push(_getOrCreateMistakeId('Traded between 11:30-4:00pm', mistakesList));
  }

  // 5. Oversized: > 5 contracts (options) or > 250 shares (stock)
  const overLimit = type === 'option' ? 5 : 250;
  if (qty > overLimit) {
    ids.push(_getOrCreateMistakeId('Oversized', mistakesList));
  }

  // 6. Overpaid Entry Price: options where entry price >= $6
  if (type === 'option' && ep >= 6) {
    ids.push(_getOrCreateMistakeId('Overpaid Entry Price', mistakesList));
  }

  return ids;
}

// Parse a raw CSV line respecting quoted fields (RFC 4180 basics).
function _parseCsvLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { fields.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  fields.push(cur);
  return fields.map(f => f.trim());
}

// Build a column-index map from the header row.
// Supports both old and new Tradezella CSV layouts.
// Returns an object whose keys are canonical field names and values are column indices.
function _tzBuildColMap(headerCols) {
  const map = {};
  headerCols.forEach((h, i) => {
    const k = h.toLowerCase().trim();
    // Canonical name → normalised header variants
    if (k === 'open date')                          map.openDate     = i;
    else if (k === 'open time')                     map.openTime     = i;
    else if (k === 'symbol')                        map.symbol       = i;
    else if (k === 'instrument')                    map.instrument   = i;
    else if (k === 'close date')                    map.closeDate    = i;
    else if (k === 'close time')                    map.closeTime    = i;
    else if (k === 'quantity')                      map.quantity     = i;
    else if (k === 'fee')                           map.fee          = i;
    // spread type — ignored
    // Old format uses "entry price" / "exit price"
    else if (k === 'entry price')                   map.entryPrice   = i;
    else if (k === 'exit price')                    map.exitPrice    = i;
    // New format uses "avg buy price" / "avg sell price"
    else if (k === 'avg buy price')                 map.entryPrice   = i;
    else if (k === 'avg sell price')                map.exitPrice    = i;
    // Commission column (new format only)
    else if (k === 'commission')                    map.commission   = i;
    else if (k === 'side')                          map.side         = i;
  });
  return map;
}

function importTradezellaCSV() {
  const ta  = document.getElementById('bulk-tz-ta');
  const raw = ta.value.trim();
  if (!raw) return;

  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return;

  // Always expect a header row — build column map from it
  const headerCols = _parseCsvLine(lines[0]);
  const isHeader   = headerCols.some(h => /open date|symbol|instrument/i.test(h));
  if (!isHeader) {
    const panel = document.getElementById('bulk-msg-panel');
    panel.className = 'bulk-msg-panel bulk-msg-error';
    panel.style.display = 'block';
    panel.innerHTML = `<div class="bulk-msg-hdr"><span>&#9888;&nbsp; Could not find a header row — paste CSV including the header line</span><button class="bulk-msg-x" onclick="_hideBulkMsg()">&#10005;</button></div>`;
    return;
  }
  const col      = _tzBuildColMap(headerCols);
  const dataLines = lines.slice(1);

  const warn  = [];
  let added   = 0;

  let maxNum = 0;
  for (const r of bulkRows) {
    const m = r.tradeId.match(/^T(\d+)$/i);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
  }
  const hasRealData = _bulkHasData();

  // Load (and potentially mutate) mistakes list once for the whole import
  const mistakesList = loadMistakes();

  for (const line of dataLines) {
    const cols = _parseCsvLine(line);
    if (cols.length < 8) {
      warn.push(`Skipped (too few columns): "${line.slice(0, 60)}"`);
      continue;
    }

    const openDate       = cols[col.openDate]   ?? '';
    const openTime       = cols[col.openTime]   ?? '';
    const symbol         = cols[col.symbol]     ?? '';
    const instrument     = cols[col.instrument] ?? '';
    const closeDate      = cols[col.closeDate]  ?? '';
    const closeTime      = cols[col.closeTime]  ?? '';
    const quantityRaw    = cols[col.quantity]   ?? '';
    const feeRaw         = cols[col.fee]        ?? '';
    const entryPriceRaw  = col.entryPrice  != null ? (cols[col.entryPrice]  ?? '') : '';
    const exitPriceRaw   = col.exitPrice   != null ? (cols[col.exitPrice]   ?? '') : '';
    const commissionRaw  = col.commission  != null ? (cols[col.commission]  ?? '0') : '0';

    if (!openDate || !openTime || !symbol) {
      warn.push(`Skipped (missing key fields): "${line.slice(0, 60)}"`);
      continue;
    }

    const instr = _parseTzInstrument(symbol, instrument || symbol, '');
    const isShort        = instr.type === 'stock' && col.side != null && (cols[col.side] ?? '').toLowerCase() === 'short';
    const openAction     = isShort ? 'sell' : 'buy';
    const closeAction    = isShort ? 'buy'  : 'sell';
    if (!instr) {
      warn.push(`Skipped (unrecognised instrument): "${instrument}"`);
      continue;
    }

    const openDt  = _parseTzDatetime(openDate, openTime);
    const closeDt = _parseTzDatetime(closeDate || openDate, closeTime || openTime);

    const qty        = parseFloat(quantityRaw)    || 0;
    const fee        = parseFloat(feeRaw)          || 0;
    const entryPrice = parseFloat(entryPriceRaw)  || 0;
    const exitPrice  = parseFloat(exitPriceRaw)   || 0;
    const commission = parseFloat(commissionRaw)  || 0;
    const halfFee    = parseFloat((fee / 2).toFixed(4));
    const halfComm   = parseFloat((commission / 2).toFixed(4));

    // Auto-mistakes evaluated on open time / entry conditions
    const mistakeIds = _tzAutoMistakes(
      symbol, openTime, qty, entryPrice, instr.type, mistakesList
    );

    maxNum++;
    const tradeId = 'T' + maxNum;

    // BUY leg (open)
    const buyRow = _newBulkRow(tradeId, {
      ...instr,
      action:     openAction,
      datetime:   openDt,
      quantity:   String(qty),
      commission: String(halfComm),
      fees:       String(halfFee),
      tags: [], mistakes: [...mistakeIds], rules: [],
    });
    buyRow.price = String(entryPrice);

    // SELL leg (close)
    const sellRow = _newBulkRow(tradeId, {
      ...instr,
      action:     closeAction,
      datetime:   closeDt,
      quantity:   String(qty),
      commission: String(halfComm),
      fees:       String(halfFee),
      tags: [], mistakes: [...mistakeIds], rules: [],
    });
    sellRow.price = String(exitPrice);

    const lastRow = bulkRows[bulkRows.length - 1];
    const reuseEmpty = !hasRealData && added === 0 &&
      !lastRow.symbol && lastRow.price === '' && lastRow.quantity === '';

    if (reuseEmpty) {
      bulkRows[bulkRows.length - 1] = buyRow;
      bulkRows.push(sellRow);
    } else {
      bulkRows.push(buyRow);
      bulkRows.push(sellRow);
    }
    added++;
  }

  renderBulkGrid();

  if (added > 0) {
    _scrollBulkBottom();
    document.getElementById('bulk-tradezella-panel').style.display = 'none';
    document.getElementById('bulk-tz-toggle-btn').classList.remove('active');
    ta.value = '';
  }

  if (warn.length) {
    const panel = document.getElementById('bulk-msg-panel');
    panel.className = 'bulk-msg-panel bulk-msg-error';
    panel.style.display = 'block';
    panel.innerHTML =
      `<div class="bulk-msg-hdr">
        <span>&#9888;&nbsp; ${added} trade${added !== 1 ? 's' : ''} imported · ${warn.length} row${warn.length !== 1 ? 's' : ''} skipped</span>
        <button class="bulk-msg-x" onclick="_hideBulkMsg()">&#10005;</button>
      </div>
      <div class="bulk-msg-errs">${warn.map(w => `<div class="bulk-msg-err-row">${escHtml(w)}</div>`).join('')}</div>`;
  } else if (added > 0) {
    _hideBulkMsg();
  }
}
