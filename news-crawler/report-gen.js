/**
 * Report generation pipeline.
 * For a given symbol + window:
 *   1. Load articles from news.json
 *   2. Load Readability cache for article content
 *   3. Score each article against signal taxonomy (embedding similarity)
 *   4. Filter to signal articles above threshold
 *   5. Deduplicate by embedding similarity
 *   6. Summarize each deduplicated representative article
 *   7. Assemble and persist report to data/reports/{symbol}.json
 */
const fs   = require('fs').promises;
const path = require('path');
const { buildSignalCache, scoreArticleWithCache, deduplicateArticles, embed } = require('./embeddings');
const { summarize, toPlainText } = require('./summarizer');

const DATA_DIR    = path.join(__dirname, '..', 'data');
const NEWS_FILE   = path.join(DATA_DIR, 'news.json');
const ARTICLES_DIR = path.join(DATA_DIR, 'articles');
const REPORTS_DIR  = path.join(DATA_DIR, 'reports');
const TAXONOMY_FILE = path.join(DATA_DIR, 'signal-taxonomy.json');


// ─── Taxonomy helpers ─────────────────────────────────────────────────────────

async function loadTaxonomy() {
  try {
    return JSON.parse(await fs.readFile(TAXONOMY_FILE, 'utf8'));
  } catch {
    // Fallback: return a minimal pass-through taxonomy
    return { version: 1, signalThreshold: 0.28, dedupeThreshold: 0.82, categories: [] };
  }
}

async function saveTaxonomy(taxonomy) {
  await fs.writeFile(TAXONOMY_FILE, JSON.stringify(taxonomy, null, 2));
}

// ─── Article content helpers ──────────────────────────────────────────────────

async function loadArticleContent(id) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(ARTICLES_DIR, `${id}.json`), 'utf8'));
    if (data.failed) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Sentiment helper ─────────────────────────────────────────────────────────

const BULLISH_WORDS = /beat|surged?|soared?|raised?|upgraded?|record|approval|approved|won|gains?|rally|rises?|rose|outperform|buy rating|strong buy|above estimates/i;
const BEARISH_WORDS = /miss(ed)?|fell?|drop(ped)?|lowered?|downgraded?|recall|investigation|fine|penalty|layoffs?|cut|below estimates|warning|concern|fear|decline/i;

