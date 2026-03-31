// ─── GLOBAL FILTER STATE ───
let openPosFilterActive = false;
let gfSelectedTags     = [];
let gfSelectedRules    = [];
let gfSelectedMistakes = [];

function getDateRange(preset) {
  const now   = new Date();
  const pad   = n => String(n).padStart(2, '0');
  const iso   = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const today = iso(now);
  if (preset === 'daily') return { from: today, to: today };
  if (preset === 'weekly') {
    const sun = new Date(now); sun.setDate(now.getDate() - now.getDay());
    const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
    return { from: iso(sun), to: iso(sat) };
  }
  if (preset === 'monthly') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: iso(first), to: iso(last) };
  }
  if (preset === 'ytd') return { from: `${now.getFullYear()}-01-01`, to: today };
  return null;
}

function applyGlobalFilter(trades) {
  const srch  = (document.getElementById('gf-srch')?.value  || '').toLowerCase();
  const fType = document.getElementById('gf-type')?.value  || '';
  const fSide = document.getElementById('gf-side')?.value  || '';
  const fDate = document.getElementById('gf-date')?.value  || '';
  const fFrom = document.getElementById('gf-from')?.value  || '';
  const fTo   = document.getElementById('gf-to')?.value    || '';

  let filtered = trades;

  if (srch)  filtered = filtered.filter(t => t.symbol.toLowerCase().includes(srch));
  if (fType) filtered = filtered.filter(t => t.type === fType);
  if (fSide) filtered = filtered.filter(t => {
    if (t.legs && t.legs.length) {
      const firstAction = t.legs[0].action;
      if (fSide === 'long')  return firstAction === 'buy';
      if (fSide === 'short') return firstAction === 'sell' && t.legs.some(l => l.action === 'buy');
    }
    return t.side === fSide;
  });

  if (fDate && fDate !== 'custom') {
    const range = getDateRange(fDate);
    if (range) filtered = filtered.filter(t => t.date >= range.from && t.date <= range.to);
  } else if (fDate === 'custom') {
    if (fFrom) filtered = filtered.filter(t => t.date >= fFrom);
    if (fTo)   filtered = filtered.filter(t => t.date <= fTo);
  }

  if (gfSelectedTags.length) {
    filtered = filtered.filter(t =>
      Array.isArray(t.tags) && gfSelectedTags.some(id => t.tags.includes(id))
    );
  }

  if (gfSelectedRules.length) {
    filtered = filtered.filter(t =>
      Array.isArray(t.rules) && gfSelectedRules.some(id => t.rules.includes(id))
    );
  }

  if (gfSelectedMistakes.length) {
    filtered = filtered.filter(t =>
      Array.isArray(t.mistakes) && gfSelectedMistakes.some(id => t.mistakes.includes(id))
    );
  }

  if (openPosFilterActive) filtered = filtered.filter(t => getOpenQty(t) > 0);

  return filtered;
}

function toggleOpenPositions() {
  openPosFilterActive = !openPosFilterActive;
  document.getElementById('gf-open-pos-btn').classList.toggle('active', openPosFilterActive);
  renderActiveFilters();
  refreshAllViews();
}

function onGlobalFilterChange() {
  renderActiveFilters();
  refreshAllViews();
}

function onGlobalDateFilterChange() {
  const val = document.getElementById('gf-date').value;
  document.getElementById('gf-custom-range').style.display = val === 'custom' ? 'flex' : 'none';
  renderActiveFilters();
  refreshAllViews();
}

function resetGlobalFilters() {
  document.getElementById('gf-srch').value  = '';
  document.getElementById('gf-type').value  = '';
  document.getElementById('gf-side').value  = '';
  document.getElementById('gf-date').value  = '';
  document.getElementById('gf-from').value  = '';
  document.getElementById('gf-to').value    = '';
  document.getElementById('gf-custom-range').style.display = 'none';
  gfSelectedTags     = [];
  gfSelectedRules    = [];
  gfSelectedMistakes = [];
  updateGfMultiLabel('tags');
  updateGfMultiLabel('rules');
  updateGfMultiLabel('mistakes');
  document.querySelectorAll('.gf-multi-drop.open').forEach(d => d.classList.remove('open'));
  openPosFilterActive = false;
  document.getElementById('gf-open-pos-btn').classList.remove('active');
  renderActiveFilters();
  refreshAllViews();
}

// ─── MULTI-SELECT DROPDOWN ───

