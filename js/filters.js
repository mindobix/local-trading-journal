// ─── GLOBAL FILTER STATE ───
let openPosFilterActive = false;
let gfSelectedTags     = { include: [], exclude: [] };
let gfSelectedRules    = { include: [], exclude: [] };
let gfSelectedMistakes = { include: [], exclude: [] };
const gfMultiActiveTab = { tags: 'include', rules: 'include', mistakes: 'include' };

let filterView = 'calendar'; // which tab's filters are currently shown in the bar

function _captureFilterSnapshot() {
  return {
    srch:     document.getElementById('gf-srch')?.value || '',
    type:     document.getElementById('gf-type')?.value || '',
    side:     document.getElementById('gf-side')?.value || '',
    date:     document.getElementById('gf-date')?.value || '',
    from:     document.getElementById('gf-from')?.value || '',
    to:       document.getElementById('gf-to')?.value   || '',
    tags:     { include: [...gfSelectedTags.include],     exclude: [...gfSelectedTags.exclude] },
    rules:    { include: [...gfSelectedRules.include],    exclude: [...gfSelectedRules.exclude] },
    mistakes: { include: [...gfSelectedMistakes.include], exclude: [...gfSelectedMistakes.exclude] },
    openPos:  openPosFilterActive,
  };
}

