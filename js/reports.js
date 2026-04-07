// ─── REPORTS VIEW ───

var activeReportType    = 'daytime';
var activeReportTab     = 'days';
var activeTickerTab     = 'symbols';
var activeTagsTab       = 'mistakes';
var activePerfTab       = 'summary';
var activeRiskSymView   = 'top10';
var activeRiskCrossView = 'pnl';

function initReportsView() {
  renderReportContent();
}

function switchReportType(type) {
  activeReportType = type;
  ['daytime', 'risk', 'ticker', 'tags', 'dte', 'perf'].forEach(function(t) {
    document.getElementById('rtype-' + t).classList.toggle('active', t === type);
  });
  var dtRow     = document.getElementById('reports-subtabs-row');
  var tickerRow = document.getElementById('reports-ticker-subtabs-row');
  var tagsRow   = document.getElementById('reports-tags-subtabs-row');
  var perfRow   = document.getElementById('reports-perf-subtabs-row');
  if (dtRow)     dtRow.style.display     = type === 'daytime' ? '' : 'none';
  if (tickerRow) tickerRow.style.display = type === 'ticker'  ? '' : 'none';
  if (tagsRow)   tagsRow.style.display   = type === 'tags'    ? '' : 'none';
  if (perfRow)   perfRow.style.display   = type === 'perf'    ? '' : 'none';
  renderReportContent();
}

function switchPerfTab(tab) {
  activePerfTab = tab;
  ['summary', 'days', 'trades'].forEach(function(t) {
    document.getElementById('ptab-' + t).classList.toggle('active', t === tab);
  });
  renderReportContent();
}

function switchTagsTab(tab) {
  activeTagsTab = tab;
  ['customtags', 'mistakes', 'tradingrules'].forEach(function(t) {
    document.getElementById('tabtab-' + t).classList.toggle('active', t === tab);
  });
  renderReportContent();
}

function switchTickerTab(tab) {
  activeTickerTab = tab;
  ['symbols', 'tradetype', 'prices'].forEach(function(t) {
    document.getElementById('rstab-' + t).classList.toggle('active', t === tab);
  });
  renderReportContent();
}

function switchReportTab(tab) {
  activeReportTab = tab;
  ['days', 'months', 'tradetime', 'duration'].forEach(function(t) {
    document.getElementById('rtab-' + t).classList.toggle('active', t === tab);
  });
  renderReportContent();
}

function switchRiskSymView(view) {
  activeRiskSymView = view;
  renderReportContent();
}

function toggleRiskSymDropdown(e) {
  e.stopPropagation();
  var menu = document.getElementById('rpt-sym-dd-menu');
  if (menu) menu.classList.toggle('open');
}

document.addEventListener('click', function() {
  var menu = document.getElementById('rpt-sym-dd-menu');
  if (menu) menu.classList.remove('open');
});

function switchRiskCrossView(view) {
  activeRiskCrossView = view;
  renderReportContent();
}

