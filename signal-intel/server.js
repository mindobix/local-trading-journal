/**
 * LADSCS — Local Actionable Data Smart Crawler Service
 * Trading Intelligence MVP  |  http://localhost:3838
 *
 * Crawls RSS feeds → Claude API analyst brain → ranked signal cards
 */
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const cron     = require('node-cron');
const path     = require('path');
const fs       = require('fs');

const { crawlAll }              = require('./crawler');
const { analyzeArticles }       = require('./analyst');
const { rankSignals, timeAgo }  = require('./ranker');
const db                        = require('./db');

// ── SSE clients ───────────────────────────────────────────────────────────────

const sseClients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  const cfgPath = path.join(__dirname, 'config.json');
  return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(cfg, null, 2));
}

// ── Crawl State ───────────────────────────────────────────────────────────────

const state = {
  status:       'idle',    // idle | crawling | analyzing
  lastCrawlAt:  null,
  lastSignalAt: null,
  newSignals:   0,
  totalArticles: 0,
  errors:       [],
};

// ── Core pipeline ─────────────────────────────────────────────────────────────

async function runPipeline() {
  if (state.status !== 'idle') {
    console.log('[Pipeline] Already running — skipping tick');
    return;
  }

  const cfg = loadConfig();
  const THRESHOLD = parseFloat(process.env.SIGNAL_CONFIDENCE_THRESHOLD || cfg.signalConfidenceThreshold || 0.55);

  try {
    state.status = 'crawling';
    state.errors = [];
    console.log(`\n[Pipeline] ─── Crawl cycle @ ${new Date().toISOString()} ───`);

    // 1. Crawl all feeds
    const byTicker = await crawlAll(cfg.sources, cfg.maxArticlesPerSource || 20);
    const tickerList = Object.keys(byTicker);
    const totalArts  = Object.values(byTicker).reduce((n, a) => n + a.length, 0);

    console.log(`[Pipeline] Crawled ${totalArts} articles across ${tickerList.length} tickers`);
    state.totalArticles = totalArts;

    // 2. Filter to only NEW articles (not seen before)
    const newByTicker = {};
    for (const [ticker, articles] of Object.entries(byTicker)) {
      const fresh = articles.filter(a => !db.isSeen(a.id));
      if (fresh.length > 0) {
        newByTicker[ticker] = fresh;
        // Mark all as seen
        fresh.forEach(a => db.markSeen(a.id, ticker));
      }
    }

    const newTickerList = Object.keys(newByTicker);
    if (newTickerList.length === 0) {
      console.log('[Pipeline] No new articles since last crawl — skipping analysis');
      state.status      = 'idle';
      state.lastCrawlAt = new Date().toISOString();
      db.pruneOldSeen();
      return;
    }

    console.log(`[Pipeline] ${newTickerList.length} tickers have new articles: ${newTickerList.join(', ')}`);

    // 3. Analyze each ticker and save + broadcast immediately as each finishes
    state.status = 'analyzing';
    const model  = cfg.analystModel || process.env.ANALYST_MODEL || 'llama3.2';
    let saved = 0;

    for (const [ticker, articles] of Object.entries(newByTicker)) {
      broadcast('ticker_start', { ticker });

      const analysis = await analyzeArticles(ticker, articles, model);

      if (!analysis || !analysis.has_signal || analysis.urgency === 'noise') {
        broadcast('ticker_done', { ticker, saved: false });
        continue;
      }
      if (analysis.confidence < THRESHOLD) {
        console.log(`[Pipeline] $${ticker}: confidence ${analysis.confidence} below threshold ${THRESHOLD} — skipped`);
        broadcast('ticker_done', { ticker, saved: false });
        continue;
      }

      const articleHashes = articles.map(a => a.id);
      const id = db.saveSignal(ticker, analysis, articleHashes);
      if (id) {
        saved++;
        console.log(`[Pipeline] ✓ $${ticker} signal saved: ${analysis.direction} (${(analysis.confidence * 100).toFixed(0)}%) — "${analysis.headline}"`);
        broadcast('signal', { ticker, id, direction: analysis.direction, urgency: analysis.urgency, headline: analysis.headline });
      }
      broadcast('ticker_done', { ticker, saved: !!id });
    }

    state.newSignals   = saved;
    state.lastCrawlAt  = new Date().toISOString();
    state.lastSignalAt = saved > 0 ? new Date().toISOString() : state.lastSignalAt;
    db.pruneOldSeen();

    console.log(`[Pipeline] Done — ${saved} new signals saved\n`);

  } catch (err) {
    state.errors.push(err.message);
    console.error('[Pipeline] Error:', err.message);
  } finally {
    state.status = 'idle';
  }
}

// ── Express app ───────────────────────────────────────────────────────────────

const app  = express();
const PORT = parseInt(process.env.PORT || '3838');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/events — SSE stream for live signal updates
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write('event: connected\ndata: {}\n\n');
  sseClients.add(res);

  req.on('close', () => sseClients.delete(res));
});

// GET /api/signals
app.get('/api/signals', (req, res) => {
  const cfg     = loadConfig();
  const limit   = Math.min(parseInt(req.query.limit || '60'), 200);
  const ticker  = req.query.ticker || null;
  const since   = req.query.since  || new Date(Date.now() - 24 * 3600_000).toISOString();

  const raw     = db.getSignals({ limit, ticker, since });
  const ranked  = rankSignals(raw, cfg.watchlist || []);

  res.json({
    signals:    ranked.map(s => ({ ...s, age: timeAgo(s.created_at) })),
    total:      ranked.length,
    fetchedAt:  new Date().toISOString(),
  });
});

