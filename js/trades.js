let sortField = 'date', sortDir = 'desc';
let openPosFilterActive = false;

function toggleOpenPositions() {
  openPosFilterActive = !openPosFilterActive;
  const btn = document.getElementById('open-pos-filter-btn');
  btn.classList.toggle('active', openPosFilterActive);
  renderTrades();
}

function sortBy(field) {
  sortDir = sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
  sortField = field;
  renderTrades();
}

function onDateFilterChange() {
  const val = document.getElementById('filter-date').value;
  document.getElementById('custom-range').style.display = val === 'custom' ? 'flex' : 'none';
  renderTrades();
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

function legsSummary(t) {
  if (!t.legs || !t.legs.length) {
    // Legacy
    return `<span class="badge b-${t.side}">${t.side === 'long' ? 'Long' : 'Short'}</span>
            <span style="margin-left:6px;color:var(--text-muted);font-size:12px">${t.quantity} ${t.type === 'option' ? 'c' : 'sh'}</span>`;
  }
  const buys  = t.legs.filter(l => l.action === 'buy').length;
  const sells = t.legs.filter(l => l.action === 'sell').length;
  const parts = [];
  if (buys)  parts.push(`<span class="badge b-buy-sm">${buys}B</span>`);
  if (sells) parts.push(`<span class="badge b-sell-sm">${sells}S</span>`);
  return parts.join(' ');
}

function renderTrades() {
  const srch  = (document.getElementById('srch').value || '').toLowerCase();
  const fType = document.getElementById('filter-type').value;
  const fSide = document.getElementById('filter-side').value;
  const fDate = document.getElementById('filter-date').value;
  const fFrom = document.getElementById('filter-from').value;
  const fTo   = document.getElementById('filter-to').value;

  let trades = load();
  if (srch)  trades = trades.filter(t => t.symbol.toLowerCase().includes(srch));
  if (fType) trades = trades.filter(t => t.type === fType);
  if (fSide) trades = trades.filter(t => {
    if (t.legs && t.legs.length) {
      const firstAction = t.legs[0].action;
      if (fSide === 'long')  return firstAction === 'buy';
      if (fSide === 'short') return firstAction === 'sell' && t.legs.some(l => l.action === 'buy');
    }
    return t.side === fSide;
  });

  if (fDate && fDate !== 'custom') {
    const range = getDateRange(fDate);
    if (range) trades = trades.filter(t => t.date >= range.from && t.date <= range.to);
  } else if (fDate === 'custom') {
    if (fFrom) trades = trades.filter(t => t.date >= fFrom);
    if (fTo)   trades = trades.filter(t => t.date <= fTo);
  }

  if (openPosFilterActive) trades = trades.filter(t => getOpenQty(t) > 0);

  trades.sort((a, b) => {
    let va = sortField === 'pnl' ? getPnl(a) : (a[sortField] ?? '');
    let vb = sortField === 'pnl' ? getPnl(b) : (b[sortField] ?? '');
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const tbody = document.getElementById('trades-body');
  if (!trades.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No trades found. Click a calendar day or use "+ Add Trade" to get started.</td></tr>`;
    return;
  }

  tbody.innerHTML = trades.map(t => {
    const pnl    = getPnl(t);
    const pnlCls = pnl >= 0 ? 'pos' : 'neg';
    const pnlStr = (pnl >= 0 ? '+$' : '-$') + Math.abs(pnl).toFixed(2);
    const [y, m, d] = t.date.split('-');
    const dateStr = `${m}/${d}/${y}`;
    const typeLbl = t.type === 'option'
      ? `<span class="badge b-option">${(t.optionType||'OPT').toUpperCase()} $${t.strikePrice||'?'}</span>
         ${t.expiryDate ? `<span style="font-size:11px;color:var(--text-muted);margin-left:4px">exp ${fmtExpiry(t.expiryDate)}</span>` : ''}`
      : `<span class="badge b-stock">Stock</span>`;

    const sideLabel = (() => {
      if (t.legs && t.legs.length) {
        const first = t.legs[0].action;
        return first === 'buy'
          ? `<span class="badge b-long">Long</span>`
          : `<span class="badge b-short">Short</span>`;
      }
      return t.side === 'long'
        ? `<span class="badge b-long">Long</span>`
        : `<span class="badge b-short">Short</span>`;
    })();

    return `<tr>
      <td>${dateStr}</td>
      <td><strong>${t.symbol}</strong></td>
      <td>${sideLabel}</td>
      <td>${typeLbl}</td>
      <td>${legsSummary(t)}</td>
      <td class="${pnlCls}" style="font-weight:700">${pnlStr}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;color:var(--text-muted)">${t.notes || '—'}</td>
      <td>
        <div style="display:flex;gap:5px">
          <button class="icon-btn" onclick="editFromTable('${t.id}')" title="Edit">&#9998;</button>
          <button class="icon-btn del" onclick="deleteTrade('${t.id}')" title="Delete">&#128465;</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}
