/**
 * Market News Crawler Server
 * Runs on http://localhost:3737
 * - Serves the trading journal static files
 * - Provides /api/news REST endpoints
 * - Auto-crawls RSS feeds every 5 minutes
 * - Background-extracts full article content via @mozilla/readability
 *   and caches each article to data/articles/{id}.json
 */
const express  = require('express');
const cors     = require('cors');
const cron     = require('node-cron');
const path     = require('path');
const fs       = require('fs').promises;
const http     = require('http');
const https    = require('https');
const axios    = require('axios');
const { JSDOM }        = require('jsdom');
const { Readability }  = require('@mozilla/readability');

// Yahoo Finance and some sites send huge cookie/redirect headers — raise the cap.
const LARGE_HEADER_SIZE = 64 * 1024; // 64 KB
const httpAgent  = new http.Agent ({ maxHeaderSize: LARGE_HEADER_SIZE, keepAlive: false });
const httpsAgent = new https.Agent({ maxHeaderSize: LARGE_HEADER_SIZE, keepAlive: false });
const { fork }            = require('child_process');
const { crawlAllSources } = require('./crawlers/index');


const REPORT_WORKER_PATH = path.join(__dirname, 'report-worker.js');

// ─── In-memory report job tracker ────────────────────────────────────────────
// Keyed by symbol. status: 'running' | 'done' | 'error'
const _reportJobs = new Map();

// ─── Stock price cache ────────────────────────────────────────────────────────
// Keyed by internal symbol. Updated every crawl cycle.
const _priceCache = {};

// Map internal symbols → Yahoo Finance tickers. null = no price available (indices, etc).
const YAHOO_SYM_MAP = { MARKET: null, SPX: '^GSPC' };

