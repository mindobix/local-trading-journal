/* ── wotp-storage.js ── Option idea storage (separate from trades) ── */
const IDEA_KEY = 'ow-ideas-v1';

function loadIdeas() {
  try { return JSON.parse(localStorage.getItem(IDEA_KEY) || '[]'); }
  catch { return []; }
}

function saveIdeas(ideas) {
  localStorage.setItem(IDEA_KEY, JSON.stringify(ideas));
}