function buildGfMultiDrop(type) {
  const items = type === 'tags' ? loadTags() : type === 'mistakes' ? loadMistakes() : loadRules();
  const drop  = document.getElementById(`gf-${type}-drop`);
  const sel   = type === 'tags' ? gfSelectedTags : type === 'mistakes' ? gfSelectedMistakes : gfSelectedRules;
  if (!drop) return;
  if (!items.length) {
    drop.innerHTML = `<div class="gf-multi-empty">No ${type} defined yet</div>`;
    return;
  }
  drop.innerHTML = items.map(item =>
    `<label class="gf-multi-item">
      <input type="checkbox" class="gf-check-${type}" value="${item.id}" ${sel.includes(item.id) ? 'checked' : ''}
        onchange="onGfMultiChange('${type}','${item.id}',this.checked)">
      <span>${item.text}</span>
    </label>`
  ).join('');
}

function toggleGfMultiDrop(type) {
  buildGfMultiDrop(type);
  const drop   = document.getElementById(`gf-${type}-drop`);
  const isOpen = drop.classList.contains('open');
  document.querySelectorAll('.gf-multi-drop.open').forEach(d => d.classList.remove('open'));
  if (!isOpen) drop.classList.add('open');
}

function onGfMultiChange(type, id, checked) {
  if (type === 'tags') {
    if (checked) { if (!gfSelectedTags.includes(id)) gfSelectedTags.push(id); }
    else gfSelectedTags = gfSelectedTags.filter(x => x !== id);
  } else if (type === 'mistakes') {
    if (checked) { if (!gfSelectedMistakes.includes(id)) gfSelectedMistakes.push(id); }
    else gfSelectedMistakes = gfSelectedMistakes.filter(x => x !== id);
  } else {
    if (checked) { if (!gfSelectedRules.includes(id)) gfSelectedRules.push(id); }
    else gfSelectedRules = gfSelectedRules.filter(x => x !== id);
  }
  updateGfMultiLabel(type);
  renderActiveFilters();
  refreshAllViews();
}

function updateGfMultiLabel(type) {
  const sel   = type === 'tags' ? gfSelectedTags : type === 'mistakes' ? gfSelectedMistakes : gfSelectedRules;
  const label = document.getElementById(`gf-${type}-label`);
  const btn   = document.getElementById(`gf-${type}-btn`);
  if (!label) return;
  const noun = type === 'tags' ? 'Tag' : type === 'mistakes' ? 'Mistake' : 'Rule';
  label.textContent = sel.length === 0
    ? `All ${noun}s`
    : `${sel.length} ${noun}${sel.length !== 1 ? 's' : ''}`;
  if (btn) btn.classList.toggle('active', sel.length > 0);
}

function updateFilterBarContext(view) {
  const isPlan = view === 'plan';

  // Hide entire stats bar and filter bar on Trade Plan
  const statsBar  = document.getElementById('stats-bar');
  const filterBar = document.getElementById('global-filter-bar');
  if (statsBar)  statsBar.style.display  = isPlan ? 'none' : '';
  if (filterBar) filterBar.style.display = isPlan ? 'none' : '';

  const sideEl       = document.getElementById('gf-side');
  const tagsWrap     = document.getElementById('gf-tags-wrap');
  const rulesWrap    = document.getElementById('gf-rules-wrap');
  const mistakesWrap = document.getElementById('gf-mistakes-wrap');
  if (sideEl)       sideEl.style.display       = view === 'trades' ? '' : 'none';
  if (tagsWrap)     tagsWrap.style.display      = isPlan ? 'none' : '';
  if (rulesWrap)    rulesWrap.style.display     = isPlan ? 'none' : '';
  if (mistakesWrap) mistakesWrap.style.display  = isPlan ? 'none' : '';
  renderActiveFilters();
}

// ─── ACTIVE FILTERS BAR ───

