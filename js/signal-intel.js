/* ── signal-intel.js ── Signal Intel tab (powered by LADSCS) ─────── */
// All globals prefixed with si_ to avoid conflicts with the main app.
// Backend expected at http://localhost:3838

const SI_API = 'http://localhost:3838';

let si_signals       = [];
let si_filter        = 'all';
let si_watchlist     = [];
let si_newIds        = new Set();
let si_selectedTicks = new Set();
let si_voted         = new Set(JSON.parse(localStorage.getItem('si_voted') || '[]'));
let si_sse           = null;
let si_pollTimer     = null;
let si_initialized   = false;

const SI_LAST_VISIT_KEY = 'si_last_visit';
let si_lastVisitAt = localStorage.getItem(SI_LAST_VISIT_KEY) || new Date(0).toISOString();

// ── API helpers ───────────────────────────────────────────────────────────────

async function si_fetch(path, opts) {
  const res = await fetch(SI_API + path, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function si_fetchSignals() {
  const since = new Date(); since.setHours(0,0,0,0);
  return (await si_fetch(`/api/signals?limit=200&since=${encodeURIComponent(since.toISOString())}`)).signals || [];
}

async function si_fetchStatus() {
  return si_fetch('/api/status');
}

// ── Offline detection ────────────────────────────────────────────────────────

function si_setOffline(offline) {
  const banner = document.getElementById('si-offline-banner');
  if (banner) banner.style.display = offline ? 'flex' : 'none';
  const crawlBtn = document.getElementById('si-crawlBtn');
  if (crawlBtn) crawlBtn.disabled = offline;
}

// ── Models ────────────────────────────────────────────────────────────────────

async function si_fetchModels() {
  try {
    const data = await si_fetch('/api/models');
    const sel  = document.getElementById('si-modelSelect');
    if (!sel) return;
    sel.innerHTML = (data.models || []).map(m =>
      `<option value="${m}" ${m === data.active ? 'selected' : ''}>${m}</option>`
    ).join('') || '<option value="">no models</option>';
  } catch { /* ollama unreachable */ }
}

async function si_changeModel(model) {
  if (!model) return;
  await si_fetch('/api/config/model', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model }),
  });
}

// ── Status bar ────────────────────────────────────────────────────────────────

function si_updateStatus(status) {
  const dot = document.getElementById('si-statusIndicator');
  const lbl = document.getElementById('si-statusLabel');
  const btn = document.getElementById('si-crawlBtn');
  if (!dot || !lbl) return;

  si_watchlist = status.watchlist || [];

  const busy = status.status === 'crawling' || status.status === 'analyzing';
  dot.className = 'si-status-dot' + (busy ? ' active' : '');
  lbl.innerHTML = busy
    ? `<span class="si-spinner"></span> ${status.status}…`
    : 'Ready';
  if (btn) { btn.disabled = busy; btn.textContent = busy ? '↺ Running…' : '↺ Crawl Now'; }

  const s = status.stats || {};
  const el = id => document.getElementById(id);
  if (el('si-statTotal'))   el('si-statTotal').textContent   = s.total    ?? '0';
  if (el('si-statBullish')) el('si-statBullish').textContent = s.bullish  ?? '0';
  if (el('si-statBearish')) el('si-statBearish').textContent = s.bearish  ?? '0';
  if (el('si-statActNow'))  el('si-statActNow').textContent  = s.act_now  ?? '0';
  if (el('si-statAvgConf')) el('si-statAvgConf').textContent = s.avg_confidence
    ? `${(s.avg_confidence * 100).toFixed(0)}%` : '—';
  if (el('si-lastCrawl'))   el('si-lastCrawl').textContent = status.lastCrawlAt
    ? si_timeAgo(status.lastCrawlAt) : 'never';
}

// ── Ticker filter ─────────────────────────────────────────────────────────────