function detectSentiment(articles) {
  let bull = 0, bear = 0;
  for (const a of articles) {
    const text = `${a.title} ${a.description || ''}`;
    const b = (text.match(BULLISH_WORDS) || []).length;
    const be = (text.match(BEARISH_WORDS) || []).length;
    bull += b; bear += be;
  }
  if (bull === 0 && bear === 0) return 'neutral';
  if (bull > bear * 1.3) return 'bullish';
  if (bear > bull * 1.3) return 'bearish';
  return 'mixed';
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

/**
 * Generate a report for a symbol over the past `windowMs` milliseconds.
 * Persists to data/reports/{symbol}.json and returns the report object.
 */
async function generateReport(symbol, windowMs = 4 * 3600 * 1000) {
  console.log(`[Report] Generating for ${symbol} (${windowMs / 3600000}h window)...`);

  await fs.mkdir(REPORTS_DIR, { recursive: true });

  // 1. Load articles for this symbol within the window
  const news = JSON.parse(await fs.readFile(NEWS_FILE, 'utf8'));
  const cutoff = Date.now() - windowMs;
  const allArticles = (news.articles || []).filter(a =>
    (a.symbol === symbol || symbol === 'ALL') &&
    new Date(a.publishedAt).getTime() >= cutoff
  );

  if (allArticles.length === 0) {
    const report = { symbol, generatedAt: new Date().toISOString(), windowMs,
      sentiment: 'neutral', signalArticles: [], noiseCount: 0, clusters: [] };
    await fs.writeFile(path.join(REPORTS_DIR, `${symbol}.json`), JSON.stringify(report));
    return report;
  }

  // 2. Load taxonomy and build signal cache (embed signals once)
  const taxonomy     = await loadTaxonomy();
  const signalCache  = await buildSignalCache(taxonomy);
  const threshold    = taxonomy.signalThreshold ?? 0.28;
  const dedupeThresh = taxonomy.dedupeThreshold ?? 0.82;

  // 3. Score all articles — attach Readability content length for dedup ranking
  const scored = [];
  for (const article of allArticles) {
    const cached = await loadArticleContent(article.id);
    const articleText = `${article.title} ${article.description || ''}`;
    const articleVec  = await embed(articleText);
    const { score, matchedCategory, matchedSignal, categoryMatches } = scoreArticleWithCache(articleVec, signalCache);

    scored.push({
      ...article,
      _vec:              articleVec,
      _score:            score,
      _matchedCat:       matchedCategory,
      _matchedSignal:    matchedSignal,
      _categoryMatches:  categoryMatches,
      _content:          cached?.content || null,
      contentLength:     cached?.length  || 0,
    });
  }

  const signalArticles = scored.filter(a => a._score >= threshold)
    .sort((a, b) => b._score - a._score);
  const noiseCount = scored.length - signalArticles.length;

  console.log(`[Report] ${symbol}: ${signalArticles.length} signal, ${noiseCount} noise out of ${scored.length} total`);

  // 4. Deduplicate signal articles
  const clusters = await deduplicateArticles(signalArticles, dedupeThresh);

  // 5. Summarize each cluster representative
  const outputClusters = [];
  for (const cluster of clusters) {
    const rep     = cluster[0].article;  // highest content-length article in cluster
    const content = rep._content ? toPlainText(rep._content) : `${rep.title}. ${rep.description || ''}`;
    const summary = await summarize(content);

    outputClusters.push({
      representative: {
        id:             rep.id,
        title:          rep.title,
        url:            rep.url,
        source:         rep.source,
        publishedAt:    rep.publishedAt,
        score:           +rep._score.toFixed(3),
        matchedCategory: rep._matchedCat,
        matchedSignal:   rep._matchedSignal,
        categoryMatches: rep._categoryMatches || [],
        summary:         summary || rep.description?.slice(0, 200) || '',
      },
      duplicates: cluster.slice(1).map(c => ({
        id:     c.article.id,
        title:  c.article.title,
        source: c.article.source,
        url:    c.article.url,
      })),
    });
  }

  // 6. Sentiment
  const sentiment = detectSentiment(signalArticles);

  const report = {
    symbol,
    generatedAt: new Date().toISOString(),
    windowMs,
    sentiment,
    totalArticles:  scored.length,
    signalCount:    signalArticles.length,
    noiseCount,
    clusters:       outputClusters,
    // Top raw signal articles (before dedup) for the feed highlight view
    topSignals:     signalArticles.slice(0, 10).map(a => ({
      id:              a.id,
      title:           a.title,
      url:             a.url,
      source:          a.source,
      publishedAt:     a.publishedAt,
      score:           +a._score.toFixed(3),
      matchedCategory: a._matchedCat,
      matchedSignal:   a._matchedSignal,
      categoryMatches: a._categoryMatches || [],
    })),
  };

  await fs.writeFile(path.join(REPORTS_DIR, `${symbol}.json`), JSON.stringify(report, null, 2));
  console.log(`[Report] ${symbol} done — sentiment: ${sentiment}, ${outputClusters.length} unique stories`);
  return report;
}

/**
 * Generate reports for all tracked symbols + MACRO + MARKET.
 */
async function generateAllReports(config) {
  const symbols = [...(config.symbols || []), 'MARKET'];
  for (const sym of symbols) {
    try {
      await generateReport(sym);
    } catch (err) {
      console.error(`[Report] Error for ${sym}:`, err.message);
    }
  }
}

module.exports = { generateReport, generateAllReports, loadTaxonomy, saveTaxonomy };
