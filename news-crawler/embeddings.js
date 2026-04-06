/**
 * Embedding pipeline — sentence similarity scoring and deduplication.
 * Uses Xenova/bge-small-en-v1.5 (33 MB, downloads once on first use).
 * Outperforms all-MiniLM-L6-v2 on semantic similarity benchmarks at similar speed.
 */
const { pipeline } = require('@xenova/transformers');

let _embedder = null;

async function getEmbedder() {
  if (!_embedder) {
    console.log('[Embeddings] Loading bge-small-en-v1.5 (downloads once on first use)...');
    _embedder = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');
    console.log('[Embeddings] Model ready.');
  }
  return _embedder;
}

// Returns a plain Float32Array embedding for a text string.
async function embed(text) {
  const embedder = await getEmbedder();
  const out = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

// Embed a batch of strings — returns array of Float32Arrays in same order.
async function embedBatch(texts) {
  return Promise.all(texts.map(t => embed(t)));
}

// Cosine similarity between two normalized vectors (already L2-normalized by MiniLM).
function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are unit-length so dot == cosine
}

/**
 * Score an article against the active taxonomy.
 * Returns { score, matchedCategory, matchedSignal } where score is 0-1.
 * Score is the max similarity across all enabled signals, weighted by category weight.
 */
async function scoreArticle(articleText, taxonomy) {
  const vec = await embed(articleText);

  let best = { score: 0, matchedCategory: null, matchedSignal: null };

  for (const cat of taxonomy.categories) {
    if (!cat.enabled) continue;
    for (const signal of cat.signals) {
      const sigVec = await embed(signal);
      const sim = cosine(vec, sigVec) * (cat.weight ?? 1.0);
      if (sim > best.score) {
        best = { score: sim, matchedCategory: cat.label, matchedSignal: signal };
      }
    }
  }

  return best;
}

/**
 * Score an article using pre-embedded signal vectors for efficiency.
 * Returns:
 *   score          — overall best weighted similarity
 *   matchedCategory — label of best-matching category
 *   matchedSignal   — best-matching signal phrase
 *   categoryMatches — Array of { category, signal, score } for ALL categories
 *                     that beat the raw (unweighted) similarity threshold of 0.20,
 *                     sorted by score desc. Used to render multi-category pills.
 */
function scoreArticleWithCache(articleVec, signalEntries) {
  // Track best score per category
  const byCategory = {};
  for (const entry of signalEntries) {
    const sim = cosine(articleVec, entry.vec);
    const weighted = sim * entry.weight;
    if (!byCategory[entry.categoryLabel] || weighted > byCategory[entry.categoryLabel].score) {
      byCategory[entry.categoryLabel] = {
        category: entry.categoryLabel,
        signal:   entry.signal,
        score:    weighted,
        rawSim:   sim,
      };
    }
  }

  const allMatches = Object.values(byCategory).sort((a, b) => b.score - a.score);
  const best       = allMatches[0] || { score: 0, category: null, signal: null };

  // Keep only categories where the raw (unweighted) similarity cleared a floor
  const categoryMatches = allMatches
    .filter(m => m.rawSim >= 0.20)
    .map(m => ({ category: m.category, signal: m.signal, score: +m.score.toFixed(3) }));

  return {
    score:           best.score,
    matchedCategory: best.category,
    matchedSignal:   best.signal,
    categoryMatches,
  };
}

/**
 * Pre-embed all signals in the taxonomy into a flat lookup array.
 * Call once per report run to avoid re-embedding the same signals for every article.
 */
async function buildSignalCache(taxonomy) {
  const entries = [];
  for (const cat of taxonomy.categories) {
    if (!cat.enabled) continue;
    for (const signal of cat.signals) {
      const vec = await embed(signal);
      entries.push({ vec, categoryLabel: cat.label, signal, weight: cat.weight ?? 1.0 });
    }
  }
  return entries;
}

/**
 * Deduplicate articles by embedding similarity.
 * Returns clusters: each cluster is an array of articles, sorted by content length desc.
 * dedupeThreshold: articles with similarity >= this are considered the same story.
 */
async function deduplicateArticles(articles, dedupeThreshold = 0.82) {
  if (articles.length === 0) return [];

  // Reuse pre-computed _vec if present (avoids a second model pass); fall back to embedding.
  const vecs = await Promise.all(
    articles.map(a => a._vec ? Promise.resolve(a._vec) : embed(`${a.title} ${a.description || ''}`))
  );

  const used    = new Array(articles.length).fill(false);
  const clusters = [];

  for (let i = 0; i < articles.length; i++) {
    if (used[i]) continue;
    const cluster = [{ article: articles[i], vec: vecs[i] }];
    used[i] = true;

    for (let j = i + 1; j < articles.length; j++) {
      if (used[j]) continue;
      if (cosine(vecs[i], vecs[j]) >= dedupeThreshold) {
        cluster.push({ article: articles[j], vec: vecs[j] });
        used[j] = true;
      }
    }

    // Sort cluster: prefer articles with longer Readability content
    cluster.sort((a, b) => (b.article.contentLength || 0) - (a.article.contentLength || 0));
    clusters.push(cluster);
  }

  return clusters;
}

module.exports = { embed, embedBatch, cosine, scoreArticle, scoreArticleWithCache, buildSignalCache, deduplicateArticles };
