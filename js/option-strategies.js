/* ── option-strategies.js ── Option strategy linking (IndexedDB-backed) ─
 *
 * Strategy record shape:
 *   {
 *     id:            'strat_…',
 *     strategyType:  'Vertical Spread' | 'Iron Condor' | …  (one of OPTION_STRATEGY_TYPES)
 *     label:         '' | user-supplied label,
 *     tradeIds:      [tradeId, tradeId, …],
 *     createdAt:     ISO timestamp,
 *     notes:         '',
 *   }
 *
 * Same cache+write-through pattern as storage.js — public API is sync;
 * IDB writes are fired-and-forgotten (callers may also `await` them).
 *
 * No back-pointer field on trades. To find "what strategy is this trade in?"
 * we scan the strategies cache. The cache is tiny relative to trades
 * (each strategy bundles 2–4 trades, and trade lists are paginated).
 * ───────────────────────────────────────────────────────────────────── */

// The 15 strategy labels Schwab exposes in its option-order dropdown.
// "Calls & Puts" is the standalone single-leg entry mode — we never
// auto-group a lone option trade under it.
const OPTION_STRATEGY_TYPES = [
  'Butterfly',
  'Buy Write',
  'Calendar Spread',
  'Calls & Puts',
  'Collar',
  'Condor',
  'Custom',
  'Diagonal Spread',
  'Iron Butterfly',
  'Iron Condor',
  'Ratio Spread',
  'Roll',
  'Spread',
  'Straddle',
  'Strangle',
];

// ── In-memory cache ───────────────────────────────────────────────────
let _optionStrategies = [];

async function _initOptionStrategiesStorage() {
  _optionStrategies = await dbGetAll('optionStrategies');
}

// ── Public API ────────────────────────────────────────────────────────

function loadOptionStrategies() {
  return _optionStrategies;
}

function _flushOptionStrategies() {
  return dbReplaceAll('optionStrategies', _optionStrategies).catch(console.error);
}

function saveOptionStrategy(strategy) {
  if (!strategy || !strategy.id) return Promise.resolve();
  const idx = _optionStrategies.findIndex(s => s.id === strategy.id);
  if (idx === -1) _optionStrategies.push(strategy);
  else            _optionStrategies[idx] = strategy;
  return _flushOptionStrategies();
}

function deleteOptionStrategy(id) {
  _optionStrategies = _optionStrategies.filter(s => s.id !== id);
  return _flushOptionStrategies();
}

function getStrategyForTrade(tradeId) {
  if (!tradeId) return null;
  for (const s of _optionStrategies) {
    if (s.tradeIds && s.tradeIds.includes(tradeId)) return s;
  }
  return null;
}

// Build a render-time lookup map. Use this inside a render loop instead
// of calling getStrategyForTrade per row. Not cached — rebuild each render.
function buildStrategyLookup() {
  const map = new Map();
  for (const s of _optionStrategies) {
    if (!s.tradeIds) continue;
    for (const tid of s.tradeIds) map.set(tid, s);
  }
  return map;
}

function newOptionStrategyId() {
  return 'strat_' + uid();
}

function createOptionStrategy(strategyType, tradeIds, label) {
  const strategy = {
    id:           newOptionStrategyId(),
    strategyType: strategyType || 'Custom',
    label:        label || '',
    tradeIds:     [...tradeIds],
    createdAt:    new Date().toISOString(),
    notes:        '',
  };
  return strategy;
}

function attachTradeToStrategy(tradeId, strategyId) {
  const s = _optionStrategies.find(x => x.id === strategyId);
  if (!s) return Promise.resolve();
  if (!s.tradeIds) s.tradeIds = [];
  if (!s.tradeIds.includes(tradeId)) s.tradeIds.push(tradeId);
  return _flushOptionStrategies();
}