function _applyFilterSnapshot(snap) {
  document.getElementById('gf-srch').value = snap.srch;
  document.getElementById('gf-type').value = snap.type;
  document.getElementById('gf-side').value = snap.side;
  document.getElementById('gf-date').value = snap.date;
  document.getElementById('gf-from').value = snap.from;
  document.getElementById('gf-to').value   = snap.to;
  drFrom = snap.from || ''; drTo = snap.to || '';
  _updateDrBtn();
  gfSelectedTags     = { include: [...snap.tags.include],     exclude: [...snap.tags.exclude] };
  gfSelectedRules    = { include: [...snap.rules.include],    exclude: [...snap.rules.exclude] };
  gfSelectedMistakes = { include: [...snap.mistakes.include], exclude: [...snap.mistakes.exclude] };
  updateGfMultiLabel('tags');
  updateGfMultiLabel('rules');
  updateGfMultiLabel('mistakes');
  openPosFilterActive = snap.openPos;
  document.getElementById('gf-open-pos-btn')?.classList.toggle('active', snap.openPos);
}

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

  if (gfSelectedTags.include.length) {
    filtered = filtered.filter(t =>
      Array.isArray(t.tags) && gfSelectedTags.include.some(id => t.tags.includes(id))
    );
  }
  if (gfSelectedTags.exclude.length) {
    filtered = filtered.filter(t =>
      !Array.isArray(t.tags) || !gfSelectedTags.exclude.some(id => t.tags.includes(id))
    );
  }

  if (gfSelectedRules.include.length) {
    filtered = filtered.filter(t =>
      Array.isArray(t.rules) && gfSelectedRules.include.some(id => t.rules.includes(id))
    );
  }
  if (gfSelectedRules.exclude.length) {
    filtered = filtered.filter(t =>
      !Array.isArray(t.rules) || !gfSelectedRules.exclude.some(id => t.rules.includes(id))
    );
  }

  if (gfSelectedMistakes.include.length) {
    filtered = filtered.filter(t =>
      Array.isArray(t.mistakes) && gfSelectedMistakes.include.some(id => t.mistakes.includes(id))
    );
  }
  if (gfSelectedMistakes.exclude.length) {
    filtered = filtered.filter(t =>
      !Array.isArray(t.mistakes) || !gfSelectedMistakes.exclude.some(id => t.mistakes.includes(id))
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
  if (typeof tradePage !== 'undefined') tradePage = 1;
  renderActiveFilters();
  refreshAllViews();
  dbPutSetting('filterState', _captureFilterSnapshot()).catch(console.error);
}

function onGlobalDateFilterChange() {
  const val = document.getElementById('gf-date').value;
  document.getElementById('gf-custom-range').style.display = val === 'custom' ? 'flex' : 'none';
  renderActiveFilters();
  refreshAllViews();
}

function resetGlobalFilters() {
  document.getElementById('gf-srch').value = '';
  document.getElementById('gf-type').value = '';
  document.getElementById('gf-side').value = '';
  drFrom = ''; drTo = '';
  document.getElementById('gf-date').value = '';
  document.getElementById('gf-from').value = '';
  document.getElementById('gf-to').value   = '';
  _updateDrBtn();
  if (typeof tradePage !== 'undefined') tradePage = 1;
  gfSelectedTags     = { include: [], exclude: [] };
  gfSelectedRules    = { include: [], exclude: [] };
  gfSelectedMistakes = { include: [], exclude: [] };
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
  const items     = type === 'tags' ? loadTags() : type === 'mistakes' ? loadMistakes() : loadRules();
  const drop      = document.getElementById(`gf-${type}-drop`);
  const sel       = type === 'tags' ? gfSelectedTags : type === 'mistakes' ? gfSelectedMistakes : gfSelectedRules;
  const activeTab = gfMultiActiveTab[type];
  if (!drop) return;

  const tabsHtml = `<div class="gf-multi-tabs">
    <button class="gf-multi-tab ${activeTab === 'include' ? 'active include' : ''}" onclick="setGfMultiTab('${type}','include')">Include</button>
    <button class="gf-multi-tab ${activeTab === 'exclude' ? 'active exclude' : ''}" onclick="setGfMultiTab('${type}','exclude')">Exclude</button>
  </div>`;

  if (!items.length) {
    drop.innerHTML = tabsHtml + `<div class="gf-multi-empty">No ${type} defined yet</div>`;
    return;
  }

  drop.innerHTML = tabsHtml + items.map(item =>
    `<label class="gf-multi-item">
      <input type="checkbox" class="gf-check-${type}" value="${item.id}" ${sel[activeTab].includes(item.id) ? 'checked' : ''}
        onchange="onGfMultiChange('${type}','${item.id}',this.checked)">
      <span>${item.text}</span>
    </label>`
  ).join('');
}

function setGfMultiTab(type, tab) {
  gfMultiActiveTab[type] = tab;
  buildGfMultiDrop(type);
  document.getElementById(`gf-${type}-drop`)?.classList.add('open');
}

function toggleGfMultiDrop(type) {
  buildGfMultiDrop(type);
  const drop   = document.getElementById(`gf-${type}-drop`);
  const isOpen = drop.classList.contains('open');
  document.querySelectorAll('.gf-multi-drop.open').forEach(d => d.classList.remove('open'));
  if (!isOpen) drop.classList.add('open');
}

function onGfMultiChange(type, id, checked) {
  const sel       = type === 'tags' ? gfSelectedTags : type === 'mistakes' ? gfSelectedMistakes : gfSelectedRules;
  const activeTab = gfMultiActiveTab[type];
  if (checked) {
    if (!sel[activeTab].includes(id)) sel[activeTab].push(id);
  } else {
    sel[activeTab] = sel[activeTab].filter(x => x !== id);
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
  const noun  = type === 'tags' ? 'Tag' : type === 'mistakes' ? 'Mistake' : 'Rule';
  const total = sel.include.length + sel.exclude.length;
  label.textContent = total === 0
    ? `All ${noun}s`
    : `${total} ${noun}${total !== 1 ? 's' : ''}`;
  if (btn) btn.classList.toggle('active', total > 0);
}

function updateFilterBarContext(view) {
  if (view === 'calendar' || view === 'trades') filterView = view;

  const isPlan    = view === 'plan';
  const isReports = view === 'reports';
  const isNews    = view === 'news';
  const isSignalIntel = view === 'signal-intel';
  const hideChrome = isPlan || isReports || isNews || isSignalIntel;

  // Hide entire stats bar and filter bar on Trade Plan and Reports
  const statsBar  = document.getElementById('stats-bar');
  const filterBar = document.getElementById('global-filter-bar');
  if (statsBar)  statsBar.style.display  = hideChrome ? 'none' : '';
  if (filterBar) filterBar.style.display = hideChrome ? 'none' : '';

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
  if (view === 'plan' || view === 'reports') { bar.style.display = 'none'; return; }

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

  for (const id of gfSelectedTags.include) {
    const tag = allTags.find(t => t.id === id);
    if (tag) parts.push(
      `<span class="gf-chip gf-chip-tag">Incl Tag: ${tag.text}
        <button class="gf-chip-x" onclick="clearGfChip('tag-incl','${id}')" title="Remove">&#10005;</button>
      </span>`
    );
  }
  for (const id of gfSelectedTags.exclude) {
    const tag = allTags.find(t => t.id === id);
    if (tag) parts.push(
      `<span class="gf-chip gf-chip-tag gf-chip-excl">Excl Tag: ${tag.text}
        <button class="gf-chip-x" onclick="clearGfChip('tag-excl','${id}')" title="Remove">&#10005;</button>
      </span>`
    );
  }

  for (const id of gfSelectedRules.include) {
    const rule = allRules.find(r => r.id === id);
    if (rule) parts.push(
      `<span class="gf-chip gf-chip-rule">Incl Rule: ${rule.text}
        <button class="gf-chip-x" onclick="clearGfChip('rule-incl','${id}')" title="Remove">&#10005;</button>
      </span>`
    );
  }
  for (const id of gfSelectedRules.exclude) {
    const rule = allRules.find(r => r.id === id);
    if (rule) parts.push(
      `<span class="gf-chip gf-chip-rule gf-chip-excl">Excl Rule: ${rule.text}
        <button class="gf-chip-x" onclick="clearGfChip('rule-excl','${id}')" title="Remove">&#10005;</button>
      </span>`
    );
  }

  for (const id of gfSelectedMistakes.include) {
    const mistake = allMistakes.find(m => m.id === id);
    if (mistake) parts.push(
      `<span class="gf-chip gf-chip-mistake">Incl Mistake: ${mistake.text}
        <button class="gf-chip-x" onclick="clearGfChip('mistake-incl','${id}')" title="Remove">&#10005;</button>
      </span>`
    );
  }
  for (const id of gfSelectedMistakes.exclude) {
    const mistake = allMistakes.find(m => m.id === id);
    if (mistake) parts.push(
      `<span class="gf-chip gf-chip-mistake gf-chip-excl">Excl Mistake: ${mistake.text}
        <button class="gf-chip-x" onclick="clearGfChip('mistake-excl','${id}')" title="Remove">&#10005;</button>
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
      clearDrPicker();
      return;  // clearDrPicker already calls onGlobalFilterChange
    case 'tag-incl':
      gfSelectedTags.include = gfSelectedTags.include.filter(x => x !== id);
      updateGfMultiLabel('tags');
      break;
    case 'tag-excl':
      gfSelectedTags.exclude = gfSelectedTags.exclude.filter(x => x !== id);
      updateGfMultiLabel('tags');
      break;
    case 'rule-incl':
      gfSelectedRules.include = gfSelectedRules.include.filter(x => x !== id);
      updateGfMultiLabel('rules');
      break;
    case 'rule-excl':
      gfSelectedRules.exclude = gfSelectedRules.exclude.filter(x => x !== id);
      updateGfMultiLabel('rules');
      break;
    case 'mistake-incl':
      gfSelectedMistakes.include = gfSelectedMistakes.include.filter(x => x !== id);
      updateGfMultiLabel('mistakes');
      break;
    case 'mistake-excl':
      gfSelectedMistakes.exclude = gfSelectedMistakes.exclude.filter(x => x !== id);
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

// ─── DATE RANGE PICKER ───────────────────────────────────────────────────────

let drFrom = '', drTo = '';
let drHover = '';
let drLeftYear  = new Date().getFullYear();
let drLeftMonth = new Date().getMonth();
let drPickingFrom = true;

const _DR_MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
const _DR_DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function _drPad(n) { return String(n).padStart(2, '0'); }
function _drFmt(d) {
  return `${d.getFullYear()}-${_drPad(d.getMonth()+1)}-${_drPad(d.getDate())}`;
}
function _drFmtDisplay(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${_DR_MONTHS[parseInt(m,10)-1].slice(0,3)} ${d}, ${y}`;
}

function toggleDrPicker(e) {
  e.stopPropagation();
  const pop = document.getElementById('gf-dr-popover');
  if (pop.style.display !== 'none') { pop.style.display = 'none'; return; }
  if (drFrom) {
    const [y, m] = drFrom.split('-').map(Number);
    drLeftYear = y; drLeftMonth = m - 1;
  } else {
    const t = new Date();
    drLeftYear = t.getFullYear(); drLeftMonth = t.getMonth();
  }
  _renderDrCals();
  pop.style.display = 'flex';
}

function _drRightYM() {
  let m = drLeftMonth + 1, y = drLeftYear;
  if (m > 11) { m = 0; y++; }
  return [y, m];
}

function _renderDrCals() {
  _renderDrCal('l', drLeftYear, drLeftMonth);
  const [ry, rm] = _drRightYM();
  _renderDrCal('r', ry, rm);
}

function _renderDrCal(side, year, month) {
  const el = document.getElementById(`gf-dr-cal-${side}`);
  if (!el) return;
  const today     = _drFmt(new Date());
  const firstDay  = new Date(year, month, 1).getDay();
  const daysInMo  = new Date(year, month + 1, 0).getDate();
  const daysInPrev= new Date(year, month, 0).getDate();

  let html = `<div class="gf-dr-cal-hdr">`;
  html += side === 'l'
    ? `<button class="gf-dr-nav" onclick="drNavMonth(-1)">&#8249;</button>`
    : `<span class="gf-dr-nav-spacer"></span>`;
  html += `<span class="gf-dr-cal-title">${_DR_MONTHS[month]} ${year}</span>`;
  html += side === 'r'
    ? `<button class="gf-dr-nav" onclick="drNavMonth(1)">&#8250;</button>`
    : `<span class="gf-dr-nav-spacer"></span>`;
  html += `</div><div class="gf-dr-cal-grid">`;

  for (const d of _DR_DAYS) html += `<div class="gf-dr-dow">${d}</div>`;

  for (let i = 0; i < firstDay; i++) {
    html += `<div class="gf-dr-day other-month">${daysInPrev - firstDay + i + 1}</div>`;
  }

  for (let d = 1; d <= daysInMo; d++) {
    const ds = `${year}-${_drPad(month+1)}-${_drPad(d)}`;
    let cls = 'gf-dr-day';
    if (ds === today)                              cls += ' today';
    if (drFrom && ds === drFrom)                   cls += ' range-start';
    if (drTo   && ds === drTo)                     cls += ' range-end';
    if (drFrom && drTo && ds > drFrom && ds < drTo) cls += ' in-range';
    html += `<div class="${cls}" data-date="${ds}" onclick="drDayClick(event,'${ds}')" onmouseenter="drDayHover('${ds}')">${d}</div>`;
  }

  const trailing = (firstDay + daysInMo) % 7;
  if (trailing) for (let i = 1; i <= 7 - trailing; i++)
    html += `<div class="gf-dr-day other-month">${i}</div>`;

  html += `</div>`;
  el.innerHTML = html;
}

function drNavMonth(delta) {
  drLeftMonth += delta;
  if (drLeftMonth < 0)  { drLeftMonth = 11; drLeftYear--; }
  if (drLeftMonth > 11) { drLeftMonth = 0;  drLeftYear++; }
  _renderDrCals();
}

function drDayHover(ds) {
  if (!drPickingFrom && drFrom && drHover !== ds) {
    drHover = ds;
    _updateDrDayClasses();
  }
}

function _updateDrDayClasses() {
  const today = _drFmt(new Date());
  const previewEnd = drHover || drTo;
  const lo = drFrom && previewEnd ? (drFrom <= previewEnd ? drFrom : previewEnd) : drFrom;
  const hi = drFrom && previewEnd ? (drFrom <= previewEnd ? previewEnd : drFrom) : previewEnd;

  document.querySelectorAll('#gf-dr-popover .gf-dr-day:not(.other-month)').forEach(el => {
    const ds = el.getAttribute('data-date');
    if (!ds) return;
    el.className = 'gf-dr-day';
    if (ds === today)               el.classList.add('today');
    if (lo && ds === lo)            el.classList.add('range-start');
    if (hi && ds === hi)            el.classList.add('range-end');
    if (lo && hi && ds > lo && ds < hi) el.classList.add('in-range');
  });
}

function drDayClick(e, ds) {
  e.stopPropagation();
  if (drPickingFrom) {
    drFrom = ds; drTo = ''; drHover = ''; drPickingFrom = false;
  } else {
    if (ds < drFrom) { drTo = drFrom; drFrom = ds; }
    else              { drTo = ds; }
    drHover = ''; drPickingFrom = true;
    _applyDrRange();
    return;
  }
  _renderDrCals();
}

function _applyDrRange() {
  document.getElementById('gf-from').value = drFrom;
  document.getElementById('gf-to').value   = drTo;
  document.getElementById('gf-date').value = 'custom';
  document.getElementById('gf-dr-popover').style.display = 'none';
  _updateDrBtn();
  onGlobalFilterChange();
}

function applyDrPreset(preset) {
  const n   = new Date(); n.setHours(0,0,0,0);
  const fmt = _drFmt;
  let from, to;
  switch (preset) {
    case 'today':
      from = to = fmt(n); break;
    case 'thisweek': {
      const s = new Date(n); s.setDate(n.getDate() - n.getDay());
      const e = new Date(s); e.setDate(s.getDate() + 6);
      from = fmt(s); to = fmt(e); break;
    }
    case 'thismonth':
      from = `${n.getFullYear()}-${_drPad(n.getMonth()+1)}-01`;
      to   = fmt(new Date(n.getFullYear(), n.getMonth()+1, 0)); break;
    case 'last30': {
      const s = new Date(n); s.setDate(s.getDate() - 29);
      from = fmt(s); to = fmt(n); break;
    }
    case 'lastmonth': {
      const last = new Date(n.getFullYear(), n.getMonth(), 0);
      from = `${last.getFullYear()}-${_drPad(last.getMonth()+1)}-01`;
      to   = fmt(last); break;
    }
    case 'thisquarter': {
      const q = Math.floor(n.getMonth() / 3);
      from = `${n.getFullYear()}-${_drPad(q*3+1)}-01`;
      to   = fmt(new Date(n.getFullYear(), q*3+3, 0)); break;
    }
    case 'ytd':
      from = `${n.getFullYear()}-01-01`; to = fmt(n); break;
  }
  drFrom = from; drTo = to; drPickingFrom = true;
  _applyDrRange();
}

function clearDrPicker() {
  drFrom = ''; drTo = ''; drPickingFrom = true;
  document.getElementById('gf-from').value = '';
  document.getElementById('gf-to').value   = '';
  document.getElementById('gf-date').value = '';
  document.getElementById('gf-dr-popover').style.display = 'none';
  _updateDrBtn();
  onGlobalFilterChange();
}

function _updateDrBtn() {
  const label = document.getElementById('gf-dr-label');
  const clear = document.getElementById('gf-dr-clear');
  const btn   = document.getElementById('gf-dr-btn');
  if (!label) return;
  if (drFrom && drTo) {
    label.textContent = `${_drFmtDisplay(drFrom)} – ${_drFmtDisplay(drTo)}`;
    clear.style.display = 'flex'; btn.classList.add('active');
  } else if (drFrom) {
    label.textContent = `From ${_drFmtDisplay(drFrom)}`;
    clear.style.display = 'flex'; btn.classList.add('active');
  } else {
    label.textContent = 'Date Range';
    clear.style.display = 'none'; btn.classList.remove('active');
  }
}

// Close picker when clicking outside
document.addEventListener('click', e => {
  const wrap = document.getElementById('gf-dr-wrap');
  const pop  = document.getElementById('gf-dr-popover');
  if (pop && pop.style.display !== 'none' && wrap && !wrap.contains(e.target)) {
    pop.style.display = 'none';
    drHover = '';
    if (!drTo) { drFrom = ''; drPickingFrom = true; _updateDrBtn(); }
  }
});
