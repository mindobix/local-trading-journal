/**
 * Position-aware signal ranking.
 * Multiplies base signal score by relevance to the user's watchlist.
 */

const URGENCY_SCORE = {
  act_now:    1.0,
  monitor:    0.75,
  background: 0.4,
  noise:      0.05,
};

const DIRECTION_LABEL = {
  BULLISH_SHORT_TERM:  { label: 'BULLISH',      color: 'bullish',   badge: '▲ BULLISH' },
  BEARISH_SHORT_TERM:  { label: 'BEARISH',      color: 'bearish',   badge: '▼ BEARISH' },
  BULLISH_LONG_TERM:   { label: 'BULLISH (LT)', color: 'bullish',   badge: '▲ BULLISH LT' },
  BEARISH_LONG_TERM:   { label: 'BEARISH (LT)', color: 'bearish',   badge: '▼ BEARISH LT' },
  MIXED:               { label: 'MIXED',         color: 'mixed',     badge: '↕ MIXED' },
  NEUTRAL:             { label: 'NEUTRAL',       color: 'neutral',   badge: '→ NEUTRAL' },
};

function rankSignals(signals, watchlist = []) {
  const watchSet = new Set(watchlist.map(t => t.toUpperCase()));

  return signals.map(signal => {
    const ticker    = signal.ticker.toUpperCase();
    const affected  = (signal.affected_tickers || []).map(t => t.toUpperCase());

    // Position-awareness multiplier
    let relevance = 0.5;  // default: interesting but not on watchlist
    if (watchSet.has(ticker)) {
      relevance = 3.0;    // directly watched
    } else if (affected.some(t => watchSet.has(t))) {
      relevance = 1.5;    // related ticker is watched
    } else if (watchSet.size === 0) {
      relevance = 1.0;    // no watchlist configured — treat all equally
    }

    const urgencyScore = URGENCY_SCORE[signal.urgency] ?? 0.4;
    const score = signal.confidence * urgencyScore * relevance;

    return {
      ...signal,
      relevance,
      score,
      directionMeta: DIRECTION_LABEL[signal.direction] || DIRECTION_LABEL.NEUTRAL,
    };
  })
  .filter(s => s.urgency !== 'noise')
  .sort((a, b) => b.score - a.score);
}

// Returns a human-readable age string
function timeAgo(isoStr) {
  const diffMs  = Date.now() - new Date(isoStr).getTime();
  const mins    = Math.floor(diffMs / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

module.exports = { rankSignals, timeAgo, DIRECTION_LABEL };
