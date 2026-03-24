const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

let curMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function renderCalendar() {
  const trades = load();
  const yr     = curMonth.getFullYear();
  const mo     = curMonth.getMonth();
  const today  = new Date();

  document.getElementById('month-label').textContent = `${MONTH_NAMES[mo]} ${yr}`;

  // build date → pnl/count map using sell-leg dates (FIFO realized P&L)
  const map = {};
  const monthPrefix = `${yr}-${String(mo + 1).padStart(2,'0')}`;
  let monthlyPnl = 0;
  for (const t of trades) {
    const realizations = t.legs && t.legs.length
      ? getRealizationsByDate(t)
      : { [t.date]: getPnl(t) };
    for (const [date, pnl] of Object.entries(realizations)) {
      if (!map[date]) map[date] = { pnl: 0, count: 0 };
      map[date].pnl   += pnl;
      map[date].count += 1;
      if (date.startsWith(monthPrefix)) monthlyPnl += pnl;
    }
  }

  const pnlEl  = document.getElementById('monthly-pnl');
  const pnlAbs = Math.round(Math.abs(monthlyPnl)).toLocaleString('en-US');
  pnlEl.textContent = (monthlyPnl < 0 ? '-$' : '$') + pnlAbs;
  pnlEl.className   = 'monthly-pnl ' + (monthlyPnl > 0 ? 'pos' : monthlyPnl < 0 ? 'neg' : 'neu');

  const firstDow    = new Date(yr, mo, 1).getDay();
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  const prevDays    = new Date(yr, mo, 0).getDate();

  let html = DAY_NAMES.map(d => `<div class="day-hdr">${d}</div>`).join('');

  // prev-month padding
  for (let i = firstDow - 1; i >= 0; i--) {
    html += `<div class="day-cell other-month"><div class="day-num">${prevDays - i}</div></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ds   = `${yr}-${String(mo + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const info = map[ds];
    const isToday = today.getFullYear() === yr && today.getMonth() === mo && today.getDate() === d;
    let cls = 'day-cell';
    if (isToday) cls += ' is-today';
    if (info)    cls += info.pnl >= 0 ? ' win-day' : ' loss-day';

    const numHtml = `<div class="day-num">${d}</div>`;
    const pnlHtml = info ? `
      <div class="day-pnl ${info.pnl >= 0 ? 'pos' : 'neg'}">
        ${info.pnl < 0 ? '-$' : '$'}${Math.round(Math.abs(info.pnl)).toLocaleString('en-US')}
      </div>
      <div class="day-count">${info.count} trade${info.count !== 1 ? 's' : ''}</div>` : '';

    html += `<div class="${cls}" onclick="openDay('${ds}')">${numHtml}${pnlHtml}</div>`;
  }

  // next-month padding
  const used = firstDow + daysInMonth;
  const rem  = used % 7;
  if (rem > 0) {
    for (let i = 1; i <= 7 - rem; i++) {
      html += `<div class="day-cell other-month"><div class="day-num">${i}</div></div>`;
    }
  }

  document.getElementById('cal-grid').innerHTML = html;
  renderWeeklySummary();
}

function renderWeeklySummary() {
  const trades  = load();
  const yr      = curMonth.getFullYear();
  const mo      = curMonth.getMonth();
  const firstDow    = new Date(yr, mo, 1).getDay();
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();

  const weeks = [];
  let dayOffset = 1 - firstDow; // day-of-month for the Sunday of row 1

  while (dayOffset <= daysInMonth) {
    const weekStart = new Date(yr, mo, dayOffset);
    const weekEnd   = new Date(yr, mo, dayOffset + 6);

    // ISO strings for reliable comparison
    const startIso = isoDate(weekStart);
    const endIso   = isoDate(weekEnd);

    // Aggregate realized P&L by sell date within this week
    let pnl = 0;
    const dayPnl = {};
    const tradeIds = new Set();
    for (const t of trades) {
      const realizations = t.legs && t.legs.length
        ? getRealizationsByDate(t)
        : { [t.date]: getPnl(t) };
      for (const [date, dp] of Object.entries(realizations)) {
        if (date >= startIso && date <= endIso) {
          pnl += dp;
          dayPnl[date] = (dayPnl[date] || 0) + dp;
          tradeIds.add(t.id);
        }
      }
    }
    const tradeCount = tradeIds.size;
    const winDays    = Object.values(dayPnl).filter(p => p > 0).length;
    const lossDays   = Object.values(dayPnl).filter(p => p < 0).length;

    weeks.push({ startIso, endIso, tradeCount, pnl, winDays, lossDays });
    dayOffset += 7;
  }

  document.getElementById('weekly-summary').innerHTML = weeks.map((w, i) => {
    const pnlCls  = w.pnl > 0 ? 'pos' : w.pnl < 0 ? 'neg' : 'neu';
    const pnlStr  = (w.pnl < 0 ? '-$' : '$') + Math.round(Math.abs(w.pnl)).toLocaleString('en-US');
    const fmtDate = iso => {
      const [y, m, d] = iso.split('-');
      return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    const boxCls = w.tradeCount ? (w.pnl >= 0 ? 'week-win' : 'week-loss') : '';

    return `<div class="week-box ${boxCls}" onclick="openWeek('${w.startIso}','${w.endIso}')">
      <div class="week-label">Week ${i + 1}</div>
      <div class="week-dates">${fmtDate(w.startIso)} – ${fmtDate(w.endIso)}</div>
      ${w.tradeCount ? `
        <div class="week-pnl ${pnlCls}">${pnlStr}</div>
        <div class="week-meta">${w.tradeCount} trade${w.tradeCount !== 1 ? 's' : ''} &bull; ${w.winDays}W ${w.lossDays}L</div>
      ` : `<div class="week-empty">No trades</div>`}
    </div>`;
  }).join('');
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function shiftMonth(dir) {
  curMonth = new Date(curMonth.getFullYear(), curMonth.getMonth() + dir, 1);
  renderCalendar();
  renderWeeklySummary();
}

function jumpToday() {
  curMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  renderCalendar();
  renderWeeklySummary();
}
