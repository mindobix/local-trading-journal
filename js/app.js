const state = { view: 'calendar' };

function switchView(v) {
  state.view = v;
  document.getElementById('view-cal').style.display    = v === 'calendar' ? 'block' : 'none';
  document.getElementById('view-trades').style.display = v === 'trades'   ? 'block' : 'none';
  document.getElementById('nav-cal').classList.toggle('active',    v === 'calendar');
  document.getElementById('nav-trades').classList.toggle('active', v === 'trades');
  if (v === 'trades')   renderTrades();
  if (v === 'calendar') renderCalendar();
}

function openAddGlobal() {
  activeDate = todayStr();
  editingId  = null;
  const dt = new Date();
  document.getElementById('modal-title').textContent = 'Add Trade';
  document.getElementById('modal-sub').textContent   = dt.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  hideForm();
  refreshDayModal();
  document.getElementById('day-overlay').classList.add('open');
  setTimeout(() => showForm(null), 50);
}

function editFromTable(id) {
  const t = load().find(x => x.id === id);
  if (!t) return;
  activeDate = t.date;
  openDay(t.date);
  setTimeout(() => showForm(id), 60);
}

// ─── CSV TEMPLATE & IMPORT ───

const CSV_HEADERS = 'trade_id,symbol,type,option_type,strike_price,expiry_date,action,datetime,price,quantity,commission,fees,notes';

function downloadCSVTemplate() {
  const rows = [
    CSV_HEADERS,
    'T1,AAPL,option,call,185.00,2026-04-17,buy,2026-03-24T09:35,3.50,2,1.30,0.00,Bought AAPL call ahead of earnings',
    'T1,AAPL,option,call,185.00,2026-04-17,sell,2026-03-24T14:15,6.80,2,1.30,0.00,Took profit on AAPL call',
    'T2,TSLA,stock,,,,buy,2026-03-24T10:00,175.50,100,1.00,0.00,Breakout entry on TSLA',
    'T2,TSLA,stock,,,,sell,2026-03-24T15:30,182.25,100,1.00,0.00,EOD close TSLA',
  ];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'localtradejournal_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSVLine(line) {
  // Handles quoted fields containing commas
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

function isValidDatetime(dt) {
  // Accepts YYYY-MM-DDTHH:MM or YYYY-MM-DD H:MM or YYYY-MM-DD HH:MM (Google Sheets export)
  return /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}$/.test(dt);
}

function normalizeDateTime(dt) {
  // Convert "2026-03-22 9:35" → "2026-03-22T09:35"
  const m = dt.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})$/);
  if (!m) return dt;
  return `${m[1]}T${m[2].padStart(2, '0')}:${m[3]}`;
}

function isValidDate(d) {
  // YYYY-MM-DD
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function importCSVTrades(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) { alert('CSV file is empty.'); event.target.value = ''; return; }

    // Validate header
    const header = lines[0].toLowerCase().trim();
    if (header !== CSV_HEADERS) {
      alert('CSV header does not match the expected template. Please use the CSV Template button to get the correct format.');
      event.target.value = '';
      return;
    }

    const errors = [];
    const rowData = [];

    for (let i = 1; i < lines.length; i++) {
      const lineNum = i + 1; // 1-based, header = line 1
      const fields  = parseCSVLine(lines[i]);
      if (fields.length < 13) {
        errors.push({ line: lineNum, issues: ['Row has fewer than 13 columns'] });
        continue;
      }

      const [trade_id, symbol, type, option_type, strike_price, expiry_date,
             action, datetime, price, quantity, commission, fees, ...notesParts] = fields;
      const notes = notesParts.join(',');
      const issues = [];

      if (!trade_id) issues.push('trade_id is required');
      if (!symbol)   issues.push('symbol is required');
      if (!['stock','option'].includes(type)) issues.push(`type must be "stock" or "option" (got "${type}")`);
      if (!['buy','sell'].includes(action))   issues.push(`action must be "buy" or "sell" (got "${action}")`);
      if (!isValidDatetime(datetime))         issues.push(`datetime must be YYYY-MM-DDTHH:MM (got "${datetime}")`);
      if (isNaN(parseFloat(price)) || parseFloat(price) < 0)      issues.push('price must be a non-negative number');
      if (isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0) issues.push('quantity must be a positive number');
      if (isNaN(parseFloat(commission)) || parseFloat(commission) < 0) issues.push('commission must be a non-negative number');
      if (isNaN(parseFloat(fees)) || parseFloat(fees) < 0)        issues.push('fees must be a non-negative number');

      if (type === 'option') {
        if (!['call','put'].includes(option_type)) issues.push(`option_type must be "call" or "put" for options (got "${option_type}")`);
        if (!strike_price || isNaN(parseFloat(strike_price))) issues.push('strike_price is required for options');
        if (!isValidDate(expiry_date)) issues.push(`expiry_date must be YYYY-MM-DD for options (got "${expiry_date}")`);
      }

      if (issues.length) { errors.push({ line: lineNum, issues }); }
      else { rowData.push({ trade_id, symbol, type, option_type, strike_price, expiry_date, action, datetime, price, quantity, commission, fees, notes }); }
    }

    if (errors.length) {
      showImportErrors(errors);
      event.target.value = '';
      return;
    }

    // Group rows by trade_id → build trade objects
    const tradeMap = {};
    for (const row of rowData) {
      if (!tradeMap[row.trade_id]) {
        tradeMap[row.trade_id] = {
          id:          uid(),
          symbol:      row.symbol.toUpperCase(),
          type:        row.type,
          optionType:  row.option_type || null,
          strikePrice: row.strike_price || null,
          expiryDate:  row.expiry_date  || null,
          notes:       row.notes        || '',
          legs:        [],
        };
      }
      tradeMap[row.trade_id].legs.push({
        id:         uid(),
        action:     row.action,
        date:       normalizeDateTime(row.datetime),
        price:      row.price,
        quantity:   row.quantity,
        commission: row.commission,
        fees:       row.fees,
      });
    }

    // Derive trade.date from first leg datetime
    const newTrades = Object.values(tradeMap).map(t => {
      t.date = t.legs[0].date.split('T')[0];
      return t;
    });

    const existing    = load();
    const merged      = [...existing, ...newTrades];
    save(merged);
    renderStats();
    renderCalendar();
    if (state.view === 'trades') renderTrades();

    const legCount = newTrades.reduce((s, t) => s + t.legs.length, 0);
    showImportSuccess(newTrades.length, legCount);
    event.target.value = '';
  };
  reader.readAsText(file);
}

