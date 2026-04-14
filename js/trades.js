let sortField = 'date', sortDir = 'desc';
let tradePage     = 1;
let tradePageSize = 100;

function sortBy(field) {
  sortDir = sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
  sortField = field;
  tradePage = 1;
  renderTrades();
}

function setTradePage(p) {
  tradePage = p;
  renderTrades();
  document.getElementById('view-trades')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setTradePageSize(n) {
  tradePageSize = n;
  tradePage = 1;
  dbPutSetting('tradePageSize', n).catch(console.error);
  renderTrades();
}

function _buildPaginationHTML(total, totalPages) {
  if (total === 0) return '';
  const start = (tradePage - 1) * tradePageSize + 1;
  const end   = Math.min(tradePage * tradePageSize, total);

  // Page number buttons — show up to 7: first, last, current ±2, ellipsis
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= tradePage - 2 && i <= tradePage + 2)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }

  const pageButtons = pages.map(p =>
    p === '…'
      ? `<span class="tpg-ellipsis">…</span>`
      : `<button class="tpg-page${p === tradePage ? ' active' : ''}" onclick="setTradePage(${p})">${p}</button>`
  ).join('');

  const perPageBtns = [50, 100, 200, 250].map(n =>
    `<button class="tpg-size${n === tradePageSize ? ' active' : ''}" onclick="setTradePageSize(${n})">${n}</button>`
  ).join('');

  return `<div class="trades-pagination">
    <div class="tpg-left">
      <button class="tpg-nav" onclick="setTradePage(${tradePage - 1})" ${tradePage === 1 ? 'disabled' : ''}>&#8592; Prev</button>
      <div class="tpg-pages">${pageButtons}</div>
      <button class="tpg-nav" onclick="setTradePage(${tradePage + 1})" ${tradePage === totalPages ? 'disabled' : ''}>Next &#8594;</button>
    </div>
    <div class="tpg-right">
      <span class="tpg-info">Showing <strong>${start}–${end}</strong> of <strong>${total}</strong> trade${total !== 1 ? 's' : ''}</span>
      <div class="tpg-sizes">
        <span class="tpg-size-label">Per page:</span>
        ${perPageBtns}
      </div>
    </div>
  </div>`;
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
  let trades = applyGlobalFilter(load());

  trades.sort((a, b) => {
    let va = sortField === 'pnl' ? getPnl(a) : (a[sortField] ?? '');
    let vb = sortField === 'pnl' ? getPnl(b) : (b[sortField] ?? '');
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const total      = trades.length;
  const totalPages = Math.max(1, Math.ceil(total / tradePageSize));
  if (tradePage > totalPages) tradePage = totalPages;

  const pgHTML = _buildPaginationHTML(total, totalPages);
  const pgTop  = document.getElementById('trades-pg-top');
  const pgBot  = document.getElementById('trades-pg-bot');
  if (pgTop) pgTop.innerHTML = pgHTML;
  if (pgBot) pgBot.innerHTML = pgHTML;

  const tbody = document.getElementById('trades-body');
  if (!total) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="12">No trades found. Click a calendar day or use "+ Add Trade" to get started.</td></tr>`;
    return;
  }

  // Slice to current page
  const start = (tradePage - 1) * tradePageSize;
  trades = trades.slice(start, start + tradePageSize);

  const allMistakes = loadMistakes();
  const allRules    = loadRules();
  const allTags     = loadTags();

  const pageOffset = (tradePage - 1) * tradePageSize;
  tbody.innerHTML = trades.map((t, i) => {
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

    const mistakePills = (t.mistakes || [])
      .map(id => { const m = allMistakes.find(x => x.id === id); return m ? `<span class="trade-mistake-badge">${escHtml(m.text)}</span>` : null; })
      .filter(Boolean).join(' ');

    const rulePills = (t.rules || [])
      .map(id => { const r = allRules.find(x => x.id === id); return r ? `<span class="trade-rule-badge">${escHtml(r.text)}</span>` : null; })
      .filter(Boolean).join(' ');

    const tagPills = (t.tags || [])
      .map(id => { const tg = allTags.find(x => x.id === id); return tg ? `<span class="trade-tag-badge">${escHtml(tg.text)}</span>` : null; })
      .filter(Boolean).join(' ');

    return `<tr>
      <td class="col-rownum-cell">${pageOffset + i + 1}</td>
      <td>${dateStr}</td>
      <td><strong>${t.symbol}</strong></td>
      <td>${sideLabel}</td>
      <td>${typeLbl}</td>
      <td>${legsSummary(t)}</td>
      <td class="${pnlCls}" style="font-weight:700">${pnlStr}</td>
      <td>${mistakePills ? `<div class="trade-pills-wrap">${mistakePills}</div>` : '<span class="trade-pills-empty">—</span>'}</td>
      <td>${rulePills   ? `<div class="trade-pills-wrap">${rulePills}</div>`   : '<span class="trade-pills-empty">—</span>'}</td>
      <td>${tagPills    ? `<div class="trade-pills-wrap">${tagPills}</div>`    : '<span class="trade-pills-empty">—</span>'}</td>
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
