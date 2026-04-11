/* ── plan.js ── Trade Plan tab controller ────────────────────────── */

// ── Daily plan journal storage (IndexedDB-backed, sync public API) ───
//
// Plans are stored in IDB as individual records: { date, html }.
// The in-memory cache is a plain object: { 'YYYY-MM-DD': htmlString }.
// _initPlansStorage() is called once at app startup.

let _plans = {};  // date → html

async function _initPlansStorage() {
  const records = await dbGetAll('plans');   // [{ date, html }, …]
  _plans = {};
  for (const r of records) _plans[r.date] = r.html;

  // Restore last plan view (monthly / weekly / daily)
  const savedView = await dbGetSetting('plan-last-view');
  if (savedView && ['monthly', 'weekly', 'daily'].includes(savedView)) {
    PLAN_STATE.view = savedView;
  }
}

function loadPlans()                  { return _plans; }
function savePlanForDate(date, html)  {
  _plans[date] = html;
  dbPut('plans', { date, html }).catch(console.error);
}

const PLAN_TEMPLATE = [
  '<h3>Pre Market Plan</h3><p><br></p>',
  '<h4>Affirmation</h4><p><br></p>',
  '<h4>Market Analysis</h4><p><br></p>',
  '<h4>Trade Plan</h4><p><br></p>',
  '<h3>Day Recap</h3><p><br></p>',
  '<h4>Mistakes I made</h4><p><br></p>',
  '<h4>What I did great</h4><p><br></p>',
  '<h4>Reinforcement to myself</h4><p><br></p>',
  '<h3>Overall Recap</h3><p><br></p>',
].join('');

// ── Plan view state ───────────────────────────────────────────────
const PLAN_STATE = {
  view:   'monthly',
  year:   new Date().getFullYear(),
  month:  new Date().getMonth() + 1,
  weekOf: null,   // set in initPlanView
};

let planInitialized = false;

// ── Status config for cards ───────────────────────────────────────
const STATUS_CFG = {
  active:    { label: 'Active',     cls: 'status-active'    },
  triggered: { label: 'Triggered',  cls: 'status-triggered' },
  hit:       { label: 'Target Hit', cls: 'status-hit'       },
  stopped:   { label: 'Stopped',    cls: 'status-stopped'   },
};

// ── Card rendering ────────────────────────────────────────────────
function renderIdeaCard(idea) {
  const color   = idea.customColor || tickerColor(idea.symbol);
  const expiry  = idea.expiryDate  ? fmtShortDate(idea.expiryDate) : '\u2014';
  const typeTag = idea.optionType  === 'put' ? 'P' : 'C';
  const strike  = fmtPrice(idea.strikePrice);
  const trigger = fmtPrice(idea.triggerPrice);
  const stop    = fmtPrice(idea.stopPrice);
  const letter  = (idea.symbol || '?')[0].toUpperCase();
  const status  = STATUS_CFG[idea.status] || STATUS_CFG.active;

  const targetsHtml = idea.targets && idea.targets.length
    ? idea.targets.map(t => `<span class="target-val">${fmtPrice(t)}</span>`).join('')
    : '<span class="target-val muted">\u2014</span>';

  const infoLine = `${expiry}&nbsp;&nbsp;<span class="badge-strike ${idea.optionType === 'put' ? 'put' : 'call'}">${strike}${typeTag}</span>&nbsp;&nbsp;<span class="at-label">AT</span>&nbsp;&nbsp;<span class="trigger-val">${trigger}</span>`;

  const notesHtml = idea.notes
    ? `<div class="card-notes">${esc(idea.notes)}</div>`
    : '';

  return `
<div class="option-card ${idea.status || 'active'}" data-id="${esc(idea.id)}" style="--card-clr:${color}" onclick="openEditIdeaModal('${esc(idea.id)}')">
  <div class="card-glow"></div>
  <div class="card-header">
    <div class="card-logo" style="background:${color}22;color:${color}">${letter}</div>
    <div class="card-ticker" style="color:${color}">$${esc(idea.symbol)}</div>
    <div class="card-actions">
      <button class="icon-btn" title="Edit" onclick="event.stopPropagation();openEditIdeaModal('${esc(idea.id)}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="icon-btn del" title="Delete" onclick="event.stopPropagation();deleteIdea('${esc(idea.id)}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>
  </div>
  <div class="card-divider" style="background:${color}33"></div>
  <div class="card-info">${infoLine}</div>
  <div class="card-divider" style="background:${color}22"></div>
  <div class="card-levels">
    <div class="card-targets">
      <div class="levels-icon target-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>
      </div>
      <div class="target-prices">${targetsHtml}</div>
    </div>
    <div class="card-stop">
      <div class="levels-icon stop-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </div>
      <span class="stop-val">${stop}</span>
    </div>
  </div>
  ${notesHtml}
  <div class="card-footer">
    <span class="card-status ${status.cls}">${status.label}</span>
    <span class="card-date muted">${fmtShortDate(idea.weekOf)} wk</span>
  </div>
</div>`;
}