// Uses Yahoo Finance v8 chart API — no API key required.
async function fetchOnePriceV8(internalSym, yTicker) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yTicker)}?interval=1d&range=1d`;
  const resp = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    timeout: 10000, httpAgent, httpsAgent
  });
  const meta = resp.data?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error('No meta in response');
  const price  = meta.regularMarketPrice;
  const prev   = meta.chartPreviousClose || meta.previousClose || price;
  const change = price - prev;
  _priceCache[internalSym] = {
    price,
    change,
    changePct: prev ? (change / prev) * 100 : 0,
    updatedAt: new Date().toISOString()
  };
}

async function fetchPrices(symbols) {
  const pairs = symbols.map(s => [s, YAHOO_SYM_MAP.hasOwnProperty(s) ? YAHOO_SYM_MAP[s] : s])
                       .filter(([, y]) => y);
  const results = await Promise.allSettled(pairs.map(([s, y]) => fetchOnePriceV8(s, y)));
  const updated = pairs.filter((_, i) => results[i].status === 'fulfilled').map(([s]) => s);
  const failed  = pairs.filter((_, i) => results[i].status === 'rejected').map(([s]) => s);
  if (updated.length) console.log(`[Prices] Updated: ${updated.join(', ')}`);
  if (failed.length)  console.warn(`[Prices] Failed: ${failed.join(', ')}`);
}

const REPORT_COOLDOWN_MS = 20 * 60 * 1000; // don't re-run within 20 min of last trigger

function _runReportWorker(symbol, windowMs) {
  return new Promise(resolve => {
    const job = _reportJobs.get(symbol);
    if (job?.status === 'running') { resolve(); return; }
    // Cooldown: skip if this symbol was triggered recently
    if (job?.triggeredAt && Date.now() - job.triggeredAt < REPORT_COOLDOWN_MS) {
      resolve(); return;
    }

    _reportJobs.set(symbol, { status: 'running', triggeredAt: Date.now() });
    const child = fork(REPORT_WORKER_PATH, [symbol, String(windowMs)]);

    child.on('message', msg => {
      const { triggeredAt } = _reportJobs.get(symbol) || {};
      if (msg.ok) {
        _reportJobs.set(symbol, { status: 'done', report: msg.report, triggeredAt });
        console.log(`[Report Worker] ${symbol} done.`);
      } else {
        _reportJobs.set(symbol, { status: 'error', error: msg.error, triggeredAt });
        console.error(`[Report Worker] ${symbol} failed:`, msg.error);
      }
      resolve();
    });

    child.on('error', err => {
      const { triggeredAt } = _reportJobs.get(symbol) || {};
      _reportJobs.set(symbol, { status: 'error', error: err.message, triggeredAt });
      console.error(`[Report Worker] ${symbol} fork error:`, err.message);
      resolve();
    });

    // Catch crashes that exit before sending a message
    child.on('exit', code => {
      const job = _reportJobs.get(symbol);
      if (job?.status === 'running') {
        _reportJobs.set(symbol, { status: 'error', error: `Process exited with code ${code}`, triggeredAt: job.triggeredAt });
        resolve();
      }
    });
  });
}

const app      = express();
const PORT     = 3737;
const ROOT     = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const NEWS_FILE     = path.join(DATA_DIR, 'news.json');
const CONFIG_FILE   = path.join(DATA_DIR, 'news-config.json');
const ARTICLES_DIR  = path.join(DATA_DIR, 'articles');
const REPORTS_DIR   = path.join(DATA_DIR, 'reports');
const TAXONOMY_FILE = path.join(DATA_DIR, 'signal-taxonomy.json');

// Taxonomy helpers — inlined here so we never require() report-gen.js (and its
// heavy @xenova/transformers dependency) in the main process. That native ONNX
// module must only load inside the report worker thread.
async function loadTaxonomy() {
  try { return JSON.parse(await fs.readFile(TAXONOMY_FILE, 'utf8')); }
  catch { return { version: 1, signalThreshold: 0.28, dedupeThreshold: 0.82, categories: [] }; }
}
async function saveTaxonomy(taxonomy) {
  await fs.writeFile(TAXONOMY_FILE, JSON.stringify(taxonomy, null, 2));
}

// ─── Default config ───────────────────────────────────────────────────────────
// Bump configVersion whenever sources are added/removed so clients re-sync localStorage.
const DEFAULT_CONFIG = {
  configVersion: 1,
  // User-managed symbols only — MARKET, SPX, SPY, QQQ are pinned and not listed here.
  symbols: ['TSLA', 'MU', 'META'],
  sources: [
    // ── SPX (S&P 500 index) — pinned ─────────────────────────────────────────
    { id: 'yf-spx',     name: 'Yahoo Finance', type: 'rss', symbol: 'SPX',  enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US' },
    { id: 'nq-spx',     name: 'Nasdaq',        type: 'rss', symbol: 'SPX',  enabled: true,  url: 'https://www.nasdaq.com/feed/rssoutbound?symbol=SPX' },
    // ── SPY — pinned ─────────────────────────────────────────────────────────
    { id: 'yf-spy',     name: 'Yahoo Finance', type: 'rss', symbol: 'SPY',  enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=SPY&region=US&lang=en-US' },
    { id: 'nq-spy',     name: 'Nasdaq',        type: 'rss', symbol: 'SPY',  enabled: false, url: 'https://www.nasdaq.com/feed/rssoutbound?symbol=SPY' },
    // ── QQQ — pinned ─────────────────────────────────────────────────────────
    { id: 'yf-qqq',     name: 'Yahoo Finance', type: 'rss', symbol: 'QQQ',  enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=QQQ&region=US&lang=en-US' },
    { id: 'nq-qqq',     name: 'Nasdaq',        type: 'rss', symbol: 'QQQ',  enabled: false, url: 'https://www.nasdaq.com/feed/rssoutbound?symbol=QQQ' },
    // ── TSLA ─────────────────────────────────────────────────────────────────
    { id: 'yf-tsla',    name: 'Yahoo Finance', type: 'rss', symbol: 'TSLA', enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=TSLA&region=US&lang=en-US' },
    { id: 'nq-tsla',    name: 'Nasdaq',        type: 'rss', symbol: 'TSLA', enabled: true,  url: 'https://www.nasdaq.com/feed/rssoutbound?symbol=TSLA' },
    // ── MU ───────────────────────────────────────────────────────────────────
    { id: 'yf-mu',      name: 'Yahoo Finance', type: 'rss', symbol: 'MU',   enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=MU&region=US&lang=en-US' },
    { id: 'nq-mu',      name: 'Nasdaq',        type: 'rss', symbol: 'MU',   enabled: true,  url: 'https://www.nasdaq.com/feed/rssoutbound?symbol=MU' },
    // ── META ─────────────────────────────────────────────────────────────────
    { id: 'yf-meta',    name: 'Yahoo Finance', type: 'rss', symbol: 'META', enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=META&region=US&lang=en-US' },
    { id: 'nq-meta',    name: 'Nasdaq',        type: 'rss', symbol: 'META', enabled: true,  url: 'https://www.nasdaq.com/feed/rssoutbound?symbol=META' },
    // ── MARKET (equities / stock market) ────────────────────────────────────
    { id: 'mkt-yf-spy',    name: 'Yahoo Finance SPY',    type: 'rss', symbol: 'MARKET', enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=SPY&region=US&lang=en-US' },
    { id: 'mkt-yf-qqq',    name: 'Yahoo Finance QQQ',    type: 'rss', symbol: 'MARKET', enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=QQQ&region=US&lang=en-US' },
    { id: 'mkt-yf-dia',    name: 'Yahoo Finance DIA',    type: 'rss', symbol: 'MARKET', enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=DIA&region=US&lang=en-US' },
    { id: 'mkt-cnbc-tech', name: 'CNBC Tech',            type: 'rss', symbol: 'MARKET', enabled: true,  url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html'                        },
    { id: 'mkt-mw-stocks', name: 'MarketWatch Stocks',   type: 'rss', symbol: 'MARKET', enabled: true,  url: 'https://feeds.marketwatch.com/marketwatch/marketpulse/'                      },
    { id: 'mkt-sa-wall',   name: 'Seeking Alpha Wall St',type: 'rss', symbol: 'MARKET', enabled: true,  url: 'https://seekingalpha.com/market_currents.xml'                                },
    { id: 'mkt-nq-mkt',    name: 'Nasdaq Market News',   type: 'rss', symbol: 'MARKET', enabled: true,  url: 'https://www.nasdaq.com/feed/rssoutbound?category=Markets'                    },
  ],
  refreshInterval: 300,
  maxArticlesPerSource: 25,
  maxTotalArticles: 500
};

// ─── Persistence helpers ──────────────────────────────────────────────────────
async function loadConfig() {
  try {
    return JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
  } catch {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(cfg) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

async function loadNews() {
  try {
    return JSON.parse(await fs.readFile(NEWS_FILE, 'utf8'));
  } catch {
    return { articles: [], lastUpdated: null, count: 0 };
  }
}

async function saveNews(data) {
  await fs.writeFile(NEWS_FILE, JSON.stringify(data, null, 2));
}

// ─── Startup migration ────────────────────────────────────────────────────────
async function migrateConfig() {
  let cfg;
  try {
    cfg = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
  } catch {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.log('[Config] Wrote default config.');
    return;
  }

  // IDs that are permanently dead/blocked — remove from any saved config.
  const DEAD_IDS = new Set([
    'fv-tsla', 'fv-spy', 'fv-qqq', 'fv-mu', 'fv-meta',   // Finviz (404)
    'reuters-biz', 'reuters-top',                           // Reuters (dead domain)
    'inv-all', 'inv-econ', 'inv-mkt', 'mkt-inv-stk',       // Investing.com (403)
    'ap-finance', 'ap-economy',                             // AP News (not working)
    'mkt-benzinga',                                         // Benzinga (404)
    'ms-eq-news', 'ms-analyst',                             // MarketScreener (404)
    'cnbc-econ', 'cnbc-mkt', 'cnbc-fin',                   // MACRO removed
    'mw-top', 'fed-monetary', 'bls-latest',                 // MACRO removed
  ]);

  // Remove SPY/QQQ from user-managed symbols — they are now pinned tabs.
  const PINNED_SYMS = new Set(['MARKET', 'SPX', 'SPY', 'QQQ']);
  cfg.symbols = (cfg.symbols || []).filter(s => !PINNED_SYMS.has(s));

  const before = cfg.sources.length;
  cfg.sources = cfg.sources.filter(s =>
    (s.type === 'rss' || s.type === 'atom') && !DEAD_IDS.has(s.id)
  );
  const removed = before - cfg.sources.length;

  let added = 0;
  for (const def of DEFAULT_CONFIG.sources) {
    if (!cfg.sources.find(s => s.id === def.id)) {
      cfg.sources.push(def);
      console.log(`[Config] Added missing source: ${def.name} (${def.symbol})`);
      added++;
    }
  }

  // Always sync configVersion so the client can detect stale localStorage caches.
  const versionChanged = cfg.configVersion !== DEFAULT_CONFIG.configVersion;
  if (versionChanged) cfg.configVersion = DEFAULT_CONFIG.configVersion;

  if (removed > 0 || added > 0 || versionChanged) {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    console.log(`[Config] Migrated config — removed ${removed}, added ${added} sources, version → ${cfg.configVersion}.`);
  }
}

// ─── Readability extraction ───────────────────────────────────────────────────
const FETCH_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Domains that consistently block scraping — skip Readability entirely.
const BLOCKED_DOMAINS = new Set([
  'investing.com', 'www.investing.com',
]);

function _isBlocked(url) {
  try { return BLOCKED_DOMAINS.has(new URL(url).hostname); }
  catch { return false; }
}

async function readableExtract(url) {
  if (_isBlocked(url)) {
    const err = new Error('Domain is blocked for Readability extraction');
    err.response = { status: 403 };
    throw err;
  }
  const resp = await axios.get(url, {
    headers: FETCH_HEADERS,
    timeout: 20000,
    maxContentLength: 5 * 1024 * 1024, // 5 MB cap
    httpAgent,
    httpsAgent,
  });

  const dom = new JSDOM(resp.data, { url });
  const reader = new Readability(dom.window.document, {
    keepClasses: false,   // strip all class names for cleaner output
  });
  const article = reader.parse();
  if (!article || !article.content) return null;

  return {
    title:         article.title        || '',
    byline:        article.byline       || '',
    excerpt:       article.excerpt      || '',
    siteName:      article.siteName     || '',
    publishedTime: article.publishedTime || '',
    content:       article.content,       // cleaned HTML from Readability
    length:        article.length        || 0,
    cachedAt:      new Date().toISOString(),
  };
}

// ─── Article caching (runs in background after every crawl) ──────────────────
const CACHE_CONCURRENCY = 4;

async function cacheNewArticles(articles) {
  await fs.mkdir(ARTICLES_DIR, { recursive: true });

  // Only process articles not yet cached
  const uncached = [];
  for (const a of articles) {
    const file = path.join(ARTICLES_DIR, `${a.id}.json`);
    try { await fs.access(file); } catch { uncached.push(a); }
  }

  if (uncached.length === 0) return;
  console.log(`[Readability] Extracting ${uncached.length} new articles...`);

  // Process in small concurrent batches to avoid hammering sites
  for (let i = 0; i < uncached.length; i += CACHE_CONCURRENCY) {
    const batch = uncached.slice(i, i + CACHE_CONCURRENCY);
    await Promise.allSettled(batch.map(a => cacheOneArticle(a)));
  }

  console.log(`[Readability] Done caching batch.`);
}

async function cacheOneArticle(article) {
  const file = path.join(ARTICLES_DIR, `${article.id}.json`);
  try {
    const data = await readableExtract(article.url);
    if (!data) {
      console.warn(`[Readability] No content: ${article.title?.slice(0, 60)}`);
      // Write a sentinel so we don't retry forever
      await fs.writeFile(file, JSON.stringify({ failed: true, cachedAt: new Date().toISOString() }));
      return;
    }
    await fs.writeFile(file, JSON.stringify(data));
    console.log(`[Readability] ✓ ${article.title?.slice(0, 60)}`);
  } catch (err) {
    const status = err.response?.status;
    const permanent = status >= 400 && status < 500;
    console.warn(`[Readability] ✗ ${article.url?.slice(0, 80)} — ${err.message}`);
    if (permanent) {
      // 4xx = client error (blocked, paywalled, gone) — no point retrying
      await fs.writeFile(file, JSON.stringify({ failed: true, status, cachedAt: new Date().toISOString() }));
    }
    // 5xx / network errors — leave uncached so next crawl retries
  }
}

// ─── Crawl logic ──────────────────────────────────────────────────────────────
async function runCrawl() {
  console.log(`[${new Date().toISOString()}] Starting crawl...`);

  const config   = await loadConfig();
  const existing = await loadNews();

  // Track existing IDs so we can detect what's genuinely new this run.
  const existingIds = new Set((existing.articles || []).map(a => a.id));

  let fresh = [];
  try {
    fresh = await crawlAllSources(config);
  } catch (err) {
    console.error('Crawl error:', err.message);
  }

  const map = new Map((existing.articles || []).map(a => [a.id, a]));
  for (const a of fresh) map.set(a.id, a);

  const cutoff24h = Date.now() - 86_400_000;
  const articles = [...map.values()]
    .filter(a => new Date(a.publishedAt).getTime() >= cutoff24h)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const result = { articles, lastUpdated: new Date().toISOString(), count: articles.length };
  await saveNews(result);

  // Determine which symbols received new articles this run.
  const newArticles     = fresh.filter(a => !existingIds.has(a.id));
  const affectedSymbols = [...new Set(newArticles.map(a => a.symbol))];

  console.log(`[${new Date().toISOString()}] Crawl done — ${newArticles.length} new, ${articles.length} total`);

  // Background: extract & cache article content (non-blocking).
  cacheNewArticles(articles).catch(err => console.error('[Readability] Cache error:', err));

  // Update price cache for all tracked symbols (non-blocking).
  const allSymbols = [...new Set([...(config.symbols || []), 'MARKET', 'SPX', 'SPY', 'QQQ'])];
  fetchPrices(allSymbols).catch(err => console.warn('[Prices] Error:', err.message));

  // Auto-trigger signal analysis for every symbol that received new articles.
  if (affectedSymbols.length > 0) {
    console.log(`[Crawl] New articles for: ${affectedSymbols.join(', ')} — queuing signal analysis`);
    // Run sequentially so we don't saturate the CPU on a local machine.
    (async () => {
      for (const sym of affectedSymbols) await _runReportWorker(sym, 4 * 3600 * 1000);
    })().catch(err => console.error('[Crawl] Signal analysis error:', err.message));
  }

  return result;
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(ROOT));

// ─── API routes ───────────────────────────────────────────────────────────────
app.get('/api/news', async (req, res) => {
  try {
    const { symbol, limit = '200', offset = '0' } = req.query;
    const news = await loadNews();
    let articles = news.articles || [];
    if (symbol && symbol !== 'ALL') articles = articles.filter(a => a.symbol === symbol);
    const start = parseInt(offset);
    res.json({
      articles:    articles.slice(start, start + parseInt(limit)),
      total:       articles.length,
      lastUpdated: news.lastUpdated
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/news/config', async (req, res) => {
  try { res.json(await loadConfig()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/news/config', async (req, res) => {
  try {
    const cfg = req.body;
    if (cfg.sources) cfg.sources = cfg.sources.filter(s => s.type === 'rss' || s.type === 'atom');
    await saveConfig(cfg);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/news/crawl', async (req, res) => {
  try {
    const result = await runCrawl();
    res.json({ ok: true, count: result.count, lastUpdated: result.lastUpdated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/news', async (req, res) => {
  try {
    await saveNews({ articles: [], lastUpdated: null, count: 0 });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/news/config/reset', async (req, res) => {
  try {
    await saveConfig(DEFAULT_CONFIG);
    res.json({ ok: true, config: DEFAULT_CONFIG });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Article reader endpoint ──────────────────────────────────────────────────
// GET /api/news/article?id=<article-id>
//   Returns cached Readability content.
//   202 if not cached yet — frontend can retry or trigger on-demand.
// GET /api/news/article?url=<url>
//   On-demand extraction (used as fallback if id not cached).
app.get('/api/news/article', async (req, res) => {
  const { id, url } = req.query;

  if (id) {
    const file = path.join(ARTICLES_DIR, `${id}.json`);
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (data.failed) return res.status(422).json({ error: 'Article could not be extracted', failed: true });
      return res.json({ ok: true, cached: true, ...data });
    } catch {
      // Not cached yet
      return res.status(202).json({ ok: false, cached: false, error: 'not_cached_yet' });
    }
  }

  if (url) {
    try {
      const data = await readableExtract(url);
      if (!data) return res.status(422).json({ error: 'Readability found no content' });
      res.json({ ok: true, cached: false, ...data });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
    return;
  }

  res.status(400).json({ error: 'id or url required' });
});

// ─── Price endpoint ───────────────────────────────────────────────────────────
// GET /api/news/prices — returns current price cache for all symbols
app.get('/api/news/prices', (_req, res) => {
  res.json(_priceCache);
});

// ─── Signal taxonomy endpoints ────────────────────────────────────────────────

app.get('/api/news/taxonomy', async (req, res) => {
  try { res.json(await loadTaxonomy()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/news/taxonomy', async (req, res) => {
  try {
    await saveTaxonomy(req.body);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Report endpoints ─────────────────────────────────────────────────────────

// GET /api/news/report/:symbol — return cached report (404 if not yet generated)
app.get('/api/news/report/:symbol', async (req, res) => {
  try {
    const file = path.join(REPORTS_DIR, `${req.params.symbol}.json`);
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    res.json(data);
  } catch {
    res.status(404).json({ error: 'Report not generated yet' });
  }
});

// POST /api/news/report/:symbol — spawn worker (returns immediately)
app.post('/api/news/report/:symbol', (req, res) => {
  const symbol   = req.params.symbol;
  const windowMs = parseInt(req.query.window || '14400000'); // default 4h
  if (_reportJobs.get(symbol)?.status === 'running') {
    return res.json({ ok: true, status: 'running' });
  }
  _runReportWorker(symbol, windowMs); // fire-and-forget
  res.json({ ok: true, status: 'queued' });
});

// GET /api/news/report/:symbol/status — poll one job
app.get('/api/news/report/:symbol/status', (req, res) => {
  const job = _reportJobs.get(req.params.symbol);
  if (!job) return res.json({ status: 'idle' });
  res.json({ status: job.status, report: job.report || null, error: job.error || null });
});

// GET /api/news/reports/status — bulk status for all tracked symbols
app.get('/api/news/reports/status', (_req, res) => {
  const result = {};
  for (const [sym, job] of _reportJobs.entries()) {
    result[sym] = { status: job.status };
  }
  res.json(result);
});

// POST /api/news/reports/generate — trigger all symbols via workers (sequential)
app.post('/api/news/reports/generate', async (_req, res) => {
  const config = await loadConfig();
  res.json({ ok: true, message: 'Report generation queued' });
  const symbols = [...(config.symbols || []), 'MARKET'];
  for (const sym of symbols) await _runReportWorker(sym, 4 * 3600 * 1000);
});

app.get('/api/ping', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(ARTICLES_DIR, { recursive: true });
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  await migrateConfig();

  // Bind the port first — fail fast if already in use, before doing any crawl work
  await new Promise((resolve, reject) => {
    app.listen(PORT, () => {
      console.log('');
      console.log('  ┌──────────────────────────────────────────────┐');
      console.log(`  │  Market News Crawler → http://localhost:${PORT}  │`);
      console.log('  │  Auto-crawl every 5 minutes                  │');
      console.log('  └──────────────────────────────────────────────┘');
      console.log('');
      resolve();
    }).on('error', reject);
  });

  // Initial price fetch + crawl after the server is already listening
  const config0 = await loadConfig();
  const syms0   = [...new Set([...(config0.symbols || []), 'MARKET', 'SPX', 'SPY', 'QQQ'])];
  fetchPrices(syms0).catch(err => console.warn('[Prices] Startup fetch error:', err.message));
  runCrawl().catch(err => console.error('[Crawl] Initial crawl error:', err));
  cron.schedule('*/5 * * * *', runCrawl);
}

start().catch(err => { console.error('Startup error:', err); process.exit(1); });
