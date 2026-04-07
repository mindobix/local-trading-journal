// ─── MACRO NEWS MODULE ───────────────────────────────────────────────────────
// Connects to the news-crawler server running at http://localhost:3737
// If the app is opened via the server itself, relative URLs are used automatically.

const NEWS_API  = 'http://localhost:3737/api';
const NEWS_POLL = 30000; // 30s UI poll interval

// ─── localStorage keys ────────────────────────────────────────────────────────
const NEWS_CONFIG_LS_KEY   = 'ltj_news_config';
const NEWS_TAXONOMY_LS_KEY = 'ltj_news_taxonomy';
const LLM_QUERIES_LS_KEY    = 'ltj_llm_queries';    // [{ id, llm, llmOther, category, prompt, createdAt }]
const LLM_RESULTS_LS_KEY    = 'ltj_llm_results';    // { [id]: htmlString } — NOT in backup
const LLM_CATEGORIES_LS_KEY = 'ltj_llm_categories'; // [string] user-defined categories

// Tabs that are always present, always first, and cannot be deleted.
const PINNED_SYMS = ['MARKET', 'SPX', 'SPY', 'QQQ'];
// Only MARKET gets its own feed section; all others share the ticker feed template.
const MARKET_ONLY_SYMS = ['MARKET'];

function _lsGetNewsConfig()   { try { return JSON.parse(localStorage.getItem(NEWS_CONFIG_LS_KEY));   } catch { return null; } }
function _lsGetNewsTaxonomy() { try { return JSON.parse(localStorage.getItem(NEWS_TAXONOMY_LS_KEY)); } catch { return null; } }
function _lsSaveNewsConfig(cfg)  { try { localStorage.setItem(NEWS_CONFIG_LS_KEY,   JSON.stringify(cfg));  } catch {} }
function _lsSaveNewsTaxonomy(tx) { try { localStorage.setItem(NEWS_TAXONOMY_LS_KEY, JSON.stringify(tx));   } catch {} }

// ─── LLM storage helpers ──────────────────────────────────────────────────────
function _llmLoadQueries()     { try { return JSON.parse(localStorage.getItem(LLM_QUERIES_LS_KEY))    || []; } catch { return []; } }
function _llmLoadResults()     { try { return JSON.parse(localStorage.getItem(LLM_RESULTS_LS_KEY))    || {}; } catch { return {}; } }
function _llmLoadCategories()  { try { return JSON.parse(localStorage.getItem(LLM_CATEGORIES_LS_KEY)) || []; } catch { return []; } }
function _llmSaveQueries(q)    { try { localStorage.setItem(LLM_QUERIES_LS_KEY,    JSON.stringify(q)); } catch {} }
function _llmSaveResults(r)    { try { localStorage.setItem(LLM_RESULTS_LS_KEY,    JSON.stringify(r)); } catch {} }
function _llmSaveCategories(c) { try { localStorage.setItem(LLM_CATEGORIES_LS_KEY, JSON.stringify(c)); } catch {} }

// ─── Default prompts (seeded on first load) ───────────────────────────────────
const LLM_DEFAULT_PROMPTS = [
  {
    category: 'Trade Idea Generator',
    llm: 'Grok',
    prompt: 'Scan today\'s market and generate 5 high-probability trade setups for [insert stock/index/sector]. Include entry price, exit targets, stop-loss, and risk-to-reward ratio. Explain why each setup works based on technical and fundamental factors.',
  },
  {
    category: 'Automated Technical Analyst',
    llm: 'Grok',
    prompt: 'Analyze [insert stock/ticker] using daily and weekly charts. Break down support/resistance levels, trendlines, moving averages, and momentum indicators. Provide a step-by-step trading signal (Buy/Hold/Sell) with justification.',
  },
  {
    category: 'News-to-Trade Converter',
    llm: 'Grok',
    prompt: 'Summarize the latest news about [insert company/sector] and translate it into trading implications. Provide likely short-term and long-term effects, expected price movement range, and recommended positioning.',
  },
  {
    category: 'Strategy Backtester',
    llm: 'Grok',
    prompt: 'Backtest [insert trading strategy: e.g., moving average crossover, RSI divergence] on [insert stock/index] over the last [insert time period]. Present win rate, profit factor, max drawdown, and improvements to increase edge.',
  },
  {
    category: 'Fully Automated Trade Plan',
    llm: 'Grok',
    prompt: 'Design a daily trading plan for [insert market/asset]. Include pre-market scan, opening strategy, midday adjustments, and closing strategy. Deliver it as a time-stamped checklist I can follow like a professional trader.',
  },
  {
    category: 'Stock Move & X.com Sentiment',
    llm: 'Grok',
    prompt: 'Please provide for the following tickers stock move today and sentiment from x.com summary report for SPX, QQQ, TSLA, NVDA, MU, SNDK, META, AMZN, GOOG, AAPL, MSFT, PLTR, NFLX, [add more tickers here]',
  },
];

// ─── Public helpers for backup/restore ───────────────────────────────────────
function getNewsConfigForBackup()    { return _news.config   || _lsGetNewsConfig();   }
function getTaxonomyForBackup()      { return _news.taxonomy || _lsGetNewsTaxonomy(); }
function getLlmQueriesForBackup()    { return { queries: _llm.queries, categories: _llm.categories }; }
function restoreLlmQueries(data) {
  // Support both old format (plain array) and new format ({ queries, categories })
  const incoming         = Array.isArray(data) ? data : (data?.queries || []);
  const incomingCats     = Array.isArray(data?.categories) ? data.categories : [];

  // Merge prompts by id — backup wins on conflict
  const map = new Map(_llm.queries.map(q => [q.id, q]));
  for (const q of incoming) map.set(q.id, q);
  _llm.queries = [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  _llmSaveQueries(_llm.queries);

  // Merge categories — deduplicate
  if (incomingCats.length) {
    const catSet = new Set([..._llm.categories, ...incomingCats]);
    _llm.categories = [...catSet];
    _llmSaveCategories(_llm.categories);
  }

  if (_news.activeTab === 'llm') _renderLlmPanel();
}

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
  prices:           {},          // symbol → { price, change, changePct, updatedAt }
  prevReportIds:    {},          // symbol → Set of article IDs from the prior report (for NEW pill)
  prevReportGenAt:  {},          // symbol → generatedAt of the prior report
  activeTab:        'allsignals', // 'signal' | 'llm' | 'allsignals'
  allReports:       {},          // sym → report cache for all-signals view
};

// ─── LLM Prompts state ────────────────────────────────────────────────────────
const _llm = {
  queries:         [],   // loaded from localStorage on init
  results:         {},   // { [id]: htmlString } — in localStorage, not in backup
  categories:      [],   // user-defined prompt categories
  activeQueryId:   null, // currently selected query in left panel
  editingQueryId:  null, // null = view mode, 'new' = new form, id = editing existing
};


