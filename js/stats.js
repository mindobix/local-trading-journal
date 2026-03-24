function renderStats() {
  const s = computeStats(load());
  const f = (n) => {
    if (n === null) return '—';
    const abs = Math.round(Math.abs(n)).toLocaleString('en-US');
    return (n < 0 ? '-$' : '$') + abs;
  };
  const pnlCls = s.totalPnl > 0 ? 'pos' : s.totalPnl < 0 ? 'neg' : 'neu';
  const cards = [
    ['Net P&L',       `<span class="${pnlCls}">${f(s.totalPnl)}</span>`],
    ['Win Rate',      `<span class="neu">${s.winRate}%</span>`],
    ['Total Trades',  `<span class="neu">${s.total}</span>`],
    ['Wins',          `<span class="pos">${s.wins}</span>`],
    ['Losses',        `<span class="neg">${s.losses}</span>`],
    ['Avg Win',       `<span class="pos">${s.avgWin ? '$'+s.avgWin : '—'}</span>`],
    ['Avg Loss',      `<span class="neg">${s.avgLoss ? '-$'+s.avgLoss : '—'}</span>`],
    ['Profit Factor', `<span class="neu">${s.pf}</span>`],
  ];
  document.getElementById('stats-bar').innerHTML = cards.map(([lbl, val]) =>
    `<div class="stat-card"><div class="stat-label">${lbl}</div><div class="stat-value">${val}</div></div>`
  ).join('');
}
