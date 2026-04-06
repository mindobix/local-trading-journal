/**
 * Report generation pipeline.
 * For a given symbol + window:
 *   1. Load articles from news.json
 *   2. Skip already-processed articles via per-symbol score cache (data/processed/)
 *      — cache is invalidated automatically when the signal taxonomy changes
 *   3. Embed new articles (embedding vectors cached to data/embeddings/)
 *   4. Score new articles against signal taxonomy
 *   5. Merge new scores with cached scores, filter to signal threshold
 *   6. Deduplicate by embedding similarity (reuses pre-computed vectors)
 *   7. Summarize each cluster representative (summaries cached to data/summaries/)
 *   8. Assemble and persist report to data/reports/{symbol}.json
 */
const fs   = require('fs').promises;
const path = require('path');
const { buildSignalCache, scoreArticleWithCache, deduplicateArticles, embed } = require('./embeddings');
const { summarize, toPlainText } = require('./summarizer');

const DATA_DIR       = path.join(__dirname, '..', 'data');
const NEWS_FILE      = path.join(DATA_DIR, 'news.json');
const ARTICLES_DIR   = path.join(DATA_DIR, 'articles');
const REPORTS_DIR    = path.join(DATA_DIR, 'reports');
const EMBEDDINGS_DIR = path.join(DATA_DIR, 'embeddings');
const SUMMARIES_DIR  = path.join(DATA_DIR, 'summaries');
const PROCESSED_DIR  = path.join(DATA_DIR, 'processed');
const TAXONOMY_FILE  = path.join(DATA_DIR, 'signal-taxonomy.json');

// Bump when the embedding model changes so stale vectors are discarded.
const EMBED_MODEL = 'bge-small-en-v1.5';


// ─── Taxonomy helpers ─────────────────────────────────────────────────────────

async function loadTaxonomy() {
  try { return JSON.parse(await fs.readFile(TAXONOMY_FILE, 'utf8')); }
  catch { return { version: 1, signalThreshold: 0.28, dedupeThreshold: 0.82, categories: [] }; }
}

async function saveTaxonomy(taxonomy) {
  await fs.writeFile(TAXONOMY_FILE, JSON.stringify(taxonomy, null, 2));
}

// djb2 hash of the taxonomy's signals + thresholds.
// Used to detect taxonomy edits so the score cache can be invalidated.
function _taxonomyHash(taxonomy) {
  const sig = JSON.stringify(
    (taxonomy.categories || []).map(c => ({
      id: c.id, enabled: c.enabled, weight: c.weight,
      signals: (c.signals || []).slice().sort(),
    }))
  ) + `|${taxonomy.signalThreshold}|${taxonomy.dedupeThreshold}`;
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = (h * 33 ^ sig.charCodeAt(i)) >>> 0;
  return h.toString(16);
}


// ─── Per-symbol score cache (data/processed/{symbol}.json) ───────────────────
// Stores { taxonomyHash, articles: { [id]: { score, matchedCategory, matchedSignal, categoryMatches } } }
// Automatically invalidated when taxonomyHash changes.

async function _loadScoreCache(symbol, txHash) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(PROCESSED_DIR, `${symbol}.json`), 'utf8'));
    if (data.taxonomyHash !== txHash) {
      console.log(`[Report] ${symbol} | taxonomy changed — score cache invalidated`);
      return {};
    }
    return data.articles || {};
  } catch { return {}; }
}

async function _saveScoreCache(symbol, txHash, articles) {
  try {
    await fs.mkdir(PROCESSED_DIR, { recursive: true });
    await fs.writeFile(
      path.join(PROCESSED_DIR, `${symbol}.json`),
      JSON.stringify({ taxonomyHash: txHash, articles })
    );
  } catch {}
}


// ─── Embedding cache (data/embeddings/{id}.json) ─────────────────────────────

async function _loadEmbed(id) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(EMBEDDINGS_DIR, `${id}.json`), 'utf8'));
    return data.model === EMBED_MODEL ? data.vec : null;
  } catch { return null; }
}

async function _saveEmbed(id, vec) {
  try {
    await fs.writeFile(
      path.join(EMBEDDINGS_DIR, `${id}.json`),
      JSON.stringify({ model: EMBED_MODEL, vec })
    );
  } catch {}
}


// ─── Summary cache (data/summaries/{id}.txt) ──────────────────────────────────

async function _loadSummary(id) {
  try { return await fs.readFile(path.join(SUMMARIES_DIR, `${id}.txt`), 'utf8'); }
  catch { return null; }
}

async function _saveSummary(id, text) {
  try { await fs.writeFile(path.join(SUMMARIES_DIR, `${id}.txt`), text); }
  catch {}
}


// ─── Article content helper ───────────────────────────────────────────────────

async function loadArticleContent(id) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(ARTICLES_DIR, `${id}.json`), 'utf8'));
    return data.failed ? null : data;
  } catch { return null; }
}


// ─── Sentiment helper ─────────────────────────────────────────────────────────