function renderAddIdeaCard(weekOf) {
  return `
<div class="add-card" onclick="openAddIdeaModal('${esc(weekOf)}')">
  <div class="add-card-inner">
    <div class="add-icon">+</div>
    <span>Add Trade Plan</span>
  </div>
</div>`;
}

// ── Weekly prep summary (prev-week Sat/Sun cards at top of daily view) ──
function renderWeeklySummarySection(ideas, monday) {
  const callCount  = ideas.filter(i => i.optionType === 'call').length;
  const putCount   = ideas.filter(i => i.optionType === 'put').length;
  // Sorted so Sat comes before Sun
  const dates      = [...new Set(ideas.map(i => i.createdAt).filter(Boolean))].sort();
  const dateLabel  = dates.map(d =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  ).join(', ');

  const plans       = loadPlans();
  const toggleKey   = 'prep-' + monday; // used only for the section open/close toggle
  const hasAnyPlan  = dates.some(d => plans[d] !== undefined);

  // One plan block per actual creation date (Sat and/or Sun), saving to the real date key
  const planBlocks = dates.map(date => {
    const hasPlan    = plans[date] !== undefined;
    const content    = hasPlan ? plans[date] : PLAN_TEMPLATE;
    const dayLabel   = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const deleteBtn  = hasPlan
      ? `<button class="plan-delete-btn" id="plan-del-btn-${date}" onclick="deleteDayPlan('${date}')">&#128465; Delete</button>`
      : `<span id="plan-del-btn-${date}"></span>`;
    return `
<div class="week-summary-plan-block">
  <div class="day-plan-bar">
    <span class="day-plan-title">${dayLabel}</span>
    <div class="plan-editor-toolbar day-plan-toolbar">
      <button class="plan-fmt-btn" onmousedown="event.preventDefault();planCmd('bold')"      title="Bold"><b>B</b></button>
      <button class="plan-fmt-btn" onmousedown="event.preventDefault();planCmd('italic')"    title="Italic"><i>I</i></button>
      <button class="plan-fmt-btn" onmousedown="event.preventDefault();planCmd('underline')" title="Underline"><u>U</u></button>
    </div>
    ${deleteBtn}
  </div>
  <div id="day-plan-editor-${date}"
       class="plan-editor day-plan-editor"
       contenteditable="true"
       oninput="autoSaveDayPlan('${date}')">${content}</div>
</div>`;
  }).join('');

  return `
<section class="week-summary-section">
  <div class="week-summary-header">
    <div class="week-summary-title-group">
      <svg class="week-summary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <span class="week-summary-title">Weekly Prep</span>
      <span class="week-summary-date">entered ${dateLabel}</span>
    </div>
    <div class="week-summary-meta">
      ${ideas.length ? `<span class="meta-chip calls">${callCount}C</span><span class="meta-chip puts">${putCount}P</span>` : ''}
      <span class="meta-chip total">${ideas.length} plan${ideas.length !== 1 ? 's' : ''}</span>
      <button class="toggle-plan-btn ${hasAnyPlan ? 'has-plan' : ''}" id="toggle-plan-btn-${toggleKey}"
              onclick="toggleDayPlanSection('${toggleKey}')">
        ${hasAnyPlan ? '&#128196; Weekly Plan' : '+ Weekly Plan'}
      </button>
      <button class="week-summary-toggle" id="week-summary-toggle-${monday}" onclick="toggleWeeklySummary('${monday}')">Show all</button>
    </div>
  </div>
  <div class="week-summary-cards-wrap" id="week-summary-wrap-${monday}">
    <div class="week-summary-cards">
      ${ideas.map(renderIdeaCard).join('')}
    </div>
    <div class="week-summary-fade" id="week-summary-fade-${monday}"></div>
  </div>
  <div class="day-plan-section week-summary-plan" id="day-plan-section-${toggleKey}" style="display:none">
    ${planBlocks}
  </div>
</section>`;
}

