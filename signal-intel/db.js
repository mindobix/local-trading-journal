/**
 * SQLite persistence layer using Node 22+ built-in node:sqlite.
 * No native build required.
 */
// Suppress the "experimental feature" warning
process.env.NODE_NO_WARNINGS = '1';

const { DatabaseSync } = require('node:sqlite');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const db = new DatabaseSync(path.join(DATA_DIR, 'signal-intel.db'));

db.exec(`PRAGMA journal_mode = WAL`);

db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    id            TEXT PRIMARY KEY,
    ticker        TEXT NOT NULL,
    direction     TEXT NOT NULL,
    confidence    REAL NOT NULL,
    urgency       TEXT NOT NULL,
    catalyst_type TEXT,
    headline      TEXT NOT NULL,
    reasoning     TEXT,
    key_facts     TEXT,
    counter_signals TEXT,
    time_horizon  TEXT,
    affected_tickers TEXT,
    source_count  INTEGER DEFAULT 0,
    article_hashes TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id   TEXT NOT NULL,
    ticker      TEXT NOT NULL,
    direction   TEXT,
    catalyst_type TEXT,
    was_correct INTEGER,
    note        TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS seen_articles (
    hash       TEXT PRIMARY KEY,
    ticker     TEXT,
    seen_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_signals_ticker     ON signals(ticker);
  CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at);
  CREATE INDEX IF NOT EXISTS idx_signals_urgency    ON signals(urgency);
`);

// ── Signals ───────────────────────────────────────────────────────────────────


const _upsertSignal = db.prepare(`
  INSERT INTO signals
    (id, ticker, direction, confidence, urgency, catalyst_type, headline,
     reasoning, key_facts, counter_signals, time_horizon, affected_tickers,
     source_count, article_hashes, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    direction        = excluded.direction,
    confidence       = excluded.confidence,
    urgency          = excluded.urgency,
    catalyst_type    = excluded.catalyst_type,
    headline         = excluded.headline,
    reasoning        = excluded.reasoning,
    key_facts        = excluded.key_facts,
    counter_signals  = excluded.counter_signals,
    time_horizon     = excluded.time_horizon,
    affected_tickers = excluded.affected_tickers,
    source_count     = excluded.source_count,
    article_hashes   = excluded.article_hashes
    -- created_at intentionally excluded: preserve original timestamp
`);

function saveSignal(ticker, analysis, articleHashes) {
  if (!analysis || !analysis.has_signal) return null;

  // Day-level precision: one signal per ticker+catalyst per day, not per hour
  const id = crypto.createHash('md5')
    .update(`${ticker}|${analysis.catalyst_type || 'unknown'}|${new Date().toISOString().slice(0, 10)}`)
    .digest('hex');

  _upsertSignal.run(
    id,
    ticker.toUpperCase(),
    analysis.direction,
    analysis.confidence,
    analysis.urgency,
    analysis.catalyst_type || null,
    analysis.headline,
    analysis.reasoning || null,
    JSON.stringify(analysis.key_facts || []),
    JSON.stringify(analysis.counter_signals || []),
    analysis.time_horizon || null,
    JSON.stringify(analysis.affected_tickers || [ticker]),
    articleHashes.length,
    JSON.stringify(articleHashes),
    new Date().toISOString(),   // only used on INSERT, ignored on UPDATE
  );
  return id;
}

function getSignals({ limit = 50, ticker = null, minConfidence = 0, since = null } = {}) {
  let sql    = 'SELECT * FROM signals WHERE confidence >= ?';
  const args = [minConfidence];

  if (ticker) { sql += ' AND ticker = ?'; args.push(ticker.toUpperCase()); }
  if (since)  { sql += ' AND created_at >= ?'; args.push(since); }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  args.push(limit);

  return db.prepare(sql).all(...args).map(row => ({
    ...row,
    key_facts:        JSON.parse(row.key_facts || '[]'),
    counter_signals:  JSON.parse(row.counter_signals || '[]'),
    affected_tickers: JSON.parse(row.affected_tickers || '[]'),
    article_hashes:   JSON.parse(row.article_hashes || '[]'),
  }));
}

function getSignalStats() {
  return db.prepare(`
    SELECT
      COUNT(*)                                               AS total,
      SUM(CASE WHEN urgency = 'act_now'       THEN 1 ELSE 0 END) AS act_now,
      SUM(CASE WHEN urgency = 'monitor'       THEN 1 ELSE 0 END) AS monitor,
      SUM(CASE WHEN direction LIKE 'BULLISH%' THEN 1 ELSE 0 END) AS bullish,
      SUM(CASE WHEN direction LIKE 'BEARISH%' THEN 1 ELSE 0 END) AS bearish,
      AVG(confidence)                                        AS avg_confidence,
      MAX(created_at)                                        AS last_signal_at
    FROM signals
    WHERE created_at >= datetime('now', '-24 hours')
  `).get();
}

// ── Seen articles (dedup) ─────────────────────────────────────────────────────

const _markSeen = db.prepare('INSERT OR IGNORE INTO seen_articles VALUES (?, ?, ?)');
const _isSeen   = db.prepare('SELECT 1 FROM seen_articles WHERE hash = ?');
const _pruneOld = db.prepare("DELETE FROM seen_articles WHERE seen_at < datetime('now', '-8 hours')");

function markSeen(hash, ticker) {
  _markSeen.run(hash, ticker, new Date().toISOString());
}
function isSeen(hash) {
  return !!_isSeen.get(hash);
}
function pruneOldSeen() {
  _pruneOld.run();
}

// ── Feedback ──────────────────────────────────────────────────────────────────

const _saveFeedback = db.prepare(`
  INSERT INTO feedback (signal_id, ticker, direction, catalyst_type, was_correct, note, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

function saveFeedback(signalId, wasCorrect, note = null) {
  const sig = db.prepare('SELECT ticker, direction, catalyst_type FROM signals WHERE id = ?').get(signalId);
  if (!sig) return false;
  _saveFeedback.run(signalId, sig.ticker, sig.direction, sig.catalyst_type, wasCorrect ? 1 : 0, note, new Date().toISOString());
  return true;
}

function getFeedbackStats() {
  return db.prepare(`
    SELECT
      catalyst_type,
      COUNT(*) AS total,
      SUM(was_correct) AS correct,
      ROUND(1.0 * SUM(was_correct) / COUNT(*), 2) AS accuracy
    FROM feedback
    GROUP BY catalyst_type
    ORDER BY total DESC
  `).all();
}

module.exports = {
  saveSignal, getSignals, getSignalStats,
  markSeen, isSeen, pruneOldSeen,
  saveFeedback, getFeedbackStats,
};
