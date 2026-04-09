const state = { view: 'calendar', tradesVisited: false };

const APP_VERSION = '1.0.5';


function toggleUtilDropdown(e) {
  e.stopPropagation();
  const menu = document.getElementById('util-dropdown-menu');
  const btn = e.currentTarget;
  const isOpen = menu.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
}
function closeUtilDropdown() {
  document.getElementById('util-dropdown-menu').classList.remove('open');
  const btn = document.querySelector('.util-dropdown-toggle');
  if (btn) btn.classList.remove('active');
}
document.addEventListener('click', function(e) {
  const dd = document.getElementById('util-dropdown');
  if (dd && !dd.contains(e.target)) closeUtilDropdown();
});

function toggleAddDropdown(e) {
  e.stopPropagation();
  const menu = document.getElementById('add-dropdown-menu');
  const btn = e.currentTarget;
  const isOpen = menu.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
}
function closeAddDropdown() {
  document.getElementById('add-dropdown-menu').classList.remove('open');
  const btn = document.querySelector('.add-dropdown-toggle');
  if (btn) btn.classList.remove('active');
}
document.addEventListener('click', function(e) {
  const dd = document.getElementById('add-dropdown');
  if (dd && !dd.contains(e.target)) closeAddDropdown();
});

function switchView(v) {
  if (typeof _bulkIsActive === 'function' && _bulkIsActive() && !_bulkConfirmLeave()) return;
  if (typeof _bulkCleanup === 'function') _bulkCleanup();
  state.view = v;
  // Cleanup news polling when leaving news view
  if (state.view === 'news' && v !== 'news' && typeof cleanupNewsView === 'function') cleanupNewsView();

  document.getElementById('view-bulk').style.display    = 'none';
  document.getElementById('view-cal').style.display     = v === 'calendar' ? 'block' : 'none';
  document.getElementById('view-trades').style.display  = v === 'trades'   ? 'block' : 'none';
  document.getElementById('view-plan').style.display    = v === 'plan'     ? 'block' : 'none';
  document.getElementById('view-reports').style.display = v === 'reports'  ? 'block' : 'none';
  document.getElementById('view-news').style.display    = v === 'news'     ? 'block' : 'none';
  document.getElementById('nav-cal').classList.toggle('active',     v === 'calendar');
  document.getElementById('nav-trades').classList.toggle('active',  v === 'trades');
  document.getElementById('nav-plan').classList.toggle('active',    v === 'plan');
  document.getElementById('nav-reports').classList.toggle('active', v === 'reports');
  document.getElementById('nav-news').classList.toggle('active',    v === 'news');
  updateFilterBarContext(v);
  if (v === 'trades') {
    if (!state.tradesVisited) {
      state.tradesVisited = true;
      document.getElementById('gf-date').value = 'monthly';
      onGlobalDateFilterChange();
    }
    renderTrades();
  }
  if (v === 'calendar') renderCalendar();
  if (v === 'plan')     initPlanView();
  if (v === 'reports')  initReportsView();
  if (v === 'news' && typeof initNewsView === 'function') initNewsView();
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

function showImportSuccess(tradeCountOrMsg, legCount) {
  const msg = legCount !== undefined
    ? `Imported ${tradeCountOrMsg} trade${tradeCountOrMsg !== 1 ? 's' : ''} with ${legCount} leg${legCount !== 1 ? 's' : ''} successfully.`
    : tradeCountOrMsg;
  document.getElementById('import-error-title').textContent = 'Import Successful';
  document.getElementById('import-error-sub').textContent   = '';
  document.getElementById('import-error-list').innerHTML =
    `<div class="import-success-msg">&#10003; ${msg}</div>`;
  document.getElementById('import-error-overlay').classList.add('open');
}

function closeImportErrors() {
  document.getElementById('import-error-overlay').classList.remove('open');
}

// ─── BACKUP & RESTORE ───

function backupData() {
  const backup = {
    version:    6,  // v6: includes llmQueries (prompts only, not results)
    exportedAt: new Date().toISOString(),
    trades:       load(),
    tags:         loadTags(),
    mistakes:     loadMistakes(),
    rules:        loadRules(),
    plans:        loadPlans(),
    ideas:        loadIdeas(),
    newsConfig:   typeof getNewsConfigForBackup   === 'function' ? getNewsConfigForBackup()   : null,
    newsTaxonomy: typeof getTaxonomyForBackup     === 'function' ? getTaxonomyForBackup()     : null,
    llmQueries:      typeof getLlmQueriesForBackup       === 'function' ? getLlmQueriesForBackup()       : null,
    llmTradePlans:   typeof getLlmTradePlansForBackup    === 'function' ? getLlmTradePlansForBackup()    : null,
  };
  const json  = JSON.stringify(backup, null, 2);
  const blob  = new Blob([json], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const today = todayStr();
  const a     = document.createElement('a');
  a.href     = url;
  a.download = `trading-journal-backup-${today}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function restoreData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    let raw;
    try {
      raw = JSON.parse(e.target.result);
    } catch {
      alert('Failed to restore: file is not valid JSON.');
      event.target.value = '';
      return;
    }

    // Support legacy backups (plain array of trades)
    const isLegacy = Array.isArray(raw);
    const incoming = isLegacy
      ? { trades: raw, tags: [], mistakes: [], rules: [], plans: {} }
      : raw;

    if (!Array.isArray(incoming.trades)) {
      alert('Failed to restore: unrecognised backup format.');
      event.target.value = '';
      return;
    }

    const existingTrades   = load();
    const existingTags     = loadTags();
    const existingMistakes = loadMistakes();
    const existingRules    = loadRules();
    const existingPlans    = loadPlans();
    const existingIdeas    = loadIdeas();

    const hasCurrent = existingTrades.length || existingTags.length ||
                       existingMistakes.length || existingRules.length ||
                       Object.keys(existingPlans).length || existingIdeas.length;

    if (hasCurrent) {
      const msg = isLegacy
        ? 'You have existing data. Restoring a legacy backup will merge trades only. Continue?'
        : 'You have existing data. Restoring will merge trades, tags, mistakes, rules, daily plans, and trade plan ideas. Backup entries take priority on conflicts. Continue?';
      if (!confirm(msg)) { event.target.value = ''; return; }
    }

    // Merge trades — incoming wins on ID conflict (backup updates override local)
    const existingTradeMap = new Map(existingTrades.map(t => [t.id, t]));
    let updatedTrades = 0;
    for (const t of incoming.trades) {
      if (existingTradeMap.has(t.id)) updatedTrades++;
      existingTradeMap.set(t.id, t);
    }
    const addedTrades = incoming.trades.length - updatedTrades;
    const mergedTrades = [...existingTradeMap.values()];

    // Merge tags — incoming wins on ID conflict (backup updates override local)
    const existingTagMap = new Map(existingTags.map(t => [t.id, t]));
    let updatedTags = 0;
    for (const t of (incoming.tags || [])) {
      if (existingTagMap.has(t.id)) updatedTags++;
      existingTagMap.set(t.id, t);
    }
    const mergedTags = [...existingTagMap.values()];

    // Merge mistakes — incoming wins on ID conflict (backup updates override local)
    const existingMistakeMap = new Map(existingMistakes.map(m => [m.id, m]));
    let updatedMistakes = 0;
    for (const m of (incoming.mistakes || [])) {
      if (existingMistakeMap.has(m.id)) updatedMistakes++;
      existingMistakeMap.set(m.id, m);
    }
    const mergedMistakes = [...existingMistakeMap.values()];

    // Merge rules — incoming wins on ID conflict (backup updates override local)
    const existingRuleMap = new Map(existingRules.map(r => [r.id, r]));
    let updatedRules = 0;
    for (const r of (incoming.rules || [])) {
      if (existingRuleMap.has(r.id)) updatedRules++;
      existingRuleMap.set(r.id, r);
    }
    const mergedRules = [...existingRuleMap.values()];

    // Merge plans — incoming wins on date conflict (backup plans override local)
    const incomingPlans = incoming.plans || {};
    let updatedPlans = 0;
    let addedPlans = 0;
    for (const date of Object.keys(incomingPlans)) {
      if (existingPlans[date] !== undefined) updatedPlans++;
      else addedPlans++;
    }
    const mergedPlans = { ...existingPlans, ...incomingPlans };

    // Merge ideas — incoming wins on ID conflict (backup ideas override local)
    const existingIdeaMap = new Map(existingIdeas.map(i => [i.id, i]));
    let updatedIdeas = 0;
    for (const i of (incoming.ideas || [])) {
      if (existingIdeaMap.has(i.id)) updatedIdeas++;
      existingIdeaMap.set(i.id, i);
    }
    const addedIdeas  = (incoming.ideas || []).length - updatedIdeas;
    const mergedIdeas = [...existingIdeaMap.values()];

    save(mergedTrades);
    saveTags(mergedTags);
    saveMistakes(mergedMistakes);
    saveRules(mergedRules);
    localStorage.setItem(PLANS_KEY, JSON.stringify(mergedPlans));
    saveIdeas(mergedIdeas);

    // Restore news settings (replace, not merge — they're whole config objects)
    let restoredNewsConfig   = false;
    let restoredNewsTaxonomy = false;
    let restoredLlmQueries   = false;
    if (incoming.newsConfig && typeof restoreNewsConfig === 'function') {
      await restoreNewsConfig(incoming.newsConfig);
      restoredNewsConfig = true;
    }
    if (incoming.newsTaxonomy && typeof restoreNewsTaxonomy === 'function') {
      await restoreNewsTaxonomy(incoming.newsTaxonomy);
      restoredNewsTaxonomy = true;
    }
    if (incoming.llmQueries && typeof restoreLlmQueries === 'function') {
      restoreLlmQueries(incoming.llmQueries);
      restoredLlmQueries = true;
    }
    if (incoming.llmTradePlans && typeof restoreLlmTradePlansFromBackup === 'function') {
      restoreLlmTradePlansFromBackup(incoming.llmTradePlans);
    }

    event.target.value = '';

    refreshAllViews();

    const addedTags     = mergedTags.length     - existingTags.length;
    const addedMistakes = mergedMistakes.length - existingMistakes.length;
    const addedRules    = mergedRules.length    - existingRules.length;

    const parts = [];
    if (addedTrades    > 0) parts.push(`${addedTrades} trade${addedTrades !== 1 ? 's' : ''} added`);
    if (updatedTrades  > 0) parts.push(`${updatedTrades} trade${updatedTrades !== 1 ? 's' : ''} updated`);
    if (addedTags      > 0) parts.push(`${addedTags} tag${addedTags !== 1 ? 's' : ''} added`);
    if (updatedTags    > 0) parts.push(`${updatedTags} tag${updatedTags !== 1 ? 's' : ''} updated`);
    if (addedMistakes  > 0) parts.push(`${addedMistakes} mistake${addedMistakes !== 1 ? 's' : ''} added`);
    if (updatedMistakes > 0) parts.push(`${updatedMistakes} mistake${updatedMistakes !== 1 ? 's' : ''} updated`);
    if (addedRules     > 0) parts.push(`${addedRules} rule${addedRules !== 1 ? 's' : ''} added`);
    if (updatedRules   > 0) parts.push(`${updatedRules} rule${updatedRules !== 1 ? 's' : ''} updated`);
    if (addedPlans    > 0) parts.push(`${addedPlans} daily plan${addedPlans !== 1 ? 's' : ''} added`);
    if (updatedPlans  > 0) parts.push(`${updatedPlans} daily plan${updatedPlans !== 1 ? 's' : ''} updated`);
    if (addedIdeas    > 0) parts.push(`${addedIdeas} trade plan idea${addedIdeas !== 1 ? 's' : ''} added`);
    if (updatedIdeas  > 0) parts.push(`${updatedIdeas} trade plan idea${updatedIdeas !== 1 ? 's' : ''} updated`);
    if (restoredNewsConfig)   parts.push('news sources restored');
    if (restoredNewsTaxonomy) parts.push('signal taxonomy restored');
    if (restoredLlmQueries)   parts.push('LLM queries restored');
    if (parts.length === 0) parts.push('nothing new');

    showImportSuccess(parts.join(', ') + ' restored.');
  };
  reader.readAsText(file);
}

// close multi-select dropdowns when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.gf-multiselect')) {
    document.querySelectorAll('.gf-multi-drop.open').forEach(d => d.classList.remove('open'));
  }
});

// close modal on overlay click
document.getElementById('day-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
document.getElementById('import-error-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeImportErrors();
});

// Prevent mouse wheel from changing number input values
document.addEventListener('wheel', e => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
    e.target.blur();
  }
}, { passive: false });

// Escape key closes modal / bulk view
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (typeof _bulkIsActive === 'function' && _bulkIsActive()) {
      closeBulkView();
      return;
    }
    closeModal();
    closeImportErrors();
  }
});

// init
initIdeaModal();
updateFilterBarContext('calendar');
renderStats();
renderCalendar();