function renderReportContent() {
  var el = document.getElementById('reports-content');
  if (!el) return;

  try {
    var trades = applyGlobalFilter(load());

    if (activeReportType === 'risk') {
      renderReportRisk(trades, el);
    } else if (activeReportType === 'ticker') {
      if      (activeTickerTab === 'symbols')   renderReportTickerSymbols(trades, el);
      else if (activeTickerTab === 'tradetype') renderReportTickerTradeTypes(trades, el);
      else if (activeTickerTab === 'prices')    renderReportTickerPrices(trades, el);
    } else if (activeReportType === 'dte') {
      renderReportOptionsDTE(trades, el);
    } else if (activeReportType === 'tags') {
      if      (activeTagsTab === 'customtags')    renderReportTagGroup(trades, loadTags(),     'tags',     'tag',           el);
      else if (activeTagsTab === 'mistakes')      renderReportTagGroup(trades, loadMistakes(), 'mistakes', 'mistake',       el);
      else if (activeTagsTab === 'tradingrules')  renderReportTagGroup(trades, loadRules(),    'rules',    'trading rule',  el);
    } else if (activeReportType === 'perf') {
      if      (activePerfTab === 'summary') renderReportPerfSummary(trades, el);
      else if (activePerfTab === 'days')    renderReportPerfDays(trades, el);
      else if (activePerfTab === 'trades')  renderReportPerfTrades(trades, el);
    } else {
      if      (activeReportTab === 'days')      renderReportDays(trades, el);
      else if (activeReportTab === 'months')    renderReportMonths(trades, el);
      else if (activeReportTab === 'tradetime') renderReportTradeTime(trades, el);
      else if (activeReportTab === 'duration')  renderReportDuration(trades, el);
    }
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
  var statsArr  = RPT_DAY_ORDER.map(function(d) { return buildRptGroupStats(byDay[d]); });
  var labelArr  = RPT_DAY_ORDER.map(function(d) { return RPT_DAY_FULL[d]; });
  var cards     = pickRptHighlights(statsArr, 'day', labelArr);
  var rowGroups = RPT_DAY_ORDER.map(function(d) { return { label: RPT_DAY_FULL[d], trades: byDay[d] }; });
  el.innerHTML  = renderRptCards(cards) + renderRptTable('Day', labelArr, statsArr) + renderCrossAnalysis(rowGroups, trades);
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
  var statsArr  = RPT_MONTH_FULL.map(function(_, i) { return buildRptGroupStats(byMonth[i]); });
  var cards     = pickRptHighlights(statsArr, 'month', RPT_MONTH_FULL);
  var rowGroups = RPT_MONTH_FULL.map(function(name, i) { return { label: name, trades: byMonth[i] }; });
  el.innerHTML  = renderRptCards(cards) + renderRptTable('Month', RPT_MONTH_FULL, statsArr) + renderCrossAnalysis(rowGroups, trades);
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
  var statsArr  = byBucket.map(function(g) { return buildRptGroupStats(g); });
  var labels    = RPT_TIME_BUCKETS.map(function(b) { return b.label; });
  var cards     = pickRptHighlights(statsArr, 'time', labels);
  var rowGroups = RPT_TIME_BUCKETS.map(function(b, i) { return { label: b.label, trades: byBucket[i] }; });
  el.innerHTML  = renderRptCards(cards) + renderRptTable('Entry Time', labels, statsArr) + renderCrossAnalysis(rowGroups, trades);
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
  var statsArr  = byBucket.map(function(g) { return buildRptGroupStats(g); });
  var labels    = RPT_DUR_BUCKETS.map(function(b) { return b.label; });
  var cards     = pickRptHighlights(statsArr, 'duration', labels);
  var rowGroups = RPT_DUR_BUCKETS.map(function(b, i) { return { label: b.label, trades: byBucket[i] }; });
  el.innerHTML  = renderRptCards(cards) + renderRptTable('Duration', labels, statsArr) + renderCrossAnalysis(rowGroups, trades);
}

// ─── RISK (R-MULTIPLES) REPORT ───

var RPT_R_BUCKETS = [
  { label: 'None',              test: function(r) { return r === null; } },
  { label: '-4R or worse',      test: function(r) { return r !== null && r <= -4; } },
  { label: '-3R to -3.99R',     test: function(r) { return r !== null && r > -4  && r <= -3; } },
  { label: '-2R to -2.99R',     test: function(r) { return r !== null && r > -3  && r <= -2; } },
  { label: '-1R to -1.99R',     test: function(r) { return r !== null && r > -2  && r <= -1; } },
  { label: '-0.99R to -0.01R',  test: function(r) { return r !== null && r > -1  && r < 0;  } },
  { label: '0R to 0.99R',       test: function(r) { return r !== null && r >= 0  && r < 1;  } },
  { label: '+1R to +1.99R',     test: function(r) { return r !== null && r >= 1  && r < 2;  } },
  { label: '+2R to +2.99R',     test: function(r) { return r !== null && r >= 2  && r < 3;  } },
  { label: '+3R to +3.99R',     test: function(r) { return r !== null && r >= 3  && r < 4;  } },
  { label: '+4R and more',      test: function(r) { return r !== null && r >= 4;             } },
];

function rptGetRealizedR(t) {
  if (!t.legs || !t.legs.length) return null;
  if (!t.stopLoss || !t.stopLoss.length) return null;
  var mult = t.type === 'option' ? 100 : 1;
  var buyLegs = t.legs.filter(function(l) { return l.action === 'buy'; });
  if (!buyLegs.length) return null;
  var totalBuyQty = buyLegs.reduce(function(s, l) { return s + (parseFloat(l.quantity) || 0); }, 0);
  if (!totalBuyQty) return null;
  var avgEntry = buyLegs.reduce(function(s, l) {
    return s + (parseFloat(l.price) || 0) * (parseFloat(l.quantity) || 0);
  }, 0) / totalBuyQty;
  var validSls = t.stopLoss.filter(function(sl) {
    return sl.price !== '' && !isNaN(parseFloat(sl.price)) && parseFloat(sl.qty) > 0;
  });
  if (!validSls.length) return null;
  var tradeRisk = validSls.reduce(function(s, sl) {
    return s + ((parseFloat(sl.price) || 0) - avgEntry) * (parseFloat(sl.qty) || 0) * mult;
  }, 0);
  if (!tradeRisk) return null;
  var realizedPnl = getPnl(t);
  return realizedPnl / Math.abs(tradeRisk);
}

function renderRptRiskSummaryTable(labels, statsArr) {
  var headers = ['R-multiples', 'Win %', 'Net P&amp;L', 'Trade count', 'Avg win', 'Avg loss'];
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
    html += '<td>' + (s.avgWin  !== null ? '<span class="pos">+' + fmtRptAmt(s.avgWin)  + '</span>' : '\u2014') + '</td>';
    html += '<td>' + (s.avgLoss !== null ? '<span class="neg">-' + fmtRptAmt(s.avgLoss) + '</span>' : '\u2014') + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table></div></div>';
  return html;
}

var RPT_CROSS_DD_LABELS = {
  top10:      'Top 10 Stocks',
  bottom10:   'Bottom 10 Stocks',
  tradetype:  'Trade Type',
  tags:       'Tags',
  mistakes:  'Mistakes',
  rules:     'Trading Rules',
  dow:       'Day of Week',
  duration:  'Trade Duration',
  week:      'Week',
  year:      'Year',
  possize:   'Position Size',
  volume:    'Volume'
};

var RPT_POSSIZE_BUCKETS = [
  { label: '< $1K',          min:      0, max:    1000 },
  { label: '$1K – $5K',      min:   1000, max:    5000 },
  { label: '$5K – $10K',     min:   5000, max:   10000 },
  { label: '$10K – $25K',    min:  10000, max:   25000 },
  { label: '$25K – $50K',    min:  25000, max:   50000 },
  { label: '$50K – $100K',   min:  50000, max:  100000 },
  { label: '$100K+',         min: 100000, max: Infinity },
];

var RPT_VOLUME_BUCKETS = [
  { label: '< 10',           min:    0, max:    10 },
  { label: '10 – 49',        min:   10, max:    50 },
  { label: '50 – 99',        min:   50, max:   100 },
  { label: '100 – 499',      min:  100, max:   500 },
  { label: '500 – 999',      min:  500, max:  1000 },
  { label: '1,000 – 4,999',  min: 1000, max:  5000 },
  { label: '5,000+',         min: 5000, max: Infinity },
];

function rptGetPositionSize(t) {
  if (!t.legs || !t.legs.length) return null;
  var mult    = t.type === 'option' ? 100 : 1;
  var buyLegs = t.legs.filter(function(l) { return l.action === 'buy'; });
  if (!buyLegs.length) return null;
  var totalQty = buyLegs.reduce(function(s, l) { return s + (parseFloat(l.quantity) || 0); }, 0);
  if (!totalQty) return null;
  var avgEntry = buyLegs.reduce(function(s, l) {
    return s + (parseFloat(l.price) || 0) * (parseFloat(l.quantity) || 0);
  }, 0) / totalQty;
  return avgEntry * totalQty * mult;
}

function rptGetVolume(t) {
  if (!t.legs || !t.legs.length) {
    var qty = parseFloat(t.quantity);
    return isNaN(qty) ? null : qty;
  }
  var total = t.legs.filter(function(l) { return l.action === 'buy'; })
    .reduce(function(s, l) { return s + (parseFloat(l.quantity) || 0); }, 0);
  return total || null;
}

function rptMatchBucket(value, buckets) {
  if (value === null) return null;
  for (var i = 0; i < buckets.length; i++) {
    if (value >= buckets[i].min && value < buckets[i].max) return buckets[i].label;
  }
  return null;
}

var RPT_DOW_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

function rptTradeDateKey(t) {
  return (t.date || '').split('T')[0];
}

function rptISOWeekKey(dateStr) {
  if (!dateStr) return null;
  var d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d)) return null;
  // shift to Thursday of the week to get correct ISO year
  var day = d.getDay() || 7; // 1=Mon … 7=Sun
  d.setDate(d.getDate() + 4 - day);
  var yearStart = new Date(d.getFullYear(), 0, 1);
  var wk = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return d.getFullYear() + '-W' + (wk < 10 ? '0' + wk : wk);
}

