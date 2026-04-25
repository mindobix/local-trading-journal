/**
 * Ollama Analyst Brain — free local LLM replacement for Claude API.
 *
 * Requires Ollama running locally: https://ollama.com
 *   brew install ollama
 *   ollama serve
 *   ollama pull llama3.2   (or mistral, gemma2, qwen2.5, etc.)
 */
require('dotenv').config();
const axios = require('axios');

const OLLAMA_BASE  = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const MAX_ARTS     = 5;
const DESC_SLICE   = 150;
const REQ_TIMEOUT  = 180_000;
const CONCURRENCY  = 3;

// Repair common llama JSON quirks before parsing.
function _sanitizeJson(text) {
  return text
    .replace(/:\s*NULL\b/g,  ': null')
    .replace(/:\s*True\b/g,  ': true')
    .replace(/:\s*False\b/g, ': false')
    .replace(/,(\s*[}\]])/g, '$1');   // trailing commas
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a professional equity analyst specializing in actionable trading signals.

Your job is NOT to summarize news. Your job is to determine: does this event require a trader to ACT, WATCH, or IGNORE?

Most financial news is noise. Be conservative — only surface signals where the event has clear directional implications for the stock price within a tradeable time horizon.

DIRECTION OPTIONS:
- BULLISH_SHORT_TERM: Positive catalyst, price strength expected within 1-5 trading days
- BEARISH_SHORT_TERM: Negative catalyst, price weakness expected within 1-5 trading days
- BULLISH_LONG_TERM: Structural positive shift, 1+ month horizon
- BEARISH_LONG_TERM: Structural negative shift, 1+ month horizon
- MIXED: Conflicting signals — positive for some metrics, negative for others
- NEUTRAL: Informational only, no clear directional edge

URGENCY OPTIONS:
- act_now: Significant catalyst requiring same-day position review
- monitor: Watch price action, may need to act within 1-3 days
- background: Useful context, no immediate action needed
- noise: Not actionable — do not surface this signal

CATALYST TYPES: earnings | analyst_action | corporate_event | regulatory | macro | product | competitive | technical | insider

CONFIDENCE GUIDANCE:
- 0.85-1.0: Very clear catalyst with historical precedent (earnings beat+raise, FDA approval)
- 0.65-0.84: Clear catalyst, some uncertainty (analyst upgrade, product launch)
- 0.50-0.64: Possible catalyst, significant uncertainty (executive change, minor regulatory)
- Below 0.50: Set has_signal to false and urgency to noise

Respond ONLY with valid JSON. No markdown, no explanation, no wrapper text.

JSON schema:
{
  "has_signal": boolean,
  "direction": string,
  "confidence": number,
  "urgency": string,
  "catalyst_type": string,
  "headline": string (ONE sentence, max 120 chars, starts with the key fact not the ticker),
  "reasoning": string (2-3 sentences, analyst perspective, what this means for the stock),
  "key_facts": string[] (2-4 crisp facts the trader needs to know),
  "counter_signals": string[] (0-2 items that could invalidate this signal),
  "time_horizon": string (e.g. "same day", "1-3 days", "1-2 weeks", "1+ months"),
  "affected_tickers": string[] (this ticker plus any tickers directly impacted)
}`;

// ── Main analysis function ────────────────────────────────────────────────────

async function analyzeArticles(ticker, articles, model = 'llama3.2') {
  if (!articles || articles.length === 0) return null;

  const topArticles = articles.slice(0, MAX_ARTS);

  const articleContext = topArticles
    .map((a, i) => {
      const desc = a.description ? `\n   ${a.description.slice(0, DESC_SLICE)}` : '';
      return `[${i + 1}] ${a.title}${desc}`;
    })
    .join('\n\n');

  const userMessage = `Ticker: $${ticker}
Articles (${topArticles.length} from the last few hours):

${articleContext}

Extract the trading signal for $${ticker}. Respond with JSON only.`;

  const callOllama = async (extraSystemNote = '') => {
    const sys = extraSystemNote ? `${SYSTEM_PROMPT}\n\n${extraSystemNote}` : SYSTEM_PROMPT;
    const response = await axios.post(
      `${OLLAMA_BASE}/api/chat`,
      {
        model:  model,
        stream: false,
        messages: [
          { role: 'system', content: sys         },
          { role: 'user',   content: userMessage },
        ],
        options: {
          temperature: 0.1,
          num_predict: 900,
        },
      },
      { timeout: REQ_TIMEOUT }
    );
    return response.data?.message?.content?.trim() || '';
  };

  const parseSignal = (rawText) => {
    const stripped = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(_sanitizeJson(stripped));
  };

  try {
    let signal;
    try {
      const rawText = await callOllama();
      if (!rawText) return null;
      signal = parseSignal(rawText);
    } catch (parseErr) {
      if (!(parseErr instanceof SyntaxError)) throw parseErr;
      // One retry with a tighter prompt — common llama failure mode
      const rawText = await callOllama(
        'Your previous response had invalid JSON. Return ONLY valid JSON. Use lowercase null, true, false. No trailing commas. No NULL/True/False keywords.'
      );
      if (!rawText) return null;
      signal = parseSignal(rawText);
    }

    signal.ticker        = ticker.toUpperCase();
    signal.model_used    = model;
    signal.article_count = topArticles.length;

    console.log(`[Analyst] $${ticker}: analyzed ${topArticles.length} articles → ${signal.direction} (${signal.urgency})`);
    return signal;

  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.error(`[Analyst] $${ticker} error: Ollama is not running. Start it with: ollama serve`);
    } else {
      console.error(`[Analyst] $${ticker} error:`, err.message);
    }
    return null;
  }
}

// ── Batch analysis (all tickers) ─────────────────────────────────────────────

async function analyzeAllTickers(articlesByTicker, model = 'llama3.2') {
  const results = {};
  const queue   = Object.entries(articlesByTicker).filter(([, arts]) => arts.length > 0);
  let cursor    = 0;

  async function worker() {
    while (cursor < queue.length) {
      const idx = cursor++;
      const [ticker, articles] = queue[idx];
      results[ticker] = await analyzeArticles(ticker, articles, model);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

module.exports = { analyzeArticles, analyzeAllTickers };
