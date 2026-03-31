// ─── REPORTS VIEW ───

var activeReportTab = 'days';

function initReportsView() {
  renderReportContent();
}

function switchReportTab(tab) {
  activeReportTab = tab;
  ['days', 'months', 'tradetime', 'duration'].forEach(function(t) {
    document.getElementById('rtab-' + t).classList.toggle('active', t === tab);
  });
  renderReportContent();
}

function renderReportContent() {
  var el = document.getElementById('reports-content');
  if (!el) return;

  try {
    var trades = applyGlobalFilter(load());

    if      (activeReportTab === 'days')      renderReportDays(trades, el);
    else if (activeReportTab === 'months')    renderReportMonths(trades, el);
    else if (activeReportTab === 'tradetime') renderReportTradeTime(trades, el);
    else if (activeReportTab === 'duration')  renderReportDuration(trades, el);
  } catch (err) {
    console.error('Reports error:', err);
    el.innerHTML = '<div class="report-empty" style="color:var(--red)">Error: ' + err.message + '</div>';
  }
}

// ─── HELPERS ───

function fmtRptAmt(v) {
  var n = parseFloat(v);
  if (isNaN(n)) return '$0.00';
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtRptPnl(v) {
  var n = parseFloat(v);
  if (isNaN(n) || n === 0) return '<span class="neu">$0.00</span>';
  var cls = n > 0 ? 'pos' : 'neg';
  return '<span class="' + cls + '">' + (n > 0 ? '+' : '-') + fmtRptAmt(n) + '</span>';
}

function buildRptGroupStats(trades) {
  var pnl = 0, wins = 0, losses = 0, grossWin = 0, grossLoss = 0;
  for (var i = 0; i < trades.length; i++) {
    var p = 0;
    try { p = getPnl(trades[i]) || 0; } catch (e) { p = 0; }
    if (!isFinite(p)) p = 0;
    pnl += p;
    if (p > 0) { wins++;   grossWin  += p; }
    if (p < 0) { losses++; grossLoss += Math.abs(p); }
  }
  pnl = Math.round(pnl * 100) / 100;
  var total   = trades.length;
  var winRate = total ? parseFloat((wins / total * 100).toFixed(1)) : 0;
  var avgWin  = wins   ? Math.round(grossWin  / wins   * 100) / 100 : null;
  var avgLoss = losses ? Math.round(grossLoss / losses * 100) / 100 : null;
  var avgPnl  = total  ? Math.round(pnl / total * 100) / 100 : 0;
  return { total: total, wins: wins, losses: losses, pnl: pnl,
           winRate: winRate, avgWin: avgWin, avgLoss: avgLoss, avgPnl: avgPnl };
}

function renderRptCards(cards) {
  var html = '<div class="report-cards">';
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    html += '<div class="report-card">';
    html += '<div class="report-card-label"><span class="report-card-icon">' + c.icon + '</span>' + c.label + '</div>';
    html += '<div class="report-card-title">' + (c.title || '\u2014') + '</div>';
    html += '<div class="report-card-meta">'  + (c.meta  || '')       + '</div>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderRptTable(firstHeader, labels, statsArr) {
  var headers = [firstHeader, 'Win %', 'Net P&amp;L', '# Trades', 'Avg P&amp;L', 'Avg Win', 'Avg Loss'];
  var html = '<div class="report-table-section">';
  html += '<div class="report-table-title">Summary</div>';
  html += '<div class="report-table-wrap"><table class="report-table"><thead><tr>';
  for (var h = 0; h < headers.length; h++) html += '<th>' + headers[h] + '</th>';
  html += '</tr></thead><tbody>';
  for (var i = 0; i < labels.length; i++) {
    var s = statsArr[i];
    html += '<tr>';
    html += '<td>' + labels[i] + '</td>';
    html += '<td>' + (s.total ? s.winRate + '%' : '<span class="neu">0%</span>') + '</td>';
    html += '<td>' + fmtRptPnl(s.pnl) + '</td>';
    html += '<td>' + s.total + '</td>';
    html += '<td>' + (s.total ? fmtRptPnl(s.avgPnl) : '\u2014') + '</td>';
    html += '<td>' + (s.avgWin  !== null ? '<span class="pos">+' + fmtRptAmt(s.avgWin)  + '</span>' : '\u2014') + '</td>';
    html += '<td>' + (s.avgLoss !== null ? '<span class="neg">-' + fmtRptAmt(s.avgLoss) + '</span>' : '\u2014') + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table></div></div>';
  return html;
}

function pickRptHighlights(statsArr, labelKey, labelArr) {
  var active = [];
  for (var i = 0; i < statsArr.length; i++) {
    if (statsArr[i].total > 0) active.push(i);
  }
  var bestI = null, worstI = null, mostI = null, wrI = null;
  for (var a = 0; a < active.length; a++) {
    var i = active[a];
    if (bestI  === null || statsArr[i].pnl     > statsArr[bestI].pnl)    bestI  = i;
    if (worstI === null || statsArr[i].pnl     < statsArr[worstI].pnl)   worstI = i;
    if (mostI  === null || statsArr[i].total   > statsArr[mostI].total)  mostI  = i;
    if (wrI    === null || statsArr[i].winRate > statsArr[wrI].winRate)  wrI    = i;
  }
  function meta(i) {
    if (i === null) return '';
    var s = statsArr[i];
    var sign = s.pnl >= 0 ? '+' : '-';
    var cls  = s.pnl > 0 ? 'pos' : s.pnl < 0 ? 'neg' : 'neu';
    return s.total + ' trades &nbsp;<span class="' + cls + '">' + sign + fmtRptAmt(s.pnl) + '</span>';
  }
  return [
    { icon: '\u2197', label: 'Best performing ' + labelKey,
      title: bestI  !== null ? labelArr[bestI]  : '\u2014', meta: meta(bestI) },
    { icon: '\u2198', label: 'Least performing ' + labelKey,
      title: worstI !== null ? labelArr[worstI] : '\u2014', meta: meta(worstI) },
    { icon: '\u25CE', label: 'Most active ' + labelKey,
      title: mostI  !== null ? labelArr[mostI]  : '\u2014',
      meta:  mostI  !== null ? statsArr[mostI].total + ' trades' : '' },
    { icon: '\u2605', label: 'Best win rate',
      title: wrI !== null ? labelArr[wrI] : '\u2014',
      meta:  wrI !== null ? statsArr[wrI].winRate + '% / ' + statsArr[wrI].total + ' trades' : '' },
  ];
}

// ─── DAYS ───

var RPT_DAY_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var RPT_DAY_ORDER = [1,2,3,4,5,0,6]; // Mon-Fri, then Sun, Sat

function renderReportDays(trades, el) {
  var byDay = { 0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] };
  for (var i = 0; i < trades.length; i++) {
    var ds  = trades[i].date || '';
    if (!ds) continue;
    var dow = new Date(ds + 'T12:00:00').getDay();
    if (isNaN(dow) || dow < 0 || dow > 6) continue;
    byDay[dow].push(trades[i]);
  }
  var statsArr = RPT_DAY_ORDER.map(function(d) { return buildRptGroupStats(byDay[d]); });
  var labelArr = RPT_DAY_ORDER.map(function(d) { return RPT_DAY_FULL[d]; });
  var cards    = pickRptHighlights(statsArr, 'day', labelArr);
  el.innerHTML = renderRptCards(cards) + renderRptTable('Day', labelArr, statsArr);
}

// ─── MONTHS ───

var RPT_MONTH_FULL = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

function renderReportMonths(trades, el) {
  var byMonth = { 0:[],1:[],2:[],3:[],4:[],5:[],6:[],7:[],8:[],9:[],10:[],11:[] };
  for (var i = 0; i < trades.length; i++) {
    var ds = trades[i].date || '';
    if (!ds || ds.length < 7) continue;
    var m = parseInt(ds.split('-')[1], 10) - 1;
    if (isNaN(m) || m < 0 || m > 11) continue;
    byMonth[m].push(trades[i]);
  }
  var statsArr = RPT_MONTH_FULL.map(function(_, i) { return buildRptGroupStats(byMonth[i]); });
  var cards    = pickRptHighlights(statsArr, 'month', RPT_MONTH_FULL);
  el.innerHTML = renderRptCards(cards) + renderRptTable('Month', RPT_MONTH_FULL, statsArr);
}

// ─── TRADE TIME ───

var RPT_TIME_BUCKETS = [
  { label: 'Pre-market',     minM:   0, maxM:  570 },
  { label: '9:30 - 10:00',  minM: 570, maxM:  600 },
  { label: '10:00 - 11:00', minM: 600, maxM:  660 },
  { label: '11:00 - 12:00', minM: 660, maxM:  720 },
  { label: '12:00 - 14:00', minM: 720, maxM:  840 },
  { label: '14:00 - 16:00', minM: 840, maxM:  960 },
  { label: 'After hours',   minM: 960, maxM: 1440 },
];

function rptGetEntryMins(t) {
  if (!t.legs || !t.legs.length) return null;
  var first = null;
  for (var i = 0; i < t.legs.length; i++) {
    if (t.legs[i].date && t.legs[i].date.indexOf('T') !== -1) { first = t.legs[i]; break; }
  }
  if (!first) return null;
  var tp = first.date.split('T')[1].split(':');
  var h  = parseInt(tp[0], 10), m = parseInt(tp[1], 10);
  return (isNaN(h) || isNaN(m)) ? null : h * 60 + m;
}

function renderReportTradeTime(trades, el) {
  var byBucket = RPT_TIME_BUCKETS.map(function() { return []; });
  for (var i = 0; i < trades.length; i++) {
    var mins = rptGetEntryMins(trades[i]);
    if (mins === null) continue;
    for (var b = 0; b < RPT_TIME_BUCKETS.length; b++) {
      if (mins >= RPT_TIME_BUCKETS[b].minM && mins < RPT_TIME_BUCKETS[b].maxM) {
        byBucket[b].push(trades[i]); break;
      }
    }
  }
  var statsArr = byBucket.map(function(g) { return buildRptGroupStats(g); });
  var labels   = RPT_TIME_BUCKETS.map(function(b) { return b.label; });
  var cards    = pickRptHighlights(statsArr, 'time', labels);
  el.innerHTML = renderRptCards(cards) + renderRptTable('Entry Time', labels, statsArr);
}

// ─── TRADE DURATION ───

var RPT_DUR_BUCKETS = [
  { label: '< 1 min',      minM:   0, maxM:    1 },
  { label: '1 - 5 min',   minM:   1, maxM:    5 },
  { label: '5 - 15 min',  minM:   5, maxM:   15 },
  { label: '15 - 60 min', minM:  15, maxM:   60 },
  { label: '1 - 4 hrs',   minM:  60, maxM:  240 },
  { label: '4+ hrs',      minM: 240, maxM: 1e9  },
];

function rptGetDurationMins(t) {
  if (!t.legs || !t.legs.length) return null;
  var buyTs = [], sellTs = [];
  for (var i = 0; i < t.legs.length; i++) {
    var leg = t.legs[i];
    if (!leg.date) continue;
    var ts = new Date(leg.date).getTime();
    if (isNaN(ts)) continue;
    if (leg.action === 'buy')  buyTs.push(ts);
    if (leg.action === 'sell') sellTs.push(ts);
  }
  if (!buyTs.length || !sellTs.length) return null;
  var diff = Math.max.apply(null, sellTs) - Math.min.apply(null, buyTs);
  return diff > 0 ? diff / 60000 : 0;
}

function renderReportDuration(trades, el) {
  var byBucket = RPT_DUR_BUCKETS.map(function() { return []; });
  for (var i = 0; i < trades.length; i++) {
    var mins = rptGetDurationMins(trades[i]);
    if (mins === null) continue;
    for (var b = 0; b < RPT_DUR_BUCKETS.length; b++) {
      if (mins >= RPT_DUR_BUCKETS[b].minM && mins < RPT_DUR_BUCKETS[b].maxM) {
        byBucket[b].push(trades[i]); break;
      }
    }
  }
  var statsArr = byBucket.map(function(g) { return buildRptGroupStats(g); });
  var labels   = RPT_DUR_BUCKETS.map(function(b) { return b.label; });
  var cards    = pickRptHighlights(statsArr, 'duration', labels);
  el.innerHTML = renderRptCards(cards) + renderRptTable('Duration', labels, statsArr);
}