function rptWeekLabel(isoKey) {
  // isoKey = "2024-W03" → find the Monday of that week
  var parts = isoKey.split('-W');
  var year  = parseInt(parts[0], 10);
  var wk    = parseInt(parts[1], 10);
  // Jan 4 is always in week 1; back up to Monday of week 1 then add weeks
  var jan4  = new Date(year, 0, 4);
  var mon1  = new Date(jan4);
  mon1.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1));
  var mon   = new Date(mon1);
  mon.setDate(mon1.getDate() + (wk - 1) * 7);
  return mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function rptGetCrossColumns() {
  var allTrades = window._rptCrossAllTrades || [];

  if (activeRiskSymView === 'tradetype') {
    var typesSeen = {};
    for (var ti = 0; ti < allTrades.length; ti++) {
      var tp = allTrades[ti].type || 'stock';
      typesSeen[tp] = true;
    }
    return Object.keys(typesSeen).sort().map(function(k) {
      return { key: k, label: k.charAt(0).toUpperCase() + k.slice(1) };
    });
  }
  if (activeRiskSymView === 'tags')     return loadTags().map(function(x)     { return { key: x.id, label: x.text }; });
  if (activeRiskSymView === 'mistakes') return loadMistakes().map(function(x) { return { key: x.id, label: x.text }; });
  if (activeRiskSymView === 'rules')    return loadRules().map(function(x)    { return { key: x.id, label: x.text }; });
  if (activeRiskSymView === 'dow')      return RPT_DOW_ORDER.map(function(d)  { return { key: d, label: d }; });
  if (activeRiskSymView === 'duration') return RPT_DUR_BUCKETS.map(function(b)    { return { key: b.label, label: b.label }; });
  if (activeRiskSymView === 'possize')  return RPT_POSSIZE_BUCKETS.map(function(b){ return { key: b.label, label: b.label }; });
  if (activeRiskSymView === 'volume')   return RPT_VOLUME_BUCKETS.map(function(b) { return { key: b.label, label: b.label }; });

  if (activeRiskSymView === 'week') {
    var weekSeen = {};
    for (var i = 0; i < allTrades.length; i++) {
      var wk = rptISOWeekKey(rptTradeDateKey(allTrades[i]));
      if (wk) weekSeen[wk] = true;
    }
    return Object.keys(weekSeen).sort().map(function(k) { return { key: k, label: rptWeekLabel(k) }; });
  }

  if (activeRiskSymView === 'year') {
    var yearSeen = {};
    for (var j = 0; j < allTrades.length; j++) {
      var ds = rptTradeDateKey(allTrades[j]);
      if (ds && ds.length >= 4) yearSeen[ds.slice(0, 4)] = true;
    }
    return Object.keys(yearSeen).sort().map(function(k) { return { key: k, label: k }; });
  }

  // symbol-based (top10 / bottom10)
  var symCounts = {};
  for (var s = 0; s < allTrades.length; s++) {
    var sym = ((allTrades[s].symbol) || '').toUpperCase().trim();
    if (sym) symCounts[sym] = (symCounts[sym] || 0) + 1;
  }
  var allSyms = Object.keys(symCounts).sort(function(a, b) { return symCounts[b] - symCounts[a]; });
  var cols = activeRiskSymView === 'bottom10' ? allSyms.slice(-10) : allSyms.slice(0, 10);
  return cols.map(function(s2) { return { key: s2, label: s2 }; });
}

function rptGetTradeColKey(t) {
  switch (activeRiskSymView) {
    case 'tradetype': return [t.type || 'stock'];
    case 'tags':      return t.tags     || [];
    case 'mistakes': return t.mistakes || [];
    case 'rules':    return t.rules    || [];
    case 'dow': {
      var ds = rptTradeDateKey(t);
      if (!ds) return [];
      var d = new Date(ds + 'T12:00:00');
      return isNaN(d) ? [] : [RPT_DOW_ORDER[(d.getDay() + 6) % 7]]; // 0=Mon
    }
    case 'duration': {
      var mins = rptGetDurationMins(t);
      if (mins === null) return [];
      for (var b = 0; b < RPT_DUR_BUCKETS.length; b++) {
        if (mins >= RPT_DUR_BUCKETS[b].minM && mins < RPT_DUR_BUCKETS[b].maxM)
          return [RPT_DUR_BUCKETS[b].label];
      }
      return [];
    }
    case 'week': {
      var wk = rptISOWeekKey(rptTradeDateKey(t));
      return wk ? [wk] : [];
    }
    case 'year': {
      var yr = rptTradeDateKey(t).slice(0, 4);
      return yr ? [yr] : [];
    }
    case 'possize': {
      var lbl = rptMatchBucket(rptGetPositionSize(t), RPT_POSSIZE_BUCKETS);
      return lbl ? [lbl] : [];
    }
    case 'volume': {
      var vlbl = rptMatchBucket(rptGetVolume(t), RPT_VOLUME_BUCKETS);
      return vlbl ? [vlbl] : [];
    }
    default: { // top10 / bottom10
      var sym = ((t.symbol) || '').toUpperCase().trim();
      return sym ? [sym] : [];
    }
  }
}

function rptBuildColData(trades) {
  var data = {};
  for (var i = 0; i < trades.length; i++) {
    var t    = trades[i];
    var p    = getPnl(t) || 0;
    var keys = rptGetTradeColKey(t);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (!data[key]) data[key] = { count: 0, pnl: 0, wins: 0 };
      data[key].count++;
      data[key].pnl += p;
      if (p > 0) data[key].wins++;
    }
  }
  return data;
}

