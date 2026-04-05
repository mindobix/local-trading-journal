// ─── MACRO NEWS MODULE ───────────────────────────────────────────────────────
// Connects to the news-crawler server running at http://localhost:3737
// If the app is opened via the server itself, relative URLs are used automatically.

const NEWS_API  = 'http://localhost:3737/api';
const NEWS_POLL = 30000; // 30s UI poll interval

// ─── localStorage keys ────────────────────────────────────────────────────────
const NEWS_CONFIG_LS_KEY   = 'ltj_news_config';
const NEWS_TAXONOMY_LS_KEY = 'ltj_news_taxonomy';

// Tabs that are always present, always first, and cannot be deleted.
const PINNED_SYMS = ['MARKET', 'SPX', 'SPY', 'QQQ'];

function _lsGetNewsConfig()   { try { return JSON.parse(localStorage.getItem(NEWS_CONFIG_LS_KEY));   } catch { return null; } }
function _lsGetNewsTaxonomy() { try { return JSON.parse(localStorage.getItem(NEWS_TAXONOMY_LS_KEY)); } catch { return null; } }
function _lsSaveNewsConfig(cfg)  { try { localStorage.setItem(NEWS_CONFIG_LS_KEY,   JSON.stringify(cfg));  } catch {} }
function _lsSaveNewsTaxonomy(tx) { try { localStorage.setItem(NEWS_TAXONOMY_LS_KEY, JSON.stringify(tx));   } catch {} }

// ─── Public helpers for backup/restore ───────────────────────────────────────
function getNewsConfigForBackup()   { return _news.config   || _lsGetNewsConfig();   }
function getTaxonomyForBackup()     { return _news.taxonomy || _lsGetNewsTaxonomy(); }

