/* ── wotp-modal.js ── Add/Edit option idea modal ─────────────────── */
// All IDs prefixed with "if-" (idea form) to avoid conflicts with day-trade modal.
// Overlay/modal elements: #idea-overlay, #idea-modal

let _ideaEditId      = null;
let _ideaDefaultWeek = null;
let _ideaPostSaveHook = null; // optional callback(idea) after saveIdea()

// ── 24 preset colors ──────────────────────────────────────────────
const IDEA_PRESET_COLORS = [
  '#ef4444','#f43f5e','#ec4899','#db2777',
  '#c026d3','#a855f7','#8b5cf6','#6366f1',
  '#3b82f6','#0ea5e9','#06b6d4','#14b8a6',
  '#10b981','#22c55e','#84cc16','#65a30d',
  '#eab308','#f59e0b','#f97316','#ea580c',
  '#64748b','#94a3b8','#e2e8f0','#78716c',
];

function _buildIdeaSwatches() {
  const grid = document.getElementById('if-swatch-grid');
  let html = `<div class="swatch swatch-auto selected" data-color="" title="Auto (from ticker)" onclick="_selectIdeaSwatch(this,'')">&#10022;</div>`;
  IDEA_PRESET_COLORS.forEach(c => {
    html += `<div class="swatch" data-color="${c}" title="${c}" style="background:${c}" onclick="_selectIdeaSwatch(this,'${c}')"></div>`;
  });
  html += `<div class="swatch swatch-other" data-color="other" title="Custom color" onclick="_openIdeaOtherPicker()"></div>`;
  grid.innerHTML = html;
}