function renderCrossAnalysis(rowGroups, allTrades) {
  window._rptCrossAllTrades = allTrades;
  var columns = rptGetCrossColumns();
  if (!columns.length) return '';

  var ddLabel = RPT_CROSS_DD_LABELS[activeRiskSymView] || 'Top 10 Stocks';
  var html = '<div class="report-cross-section">';
  html += '<div class="report-cross-header">';
  html += '<div class="report-table-title" style="margin-bottom:0">Cross analysis</div>';
  html += '<div class="report-cross-controls">';

  html += '<div class="rpt-cross-sym-dropdown" id="rpt-sym-dd-wrap">';
  html += '<button class="rpt-cross-sym-dd-btn" onclick="toggleRiskSymDropdown(event)">';
  html += ddLabel + ' <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-left:4px"><polyline points="6 9 12 15 18 9"/></svg>';
  html += '</button>';
  html += '<div class="rpt-sym-dd-menu" id="rpt-sym-dd-menu">';
  ['top10','bottom10','tradetype'].forEach(function(v) {
    html += '<button class="rpt-sym-dd-item' + (activeRiskSymView === v ? ' active' : '') + '" onclick="switchRiskSymView(\'' + v + '\')">' + RPT_CROSS_DD_LABELS[v] + '</button>';
  });
  html += '<div class="rpt-sym-dd-divider"></div>';
  ['tags','mistakes','rules'].forEach(function(v) {
    html += '<button class="rpt-sym-dd-item' + (activeRiskSymView === v ? ' active' : '') + '" onclick="switchRiskSymView(\'' + v + '\')">' + RPT_CROSS_DD_LABELS[v] + '</button>';
  });
  html += '<div class="rpt-sym-dd-divider"></div>';
  ['dow','duration','week','year'].forEach(function(v) {
    html += '<button class="rpt-sym-dd-item' + (activeRiskSymView === v ? ' active' : '') + '" onclick="switchRiskSymView(\'' + v + '\')">' + RPT_CROSS_DD_LABELS[v] + '</button>';
  });
  html += '<div class="rpt-sym-dd-divider"></div>';
  ['possize','volume'].forEach(function(v) {
    html += '<button class="rpt-sym-dd-item' + (activeRiskSymView === v ? ' active' : '') + '" onclick="switchRiskSymView(\'' + v + '\')">' + RPT_CROSS_DD_LABELS[v] + '</button>';
  });
  html += '</div>';
  html += '</div>';

  html += '<div class="rpt-cross-view-group">';
  html += '<button class="rpt-cross-view-btn' + (activeRiskCrossView === 'winrate' ? ' active' : '') + '" onclick="switchRiskCrossView(\'winrate\')">Win rate</button>';
  html += '<button class="rpt-cross-view-btn' + (activeRiskCrossView === 'pnl'     ? ' active' : '') + '" onclick="switchRiskCrossView(\'pnl\')">P&amp;L</button>';
  html += '<button class="rpt-cross-view-btn' + (activeRiskCrossView === 'trades'  ? ' active' : '') + '" onclick="switchRiskCrossView(\'trades\')">Trades</button>';
  html += '</div>';
  html += '</div>';
  html += '</div>';

  html += '<div class="report-table-wrap"><table class="report-table report-cross-table"><thead><tr><th></th>';
  for (var c = 0; c < columns.length; c++) html += '<th>' + columns[c].label + '</th>';
  html += '</tr></thead><tbody>';

  for (var b = 0; b < rowGroups.length; b++) {
    var row     = rowGroups[b];
    var colData = rptBuildColData(row.trades);

    html += '<tr><td>' + row.label + '</td>';
    for (var s = 0; s < columns.length; s++) {
      var d    = colData[columns[s].key];
      var cell = '';
      if (!d || d.count === 0) {
        cell = '<span class="rpt-cross-zero">0</span>';
      } else if (activeRiskCrossView === 'trades') {
        cell = '<span class="rpt-cross-cnt">' + d.count + '</span>';
      } else if (activeRiskCrossView === 'winrate') {
        var wr = Math.round(d.wins / d.count * 100);
        cell = '<span class="' + (wr >= 50 ? 'pos' : 'neg') + '">' + wr + '%</span>';
      } else {
        var pnlRnd = Math.round(d.pnl);
        var cls = pnlRnd > 0 ? 'pos' : pnlRnd < 0 ? 'neg' : 'neu';
        cell = '<span class="' + cls + '">' + (pnlRnd >= 0 ? '+' : '') + '$' + pnlRnd.toLocaleString('en-US') + '</span>';
      }
      html += '<td>' + cell + '</td>';
    }
    html += '</tr>';
  }

  html += '</tbody></table></div></div>';
  return html;
}

function renderReportRisk(trades, el) {
  var tradeRs  = trades.map(function(t) { return { trade: t, r: rptGetRealizedR(t) }; });
  var byBucket = RPT_R_BUCKETS.map(function(b) {
    return tradeRs.filter(function(tr) { return b.test(tr.r); }).map(function(tr) { return tr.trade; });
  });
  var statsArr  = byBucket.map(function(g) { return buildRptGroupStats(g); });
  var labels    = RPT_R_BUCKETS.map(function(b) { return b.label; });
  var cards     = pickRptHighlights(statsArr, 'r-multiple', labels);
  var rowGroups = RPT_R_BUCKETS.map(function(b, i) { return { label: b.label, trades: byBucket[i] }; });

  el.innerHTML = renderRptCards(cards)
               + renderRptRiskSummaryTable(labels, statsArr)
               + renderCrossAnalysis(rowGroups, trades);
}

// ─── TICKER SYMBOLS REPORT ───

var RPT_PRICE_BUCKETS = [
  { label: '< $2',           min:   0,   max:   2   },
  { label: '$2 - $4.99',     min:   2,   max:   5   },
  { label: '$5 - $9.99',     min:   5,   max:  10   },
  { label: '$10 - $19.99',   min:  10,   max:  20   },
  { label: '$20 - $49.99',   min:  20,   max:  50   },
  { label: '$50 - $99.99',   min:  50,   max: 100   },
  { label: '$100 - $199.99', min: 100,   max: 200   },
  { label: '$200 - $499.99', min: 200,   max: 500   },
  { label: '$500+',          min: 500,   max: Infinity },
];

function rptGetAvgEntryPrice(t) {
  if (t.legs && t.legs.length) {
    var buyLegs = t.legs.filter(function(l) { return l.action === 'buy'; });
    if (!buyLegs.length) return parseFloat(t.entryPrice) || null;
    var totalQty = buyLegs.reduce(function(s, l) { return s + (parseFloat(l.quantity) || 0); }, 0);
    if (!totalQty) return null;
    return buyLegs.reduce(function(s, l) {
      return s + (parseFloat(l.price) || 0) * (parseFloat(l.quantity) || 0);
    }, 0) / totalQty;
  }
  return parseFloat(t.entryPrice) || null;
}