function toggleWeeklySummary(monday) {
  const wrap = document.getElementById('week-summary-wrap-' + monday);
  const fade = document.getElementById('week-summary-fade-' + monday);
  const btn  = document.getElementById('week-summary-toggle-' + monday);
  if (!wrap) return;
  const expanded = wrap.classList.toggle('expanded');
  if (fade) fade.style.display = expanded ? 'none' : '';
  if (btn)  btn.textContent    = expanded ? 'Show less' : 'Show all';
}

// ── Navigation label ──────────────────────────────────────────────
function updatePlanNavLabel() {
  const el = document.getElementById('plan-nav-label');
  if (!el) return;
  el.textContent = PLAN_STATE.view === 'monthly'
    ? fmtMonthLabel(PLAN_STATE.year, PLAN_STATE.month)
    : fmtWeekRange(PLAN_STATE.weekOf);
}

// ── View switching ────────────────────────────────────────────────
function switchPlanView(v) {
  PLAN_STATE.view = v;
  dbPutSetting('plan-last-view', v).catch(console.error);
  document.querySelectorAll('.plan-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'monthly') {
    const d = new Date(PLAN_STATE.weekOf + 'T12:00:00');
    PLAN_STATE.year  = d.getFullYear();
    PLAN_STATE.month = d.getMonth() + 1;
  }
  renderPlanView();
}

function planNavPrev() {
  if (PLAN_STATE.view === 'monthly') {
    PLAN_STATE.month--;
    if (PLAN_STATE.month < 1) { PLAN_STATE.month = 12; PLAN_STATE.year--; }
  } else {
    const d = new Date(PLAN_STATE.weekOf + 'T12:00:00');
    d.setDate(d.getDate() - 7);
    PLAN_STATE.weekOf = d.toISOString().slice(0, 10);
  }
  renderPlanView();
}

function planNavNext() {
  if (PLAN_STATE.view === 'monthly') {
    PLAN_STATE.month++;
    if (PLAN_STATE.month > 12) { PLAN_STATE.month = 1; PLAN_STATE.year++; }
  } else {
    const d = new Date(PLAN_STATE.weekOf + 'T12:00:00');
    d.setDate(d.getDate() + 7);
    PLAN_STATE.weekOf = d.toISOString().slice(0, 10);
  }
  renderPlanView();
}

function planNavToday() {
  const now = new Date();
  PLAN_STATE.year   = now.getFullYear();
  PLAN_STATE.month  = now.getMonth() + 1;
  PLAN_STATE.weekOf = getMondayOf(todayStr());
  renderPlanView();
}

// ── Main render dispatcher ────────────────────────────────────────
function renderPlanView() {
  updatePlanNavLabel();
  const { view, year, month, weekOf } = PLAN_STATE;
  if (view === 'monthly')      renderPlanMonthlyView(year, month);
  else if (view === 'weekly')  renderPlanWeeklyView(weekOf);
  else                         renderPlanDailyView(weekOf);
}