function si_buildTickerFilter(signals) {
  const counts = {};
  for (const s of signals) counts[s.ticker] = (counts[s.ticker] || 0) + 1;
  const tickers = Object.keys(counts).sort();

  const container = document.getElementById('si-tickerChips');
  if (!container) return;
  container.innerHTML = tickers.map(t => `
    <div class="si-ticker-chip ${si_selectedTicks.has(t) ? 'active' : ''}"
         onclick="si_toggleTicker('${si_esc(t)}')">
      ${si_esc(t)}
      <span class="si-tc-count">${counts[t]}</span>
    </div>`).join('');

  const btn = document.getElementById('si-clearTickersBtn');
  if (btn) btn.style.display = si_selectedTicks.size > 0 ? 'block' : 'none';
}

function si_toggleTicker(ticker) {
  if (si_selectedTicks.has(ticker)) {
    si_selectedTicks.clear();
  } else {
    if (!window._si_shiftHeld) si_selectedTicks.clear();
    si_selectedTicks.add(ticker);
  }
  si_buildTickerFilter(si_signals);
  si_renderSignals(si_signals);
}

function si_clearTickers() {
  si_selectedTicks.clear();
  si_buildTickerFilter(si_signals);
  si_renderSignals(si_signals);
}

// ── Filtering ─────────────────────────────────────────────────────────────────

function si_filterSignals(signals, filter) {
  const ws = new Set(si_watchlist.map(t => t.toUpperCase()));
  let result;
  switch (filter) {
    case 'new':       result = signals.filter(s => si_newIds.has(s.id)); break;
    case 'watchlist': result = signals.filter(s => ws.has(s.ticker)); break;
    case 'act_now':   result = signals.filter(s => s.urgency === 'act_now'); break;
    case 'monitor':   result = signals.filter(s => s.urgency === 'monitor'); break;
    case 'bullish':   result = signals.filter(s => s.direction?.includes('BULLISH')); break;
    case 'bearish':   result = signals.filter(s => s.direction?.includes('BEARISH')); break;
    default:          result = signals;
  }
  if (si_selectedTicks.size > 0)
    result = result.filter(s => si_selectedTicks.has(s.ticker));
  return result;
}

function si_setFilter(filter, el) {
  si_filter = filter;
  document.querySelectorAll('.si-chip[data-filter]').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  si_renderSignals(si_signals);
}

// ── Render ────────────────────────────────────────────────────────────────────

function si_renderSignals(signals) {
  const filtered = si_filterSignals(signals, si_filter);
  const grid  = document.getElementById('si-grid');
  const title = document.getElementById('si-sectionTitle');
  if (!grid) return;

  const labels = {
    all: 'All Signals', new: 'New This Session', watchlist: 'Watchlist',
    act_now: 'Act Now', monitor: 'Monitor', bullish: 'Bullish', bearish: 'Bearish',
  };
  const tickSuffix = si_selectedTicks.size > 0 ? ` · ${[...si_selectedTicks].join(', ')}` : '';
  if (title) title.textContent = `${labels[si_filter] || si_filter}${tickSuffix} — ${filtered.length} signal${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="si-empty">
        <div class="si-empty-icon">⚡</div>
        <div class="si-empty-title">No signals found</div>
        <div class="si-empty-sub">Click ↺ Crawl Now to fetch the latest news and run AI analysis.</div>
      </div>`;
    return;
  }
  grid.innerHTML = filtered.map(si_renderCard).join('');
}

