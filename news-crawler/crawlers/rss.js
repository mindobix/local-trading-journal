/**
 * Generic RSS / Atom feed crawler
 */
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const crypto = require('crypto');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['item', 'entry'].includes(name)  // 'link' intentionally excluded — RSS <link> is single-valued
});

function id(...parts) {
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
    .replace(/\s+/g, ' ').trim();
}

function getText(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return getText(node[0]);          // handle unexpected arrays
  return String(node['#text'] ?? node._ ?? '');
}

// Handles <link> nodes which may be a plain string, an object with @_href (Atom),
// an object with #text (RSS with attributes), or an array of any of the above.
function resolveLink(node, fallback = '') {
  if (!node) return fallback;
  if (Array.isArray(node)) {
    // Atom: find rel="alternate" first, otherwise first entry
    const alt = node.find(l => l['@_rel'] === 'alternate') || node[0];
    return resolveLink(alt, fallback);
  }
  if (typeof node === 'string') return node || fallback;
  // Atom <link href="..." /> or RSS <link type="...">url</link>
  const href = node['@_href'] || node['#text'] || node._ || '';
  return String(href) || fallback;
}

async function crawlRSS(source, limit = 25) {
  try {
    const resp = await axios.get(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*'
      },
      timeout: 15000,
      responseType: 'text'
    });

    const parsed = parser.parse(resp.data);
    const articles = [];

    // ── RSS 2.0 ──
    const channel = parsed.rss?.channel || parsed['rss:channel'];
    if (channel) {
      const items = Array.isArray(channel.item) ? channel.item : (channel.item ? [channel.item] : []);
      for (const item of items.slice(0, limit)) {
        const title = strip(getText(item.title));
        if (!title) continue;
        const link  = resolveLink(item.link) || resolveLink(item.guid) || source.url;
        const desc  = strip(getText(item.description) || getText(item['content:encoded']) || '');
        const pub   = getText(item.pubDate) || getText(item['dc:date']) || '';
        articles.push({
          id: id(link, source.id),
          symbol: source.symbol || 'MARKET',
          title,
          description: desc.slice(0, 280),
          url: String(link).startsWith('http') ? link : source.url,
          source: source.name,
          sourceUrl: source.url,
          publishedAt: parseDate(pub),
          crawledAt: new Date().toISOString()
        });
      }
    }

    // ── Atom ──
    const feed = parsed.feed || parsed['atom:feed'];
    if (feed && articles.length === 0) {
      const entries = Array.isArray(feed.entry) ? feed.entry : (feed.entry ? [feed.entry] : []);
      for (const entry of entries.slice(0, limit)) {
        const title = strip(getText(entry.title));
        if (!title) continue;
        const link = resolveLink(entry.link) || source.url;
        const desc = strip(getText(entry.summary) || getText(entry.content) || '');
        const pub  = getText(entry.published) || getText(entry.updated) || '';
        articles.push({
          id: id(link, source.id),
          symbol: source.symbol || 'MARKET',
          title,
          description: desc.slice(0, 280),
          url: String(link).startsWith('http') ? link : source.url,
          source: source.name,
          sourceUrl: source.url,
          publishedAt: parseDate(pub),
          crawledAt: new Date().toISOString()
        });
      }
    }

    return articles;
  } catch (err) {
    console.error(`[RSS] ${source.name} error:`, err.message);
    return [];
  }
}

module.exports = crawlRSS;
