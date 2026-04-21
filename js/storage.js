/* ── storage.js ── Core trade data (IndexedDB-backed, sync public API) ─
 *
 * Data is pre-loaded into memory during app init via _initStorageCore().
 * All public functions remain synchronous so no callers need to change.
 * Writes go to memory immediately and are flushed to IndexedDB async.
 * ───────────────────────────────────────────────────────────────────── */

// ── In-memory caches ─────────────────────────────────────────────────
let _trades   = [];
let _tags     = [];
let _mistakes = [];
let _rules    = [];

/**
 * Called once during app startup (after DB is open and migration is done).
 * Populates all in-memory caches from IndexedDB.
 */
async function _initStorageCore() {
  _trades   = await dbGetAll('trades');
  _tags     = await dbGetAll('tags');
  _mistakes = await dbGetAll('mistakes');
  _rules    = await dbGetAll('rules');
}

// ── Unique-ID generator ───────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Trades ────────────────────────────────────────────────────────────
function load()         { return _trades; }
function save(trades)   {
  _trades = trades;
  return dbReplaceAll('trades', trades).catch(console.error);
}

// ── Rules ─────────────────────────────────────────────────────────────
function loadRules()        { return _rules; }
function saveRules(rules)   {
  _rules = rules;
  return dbReplaceAll('rules', rules).catch(console.error);
}

// ── Tags ──────────────────────────────────────────────────────────────
function loadTags()       { return _tags; }
function saveTags(tags)   {
  _tags = tags;
  return dbReplaceAll('tags', tags).catch(console.error);
}

// ── Mistakes ──────────────────────────────────────────────────────────
function loadMistakes()           { return _mistakes; }
function saveMistakes(mistakes)   {
  _mistakes = mistakes;
  return dbReplaceAll('mistakes', mistakes).catch(console.error);
}