async function restoreNewsConfig(cfg) {
  if (!cfg) return;
  _lsSaveNewsConfig(cfg);
  _news.config = cfg;
  try {
    await fetch(`${NEWS_API}/news/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg)
    });
  } catch { /* server may be offline — localStorage already updated */ }
  _renderSymbolTabs();
}

async function restoreNewsTaxonomy(tx) {
  if (!tx) return;
  _lsSaveNewsTaxonomy(tx);
  _news.taxonomy = tx;
  try {
    await fetch(`${NEWS_API}/news/taxonomy`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tx)
    });
  } catch { /* server may be offline — localStorage already updated */ }
}

const _news = {
  articles:         [],
  articlesById:     {},
  config:           null,
  lastUpdated:      null,
  activeSymbol:     'MARKET',
  serverOnline:     false,
  pollTimer:        null,
  crawling:         false,
  editingId:        null,
  addingFeedFor:    null,
  activeArticleId:  null,
  report:           null,         // latest report for activeSymbol
  reportsAvailable: new Set(),   // symbols with a completed report
  reportsRunning:   new Set(),   // symbols whose report worker is currently running
  reportSignalMap:  new Map(),   // articleId → topSignal entry for active symbol's report
  statusPollTimer:  null,
  taxonomy:         null,
};


// ─── PUBLIC: called from switchView('news') ───────────────────────────────────
async function initNewsView() {
  renderNewsShell();
  await Promise.all([loadNewsConfig(), loadNews(), _loadTaxonomy()]);
  _loadReport(_news.activeSymbol);
  _startStatusPoll();
  _startNewsPoll();
}

function cleanupNewsView() {
  if (_news.pollTimer)       { clearInterval(_news.pollTimer);       _news.pollTimer       = null; }
  if (_news.statusPollTimer) { clearInterval(_news.statusPollTimer); _news.statusPollTimer = null; }
}

// ─── POLLING ─────────────────────────────────────────────────────────────────
function _startNewsPoll() {
  if (_news.pollTimer) clearInterval(_news.pollTimer);
  _news.pollTimer = setInterval(() => {
    const v = document.getElementById('view-news');
    if (v && v.style.display !== 'none') loadNews();
  }, NEWS_POLL);
}

// ─── TAXONOMY ────────────────────────────────────────────────────────────────
async function _loadTaxonomy() {
  try {
    const r = await fetch(`${NEWS_API}/news/taxonomy`);
    if (!r.ok) throw new Error();
    _news.taxonomy = await r.json();
    _lsSaveNewsTaxonomy(_news.taxonomy);      // keep localStorage in sync
  } catch {
    _news.taxonomy = _lsGetNewsTaxonomy();    // fall back to cached copy
  }
}

// ─── REPORT ──────────────────────────────────────────────────────────────────
async function _loadReport(symbol) {
  if (!symbol) { _news.report = null; _updateReportSignalMap(); _renderReportPanel(); return; }
  try {
    const r = await fetch(`${NEWS_API}/news/report/${encodeURIComponent(symbol)}`);
    _news.report = r.ok ? await r.json() : null;
  } catch {
    _news.report = null;
  }
  _updateReportSignalMap();
  if (_news.report) {
    _news.reportsAvailable.add(symbol);
    _renderSymbolTabs();
    _renderFeed();   // refresh cards so signal pills appear immediately
  }
  _renderReportPanel();
}

// Build a fast lookup Map from articleId → topSignal entry for the active report.
function _updateReportSignalMap() {
  const signals = _news.report?.topSignals || [];
  _news.reportSignalMap = new Map(signals.map(s => [s.id, s]));
}

// ─── CONTINUOUS REPORT STATUS POLL ───────────────────────────────────────────
// Polls /api/news/reports/status every 3 s.
// • running → blinking yellow dot on tab
// • done    → solid green dot; auto-loads report if it's the active symbol
// This replaces the old manual triggerReport / _prefetchReportStatus flow.

const STATUS_POLL_MS = 3000;

function _startStatusPoll() {
  if (_news.statusPollTimer) clearInterval(_news.statusPollTimer);
  _checkReportStatuses();   // immediate first check
  _news.statusPollTimer = setInterval(_checkReportStatuses, STATUS_POLL_MS);
}

async function _checkReportStatuses() {
  // Guard: don't run if the News view is hidden
  const view = document.getElementById('view-news');
  if (!view || view.style.display === 'none') return;

  try {
    const r = await fetch(`${NEWS_API}/news/reports/status`);
    if (!r.ok) return;
    const statuses = await r.json();   // { TSLA: { status }, SPY: { status }, … }

    let tabsChanged = false;

    for (const [sym, { status }] of Object.entries(statuses)) {
      const wasRunning = _news.reportsRunning.has(sym);
      const hadReport  = _news.reportsAvailable.has(sym);

      if (status === 'running') {
        if (!wasRunning) { _news.reportsRunning.add(sym); tabsChanged = true; }

      } else if (status === 'done') {
        const justFinished = wasRunning || !hadReport;
        _news.reportsRunning.delete(sym);
        _news.reportsAvailable.add(sym);
        if (justFinished) {
          tabsChanged = true;
          // Auto-reload report + signal pills if this is the active tab
          if (sym === _news.activeSymbol) await _loadReport(sym);
        }

      } else if (status === 'error') {
        if (wasRunning) { _news.reportsRunning.delete(sym); tabsChanged = true; }
      }
    }

    if (tabsChanged) _renderSymbolTabs();
  } catch { /* server offline — silent */ }
}

function _renderReportPanel() {
  const el   = document.getElementById('news-report-panel');
  const body = document.getElementById('news-body');
  if (!el) return;

  const sym = _news.activeSymbol;
  if (!sym) {
    el.innerHTML = '';
    body?.classList.remove('signal-visible');
    return;
  }

  body?.classList.add('signal-visible');

  const isRunning = _news.reportsRunning.has(sym);
  const report    = _news.report;

  // Show stale report content while a fresh one is generating (if we have one),
  // or a minimal loading strip if there's nothing yet.
  const loadingBanner = isRunning ? `
    <div class="nrp-live-banner">
      <span class="nrp-spinner"></span> Analysing new articles…
    </div>` : '';

  if (!report) {
    el.innerHTML = `<div class="nrp-wrap nrp-empty">
      <div class="nrp-empty-icon">📊</div>
      <div class="nrp-label">Waiting for articles…</div>
      <div class="nrp-empty-sub">Signal analysis runs automatically when new articles arrive${isRunning ? ' — running now' : ''}.</div>
      ${isRunning ? `<div class="nrp-loading-row"><span class="nrp-spinner"></span> Analysing…</div>` : ''}
    </div>`;
    return;
  }

  const sentimentClass = { bullish: 'nrp-bull', bearish: 'nrp-bear', mixed: 'nrp-mix', neutral: 'nrp-neu' }[report.sentiment] || 'nrp-neu';
  const sentimentIcon  = { bullish: '▲', bearish: '▼', mixed: '◆', neutral: '─' }[report.sentiment] || '─';
  const age = _timeAgo(report.generatedAt);

  const storiesHTML = (report.clusters || []).slice(0, 5).map(c => {
    const rep = c.representative;
    const dupeLabel  = c.duplicates?.length ? `<span class="nrp-dupes">+${c.duplicates.length} similar</span>` : '';
    const score      = rep.score ? `<span class="nrp-score">${Math.round(rep.score * 100)}%</span>` : '';
    const pillsHTML  = (rep.categoryMatches || (rep.matchedCategory ? [{ category: rep.matchedCategory }] : []))
      .map(m => `<span class="nrp-cat-pill" style="${_catPillStyle(m.category)}" title="${_esc(m.signal || '')}">${_esc(m.category)}</span>`)
      .join('');
    return `
      <div class="nrp-story" onclick="_openArticle('${_esc(rep.id)}')">
        <div class="nrp-story-meta">
          ${score}${dupeLabel}<span class="nrp-story-src">${_esc(rep.source)}</span>
        </div>
        <div class="nrp-story-title">${_esc(rep.title)}</div>
        ${pillsHTML ? `<div class="nrp-cat-pills">${pillsHTML}</div>` : ''}
        ${rep.summary ? `<div class="nrp-story-summary">${_esc(rep.summary)}</div>` : ''}
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="nrp-wrap">
      ${loadingBanner}
      <div class="nrp-hdr-row">
        <span class="nrp-sym-badge" style="background:${_symColor(sym)}">${_esc(sym)}</span>
        <span class="nrp-title">Signal Report</span>
        <span class="nrp-age">${_esc(age)}</span>
      </div>
      <div class="nrp-sentiment-block ${sentimentClass}">
        <span class="nrp-sent-icon">${sentimentIcon}</span>
        <span class="nrp-sent-label">${report.sentiment}</span>
      </div>
      <div class="nrp-stats-row">
        <div class="nrp-stat"><span class="nrp-stat-val">${report.signalCount ?? 0}</span><span class="nrp-stat-lbl">signal</span></div>
        <div class="nrp-stat"><span class="nrp-stat-val">${report.noiseCount ?? 0}</span><span class="nrp-stat-lbl">noise</span></div>
        <div class="nrp-stat"><span class="nrp-stat-val">${report.clusters?.length ?? 0}</span><span class="nrp-stat-lbl">stories</span></div>
      </div>
      <div class="nrp-stories">
        ${storiesHTML || '<div class="nrp-no-stories">No high-signal articles in this window.</div>'}
      </div>
    </div>`;
}

// ─── DATA ─────────────────────────────────────────────────────────────────────
async function loadNewsConfig() {
  try {
    const r = await fetch(`${NEWS_API}/news/config`);
    if (!r.ok) throw new Error();
    _news.config = await r.json();
    _lsSaveNewsConfig(_news.config);          // keep localStorage in sync (includes configVersion)
  } catch {
    // Fall back to localStorage with version-aware migration, then hardcoded default
    _news.config = _lsGetNewsConfigWithMigration()
      || { configVersion: CLIENT_CONFIG_VERSION, symbols: ['TSLA','SPY','QQQ','MU','META'], sources: [...CLIENT_DEFAULT_SOURCES_V2] };
  }
  _renderSymbolTabs();
}

async function loadNews() {
  const sym = _news.activeSymbol;
  const qs  = `?symbol=${encodeURIComponent(sym)}&limit=300`;
  try {
    const r = await fetch(`${NEWS_API}/news${qs}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _news.articles     = data.articles || [];
    _news.articlesById = {};
    for (const a of _news.articles) _news.articlesById[a.id] = a;
    _news.lastUpdated  = data.lastUpdated;
    _news.serverOnline = true;
    _renderFeed();
    _updateStatus();
  } catch {
    _news.serverOnline = false;
    _renderOffline();
    _updateStatus();
  }
}

async function triggerManualCrawl() {
  if (_news.crawling) return;
  _news.crawling = true;
  const btn = document.getElementById('news-refresh-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = _spinSvg(); }

  try {
    const r = await fetch(`${NEWS_API}/news/crawl`, { method: 'POST' });
    if (!r.ok) throw new Error();
    await loadNews();
  } catch {
    _news.serverOnline = false;
    _renderOffline();
    _updateStatus();
  } finally {
    _news.crawling = false;
    if (btn) { btn.disabled = false; btn.innerHTML = _refreshSvg(); }
  }
}

async function retryNewsConnection() {
  await loadNewsConfig();
  await loadNews();
}

// ─── SHELL ────────────────────────────────────────────────────────────────────
function renderNewsShell() {
  const wrap = document.getElementById('view-news');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="news-layout">
      <div class="news-topbar">
        <div class="news-sym-tabs" id="news-sym-tabs"></div>
        <div class="news-topbar-right">
          <span class="news-status-dot" id="news-status-dot" title="Connecting..."></span>
          <span class="news-last-upd"   id="news-last-upd">Connecting…</span>
          <button class="news-icon-btn" id="news-refresh-btn"
                  onclick="triggerManualCrawl()" title="Crawl now">${_refreshSvg()}</button>
          <button class="news-icon-btn" onclick="openNewsSettings()" title="Configure sources">${_gearSvg()}</button>
        </div>
      </div>
      <div class="news-body" id="news-body">
        <div class="news-signal-col" id="news-report-panel"></div>
        <div class="news-feed-col">
          <div class="news-feed-wrap" id="news-feed-wrap">
            <div class="news-state-msg">
              <div class="nsm-icon">⏳</div>
              <div class="nsm-title">Loading macro news…</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Settings panel ── -->
    <div class="nws-overlay" id="nws-overlay" onclick="_nwsOverlayClick(event)">
      <div class="nws-panel" id="nws-panel">
        <div class="nws-hdr">
          <span class="nws-hdr-title">News Settings</span>
          <button class="nws-close-btn" onclick="closeNewsSettings()">&#10005;</button>
        </div>
        <div class="nws-body" id="nws-body"></div>
      </div>
    </div>`;
}

// ─── SYMBOL TABS ──────────────────────────────────────────────────────────────
function _renderSymbolTabs() {
  const el = document.getElementById('news-sym-tabs');
  if (!el) return;
  const userSyms = (_news.config?.symbols || []).filter(s => !PINNED_SYMS.includes(s));
  const syms = [...PINNED_SYMS, ...userSyms];
  el.innerHTML = syms.map(s => {
    const isRunning = _news.reportsRunning.has(s);
    const hasReport = _news.reportsAvailable.has(s);
    const dot = isRunning ? '<span class="nst-dot nst-dot-running"></span>'
              : hasReport ? '<span class="nst-dot"></span>'
              : '';
    return `<button class="news-sym-tab${s === _news.activeSymbol ? ' active' : ''}"
             onclick="_switchNewsSymbol('${_esc(s)}')">${dot}${_esc(s)}</button>`;
  }).join('');
}

function _switchNewsSymbol(sym) {
  _news.activeSymbol = sym;
  _news.report = null;
  _renderSymbolTabs();
  loadNews();
  _loadReport(sym);
}


// ─── FEED ─────────────────────────────────────────────────────────────────────
function _renderFeed() {
  const wrap = document.getElementById('news-feed-wrap');
  if (!wrap) return;

  const articles = _news.articles.filter(a => a.symbol === _news.activeSymbol);

  if (articles.length === 0) {
    wrap.classList.remove('nws-split-active');
    wrap.innerHTML = `
      <div class="news-state-msg">
        <div class="nsm-icon">📰</div>
        <div class="nsm-title">No articles found</div>
        <div class="nsm-sub">
          ${_news.serverOnline
            ? 'No articles yet. Click Refresh to crawl now.'
            : 'Cannot reach the news crawler. Start the server first.'}
        </div>
      </div>`;
    return;
  }

  const listHTML = `<div class="news-list">${articles.map(_articleCard).join('')}</div>`;

  // If split already rendered, just refresh the left panel in-place (preserves iframe)
  const leftPanel = document.getElementById('nws-feed-left');
  if (leftPanel) {
    leftPanel.innerHTML = listHTML;
    // Re-apply active highlight
    if (_news.activeArticleId) {
      const card = leftPanel.querySelector(`.news-card[data-id="${CSS.escape(_news.activeArticleId)}"]`);
      if (card) card.classList.add('active');
    }
    return;
  }

  // First render — build split layout
  wrap.classList.add('nws-split-active');
  wrap.innerHTML = `
    <div class="nws-split">
      <div class="nws-feed-left" id="nws-feed-left">${listHTML}</div>
      <div class="nws-feed-right" id="nws-feed-right">
        <div class="nws-iframe-placeholder">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3">
            <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
          <span>Select an article to read</span>
        </div>
      </div>
    </div>`;
}

function _articleCard(a) {
  const ago     = _timeAgo(a.publishedAt);
  const isToday = _isToday(a.publishedAt);
  const bg      = _symColor(a.symbol);
  const safeId  = _esc(a.id);
  const signal  = _news.reportSignalMap.get(a.id);
  const signalPill = signal
    ? `<span class="nc-signal-pill" title="${_esc(signal.matchedSignal || '')}">${_esc(signal.matchedCategory || 'Signal')} &middot; ${Math.round(signal.score * 100)}%</span>`
    : '';

  return `<article class="news-card${signal ? ' nc-is-signal' : ''}" data-id="${safeId}" onclick="_openArticle('${safeId}')">
    <div class="nc-meta">
      <span class="nc-sym" style="background:${bg}">${_esc(a.symbol)}</span>
      <span class="nc-src">${_esc(a.source)}</span>
      <span class="nc-time${isToday?' today':''}" title="${_esc(a.publishedAt)}">${ago}</span>
    </div>
    <div class="nc-title">${_esc(a.title)}</div>
    ${a.description ? `<div class="nc-desc">${_esc(a.description)}</div>` : ''}
    ${signalPill}
  </article>`;
}

// ─── IN-APP ARTICLE READER (Readability split) ───────────────────────────────
async function _openArticle(id) {
  const a = _news.articlesById[id];
  if (!a) return;

  _news.activeArticleId = id;

  // Highlight active card
  document.querySelectorAll('.news-card').forEach(c => c.classList.remove('active'));
  const card = document.querySelector(`.news-card[data-id="${CSS.escape(id)}"]`);
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  const right = document.getElementById('nws-feed-right');
  if (!right) return;

  // Show skeleton while loading
  right.innerHTML = _readerShell(a, null);

  try {
    // 1. Try cached extraction first
    let data = null;
    const r1 = await fetch(`${NEWS_API}/news/article?id=${encodeURIComponent(id)}`);

    if (r1.ok) {
      data = await r1.json();
    } else if (r1.status === 202) {
      // Not cached yet — run on-demand extraction
      _setReaderStatus(right, 'Extracting article…');
      const r2 = await fetch(`${NEWS_API}/news/article?url=${encodeURIComponent(a.url)}`);
      if (r2.ok) data = await r2.json();
    }

    if (data && data.content) {
      right.innerHTML = _readerShell(a, data);
    } else {
      right.innerHTML = _readerFallback(a);
    }
  } catch {
    right.innerHTML = _readerFallback(a);
  }
}

function _setReaderStatus(right, msg) {
  const el = right.querySelector('.nwr-status');
  if (el) el.textContent = msg;
}

function _readerShell(a, data) {
  const ago     = _timeAgo(a.publishedAt);
  const bg      = _symColor(a.symbol);
  const safeUrl = _esc(a.url);

  const bylineHtml = data?.byline
    ? `<div class="nwr-byline">${_esc(data.byline)}</div>` : '';

  const metaDate = data?.publishedTime
    ? `<span title="${_esc(data.publishedTime)}">${ago}</span>`
    : `<span>${ago}</span>`;

  const bodyHtml = data
    ? (data.content
        ? `<div class="nwr-article-body">${data.content}</div>`
        : `<div class="nwr-no-content">
             <p>No readable content could be extracted from this article.</p>
             <a href="${safeUrl}" target="_blank" rel="noopener" class="nwr-ext-btn">
               Read on ${_esc(a.source)} ↗
             </a>
           </div>`)
    : `<div class="nwr-skeleton-body">
         <div class="nwr-status">Loading…</div>
         <div class="nwr-skeleton nwr-sk-lg"></div>
         <div class="nwr-skeleton nwr-sk-md"></div>
         <div class="nwr-skeleton nwr-sk-sm"></div>
         <div class="nwr-skeleton nwr-sk-lg"></div>
         <div class="nwr-skeleton nwr-sk-md"></div>
       </div>`;

  return `
    <div class="nwr-wrap">
      <div class="nwr-topbar">
        <div class="nwr-source-row">
          <span class="nwr-sym-badge" style="background:${bg}">${_esc(a.symbol)}</span>
          <span class="nwr-source-name">${_esc(data?.siteName || a.source)}</span>
          <span class="nwr-pub-time">${metaDate}</span>
        </div>
        <a class="nwr-open-ext" href="${safeUrl}" target="_blank" rel="noopener">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          Open original
        </a>
      </div>
      <div class="nwr-scroll">
        <div class="nwr-content">
          <h1 class="nwr-title">${_esc(a.title)}</h1>
          ${bylineHtml}
          ${bodyHtml}
        </div>
      </div>
    </div>`;
}

function _readerFallback(a) {
  const safeUrl = _esc(a.url);
  return `
    <div class="nwr-wrap">
      <div class="nwr-topbar">
        <div class="nwr-source-row">
          <span class="nwr-sym-badge" style="background:${_symColor(a.symbol)}">${_esc(a.symbol)}</span>
          <span class="nwr-source-name">${_esc(a.source)}</span>
        </div>
        <a class="nwr-open-ext" href="${safeUrl}" target="_blank" rel="noopener">Open original</a>
      </div>
      <div class="nwr-scroll">
        <div class="nwr-content">
          <h1 class="nwr-title">${_esc(a.title)}</h1>
          <div class="nwr-no-content">
            <p>Could not load article content.</p>
            <a href="${safeUrl}" target="_blank" rel="noopener" class="nwr-ext-btn">
              Read on ${_esc(a.source)} ↗
            </a>
          </div>
        </div>
      </div>
    </div>`;
}

// ─── OFFLINE STATE ───────────────────────────────────────────────────────────
function _renderOffline() {
  const wrap = document.getElementById('news-feed-wrap');
  if (!wrap) return;
  wrap.classList.remove('nws-split-active');
  wrap.innerHTML = `
    <div class="news-state-msg news-offline">
      <div class="nsm-icon">⚡</div>
      <div class="nsm-title">News Crawler Offline</div>
      <div class="nsm-sub">The crawler service is not running on port 3737.</div>
      <div class="news-cmd-block">
        <p>Open a terminal and run:</p>
        <code>cd ~/Desktop/local-web-apps/local-trading-journal/news-crawler</code>
        <code>npm install &amp;&amp; npm start</code>
        <p style="margin-top:10px">Or double-click <strong>start.sh</strong> in that folder.</p>
      </div>
      <button class="news-retry-btn" onclick="retryNewsConnection()">&#8635; Retry</button>
    </div>`;
}

// ─── STATUS BAR ──────────────────────────────────────────────────────────────
function _updateStatus() {
  const dot = document.getElementById('news-status-dot');
  const lbl = document.getElementById('news-last-upd');

  if (dot) {
    dot.className = 'news-status-dot ' + (_news.serverOnline ? 'online' : 'offline');
    dot.title = _news.serverOnline ? 'Connected to crawler' : 'Crawler offline';
  }
  if (lbl) {
    lbl.textContent = _news.lastUpdated
      ? `Updated ${_timeAgo(_news.lastUpdated)}`
      : (_news.serverOnline ? 'No crawl yet' : 'Offline');
    if (_news.lastUpdated) lbl.title = new Date(_news.lastUpdated).toLocaleString();
  }
}

// ─── SETTINGS PANEL ──────────────────────────────────────────────────────────
function openNewsSettings() {
  const overlay = document.getElementById('nws-overlay');
  const body    = document.getElementById('nws-body');
  if (!overlay || !body) return;
  body.innerHTML = _settingsHTML();
  overlay.classList.add('open');
}

function closeNewsSettings() {
  const overlay = document.getElementById('nws-overlay');
  if (overlay) overlay.classList.remove('open');
}

function _nwsOverlayClick(e) {
  if (e.target === document.getElementById('nws-overlay')) closeNewsSettings();
}

// ─── SETTINGS HELPERS ────────────────────────────────────────────────────────

function _typeBadge(type) {
  const map = {
    rss:  { label: 'RSS',  cls: 'nws-badge-rss'  },
    atom: { label: 'RSS',  cls: 'nws-badge-rss'  },
    html: { label: 'HTML', cls: 'nws-badge-html' },
  };
  const t = map[type] || { label: 'RSS', cls: 'nws-badge-rss' };
  return `<span class="nws-type-badge ${t.cls}">${t.label}</span>`;
}

// Returns sources grouped by symbol, preserving tracked-symbol order
function _srcsBySymbol() {
  const cfg  = _news.config || { symbols: [], sources: [] };
  const userSyms = (cfg.symbols || []).filter(s => !PINNED_SYMS.includes(s));
  const syms = [...PINNED_SYMS, ...userSyms];
  const groups = {};
  for (const sym of syms) groups[sym] = [];
  for (const src of cfg.sources || []) {
    const sym = src.symbol || 'MARKET';
    if (!groups[sym]) groups[sym] = [];
    groups[sym].push(src);
  }
  return groups;
}

// Normal source row (or inline edit form if this source is being edited)
function _srcRowHTML(s) {
  if (_news.editingId === s.id) return _srcEditFormHTML(s);
  const dim = s.enabled === false ? ' nws-src-row--dim' : '';
  return `
    <div class="nws-src-row${dim}" id="nwsr-${_esc(s.id)}">
      <label class="nws-toggle">
        <input type="checkbox" ${s.enabled !== false ? 'checked' : ''}
               onchange="_toggleSource('${_esc(s.id)}',this.checked)">
        <span class="nws-toggle-track"><span class="nws-toggle-thumb"></span></span>
      </label>
      <div class="nws-src-info">
        <div class="nws-src-name-row">
          ${_typeBadge(s.type)}
          <span class="nws-src-name">${_esc(s.name)}</span>
        </div>
        <div class="nws-src-url" title="${_esc(s.url)}">${_esc(s.url)}</div>
      </div>
      <button class="nws-src-edit-btn" onclick="_startEditSource('${_esc(s.id)}')" title="Edit">
        ${_pencilSvg()}
      </button>
      <button class="nws-src-del" onclick="_removeSource('${_esc(s.id)}')" title="Remove">×</button>
    </div>`;
}

// Inline edit form replacing a source row
function _srcEditFormHTML(s) {
  const typeOpts = [['rss','RSS / Atom Feed'],['html','HTML Scraper']]
    .map(([v,l]) => `<option value="${v}"${s.type===v?' selected':''}>${l}</option>`).join('');
  return `
    <div class="nws-src-edit-box" id="nwsr-${_esc(s.id)}">
      <div class="nws-src-edit-row">
        <input class="nws-inp" id="se-name-${_esc(s.id)}" value="${_esc(s.name)}" placeholder="Source name">
        <select class="nws-sel nws-sel-sm" id="se-type-${_esc(s.id)}">${typeOpts}</select>
      </div>
      <div class="nws-src-edit-row">
        <input class="nws-inp nws-inp-full" id="se-url-${_esc(s.id)}" value="${_esc(s.url)}" placeholder="Feed URL">
      </div>
      <div class="nws-src-edit-actions">
        <button class="nws-save-btn"   onclick="_saveSourceEdit('${_esc(s.id)}')">Save</button>
        <button class="nws-cancel-btn" onclick="_cancelEditSource()">Cancel</button>
      </div>
    </div>`;
}

// One ticker group block
function _tickerGroupHTML(sym, sources) {
  const activeCount = sources.filter(s => s.enabled !== false).length;
  const isMarket    = PINNED_SYMS.includes(sym);
  const isAdding    = _news.addingFeedFor === sym;
  const placeholder = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${sym}&region=US&lang=en-US`;

  return `
    <div class="nws-ticker-group">
      <div class="nws-ticker-hdr">
        <span class="nws-ticker-sym" style="background:${_symColor(sym)}">${_esc(sym)}</span>
        <span class="nws-ticker-meta">${sources.length} feed${sources.length!==1?'s':''} · ${activeCount} active</span>
        ${!isMarket ? `<button class="nws-ticker-del" onclick="_removeSymbol('${_esc(sym)}')" title="Remove symbol and all feeds">×</button>` : ''}
      </div>
      <div class="nws-ticker-sources">
        ${sources.map(s => _srcRowHTML(s)).join('')}
        ${sources.length === 0 ? `<div class="nws-no-feeds">No feeds — add one below</div>` : ''}
      </div>
      ${isAdding ? `
        <div class="nws-add-feed-form">
          <div class="nws-src-edit-row">
            <input class="nws-inp" id="af-name-${_esc(sym)}" placeholder="Name (e.g. Finviz)">
            <select class="nws-sel nws-sel-sm" id="af-type-${_esc(sym)}">
              <option value="rss">RSS</option>
              <option value="html">HTML</option>
            </select>
          </div>
          <div class="nws-src-edit-row">
            <input class="nws-inp nws-inp-full" id="af-url-${_esc(sym)}"
                   placeholder="${_esc(placeholder)}">
          </div>
          <div class="nws-src-edit-actions">
            <button class="nws-save-btn"   onclick="_commitAddFeed('${_esc(sym)}')">Add</button>
            <button class="nws-cancel-btn" onclick="_cancelAddFeed()">Cancel</button>
          </div>
        </div>` : `
        <button class="nws-add-feed-btn" onclick="_startAddFeed('${_esc(sym)}')">+ Add feed</button>`}
    </div>`;
}

// ─── TAXONOMY EDITOR ─────────────────────────────────────────────────────────
function _taxonomyHTML() {
  const tx = _news.taxonomy;
  if (!tx) return `<div class="nws-tx-offline">Taxonomy unavailable — is the crawler server running?</div>`;

  const thresholdPct   = Math.round((tx.signalThreshold ?? 0.28) * 100);
  const dedupePct      = Math.round((tx.dedupeThreshold ?? 0.82) * 100);

  const categoriesHTML = (tx.categories || []).map(cat => `
    <div class="nws-tx-cat" id="nws-tx-cat-${_esc(cat.id)}">
      <div class="nws-tx-cat-hdr" style="${_catHdrStyle(cat.label)}">
        <label class="nws-toggle" title="${cat.enabled ? 'Enabled' : 'Disabled'}">
          <input type="checkbox" ${cat.enabled ? 'checked' : ''}
                 onchange="_txToggleCategory('${_esc(cat.id)}', this.checked)">
          <span class="nws-toggle-track"><span class="nws-toggle-thumb"></span></span>
        </label>
        <span class="nws-tx-cat-name nrp-cat-pill" style="${_catPillStyle(cat.label)}">${_esc(cat.label)}</span>
        <span class="nws-tx-cat-weight-wrap">
          weight <input class="nws-tx-weight-inp" type="number" min="0.1" max="2" step="0.05"
                        value="${cat.weight ?? 1.0}"
                        onchange="_txSetWeight('${_esc(cat.id)}', this.value)">
        </span>
      </div>
      <div class="nws-tx-signals">
        ${(cat.signals || []).map((sig, idx) => `
          <div class="nws-tx-sig-row">
            <span class="nws-tx-sig-text">${_esc(sig)}</span>
            <button class="nws-tx-sig-del" onclick="_txRemoveSignal('${_esc(cat.id)}', ${idx})" title="Remove">×</button>
          </div>`).join('')}
        <div class="nws-tx-sig-add-row">
          <input class="nws-inp nws-tx-sig-inp" id="nws-tx-new-sig-${_esc(cat.id)}"
                 placeholder="Add signal phrase…"
                 onkeydown="if(event.key==='Enter')_txAddSignal('${_esc(cat.id)}')">
          <button class="nws-add-btn" onclick="_txAddSignal('${_esc(cat.id)}')">+</button>
        </div>
      </div>
    </div>`).join('');

  return `
    <div class="nws-tx-thresholds">
      <label class="nws-tx-thresh-lbl">
        Signal threshold
        <span class="nws-tx-thresh-val" id="nws-tx-sig-val">${thresholdPct}%</span>
        <input type="range" min="10" max="70" step="1" value="${thresholdPct}"
               oninput="document.getElementById('nws-tx-sig-val').textContent=this.value+'%'"
               onchange="_txSetThreshold('signal', this.value)">
        <span class="nws-tx-thresh-hint">Higher = stricter filter</span>
      </label>
      <label class="nws-tx-thresh-lbl">
        Dedupe threshold
        <span class="nws-tx-thresh-val" id="nws-tx-dd-val">${dedupePct}%</span>
        <input type="range" min="50" max="99" step="1" value="${dedupePct}"
               oninput="document.getElementById('nws-tx-dd-val').textContent=this.value+'%'"
               onchange="_txSetThreshold('dedupe', this.value)">
        <span class="nws-tx-thresh-hint">Higher = less aggressive dedup</span>
      </label>
    </div>
    <div class="nws-tx-cats">${categoriesHTML}</div>
    <div class="nws-action-row" style="margin-top:10px">
      <button class="nws-act-btn nws-act-crawl" onclick="_txAddCategory()">+ Add Category</button>
    </div>`;
}

async function _txSave() {
  if (!_news.taxonomy) return;
  _lsSaveNewsTaxonomy(_news.taxonomy);
  try {
    await fetch(`${NEWS_API}/news/taxonomy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_news.taxonomy)
    });
  } catch { /* silent */ }
}

function _txToggleCategory(id, enabled) {
  const cat = _news.taxonomy?.categories?.find(c => c.id === id);
  if (cat) { cat.enabled = enabled; _txSave(); }
}

function _txSetWeight(id, val) {
  const cat = _news.taxonomy?.categories?.find(c => c.id === id);
  if (cat) { cat.weight = Math.max(0.1, Math.min(2, parseFloat(val) || 1)); _txSave(); }
}

function _txSetThreshold(type, val) {
  if (!_news.taxonomy) return;
  const v = parseInt(val) / 100;
  if (type === 'signal') _news.taxonomy.signalThreshold = v;
  else                   _news.taxonomy.dedupeThreshold = v;
  _txSave();
}

async function _txAddSignal(catId) {
  const inp = document.getElementById(`nws-tx-new-sig-${catId}`);
  const sig = inp?.value.trim();
  if (!sig) return;
  const cat = _news.taxonomy?.categories?.find(c => c.id === catId);
  if (cat) {
    cat.signals.push(sig);
    await _txSave();
    openNewsSettings();
  }
}

async function _txRemoveSignal(catId, idx) {
  const cat = _news.taxonomy?.categories?.find(c => c.id === catId);
  if (cat) {
    cat.signals.splice(idx, 1);
    await _txSave();
    openNewsSettings();
  }
}

async function _txAddCategory() {
  const label = prompt('New category name:');
  if (!label?.trim()) return;
  const id = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (!_news.taxonomy) return;
  _news.taxonomy.categories.push({ id, label: label.trim(), enabled: true, weight: 1.0, signals: [] });
  await _txSave();
  openNewsSettings();
}

// ─── MAIN SETTINGS HTML ───────────────────────────────────────────────────────
function _settingsHTML() {
  const groups = _srcsBySymbol();

  return `
    <div class="nws-section">
      <div class="nws-section-lbl">Symbols &amp; Feeds</div>
      ${Object.entries(groups).map(([sym, srcs]) => _tickerGroupHTML(sym, srcs)).join('')}
      <div class="nws-add-sym-row">
        <input class="nws-inp" id="nws-sym-inp" placeholder="Add symbol (e.g. NVDA)"
               onkeydown="if(event.key==='Enter')_addSymbol()">
        <button class="nws-add-btn" onclick="_addSymbol()">+ Symbol</button>
      </div>
    </div>

    <div class="nws-section">
      <div class="nws-section-lbl">Signal Taxonomy</div>
      ${_taxonomyHTML()}
    </div>

    <div class="nws-section">
      <div class="nws-section-lbl">Actions</div>
      <div class="nws-action-row">
        <button class="nws-act-btn nws-act-crawl" onclick="_saveAndCrawl()">Crawl Now</button>
        <button class="nws-act-btn nws-act-clear" onclick="_clearNews()">Clear Cache</button>
      </div>
      <div class="nws-action-row" style="margin-top:8px">
        <button class="nws-act-btn nws-act-reset" onclick="_resetToDefaults()">Reset to Defaults</button>
      </div>
    </div>`;
}

// ─── SETTINGS ACTIONS ────────────────────────────────────────────────────────

async function _addSymbol() {
  const inp = document.getElementById('nws-sym-inp');
  const sym = (inp?.value || '').trim().toUpperCase();
  if (!sym || !_news.config || PINNED_SYMS.includes(sym) || _news.config.symbols.includes(sym)) { if(inp) inp.value=''; return; }

  // Find the donor symbol: last tracked symbol that has feeds with its ticker in the URL
  const tracked = (_news.config.symbols || []).filter(s => !PINNED_SYMS.includes(s));
  let donorSym   = null;
  let donorFeeds = [];
  // Walk backwards to pick the most recently added symbol that has clonable feeds
  for (let i = tracked.length - 1; i >= 0; i--) {
    const candidate = tracked[i];
    const feeds = (_news.config.sources || []).filter(s =>
      s.symbol === candidate &&
      s.url?.toLowerCase().includes(candidate.toLowerCase())
    );
    if (feeds.length > 0) { donorSym = candidate; donorFeeds = feeds; break; }
  }

  // Clone donor feeds, substituting the symbol in id and url
  if (donorSym && donorFeeds.length > 0) {
    const re = new RegExp(donorSym, 'gi');
    const cloned = donorFeeds.map(f => ({
      ...f,
      id:     f.id.replace(re, sym.toLowerCase()),
      symbol: sym,
      url:    f.url.replace(re, sym),
    }));
    // Only add feeds whose id doesn't already exist
    const existingIds = new Set((_news.config.sources || []).map(s => s.id));
    for (const feed of cloned) {
      if (!existingIds.has(feed.id)) _news.config.sources.push(feed);
    }
  }

  _news.config.symbols.push(sym);
  await _saveConfig();
  _renderSymbolTabs();
  openNewsSettings();
  if (inp) inp.value = '';
}

async function _removeSymbol(sym) {
  if (!_news.config) return;
  _news.config.symbols  = _news.config.symbols.filter(s => s !== sym);
  _news.config.sources  = _news.config.sources.filter(s => s.symbol !== sym);
  await _saveConfig();
  _renderSymbolTabs();
  openNewsSettings();
}

async function _toggleSource(id, enabled) {
  const src = _news.config?.sources?.find(s => s.id === id);
  if (src) { src.enabled = enabled; await _saveConfig(); }
}

async function _removeSource(id) {
  if (!_news.config) return;
  _news.config.sources = _news.config.sources.filter(s => s.id !== id);
  await _saveConfig();
  openNewsSettings();
}

// Per-symbol "Add feed" form
function _startAddFeed(sym) {
  _news.addingFeedFor = sym;
  _news.editingId     = null;
  openNewsSettings();
}

function _cancelAddFeed() {
  _news.addingFeedFor = null;
  openNewsSettings();
}

async function _commitAddFeed(sym) {
  const name = document.getElementById(`af-name-${sym}`)?.value.trim();
  const type = document.getElementById(`af-type-${sym}`)?.value || 'rss';
  const url  = document.getElementById(`af-url-${sym}`)?.value.trim();
  if (!url) { alert('URL is required.'); return; }
  const autoName = name || _hostLabel(url);
  _news.config.sources.push({
    id: `custom-${Date.now()}`, name: autoName, symbol: sym, type, url, enabled: true
  });
  _news.addingFeedFor = null;
  await _saveConfig();
  openNewsSettings();
  triggerManualCrawl();
}

// Helper: guess a short display name from a URL hostname
function _hostLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.split('.')[0].replace(/^feeds?\./, '');
  } catch { return 'Custom Feed'; }
}

async function _saveAndCrawl() {
  await _saveConfig();
  closeNewsSettings();
  await triggerManualCrawl();
}

async function _clearNews() {
  if (!confirm('Clear all cached news articles?')) return;
  try {
    await fetch(`${NEWS_API}/news`, { method: 'DELETE' });
    _news.articles = [];
    _renderFeed();
    closeNewsSettings();
  } catch (err) { console.error(err); }
}

async function _saveConfig() {
  _lsSaveNewsConfig(_news.config);
  try {
    await fetch(`${NEWS_API}/news/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_news.config)
    });
  } catch (err) { console.warn('Config save error:', err.message); }
}