function si_renderCard(s) {
  const ws        = new Set(si_watchlist.map(t => t.toUpperCase()));
  const isNew     = si_newIds.has(s.id);
  const isWatched = ws.has(s.ticker);
  const voted     = si_voted.has(s.id);

  const cc = s.direction?.includes('BULLISH') ? 'bullish'
           : s.direction?.includes('BEARISH') ? 'bearish'
           : s.direction === 'MIXED'          ? 'mixed'
           : 'neutral';

  const dirArrow = cc === 'bullish' ? '▲' : cc === 'bearish' ? '▼' : cc === 'mixed' ? '◆' : '–';
  const dirShort = s.direction?.replace('_SHORT_TERM','·S').replace('_LONG_TERM','·L') || 'NEUTRAL';
  const urgency  = s.urgency || 'background';
  const confPct  = Math.round((s.confidence || 0) * 100);

  const facts = (s.key_facts || []).map(f => `<li>${si_esc(f)}</li>`).join('');
  const risks = (s.counter_signals || []);
  const riskHtml = risks.length > 0 ? `
    <div class="si-risk-block">
      <div class="si-risk-label">⚠ Risk Factors</div>
      <div class="si-risk-text">${risks.map(si_esc).join(' · ')}</div>
    </div>` : '';

  const affected = (s.affected_tickers || []).filter(t => t !== s.ticker).slice(0, 3);
  const affHtml  = affected.length
    ? `<div class="si-affected">${affected.map(t => `<span class="si-aff-tick">+${t}</span>`).join('')}</div>`
    : '';

  return `
    <div class="si-card ${cc}">
      <div class="si-card-accent"></div>
      <div class="si-card-top">
        <div class="si-card-top-left">
          <div class="si-card-row1">
            <span class="si-ticker ${isWatched ? 'watched' : ''}">${si_esc(s.ticker)}</span>
            ${isWatched ? '<span class="si-watch-star">★ WATCH</span>' : ''}
            ${isNew     ? '<span class="si-new-badge">NEW</span>' : ''}
            <span class="si-dir-badge">${dirArrow} ${si_esc(dirShort)}</span>
            <span class="si-urgency-badge ${urgency}">${urgency.replace('_',' ').toUpperCase()}</span>
          </div>
        </div>
        <div class="si-card-time-col">
          <span class="si-card-time">${s.age || ''}</span>
          ${affHtml}
        </div>
      </div>
      <div class="si-card-headline">${si_esc(s.headline || '')}</div>
      <div class="si-card-meta">
        <div class="si-conf-wrap">
          <div>
            <div class="si-conf-num">${confPct}%</div>
            <div class="si-conf-label">Confidence</div>
          </div>
          <div class="si-conf-track">
            <div class="si-conf-fill" style="width:${confPct}%"></div>
          </div>
        </div>
        ${s.catalyst_type ? `<span class="si-catalyst-chip">${si_esc(s.catalyst_type)}</span>` : ''}
      </div>
      <div class="si-card-divider"></div>
      <div class="si-card-body">
        ${s.reasoning ? `<p class="si-reasoning">${si_esc(s.reasoning)}</p>` : ''}
        ${facts ? `<div class="si-facts-label">Key Facts</div><ul class="si-key-facts">${facts}</ul>` : ''}
        ${riskHtml}
      </div>
      <div class="si-card-footer">
        ${s.time_horizon ? `<span class="si-horizon-tag">⏱ ${si_esc(s.time_horizon)}</span>` : ''}
        ${s.source_count ? `<span class="si-src-tag">${s.source_count} src</span>` : ''}
        <div class="si-fb-wrap">
          <button class="si-fb-btn up ${voted?'voted':''}" onclick="si_feedback('${s.id}',true,this.parentNode)" title="Correct">👍</button>
          <button class="si-fb-btn down ${voted?'voted':''}" onclick="si_feedback('${s.id}',false,this.parentNode)" title="Wrong">👎</button>
        </div>
      </div>
    </div>`;
}

// ── Refresh ───────────────────────────────────────────────────────────────────

async function si_refresh(showLoader) {
  if (showLoader) {
    const lb = document.getElementById('si-loadingBar');
    if (lb) lb.style.display = 'block';
  }
  try {
    const [signals, status] = await Promise.all([si_fetchSignals(), si_fetchStatus()]);
    si_setOffline(false);

    si_newIds = new Set(signals.filter(s => s.created_at > si_lastVisitAt).map(s => s.id));
    const nc = document.getElementById('si-newCount');
    if (nc) {
      nc.textContent = si_newIds.size > 0 ? si_newIds.size : '';
      nc.style.display = si_newIds.size > 0 ? 'inline' : 'none';
    }

    si_signals = signals;
    si_updateStatus(status);
    si_buildTickerFilter(si_signals);
    si_renderSignals(si_signals);
  } catch (err) {
    si_setOffline(true);
    const grid = document.getElementById('si-grid');
    if (grid) grid.innerHTML = `
      <div class="si-empty">
        <div class="si-empty-icon">🔌</div>
        <div class="si-empty-title">Signal Intel server offline</div>
        <div class="si-empty-sub">Start the server: <code style="font-family:monospace;background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:4px">cd signal-intel && ./start.sh</code></div>
      </div>`;
  } finally {
    const lb = document.getElementById('si-loadingBar');
    if (lb) lb.style.display = 'none';
  }
}

