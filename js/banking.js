// ─── BANKING TAB ─────────────────────────────────────────────────────────────
//
// Storage: IndexedDB stores  bankingAccounts  and  bankingEntries
//
// bankingAccounts: { id, name, type: 'bank'|'brokerage', order }
// bankingEntries:  { id, date, bankId, bankAmount, brokerageId, brokerageAmount }
//
// Sign convention:
//   Funding    → bankAmount < 0  (money leaves bank)   brokerageAmount > 0
//   Withdrawal → bankAmount > 0  (money returns to bank)  brokerageAmount < 0

const _BK_ACCT_DEFAULTS = [
  { id: 'bk-def-53',        name: '5/3 Bank',    type: 'bank',      order: 0 },
  { id: 'bk-def-webull',    name: 'Webull',       type: 'brokerage', order: 0 },
  { id: 'bk-def-robinhood', name: 'Robinhood',    type: 'brokerage', order: 1 },
  { id: 'bk-def-tasty',     name: 'Tasty Trade',  type: 'brokerage', order: 2 },
  { id: 'bk-def-fidelity',  name: 'Fidelity',     type: 'brokerage', order: 3 },
];

let _bkAccounts  = [];
let _bkEntries   = [];
let _bkSortState      = {};   // brokerageId → 'asc' | 'desc'
let _bkCollapseState  = {};   // brokerageId → true (collapsed)
let _bkYearCollapse   = {};   // `${brokerageId}:${year}` → true (collapsed)
let _bkPivotExpanded  = {};   // year → true (pivot year row expanded)

const _bankAccts = () => _bkAccounts.filter(a => a.type === 'bank').sort((a, b) => a.order - b.order);
const _brokAccts = () => _bkAccounts.filter(a => a.type === 'brokerage').sort((a, b) => a.order - b.order);
const _acctById  = id => _bkAccounts.find(a => a.id === id);

// ─── Storage (IndexedDB) ──────────────────────────────────────────────────────

async function _initBankingStorage() {
  _bkAccounts  = await dbGetAll('bankingAccounts');
  _bkEntries   = await dbGetAll('bankingEntries');
  _bkSortState     = (await dbGetSetting('bk-sort-state'))     || {};
  _bkCollapseState = (await dbGetSetting('bk-collapse-state')) || {};

  if (_bkAccounts.length === 0) {
    _bkAccounts = _BK_ACCT_DEFAULTS.map(a => ({ ...a }));
    await Promise.all(_bkAccounts.map(a => dbPut('bankingAccounts', a))).catch(console.error);
  }
}

function _saveAcct(acct)  { dbPut('bankingAccounts', acct).catch(console.error); }
function _delAcct(id)     { dbDelete('bankingAccounts', id).catch(console.error); }
function _saveEntry(e)    { dbPut('bankingEntries', e).catch(console.error); }
function _delEntry(id)    { dbDelete('bankingEntries', id).catch(console.error); }

// ─── Backup / Restore ────────────────────────────────────────────────────────

function getBankingDataForBackup() {
  return { accounts: _bkAccounts, entries: _bkEntries };
}