// Remove a trade from any strategy that contains it. Strategies that
// drop below 2 trades are deleted (orphan cleanup).
function detachTradeFromStrategy(tradeId) {
  let mutated = false;
  const survivors = [];
  for (const s of _optionStrategies) {
    if (!s.tradeIds || !s.tradeIds.includes(tradeId)) {
      survivors.push(s);
      continue;
    }
    const remaining = s.tradeIds.filter(id => id !== tradeId);
    mutated = true;
    if (remaining.length >= 2) {
      survivors.push({ ...s, tradeIds: remaining });
    }
    // else: drop strategy entirely (< 2 trades = orphan)
  }
  if (mutated) {
    _optionStrategies = survivors;
    return _flushOptionStrategies();
  }
  return Promise.resolve();
}

// Same as detach — kept as an explicit name for the trade-delete hook.
function cleanupStrategiesForDeletedTrade(tradeId) {
  return detachTradeFromStrategy(tradeId);
}

// After bulk-deleting trades (or any other mutation), drop strategies
// whose tradeIds no longer resolve to ≥ 2 existing trades.
function pruneOrphanStrategies(existingTradeIds) {
  const valid = new Set(existingTradeIds);
  let mutated = false;
  const survivors = [];
  for (const s of _optionStrategies) {
    const kept = (s.tradeIds || []).filter(id => valid.has(id));
    if (kept.length !== (s.tradeIds || []).length) mutated = true;
    if (kept.length >= 2) {
      survivors.push({ ...s, tradeIds: kept });
    } else if (kept.length !== (s.tradeIds || []).length) {
      // strategy collapsed — drop it
    } else {
      survivors.push(s);
    }
  }
  if (mutated) {
    _optionStrategies = survivors;
    return _flushOptionStrategies();
  }
  return Promise.resolve();
}

// ── Position derivation ───────────────────────────────────────────────
//
// For strategy detection we need one signature per *trade* representing
// the position that was opened. The trade record carries multiple legs
// (open + close); the opening side determines the position direction.

function derivePositionsFromTrades(trades) {
  return trades.map(t => {
    const legs = Array.isArray(t.legs) ? t.legs : [];
    // Open date = earliest leg date (fall back to t.date)
    let openDate = t.date || '';
    if (legs.length) {
      const sorted = legs
        .map(l => (l.date || '').split('T')[0])
        .filter(Boolean)
        .sort();
      if (sorted.length) openDate = sorted[0];
    }
    // Direction = action of the leg on the open date (first chronologically)
    let opener = null;
    if (legs.length) {
      const sortedLegs = [...legs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      opener = sortedLegs[0];
    }
    const direction = opener
      ? (opener.action === 'buy' ? 'long' : 'short')
      : 'long';
    const sameSide = legs.filter(l => l.action === (direction === 'long' ? 'buy' : 'sell'));
    const qty = sameSide.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0);

    return {
      tradeId:    t.id,
      symbol:     (t.symbol || '').toUpperCase(),
      instrument: t.type === 'option' ? (t.optionType || 'call') : 'stock',
      direction,
      strike:     t.type === 'option' ? (parseFloat(t.strikePrice) || 0) : null,
      expiry:     t.type === 'option' ? (t.expiryDate || '') : null,
      qty,
      openDate,
    };
  });
}

// ── Strategy detector ─────────────────────────────────────────────────
//
// Pattern matching only — no AI, no fuzzy matching. Each rule must match
// exactly. The first matching rule wins; order matters (stock-involving
// rules before pure-option rules, more specific before general).