function renderTickerSummaryTable(firstHeader, labels, statsArr) {
  var headers = [firstHeader, 'Win %', 'Net P&amp;L', 'Trade count', 'Avg win', 'Avg loss'];
  var html = '<div class="report-table-section"><div class="report-table-title">Summary</div>';
  html += '<div class="report-table-wrap"><table class="report-table"><thead><tr>';
  headers.forEach(function(h) { html += '<th>' + h + '</th>'; });
  html += '</tr></thead><tbody>';
  for (var i = 0; i < labels.length; i++) {
    var s = statsArr[i];
    html += '<tr>';
    html += '<td>' + labels[i] + '</td>';
    html += '<td>' + (s.total ? s.winRate + '%' : '<span class="neu">0%</span>') + '</td>';
    html += '<td>' + fmtRptPnl(s.pnl) + '</td>';
    html += '<td>' + s.total + '</td>';
    html += '<td>' + (s.avgWin  !== null ? '<span class="pos">+' + fmtRptAmt(s.avgWin)  + '</span>' : '\u2014') + '</td>';
    html += '<td>' + (s.avgLoss !== null ? '<span class="neg">-' + fmtRptAmt(s.avgLoss) + '</span>' : '\u2014') + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table></div></div>';
  return html;
}

// ── Symbols ──
function renderReportTickerSymbols(trades, el) {
  var bySymbol = {};
  for (var i = 0; i < trades.length; i++) {
    var sym = ((trades[i].symbol) || '').toUpperCase().trim();
    if (!sym) continue;
    if (!bySymbol[sym]) bySymbol[sym] = [];
    bySymbol[sym].push(trades[i]);
  }
  var symbols = Object.keys(bySymbol).sort(function(a, b) {
    return bySymbol[b].length - bySymbol[a].length;
  });
  if (!symbols.length) {
    el.innerHTML = '<div class="report-empty">No trades with symbols found.</div>';
    return;
  }
  var statsArr  = symbols.map(function(s) { return buildRptGroupStats(bySymbol[s]); });
  var cards     = pickRptHighlights(statsArr, 'symbol', symbols);
  var rowGroups = symbols.map(function(s) { return { label: s, trades: bySymbol[s] }; });
  el.innerHTML  = renderRptCards(cards)
                + renderTickerSummaryTable('Symbol', symbols, statsArr)
                + renderCrossAnalysis(rowGroups, trades);
}

// ── Trade Types ──
function renderReportTickerTradeTypes(trades, el) {
  var byType = {};
  for (var i = 0; i < trades.length; i++) {
    var tp = (trades[i].type || 'stock');
    var lbl = tp.charAt(0).toUpperCase() + tp.slice(1);
    if (!byType[lbl]) byType[lbl] = [];
    byType[lbl].push(trades[i]);
  }
  var types = Object.keys(byType).sort();
  if (!types.length) {
    el.innerHTML = '<div class="report-empty">No trades found.</div>';
    return;
  }
  var statsArr  = types.map(function(t) { return buildRptGroupStats(byType[t]); });
  var cards     = pickRptHighlights(statsArr, 'trade type', types);
  var rowGroups = types.map(function(t) { return { label: t, trades: byType[t] }; });
  el.innerHTML  = renderRptCards(cards)
                + renderTickerSummaryTable('Trade Type', types, statsArr)
                + renderCrossAnalysis(rowGroups, trades);
}

// ── Prices ──
function renderReportTickerPrices(trades, el) {
  var byBucket = RPT_PRICE_BUCKETS.map(function() { return []; });
  for (var i = 0; i < trades.length; i++) {
    var price = rptGetAvgEntryPrice(trades[i]);
    if (price === null) continue;
    for (var b = 0; b < RPT_PRICE_BUCKETS.length; b++) {
      if (price >= RPT_PRICE_BUCKETS[b].min && price < RPT_PRICE_BUCKETS[b].max) {
        byBucket[b].push(trades[i]); break;
      }
    }
  }
  var labels    = RPT_PRICE_BUCKETS.map(function(b) { return b.label; });
  var statsArr  = byBucket.map(function(g) { return buildRptGroupStats(g); });
  var cards     = pickRptHighlights(statsArr, 'price', labels);
  var rowGroups = RPT_PRICE_BUCKETS.map(function(b, i) { return { label: b.label, trades: byBucket[i] }; });
  el.innerHTML  = renderRptCards(cards)
                + renderTickerSummaryTable('Prices', labels, statsArr)
                + renderCrossAnalysis(rowGroups, trades);
}

// ─── TAGS REPORT ───

// Shared renderer for Custom Tags, Mistakes, and Trading Rules.
// items  = array of {id, text} from loadTags/loadMistakes/loadRules
// field  = 'tags' | 'mistakes' | 'rules'  (the key on each trade)
// itemLabel = singular label for highlight cards (e.g. 'tag', 'mistake', 'trading rule')
function renderReportTagGroup(trades, items, field, itemLabel, el) {
  if (!items.length) {
    el.innerHTML = '<div class="report-empty">No ' + itemLabel + 's configured yet.</div>';
    return;
  }

  // Build a map of id → {text, trades[]}
  var byId = {};
  items.forEach(function(x) { byId[x.id] = { text: x.text, trades: [] }; });

  for (var i = 0; i < trades.length; i++) {
    var ids = trades[i][field] || [];
    for (var k = 0; k < ids.length; k++) {
      if (byId[ids[k]]) byId[ids[k]].trades.push(trades[i]);
    }
  }

  // Keep original item order from the stored list
  var labels    = items.map(function(x) { return x.text; });
  var groups    = items.map(function(x) { return byId[x.id].trades; });
  var statsArr  = groups.map(function(g) { return buildRptGroupStats(g); });
  var cards     = pickRptHighlights(statsArr, itemLabel, labels);
  var rowGroups = items.map(function(x, i) { return { label: x.text, trades: groups[i] }; });

  el.innerHTML = renderRptCards(cards)
               + renderTickerSummaryTable(itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1), labels, statsArr)
               + renderCrossAnalysis(rowGroups, trades);
}

// ─── OPTIONS: DAYS TILL EXPIRATION REPORT ───

var RPT_DTE_BUCKETS = [
  { label: 'Same day', min: 0, max: 1 },
  { label: '1 day',    min: 1, max: 2 },
  { label: '2 days',   min: 2, max: 3 },
  { label: '3 days',   min: 3, max: 4 },
  { label: '4 days',   min: 4, max: 5 },
  { label: '5 days',   min: 5, max: 6 },
  { label: '6 days',   min: 6, max: 7 },
  { label: '7 days',   min: 7, max: 8 },
  { label: '8 days',   min: 8, max: 9 },
  { label: '9 days',   min: 9, max: 10 },
  { label: '10+ days', min: 10, max: Infinity },
];

function rptGetDTE(t) {
  if (!t.expiryDate || !t.date) return null;
  var expiry = new Date(t.expiryDate + 'T12:00:00');
  var entry  = new Date(t.date      + 'T12:00:00');
  if (isNaN(expiry) || isNaN(entry)) return null;
  var diff = Math.round((expiry - entry) / 86400000);
  return diff >= 0 ? diff : null;
}

function rptGetTradeVolume(t) {
  if (t.legs && t.legs.length) {
    return t.legs.filter(function(l) { return l.action === 'buy'; })
      .reduce(function(s, l) { return s + (parseFloat(l.quantity) || 0); }, 0);
  }
  return parseFloat(t.quantity) || 0;
}