const BULLISH_WORDS = /beat|surged?|soared?|raised?|upgraded?|record|approval|approved|won|gains?|rally|rises?|rose|outperform|buy rating|strong buy|above estimates/i;
const BEARISH_WORDS = /miss(ed)?|fell?|drop(ped)?|lowered?|downgraded?|recall|investigation|fine|penalty|layoffs?|cut|below estimates|warning|concern|fear|decline/i;

function detectSentiment(articles) {
  let bull = 0, bear = 0;
  for (const a of articles) {
    const text = `${a.title} ${a.description || ''}`;
    bull += (text.match(BULLISH_WORDS) || []).length;
    bear += (text.match(BEARISH_WORDS) || []).length;
  }
  if (bull === 0 && bear === 0) return 'neutral';
  if (bull > bear * 1.3) return 'bullish';
  if (bear > bull * 1.3) return 'bearish';
  return 'mixed';
}


// ─── Core pipeline ────────────────────────────────────────────────────────────

/**
 * @param {string} symbol
 * @param {number} windowMs      - look-back window in ms (default 4 h)
 * @param {Set}    newArticleIds - IDs from the latest crawl (for logging only)
 */
async function generateReport(symbol, windowMs = 4 * 3600 * 1000, newArticleIds = new Set()) {
  const t0 = Date.now();
  const windowH = (windowMs / 3600000).toFixed(0);

  await fs.mkdir(REPORTS_DIR,    { recursive: true });
  await fs.mkdir(EMBEDDINGS_DIR, { recursive: true });
  await fs.mkdir(SUMMARIES_DIR,  { recursive: true });
  await fs.mkdir(PROCESSED_DIR,  { recursive: true });

  // ── 1. Load articles in window ───────────────────────────────────────────────
  const news = JSON.parse(await fs.readFile(NEWS_FILE, 'utf8'));
  const cutoff = Date.now() - windowMs;
  const allArticles = (news.articles || []).filter(a =>
    (a.symbol === symbol || symbol === 'ALL') &&
    new Date(a.publishedAt).getTime() >= cutoff
  );

  const newCount = allArticles.filter(a => newArticleIds.has(a.id)).length;
  console.log(`[Report] ▶ ${symbol} | ${allArticles.length} articles in ${windowH}h window (${newCount} new this crawl)`);

  if (allArticles.length === 0) {
    const report = {
      symbol, generatedAt: new Date().toISOString(), windowMs,
      sentiment: 'neutral', totalArticles: 0, signalCount: 0, noiseCount: 0,
      clusters: [], topSignals: [],
    };
    await fs.writeFile(path.join(REPORTS_DIR, `${symbol}.json`), JSON.stringify(report));
    console.log(`[Report] ✓ ${symbol} — no articles in window`);
    return report;
  }

  // ── 2. Taxonomy + signal vector cache ────────────────────────────────────────
  const taxonomy    = await loadTaxonomy();
  const txHash      = _taxonomyHash(taxonomy);
  const signalCache = await buildSignalCache(taxonomy);
  const threshold    = taxonomy.signalThreshold  ?? 0.28;
  const dedupeThresh = taxonomy.dedupeThreshold  ?? 0.82;

  // ── 3. Score articles — skip already-processed ones via score cache ───────────
  const scoreCache   = await _loadScoreCache(symbol, txHash);
  const updatedCache = Object.assign({}, scoreCache);  // will be saved at end

  let cacheHits = 0, cacheMiss = 0, embedHits = 0, embedMiss = 0;
  const scored = [];

  for (const article of allArticles) {
    const cached = scoreCache[article.id];

    let score, matchedCategory, matchedSignal, categoryMatches, vec;

    if (cached) {
      // ── Already scored: restore from cache ──────────────────────────────────
      cacheHits++;
      ({ score, matchedCategory, matchedSignal, categoryMatches } = cached);

      // Only need the embedding vector for signal articles (used in dedup step).
      if (score >= threshold) {
        vec = await _loadEmbed(article.id);
        if (!vec) {
          // Edge case: score cached but embedding file missing — re-embed once.
          vec = await embed(`${article.title} ${article.description || ''}`);
          await _saveEmbed(article.id, vec);
        }
      }

    } else {
      // ── New article: embed + score ───────────────────────────────────────────
      cacheMiss++;

      vec = await _loadEmbed(article.id);
      if (vec) {
        embedHits++;
      } else {
        embedMiss++;
        process.stdout.write(
          `\r[Report] ${symbol} | embedding ${embedMiss} new article${embedMiss !== 1 ? 's' : ''}...   `
        );
        vec = await embed(`${article.title} ${article.description || ''}`);
        await _saveEmbed(article.id, vec);
      }

      const result = scoreArticleWithCache(vec, signalCache);
      score           = result.score;
      matchedCategory = result.matchedCategory;
      matchedSignal   = result.matchedSignal;
      categoryMatches = result.categoryMatches;

      // Persist score to cache so this article is skipped next run.
      updatedCache[article.id] = { score, matchedCategory, matchedSignal, categoryMatches };
    }

    // Load Readability content only for signal articles (needed for dedup ranking + summarisation).
    let content = null, contentLength = 0;
    if (score >= threshold) {
      const ac = await loadArticleContent(article.id);
      content = ac?.content || null;
      contentLength = ac?.length || 0;
    }

    scored.push({
      ...article,
      _vec: vec,
      _score: score,
      _matchedCat: matchedCategory,
      _matchedSignal: matchedSignal,
      _categoryMatches: categoryMatches || [],
      _content: content,
      contentLength,
    });
  }

  if (embedMiss > 0) process.stdout.write('\n');

  // Persist updated score cache (prune entries no longer in the window).
  const windowIds = new Set(allArticles.map(a => a.id));
  const pruned = Object.fromEntries(
    Object.entries(updatedCache).filter(([id]) => windowIds.has(id))
  );
  await _saveScoreCache(symbol, txHash, pruned);

  const tScore = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[Report] ${symbol} | score cache: ${cacheHits} hit, ${cacheMiss} miss` +
    (embedMiss > 0 ? ` (${embedHits} embed-cached + ${embedMiss} new)` : '') +
    ` | ${tScore}s`
  );

  const signalArticles = scored
    .filter(a => a._score >= threshold)
    .sort((a, b) => b._score - a._score);
  const noiseCount = scored.length - signalArticles.length;
  console.log(`[Report] ${symbol} | ${signalArticles.length} signal, ${noiseCount} noise`);

  // ── 4. Deduplicate (reuses _vec — no second embed pass) ──────────────────────
  const clusters = await deduplicateArticles(signalArticles, dedupeThresh);
  console.log(
    `[Report] ${symbol} | dedup: ${clusters.length} unique cluster${clusters.length !== 1 ? 's' : ''}` +
    ` from ${signalArticles.length} signal articles`
  );

  // ── 5. Summarise cluster representatives (summary cache avoids re-running) ────
  let sumHits = 0, sumMiss = 0;
  const outputClusters = [];

  for (const cluster of clusters) {
    const rep = cluster[0].article;

    let summary = await _loadSummary(rep.id);
    if (summary) {
      sumHits++;
    } else {
      sumMiss++;
      const shortTitle = rep.title.length > 55 ? rep.title.slice(0, 55) + '…' : rep.title;
      console.log(`[Report] ${symbol} | summarising [${sumMiss}] "${shortTitle}"`);
      const content = rep._content ? toPlainText(rep._content) : `${rep.title}. ${rep.description || ''}`;
      summary = await summarize(content);
      if (summary) await _saveSummary(rep.id, summary);
    }

    outputClusters.push({
      representative: {
        id:              rep.id,
        title:           rep.title,
        url:             rep.url,
        source:          rep.source,
        publishedAt:     rep.publishedAt,
        score:           +rep._score.toFixed(3),
        matchedCategory: rep._matchedCat,
        matchedSignal:   rep._matchedSignal,
        categoryMatches: rep._categoryMatches || [],
        summary:         summary || rep.description?.slice(0, 200) || '',
      },
      duplicates: cluster.slice(1).map(c => ({
        id: c.article.id, title: c.article.title,
        source: c.article.source, url: c.article.url,
      })),
    });
  }

  if (sumHits > 0 || sumMiss > 0)
    console.log(`[Report] ${symbol} | summaries: ${sumHits} cached + ${sumMiss} new`);

  // ── 6. Assemble & persist ─────────────────────────────────────────────────────
  const sentiment = detectSentiment(signalArticles);
  const elapsed   = ((Date.now() - t0) / 1000).toFixed(1);

  const report = {
    symbol,
    generatedAt:   new Date().toISOString(),
    windowMs,
    sentiment,
    totalArticles: scored.length,
    signalCount:   signalArticles.length,
    noiseCount,
    clusters:      outputClusters,
    topSignals:    signalArticles.slice(0, 10).map(a => ({
      id: a.id, title: a.title, url: a.url, source: a.source, publishedAt: a.publishedAt,
      score: +a._score.toFixed(3),
      matchedCategory: a._matchedCat, matchedSignal: a._matchedSignal,
      categoryMatches: a._categoryMatches || [],
    })),
  };

  await fs.writeFile(path.join(REPORTS_DIR, `${symbol}.json`), JSON.stringify(report, null, 2));
  console.log(`[Report] ✓ ${symbol} | ${sentiment} | ${outputClusters.length} stories | ${elapsed}s total`);
  return report;
}

/**
 * Generate reports for all tracked symbols + MARKET.
 */
async function generateAllReports(config) {
  const symbols = [...(config.symbols || []), 'MARKET'];
  for (const sym of symbols) {
    try { await generateReport(sym); }
    catch (err) { console.error(`[Report] ✗ ${sym}: ${err.message}`); }
  }
}

module.exports = { generateReport, generateAllReports, loadTaxonomy, saveTaxonomy };