function _selectIdeaSwatch(el, color) {
  document.querySelectorAll('#if-swatch-grid .swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('if-color').value = color;
  _updateIdeaColorHint(color);
}

function _openIdeaOtherPicker() {
  const picker = document.getElementById('if-color-picker');
  const cur = document.getElementById('if-color').value;
  if (/^#[0-9a-fA-F]{6}$/.test(cur)) picker.value = cur;
  picker.click();
}

function _syncIdeaSwatchToColor(color) {
  const grid = document.getElementById('if-swatch-grid');
  grid.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
  if (!color) {
    grid.querySelector('[data-color=""]')?.classList.add('selected');
    return;
  }
  const match = grid.querySelector(`[data-color="${color}"]`);
  if (match && match.dataset.color !== 'other') {
    match.classList.add('selected');
  } else {
    const other = grid.querySelector('.swatch-other');
    if (other) { other.style.background = color; other.classList.add('selected'); }
  }
}

function _updateIdeaColorHint(color) {
  document.getElementById('if-color-label-hint').textContent = color ? color : '(auto from ticker)';
}

// ── Open / Close ──────────────────────────────────────────────────
function openAddIdeaModal(weekOf) {
  _ideaEditId      = null;
  _ideaDefaultWeek = weekOf || getMondayOf(todayStr());
  _populateIdeaForm(null);
  _openIdeaOverlay();
}

function openEditIdeaModal(id) {
  const ideas = loadIdeas();
  const idea  = ideas.find(i => i.id === id);
  if (!idea) return;
  _ideaEditId      = id;
  _ideaDefaultWeek = idea.weekOf;
  _populateIdeaForm(idea);
  _openIdeaOverlay();
}

function closeIdeaModal() {
  document.getElementById('idea-overlay').classList.remove('open');
  document.getElementById('idea-modal').classList.remove('open');
}

function _openIdeaOverlay() {
  document.getElementById('idea-overlay').classList.add('open');
  document.getElementById('idea-modal').classList.add('open');
  document.getElementById('if-symbol').focus();
}

function _setIdeaOptType(val) {
  document.querySelectorAll('input[name="if-opt-type"]').forEach(r => { r.checked = r.value === val; });
}

function _getIdeaOptType() {
  const r = document.querySelector('input[name="if-opt-type"]:checked');
  return r ? r.value : 'call';
}

function _populateIdeaForm(idea) {
  document.getElementById('idea-modal-title').textContent = idea ? 'Edit Trade Plan' : 'Add Trade Plan';
  document.getElementById('if-symbol').value  = idea?.symbol      || '';
  _setIdeaOptType(idea?.optionType || 'call');
  document.getElementById('if-strike').value  = idea?.strikePrice  ?? '';
  document.getElementById('if-expiry').value  = idea?.expiryDate   || '';
  document.getElementById('if-trigger').value = idea?.triggerPrice ?? '';
  document.getElementById('if-stop').value    = idea?.stopPrice    ?? '';
  document.getElementById('if-week').value    = idea?.weekOf       || _ideaDefaultWeek || getMondayOf(todayStr());
  document.getElementById('if-created').value = idea?.createdAt    || todayStr();
  document.getElementById('if-status').value  = idea?.status       || 'active';
  document.getElementById('if-notes').value   = idea?.notes        || '';
  const color = idea?.customColor || '';
  document.getElementById('if-color').value = color;
  _syncIdeaSwatchToColor(color);
  _updateIdeaColorHint(color);
  const targets = idea?.targets || [];
  document.getElementById('if-t1').value = targets[0] ?? '';
  document.getElementById('if-t2').value = targets[1] ?? '';
  document.getElementById('if-t3').value = targets[2] ?? '';
}

// ── Save / Delete ─────────────────────────────────────────────────
function saveIdea() {
  const symbol = document.getElementById('if-symbol').value.trim().toUpperCase();
  if (!symbol) { alert('Symbol is required.'); return; }

  const strikeRaw  = document.getElementById('if-strike').value;
  const triggerRaw = document.getElementById('if-trigger').value;
  const stopRaw    = document.getElementById('if-stop').value;
  const t1 = document.getElementById('if-t1').value;
  const t2 = document.getElementById('if-t2').value;
  const t3 = document.getElementById('if-t3').value;

  const targets = [t1, t2, t3]
    .map(v => v.trim() === '' ? null : parseFloat(v))
    .filter(v => v !== null && !isNaN(v));

  const rawColor    = document.getElementById('if-color').value.trim();
  const customColor = /^#[0-9a-fA-F]{3,6}$/.test(rawColor) ? rawColor : null;

  const idea = {
    id:           _ideaEditId || uid(),
    symbol,
    optionType:   _getIdeaOptType(),
    strikePrice:  strikeRaw  !== '' ? parseFloat(strikeRaw)  : null,
    expiryDate:   document.getElementById('if-expiry').value  || null,
    triggerPrice: triggerRaw !== '' ? parseFloat(triggerRaw) : null,
    targets,
    stopPrice:    stopRaw    !== '' ? parseFloat(stopRaw)    : null,
    weekOf:       document.getElementById('if-week').value    || getMondayOf(todayStr()),
    createdAt:    document.getElementById('if-created').value || todayStr(),
    status:       document.getElementById('if-status').value,
    notes:        document.getElementById('if-notes').value.trim(),
    customColor,
  };

  let ideas = loadIdeas();
  if (_ideaEditId) {
    const idx = ideas.findIndex(i => i.id === _ideaEditId);
    if (idx !== -1) ideas[idx] = idea; else ideas.push(idea);
  } else {
    ideas.push(idea);
  }
  saveIdeas(ideas);
  closeIdeaModal();
  renderPlanView();
  if (typeof _ideaPostSaveHook === 'function') { _ideaPostSaveHook(idea); _ideaPostSaveHook = null; }
}

function deleteIdea(id) {
  if (!confirm('Delete this trade plan idea?')) return;
  saveIdeas(loadIdeas().filter(i => i.id !== id));
  renderPlanView();
}

// ── Init ──────────────────────────────────────────────────────────
let _ideaModalReady = false;

function initIdeaModal() {
  if (_ideaModalReady) return;
  _ideaModalReady = true;
  _buildIdeaSwatches();

  document.getElementById('idea-overlay').addEventListener('click', closeIdeaModal);

  document.getElementById('if-color-picker').addEventListener('input', e => {
    const color = e.target.value;
    document.getElementById('if-color').value = color;
    _syncIdeaSwatchToColor(color);
    _updateIdeaColorHint(color);
  });

  document.getElementById('idea-modal-save').addEventListener('click', saveIdea);
  document.getElementById('idea-modal-cancel').addEventListener('click', closeIdeaModal);
  document.getElementById('idea-modal-close').addEventListener('click', closeIdeaModal);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeIdeaModal();
  });
}
