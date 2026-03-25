const PLANS_KEY = 'tj-plans-v1';

const PLAN_TEMPLATE = [
  '<h3>Pre Market Plan</h3><p><br></p>',
  '<h4>Market</h4><p><br></p>',
  '<h4>Watchlist</h4><p><br></p>',
  '<h3>Day Recap</h3><p><br></p>',
  '<h4>Mistakes I made</h4><p><br></p>',
  '<h4>What I did great</h4><p><br></p>',
  '<h4>Reinforcement to myself</h4><p><br></p>',
  '<h3>Overall Recap</h3><p><br></p>',
].join('');

let activePlanDate = '';
let planCalMonth   = null; // { year, month }
let planInitialized = false;

// ─── Storage ───

function loadPlans() {
  try { return JSON.parse(localStorage.getItem(PLANS_KEY) || '{}'); }
  catch { return {}; }
}

function savePlanForDate(date, html) {
  const plans = loadPlans();
  plans[date] = html;
  localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
}

// ─── Date helpers ───

function planIso(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function planDefaultDate() {
  const today = new Date();
  const dow   = today.getDay(); // 0=Sun,1=Mon,...,5=Fri,6=Sat
  // If today is Fri/Sat/Sun → default to the following Monday
  const daysAhead = dow === 5 ? 3 : dow === 6 ? 2 : dow === 0 ? 1 : 1;
  const d = new Date(today);
  d.setDate(today.getDate() + daysAhead);
  return planIso(d);
}

function fmtPlanDate(iso) {
  const [y, m, d] = iso.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

// ─── Mini Calendar ───

function renderPlanCalendar() {
  const plans       = loadPlans();
  const { year: yr, month: mo } = planCalMonth;
  const todayIso    = planIso(new Date());

  document.getElementById('plan-month-label').textContent =
    `${MONTH_NAMES[mo]} ${yr}`;

  const DAY_HDRS    = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const firstDow    = new Date(yr, mo, 1).getDay();
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  const prevDays    = new Date(yr, mo, 0).getDate();

  let html = DAY_HDRS.map(h => `<div class="plan-cal-hdr">${h}</div>`).join('');

  for (let i = firstDow - 1; i >= 0; i--)
    html += `<div class="plan-cal-day other-month">${prevDays - i}</div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const ds  = `${yr}-${String(mo + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(yr, mo, d).getDay();
    let cls   = 'plan-cal-day';
    if (dow === 0 || dow === 6) cls += ' weekend';
    if (ds === todayIso)        cls += ' is-today';
    if (ds === activePlanDate)  cls += ' selected';
    if (plans[ds] !== undefined) cls += ' has-plan';
    html += `<div class="${cls}" onclick="selectPlanDate('${ds}')">${d}</div>`;
  }

  const used = firstDow + daysInMonth;
  const rem  = used % 7;
  if (rem > 0)
    for (let i = 1; i <= 7 - rem; i++)
      html += `<div class="plan-cal-day other-month">${i}</div>`;

  document.getElementById('plan-cal-grid').innerHTML = html;
}

function shiftPlanMonth(dir) {
  let { year, month } = planCalMonth;
  month += dir;
  if (month < 0)  { month = 11; year--; }
  if (month > 11) { month = 0;  year++; }
  planCalMonth = { year, month };
  renderPlanCalendar();
}

function selectPlanDate(date) {
  activePlanDate = date;
  loadPlanForDate(date);
  renderPlanCalendar();
}

// ─── Editor ───

function loadPlanForDate(date) {
  activePlanDate = date;
  const plans       = loadPlans();
  const editor      = document.getElementById('plan-editor');
  const wrap        = document.getElementById('plan-editor-wrap');
  const placeholder = document.getElementById('plan-placeholder');
  const label       = document.getElementById('plan-selected-label');
  const delBtn      = document.getElementById('plan-delete-btn');

  if (!date) {
    wrap.style.display        = 'none';
    placeholder.style.display = 'flex';
    delBtn.style.display      = 'none';
    label.textContent         = '';
    return;
  }

  const exists       = plans[date] !== undefined;
  editor.innerHTML   = exists ? plans[date] : PLAN_TEMPLATE;
  wrap.style.display        = 'block';
  placeholder.style.display = 'none';
  delBtn.style.display      = exists ? 'inline-flex' : 'none';
  label.textContent         = fmtPlanDate(date);
  updatePlanToolbarState();
}

function autoSavePlan() {
  if (!activePlanDate) return;
  savePlanForDate(activePlanDate, document.getElementById('plan-editor').innerHTML);
  document.getElementById('plan-delete-btn').style.display = 'inline-flex';
  renderPlanCalendar();
}

function deletePlan() {
  if (!activePlanDate) return;
  if (!confirm(`Delete the plan for ${fmtPlanDate(activePlanDate)}? This cannot be undone.`)) return;
  const plans = loadPlans();
  delete plans[activePlanDate];
  localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
  loadPlanForDate(activePlanDate); // reload — no saved plan, shows template
  renderPlanCalendar();
}

function planCmd(cmd) {
  document.execCommand(cmd, false, null);
  document.getElementById('plan-editor').focus();
  updatePlanToolbarState();
}

function updatePlanToolbarState() {
  document.getElementById('plan-btn-bold').classList.toggle('active',      document.queryCommandState('bold'));
  document.getElementById('plan-btn-italic').classList.toggle('active',    document.queryCommandState('italic'));
  document.getElementById('plan-btn-underline').classList.toggle('active', document.queryCommandState('underline'));
}

// ─── Init ───

function initPlanView() {
  if (!planInitialized) {
    planInitialized = true;
    const editor = document.getElementById('plan-editor');
    editor.addEventListener('keyup',   updatePlanToolbarState);
    editor.addEventListener('mouseup', updatePlanToolbarState);
  }

  const def = planDefaultDate();
  if (!activePlanDate) activePlanDate = def;

  const [y, m] = activePlanDate.split('-').map(Number);
  planCalMonth = { year: y, month: m - 1 };

  renderPlanCalendar();
  loadPlanForDate(activePlanDate);
}
