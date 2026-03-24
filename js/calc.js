// FIFO match buy legs against sell legs.
// Returns { 'YYYY-MM-DD': realizedPnl, ... } keyed by each sell leg's date.
function getRealizationsByDate(t) {
  if (!t.legs || !t.legs.length) {
    // Legacy format — attribute to trade date
    return { [t.date]: _getPnlLegacy(t) };
  }

  const mult = t.type === 'option' ? 100 : 1;

  // Build FIFO queue from buy legs (in order)
  const buyQueue = t.legs
    .filter(l => l.action === 'buy')
    .map(l => ({
      price:     parseFloat(l.price)      || 0,
      comm:      parseFloat(l.commission) || 0,
      fees:      parseFloat(l.fees)       || 0,
      totalQty:  parseFloat(l.quantity)   || 0,
      remaining: parseFloat(l.quantity)   || 0,
    }));

  const result = {};

  for (const leg of t.legs) {
    if (leg.action !== 'sell') continue;

    const sellDate  = leg.date ? leg.date.split('T')[0] : t.date;
    const sellPrice = parseFloat(leg.price)      || 0;
    const sellComm  = parseFloat(leg.commission) || 0;
    const sellFees  = parseFloat(leg.fees)       || 0;
    const sellQty   = parseFloat(leg.quantity)   || 0;
    let   sellLeft  = sellQty;

    let revenue  = 0;
    let buyCost  = 0;
    let buyComm  = 0;
    let buyFees  = 0;
    let matched  = 0;

    for (const buy of buyQueue) {
      if (buy.remaining <= 0 || sellLeft <= 0) continue;
      const qty   = Math.min(buy.remaining, sellLeft);
      const ratio = buy.totalQty > 0 ? qty / buy.totalQty : 0;

      revenue  += sellPrice * qty * mult;
      buyCost  += buy.price * qty * mult;
      buyComm  += buy.comm * ratio;
      buyFees  += buy.fees * ratio;
      matched  += qty;

      buy.remaining -= qty;
      sellLeft      -= qty;
    }

    if (matched > 0) {
      const sellRatio = sellQty > 0 ? matched / sellQty : 1;
      const pnl = revenue - buyCost
                  - sellComm * sellRatio - sellFees * sellRatio
                  - buyComm - buyFees;
      result[sellDate] = (result[sellDate] || 0) + Math.round(pnl * 100) / 100;
    }
  }

  return result;
}

function getOpenQty(t) {
  if (!t.legs || !t.legs.length) return 0;
  const buyQueue = t.legs
    .filter(l => l.action === 'buy')
    .map(l => ({ remaining: parseFloat(l.quantity) || 0 }));
  for (const leg of t.legs) {
    if (leg.action !== 'sell') continue;
    let left = parseFloat(leg.quantity) || 0;
    for (const buy of buyQueue) {
      if (buy.remaining <= 0 || left <= 0) continue;
      const qty = Math.min(buy.remaining, left);
      buy.remaining -= qty;
      left          -= qty;
    }
  }
  return buyQueue.reduce((s, b) => s + b.remaining, 0);
}

function getPnl(t) {
  if (t.legs && t.legs.length) {
    const total = Object.values(getRealizationsByDate(t)).reduce((s, p) => s + p, 0);
    return Math.round(total * 100) / 100;
  }
  return _getPnlLegacy(t);
}

function _getPnlLegacy(t) {
  const qty   = parseFloat(t.quantity)   || 0;
  const entry = parseFloat(t.entryPrice) || 0;
  const exit  = parseFloat(t.exitPrice)  || 0;
  const comm  = parseFloat(t.commission) || 0;
  const fees  = parseFloat(t.fees)       || 0;
  const mult  = t.type === 'option' ? 100 : 1;
  const dir   = t.side === 'long' ? 1 : -1;
  return Math.round((dir * (exit - entry) * qty * mult - comm - fees) * 100) / 100;
}

function computeStats(trades) {
  let totalPnl = 0, wins = 0, losses = 0, grossWin = 0, grossLoss = 0;
  const byDate = {};
  for (const t of trades) {
    const p = getPnl(t);
    totalPnl += p;
    if (p > 0) { wins++;   grossWin  += p; }
    if (p < 0) { losses++; grossLoss += Math.abs(p); }
    // Use sell dates for best/worst day calculation
    const realizations = t.legs && t.legs.length ? getRealizationsByDate(t) : { [t.date]: p };
    for (const [date, dp] of Object.entries(realizations)) {
      byDate[date] = (byDate[date] || 0) + dp;
    }
  }
  const days     = Object.values(byDate);
  const bestDay  = days.length ? Math.max(...days) : null;
  const worstDay = days.length ? Math.min(...days) : null;
  const winRate  = trades.length ? ((wins / trades.length) * 100).toFixed(1) : '0.0';
  const avgWin   = wins   ? Math.round(grossWin  / wins).toLocaleString('en-US')   : null;
  const avgLoss  = losses ? Math.round(grossLoss / losses).toLocaleString('en-US') : null;
  const pf       = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2)
                 : grossWin  > 0 ? '∞' : '—';
  return { totalPnl, wins, losses, grossWin, grossLoss, winRate, avgWin, avgLoss, pf, bestDay, worstDay, total: trades.length };
}