function renderDTECharts(bucketLabels, counts, pnls) {
  var maxCount = Math.max.apply(null, counts.concat([1]));
  var maxAbsPnl = Math.max.apply(null, pnls.map(Math.abs).concat([1]));

  function distBar(count) {
    var pct = (count / maxCount * 100).toFixed(1);
    return '<div class="dte-bar-row">'
      + '<div class="dte-bar-fill dte-bar-dist" style="width:' + pct + '%"></div>'
      + '<span class="dte-bar-val">' + count + '</span>'
      + '</div>';
  }

  function perfBar(pnl) {
    var pct = (Math.abs(pnl) / maxAbsPnl * 46).toFixed(1); // max 46% of half-width
    var cls = pnl >= 0 ? 'dte-bar-pos' : 'dte-bar-neg';
    var fmt = (pnl >= 0 ? '+$' : '-$') + Math.abs(Math.round(pnl)).toLocaleString('en-US');
    if (pnl >= 0) {
      return '<div class="dte-bar-row dte-perf-row">'
        + '<div class="dte-perf-left"></div>'
        + '<div class="dte-perf-right"><div class="dte-bar-fill ' + cls + '" style="width:' + pct + '%"></div></div>'
        + '<span class="dte-bar-val ' + cls + '">' + fmt + '</span>'
        + '</div>';
    }
    return '<div class="dte-bar-row dte-perf-row">'
      + '<div class="dte-perf-left"><div class="dte-bar-fill ' + cls + '" style="width:' + pct + '%;margin-left:auto"></div></div>'
      + '<div class="dte-perf-right"></div>'
      + '<span class="dte-bar-val ' + cls + '">' + fmt + '</span>'
      + '</div>';
  }

  var distRows = '', perfRows = '';
  for (var i = 0; i < bucketLabels.length; i++) {
    distRows += '<div class="dte-chart-row"><span class="dte-row-label">' + bucketLabels[i] + '</span>' + distBar(counts[i]) + '</div>';
    perfRows += '<div class="dte-chart-row"><span class="dte-row-label">' + bucketLabels[i] + '</span>' + perfBar(pnls[i]) + '</div>';
  }

  return '<div class="dte-charts-wrap">'
    + '<div class="dte-chart-panel">'
    +   '<div class="dte-chart-title">Trade Distribution by Days Till Expiration</div>'
    +   '<div class="dte-chart-subtitle">Options only</div>'
    +   '<div class="dte-chart-rows">' + distRows + '</div>'
    + '</div>'
    + '<div class="dte-chart-panel">'
    +   '<div class="dte-chart-title">Performance by Days Till Expiration</div>'
    +   '<div class="dte-chart-subtitle">Net P&amp;L</div>'
    +   '<div class="dte-chart-rows dte-perf-chart">' + perfRows + '</div>'
    + '</div>'
    + '</div>';
}

function renderDTESummaryTable(bucketLabels, groups) {
  var html = '<div class="report-table-section"><div class="report-table-title">Summary</div>';
  html += '<div class="report-table-wrap"><table class="report-table dte-summary-table"><thead><tr>';
  ['Days till expiration','Net P&amp;L','Win %','Gross win','Gross loss','Trades','Volume'].forEach(function(h) {
    html += '<th>' + h + '</th>';
  });
  html += '</tr></thead><tbody>';

  for (var i = 0; i < bucketLabels.length; i++) {
    var g = groups[i];
    if (!g.length) continue;
    var pnl = 0, wins = 0, grossWin = 0, grossLoss = 0, vol = 0;
    for (var t = 0; t < g.length; t++) {
      var p = getPnl(g[t]) || 0;
      pnl += p;
      vol += rptGetTradeVolume(g[t]);
      if (p > 0) { wins++; grossWin  += p; }
      if (p < 0) { grossLoss += Math.abs(p); }
    }
    pnl = Math.round(pnl * 100) / 100;
    var total   = g.length;
    var winRate = total ? (wins / total * 100).toFixed(1) : 0;
    var lossPct = total ? ((total - wins) / total * 100).toFixed(1) : 0;

    var winBar = '<div class="dte-win-bar">'
      + '<div class="dte-win-seg dte-win-loss" style="width:' + lossPct + '%"></div>'
      + '<div class="dte-win-seg dte-win-win"  style="width:' + winRate + '%"></div>'
      + '</div>';

    var pnlCls = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'neu';
    html += '<tr>';
    html += '<td><strong>' + bucketLabels[i] + '</strong></td>';
    html += '<td><span class="' + pnlCls + '">' + (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) + '</span></td>';
    html += '<td>' + winBar + '<span style="font-size:11px;color:var(--text-muted);margin-left:6px">' + winRate + '%</span></td>';
    html += '<td><span class="pos">$' + grossWin.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) + '</span></td>';
    html += '<td><span class="neg">-$' + grossLoss.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}) + '</span></td>';
    html += '<td>' + total + '</td>';
    html += '<td>' + vol.toLocaleString('en-US', {minimumFractionDigits:1,maximumFractionDigits:1}) + '</td>';
    html += '</tr>';
  }

  html += '</tbody></table></div></div>';
  return html;
}

function renderReportOptionsDTE(trades, el) {
  var optionTrades = trades.filter(function(t) {
    return t.type === 'option' && t.expiryDate;
  });

  if (!optionTrades.length) {
    el.innerHTML = '<div class="report-empty">No option trades with expiry dates found.</div>';
    return;
  }

  var byBucket = RPT_DTE_BUCKETS.map(function() { return []; });
  for (var i = 0; i < optionTrades.length; i++) {
    var dte = rptGetDTE(optionTrades[i]);
    if (dte === null) continue;
    for (var b = 0; b < RPT_DTE_BUCKETS.length; b++) {
      if (dte >= RPT_DTE_BUCKETS[b].min && dte < RPT_DTE_BUCKETS[b].max) {
        byBucket[b].push(optionTrades[i]); break;
      }
    }
  }

  var labels   = RPT_DTE_BUCKETS.map(function(b) { return b.label; });
  var counts   = byBucket.map(function(g) { return g.length; });
  var pnls     = byBucket.map(function(g) {
    return g.reduce(function(s, t) { return s + (getPnl(t) || 0); }, 0);
  });

  var statsArr  = byBucket.map(function(g) { return buildRptGroupStats(g); });
  var cards     = pickRptHighlights(statsArr, 'DTE', labels);
  var rowGroups = RPT_DTE_BUCKETS.map(function(b, i) { return { label: b.label, trades: byBucket[i] }; });

  el.innerHTML = renderRptCards(cards)
               + renderDTESummaryTable(labels, byBucket)
               + renderCrossAnalysis(rowGroups, optionTrades);
}

// ─── PERFORMANCE REPORT ───

function rptGroupByDate(trades) {
  var groups = {};
  for (var i = 0; i < trades.length; i++) {
    var key = rptTradeDateKey(trades[i]);
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(trades[i]);
  }
  return groups;
}

function rptGetTradeSide(t) {
  if (t.legs && t.legs.length) {
    return t.legs[0].action === 'buy' ? 'long' : 'short';
  }
  return t.side || 'long';
}

function rptGetPlannedR(t) {
  if (!t.legs || !t.legs.length) return null;
  if (!t.stopLoss || !t.stopLoss.length) return null;
  if (!t.profitTargets || !t.profitTargets.length) return null;
  var mult = t.type === 'option' ? 100 : 1;
  var buyLegs = t.legs.filter(function(l) { return l.action === 'buy'; });
  if (!buyLegs.length) return null;
  var totalBuyQty = buyLegs.reduce(function(s, l) { return s + (parseFloat(l.quantity) || 0); }, 0);
  if (!totalBuyQty) return null;
  var avgEntry = buyLegs.reduce(function(s, l) {
    return s + (parseFloat(l.price) || 0) * (parseFloat(l.quantity) || 0);
  }, 0) / totalBuyQty;
  var validSls = t.stopLoss.filter(function(sl) {
    return sl.price !== '' && !isNaN(parseFloat(sl.price)) && parseFloat(sl.qty) > 0;
  });
  if (!validSls.length) return null;
  var tradeRisk = validSls.reduce(function(s, sl) {
    return s + (parseFloat(sl.price) - avgEntry) * parseFloat(sl.qty) * mult;
  }, 0);
  if (!tradeRisk) return null;
  var validPts = t.profitTargets.filter(function(pt) {
    return parseFloat(pt.price) > 0 && parseFloat(pt.qty) > 0;
  });
  if (!validPts.length) return null;
  var initialTarget = validPts.reduce(function(s, pt) {
    return s + ((parseFloat(pt.price) || 0) - avgEntry) * (parseFloat(pt.qty) || 0) * mult;
  }, 0);
  return initialTarget / Math.abs(tradeRisk);
}