// ── Monthly view ──────────────────────────────────────────────────
function renderPlanMonthlyView(year, month) {
  const ideas   = loadIdeas();
  const weeks   = getWeeksInMonth(ideas, year, month);
  const el      = document.getElementById('plan-main-content');

  if (!weeks.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">&#128203;</div>
      <p>No trade plans for ${fmtMonthLabel(year, month)}</p>
      <button class="btn-primary" onclick="openAddIdeaModal()">+ Add First Idea</button>
    </div>`;
    return;
  }

  el.innerHTML = weeks.map(monday => {
    const weekIdeas  = ideas.filter(i => i.weekOf === monday);
    const callCount  = weekIdeas.filter(i => i.optionType === 'call').length;
    const putCount   = weekIdeas.filter(i => i.optionType === 'put').length;
    const isCurrent  = monday === getMondayOf(todayStr());
    return `
<section class="week-section ${isCurrent ? 'current-week' : ''}">
  <div class="week-header">
    <div class="week-label">
      ${isCurrent ? '<span class="current-badge">This Week</span>' : ''}
      <span class="week-range">${fmtWeekRange(monday)}</span>
    </div>
    <div class="week-meta">
      ${weekIdeas.length ? `<span class="meta-chip calls">${callCount}C</span><span class="meta-chip puts">${putCount}P</span>` : ''}
      <span class="meta-chip total">${weekIdeas.length} total</span>
    </div>
  </div>
  <div class="cards-grid">
    ${weekIdeas.map(renderIdeaCard).join('')}
    ${renderAddIdeaCard(monday)}
  </div>
</section>`;
  }).join('');
}

// ── Weekly view ───────────────────────────────────────────────────
function renderPlanWeeklyView(monday) {
  const ideas     = loadIdeas().filter(i => i.weekOf === monday);
  const callCount = ideas.filter(i => i.optionType === 'call').length;
  const putCount  = ideas.filter(i => i.optionType === 'put').length;
  const isCurrent = monday === getMondayOf(todayStr());
  const el        = document.getElementById('plan-main-content');

  el.innerHTML = `
<section class="week-section ${isCurrent ? 'current-week' : ''}" style="margin-top:0">
  <div class="week-header">
    <div class="week-label">
      ${isCurrent ? '<span class="current-badge">This Week</span>' : ''}
      <span class="week-range">${fmtWeekRange(monday)}</span>
    </div>
    <div class="week-meta">
      ${ideas.length ? `<span class="meta-chip calls">${callCount}C</span><span class="meta-chip puts">${putCount}P</span>` : ''}
      <span class="meta-chip total">${ideas.length} plan${ideas.length !== 1 ? 's' : ''}</span>
    </div>
  </div>
  <div class="cards-grid">
    ${ideas.map(renderIdeaCard).join('')}
    ${renderAddIdeaCard(monday)}
  </div>
</section>`;
}

// ── Daily view ────────────────────────────────────────────────────
function renderPlanDailyView(monday) {
  const allIdeas = loadIdeas();
  const plans    = loadPlans();
  const today    = todayStr();
  const el       = document.getElementById('plan-main-content');

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday + 'T12:00:00');
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });

  // Cards planned for this week that were entered on a PREVIOUS week's Sat or Sun
  const thisWeekDates = new Set(days);
  const weekPrepIdeas = allIdeas.filter(i => {
    if (i.weekOf !== monday) return false;
    const cardDate = i.createdAt || today;
    if (thisWeekDates.has(cardDate)) return false; // entered this week → show in day column
    const dow = new Date(cardDate + 'T12:00:00').getDay();
    return dow === 0 || dow === 6; // only Sat (6) or Sun (0) entries from prior weeks
  });

  const daySections = days.map(date => {
    const isToday   = date === today;
    // Each day shows only cards created on that exact date
    const dayIdeas  = allIdeas.filter(i => (i.createdAt || today) === date);
    const callCount = dayIdeas.filter(i => i.optionType === 'call').length;
    const putCount  = dayIdeas.filter(i => i.optionType === 'put').length;
    const dayLabel  = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric'
    });
    const hasPlan      = plans[date] !== undefined;
    const planContent  = hasPlan ? plans[date] : PLAN_TEMPLATE;
    const planVisible  = isToday;

    const deleteBtn = hasPlan
      ? `<button class="plan-delete-btn" id="plan-del-btn-${date}" onclick="deleteDayPlan('${date}')">&#128465; Delete</button>`
      : `<span id="plan-del-btn-${date}"></span>`;

    return `
<section class="week-section daily-day-section ${isToday ? 'current-week' : ''}">
  <div class="week-header">
    <div class="week-label">
      ${isToday ? '<span class="current-badge">Today</span>' : ''}
      <span class="week-range">${dayLabel}</span>
    </div>
    <div class="week-meta">
      ${dayIdeas.length ? `<span class="meta-chip calls">${callCount}C</span><span class="meta-chip puts">${putCount}P</span>` : ''}
      <span class="meta-chip total">${dayIdeas.length} plan${dayIdeas.length !== 1 ? 's' : ''}</span>
      <button class="toggle-plan-btn ${hasPlan ? 'has-plan' : ''}" id="toggle-plan-btn-${date}"
              onclick="toggleDayPlanSection('${date}')">
        ${hasPlan ? '&#128196; Daily Plan' : '+ Daily Plan'}
      </button>
    </div>
  </div>
  <div class="cards-grid">
    ${dayIdeas.map(renderIdeaCard).join('')}
    ${renderAddIdeaCard(monday)}
  </div>
  <div class="day-plan-section" id="day-plan-section-${date}" style="display:${planVisible ? 'block' : 'none'}">
    <div class="day-plan-bar">
      <span class="day-plan-title">Daily Plan</span>
      <div class="plan-editor-toolbar day-plan-toolbar">
        <button class="plan-fmt-btn" onmousedown="event.preventDefault();planCmd('bold')"      title="Bold"><b>B</b></button>
        <button class="plan-fmt-btn" onmousedown="event.preventDefault();planCmd('italic')"    title="Italic"><i>I</i></button>
        <button class="plan-fmt-btn" onmousedown="event.preventDefault();planCmd('underline')" title="Underline"><u>U</u></button>
      </div>
      ${deleteBtn}
    </div>
    <div id="day-plan-editor-${date}"
         class="plan-editor day-plan-editor"
         contenteditable="true"
         oninput="autoSaveDayPlan('${date}')">${planContent}</div>
  </div>
</section>`;
  }).join('');

  el.innerHTML = (weekPrepIdeas.length ? renderWeeklySummarySection(weekPrepIdeas, monday) : '') + daySections;
}

