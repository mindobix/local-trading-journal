const crawlRSS = require('./rss');

async function crawlAllSources(config) {
  const enabled = (config.sources || []).filter(s => s.enabled !== false);
  const results = await Promise.allSettled(
    enabled.map(s => crawlSource(s, config.maxArticlesPerSource || 25))
  );

  const articles = [];
  for (const r of results) {
    if (r.status === 'fulfilled') articles.push(...r.value);
    else console.error('[Crawler] Source failed:', r.reason?.message);
  }
  return articles;
}

async function crawlSource(source, limit) {
  switch (source.type) {
    case 'rss':
    case 'atom':
      return crawlRSS(source, limit);
    default:
      console.warn(`[Crawler] Unsupported source type "${source.type}" — skipping "${source.name}"`);
      return [];
  }
}

module.exports = { crawlAllSources };
