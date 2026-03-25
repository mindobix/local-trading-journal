// ─── GLOBAL FILTER STATE ───
let openPosFilterActive = false;

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

  if (openPosFilterActive) filtered = filtered.filter(t => getOpenQty(t) > 0);

  return filtered;
}

function toggleOpenPositions() {
  openPosFilterActive = !openPosFilterActive;
  document.getElementById('gf-open-pos-btn').classList.toggle('active', openPosFilterActive);
  refreshAllViews();
}

function onGlobalFilterChange() {
  refreshAllViews();
}

function onGlobalDateFilterChange() {
  const val = document.getElementById('gf-date').value;
  document.getElementById('gf-custom-range').style.display = val === 'custom' ? 'flex' : 'none';
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
  openPosFilterActive = false;
  document.getElementById('gf-open-pos-btn').classList.remove('active');
  refreshAllViews();
}

function refreshAllViews() {
  renderStats();
  const calVisible    = document.getElementById('view-cal')?.style.display    !== 'none';
  const tradesVisible = document.getElementById('view-trades')?.style.display !== 'none';
  const planVisible   = document.getElementById('view-plan')?.style.display   !== 'none';
  if (calVisible)    renderCalendar();
  if (tradesVisible) renderTrades();
  if (planVisible && typeof planCalMonth !== 'undefined' && planCalMonth)   renderPlanCalendar();
}
