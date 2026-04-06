/**
 * Report generation child process.
 * Spawned by server.js via child_process.fork() — a fully isolated process
 * so onnxruntime-node (native addon) can load without thread-safety issues.
 *
 * Args:   process.argv[2] = symbol
 *         process.argv[3] = windowMs
 *         process.argv[4] = JSON array of new article IDs (for logging)
 * Sends:  { ok: true, report } | { ok: false, error: string }
 */
const { generateReport } = require('./report-gen');

const symbol       = process.argv[2];
const windowMs     = parseInt(process.argv[3]) || 4 * 3600 * 1000;
const newArticleIds = new Set(process.argv[4] ? JSON.parse(process.argv[4]) : []);

generateReport(symbol, windowMs, newArticleIds)
  .then(report => { process.send({ ok: true, report });  process.exit(0); })
  .catch(err   => { process.send({ ok: false, error: err.message }); process.exit(1); });