function detectStrategy(positions) {
  if (!Array.isArray(positions) || positions.length < 2) return null;

  const EPS = 0.0001;
  const eq  = (a, b) => Math.abs((a || 0) - (b || 0)) < EPS;

  const stocks = positions.filter(p => p.instrument === 'stock');
  const calls  = positions.filter(p => p.instrument === 'call');
  const puts   = positions.filter(p => p.instrument === 'put');
  const opts   = positions.filter(p => p.instrument === 'call' || p.instrument === 'put');

  // Stock-only groups never auto-group — they're not option strategies.
  if (stocks.length > 0 && opts.length === 0) return null;

  // ── Stock-involving strategies ──
  if (stocks.length === 1 && opts.length >= 1 && opts.length === positions.length - 1) {
    const stock = stocks[0];

    // Buy Write — long stock + short call, no puts
    if (stock.direction === 'long' &&
        calls.length === 1 && puts.length === 0 &&
        calls[0].direction === 'short') {
      return 'Buy Write';
    }

    // Collar — long stock + long put + short call (same expiry on the options)
    if (stock.direction === 'long' &&
        calls.length === 1 && puts.length === 1 &&
        puts[0].direction === 'long' && calls[0].direction === 'short' &&
        puts[0].expiry === calls[0].expiry) {
      return 'Collar';
    }
  }
  // Stock + options without a named pattern → don't auto-group.
  // Caller's subset search will try smaller subsets without the stock.
  if (stocks.length > 0) return null;

  // ── Pure option strategies ──

  // 2-leg
  if (positions.length === 2) {
    // Straddle / Strangle (1 call + 1 put)
    if (calls.length === 1 && puts.length === 1) {
      const c = calls[0], p = puts[0];
      if (c.expiry === p.expiry && c.direction === p.direction && eq(c.qty, p.qty)) {
        if (eq(c.strike, p.strike)) return 'Straddle';
        return 'Strangle';
      }
    }

    // Same-type pairs (both calls or both puts)
    if (calls.length === 2 || puts.length === 2) {
      const same = calls.length === 2 ? calls : puts;
      const [x, y] = same;

      // Vertical Spread — same expiry, diff strikes, opposite directions, equal qty
      if (x.expiry === y.expiry && !eq(x.strike, y.strike) &&
          x.direction !== y.direction && eq(x.qty, y.qty)) {
        return 'Spread';
      }

      // Calendar Spread — same strike, diff expiries, opposite directions, equal qty
      if (eq(x.strike, y.strike) && x.expiry !== y.expiry &&
          x.direction !== y.direction && eq(x.qty, y.qty)) {
        return 'Calendar Spread';
      }

      // Diagonal Spread — diff strikes, diff expiries, opposite directions, equal qty
      if (!eq(x.strike, y.strike) && x.expiry !== y.expiry &&
          x.direction !== y.direction && eq(x.qty, y.qty)) {
        return 'Diagonal Spread';
      }

      // Ratio Spread — same expiry, diff strikes, diff qty
      if (x.expiry === y.expiry && !eq(x.strike, y.strike) && !eq(x.qty, y.qty)) {
        return 'Ratio Spread';
      }
    }
  }

  // 3-leg — Butterfly
  if (positions.length === 3 && (calls.length === 3 || puts.length === 3)) {
    const sorted     = [...positions].sort((a, b) => a.strike - b.strike);
    const sameExpiry = sorted.every(p => p.expiry === sorted[0].expiry);
    if (sameExpiry) {
      const w1 = sorted[1].strike - sorted[0].strike;
      const w2 = sorted[2].strike - sorted[1].strike;
      if (eq(w1, w2) && w1 > 0 &&
          eq(sorted[0].qty, sorted[2].qty) &&
          eq(sorted[1].qty, 2 * sorted[0].qty) &&
          sorted[0].direction === sorted[2].direction &&
          sorted[1].direction !== sorted[0].direction) {
        return 'Butterfly';
      }
    }
  }

  // 4-leg — Iron Butterfly, Iron Condor, Condor
  if (positions.length === 4) {
    const sameExpiry = positions.every(p => p.expiry === positions[0].expiry);

    if (sameExpiry && calls.length === 2 && puts.length === 2) {
      const sp = [...puts ].sort((a, b) => a.strike - b.strike);
      const sc = [...calls].sort((a, b) => a.strike - b.strike);
      const refQty   = positions[0].qty;
      const unitQty  = positions.every(p => eq(p.qty, refQty));

      if (unitQty) {
        // Iron Butterfly — short put@K, short call@K (same middle strike), long wings
        if (eq(sp[1].strike, sc[0].strike) &&
            sp[1].direction === 'short' && sc[0].direction === 'short' &&
            sp[0].direction === 'long'  && sc[1].direction === 'long' &&
            sp[0].strike < sp[1].strike && sc[0].strike < sc[1].strike) {
          const wL = sp[1].strike - sp[0].strike;
          const wR = sc[1].strike - sc[0].strike;
          if (eq(wL, wR) && wL > 0) return 'Iron Butterfly';
        }

        // Iron Condor — K1 < K2 (puts) < K3 < K4 (calls), long-short-short-long
        if (sp[1].strike < sc[0].strike &&
            sp[0].direction === 'long'  && sp[1].direction === 'short' &&
            sc[0].direction === 'short' && sc[1].direction === 'long') {
          return 'Iron Condor';
        }
      }
    }

    // Condor — 4 same-type, equal outer wings, alternating directions
    if (sameExpiry && (calls.length === 4 || puts.length === 4)) {
      const sorted  = [...positions].sort((a, b) => a.strike - b.strike);
      const refQty  = sorted[0].qty;
      const unitQty = sorted.every(p => eq(p.qty, refQty));
      const w1 = sorted[1].strike - sorted[0].strike;
      const w2 = sorted[3].strike - sorted[2].strike;

      if (unitQty && eq(w1, w2) && w1 > 0 &&
          sorted[0].direction === sorted[3].direction &&
          sorted[1].direction === sorted[2].direction &&
          sorted[0].direction !== sorted[1].direction) {
        return 'Condor';
      }
    }
  }

  // No named pattern matched. Returning null (not 'Custom') lets the
  // caller try smaller subsets — only emit a strategy when we can name it.
  return null;
}

