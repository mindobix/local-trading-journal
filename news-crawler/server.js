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

// ─── Worker / crawl interlock ─────────────────────────────────────────────────
// While signal workers are running we pause the RSS crawl so they aren't
// competing for CPU/memory. If a cron tick fires while workers are busy the
// crawl is recorded as pending and runs automatically when the last worker exits.
let _activeWorkerCount = 0;
let _crawlPending      = false;

function _onWorkerDone() {
  _activeWorkerCount = Math.max(0, _activeWorkerCount - 1);
  if (_activeWorkerCount === 0 && _crawlPending) {
    _crawlPending = false;
    console.log('[Crawl] ▶ All signal workers finished — running deferred crawl now.');
    runCrawl().catch(err => console.error('[Crawl] Deferred crawl error:', err.message));
  }
}

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

function _runReportWorker(symbol, windowMs, newArticleIds = new Set()) {
  return new Promise(resolve => {
    const job = _reportJobs.get(symbol);
    if (job?.status === 'running') { resolve(); return; }

    _reportJobs.set(symbol, { status: 'running', triggeredAt: Date.now() });
    _activeWorkerCount++;

    const newIdsArg = JSON.stringify([...newArticleIds]);
    const child = fork(REPORT_WORKER_PATH, [symbol, String(windowMs), newIdsArg]);

    child.on('message', msg => {
      const { triggeredAt } = _reportJobs.get(symbol) || {};
      if (msg.ok) {
        _reportJobs.set(symbol, { status: 'done', report: msg.report, triggeredAt });
      } else {
        _reportJobs.set(symbol, { status: 'error', error: msg.error, triggeredAt });
        console.error(`[Report] ✗ ${symbol} failed: ${msg.error}`);
      }
      _onWorkerDone();
      resolve();
    });

    child.on('error', err => {
      const { triggeredAt } = _reportJobs.get(symbol) || {};
      _reportJobs.set(symbol, { status: 'error', error: err.message, triggeredAt });
      console.error(`[Report] ✗ ${symbol} fork error: ${err.message}`);
      _onWorkerDone();
      resolve();
    });

    child.on('exit', code => {
      const job = _reportJobs.get(symbol);
      if (job?.status === 'running') {
        _reportJobs.set(symbol, { status: 'error', error: `Process exited with code ${code}`, triggeredAt: job.triggeredAt });
        _onWorkerDone();
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

// Rolling window for RSS articles and signal analysis.
// Articles older than this are dropped on every crawl and their caches pruned.
const ARTICLE_WINDOW_MS = 4 * 3600_000; // 4 hours

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
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
};

// Minimum extracted text length to consider an article "readable".
// Paywall teasers and bot-check pages typically produce <200 chars.
const MIN_CONTENT_CHARS = 200;

// Domains that consistently block scraping or return paywalled/JS-rendered content.
// Adding a domain here causes articles from it to be immediately marked as failed
// rather than making a network request. Keep sorted alphabetically.
const BLOCKED_DOMAINS = new Set([
  'barrons.com',        'www.barrons.com',
  'bloomberg.com',      'www.bloomberg.com',
  'ft.com',             'www.ft.com',
  'investing.com',      'www.investing.com',
  'seekingalpha.com',   'www.seekingalpha.com',  // paywall + JS-rendered
  'thestreet.com',      'www.thestreet.com',
  'wsj.com',            'www.wsj.com',
]);

function _isBlocked(url) {
  try { return BLOCKED_DOMAINS.has(new URL(url).hostname); }
  catch { return false; }
}

// ─── __NEXT_DATA__ fallback extractor ────────────────────────────────────────
// Yahoo Finance (and other Next.js sites) embed the full article JSON in a
// <script id="__NEXT_DATA__"> tag. Readability often misses it because the
// visible DOM only contains a JS-hydration shell. This parser walks the
// content tree that Yahoo Finance uses for its news articles.
function _tryNextDataExtract(html) {
  try {
    const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;

    const nd    = JSON.parse(m[1]);
    const pp    = nd?.props?.pageProps;
    if (!pp) return null;

    // Yahoo Finance article pages use several possible locations.
    const art = pp.article ?? pp.data?.article ?? pp.item ?? null;
    if (!art) return null;

    // Walk the rich-content body tree into plain HTML paragraphs.
    const bodyNodes = art.body?.content ?? art.content ?? [];
    const parts     = [];

    function flattenText(nodes) {
      if (!Array.isArray(nodes)) return typeof nodes === 'string' ? nodes : '';
      return nodes.map(n => {
        if (!n) return '';
        if (typeof n === 'string') return n;
        if (typeof n.value === 'string') return n.value;
        // Recurse into content or children
        const sub = Array.isArray(n.content) ? n.content
                  : Array.isArray(n.children) ? n.children
                  : typeof n.content === 'string' ? [n.content]
                  : [];
        return flattenText(sub);
      }).join('');
    }

    function walk(nodes) {
      if (!Array.isArray(nodes)) return;
      for (const n of nodes) {
        if (!n) continue;
        const t = (n.type || '').toLowerCase();
        if (t === 'p' || t === 'paragraph') {
          const txt = flattenText(n.content ?? n.children ?? []).trim();
          if (txt) parts.push(`<p>${txt.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`);
        } else if (t === 'h2' || t === 'h3' || t === 'heading') {
          const txt = flattenText(n.content ?? n.children ?? []).trim();
          if (txt) parts.push(`<h3>${txt.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h3>`);
        } else {
          walk(n.content ?? n.children ?? []);
        }
      }
    }

    walk(bodyNodes);
    if (parts.length === 0) return null;

    const content = parts.join('\n');
    const length  = content.replace(/<[^>]+>/g, '').length;
    const byline  = (art.authors || []).map(a => a.name ?? a).filter(Boolean).join(', ');

    return {
      title:         art.title         || '',
      byline,
      excerpt:       art.summary        || '',
      siteName:      'Yahoo Finance',
      publishedTime: art.pubDate        || art.publishedAt || '',
      content,
      length,
    };
  } catch { return null; }
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

  const html = resp.data;

  // ── Primary: Readability ──────────────────────────────────────────────────
  const dom    = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document, { keepClasses: false });
  const article = reader.parse();

  if (article && article.content && (article.length || 0) >= MIN_CONTENT_CHARS) {
    return {
      title:         article.title         || '',
      byline:        article.byline        || '',
      excerpt:       article.excerpt       || '',
      siteName:      article.siteName      || '',
      publishedTime: article.publishedTime || '',
      content:       article.content,
      length:        article.length        || 0,
      cachedAt:      new Date().toISOString(),
    };
  }

  // ── Fallback: __NEXT_DATA__ (Yahoo Finance, Next.js sites) ───────────────
  const nd = _tryNextDataExtract(html);
  if (nd && nd.length >= MIN_CONTENT_CHARS) {
    console.log(`[Readability] ↩ __NEXT_DATA__ fallback used for ${new URL(url).hostname}`);
    return { ...nd, cachedAt: new Date().toISOString() };
  }

  return null;
}

// ─── Article caching (runs in background after every crawl) ──────────────────
const CACHE_CONCURRENCY = 4;

async function cacheNewArticles(articles) {
  await fs.mkdir(ARTICLES_DIR, { recursive: true });
  const now = Date.now();

  const toProcess = [];
  for (const a of articles) {
    const file = path.join(ARTICLES_DIR, `${a.id}.json`);
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (data.fallback) {
        // Retry transient fallbacks (network errors) once their window passes.
        // Permanent fallbacks (blocked domains) keep their RSS preview — don't retry.
        if (data.transient && data.retryAfter && now >= data.retryAfter) toProcess.push(a);
      } else if ((data.length || 0) < MIN_CONTENT_CHARS) {
        // Re-process low-quality cached content (paywall teasers, bot pages, etc.)
        toProcess.push(a);
      }
      // Else: good full-content cache — skip
    } catch {
      toProcess.push(a); // not yet cached
    }
  }

  if (toProcess.length === 0) return;
  console.log(`[Readability] Processing ${toProcess.length} articles...`);

  for (let i = 0; i < toProcess.length; i += CACHE_CONCURRENCY) {
    const batch = toProcess.slice(i, i + CACHE_CONCURRENCY);
    await Promise.allSettled(batch.map(a => cacheOneArticle(a)));
  }

  console.log(`[Readability] Done.`);
}

async function cacheOneArticle(article) {
  const file = path.join(ARTICLES_DIR, `${article.id}.json`);

  // Build a fallback entry from RSS metadata so the reader always has something.
  function _rssFallback(extra = {}) {
    const desc = article.description || '';
    const escaped = desc.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return {
      fallback:      true,
      title:         article.title       || '',
      byline:        '',
      excerpt:       desc,
      siteName:      article.source      || '',
      publishedTime: article.publishedAt || '',
      content:       escaped ? `<p>${escaped}</p>` : '',
      length:        desc.length,
      cachedAt:      new Date().toISOString(),
      ...extra,
    };
  }

  try {
    const data = await readableExtract(article.url);
    if (!data) {
      console.warn(`[Readability] ✗ Sparse/no content — RSS preview cached: ${article.title?.slice(0, 60)}`);
      await fs.writeFile(file, JSON.stringify(_rssFallback()));
      return;
    }
    await fs.writeFile(file, JSON.stringify(data));
    console.log(`[Readability] ✓ ${article.title?.slice(0, 60)} (${data.length} chars)`);
  } catch (err) {
    const status = err.response?.status;
    console.warn(`[Readability] ✗ ${article.url?.slice(0, 80)} — ${status ? `HTTP ${status}` : err.message} — RSS preview cached`);
    if (status >= 400 && status < 500) {
      // Blocked / paywalled / gone — store RSS preview permanently, skip future retries
      await fs.writeFile(file, JSON.stringify(_rssFallback({ status })));
    } else {
      // Network / 5xx — store RSS preview now, retry full extraction in 1 hour
      await fs.writeFile(file, JSON.stringify(_rssFallback({
        transient:  true,
        retryAfter: Date.now() + 3_600_000,
      })));
    }
  }
}

// ─── Crawl logic ──────────────────────────────────────────────────────────────
async function runCrawl() {
  // Don't crawl while signal workers are running — they're CPU-intensive.
  // Record the crawl as pending; _onWorkerDone() will fire it when they finish.
  if (_activeWorkerCount > 0) {
    if (!_crawlPending) {
      _crawlPending = true;
      console.log(`[Crawl] ⏸ Signal analysis in progress (${_activeWorkerCount} worker${_activeWorkerCount !== 1 ? 's' : ''}) — crawl deferred.`);
    }
    return;
  }

  console.log(`[Crawl] ▶ Starting crawl at ${new Date().toLocaleTimeString()}...`);

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

  const cutoff = Date.now() - ARTICLE_WINDOW_MS;
  const articles = [...map.values()]
    .filter(a => new Date(a.publishedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const result = { articles, lastUpdated: new Date().toISOString(), count: articles.length };
  await saveNews(result);

  // Prune cache files for articles that aged out of the window.
  const keptIds   = new Set(articles.map(a => a.id));
  const expiredIds = [...existingIds].filter(id => !keptIds.has(id));
  if (expiredIds.length > 0) {
    console.log(`[Crawl] Pruning ${expiredIds.length} expired article${expiredIds.length !== 1 ? 's' : ''} from cache.`);
    await Promise.allSettled(expiredIds.flatMap(id => [
      fs.unlink(path.join(ARTICLES_DIR,              `${id}.json`)).catch(() => {}),
      fs.unlink(path.join(DATA_DIR, 'embeddings',    `${id}.json`)).catch(() => {}),
      fs.unlink(path.join(DATA_DIR, 'summaries',     `${id}.txt` )).catch(() => {}),
    ]));
  }

  // Determine which symbols received new articles this run.
  const newArticles     = fresh.filter(a => !existingIds.has(a.id));
  const affectedSymbols = [...new Set(newArticles.map(a => a.symbol))];

  // Build per-symbol new-article ID sets for incremental report logging.
  const newIdsBySymbol = {};
  for (const a of newArticles) {
    if (!newIdsBySymbol[a.symbol]) newIdsBySymbol[a.symbol] = new Set();
    newIdsBySymbol[a.symbol].add(a.id);
  }

  if (newArticles.length > 0) {
    const breakdown = affectedSymbols.map(s => `${s}:${newIdsBySymbol[s].size}`).join('  ');
    console.log(`[Crawl] ✓ ${newArticles.length} new articles — ${breakdown} | ${articles.length} total`);
  } else {
    console.log(`[Crawl] ✓ No new articles | ${articles.length} total`);
  }

  // Background: extract & cache article content (non-blocking).
  cacheNewArticles(articles).catch(err => console.error('[Readability] Cache error:', err));

  // Update price cache for all tracked symbols (non-blocking).
  const allSymbols = [...new Set([...(config.symbols || []), 'MARKET', 'SPX', 'SPY', 'QQQ'])];
  fetchPrices(allSymbols).catch(err => console.warn('[Prices] Error:', err.message));

  // Auto-trigger signal analysis only for symbols that received new articles.
  if (affectedSymbols.length > 0) {
    console.log(`[Crawl] Queuing signal analysis for: ${affectedSymbols.join(', ')}`);
    // Run sequentially so we don't saturate the CPU on a local machine.
    (async () => {
      for (const sym of affectedSymbols) {
        await _runReportWorker(sym, ARTICLE_WINDOW_MS, newIdsBySymbol[sym] || new Set());
      }
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
    // Clear news articles
    await saveNews({ articles: [], lastUpdated: null, count: 0 });

    // Wipe all signal-pipeline cache directories
    const cacheDirs = [
      path.join(DATA_DIR, 'articles'),    // Readability extractions
      path.join(DATA_DIR, 'embeddings'),  // article embedding vectors
      path.join(DATA_DIR, 'summaries'),   // LLM summaries
      path.join(DATA_DIR, 'processed'),   // per-symbol score caches
      path.join(DATA_DIR, 'reports'),     // generated signal reports
    ];
    await Promise.all(cacheDirs.map(async dir => {
      try {
        const files = await fs.readdir(dir);
        await Promise.all(files.map(f => fs.unlink(path.join(dir, f)).catch(() => {})));
      } catch { /* dir may not exist yet */ }
    }));

    // Reset in-memory report job state so green dots clear immediately
    _reportJobs.clear();

    console.log('[Cache] ✓ All caches cleared.');
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
      // fallback:true = RSS preview (full extraction failed) — still valid, return 200
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
  const windowMs = parseInt(req.query.window) || ARTICLE_WINDOW_MS;
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
  for (const sym of symbols) await _runReportWorker(sym, ARTICLE_WINDOW_MS);
});

app.get('/api/ping', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(ARTICLES_DIR, { recursive: true });
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  await migrateConfig();

  // Pre-populate _reportJobs from any report files that already exist on disk
  // so green dots appear immediately after a server restart.
  try {
    const files = await fs.readdir(REPORTS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const sym = file.replace(/\.json$/, '').toUpperCase();
      if (!_reportJobs.has(sym)) {
        _reportJobs.set(sym, { status: 'done', triggeredAt: Date.now() });
      }
    }
  } catch { /* reports dir may be empty on first run */ }

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