async function restoreBankingFromBackup(data) {
  if (!data) return;
  const incoming = Array.isArray(data) ? { accounts: [], entries: data } : data;

  if (incoming.accounts && incoming.accounts.length) {
    const map = new Map(_bkAccounts.map(a => [a.id, a]));
    for (const a of incoming.accounts) map.set(a.id, a);
    _bkAccounts = [...map.values()];
    await Promise.all(_bkAccounts.map(a => dbPut('bankingAccounts', a))).catch(console.error);
  }
  if (incoming.entries && incoming.entries.length) {
    const map = new Map(_bkEntries.map(e => [e.id, e]));
    for (const e of incoming.entries) map.set(e.id, e);
    _bkEntries = [...map.values()];
    await Promise.all(_bkEntries.map(e => dbPut('bankingEntries', e))).catch(console.error);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _bkEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _fmtBkAmt(n) {
  const num = Number(n);
  if (n === '' || n == null || isNaN(num)) return '—';
  if (num === 0) return '$0.00';
  const abs = Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num < 0 ? `-$${abs}` : `+$${abs}`;
}

function _bkAmtCls(n) {
  const num = Number(n);
  if (!n && n !== 0 || isNaN(num) || num === 0) return '';
  return num > 0 ? ' bk-pos' : ' bk-neg';
}

function _entryCountFor(acctId) {
  return _bkEntries.filter(e => e.bankId === acctId || e.brokerageId === acctId).length;
}

// ─── Account CRUD ─────────────────────────────────────────────────────────────

// _bkEditState: null | { mode:'add', type } | { mode:'edit', id }
let _bkEditState = null;
let _bkDragId    = null;

function _bkDragStart(id) { _bkDragId = id; }
function _bkDragOver(e, id) {
  e.preventDefault();
  if (_bkDragId === id) return;
  document.querySelectorAll('.bk-acct-row[data-acct-id]').forEach(r => r.classList.remove('bk-drag-over'));
  document.querySelector(`.bk-acct-row[data-acct-id="${id}"]`)?.classList.add('bk-drag-over');
}
function _bkDragLeave(id) {
  document.querySelector(`.bk-acct-row[data-acct-id="${id}"]`)?.classList.remove('bk-drag-over');
}
function _bkDrop(e, targetId) {
  e.preventDefault();
  document.querySelectorAll('.bk-acct-row[data-acct-id]').forEach(r => r.classList.remove('bk-drag-over'));
  if (!_bkDragId || _bkDragId === targetId) { _bkDragId = null; return; }

  const broks = _brokAccts();
  const fromIdx = broks.findIndex(a => a.id === _bkDragId);
  const toIdx   = broks.findIndex(a => a.id === targetId);
  if (fromIdx === -1 || toIdx === -1) { _bkDragId = null; return; }

  broks.splice(toIdx, 0, broks.splice(fromIdx, 1)[0]);
  broks.forEach((a, i) => { a.order = i; _saveAcct(a); });
  _bkDragId = null;
  renderBankingView();
  _renderBankingAccountsModal();
}

function addBankingAccount(type) {
  _bkEditState = { mode: 'add', type };
  _renderBankingAccountsModal();
  setTimeout(() => document.getElementById('bk-inline-input')?.focus(), 30);
}

function renameBankingAccount(id) {
  _bkEditState = { mode: 'edit', id };
  _renderBankingAccountsModal();
  const inp = document.getElementById('bk-inline-input');
  if (inp) { inp.focus(); inp.select(); }
}

function _commitBankingAccountEdit() {
  const inp = document.getElementById('bk-inline-input');
  const name = inp ? inp.value.trim() : '';
  if (!name) { _cancelBankingAccountEdit(); return; }

  if (_bkEditState?.mode === 'add') {
    const type = _bkEditState.type;
    const peers    = _bkAccounts.filter(a => a.type === type);
    const maxOrder = peers.length ? Math.max(...peers.map(a => a.order)) : -1;
    const acct     = { id: uid(), name, type, order: maxOrder + 1 };
    _bkAccounts.push(acct);
    _saveAcct(acct);
    renderBankingView();
  } else if (_bkEditState?.mode === 'edit') {
    const acct = _acctById(_bkEditState.id);
    if (acct && name !== acct.name) {
      acct.name = name;
      _saveAcct(acct);
      renderBankingView();
    }
  }
  _bkEditState = null;
  _renderBankingAccountsModal();
}

function _cancelBankingAccountEdit() {
  _bkEditState = null;
  _renderBankingAccountsModal();
}

function _bkInlineKeydown(e) {
  if (e.key === 'Enter')  _commitBankingAccountEdit();
  if (e.key === 'Escape') _cancelBankingAccountEdit();
}

function deleteBankingAccount(id) {
  const acct  = _acctById(id);
  if (!acct) return;
  const count = _entryCountFor(id);
  if (count > 0) {
    alert(`Cannot delete "${acct.name}" — ${count} entr${count === 1 ? 'y' : 'ies'} exist. Remove all entries first.`);
    return;
  }
  if (!confirm(`Delete account "${acct.name}"?`)) return;
  _bkAccounts = _bkAccounts.filter(a => a.id !== id);
  _delAcct(id);
  renderBankingView();
  _renderBankingAccountsModal();
}

// ─── Entry CRUD ───────────────────────────────────────────────────────────────

function addBankingRow(brokerageId) {
  const banks = _bankAccts();
  const entry = {
    id: uid(),
    date: todayStr(),
    bankId: banks.length ? banks[0].id : '',
    bankAmount: '',
    brokerageId,
    brokerageAmount: '',
  };
  _bkEntries.push(entry);
  _saveEntry(entry);
  renderBankingView();
  setTimeout(() => {
    const el = document.querySelector(`[data-entry-id="${entry.id}"] .bk-input-date`);
    if (el) el.focus();
  }, 40);
}

function deleteBankingRow(id) {
  _bkEntries = _bkEntries.filter(e => e.id !== id);
  _delEntry(id);
  renderBankingView();
}

function _parseBkAmt(str) {
  return String(str).replace(/[$,\s]/g, '');
}

function _fmtBkAmtInput(raw) {
  const num = parseFloat(raw);
  if (raw === '' || raw == null || isNaN(num)) return '';
  const abs = Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num < 0 ? `-$${abs}` : `$${abs}`;
}

function _isBkPivotYearExpanded(year) {
  if (year in _bkPivotExpanded) return _bkPivotExpanded[year];
  return year === String(new Date().getFullYear());
}

function toggleBkPivotYear(year) {
  _bkPivotExpanded[year] = !_isBkPivotYearExpanded(year);
  _renderBankingPivots();
}

function _isBkYearCollapsed(brokId, year) {
  const key = `${brokId}:${year}`;
  if (key in _bkYearCollapse) return _bkYearCollapse[key];
  return year !== String(new Date().getFullYear());
}

function toggleBkYearCollapse(brokId, year) {
  const key = `${brokId}:${year}`;
  _bkYearCollapse[key] = !_isBkYearCollapsed(brokId, year);
  renderBankingView();
}

function toggleBkCollapse(brokerageId) {
  _bkCollapseState[brokerageId] = !_bkCollapseState[brokerageId];
  dbPutSetting('bk-collapse-state', _bkCollapseState).catch(console.error);
  renderBankingView();
}

function toggleBkSort(brokerageId) {
  _bkSortState[brokerageId] = (_bkSortState[brokerageId] || 'asc') === 'asc' ? 'desc' : 'asc';
  dbPutSetting('bk-sort-state', _bkSortState).catch(console.error);
  renderBankingView();
}

function _bkAmtBlur(el, id, field) {
  const entry = _bkEntries.find(e => e.id === id);
  if (!entry) return;
  const raw = entry[field];
  el.value = _fmtBkAmtInput(raw);
  el.className = `bk-input bk-input-num${_bkAmtCls(parseFloat(raw) || 0)}`;
}

function _bkAmtFocus(el, id, field) {
  const entry = _bkEntries.find(e => e.id === id);
  if (entry) el.value = entry[field] ?? '';
}

function updateBankingField(id, field, value) {
  const entry = _bkEntries.find(e => e.id === id);
  if (!entry) return;
  const cleaned = field === 'bankAmount' || field === 'brokerageAmount'
    ? _parseBkAmt(value) : value;
  entry[field] = cleaned;
  _saveEntry(entry);

  if (field === 'bankAmount') {
    const num = parseFloat(cleaned);
    if (!isNaN(num) && cleaned !== '') {
      entry.brokerageAmount = String(-num);
      _saveEntry(entry);
      const row   = document.querySelector(`[data-entry-id="${id}"]`);
      const brokEl = row?.querySelector('.bk-input-brok-amt');
      if (brokEl && document.activeElement !== brokEl) {
        brokEl.value = _fmtBkAmtInput(-num);
        brokEl.className = `bk-input bk-input-num${_bkAmtCls(-num)}`;
      }
    } else if (cleaned === '') {
      entry.brokerageAmount = '';
      _saveEntry(entry);
      const row   = document.querySelector(`[data-entry-id="${id}"]`);
      const brokEl = row?.querySelector('.bk-input-brok-amt');
      if (brokEl && document.activeElement !== brokEl) brokEl.value = '';
    }
    _refreshBankingTotals();
  } else if (field === 'brokerageAmount') {
    _refreshBankingTotals();
  }
}

// ─── Accounts Modal ───────────────────────────────────────────────────────────

function openBankingAccountsModal() {
  const modal = document.getElementById('bk-accounts-modal');
  if (modal) { _bkEditState = null; modal.classList.add('open'); _renderBankingAccountsModal(); }
}

function closeBankingAccountsModal(e) {
  if (e && e.target !== document.getElementById('bk-accounts-modal')) return;
  document.getElementById('bk-accounts-modal')?.classList.remove('open');
}

function _renderBankingAccountsModal() {
  const body = document.getElementById('bk-accounts-modal-body');
  if (!body) return;

  const isAdding  = _bkEditState?.mode === 'add';
  const editingId = _bkEditState?.mode === 'edit' ? _bkEditState.id : null;

  const inlineRow = `
    <div class="bk-acct-row bk-acct-row-editing">
      <input id="bk-inline-input" class="bk-inline-input" type="text" placeholder="Account name"
        onkeydown="_bkInlineKeydown(event)">
      <div class="bk-acct-actions">
        <button class="bk-acct-btn bk-acct-confirm" onclick="_commitBankingAccountEdit()" title="Save">✓</button>
        <button class="bk-acct-btn bk-acct-cancel"  onclick="_cancelBankingAccountEdit()"  title="Cancel">✕</button>
      </div>
    </div>`;

  const renderSection = (type, title) => {
    const items = type === 'bank' ? _bankAccts() : _brokAccts();
    const addingHere = isAdding && _bkEditState.type === type;
    const addBtn = addingHere
      ? ''
      : `<button class="bk-modal-add-btn" onclick="addBankingAccount('${type}')">+ Add</button>`;

    const rows = items.map(a => {
      const count   = _entryCountFor(a.id);
      const canDel  = count === 0;
      const isEdit  = editingId === a.id;
      const tip     = canDel ? `Delete ${a.name}` : `${count} entr${count === 1 ? 'y' : 'ies'} — remove them first`;

      const isDraggable = type === 'brokerage';
      const dragHandle  = isDraggable ? `<span class="bk-drag-handle" title="Drag to reorder">⠿</span>` : '';
      const dragAttrs   = isDraggable
        ? `draggable="true" data-acct-id="${a.id}"
           ondragstart="_bkDragStart('${a.id}')"
           ondragover="_bkDragOver(event,'${a.id}')"
           ondragleave="_bkDragLeave('${a.id}')"
           ondrop="_bkDrop(event,'${a.id}')"`
        : `data-acct-id="${a.id}"`;

      if (isEdit) {
        return `<div class="bk-acct-row bk-acct-row-editing" ${dragAttrs}>
          ${dragHandle}
          <input id="bk-inline-input" class="bk-inline-input" type="text"
            value="${_bkEsc(a.name)}" onkeydown="_bkInlineKeydown(event)">
          <div class="bk-acct-actions">
            <button class="bk-acct-btn bk-acct-confirm" onclick="_commitBankingAccountEdit()" title="Save">✓</button>
            <button class="bk-acct-btn bk-acct-cancel"  onclick="_cancelBankingAccountEdit()"  title="Cancel">✕</button>
          </div>
        </div>`;
      }
      return `<div class="bk-acct-row" ${dragAttrs}>
        ${dragHandle}
        <span class="bk-acct-name">${_bkEsc(a.name)}</span>
        ${count > 0 ? `<span class="bk-acct-count">${count} entr${count === 1 ? 'y' : 'ies'}</span>` : ''}
        <div class="bk-acct-actions">
          <button class="bk-acct-btn bk-acct-edit" onclick="renameBankingAccount('${a.id}')" title="Rename">✎</button>
          <button class="bk-acct-btn bk-acct-del${canDel ? '' : ' bk-acct-del-disabled'}"
            onclick="deleteBankingAccount('${a.id}')" title="${_bkEsc(tip)}"${canDel ? '' : ' disabled'}>✕</button>
        </div>
      </div>`;
    }).join('');

    const emptyMsg = !items.length && !addingHere
      ? `<div class="bk-acct-empty">No ${title.toLowerCase()} yet.</div>` : '';

    return `<div class="bk-modal-section">
      <div class="bk-modal-section-hdr">
        <span class="bk-modal-section-title">${title}</span>
        ${addBtn}
      </div>
      <div class="bk-acct-list">${emptyMsg}${rows}${addingHere ? inlineRow : ''}</div>
    </div>`;
  };

  body.innerHTML = renderSection('bank', 'Banks') + renderSection('brokerage', 'Brokerages');
}

// ─── Main Render ──────────────────────────────────────────────────────────────

function renderBankingView() {
  const container = document.getElementById('banking-content');
  if (!container) return;

  const brokerages = _brokAccts();
  const banks      = _bankAccts();

  if (brokerages.length === 0) {
    container.innerHTML = `<div class="bk-empty-state">No brokerage accounts — click <strong>⚙ Accounts</strong> to add one.</div>`;
    return;
  }

  let html       = '';
  const brTotals = {};
  const bnkTotals = {};

  for (const brok of brokerages) {
    const sortDir = _bkSortState[brok.id] || 'asc';
    const entries = _bkEntries
      .filter(e => e.brokerageId === brok.id)
      .sort((a, b) => {
        const cmp = (a.date || '').localeCompare(b.date || '');
        return sortDir === 'asc' ? cmp : -cmp;
      });

    let brokSum = 0, bankSumGroup = 0;
    for (const e of entries) {
      const ba = parseFloat(e.bankAmount)      || 0;
      const br = parseFloat(e.brokerageAmount) || 0;
      brokSum      += br;
      bankSumGroup += ba;
      bnkTotals[e.bankId] = (bnkTotals[e.bankId] || 0) + ba;
    }
    brTotals[brok.id] = brokSum;

    const collapsed = !!_bkCollapseState[brok.id];
    const collapsedSummary = collapsed ? `
  <div class="bk-collapsed-summary">
    <span class="bk-cs-label">Bank</span>
    <span class="bk-cs-val${_bkAmtCls(bankSumGroup)}">${_fmtBkAmt(bankSumGroup)}</span>
    <span class="bk-cs-sep">·</span>
    <span class="bk-cs-label">${_bkEsc(brok.name)}</span>
    <span class="bk-cs-val${_bkAmtCls(brokSum)}">${_fmtBkAmt(brokSum)}</span>
  </div>` : '';
    html += `
<div class="bk-group" data-brok-id="${brok.id}">
  <div class="bk-group-header" onclick="toggleBkCollapse('${brok.id}')" style="cursor:pointer">
    <div class="bk-group-title-wrap">
      <span class="bk-collapse-arrow${collapsed ? ' bk-collapsed' : ''}">▼</span>
      <span class="bk-group-title">${_bkEsc(brok.name)}</span>
      <span class="bk-group-count">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</span>
    </div>
    <button class="bk-add-row-btn" onclick="event.stopPropagation();addBankingRow('${brok.id}')">+ Add Row</button>
  </div>
  ${collapsedSummary}
  <table class="bk-table"${collapsed ? ' style="display:none"' : ''}>
    <thead>
      <tr>
        <th class="bk-th-date bk-th-sortable" onclick="toggleBkSort('${brok.id}')" title="Sort by date">
          Date <span class="bk-sort-arrow">${sortDir === 'asc' ? '▲' : '▼'}</span>
        </th>
        <th class="bk-th-bank">Bank</th>
        <th class="bk-th-bank-amt">Bank Amount</th>
        <th class="bk-th-brok-amt">${_bkEsc(brok.name)}</th>
        <th class="bk-th-del"></th>
      </tr>
    </thead>
    <tbody>`;

    if (entries.length === 0) {
      html += `<tr class="bk-empty-row"><td colspan="5">No entries — click + Add Row to record a transfer</td></tr>`;
    } else {
      // Group by year; years always shown most-recent first
      const byYear = {};
      for (const e of entries) {
        const yr = (e.date || '').slice(0, 4) || '—';
        if (!byYear[yr]) byYear[yr] = [];
        byYear[yr].push(e);
      }
      const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));

      for (const yr of years) {
        const yrEntries   = byYear[yr];
        const yrCollapsed = _isBkYearCollapsed(brok.id, yr);
        let yrBankSum = 0, yrBrokSum = 0;
        for (const e of yrEntries) {
          yrBankSum += parseFloat(e.bankAmount)      || 0;
          yrBrokSum += parseFloat(e.brokerageAmount) || 0;
        }
        const yrArrow = yrCollapsed ? 'bk-collapsed' : '';
        html += `<tr class="bk-year-hdr" onclick="toggleBkYearCollapse('${brok.id}','${yr}')">
          <td colspan="5">
            <span class="bk-year-arrow ${yrArrow}">▼</span>
            <span class="bk-year-label">${yr}</span>
            <span class="bk-year-count">${yrEntries.length} entr${yrEntries.length === 1 ? 'y' : 'ies'}</span>
            ${yrCollapsed ? `<span class="bk-year-subtotals">
              <span class="bk-cs-label">Bank</span>
              <span class="bk-cs-val${_bkAmtCls(yrBankSum)}">${_fmtBkAmt(yrBankSum)}</span>
              <span class="bk-cs-sep">·</span>
              <span class="bk-cs-label">${_bkEsc(brok.name)}</span>
              <span class="bk-cs-val${_bkAmtCls(yrBrokSum)}">${_fmtBkAmt(yrBrokSum)}</span>
            </span>` : ''}
          </td>
        </tr>`;

        for (const e of yrEntries) {
          const bankNum = parseFloat(e.bankAmount)      || 0;
          const brokNum = parseFloat(e.brokerageAmount) || 0;
          html += `
        <tr class="bk-row${yrCollapsed ? ' bk-yr-hidden' : ''}" data-entry-id="${e.id}">
          <td><input type="date" class="bk-input bk-input-date"
            value="${_bkEsc(e.date)}"
            oninput="updateBankingField('${e.id}','date',this.value)"></td>
          <td><select class="bk-input bk-input-bank-sel"
            onchange="updateBankingField('${e.id}','bankId',this.value)">
            ${banks.map(b => `<option value="${b.id}"${e.bankId === b.id ? ' selected' : ''}>${_bkEsc(b.name)}</option>`).join('')}
          </select></td>
          <td><input type="text" inputmode="decimal" class="bk-input bk-input-num${_bkAmtCls(bankNum)}"
            value="${_bkEsc(_fmtBkAmtInput(e.bankAmount))}" placeholder="$0.00"
            oninput="updateBankingField('${e.id}','bankAmount',this.value)"
            onfocus="_bkAmtFocus(this,'${e.id}','bankAmount')"
            onblur="_bkAmtBlur(this,'${e.id}','bankAmount')"></td>
          <td><input type="text" inputmode="decimal" class="bk-input bk-input-num bk-input-brok-amt${_bkAmtCls(brokNum)}"
            value="${_bkEsc(_fmtBkAmtInput(e.brokerageAmount))}" placeholder="$0.00"
            oninput="updateBankingField('${e.id}','brokerageAmount',this.value)"
            onfocus="_bkAmtFocus(this,'${e.id}','brokerageAmount')"
            onblur="_bkAmtBlur(this,'${e.id}','brokerageAmount')"></td>
          <td><button class="bk-del-btn" onclick="deleteBankingRow('${e.id}')" title="Delete row">✕</button></td>
        </tr>`;
        }
      }
    }

    html += `
      <tr class="bk-subtotal-row">
        <td class="bk-subtotal-label" colspan="2">Subtotal</td>
        <td class="bk-subtotal-val${_bkAmtCls(bankSumGroup)}" data-bk-banksum="${brok.id}">${_fmtBkAmt(bankSumGroup)}</td>
        <td class="bk-subtotal-val${_bkAmtCls(brokSum)}"      data-bk-brsum="${brok.id}">${_fmtBkAmt(brokSum)}</td>
        <td class="bk-subtotal-add-cell">
          <button class="bk-add-row-btn" onclick="addBankingRow('${brok.id}')">+ Add Row</button>
        </td>
      </tr>
    </tbody>
  </table>
</div>`;
  }

  // ─── Overall totals ───────────────────────────────────────────────────────
  html += _buildOverallTotalsHtml(banks, brokerages, bnkTotals, brTotals);
  container.innerHTML = html;

  _renderBankingPivots();
}