// ─── Source edit ──────────────────────────────────────────────────────────────
function _startEditSource(id) {
  _news.editingId = id;
  openNewsSettings();
}

function _cancelEditSource() {
  _news.editingId = null;
  openNewsSettings();
}

async function _saveSourceEdit(id) {
  const name = document.getElementById(`se-name-${id}`)?.value.trim();
  const type = document.getElementById(`se-type-${id}`)?.value;
  const url  = document.getElementById(`se-url-${id}`)?.value.trim();
  if (!url) { alert('URL is required.'); return; }

  const src = _news.config?.sources?.find(s => s.id === id);
  if (src) { src.name = name || _hostLabel(url); src.type = type; src.url = url; }

  _news.editingId = null;
  await _saveConfig();
  openNewsSettings();
}

// ─── Reset to defaults ────────────────────────────────────────────────────────
async function _resetToDefaults() {
  if (!confirm('Reset all sources to defaults? Your custom sources will be removed.')) return;
  try {
    const r = await fetch(`${NEWS_API}/news/config/reset`, { method: 'POST' });
    if (!r.ok) throw new Error();
    _news.config = await r.json().then(d => d.config || d);
    await loadNewsConfig();   // reload from server to get the fresh config
    _renderSymbolTabs();
    openNewsSettings();
  } catch (err) {
    console.error('Reset error:', err);
    alert('Could not reset — is the crawler server running?');
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function _timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d === 1) return 'yesterday';
  if (d < 7)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _isToday(iso) {
  if (!iso) return false;
  return new Date().toDateString() === new Date(iso).toDateString();
}

const _SYM_COLORS = {
  TSLA:'#e31937', SPY:'#1a6de0', QQQ:'#7c3aed', MU:'#0891b2',
  META:'#1877f2', NVDA:'#76b900', AAPL:'#555', MSFT:'#00a4ef',
  AMZN:'#ff9900', GOOGL:'#4285f4', MARKET:'#b45309',
};
function _symColor(sym) { return _SYM_COLORS[sym] || '#4f5d6e'; }

// Per-category pill colors — bg and text as inline style
const _CAT_PILL_STYLES = {
  'Earnings & Revenue':   'background:rgba(16,185,129,0.15);color:#059669;border:1px solid rgba(16,185,129,0.4)',
  'Analyst Actions':      'background:rgba(99,102,241,0.15);color:#6366f1;border:1px solid rgba(99,102,241,0.4)',
  'Corporate Events':     'background:rgba(245,158,11,0.15);color:#d97706;border:1px solid rgba(245,158,11,0.4)',
  'Regulatory & Legal':   'background:rgba(239,68,68,0.15); color:#dc2626;border:1px solid rgba(239,68,68,0.4)',
  'Macro Catalysts':      'background:rgba(14,165,233,0.15);color:#0284c7;border:1px solid rgba(14,165,233,0.4)',
  'Product & Operations': 'background:rgba(168,85,247,0.15);color:#9333ea;border:1px solid rgba(168,85,247,0.4)',
};
const _CAT_PILL_FALLBACK = 'background:rgba(100,116,139,0.15);color:#64748b;border:1px solid rgba(100,116,139,0.35)';
function _catPillStyle(category) {
  return _CAT_PILL_STYLES[category] || _CAT_PILL_FALLBACK;
}

// Extract just the background tint from the pill style for use as a subtle header bg
const _CAT_HDR_BG = {
  'Earnings & Revenue':   'background:rgba(16,185,129,0.07)',
  'Analyst Actions':      'background:rgba(99,102,241,0.07)',
  'Corporate Events':     'background:rgba(245,158,11,0.07)',
  'Regulatory & Legal':   'background:rgba(239,68,68,0.07)',
  'Macro Catalysts':      'background:rgba(14,165,233,0.07)',
  'Product & Operations': 'background:rgba(168,85,247,0.07)',
};
function _catHdrStyle(category) {
  return _CAT_HDR_BG[category] || '';
}

function _esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _refreshSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="23 4 23 10 17 10"/>
    <polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
  </svg>`;
}
function _spinSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
    style="animation:news-spin 1s linear infinite">
    <path d="M21 12a9 9 0 1 1-9-9"/>
  </svg>`;
}
function _pencilSvg() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>`;
}
function _gearSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06
             a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09
             A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83
             l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09
             A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83
             l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09
             a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83
             l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09
             a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>`;
}