// Generator: yields every combination of `size` indices from [0..n).
function* _stratCombinations(n, size) {
  function* helper(start, chosen) {
    if (chosen.length === size) { yield chosen.slice(); return; }
    for (let i = start; i < n; i++) {
      chosen.push(i);
      yield* helper(i + 1, chosen);
      chosen.pop();
    }
  }
  yield* helper(0, []);
}

// Search for the best partition of `positions` into named-pattern subsets.
// Returns an array of { tradeIds, strategyType } — non-overlapping.
// Trades not in any subset are left ungrouped (not emitted).
function findStrategySubgroups(positions) {
  if (!Array.isArray(positions) || positions.length < 2) return [];

  // Fast path: whole group matches a named pattern.
  const whole = detectStrategy(positions);
  if (whole) {
    return [{ tradeIds: positions.map(p => p.tradeId), strategyType: whole }];
  }

  // Enumerate all subsets of size 4..2 that match a named pattern.
  const candidates = [];
  const n = positions.length;
  const maxSize = Math.min(4, n);
  for (let size = maxSize; size >= 2; size--) {
    for (const idxs of _stratCombinations(n, size)) {
      const subset = idxs.map(i => positions[i]);
      const t = detectStrategy(subset);
      if (t) {
        candidates.push({ tradeIds: subset.map(p => p.tradeId), strategyType: t, size });
      }
    }
  }

  // Greedy: pick largest subsets first, ensure no trade is used twice.
  candidates.sort((a, b) => b.size - a.size);
  const used = new Set();
  const picked = [];
  for (const c of candidates) {
    if (c.tradeIds.some(id => used.has(id))) continue;
    picked.push({ tradeIds: c.tradeIds, strategyType: c.strategyType });
    for (const id of c.tradeIds) used.add(id);
  }
  return picked;
}

// Convenience — group an array of trades by symbol+openDate, find every
// named-pattern subset per bucket, return a flat list of detected groups.
//   [{ key, strategyType, tradeIds, sample: { symbol, date } }]
// Buckets with no detectable strategy are skipped entirely.
function detectStrategyGroups(trades) {
  const positions = derivePositionsFromTrades(trades);
  const buckets   = new Map();
  for (const p of positions) {
    const key = `${p.symbol}|${p.openDate}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }
  const groups = [];
  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue;
    const subgroups = findStrategySubgroups(bucket);
    for (let i = 0; i < subgroups.length; i++) {
      const sg = subgroups[i];
      groups.push({
        key:          `${key}|${i}`,
        strategyType: sg.strategyType,
        tradeIds:     sg.tradeIds,
        sample:       { symbol: bucket[0].symbol, date: bucket[0].openDate },
      });
    }
  }
  return groups;
}
