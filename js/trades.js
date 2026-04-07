let sortField = 'date', sortDir = 'desc';

function sortBy(field) {
  sortDir = sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
  sortField = field;
  renderTrades();
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

  const tbody = document.getElementById('trades-body');
  if (!trades.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="11">No trades found. Click a calendar day or use "+ Add Trade" to get started.</td></tr>`;
    return;
  }

  const allMistakes = loadMistakes();
  const allRules    = loadRules();
  const allTags     = loadTags();

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
      <td>${dateStr}</td>
      <td><strong>${t.symbol}</strong></td>
      <td>${sideLabel}</td>
      <td>${typeLbl}</td>
      <td>${legsSummary(t)}</td>
      <td class="${pnlCls}" style="font-weight:700">${pnlStr}</td>
      <td style="white-space:normal">${mistakePills || '—'}</td>
      <td style="white-space:normal">${rulePills || '—'}</td>
      <td style="white-space:normal">${tagPills || '—'}</td>
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