// ── Daily plan editor actions ─────────────────────────────────────
function toggleDayPlanSection(date) {
  const section = document.getElementById('day-plan-section-' + date);
  if (!section) return;
  const opening = section.style.display === 'none';
  section.style.display = opening ? 'block' : 'none';
  if (opening) {
    // Lazy-populate editor with saved content or template
    const editor = document.getElementById('day-plan-editor-' + date);
    if (editor && !editor._populated) {
      const plans = loadPlans();
      editor.innerHTML = plans[date] !== undefined ? plans[date] : PLAN_TEMPLATE;
      editor._populated = true;
    }
  }
}

function autoSaveDayPlan(date) {
  const editor = document.getElementById('day-plan-editor-' + date);
  if (!editor) return;
  savePlanForDate(date, editor.innerHTML);

  // Show delete button once content exists
  const delWrap = document.getElementById('plan-del-btn-' + date);
  if (delWrap && delWrap.tagName === 'SPAN') {
    delWrap.outerHTML = `<button class="plan-delete-btn" id="plan-del-btn-${date}" onclick="deleteDayPlan('${date}')">&#128465; Delete</button>`;
  }

  // Update toggle button label
  const toggleBtn = document.getElementById('toggle-plan-btn-' + date);
  if (toggleBtn) {
    toggleBtn.textContent = '📋 Daily Plan';
    toggleBtn.classList.add('has-plan');
  }
}

function deleteDayPlan(date) {
  if (!confirm('Delete the daily plan for this day? This cannot be undone.')) return;
  delete _plans[date];
  dbDelete('plans', date).catch(console.error);
  renderPlanView();
}

function planCmd(cmd) {
  document.execCommand(cmd, false, null);
}

// ── Init (called from app.js when switching to plan tab) ──────────
function initPlanView() {
  if (!planInitialized) {
    planInitialized = true;

    // plan-last-view is already applied to PLAN_STATE.view by _initPlansStorage()

    // Init idea modal
    initIdeaModal();

    // Nav buttons
    document.getElementById('plan-nav-prev').addEventListener('click', planNavPrev);
    document.getElementById('plan-nav-next').addEventListener('click', planNavNext);
    document.getElementById('plan-nav-today').addEventListener('click', planNavToday);

    // View toggle buttons
    document.querySelectorAll('.plan-view-btn').forEach(btn => {
      btn.addEventListener('click', () => switchPlanView(btn.dataset.view));
    });
  }

  // Initialise weekOf on first load
  if (!PLAN_STATE.weekOf) {
    PLAN_STATE.weekOf = getMondayOf(todayStr());
    // If current view is monthly, sync year/month from weekOf
    if (PLAN_STATE.view === 'monthly') {
      const d = new Date(PLAN_STATE.weekOf + 'T12:00:00');
      PLAN_STATE.year  = d.getFullYear();
      PLAN_STATE.month = d.getMonth() + 1;
    }
  }

  // Sync view button active state
  document.querySelectorAll('.plan-view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === PLAN_STATE.view);
  });

  renderPlanView();
}