// ─── Pivot tables ─────────────────────────────────────────────────────────────

function _buildOverallTotalsHtml(banks, brokerages, bnkTotals, brTotals) {
  let html = `<div class="bk-overall"><div class="bk-overall-label">Overall Totals</div><div class="bk-overall-row">`;
  for (const b of banks) {
    const tot = bnkTotals[b.id] || 0;
    html += `<div class="bk-overall-cell">
      <div class="bk-overall-acct-name">${_bkEsc(b.name)}</div>
      <div class="bk-overall-amt${_bkAmtCls(tot)}" data-bk-bank-total="${b.id}">${_fmtBkAmt(tot)}</div>
    </div>`;
  }
  for (const brok of brokerages) {
    const tot = brTotals[brok.id] || 0;
    html += `<div class="bk-overall-cell">
      <div class="bk-overall-acct-name">${_bkEsc(brok.name)}</div>
      <div class="bk-overall-amt${_bkAmtCls(tot)}" data-bk-brok-total="${brok.id}">${_fmtBkAmt(tot)}</div>
    </div>`;
  }
  html += `</div></div>`;
  return html;
}

function _renderBankingPivots() {
  const panel = document.getElementById('banking-pivot');
  if (!panel) return;

  const banks      = _bankAccts();
  const brokerages = _brokAccts();
  const cols       = [...banks, ...brokerages];
  if (!cols.length || !_bkEntries.length) { panel.innerHTML = ''; return; }

  // Recompute totals for the mirrored overall card
  const _pvBrTotals  = {};
  const _pvBnkTotals = {};
  for (const e of _bkEntries) {
    const ba = parseFloat(e.bankAmount)      || 0;
    const br = parseFloat(e.brokerageAmount) || 0;
    if (e.bankId)      _pvBnkTotals[e.bankId]      = (_pvBnkTotals[e.bankId]      || 0) + ba;
    if (e.brokerageId) _pvBrTotals[e.brokerageId]  = (_pvBrTotals[e.brokerageId]  || 0) + br;
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtMon = k => { const [y, m] = k.split('-'); return `${MONTHS[parseInt(m,10)-1]} ${y}`; };

  // Build year and month maps
  const yearMap  = {};
  const monthMap = {};
  for (const e of _bkEntries) {
    if (!e.date) continue;
    const year = e.date.slice(0, 4);
    const mon  = e.date.slice(0, 7);
    if (!yearMap[year])  yearMap[year]  = {};
    if (!monthMap[mon])  monthMap[mon]  = {};
    const bankAmt = parseFloat(e.bankAmount)      || 0;
    const brokAmt = parseFloat(e.brokerageAmount) || 0;
    if (e.bankId) {
      yearMap[year][e.bankId]  = (yearMap[year][e.bankId]  || 0) + bankAmt;
      monthMap[mon][e.bankId]  = (monthMap[mon][e.bankId]  || 0) + bankAmt;
    }
    yearMap[year][e.brokerageId] = (yearMap[year][e.brokerageId] || 0) + brokAmt;
    monthMap[mon][e.brokerageId] = (monthMap[mon][e.brokerageId] || 0) + brokAmt;
  }

  const years = Object.keys(yearMap).sort((a, b) => b.localeCompare(a));

  // Column group header
  const bankHdrs = banks.map(b => `<th class="bk-pv-th bk-pv-th-bank">${_bkEsc(b.name)}</th>`).join('');
  const brokHdrs = brokerages.map(b => `<th class="bk-pv-th bk-pv-th-brok">${_bkEsc(b.name)}</th>`).join('');
  const groupHdr = `<tr>
    <th class="bk-pv-th-hdr"></th>
    ${banks.length      ? `<th class="bk-pv-group-hdr" colspan="${banks.length}">Banks</th>`       : ''}
    ${brokerages.length ? `<th class="bk-pv-group-hdr" colspan="${brokerages.length}">Brokerages</th>` : ''}
  </tr>
  <tr><th class="bk-pv-th-hdr"></th>${bankHdrs}${brokHdrs}</tr>`;

  let bodyRows = '';
  for (const yr of years) {
    const expanded = _isBkPivotYearExpanded(yr);
    const yrCells  = cols.map(c => {
      const v = yearMap[yr][c.id] || 0;
      return `<td class="bk-pv-td bk-pv-num${_bkAmtCls(v)}">${v ? _fmtBkAmt(v) : '—'}</td>`;
    }).join('');
    bodyRows += `<tr class="bk-pv-year-row" onclick="toggleBkPivotYear('${yr}')">
      <td class="bk-pv-row-hdr bk-pv-year-hdr">
        <span class="bk-pv-yr-arrow${expanded ? '' : ' bk-collapsed'}">▼</span>${yr}
      </td>${yrCells}
    </tr>`;

    if (expanded) {
      const mons = Object.keys(monthMap)
        .filter(k => k.startsWith(yr + '-'))
        .sort((a, b) => b.localeCompare(a));
      for (const mon of mons) {
        const monCells = cols.map(c => {
          const v = monthMap[mon][c.id] || 0;
          return `<td class="bk-pv-td bk-pv-num bk-pv-mon-td${_bkAmtCls(v)}">${v ? _fmtBkAmt(v) : '—'}</td>`;
        }).join('');
        bodyRows += `<tr class="bk-pv-month-row">
          <td class="bk-pv-row-hdr bk-pv-month-hdr">${fmtMon(mon)}</td>${monCells}
        </tr>`;
      }
    }
  }

  const totals = cols.map(c => {
    const t = years.reduce((s, yr) => s + (yearMap[yr][c.id] || 0), 0);
    return `<td class="bk-pv-td bk-pv-num bk-pv-total${_bkAmtCls(t)}">${t ? _fmtBkAmt(t) : '—'}</td>`;
  }).join('');

  const pivotHtml = `<div class="bk-pivot-card">
    <div class="bk-pivot-title">By Year / Month</div>
    <div class="bk-pivot-scroll">
      <table class="bk-pivot-tbl">
        <thead>${groupHdr}</thead>
        <tbody>${bodyRows}</tbody>
        <tfoot><tr><td class="bk-pv-row-hdr bk-pv-total-lbl">Total</td>${totals}</tr></tfoot>
      </table>
    </div>
  </div>`;

  panel.innerHTML =
    _buildOverallTotalsHtml(banks, brokerages, _pvBnkTotals, _pvBrTotals) +
    pivotHtml;
}

// ─── Incremental totals refresh (preserves focus while typing) ────────────────

function _refreshBankingTotals() {
  const bnkTotals = {};
  for (const brok of _brokAccts()) {
    const entries = _bkEntries.filter(e => e.brokerageId === brok.id);
    let brokSum = 0, bankSum = 0;
    for (const e of entries) {
      const ba = parseFloat(e.bankAmount)      || 0;
      const br = parseFloat(e.brokerageAmount) || 0;
      brokSum += br; bankSum += ba;
      bnkTotals[e.bankId] = (bnkTotals[e.bankId] || 0) + ba;
    }
    const bsEl = document.querySelector(`[data-bk-banksum="${brok.id}"]`);
    if (bsEl) { bsEl.textContent = _fmtBkAmt(bankSum); bsEl.className = `bk-subtotal-val${_bkAmtCls(bankSum)}`; }
    const brEl = document.querySelector(`[data-bk-brsum="${brok.id}"]`);
    if (brEl) { brEl.textContent = _fmtBkAmt(brokSum); brEl.className = `bk-subtotal-val${_bkAmtCls(brokSum)}`; }
    document.querySelectorAll(`[data-bk-brok-total="${brok.id}"]`).forEach(el => {
      el.textContent = _fmtBkAmt(brokSum); el.className = `bk-overall-amt${_bkAmtCls(brokSum)}`;
    });
  }
  for (const b of _bankAccts()) {
    const tot = bnkTotals[b.id] || 0;
    document.querySelectorAll(`[data-bk-bank-total="${b.id}"]`).forEach(el => {
      el.textContent = _fmtBkAmt(tot); el.className = `bk-overall-amt${_bkAmtCls(tot)}`;
    });
  }
}