// GET /api/signals/:ticker
app.get('/api/signals/:ticker', (req, res) => {
  const cfg   = loadConfig();
  const since = req.query.since || new Date(Date.now() - 48 * 3600_000).toISOString();
  const raw   = db.getSignals({ limit: 20, ticker: req.params.ticker, since });
  const ranked = rankSignals(raw, cfg.watchlist || []);
  res.json({ signals: ranked.map(s => ({ ...s, age: timeAgo(s.created_at) })) });
});

// POST /api/crawl — manual trigger
app.post('/api/crawl', async (req, res) => {
  if (state.status !== 'idle') {
    return res.json({ ok: false, message: 'Crawl already in progress', status: state.status });
  }
  res.json({ ok: true, message: 'Crawl started' });
  runPipeline().catch(console.error);
});

// GET /api/status
app.get('/api/status', (req, res) => {
  const cfg   = loadConfig();
  const stats = db.getSignalStats();
  res.json({
    ...state,
    watchlist:     cfg.watchlist,
    sourceCount:   (cfg.sources || []).filter(s => s.enabled).length,
    stats,
    modelUsed:     cfg.analystModel || process.env.ANALYST_MODEL || 'llama3.2',
  });
});

// GET /api/config
app.get('/api/config', (req, res) => {
  const cfg = loadConfig();
  res.json({ watchlist: cfg.watchlist, sources: cfg.sources, signalConfidenceThreshold: cfg.signalConfidenceThreshold });
});

// GET /api/models — list available Ollama models
app.get('/api/models', async (req, res) => {
  try {
    const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const response = await fetch(`${ollamaBase}/api/tags`);
    const data = await response.json();
    const models = (data.models || []).map(m => m.name);
    const cfg = loadConfig();
    res.json({ models, active: cfg.analystModel || process.env.ANALYST_MODEL || 'llama3.2' });
  } catch (err) {
    res.status(503).json({ error: 'Ollama not reachable', models: [], active: null });
  }
});

// PUT /api/config/model — switch active model
app.put('/api/config/model', (req, res) => {
  const { model } = req.body;
  if (!model || typeof model !== 'string') return res.status(400).json({ error: 'model required' });
  const cfg = loadConfig();
  cfg.analystModel = model.trim();
  saveConfig(cfg);
  console.log(`[Config] Analyst model switched to: ${cfg.analystModel}`);
  res.json({ ok: true, model: cfg.analystModel });
});

// PUT /api/config/watchlist
app.put('/api/config/watchlist', (req, res) => {
  const { watchlist } = req.body;
  if (!Array.isArray(watchlist)) return res.status(400).json({ error: 'watchlist must be array' });
  const cfg = loadConfig();
  cfg.watchlist = watchlist.map(t => t.toUpperCase().trim()).filter(Boolean);

  // Auto-add RSS sources for any ticker that doesn't already have one
  const existingSymbols = new Set((cfg.sources || []).map(s => s.symbol.toUpperCase()));
  const added = [];
  for (const ticker of cfg.watchlist) {
    if (!existingSymbols.has(ticker)) {
      cfg.sources.push(
        {
          id:      `yf-${ticker.toLowerCase()}`,
          name:    'Yahoo Finance',
          type:    'rss',
          symbol:  ticker,
          enabled: true,
          url:     `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`,
        },
        {
          id:      `nq-${ticker.toLowerCase()}`,
          name:    'Nasdaq',
          type:    'rss',
          symbol:  ticker,
          enabled: true,
          url:     `https://www.nasdaq.com/feed/rssoutbound?symbol=${ticker}`,
        }
      );
      existingSymbols.add(ticker);
      added.push(ticker);
    }
  }

  if (added.length > 0) {
    console.log(`[Config] Auto-added RSS sources for: ${added.join(', ')}`);
  }

  saveConfig(cfg);
  res.json({ ok: true, watchlist: cfg.watchlist, sourcesAdded: added });
});


// POST /api/feedback/:signalId
app.post('/api/feedback/:id', (req, res) => {
  const { wasCorrect, note } = req.body;
  const ok = db.saveFeedback(req.params.id, wasCorrect, note);
  if (!ok) return res.status(404).json({ error: 'Signal not found' });
  res.json({ ok: true });
});

// GET /api/feedback/stats
app.get('/api/feedback/stats', (req, res) => {
  res.json(db.getFeedbackStats());
});

// ── Cron ──────────────────────────────────────────────────────────────────────

function startScheduler() {
  const cfg = loadConfig();
  const interval = parseInt(cfg.crawlIntervalMinutes || 5);
  // Every N minutes (cron every-minute pattern up to 59)
  const cronExp = `*/${Math.max(1, interval)} * * * *`;
  cron.schedule(cronExp, () => runPipeline().catch(console.error));
  console.log(`[Scheduler] Crawl scheduled every ${interval} minutes`);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// No API key required — using local Ollama

app.listen(PORT, () => {
  console.log(`\n┌─────────────────────────────────────────┐`);
  console.log(`│  Signal Intel — Trading Journal         │`);
  console.log(`│  http://localhost:${PORT}                  │`);
  console.log(`└─────────────────────────────────────────┘\n`);

  startScheduler();

  // Run immediately on startup
  setTimeout(() => runPipeline().catch(console.error), 1500);
});