function rptGetDaySessionMins(dayTrades) {
  var allTs = [];
  for (var i = 0; i < dayTrades.length; i++) {
    var t = dayTrades[i];
    if (t.legs && t.legs.length) {
      for (var j = 0; j < t.legs.length; j++) {
        if (t.legs[j].date) {
          var ts = new Date(t.legs[j].date).getTime();
          if (!isNaN(ts)) allTs.push(ts);
        }
      }
    }
  }
  if (allTs.length < 2) return null;
  return (Math.max.apply(null, allTs) - Math.min.apply(null, allTs)) / 60000;
}

function rptFmtDurationMins(mins) {
  if (mins === null || mins === undefined || !isFinite(mins)) return '\u2014';
  var totalMins = Math.round(mins);
  var days = Math.floor(totalMins / 1440);
  var hrs  = Math.floor((totalMins % 1440) / 60);
  var m    = totalMins % 60;
  if (days > 0) return days + 'd ' + hrs + 'h ' + m + 'm';
  if (hrs  > 0) return hrs + 'h ' + m + 'm';
  return m + 'm';
}

function rptBuildPerfStats(trades) {
  var totalPnl = 0, wins = 0, losses = 0, grossWin = 0, grossLoss = 0;
  var longWins = 0, longTotal = 0, shortWins = 0, shortTotal = 0;
  var totalDurMins = 0, durCount = 0;
  var totalVol = 0;
  var allPlannedR = [], allRealizedR = [];
  var bestTrade = null, worstTrade = null, longestDurMins = null;

  for (var i = 0; i < trades.length; i++) {
    var t = trades[i];
    var p = 0;
    try { p = getPnl(t) || 0; } catch(e) { p = 0; }
    if (!isFinite(p)) p = 0;
    totalPnl += p;
    if (p > 0) { wins++; grossWin  += p; }
    if (p < 0) { losses++; grossLoss += Math.abs(p); }

    var side = rptGetTradeSide(t);
    if (side === 'long')  { longTotal++;  if (p > 0) longWins++;  }
    else                  { shortTotal++; if (p > 0) shortWins++; }

    var dur = rptGetDurationMins(t);
    if (dur !== null) { totalDurMins += dur; durCount++; }
    if (dur !== null && (longestDurMins === null || dur > longestDurMins)) longestDurMins = dur;

    totalVol += rptGetTradeVolume(t);

    var pr = rptGetPlannedR(t);
    if (pr !== null && isFinite(pr)) allPlannedR.push(pr);
    var rr = rptGetRealizedR(t);
    if (rr !== null && isFinite(rr)) allRealizedR.push(rr);

    if (bestTrade  === null || p > bestTrade.pnl)  bestTrade  = { pnl: p };
    if (worstTrade === null || p < worstTrade.pnl) worstTrade = { pnl: p };
  }

  totalPnl = Math.round(totalPnl * 100) / 100;
  var total = trades.length;

  var byDate   = rptGroupByDate(trades);
  var dateKeys = Object.keys(byDate).sort();
  var loggedDays = dateKeys.length;
  var winDays = 0, lossDays = 0, tieDays = 0;
  var sumWinDay = 0, sumLossDay = 0;
  var bestDay = null, worstDay = null;
  var totalSessionMins = 0, sessionCount = 0;

  for (var d = 0; d < dateKeys.length; d++) {
    var dTrades = byDate[dateKeys[d]];
    var dPnl = 0;
    for (var di = 0; di < dTrades.length; di++) {
      try { dPnl += getPnl(dTrades[di]) || 0; } catch(e) {}
    }
    dPnl = Math.round(dPnl * 100) / 100;
    if (dPnl > 0) { winDays++;  sumWinDay  += dPnl; }
    else if (dPnl < 0) { lossDays++; sumLossDay += Math.abs(dPnl); }
    else tieDays++;
    if (bestDay  === null || dPnl > bestDay.pnl)  bestDay  = { date: dateKeys[d], pnl: dPnl };
    if (worstDay === null || dPnl < worstDay.pnl) worstDay = { date: dateKeys[d], pnl: dPnl };
    var sm = rptGetDaySessionMins(dTrades);
    if (sm !== null) { totalSessionMins += sm; sessionCount++; }
  }

  var avgWinDay  = winDays  ? sumWinDay  / winDays  : null;
  var avgLossDay = lossDays ? sumLossDay / lossDays : null;
  var avgWinTrade  = wins   ? grossWin  / wins   : null;
  var avgLossTrade = losses ? grossLoss / losses : null;

  return {
    total:           total,
    totalPnl:        totalPnl,
    wins:            wins,
    losses:          losses,
    grossWin:        grossWin,
    grossLoss:       grossLoss,
    winRate:         total ? parseFloat((wins / total * 100).toFixed(1)) : 0,
    loggedDays:      loggedDays,
    winDays:         winDays,
    lossDays:        lossDays,
    tieDays:         tieDays,
    avgDailyPnl:     loggedDays ? Math.round(totalPnl / loggedDays * 100) / 100 : 0,
    avgDailyVol:     loggedDays ? Math.round(totalVol / loggedDays * 10) / 10 : 0,
    dailyWinRate:    loggedDays ? parseFloat((winDays / loggedDays * 100).toFixed(1)) : 0,
    avgDailyWinLoss: (avgWinDay !== null && avgLossDay && avgLossDay > 0)
                       ? Math.round(avgWinDay / avgLossDay * 100) / 100 : null,
    avgTradeWinLoss: (avgWinTrade !== null && avgLossTrade && avgLossTrade > 0)
                       ? Math.round(avgWinTrade / avgLossTrade * 100) / 100 : null,
    profitFactor:    grossLoss > 0 ? Math.round(grossWin / grossLoss * 100) / 100 : null,
    avgHoldMins:     durCount ? totalDurMins / durCount : null,
    avgSessionMins:  sessionCount ? totalSessionMins / sessionCount : null,
    maxDailyDrawdown: lossDays ? -(Math.max.apply(null, Object.keys(byDate).map(function(k) {
      var dp = 0;
      for (var i = 0; i < byDate[k].length; i++) { try { dp += getPnl(byDate[k][i]) || 0; } catch(e) {} }
      return dp < 0 ? Math.abs(dp) : 0;
    }))) : null,
    avgDailyDrawdown: lossDays ? -(sumLossDay / lossDays) : null,
    avgPlannedR:     allPlannedR.length  ? Math.round(allPlannedR.reduce(function(s,r){return s+r;},0) / allPlannedR.length * 100) / 100 : null,
    avgRealizedR:    allRealizedR.length ? Math.round(allRealizedR.reduce(function(s,r){return s+r;},0) / allRealizedR.length * 100) / 100 : null,
    tradeExpectancy: total ? Math.round(totalPnl / total * 100) / 100 : 0,
    longsWinRate:    longTotal  ? parseFloat((longWins  / longTotal  * 100).toFixed(1)) : null,
    shortsWinRate:   shortTotal ? parseFloat((shortWins / shortTotal * 100).toFixed(1)) : null,
    bestTrade:       bestTrade,
    worstTrade:      worstTrade,
    bestDay:         bestDay,
    worstDay:        worstDay,
    longestDurMins:  longestDurMins
  };
}

