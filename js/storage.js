const KEY = 'tj-v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}

function save(trades) {
  localStorage.setItem(KEY, JSON.stringify(trades));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const RULES_KEY = 'tj-rules-v1';

function loadRules() {
  try { return JSON.parse(localStorage.getItem(RULES_KEY) || '[]'); }
  catch { return []; }
}

function saveRules(rules) {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}
