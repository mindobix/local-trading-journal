/**
 * RSS/Atom feed crawler.
 * Ported from the working implementation in local-trading-journal/news-crawler.
 * Groups articles by ticker for batch analysis.
 */
const axios    = require('axios');
const crypto   = require('crypto');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  textNodeName:        '#text',
  isArray: name => ['item', 'entry'].includes(name),
});

function hash(...parts) {
  return crypto.createHash('md5').update(parts.join('|')).digest('hex');
}

function parseDate(s) {
  if (!s) return new Date().toISOString();
  try { const d = new Date(s); return isNaN(d) ? new Date().toISOString() : d.toISOString(); }
  catch { return new Date().toISOString(); }
}

function strip(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/\s+/g, ' ').trim();
}

function getText(node) {
  if (node == null)               return '';
  if (typeof node === 'string')   return node;
  if (typeof node === 'number')   return String(node);
  if (Array.isArray(node))        return getText(node[0]);
  return String(node['#text'] ?? node._ ?? '');
}

function resolveLink(node, fallback = '') {
  if (!node) return fallback;
  if (Array.isArray(node)) {
    const alt = node.find(l => l['@_rel'] === 'alternate') || node[0];
    return resolveLink(alt, fallback);
  }
  if (typeof node === 'string') return node || fallback;
  return String(node['@_href'] || node['#text'] || node._ || '') || fallback;
}

async function crawlFeed(source, limit = 20) {
  try {
    const resp = await axios.get(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept':     'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 12000,
      responseType: 'text',
    });

    const parsed   = parser.parse(resp.data);
    const articles = [];

    // RSS 2.0
    const channel = parsed.rss?.channel;
    if (channel) {
      const items = Array.isArray(channel.item) ? channel.item : (channel.item ? [channel.item] : []);
      for (const item of items.slice(0, limit)) {
        const title = strip(getText(item.title));
        if (!title) continue;
        const link = resolveLink(item.link) || resolveLink(item.guid) || source.url;
        articles.push({
          id:          hash(link, source.id),
          ticker:      source.symbol,
          title,
          description: strip(getText(item.description) || getText(item['content:encoded']) || '').slice(0, 300),
          url:         String(link).startsWith('http') ? link : source.url,
          source:      source.name,
          publishedAt: parseDate(getText(item.pubDate) || getText(item['dc:date'])),
        });
      }
    }

    // Atom
    const feed = parsed.feed;
    if (feed && articles.length === 0) {
      const entries = Array.isArray(feed.entry) ? feed.entry : (feed.entry ? [feed.entry] : []);
      for (const entry of entries.slice(0, limit)) {
        const title = strip(getText(entry.title));
        if (!title) continue;
        const link = resolveLink(entry.link) || source.url;
        articles.push({
          id:          hash(link, source.id),
          ticker:      source.symbol,
          title,
          description: strip(getText(entry.summary) || getText(entry.content) || '').slice(0, 300),
          url:         String(link).startsWith('http') ? link : source.url,
          source:      source.name,
          publishedAt: parseDate(getText(entry.published) || getText(entry.updated)),
        });
      }
    }

    // Keep only articles published today (local midnight → now)
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    return articles.filter(a => new Date(a.publishedAt) >= todayMidnight);

  } catch (err) {
    console.error(`[Crawler] ${source.name} (${source.symbol}): ${err.message}`);
    return [];
  }
}

async function crawlAll(sources, limit = 20) {
  const enabled = (sources || []).filter(s => s.enabled !== false);
  const results = await Promise.allSettled(enabled.map(s => crawlFeed(s, limit)));

  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  // Group by ticker
  const byTicker = {};
  for (const article of all) {
    const t = article.ticker || 'MARKET';
    if (!byTicker[t]) byTicker[t] = [];
    byTicker[t].push(article);
  }

  // Deduplicate within each ticker by article ID
  for (const ticker of Object.keys(byTicker)) {
    const seen = new Set();
    byTicker[ticker] = byTicker[ticker].filter(a => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }

  return byTicker;
}

module.exports = { crawlAll, crawlFeed };