function perfStatCell(label, value, sub) {
  return '<div class="perf-stat">'
    + '<div class="perf-stat-label">' + label + '</div>'
    + '<div class="perf-stat-value">' + value + '</div>'
    + (sub ? '<div class="perf-stat-sub">' + sub + '</div>' : '')
    + '</div>';
}

function perfFmtPnl(v) {
  if (v === null || v === undefined) return '<span class="neu">\u2014</span>';
  var cls  = v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu';
  var sign = v > 0 ? '+$' : '-$';
  return '<span class="' + cls + '">' + sign + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) + '</span>';
}

function perfFmtR(v) {
  if (v === null || v === undefined) return '\u2014';
  var cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
  var str = v.toFixed(2) + 'R';
  return cls ? '<span class="' + cls + '">' + str + '</span>' : str;
}

function renderReportPerfSummary(trades, el) {
  if (!trades.length) { el.innerHTML = '<div class="report-empty">No trades to display.</div>'; return; }
  var s = rptBuildPerfStats(trades);
  var html = '<div class="perf-stats-grid">';
  // Row 1
  html += perfStatCell('Net P&amp;L',          perfFmtPnl(s.totalPnl));
  html += perfStatCell('Trade Expectancy',      perfFmtPnl(s.tradeExpectancy));
  html += perfStatCell('Avg Net Trade P&amp;L', perfFmtPnl(s.tradeExpectancy));
  html += perfStatCell('Avg Daily Volume',      s.avgDailyVol.toLocaleString('en-US', {maximumFractionDigits:1}));
  // Row 2
  html += perfStatCell('Win %',                 s.winRate + '%');
  html += perfStatCell('Avg Daily Win/Loss',    s.avgDailyWinLoss !== null ? s.avgDailyWinLoss.toFixed(2) : '\u2014');
  html += perfStatCell('Avg Daily Net P&amp;L', perfFmtPnl(s.avgDailyPnl));
  html += perfStatCell('Logged Days',           s.loggedDays.toString());
  // Row 3
  html += perfStatCell('Avg Daily Win %',       s.dailyWinRate + '%', '(' + s.winDays + '/' + s.tieDays + '/' + s.lossDays + ')');
  html += perfStatCell('Avg Trade Win/Loss',    s.avgTradeWinLoss !== null ? s.avgTradeWinLoss.toFixed(2) : '\u2014');
  html += perfStatCell('Avg. Planned R-Multiple', perfFmtR(s.avgPlannedR));
  html += perfStatCell('Max Daily Net Drawdown',  s.maxDailyDrawdown !== null ? perfFmtPnl(s.maxDailyDrawdown) : '\u2014');
  // Row 4
  html += perfStatCell('Profit Factor',         s.profitFactor !== null ? s.profitFactor.toFixed(2) : '\u2014');
  html += perfStatCell('Avg Hold Time',         rptFmtDurationMins(s.avgHoldMins));
  html += perfStatCell('Avg. Realized R-Multiple', perfFmtR(s.avgRealizedR));
  html += perfStatCell('Avg Daily Net Drawdown',   s.avgDailyDrawdown !== null ? perfFmtPnl(s.avgDailyDrawdown) : '\u2014');
  html += '</div>';
  el.innerHTML = html;
}

function renderReportPerfDays(trades, el) {
  if (!trades.length) { el.innerHTML = '<div class="report-empty">No trades to display.</div>'; return; }
  var s = rptBuildPerfStats(trades);
  var html = '<div class="perf-stats-grid">';
  html += perfStatCell('Avg Daily Win %',          s.dailyWinRate + '%', '(' + s.winDays + '/' + s.tieDays + '/' + s.lossDays + ')');
  html += perfStatCell('Avg Daily Win/Loss',        s.avgDailyWinLoss !== null ? s.avgDailyWinLoss.toFixed(2) : '\u2014');
  html += perfStatCell('Largest Profitable Day',    s.bestDay && s.bestDay.pnl > 0 ? perfFmtPnl(s.bestDay.pnl) : '\u2014');
  html += perfStatCell('Avg Daily Net P&amp;L',     perfFmtPnl(s.avgDailyPnl));
  html += perfStatCell('Largest Losing Day',        s.worstDay && s.worstDay.pnl < 0 ? perfFmtPnl(s.worstDay.pnl) : '\u2014');
  html += perfStatCell('Avg Trading Day Duration',  rptFmtDurationMins(s.avgSessionMins));
  html += '</div>';
  el.innerHTML = html;
}

function renderReportPerfTrades(trades, el) {
  if (!trades.length) { el.innerHTML = '<div class="report-empty">No trades to display.</div>'; return; }
  var s = rptBuildPerfStats(trades);
  var html = '<div class="perf-stats-grid">';
  html += perfStatCell('Win %',                    s.winRate + '%');
  html += perfStatCell('Avg Trade Win/Loss',        s.avgTradeWinLoss !== null ? s.avgTradeWinLoss.toFixed(2) : '\u2014');
  html += perfStatCell('Largest Profitable Trade',  s.bestTrade && s.bestTrade.pnl > 0 ? perfFmtPnl(s.bestTrade.pnl) : '\u2014');
  html += perfStatCell('Longest Trade Duration',    rptFmtDurationMins(s.longestDurMins));
  html += perfStatCell('Longs Win %',               s.longsWinRate !== null ? s.longsWinRate + '%' : '\u2014');
  html += perfStatCell('Trade Expectancy',          perfFmtPnl(s.tradeExpectancy));
  html += perfStatCell('Largest Losing Trade',      s.worstTrade && s.worstTrade.pnl < 0 ? perfFmtPnl(s.worstTrade.pnl) : '\u2014');
  html += perfStatCell('Shorts Win %',              s.shortsWinRate !== null ? s.shortsWinRate + '%' : '\u2014');
  html += perfStatCell('Avg Net Trade P&amp;L',     perfFmtPnl(s.tradeExpectancy));
  html += perfStatCell('Avg Trading Day Duration',  rptFmtDurationMins(s.avgSessionMins));
  html += '</div>';
  el.innerHTML = html;
}