function renderActiveFilters() {
  const bar   = document.getElementById('gf-active-bar');
  const chips = document.getElementById('gf-active-chips');
  if (!bar || !chips) return;

  const view = (typeof state !== 'undefined') ? state.view : 'calendar';
  if (view === 'plan') { bar.style.display = 'none'; return; }

  const srch  = document.getElementById('gf-srch')?.value  || '';
  const fType = document.getElementById('gf-type')?.value  || '';
  const fSide = document.getElementById('gf-side')?.value  || '';
  const fDate = document.getElementById('gf-date')?.value  || '';
  const fFrom = document.getElementById('gf-from')?.value  || '';
  const fTo   = document.getElementById('gf-to')?.value    || '';
  const allTags     = loadTags();
  const allRules    = loadRules();
  const allMistakes = loadMistakes();

  const parts = [];

  if (srch) parts.push(
    `<span class="gf-chip">Symbol: "${srch.toUpperCase()}"
      <button class="gf-chip-x" onclick="clearGfChip('srch')" title="Remove">&#10005;</button>
    </span>`
  );

  if (fType) parts.push(
    `<span class="gf-chip">${fType.charAt(0).toUpperCase() + fType.slice(1)}
      <button class="gf-chip-x" onclick="clearGfChip('type')" title="Remove">&#10005;</button>
    </span>`
  );

  if (fSide && view === 'trades') parts.push(
    `<span class="gf-chip">${fSide.charAt(0).toUpperCase() + fSide.slice(1)}
      <button class="gf-chip-x" onclick="clearGfChip('side')" title="Remove">&#10005;</button>
    </span>`
  );

  if (fDate) {
    const dateMap = { daily: 'Today', weekly: 'This Week', monthly: 'This Month', ytd: 'YTD' };
    let label;
    if (fDate === 'custom') {
      label = fFrom && fTo ? `${fFrom} \u2192 ${fTo}` : fFrom ? `From ${fFrom}` : `To ${fTo}`;
    } else {
      label = dateMap[fDate] || fDate;
    }
    parts.push(
      `<span class="gf-chip">${label}
        <button class="gf-chip-x" onclick="clearGfChip('date')" title="Remove">&#10005;</button>
      </span>`
    );
  }

  for (const id of gfSelectedTags) {
    const tag = allTags.find(t => t.id === id);
    if (tag) parts.push(
      `<span class="gf-chip gf-chip-tag">Tag: ${tag.text}
        <button class="gf-chip-x" onclick="clearGfChip('tag','${id}')" title="Remove">&#10005;</button>
      </span>`
    );
  }

  for (const id of gfSelectedRules) {
    const rule = allRules.find(r => r.id === id);
    if (rule) parts.push(
      `<span class="gf-chip gf-chip-rule">Rule: ${rule.text}
        <button class="gf-chip-x" onclick="clearGfChip('rule','${id}')" title="Remove">&#10005;</button>
      </span>`
    );
  }

  for (const id of gfSelectedMistakes) {
    const mistake = allMistakes.find(m => m.id === id);
    if (mistake) parts.push(
      `<span class="gf-chip gf-chip-mistake">Mistake: ${mistake.text}
        <button class="gf-chip-x" onclick="clearGfChip('mistake','${id}')" title="Remove">&#10005;</button>
      </span>`
    );
  }

  if (openPosFilterActive) parts.push(
    `<span class="gf-chip">Open Positions
      <button class="gf-chip-x" onclick="clearGfChip('openpos')" title="Remove">&#10005;</button>
    </span>`
  );

  if (!parts.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  chips.innerHTML = parts.join('');
}

function clearGfChip(type, id) {
  switch (type) {
    case 'srch':
      document.getElementById('gf-srch').value = '';
      break;
    case 'type':
      document.getElementById('gf-type').value = '';
      break;
    case 'side':
      document.getElementById('gf-side').value = '';
      break;
    case 'date':
      document.getElementById('gf-date').value = '';
      document.getElementById('gf-from').value = '';
      document.getElementById('gf-to').value   = '';
      document.getElementById('gf-custom-range').style.display = 'none';
      break;
    case 'tag':
      gfSelectedTags = gfSelectedTags.filter(x => x !== id);
      updateGfMultiLabel('tags');
      break;
    case 'rule':
      gfSelectedRules = gfSelectedRules.filter(x => x !== id);
      updateGfMultiLabel('rules');
      break;
    case 'mistake':
      gfSelectedMistakes = gfSelectedMistakes.filter(x => x !== id);
      updateGfMultiLabel('mistakes');
      break;
    case 'openpos':
      openPosFilterActive = false;
      document.getElementById('gf-open-pos-btn').classList.remove('active');
      break;
  }
  renderActiveFilters();
  refreshAllViews();
}

function refreshAllViews() {
  renderStats();
  const calVisible     = document.getElementById('view-cal')?.style.display     !== 'none';
  const tradesVisible  = document.getElementById('view-trades')?.style.display  !== 'none';
  const planVisible    = document.getElementById('view-plan')?.style.display    !== 'none';
  const reportsVisible = document.getElementById('view-reports')?.style.display !== 'none';
  if (calVisible)     renderCalendar();
  if (tradesVisible)  renderTrades();
  if (planVisible && typeof PLAN_STATE !== 'undefined' && planInitialized) renderPlanView();
  if (reportsVisible) renderReportContent();
}
