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

const TAGS_KEY = 'tj-tags-v1';

function loadTags() {
  try { return JSON.parse(localStorage.getItem(TAGS_KEY) || '[]'); }
  catch { return []; }
}

function saveTags(tags) {
  localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
}

const MISTAKES_KEY = 'tj-mistakes-v1';

function loadMistakes() {
  try { return JSON.parse(localStorage.getItem(MISTAKES_KEY) || '[]'); }
  catch { return []; }
}

function saveMistakes(mistakes) {
  localStorage.setItem(MISTAKES_KEY, JSON.stringify(mistakes));
}
