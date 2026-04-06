/**
 * Summarization pipeline.
 * Uses Xenova/distilbart-cnn-6-6 (~200 MB, downloads once on first use).
 * Produces a 2-3 sentence summary from article text.
 */
const { pipeline, env } = require('@xenova/transformers');

// Suppress ONNX Runtime "Removing initializer" W: warnings on macOS.
env.backends.onnx.logSeverityLevel = 3;

let _summarizer = null;
let _loading     = false;
let _loadWaiters = [];

async function getSummarizer() {
  if (_summarizer) return _summarizer;

  // Serialize concurrent callers — only one download at a time
  if (_loading) {
    return new Promise((res, rej) => _loadWaiters.push({ res, rej }));
  }

  _loading = true;
  try {
    console.log('[Summarizer] Loading distilbart-cnn-6-6 (downloads once, ~200 MB)...');
    _summarizer = await pipeline('summarization', 'Xenova/distilbart-cnn-6-6');
    console.log('[Summarizer] Model ready.');
    _loadWaiters.forEach(w => w.res(_summarizer));
    return _summarizer;
  } catch (err) {
    _loadWaiters.forEach(w => w.rej(err));
    throw err;
  } finally {
    _loading = false;
    _loadWaiters = [];
  }
}

/**
 * Summarize a block of text to 2-3 sentences.
 * text: plain text (strip HTML before passing).
 * Returns a string summary, or null on failure.
 */
async function summarize(text) {
  if (!text || text.length < 100) return null;

  try {
    const summarizer = await getSummarizer();

    // Truncate input — distilbart handles up to ~1024 tokens (~750 words)
    const input = text.slice(0, 3000);

    const result = await summarizer(input, {
      max_new_tokens: 80,
      min_new_tokens: 20,
      no_repeat_ngram_size: 3,
    });

    const summary = result?.[0]?.summary_text?.trim();
    return summary || null;
  } catch (err) {
    console.warn('[Summarizer] Failed:', err.message);
    return null;
  }
}

/**
 * Strip HTML tags and collapse whitespace for plain-text input to the summarizer.
 */
function toPlainText(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { summarize, toPlainText };