function showImportErrors(errors) {
  document.getElementById('import-error-title').textContent = 'Import Failed — Fix These Errors';
  document.getElementById('import-error-sub').textContent   = `${errors.length} row${errors.length !== 1 ? 's' : ''} with issues`;
  document.getElementById('import-error-list').innerHTML = errors.map(e =>
    `<div class="import-error-item">
      <div class="err-row">Line ${e.line}</div>
      <div class="err-fields">${e.issues.join(' &bull; ')}</div>
    </div>`
  ).join('');
  document.getElementById('import-error-overlay').classList.add('open');
}

function showImportSuccess(tradeCount, legCount) {
  document.getElementById('import-error-title').textContent = 'Import Successful';
  document.getElementById('import-error-sub').textContent   = '';
  document.getElementById('import-error-list').innerHTML =
    `<div class="import-success-msg">
      &#10003; Imported ${tradeCount} trade${tradeCount !== 1 ? 's' : ''} with ${legCount} leg${legCount !== 1 ? 's' : ''} successfully.
    </div>`;
  document.getElementById('import-error-overlay').classList.add('open');
}

function closeImportErrors() {
  document.getElementById('import-error-overlay').classList.remove('open');
}

// ─── BACKUP & RESTORE ───

function backupData() {
  const trades = load();
  const json   = JSON.stringify(trades, null, 2);
  const blob   = new Blob([json], { type: 'application/json' });
  const url    = URL.createObjectURL(blob);
  const today  = todayStr();
  const a      = document.createElement('a');
  a.href     = url;
  a.download = `trading-journal-backup-${today}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function restoreData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const trades = JSON.parse(e.target.result);
      if (!Array.isArray(trades)) throw new Error('Invalid format');
      const existing = load();
      if (existing.length > 0) {
        if (!confirm(`You have ${existing.length} existing trade${existing.length !== 1 ? 's' : ''}. Restoring will merge with your current data. Continue?`)) {
          event.target.value = '';
          return;
        }
      }
      // Merge: existing trades win on ID conflict
      const existingIds = new Set(existing.map(t => t.id));
      const merged = [...existing, ...trades.filter(t => !existingIds.has(t.id))];
      save(merged);
      renderStats();
      renderCalendar();
      if (state.view === 'trades') renderTrades();
      alert(`Restored ${trades.length} trade${trades.length !== 1 ? 's' : ''}. Total: ${merged.length}.`);
    } catch {
      alert('Failed to restore: invalid backup file.');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

// close modal on overlay click
document.getElementById('day-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
document.getElementById('import-error-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeImportErrors();
});

// Escape key closes modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeImportErrors();
  }
});

// init
renderStats();
renderCalendar();