// ─── PUBLIC: called from switchView('news') ───────────────────────────────────
async function initNewsView() {
  // Load LLM data from localStorage before rendering shell
  _llm.queries    = _llmLoadQueries();
  _llm.results    = _llmLoadResults();
  _llm.categories = _llmLoadCategories();

  // Seed default prompts and categories on first load
  if (_llm.queries.length === 0) {
    const defaultCats = [...new Set(LLM_DEFAULT_PROMPTS.map(p => p.category))];
    _llm.categories   = defaultCats;
    _llmSaveCategories(_llm.categories);

    _llm.queries = LLM_DEFAULT_PROMPTS.map((p, i) => ({
      id:        'llm_default_' + i,
      llm:       p.llm,
      llmOther:  '',
      category:  p.category,
      prompt:    p.prompt,
      createdAt: new Date(Date.now() - i * 1000).toISOString(), // slight offset so order is stable
    }));
    _llmSaveQueries(_llm.queries);
  }

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
    const incoming = r.ok ? await r.json() : null;

    if (incoming) {
      const currentGenAt = _news.report?.generatedAt;
      const incomingGenAt = incoming.generatedAt;

      if (incomingGenAt && incomingGenAt !== currentGenAt) {
        // Report has changed — snapshot current article IDs as "previous" before replacing
        const currentIds = (_news.report?.clusters || [])
          .map(c => c.representative?.id).filter(Boolean);

        if (currentIds.length > 0) {
          // We have a real previous report — save its IDs and timestamp
          _news.prevReportIds[symbol]   = new Set(currentIds);
          _news.prevReportGenAt[symbol] = currentGenAt;
          try {
            localStorage.setItem(`ltj_prevRptIds_${symbol}`, JSON.stringify(currentIds));
            localStorage.setItem(`ltj_prevRptGenAt_${symbol}`, currentGenAt);
          } catch {}
        } else if (!_news.prevReportIds[symbol]) {
          // No in-memory snapshot yet — try to restore from localStorage
          try {
            const ids = JSON.parse(localStorage.getItem(`ltj_prevRptIds_${symbol}`) || 'null');
            const at  = localStorage.getItem(`ltj_prevRptGenAt_${symbol}`);
            if (ids?.length) {
              _news.prevReportIds[symbol]   = new Set(ids);
              _news.prevReportGenAt[symbol] = at;
            }
          } catch {}
        }
      }
    }

    _news.report = incoming;
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

  // Update price cache in background (non-blocking)
  fetch(`${NEWS_API}/news/prices`).then(r => r.ok ? r.json() : null).then(data => {
    if (!data) return;
    _news.prices = data;
    // Re-render panel header if a price just arrived for the active symbol
    if (data[_news.activeSymbol]) _renderReportPanel();
  }).catch(() => {});

  try {
    const r = await fetch(`${NEWS_API}/news/reports/status`);
    if (!r.ok) return;
    const statuses = await r.json();   // { TSLA: { status }, SPY: { status }, … }

    let activeNeedsReload = false;

    for (const [sym, { status }] of Object.entries(statuses)) {
      const wasRunning = _news.reportsRunning.has(sym);
      const hadReport  = _news.reportsAvailable.has(sym);

      if (status === 'running') {
        _news.reportsRunning.add(sym);

      } else if (status === 'done') {
        _news.reportsRunning.delete(sym);
        _news.reportsAvailable.add(sym);
        // Auto-reload report + signal pills if this is the active tab and it just finished
        if ((wasRunning || !hadReport) && sym === _news.activeSymbol) activeNeedsReload = true;
        // Refresh all-signals cache when a report completes
        if ((wasRunning || !hadReport) && _news.activeTab === 'allsignals') {
          fetch(`${NEWS_API}/news/report/${encodeURIComponent(sym)}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (!data) return;
              _news.allReports[sym] = data;
              for (const c of (data.clusters || [])) {
                const rep = c.representative;
                if (rep?.id) _news.articlesById[rep.id] = { ...rep, symbol: sym };
              }
              _renderAllSignalsPanel();
            }).catch(() => {});
        }

      } else if (status === 'error') {
        _news.reportsRunning.delete(sym);
      }
    }

    // Always re-render tabs so dots reflect current reportsAvailable state
    _renderSymbolTabs();
    if (activeNeedsReload) await _loadReport(_news.activeSymbol);
  } catch { /* server offline — silent */ }
}

function _renderReportPanel() {
  const el = document.getElementById('news-report-panel');
  if (!el) return;

  const sym = _news.activeSymbol;
  if (!sym) {
    el.innerHTML = '';
    return;
  }

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

  const priceData = _news.prices[sym];
  const priceHTML = priceData ? (() => {
    const p   = priceData.price.toFixed(2);
    const chg = priceData.change >= 0 ? `+${priceData.change.toFixed(2)}` : priceData.change.toFixed(2);
    const pct = priceData.changePct >= 0 ? `+${priceData.changePct.toFixed(2)}%` : `${priceData.changePct.toFixed(2)}%`;
    const cls = priceData.change >= 0 ? 'nrp-price-up' : 'nrp-price-down';
    return `<div class="nrp-price-row">
      <span class="nrp-price-val">$${_esc(p)}</span>
      <span class="nrp-price-chg ${cls}">${_esc(chg)} (${_esc(pct)})</span>
    </div>`;
  })() : '';

  const prevIds = _news.prevReportIds[sym]; // Set of IDs from the prior report

  const storiesHTML = (report.clusters || [])
    .slice()
    .sort((a, b) => {
      const ta = a.representative?.publishedAt || '';
      const tb = b.representative?.publishedAt || '';
      return tb > ta ? 1 : tb < ta ? -1 : 0;
    })
    .slice(0, 5)
    .map(c => {
    const rep = c.representative;
    const dupeLabel  = c.duplicates?.length ? `<span class="nrp-dupes">+${c.duplicates.length} similar</span>` : '';
    const score      = rep.score ? `<span class="nrp-score">${Math.round(rep.score * 100)}%</span>` : '';
    const pillsHTML  = (rep.categoryMatches || (rep.matchedCategory ? [{ category: rep.matchedCategory }] : []))
      .map(m => `<span class="nrp-cat-pill" style="${_catPillStyle(m.category)}" title="${_esc(m.signal || '')}">${_esc(m.category)}</span>`)
      .join('');
    const timeAgo    = rep.publishedAt ? _timeAgo(rep.publishedAt) : '';
    const isNew      = prevIds?.size > 0 && rep.id && !prevIds.has(rep.id);
    const newPill    = isNew ? `<span class="nrp-new-pill">NEW</span>` : '';
    return `
      <div class="nrp-story${isNew ? ' nrp-story-new' : ''}" onclick="_openArticle('${_esc(rep.id)}')">
        <div class="nrp-story-meta">
          ${score}${dupeLabel}
          ${timeAgo ? `<span class="nrp-story-time">${_esc(timeAgo)}</span>` : ''}
          ${newPill}
          <span class="nrp-story-src">${_esc(rep.source)}</span>
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
      ${priceHTML}
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
          <span class="news-last-upd" id="news-last-upd">Connecting…</span>
          <button class="news-icon-btn" id="news-refresh-btn"
                  onclick="triggerManualCrawl()" title="Crawl now">${_refreshSvg()}</button>
          <button class="news-icon-btn" onclick="openNewsSettings()" title="Configure sources">${_gearSvg()}</button>
        </div>
      </div>
      <div class="news-body" id="news-body"></div>
    </div>

    <!-- ── Settings panel ── -->
    <div class="nws-overlay" id="nws-overlay" onclick="_nwsOverlayClick(event)">
      <div class="nws-panel" id="nws-panel">
        <div class="nws-hdr">
          <span class="nws-hdr-title">Signal News Settings</span>
          <button class="nws-close-btn" onclick="closeNewsSettings()">&#10005;</button>
        </div>
        <div class="nws-body" id="nws-body"></div>
      </div>
    </div>`;

  // Render the initial body based on which tab was last active
  if (_news.activeTab === 'llm') _showLlmBody();
  else if (_news.activeTab === 'allsignals') { _showAllSignalsBody(); _loadAllReports(); }
  else _showSignalBody();
}

// ─── SYMBOL TABS ──────────────────────────────────────────────────────────────
function _renderSymbolTabs() {
  const el = document.getElementById('news-sym-tabs');
  if (!el) return;
  const userSyms = (_news.config?.symbols || []).filter(s => !PINNED_SYMS.includes(s));
  const syms = [...PINNED_SYMS, ...userSyms];

  const llmActive    = _news.activeTab === 'llm';
  const allsigActive = _news.activeTab === 'allsignals';

  const llmTab = `<button class="news-sym-tab news-sym-tab-llm${llmActive ? ' active' : ''}"
    onclick="_switchToLlmTab()">🤖 LLM Prompts</button>`;

  const allsigTab = `<button class="news-sym-tab news-sym-tab-allsig${allsigActive ? ' active' : ''}"
    onclick="_switchToAllSignalsTab()">📡 New Signals</button>`;

  const signalTabs = syms.map(s => {
    const isRunning = _news.reportsRunning.has(s);
    const hasReport = _news.reportsAvailable.has(s);
    const dot = isRunning ? '<span class="nst-dot nst-dot-running"></span>'
              : hasReport ? '<span class="nst-dot"></span>'
              : '';
    const isActive = s === _news.activeSymbol && _news.activeTab === 'signal';
    return `<button class="news-sym-tab${isActive ? ' active' : ''}"
             onclick="_switchNewsSymbol('${_esc(s)}')">${dot}${_esc(s)}</button>`;
  }).join('');

  el.innerHTML = llmTab + allsigTab + signalTabs;
}

function _switchToLlmTab() {
  _news.activeTab = 'llm';
  _renderSymbolTabs();
  _showLlmBody();
}

function _switchToAllSignalsTab() {
  _news.activeTab = 'allsignals';
  _renderSymbolTabs();
  _showAllSignalsBody();
  _loadAllReports();
}

function _switchNewsSymbol(sym) {
  _news.activeTab   = 'signal';
  _news.activeSymbol = sym;
  _news.report = null;
  _renderSymbolTabs();
  _showSignalBody();
  loadNews();
  _loadReport(sym);
}

function _showLlmBody() {
  const body = document.getElementById('news-body');
  if (!body) return;

  const launchBtns = Object.entries(LLM_URLS).map(([n, url]) =>
    `<a class="llm-topbar-btn" href="${_esc(url)}" target="_blank" rel="noopener"
        style="border-color:${_llmColor(n)};color:${_llmColor(n)}">${_esc(n)} ↗</a>`
  ).join('');

  body.innerHTML = `
    <div class="llm-body-wrap">
      <div class="llm-topbar-strip">${launchBtns}</div>
      <div class="llm-panels">
        <div class="llm-left-panel" id="llm-left-panel"></div>
        <div class="llm-right-panel" id="llm-right-panel"></div>
      </div>
    </div>`;
  _renderLlmList();
  _renderLlmRight();
}

function _showSignalBody() {
  const body = document.getElementById('news-body');
  if (!body) return;
  body.innerHTML = `
    <div class="news-signal-col" id="news-report-panel"></div>
    <div class="nws-feed-right" id="nws-feed-right">
      <div class="nws-iframe-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <span>Select an article to read</span>
      </div>
    </div>`;
  _renderReportPanel();
}

// ─── ALL SIGNALS TAB ──────────────────────────────────────────────────────────
function _showAllSignalsBody() {
  const body = document.getElementById('news-body');
  if (!body) return;
  body.innerHTML = `
    <div class="news-signal-col" id="allsig-panel"></div>
    <div class="nws-feed-right" id="nws-feed-right">
      <div class="nws-iframe-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <span>Select an article to read</span>
      </div>
    </div>`;
  _renderAllSignalsPanel();
}

async function _loadAllReports() {
  const userSyms = (_news.config?.symbols || []).filter(s => !PINNED_SYMS.includes(s));
  const syms = [...PINNED_SYMS, ...userSyms];
  await Promise.all(syms.map(async sym => {
    try {
      const r = await fetch(`${NEWS_API}/news/report/${encodeURIComponent(sym)}`);
      if (r.ok) {
        const report = await r.json();
        _news.allReports[sym] = report;
        _news.reportsAvailable.add(sym);
        // Seed articlesById so _openArticle can find these articles
        for (const c of (report.clusters || [])) {
          const rep = c.representative;
          if (rep?.id) _news.articlesById[rep.id] = { ...rep, symbol: sym };
        }
        // Load prevReportIds from localStorage if not already in memory
        if (!_news.prevReportIds[sym]) {
          try {
            const ids = JSON.parse(localStorage.getItem(`ltj_prevRptIds_${sym}`) || 'null');
            if (ids?.length) _news.prevReportIds[sym] = new Set(ids);
          } catch {}
        }
      }
    } catch {}
  }));
  if (_news.activeTab === 'allsignals') _renderAllSignalsPanel();
}

function _renderAllSignalsPanel() {
  const el = document.getElementById('allsig-panel');
  if (!el) return;

  const userSyms = (_news.config?.symbols || []).filter(s => !PINNED_SYMS.includes(s));
  const syms = [...PINNED_SYMS, ...userSyms];
  const anyRunning = syms.some(s => _news.reportsRunning.has(s));

  // Build per-ticker groups (only tickers that have new articles)
  const groups = [];
  for (const sym of syms) {
    const report  = _news.allReports[sym];
    if (!report) continue;
    const prevIds = _news.prevReportIds[sym];
    const symNew  = (report.clusters || [])
      .map(c => c.representative)
      .filter(rep => rep?.id && (!prevIds?.size || !prevIds.has(rep.id)))
      .sort((a, b) => (b.publishedAt || '') > (a.publishedAt || '') ? 1 : -1)
      .slice(0, 2);
    if (symNew.length) groups.push({ sym, articles: symNew });
  }

  if (!groups.length) {
    el.innerHTML = `
      <div class="nrp-wrap nrp-empty">
        <div class="nrp-empty-icon">📡</div>
        <div class="nrp-label">${anyRunning ? 'Analysing…' : 'No new signals.'}</div>
        ${anyRunning ? `<div class="nrp-loading-row"><span class="nrp-spinner"></span></div>` : ''}
      </div>`;
    return;
  }

  const groupsHTML = groups.map(({ sym, articles }) => {
    const color = _symColor(sym);
    const storiesHTML = articles.map(a => {
      const timeAgo   = a.publishedAt ? _timeAgo(a.publishedAt) : '';
      const pillsHTML = (a.categoryMatches || (a.matchedCategory ? [{ category: a.matchedCategory }] : []))
        .map(m => `<span class="nrp-cat-pill" style="${_catPillStyle(m.category)}">${_esc(m.category)}</span>`)
        .join('');
      return `
        <div class="nrp-story" onclick="_openArticle('${_esc(a.id)}')">
          <div class="nrp-story-meta">
            ${pillsHTML}
            ${timeAgo ? `<span class="nrp-story-time">${_esc(timeAgo)}</span>` : ''}
            <span class="nrp-story-src">${_esc(a.source || '')}</span>
          </div>
          <div class="nrp-story-title">${_esc(a.title)}</div>
          ${a.summary ? `<div class="nrp-story-summary">${_esc(a.summary)}</div>` : ''}
        </div>`;
    }).join('');

    return `
      <div class="allsig-ticker-hdr">
        <span class="nrp-sym-badge" style="background:${color}">${_esc(sym)}</span>
      </div>
      ${storiesHTML}`;
  }).join('');

  el.innerHTML = `
    <div class="nrp-wrap">
      ${anyRunning ? `<div class="nrp-live-banner"><span class="nrp-spinner"></span> Analysing new articles…</div>` : ''}
      <div class="nrp-hdr-row">
        <span class="nrp-title">New Signals</span>
        <button class="nrp-gen-btn" onclick="_loadAllReports()" title="Refresh">↺</button>
      </div>
      <div class="nrp-stories">${groupsHTML}</div>
    </div>`;
}


// ─── FEED ─────────────────────────────────────────────────────────────────────
function _renderFeed() {
  // Feed list is hidden; articles are still fetched so _openArticle can look them up.
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
      // 422 from on-demand → data stays null → fallback below
    }
    // 422 from cache → permanent failure (blocked/paywalled) → skip on-demand, go to fallback

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

  const fallbackBanner = data?.fallback
    ? `<div class="nwr-preview-banner">
         Preview only — full article unavailable.
         <a href="${safeUrl}" target="_blank" rel="noopener">Read on ${_esc(a.source)} ↗</a>
       </div>`
    : '';

  const bodyHtml = data
    ? (data.content
        ? `${fallbackBanner}<div class="nwr-article-body">${data.content}</div>`
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
  const lbl = document.getElementById('news-last-upd');

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
  return `
    <div class="nws-section">
      <div class="nws-section-lbl">Ticker Symbols</div>
      ${_symbolChipsHTML()}
      <div class="nws-add-sym-row">
        <input class="nws-inp" id="nws-sym-inp" placeholder="Add symbol (e.g. NVDA)"
               onkeydown="if(event.key==='Enter')_addSymbol()">
        <button class="nws-add-btn" onclick="_addSymbol()">+ Symbol</button>
      </div>
    </div>

    <div class="nws-section">
      <div class="nws-section-lbl">Ticker RSS Feeds
        <span class="nws-section-sub">shared across all tickers · use {SYMBOL} in URLs</span>
      </div>
      ${_tickerFeedsHTML()}
    </div>

    <div class="nws-section">
      <div class="nws-section-lbl">Market Feeds</div>
      ${_marketFeedsHTML()}
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

// ─── SYMBOL CHIPS (user tickers only) ────────────────────────────────────────
function _symbolChipsHTML() {
  const cfg = _news.config || { symbols: [] };
  const tickerPinned = PINNED_SYMS.filter(s => !MARKET_ONLY_SYMS.includes(s)); // SPX, SPY, QQQ
  const userSyms = (cfg.symbols || []).filter(s => !PINNED_SYMS.includes(s));
  const allTickers = [...tickerPinned, ...userSyms];
  const chips = allTickers.map(s => {
    const isPinned = PINNED_SYMS.includes(s);
    return `<span class="nws-sym-chip" style="background:${_symColor(s)}">${_esc(s)}${
      !isPinned ? `<button class="nws-sym-chip-del" onclick="_removeSymbol('${_esc(s)}')" title="Remove">×</button>` : ''
    }</span>`;
  }).join('');
  return `<div class="nws-sym-chips">${chips || '<span style="color:var(--text-dim);font-size:12px">No user tickers added yet.</span>'}</div>`;
}

// ─── TICKER FEED TEMPLATE (one shared list for all user tickers) ──────────────
function _tickerFeedsHTML() {
  const cfg = _news.config || { symbols: [], sources: [] };
  const tickerPinned = PINNED_SYMS.filter(s => !MARKET_ONLY_SYMS.includes(s));
  const userSyms = (cfg.symbols || []).filter(s => !PINNED_SYMS.includes(s));
  const allTickerSyms = [...tickerPinned, ...userSyms];

  if (allTickerSyms.length === 0)
    return `<div class="nws-no-feeds">No ticker symbols available.</div>`;

  const refSym = allTickerSyms[0];
  const tplFeeds = (cfg.sources || []).filter(s => s.symbol === refSym);
  const isAdding = _news.addingFeedFor === '__ticker__';

  const rows = tplFeeds.map(s => {
    const tplId = `__tpl__${s.id}`;
    if (_news.editingId === tplId) return _tickerFeedEditFormHTML(s, refSym);
    const dim = s.enabled === false ? ' nws-src-row--dim' : '';
    const displayUrl = s.url.replace(new RegExp(refSym, 'gi'), '{SYMBOL}');
    return `
      <div class="nws-src-row${dim}">
        <label class="nws-toggle">
          <input type="checkbox" ${s.enabled !== false ? 'checked' : ''}
                 onchange="_toggleTickerFeedTemplate('${_esc(s.name)}', this.checked)">
          <span class="nws-toggle-track"><span class="nws-toggle-thumb"></span></span>
        </label>
        <div class="nws-src-info">
          <div class="nws-src-name-row">
            ${_typeBadge(s.type)}
            <span class="nws-src-name">${_esc(s.name)}</span>
          </div>
          <div class="nws-src-url" title="${_esc(displayUrl)}">${_esc(displayUrl)}</div>
        </div>
        <button class="nws-src-edit-btn" onclick="_startEditTickerTemplate('${_esc(tplId)}')" title="Edit">
          ${_pencilSvg()}
        </button>
        <button class="nws-src-del" onclick="_removeTickerFeedTemplate('${_esc(s.name)}')" title="Remove">×</button>
      </div>`;
  }).join('');

  return `
    <div class="nws-sources-list">
      ${rows || '<div class="nws-no-feeds">No ticker feeds — add one below</div>'}
    </div>
    ${isAdding ? _tickerAddFeedFormHTML() : `<button class="nws-add-feed-btn" onclick="_startAddTickerFeed()">+ Add ticker feed</button>`}`;
}

function _tickerAddFeedFormHTML() {
  return `
    <div class="nws-add-feed-form">
      <div class="nws-src-edit-row">
        <input class="nws-inp" id="af-tpl-name" placeholder="Name (e.g. Yahoo Finance)">
        <select class="nws-sel nws-sel-sm" id="af-tpl-type">
          <option value="rss">RSS</option>
          <option value="html">HTML</option>
        </select>
      </div>
      <div class="nws-src-edit-row">
        <input class="nws-inp nws-inp-full" id="af-tpl-url"
               placeholder="URL with {SYMBOL} e.g. https://feeds.finance.yahoo.com/rss/2.0/headline?s={SYMBOL}">
      </div>
      <div class="nws-src-edit-actions">
        <button class="nws-save-btn" onclick="_commitAddTickerFeed()">Add</button>
        <button class="nws-cancel-btn" onclick="_cancelAddFeed()">Cancel</button>
      </div>
    </div>`;
}

function _tickerFeedEditFormHTML(s, refSym) {
  const displayUrl = s.url.replace(new RegExp(refSym, 'gi'), '{SYMBOL}');
  const typeOpts = [['rss','RSS / Atom'],['html','HTML Scraper']]
    .map(([v,l]) => `<option value="${v}"${s.type===v?' selected':''}>${l}</option>`).join('');
  return `
    <div class="nws-src-edit-box">
      <div class="nws-src-edit-row">
        <input class="nws-inp" id="tse-name-${_esc(s.id)}" value="${_esc(s.name)}" placeholder="Source name">
        <select class="nws-sel nws-sel-sm" id="tse-type-${_esc(s.id)}">${typeOpts}</select>
      </div>
      <div class="nws-src-edit-row">
        <input class="nws-inp nws-inp-full" id="tse-url-${_esc(s.id)}" value="${_esc(displayUrl)}"
               placeholder="URL with {SYMBOL}">
      </div>
      <div class="nws-src-edit-actions">
        <button class="nws-save-btn" onclick="_saveTickerTemplateEdit('${_esc(s.id)}','${_esc(s.name)}')">Save</button>
        <button class="nws-cancel-btn" onclick="_cancelEditSource()">Cancel</button>
      </div>
    </div>`;
}

function _startAddTickerFeed() {
  _news.addingFeedFor = '__ticker__';
  _news.editingId = null;
  openNewsSettings();
}

async function _commitAddTickerFeed() {
  const name = document.getElementById('af-tpl-name')?.value.trim() || '';
  const type = document.getElementById('af-tpl-type')?.value || 'rss';
  const url  = document.getElementById('af-tpl-url')?.value.trim() || '';
  if (!url) { alert('URL is required.'); return; }
  const cfg = _news.config;
  const tickerPinned = PINNED_SYMS.filter(s => !MARKET_ONLY_SYMS.includes(s));
  const allTickerSyms = [...tickerPinned, ...(cfg.symbols || []).filter(s => !PINNED_SYMS.includes(s))];
  const autoName = name || _hostLabel(url.replace(/\{SYMBOL\}/gi, 'ticker'));
  for (const sym of allTickerSyms) {
    const symUrl = url.replace(/\{SYMBOL\}/gi, sym);
    cfg.sources.push({
      id: `custom-${autoName.toLowerCase().replace(/\W+/g,'-')}-${sym.toLowerCase()}-${Date.now()}`,
      name: autoName, symbol: sym, type, url: symUrl, enabled: true
    });
  }
  _news.addingFeedFor = null;
  await _saveConfig();
  openNewsSettings();
  triggerManualCrawl();
}

async function _removeTickerFeedTemplate(feedName) {
  if (!_news.config) return;
  const tickerPinned = PINNED_SYMS.filter(s => !MARKET_ONLY_SYMS.includes(s));
  const allTickerSyms = [...tickerPinned, ...(_news.config.symbols || []).filter(s => !PINNED_SYMS.includes(s))];
  _news.config.sources = _news.config.sources.filter(s =>
    !(allTickerSyms.includes(s.symbol) && s.name === feedName)
  );
  await _saveConfig();
  openNewsSettings();
}

async function _toggleTickerFeedTemplate(feedName, enabled) {
  if (!_news.config) return;
  const tickerPinned = PINNED_SYMS.filter(s => !MARKET_ONLY_SYMS.includes(s));
  const allTickerSyms = [...tickerPinned, ...(_news.config.symbols || []).filter(s => !PINNED_SYMS.includes(s))];
  for (const src of _news.config.sources) {
    if (allTickerSyms.includes(src.symbol) && src.name === feedName) src.enabled = enabled;
  }
  await _saveConfig();
}

function _startEditTickerTemplate(tplId) {
  _news.editingId = tplId;
  openNewsSettings();
}

async function _saveTickerTemplateEdit(refId, oldName) {
  const name = document.getElementById(`tse-name-${refId}`)?.value.trim() || '';
  const type = document.getElementById(`tse-type-${refId}`)?.value || 'rss';
  const url  = document.getElementById(`tse-url-${refId}`)?.value.trim() || '';
  if (!url) { alert('URL is required.'); return; }
  const cfg = _news.config;
  const tickerPinned = PINNED_SYMS.filter(s => !MARKET_ONLY_SYMS.includes(s));
  const allTickerSyms = [...tickerPinned, ...(cfg.symbols || []).filter(s => !PINNED_SYMS.includes(s))];
  for (const src of cfg.sources) {
    if (allTickerSyms.includes(src.symbol) && src.name === oldName) {
      src.name = name || _hostLabel(url.replace(/\{SYMBOL\}/gi, src.symbol));
      src.type = type;
      src.url  = url.replace(/\{SYMBOL\}/gi, src.symbol);
    }
  }
  _news.editingId = null;
  await _saveConfig();
  openNewsSettings();
}

// ─── MARKET FEEDS (per pinned symbol) ────────────────────────────────────────
function _marketFeedsHTML() {
  return MARKET_ONLY_SYMS.map(sym => {
    const sources = (_news.config?.sources || []).filter(s => s.symbol === sym);
    const isAdding = _news.addingFeedFor === sym;
    const placeholder = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${sym}&region=US&lang=en-US`;
    return `
      <div class="nws-market-group">
        <div class="nws-market-sym-hdr">
          <span class="nws-ticker-sym" style="background:${_symColor(sym)}">${_esc(sym)}</span>
          <span class="nws-ticker-meta">${sources.length} feed${sources.length!==1?'s':''}</span>
        </div>
        <div class="nws-sources-list">
          ${sources.map(s => _srcRowHTML(s)).join('') || '<div class="nws-no-feeds">No feeds</div>'}
        </div>
        ${isAdding ? `
          <div class="nws-add-feed-form">
            <div class="nws-src-edit-row">
              <input class="nws-inp" id="af-name-${_esc(sym)}" placeholder="Source name">
              <select class="nws-sel nws-sel-sm" id="af-type-${_esc(sym)}">
                <option value="rss">RSS</option>
                <option value="html">HTML</option>
              </select>
            </div>
            <div class="nws-src-edit-row">
              <input class="nws-inp nws-inp-full" id="af-url-${_esc(sym)}" placeholder="${_esc(placeholder)}">
            </div>
            <div class="nws-src-edit-actions">
              <button class="nws-save-btn" onclick="_commitAddFeed('${_esc(sym)}')">Add</button>
              <button class="nws-cancel-btn" onclick="_cancelAddFeed()">Cancel</button>
            </div>
          </div>` : `
          <button class="nws-add-feed-btn" onclick="_startAddFeed('${_esc(sym)}')">+ Add feed</button>`}
      </div>`;
  }).join('');
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
  if (!confirm('Clear all cached data?\n\nThis removes news articles, signal reports, embeddings, summaries, and article content. A fresh crawl will run automatically.')) return;
  try {
    await fetch(`${NEWS_API}/news`, { method: 'DELETE' });
    // Reset all client-side state
    _news.articles      = [];
    _news.articlesById  = {};
    _news.report        = null;
    _news.prevReportIds = {};
    _news.prevReportGenAt = {};
    // Clear persisted prev-report state from localStorage
    Object.keys(localStorage)
      .filter(k => k.startsWith('ltj_prevRptIds_') || k.startsWith('ltj_prevRptGenAt_'))
      .forEach(k => localStorage.removeItem(k));
    _renderFeed();
    _renderReportPanel();
    _renderSymbolTabs();
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── LLM NEWS PANEL ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const LLM_TYPES = ['Grok', 'ChatGPT', 'Gemini', 'Claude', 'Other'];

// Base URLs — we open these and copy the prompt to clipboard (most don't accept URL params)
const LLM_URLS = {
  Grok:    'https://x.com/i/grok',
  ChatGPT: 'https://chatgpt.com/',
  Gemini:  'https://gemini.google.com/app',
  Claude:  'https://claude.ai/new',
};

const LLM_COLORS = {
  Grok:    '#1d9bf0',
  ChatGPT: '#10a37f',
  Gemini:  '#4285f4',
  Claude:  '#d97706',
  Other:   '#7c3aed',
};

function _llmDisplayName(q) {
  return q.llm === 'Other' && q.llmOther ? q.llmOther : q.llm;
}

function _llmColor(llm) { return LLM_COLORS[llm] || LLM_COLORS.Other; }

// Category pill colors — cycles through a palette keyed by category string
const _CAT_PALETTE = [
  { bg: 'rgba(99,102,241,0.18)',  color: '#a5b4fc' }, // indigo
  { bg: 'rgba(16,185,129,0.18)',  color: '#6ee7b7' }, // green
  { bg: 'rgba(245,158,11,0.18)',  color: '#fcd34d' }, // amber
  { bg: 'rgba(239,68,68,0.18)',   color: '#fca5a5' }, // red
  { bg: 'rgba(56,189,248,0.18)',  color: '#7dd3fc' }, // sky
  { bg: 'rgba(168,85,247,0.18)',  color: '#d8b4fe' }, // purple
  { bg: 'rgba(251,146,60,0.18)',  color: '#fdba74' }, // orange
  { bg: 'rgba(20,184,166,0.18)',  color: '#5eead4' }, // teal
];
const _catColorCache = {};
function _llmCatStyle(cat) {
  if (!cat) return '';
  if (!_catColorCache[cat]) {
    // Deterministic hash so same category always gets same color
    let h = 0;
    for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
    const p = _CAT_PALETTE[h % _CAT_PALETTE.length];
    _catColorCache[cat] = `background:${p.bg};color:${p.color}`;
  }
  return _catColorCache[cat];
}

// ─── Left panel — prompt list ─────────────────────────────────────────────────
function _renderLlmList() {
  const el = document.getElementById('llm-left-panel');
  if (!el) return;

  const items = _llm.queries.map(q => {
    const name       = _llmDisplayName(q);
    const color      = _llmColor(q.llm);
    const hasResults = !!((_llm.results[q.id] || '').trim());
    const dateSrc    = hasResults && q.resultsAt ? q.resultsAt : q.createdAt;
    const date       = dateSrc ? new Date(dateSrc).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
    const dateLabel  = hasResults && q.resultsAt ? `updated ${date}` : date;
    const cat        = q.category ? `<span class="llm-qrow-cat" style="${_llmCatStyle(q.category)}">${_esc(q.category)}</span>` : '';
    const preview    = q.prompt || '';
    const active     = _llm.activeQueryId === q.id;
    const resultsDot = hasResults ? `<span class="llm-qrow-results-dot" title="Has results"></span>` : '';
    return `
      <div class="llm-query-row${active ? ' active' : ''}" onclick="_llmSelectQuery('${_esc(q.id)}')">
        <div class="llm-qrow-top">
          <span class="llm-qrow-badge" style="background:${color}">${_esc(name)}</span>
          ${resultsDot}
          <span class="llm-qrow-date">${_esc(dateLabel)}</span>
        </div>
        ${cat}
        <div class="llm-qrow-prompt">${_esc(preview)}</div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="llm-list-hdr">
      <span class="llm-list-title">LLM Prompts</span>
      <div class="llm-list-hdr-actions">
        <button class="llm-reseed-btn" onclick="_llmReseedDefaults()" title="Restore missing default prompts">↺ Defaults</button>
        <button class="llm-new-btn" onclick="_llmNewQuery()">+ New Prompt</button>
      </div>
    </div>
    <div class="llm-list-body">
      ${items || '<div class="llm-empty-list">No prompts yet.<br>Tap + New Prompt to add one.</div>'}
    </div>`;
}

// ─── Right panel router ───────────────────────────────────────────────────────
function _renderLlmRight() {
  if (_llm.editingQueryId !== null) {
    _renderLlmForm();
  } else if (_llm.activeQueryId) {
    _renderLlmView();
  } else {
    const el = document.getElementById('llm-right-panel');
    if (el) el.innerHTML = `
      <div class="llm-placeholder">
        <span style="font-size:32px">🤖</span>
        <div>Select a prompt to view, or tap <strong>+ New Prompt</strong> to add one.</div>
      </div>`;
  }
}

// ─── View mode ────────────────────────────────────────────────────────────────
function _renderLlmView() {
  const el = document.getElementById('llm-right-panel');
  if (!el) return;
  const q = _llm.queries.find(x => x.id === _llm.activeQueryId);
  if (!q) return;

  const name    = _llmDisplayName(q);
  const color   = _llmColor(q.llm);
  const date    = q.createdAt ? new Date(q.createdAt).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
  const results = _llm.results[q.id] || '';
  const catBadge = q.category ? `<span class="llm-view-cat" style="${_llmCatStyle(q.category)}">${_esc(q.category)}</span>` : '';

  el.innerHTML = `
    <div class="llm-view-wrap">
      <div class="llm-view-hdr">
        <div class="llm-view-hdr-left">
          <span class="llm-view-badge" style="background:${color}">${_esc(name)}</span>
          ${catBadge}
          <span class="llm-view-date">${_esc(date)}</span>
        </div>
        <div class="llm-view-actions">
          <button class="llm-act-btn" onclick="_llmEditQuery('${_esc(q.id)}')">Edit</button>
          <button class="llm-act-btn llm-act-del" onclick="_llmDeleteQuery('${_esc(q.id)}')">Delete</button>
        </div>
      </div>

      <div class="llm-view-section">
        <div class="llm-section-label">Prompt
          <button class="llm-edit-results-btn" onclick="_llmCopyPrompt('${_esc(q.id)}')">Copy prompt</button>
          <span class="llm-copy-hint" id="llm-copy-hint-${_esc(q.id)}"></span>
        </div>
        <div class="llm-prompt-box">${_esc(q.prompt)}</div>
      </div>

      <div class="llm-view-section llm-results-section">
        <div class="llm-section-label">Results
          <button class="llm-edit-results-btn" onclick="_llmEditResults('${_esc(q.id)}')">Edit results</button>
        </div>
        <div class="llm-results-display" id="llm-results-display-${_esc(q.id)}">
          ${results ? results : '<span class="llm-no-results">No results pasted yet. Tap "Edit results" to add.</span>'}
        </div>
      </div>
    </div>`;
}

// ─── Add/Edit form ────────────────────────────────────────────────────────────
function _renderLlmForm() {
  const el = document.getElementById('llm-right-panel');
  if (!el) return;
  const isNew = _llm.editingQueryId === 'new';
  const q     = isNew ? null : _llm.queries.find(x => x.id === _llm.editingQueryId);

  const currentLlm    = q?.llm      || 'Grok';
  const currentOther  = q?.llmOther || '';
  const currentCat    = q?.category || '';
  const currentPrompt = q?.prompt   || '';

  const llmOptions = LLM_TYPES.map(t =>
    `<option value="${t}"${t === currentLlm ? ' selected' : ''}>${t}</option>`
  ).join('');

  // Category datalist + existing pills
  const catOptions = _llm.categories.map(c =>
    `<option value="${_esc(c)}"></option>`
  ).join('');
  const catPills = _llm.categories.map(c =>
    `<span class="llm-cat-pill" style="${_llmCatStyle(c)}" onclick="_llmPickCat('${_esc(c)}')" title="Use this category">${_esc(c)}
       <button class="llm-cat-pill-del" onclick="event.stopPropagation();_llmDeleteCat('${_esc(c)}')" title="Delete category">&#10005;</button>
     </span>`
  ).join('');

  el.innerHTML = `
    <div class="llm-form-wrap">
      <div class="llm-form-hdr">${isNew ? 'New LLM Prompt' : 'Edit Prompt'}</div>

      <div class="llm-form-field">
        <label class="llm-form-label">LLM</label>
        <div class="llm-form-llm-row">
          <select class="llm-form-select" id="llm-f-type" onchange="_llmToggleOther()">
            ${llmOptions}
          </select>
          <input class="llm-form-input" id="llm-f-other" placeholder="Specify LLM name…"
                 value="${_esc(currentOther)}"
                 style="display:${currentLlm === 'Other' ? 'block' : 'none'}">
        </div>
      </div>

      <div class="llm-form-field">
        <label class="llm-form-label">Prompt Category
          <span class="llm-form-label-hint">— type new or pick existing</span>
        </label>
        <div class="llm-form-cat-row">
          <input class="llm-form-input" id="llm-f-cat" list="llm-cat-list"
                 placeholder="e.g. Trade Idea Generator"
                 value="${_esc(currentCat)}">
          <datalist id="llm-cat-list">${catOptions}</datalist>
          <button class="llm-cat-add-btn" onclick="_llmAddCatFromInput()" title="Save as new category">+ Save</button>
        </div>
        ${catPills ? `<div class="llm-cat-pills-row">${catPills}</div>` : ''}
      </div>

      <div class="llm-form-field">
        <label class="llm-form-label">Prompt</label>
        <textarea class="llm-form-textarea" id="llm-f-prompt" placeholder="Paste the prompt you used…" rows="6">${_esc(currentPrompt)}</textarea>
      </div>

      <div class="llm-form-actions">
        <button class="llm-form-save" onclick="_llmSaveForm('${isNew ? 'new' : _esc(q.id)}')">Save</button>
        <button class="llm-form-cancel" onclick="_llmCancelForm()">Cancel</button>
      </div>
    </div>`;
}

// ─── Results editor (contenteditable — preserves rich text paste) ─────────────
function _llmEditResults(id) {
  const el = document.getElementById('llm-right-panel');
  if (!el) return;
  const q       = _llm.queries.find(x => x.id === id);
  const results = _llm.results[id] || '';
  const name    = q ? _llmDisplayName(q) : '';
  const color   = q ? _llmColor(q.llm) : '#888';

  el.innerHTML = `
    <div class="llm-form-wrap">
      <div class="llm-form-hdr">
        <span class="llm-view-badge" style="background:${color};margin-right:8px">${_esc(name)}</span>
        Edit Results
      </div>
      <div class="llm-editor-toolbar">
        <button class="llm-tb-btn" onclick="document.execCommand('bold')"       title="Bold"><b>B</b></button>
        <button class="llm-tb-btn" onclick="document.execCommand('italic')"     title="Italic"><i>I</i></button>
        <button class="llm-tb-btn" onclick="document.execCommand('underline')"  title="Underline"><u>U</u></button>
        <span class="llm-tb-sep"></span>
        <button class="llm-tb-btn" onclick="document.execCommand('insertUnorderedList')" title="Bullet list">&#8226; List</button>
        <button class="llm-tb-btn" onclick="document.execCommand('insertOrderedList')"   title="Numbered list">1. List</button>
        <span class="llm-tb-sep"></span>
        <button class="llm-tb-btn" onclick="document.execCommand('formatBlock',false,'h3')" title="Heading">H</button>
        <button class="llm-tb-btn" onclick="document.execCommand('formatBlock',false,'p')"  title="Paragraph">P</button>
        <span class="llm-tb-sep"></span>
        <button class="llm-tb-btn llm-tb-clear" onclick="_llmEditorClear()" title="Clear all">&#10005; Clear</button>
      </div>
      <div class="llm-rich-editor" id="llm-rich-editor" contenteditable="true"
           data-placeholder="Paste your LLM results here — formatting is preserved…">${results}</div>
      <div class="llm-form-actions">
        <button class="llm-form-save" onclick="_llmCommitResults('${_esc(id)}')">Save Results</button>
        <button class="llm-form-cancel" onclick="_llmCancelResults('${_esc(id)}')">Cancel</button>
      </div>
    </div>`;

  // Focus editor at end
  const editor = document.getElementById('llm-rich-editor');
  if (editor) {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function _llmEditorClear() {
  const editor = document.getElementById('llm-rich-editor');
  if (editor) { editor.innerHTML = ''; editor.focus(); }
}

// ─── Actions ──────────────────────────────────────────────────────────────────
function _llmNewQuery() {
  _llm.editingQueryId = 'new';
  _renderLlmRight();
}

function _llmSelectQuery(id) {
  _llm.activeQueryId  = id;
  _llm.editingQueryId = null;
  _renderLlmList();
  _renderLlmRight();
}

function _llmEditQuery(id) {
  _llm.editingQueryId = id;
  _renderLlmRight();
}

function _llmDeleteQuery(id) {
  const q = _llm.queries.find(x => x.id === id);
  if (!confirm(`Delete this ${q ? _llmDisplayName(q) : ''} prompt?`)) return;
  _llm.queries = _llm.queries.filter(x => x.id !== id);
  delete _llm.results[id];
  _llmSaveQueries(_llm.queries);
  _llmSaveResults(_llm.results);
  if (_llm.activeQueryId === id) _llm.activeQueryId = _llm.queries[0]?.id || null;
  _llm.editingQueryId = null;
  _renderLlmList();
  _renderLlmRight();
}

function _llmToggleOther() {
  const sel = document.getElementById('llm-f-type');
  const inp = document.getElementById('llm-f-other');
  if (sel && inp) inp.style.display = sel.value === 'Other' ? 'block' : 'none';
}

function _llmSaveForm(idOrNew) {
  const llm      = document.getElementById('llm-f-type')?.value || 'Grok';
  const other    = document.getElementById('llm-f-other')?.value.trim() || '';
  const category = document.getElementById('llm-f-cat')?.value.trim() || '';
  const prompt   = document.getElementById('llm-f-prompt')?.value.trim() || '';
  if (!prompt) { alert('Please enter a prompt.'); return; }

  // Auto-save the typed category if it's new
  if (category && !_llm.categories.includes(category)) {
    _llm.categories.push(category);
    _llmSaveCategories(_llm.categories);
  }

  if (idOrNew === 'new') {
    const entry = {
      id:        'llm_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      llm, llmOther: other, category, prompt,
      createdAt: new Date().toISOString(),
    };
    _llm.queries.unshift(entry);
    _llm.activeQueryId = entry.id;
  } else {
    const q = _llm.queries.find(x => x.id === idOrNew);
    if (q) { q.llm = llm; q.llmOther = other; q.category = category; q.prompt = prompt; }
  }

  _llm.editingQueryId = null;
  _llmSaveQueries(_llm.queries);
  _renderLlmList();
  _renderLlmRight();
}

function _llmCancelForm() {
  _llm.editingQueryId = null;
  _renderLlmRight();
}

function _llmAddCatFromInput() {
  const inp = document.getElementById('llm-f-cat');
  if (!inp) return;
  const cat = inp.value.trim();
  if (!cat) return;
  if (!_llm.categories.includes(cat)) {
    _llm.categories.push(cat);
    _llmSaveCategories(_llm.categories);
  }
  _renderLlmForm();
  // Restore the typed value after re-render
  const inp2 = document.getElementById('llm-f-cat');
  if (inp2) inp2.value = cat;
}

function _llmPickCat(cat) {
  const inp = document.getElementById('llm-f-cat');
  if (inp) inp.value = cat;
}

function _llmDeleteCat(cat) {
  _llm.categories = _llm.categories.filter(c => c !== cat);
  _llmSaveCategories(_llm.categories);
  // Preserve the current input value across re-render
  const currentVal = document.getElementById('llm-f-cat')?.value || '';
  _renderLlmForm();
  const inp = document.getElementById('llm-f-cat');
  if (inp && currentVal !== cat) inp.value = currentVal;
}

function _llmReseedDefaults() {
  const existingIds = new Set(_llm.queries.map(q => q.id));
  let added = 0;

  // Re-add any default that is no longer present (matched by stable id llm_default_N)
  LLM_DEFAULT_PROMPTS.forEach((p, i) => {
    const id = 'llm_default_' + i;
    if (!existingIds.has(id)) {
      _llm.queries.push({
        id,
        llm:       p.llm,
        llmOther:  '',
        category:  p.category,
        prompt:    p.prompt,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      });
      added++;
    }
  });

  // Merge default categories
  const defaultCats = [...new Set(LLM_DEFAULT_PROMPTS.map(p => p.category))];
  defaultCats.forEach(c => { if (!_llm.categories.includes(c)) _llm.categories.push(c); });

  _llmSaveQueries(_llm.queries);
  _llmSaveCategories(_llm.categories);
  _renderLlmList();
  _renderLlmRight();

  if (added === 0) alert('All default prompts are already present.');
  else alert(`${added} default prompt${added > 1 ? 's' : ''} restored.`);
}

function _llmCommitResults(id) {
  const html = document.getElementById('llm-rich-editor')?.innerHTML || '';
  _llm.results[id] = html;
  _llmSaveResults(_llm.results);
  // Stamp the query with when results were last saved
  const q = _llm.queries.find(x => x.id === id);
  if (q) {
    q.resultsAt = new Date().toISOString();
    _llmSaveQueries(_llm.queries);
  }
  _llm.activeQueryId  = id;
  _llm.editingQueryId = null;
  _renderLlmList();
  _renderLlmView();
}

function _llmCancelResults(id) {
  _llm.activeQueryId  = id;
  _llm.editingQueryId = null;
  _renderLlmView();
}

function _llmCopyPrompt(id) {
  const q = _llm.queries.find(x => x.id === id);
  if (!q?.prompt) return;
  navigator.clipboard.writeText(q.prompt).then(() => {
    const hint = document.getElementById(`llm-copy-hint-${id}`);
    if (hint) { hint.textContent = '✓ Prompt copied to clipboard'; setTimeout(() => { hint.textContent = ''; }, 2500); }
  }).catch(() => {});
}

// Called by _renderLlmPanel (used in restoreLlmQueries)
function _renderLlmPanel() {
  if (_news.activeTab !== 'llm') return;
  _renderLlmList();
  _renderLlmRight();
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
