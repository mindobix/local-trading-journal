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
const axios    = require('axios');
const { JSDOM }        = require('jsdom');
const { Readability }  = require('@mozilla/readability');
const { crawlAllSources } = require('./crawlers/index');

const app      = express();
const PORT     = 3737;
const ROOT     = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const NEWS_FILE     = path.join(DATA_DIR, 'news.json');
const CONFIG_FILE   = path.join(DATA_DIR, 'news-config.json');
const ARTICLES_DIR  = path.join(DATA_DIR, 'articles');

// ─── Default config ───────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  symbols: ['TSLA', 'SPY', 'QQQ', 'MU', 'META'],
  sources: [
    // ── TSLA ─────────────────────────────────────────────────────────────────
    { id: 'yf-tsla',    name: 'Yahoo Finance', type: 'rss', symbol: 'TSLA', enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=TSLA&region=US&lang=en-US' },
    { id: 'fv-tsla',    name: 'Finviz',        type: 'rss', symbol: 'TSLA', enabled: true,  url: 'https://finviz.com/rss.ashx?t=TSLA' },
    { id: 'nq-tsla',    name: 'Nasdaq',        type: 'rss', symbol: 'TSLA', enabled: true,  url: 'https://www.nasdaq.com/feed/rssoutbound?symbol=TSLA' },
    // ── SPY ──────────────────────────────────────────────────────────────────
    { id: 'yf-spy',     name: 'Yahoo Finance', type: 'rss', symbol: 'SPY',  enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=SPY&region=US&lang=en-US' },
    { id: 'fv-spy',     name: 'Finviz',        type: 'rss', symbol: 'SPY',  enabled: true,  url: 'https://finviz.com/rss.ashx?t=SPY' },
    { id: 'nq-spy',     name: 'Nasdaq',        type: 'rss', symbol: 'SPY',  enabled: false, url: 'https://www.nasdaq.com/feed/rssoutbound?symbol=SPY' },
    // ── QQQ ──────────────────────────────────────────────────────────────────
    { id: 'yf-qqq',     name: 'Yahoo Finance', type: 'rss', symbol: 'QQQ',  enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=QQQ&region=US&lang=en-US' },
    { id: 'fv-qqq',     name: 'Finviz',        type: 'rss', symbol: 'QQQ',  enabled: true,  url: 'https://finviz.com/rss.ashx?t=QQQ' },
    { id: 'nq-qqq',     name: 'Nasdaq',        type: 'rss', symbol: 'QQQ',  enabled: false, url: 'https://www.nasdaq.com/feed/rssoutbound?symbol=QQQ' },
    // ── MU ───────────────────────────────────────────────────────────────────
    { id: 'yf-mu',      name: 'Yahoo Finance', type: 'rss', symbol: 'MU',   enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=MU&region=US&lang=en-US' },
    { id: 'fv-mu',      name: 'Finviz',        type: 'rss', symbol: 'MU',   enabled: true,  url: 'https://finviz.com/rss.ashx?t=MU' },
    { id: 'nq-mu',      name: 'Nasdaq',        type: 'rss', symbol: 'MU',   enabled: true,  url: 'https://www.nasdaq.com/feed/rssoutbound?symbol=MU' },
    // ── META ─────────────────────────────────────────────────────────────────
    { id: 'yf-meta',    name: 'Yahoo Finance', type: 'rss', symbol: 'META', enabled: true,  url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=META&region=US&lang=en-US' },
    { id: 'fv-meta',    name: 'Finviz',        type: 'rss', symbol: 'META', enabled: true,  url: 'https://finviz.com/rss.ashx?t=META' },
    { id: 'nq-meta',    name: 'Nasdaq',        type: 'rss', symbol: 'META', enabled: true,  url: 'https://www.nasdaq.com/feed/rssoutbound?symbol=META' },
    // ── MARKET (broad) ───────────────────────────────────────────────────────
    { id: 'cnbc-mkt',   name: 'CNBC Markets',  type: 'rss', symbol: 'MARKET', enabled: true,  url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html'  },
    { id: 'cnbc-fin',   name: 'CNBC Finance',  type: 'rss', symbol: 'MARKET', enabled: true,  url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html'  },
    { id: 'cnbc-tech',  name: 'CNBC Tech',     type: 'rss', symbol: 'MARKET', enabled: true,  url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html'  },
    { id: 'mw-top',     name: 'MarketWatch',   type: 'rss', symbol: 'MARKET', enabled: true,  url: 'https://feeds.marketwatch.com/marketwatch/topstories/' },
    { id: 'inv-mkt',    name: 'Investing.com', type: 'rss', symbol: 'MARKET', enabled: false, url: 'https://www.investing.com/rss/news.rss'               },
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

  const before = cfg.sources.length;
  cfg.sources = cfg.sources.filter(s => s.type === 'rss' || s.type === 'atom');

  for (const def of DEFAULT_CONFIG.sources) {
    if (!cfg.sources.find(s => s.id === def.id)) {
      cfg.sources.push(def);
      console.log(`[Config] Added missing source: ${def.name} (${def.symbol})`);
    }
  }

  if (before !== cfg.sources.length) {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    console.log(`[Config] Migrated config — removed ${before - cfg.sources.length} unsupported sources.`);
  }
}

// ─── Readability extraction ───────────────────────────────────────────────────
const FETCH_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function readableExtract(url) {
  const resp = await axios.get(url, {
    headers: FETCH_HEADERS,
    timeout: 20000,
    maxContentLength: 5 * 1024 * 1024, // 5 MB cap
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
    console.warn(`[Readability] ✗ ${article.url?.slice(0, 80)} — ${err.message}`);
    // Don't write sentinel on network errors — allow retry next crawl
  }
}

// ─── Crawl logic ──────────────────────────────────────────────────────────────
async function runCrawl() {
  console.log(`[${new Date().toISOString()}] Starting crawl...`);

  const config   = await loadConfig();
  const existing = await loadNews();

  let fresh = [];
  try {
    fresh = await crawlAllSources(config);
  } catch (err) {
    console.error('Crawl error:', err.message);
  }

  const map = new Map((existing.articles || []).map(a => [a.id, a]));
  for (const a of fresh) map.set(a.id, a);

  const articles = [...map.values()]
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, config.maxTotalArticles || 500);

  const result = { articles, lastUpdated: new Date().toISOString(), count: articles.length };
  await saveNews(result);
  console.log(`[${new Date().toISOString()}] Crawl done — ${fresh.length} new, ${articles.length} total`);

  // Background: extract & cache article content (non-blocking)
  cacheNewArticles(articles).catch(err => console.error('[Readability] Cache error:', err));

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

app.get('/api/ping', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(ARTICLES_DIR, { recursive: true });
  await migrateConfig();
  await runCrawl();
  cron.schedule('*/5 * * * *', runCrawl);

  app.listen(PORT, () => {
    console.log('');
    console.log('  ┌──────────────────────────────────────────────┐');
    console.log(`  │  Market News Crawler → http://localhost:${PORT}  │`);
    console.log('  │  Auto-crawl every 5 minutes                  │');
    console.log('  └──────────────────────────────────────────────┘');
    console.log('');
  });
}

start().catch(err => { console.error('Startup error:', err); process.exit(1); });