async function si_triggerCrawl() {
  const btn = document.getElementById('si-crawlBtn');
  if (btn) { btn.disabled = true; btn.textContent = '↺ Starting…'; }
  try {
    await si_fetch('/api/crawl', { method: 'POST' });
    let polls = 0;
    const poll = setInterval(async () => {
      try {
        const status = await si_fetchStatus();
        si_updateStatus(status);
        if (status.status === 'idle' || polls++ > 30) {
          clearInterval(poll);
          localStorage.setItem(SI_LAST_VISIT_KEY, new Date().toISOString());
          si_refresh(true);
        }
      } catch { clearInterval(poll); }
    }, 2000);
  } catch (err) {
    console.error('[SignalIntel] crawl trigger failed:', err.message);
    if (btn) { btn.disabled = false; btn.textContent = '↺ Crawl Now'; }
  }
}

// ── Feedback ──────────────────────────────────────────────────────────────────

async function si_feedback(id, wasCorrect, container) {
  try {
    await si_fetch(`/api/feedback/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wasCorrect }),
    });
    si_voted.add(id);
    localStorage.setItem('si_voted', JSON.stringify([...si_voted]));
    container.querySelectorAll('.si-fb-btn').forEach(b => b.classList.add('voted'));
  } catch(e) { console.error(e); }
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

function si_openWatchlist() {
  const inp = document.getElementById('si-watchlistInput');
  if (inp) inp.value = si_watchlist.join('\n');
  document.getElementById('si-watchlistModal').classList.add('open');
}
function si_closeWatchlist(e) {
  if (!e || e.target === document.getElementById('si-watchlistModal'))
    document.getElementById('si-watchlistModal').classList.remove('open');
}
async function si_saveWatchlist() {
  const tickers = document.getElementById('si-watchlistInput').value
    .split(/[\n,]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
  try {
    await si_fetch('/api/config/watchlist', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watchlist: tickers }),
    });
    si_watchlist = tickers;
  } catch(e) { console.error(e); }
  si_closeWatchlist();
  si_renderSignals(si_signals);
}

// ── SSE ───────────────────────────────────────────────────────────────────────

function si_connectSSE() {
  if (si_sse) { try { si_sse.close(); } catch{} si_sse = null; }
  try {
    si_sse = new EventSource(`${SI_API}/api/events`);
    si_sse.addEventListener('signal', () => si_refresh(false));
    si_sse.addEventListener('ticker_start', e => {
      const { ticker } = JSON.parse(e.data);
      const lbl = document.getElementById('si-statusLabel');
      if (lbl) lbl.textContent = `Analyzing ${ticker}…`;
    });
    si_sse.onerror = () => {
      si_sse.close(); si_sse = null;
      setTimeout(si_connectSSE, 5000);
    };
  } catch { /* server offline */ }
}

function si_disconnectSSE() {
  if (si_sse) { try { si_sse.close(); } catch{} si_sse = null; }
  if (si_pollTimer) { clearInterval(si_pollTimer); si_pollTimer = null; }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function initSignalIntelView() {
  if (!si_initialized) {
    si_initialized = true;

    // Shift+click for multi-ticker select
    window._si_shiftHeld = false;
    window.addEventListener('keydown', e => { if (e.key === 'Shift') window._si_shiftHeld = true; });
    window.addEventListener('keyup',   e => { if (e.key === 'Shift') window._si_shiftHeld = false; });
    window.addEventListener('beforeunload', () => {
      localStorage.setItem(SI_LAST_VISIT_KEY, new Date().toISOString());
    });
  }

  if (si_pollTimer) { clearInterval(si_pollTimer); si_pollTimer = null; }
  si_refresh(true);
  si_fetchModels();
  si_connectSSE();
  si_pollTimer = setInterval(() => si_refresh(false), 60000);
}

function cleanupSignalIntelView() {
  localStorage.setItem(SI_LAST_VISIT_KEY, new Date().toISOString());
  si_disconnectSSE();
  if (si_pollTimer) { clearInterval(si_pollTimer); si_pollTimer = null; }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function si_esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function si_timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}
