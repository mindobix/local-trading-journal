/* ── wotp-storage.js ── Option idea storage (IndexedDB-backed) ────────
 *
 * In-memory cache populated by _initWotpStorage() at app startup.
 * Public API remains synchronous.
 * ───────────────────────────────────────────────────────────────────── */

let _ideas = [];

async function _initWotpStorage() {
  _ideas = await dbGetAll('ideas');
}

function loadIdeas()        { return _ideas; }
function saveIdeas(ideas)   {
  _ideas = ideas;
  dbReplaceAll('ideas', ideas).catch(console.error);
}
