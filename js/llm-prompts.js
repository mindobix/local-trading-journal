/* ── llm-prompts.js ── LLM Trades Prompts panel (Trade Plan tab) ──── */

// ── IndexedDB keys ────────────────────────────────────────────────────────────
const LLM_QUERIES_LS_KEY    = 'ltj_llm_queries';
const LLM_RESULTS_LS_KEY    = 'ltj_llm_results';
const LLM_CATEGORIES_LS_KEY = 'ltj_llm_categories';

// ── State ─────────────────────────────────────────────────────────────────────
const _llm = {
  queries:        [],   // loaded from IndexedDB on init (llmQueries store)
  results:        {},   // { [id]: htmlString } — IndexedDB settings, not in backup
  categories:     [],   // user-defined prompt categories
  activeQueryId:  null,
  editingQueryId: null,
};

// ── Default prompts (seeded on first load) ────────────────────────────────────
const LLM_DEFAULT_PROMPTS = [
  {
    category: 'Trade Idea Generator',
    llm: 'Grok',
    prompt: 'Scan today\'s market and generate 5 high-probability trade setups for [insert stock/index/sector]. Include entry price, exit targets, stop-loss, and risk-to-reward ratio. Explain why each setup works based on technical and fundamental factors.',
  },
  {
    category: 'Automated Technical Analyst',
    llm: 'Grok',
    prompt: 'Analyze [insert stock/ticker] using daily and weekly charts. Break down support/resistance levels, trendlines, moving averages, and momentum indicators. Provide a step-by-step trading signal (Buy/Hold/Sell) with justification.',
  },
  {
    category: 'News-to-Trade Converter',
    llm: 'Grok',
    prompt: 'Summarize the latest news about [insert company/sector] and translate it into trading implications. Provide likely short-term and long-term effects, expected price movement range, and recommended positioning.',
  },
  {
    category: 'Strategy Backtester',
    llm: 'Grok',
    prompt: 'Backtest [insert trading strategy: e.g., moving average crossover, RSI divergence] on [insert stock/index] over the last [insert time period]. Present win rate, profit factor, max drawdown, and improvements to increase edge.',
  },
  {
    category: 'Fully Automated Trade Plan',
    llm: 'Grok',
    prompt: 'Design a daily trading plan for [insert market/asset]. Include pre-market scan, opening strategy, midday adjustments, and closing strategy. Deliver it as a time-stamped checklist I can follow like a professional trader.',
  },
  {
    category: 'Stock Move & X.com Sentiment',
    llm: 'Grok',
    prompt: 'Please provide for the following tickers stock move today and sentiment from x.com summary report for SPX, QQQ, TSLA, NVDA, MU, SNDK, META, AMZN, GOOG, AAPL, MSFT, PLTR, NFLX, [add more tickers here]',
  },
];

// ── Storage helpers ───────────────────────────────────────────────────────────
function _llmLoadQueries()     { return _llm.queries;    }
function _llmLoadResults()     { return _llm.results;    }
function _llmLoadCategories()  { return _llm.categories; }
function _llmSaveQueries(q)    { _llm.queries    = q; dbReplaceAll('llmQueries', q).catch(console.error); }
function _llmSaveResults(r)    { _llm.results    = r; dbPutSetting(LLM_RESULTS_LS_KEY,    r).catch(console.error); }
function _llmSaveCategories(c) { _llm.categories = c; dbPutSetting(LLM_CATEGORIES_LS_KEY, c).catch(console.error); }

// ── Init — called once at app startup ────────────────────────────────────────
async function _initLlmStorage() {
  const queries = await dbGetAll('llmQueries');
  if (queries.length) _llm.queries = queries;

  const results = await dbGetSetting(LLM_RESULTS_LS_KEY);
  if (results) _llm.results = results;

  const cats = await dbGetSetting(LLM_CATEGORIES_LS_KEY);
  if (Array.isArray(cats)) _llm.categories = cats;
}

// ── Public backup / restore ───────────────────────────────────────────────────
function getLlmQueriesForBackup() {
  return { queries: _llm.queries, categories: _llm.categories };
}

function restoreLlmQueries(data) {
  const incoming     = Array.isArray(data) ? data : (data?.queries || []);
  const incomingCats = Array.isArray(data?.categories) ? data.categories : [];

  const map = new Map(_llm.queries.map(q => [q.id, q]));
  for (const q of incoming) map.set(q.id, q);
  _llm.queries = [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  _llmSaveQueries(_llm.queries);

  if (incomingCats.length) {
    const catSet = new Set([..._llm.categories, ...incomingCats]);
    _llm.categories = [...catSet];
    _llmSaveCategories(_llm.categories);
  }

  _renderLlmPanel();
}

// ── Render entry points ───────────────────────────────────────────────────────
function _showLlmInPlan() {
  const wrap = document.getElementById('plan-llm-wrap');
  if (!wrap) return;
  _renderLlmInto(wrap);
}

function _renderLlmInto(container) {
  container.innerHTML = `
    <div class="llm-body-wrap">
      <div class="llm-panels">
        <div class="llm-left-panel"  id="llm-left-panel"></div>
        <div class="llm-right-panel" id="llm-right-panel"></div>
      </div>
    </div>`;
  _renderLlmList();
  _renderLlmRight();
}

function _renderLlmPanel() {
  if (document.getElementById('llm-left-panel')) {
    _renderLlmList();
    _renderLlmRight();
  }
}

// ── LLM types / colors ────────────────────────────────────────────────────────
const LLM_TYPES = ['Grok', 'ChatGPT', 'Gemini', 'Claude', 'Other'];

const LLM_COLORS = {
  Grok:    '#1d9bf0',
  ChatGPT: '#10a37f',
  Gemini:  '#4285f4',
  Claude:  '#d97706',
  Other:   '#7c3aed',
};

function _llmDisplayName(q) {
  return q.llm === 'Other' && q.llmOther ? q.llmOther : q.llm;
}
function _llmColor(llm) { return LLM_COLORS[llm] || LLM_COLORS.Other; }

const _CAT_PALETTE = [
  { bg: 'rgba(99,102,241,0.18)',  color: '#a5b4fc' },
  { bg: 'rgba(16,185,129,0.18)',  color: '#6ee7b7' },
  { bg: 'rgba(245,158,11,0.18)',  color: '#fcd34d' },
  { bg: 'rgba(239,68,68,0.18)',   color: '#fca5a5' },
  { bg: 'rgba(56,189,248,0.18)',  color: '#7dd3fc' },
  { bg: 'rgba(168,85,247,0.18)',  color: '#d8b4fe' },
  { bg: 'rgba(251,146,60,0.18)',  color: '#fdba74' },
  { bg: 'rgba(20,184,166,0.18)',  color: '#5eead4' },
];
const _catColorCache = {};
function _llmCatStyle(cat) {
  if (!cat) return '';
  if (!_catColorCache[cat]) {
    let h = 0;
    for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
    const p = _CAT_PALETTE[h % _CAT_PALETTE.length];
    _catColorCache[cat] = `background:${p.bg};color:${p.color}`;
  }
  return _catColorCache[cat];
}

// ── Left panel — prompt list ──────────────────────────────────────────────────
function _renderLlmList() {
  const el = document.getElementById('llm-left-panel');
  if (!el) return;

  const items = _llm.queries.map(q => {
    const name       = _llmDisplayName(q);
    const color      = _llmColor(q.llm);
    const hasResults = !!((_llm.results[q.id] || '').trim());
    const dateSrc    = hasResults && q.resultsAt ? q.resultsAt : q.createdAt;
    const date       = dateSrc ? new Date(dateSrc).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
    const dateLabel  = hasResults && q.resultsAt ? `updated ${date}` : date;
    const cat        = q.category ? `<span class="llm-qrow-cat" style="${_llmCatStyle(q.category)}">${_esc(q.category)}</span>` : '';
    const active     = _llm.activeQueryId === q.id;
    const resultsDot = hasResults ? `<span class="llm-qrow-results-dot" title="Has results"></span>` : '';
    return `
      <div class="llm-query-row${active ? ' active' : ''}" onclick="_llmSelectQuery('${_esc(q.id)}')">
        <div class="llm-qrow-top">
          <span class="llm-qrow-badge" style="background:${color}">${_esc(name)}</span>
          ${resultsDot}
          <span class="llm-qrow-date">${_esc(dateLabel)}</span>
        </div>
        ${cat}
        <div class="llm-qrow-prompt">${_esc(q.prompt)}</div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="llm-list-hdr">
      <span class="llm-list-title">LLM Prompts</span>
      <div class="llm-list-hdr-actions">
        <button class="llm-reseed-btn" onclick="_llmReseedDefaults()" title="Restore missing default prompts">↺ Defaults</button>
        <button class="llm-new-btn" onclick="_llmNewQuery()">+ New Prompt</button>
      </div>
    </div>
    <div class="llm-list-body">
      ${items || '<div class="llm-empty-list">No prompts yet.<br>Tap + New Prompt to add one.</div>'}
    </div>`;
}

// ── Right panel router ────────────────────────────────────────────────────────
function _renderLlmRight() {
  if (_llm.editingQueryId !== null) {
    _renderLlmForm();
  } else if (_llm.activeQueryId) {
    _renderLlmView();
  } else {
    const el = document.getElementById('llm-right-panel');
    if (el) el.innerHTML = `
      <div class="llm-placeholder">
        <span style="font-size:32px">🤖</span>
        <div>Select a prompt to view, or tap <strong>+ New Prompt</strong> to add one.</div>
      </div>`;
  }
}

// ── View mode ─────────────────────────────────────────────────────────────────
function _renderLlmView() {
  const el = document.getElementById('llm-right-panel');
  if (!el) return;
  const q = _llm.queries.find(x => x.id === _llm.activeQueryId);
  if (!q) return;

  const name    = _llmDisplayName(q);
  const color   = _llmColor(q.llm);
  const date    = q.createdAt ? new Date(q.createdAt).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
  const results = _llm.results[q.id] || '';
  const catBadge = q.category ? `<span class="llm-view-cat" style="${_llmCatStyle(q.category)}">${_esc(q.category)}</span>` : '';

  el.innerHTML = `
    <div class="llm-view-wrap">
      <div class="llm-view-hdr">
        <div class="llm-view-hdr-left">
          <span class="llm-view-badge" style="background:${color}">${_esc(name)}</span>
          ${catBadge}
          <span class="llm-view-date">${_esc(date)}</span>
        </div>
        <div class="llm-view-actions">
          <button class="llm-act-btn" onclick="_llmEditQuery('${_esc(q.id)}')">Edit</button>
          <button class="llm-act-btn llm-act-del" onclick="_llmDeleteQuery('${_esc(q.id)}')">Delete</button>
        </div>
      </div>

      <div class="llm-view-section">
        <div class="llm-section-label">Prompt
          <button class="llm-edit-results-btn" onclick="_llmCopyPrompt('${_esc(q.id)}')">Copy prompt</button>
          <span class="llm-copy-hint" id="llm-copy-hint-${_esc(q.id)}"></span>
        </div>
        <div class="llm-prompt-box">${_esc(q.prompt)}</div>
      </div>

      <div class="llm-view-section llm-results-section">
        <div class="llm-section-label">Results
          <button class="llm-edit-results-btn" onclick="_llmEditResults('${_esc(q.id)}')">Edit results</button>
        </div>
        <div class="llm-results-display" id="llm-results-display-${_esc(q.id)}">
          ${results ? results : '<span class="llm-no-results">No results pasted yet. Tap "Edit results" to add.</span>'}
        </div>
      </div>
    </div>`;
}

// ── Add / Edit form ───────────────────────────────────────────────────────────
function _renderLlmForm() {
  const el = document.getElementById('llm-right-panel');
  if (!el) return;
  const isNew = _llm.editingQueryId === 'new';
  const q     = isNew ? null : _llm.queries.find(x => x.id === _llm.editingQueryId);

  const currentLlm    = q?.llm      || 'Grok';
  const currentOther  = q?.llmOther || '';
  const currentCat    = q?.category || '';
  const currentPrompt = q?.prompt   || '';

  const llmOptions = LLM_TYPES.map(t =>
    `<option value="${t}"${t === currentLlm ? ' selected' : ''}>${t}</option>`
  ).join('');

  const catOptions = _llm.categories.map(c => `<option value="${_esc(c)}"></option>`).join('');
  const catPills   = _llm.categories.map(c =>
    `<span class="llm-cat-pill" style="${_llmCatStyle(c)}" onclick="_llmPickCat('${_esc(c)}')" title="Use this category">${_esc(c)}
       <button class="llm-cat-pill-del" onclick="event.stopPropagation();_llmDeleteCat('${_esc(c)}')" title="Delete category">&#10005;</button>
     </span>`
  ).join('');

  el.innerHTML = `
    <div class="llm-form-wrap">
      <div class="llm-form-hdr">${isNew ? 'New LLM Prompt' : 'Edit Prompt'}</div>

      <div class="llm-form-field">
        <label class="llm-form-label">LLM</label>
        <div class="llm-form-llm-row">
          <select class="llm-form-select" id="llm-f-type" onchange="_llmToggleOther()">
            ${llmOptions}
          </select>
          <input class="llm-form-input" id="llm-f-other" placeholder="Specify LLM name…"
                 value="${_esc(currentOther)}"
                 style="display:${currentLlm === 'Other' ? 'block' : 'none'}">
        </div>
      </div>

      <div class="llm-form-field">
        <label class="llm-form-label">Prompt Category
          <span class="llm-form-label-hint">— type new or pick existing</span>
        </label>
        <div class="llm-form-cat-row">
          <input class="llm-form-input" id="llm-f-cat" list="llm-cat-list"
                 placeholder="e.g. Trade Idea Generator"
                 value="${_esc(currentCat)}">
          <datalist id="llm-cat-list">${catOptions}</datalist>
          <button class="llm-cat-add-btn" onclick="_llmAddCatFromInput()" title="Save as new category">+ Save</button>
        </div>
        ${catPills ? `<div class="llm-cat-pills-row">${catPills}</div>` : ''}
      </div>

      <div class="llm-form-field">
        <label class="llm-form-label">Prompt</label>
        <textarea class="llm-form-textarea" id="llm-f-prompt" placeholder="Paste the prompt you used…" rows="6">${_esc(currentPrompt)}</textarea>
      </div>

      <div class="llm-form-actions">
        <button class="llm-form-save" onclick="_llmSaveForm('${isNew ? 'new' : _esc(q.id)}')">Save</button>
        <button class="llm-form-cancel" onclick="_llmCancelForm()">Cancel</button>
      </div>
    </div>`;
}

// ── Results editor ────────────────────────────────────────────────────────────
function _llmEditResults(id) {
  const el = document.getElementById('llm-right-panel');
  if (!el) return;
  const q       = _llm.queries.find(x => x.id === id);
  const results = _llm.results[id] || '';
  const name    = q ? _llmDisplayName(q) : '';
  const color   = q ? _llmColor(q.llm) : '#888';

  el.innerHTML = `
    <div class="llm-form-wrap">
      <div class="llm-form-hdr">
        <span class="llm-view-badge" style="background:${color};margin-right:8px">${_esc(name)}</span>
        Edit Results
      </div>
      <div class="llm-editor-toolbar">
        <button class="llm-tb-btn" onclick="document.execCommand('bold')"       title="Bold"><b>B</b></button>
        <button class="llm-tb-btn" onclick="document.execCommand('italic')"     title="Italic"><i>I</i></button>
        <button class="llm-tb-btn" onclick="document.execCommand('underline')"  title="Underline"><u>U</u></button>
        <span class="llm-tb-sep"></span>
        <button class="llm-tb-btn" onclick="document.execCommand('insertUnorderedList')" title="Bullet list">&#8226; List</button>
        <button class="llm-tb-btn" onclick="document.execCommand('insertOrderedList')"   title="Numbered list">1. List</button>
        <span class="llm-tb-sep"></span>
        <button class="llm-tb-btn" onclick="document.execCommand('formatBlock',false,'h3')" title="Heading">H</button>
        <button class="llm-tb-btn" onclick="document.execCommand('formatBlock',false,'p')"  title="Paragraph">P</button>
        <span class="llm-tb-sep"></span>
        <button class="llm-tb-btn llm-tb-clear" onclick="_llmEditorClear()" title="Clear all">&#10005; Clear</button>
      </div>
      <div class="llm-rich-editor" id="llm-rich-editor" contenteditable="true"
           data-placeholder="Paste your LLM results here — formatting is preserved…">${results}</div>
      <div class="llm-form-actions">
        <button class="llm-form-save" onclick="_llmCommitResults('${_esc(id)}')">Save Results</button>
        <button class="llm-form-cancel" onclick="_llmCancelResults('${_esc(id)}')">Cancel</button>
      </div>
    </div>`;

  const editor = document.getElementById('llm-rich-editor');
  if (editor) {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function _llmEditorClear() {
  const editor = document.getElementById('llm-rich-editor');
  if (editor) { editor.innerHTML = ''; editor.focus(); }
}

// ── Actions ───────────────────────────────────────────────────────────────────
function _llmNewQuery() {
  _llm.editingQueryId = 'new';
  _renderLlmRight();
}

function _llmSelectQuery(id) {
  _llm.activeQueryId  = id;
  _llm.editingQueryId = null;
  _renderLlmList();
  _renderLlmRight();
}

function _llmEditQuery(id) {
  _llm.editingQueryId = id;
  _renderLlmRight();
}

function _llmDeleteQuery(id) {
  const q = _llm.queries.find(x => x.id === id);
  if (!confirm(`Delete this ${q ? _llmDisplayName(q) : ''} prompt?`)) return;
  _llm.queries = _llm.queries.filter(x => x.id !== id);
  delete _llm.results[id];
  _llmSaveQueries(_llm.queries);
  _llmSaveResults(_llm.results);
  if (_llm.activeQueryId === id) _llm.activeQueryId = _llm.queries[0]?.id || null;
  _llm.editingQueryId = null;
  _renderLlmList();
  _renderLlmRight();
}

function _llmToggleOther() {
  const sel = document.getElementById('llm-f-type');
  const inp = document.getElementById('llm-f-other');
  if (sel && inp) inp.style.display = sel.value === 'Other' ? 'block' : 'none';
}

function _llmSaveForm(idOrNew) {
  const llm      = document.getElementById('llm-f-type')?.value || 'Grok';
  const other    = document.getElementById('llm-f-other')?.value.trim() || '';
  const category = document.getElementById('llm-f-cat')?.value.trim() || '';
  const prompt   = document.getElementById('llm-f-prompt')?.value.trim() || '';
  if (!prompt) { alert('Please enter a prompt.'); return; }

  if (category && !_llm.categories.includes(category)) {
    _llm.categories.push(category);
    _llmSaveCategories(_llm.categories);
  }

  if (idOrNew === 'new') {
    const entry = {
      id:        'llm_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      llm, llmOther: other, category, prompt,
      createdAt: new Date().toISOString(),
    };
    _llm.queries.unshift(entry);
    _llm.activeQueryId = entry.id;
  } else {
    const q = _llm.queries.find(x => x.id === idOrNew);
    if (q) { q.llm = llm; q.llmOther = other; q.category = category; q.prompt = prompt; }
  }

  _llm.editingQueryId = null;
  _llmSaveQueries(_llm.queries);
  _renderLlmList();
  _renderLlmRight();
}

function _llmCancelForm() {
  _llm.editingQueryId = null;
  _renderLlmRight();
}

function _llmAddCatFromInput() {
  const inp = document.getElementById('llm-f-cat');
  if (!inp) return;
  const cat = inp.value.trim();
  if (!cat) return;
  if (!_llm.categories.includes(cat)) {
    _llm.categories.push(cat);
    _llmSaveCategories(_llm.categories);
  }
  _renderLlmForm();
  const inp2 = document.getElementById('llm-f-cat');
  if (inp2) inp2.value = cat;
}

function _llmPickCat(cat) {
  const inp = document.getElementById('llm-f-cat');
  if (inp) inp.value = cat;
}

function _llmDeleteCat(cat) {
  _llm.categories = _llm.categories.filter(c => c !== cat);
  _llmSaveCategories(_llm.categories);
  const currentVal = document.getElementById('llm-f-cat')?.value || '';
  _renderLlmForm();
  const inp = document.getElementById('llm-f-cat');
  if (inp && currentVal !== cat) inp.value = currentVal;
}

function _llmReseedDefaults() {
  const existingIds = new Set(_llm.queries.map(q => q.id));
  let added = 0;
  LLM_DEFAULT_PROMPTS.forEach((p, i) => {
    const id = 'llm_default_' + i;
    if (!existingIds.has(id)) {
      _llm.queries.push({
        id, llm: p.llm, llmOther: '', category: p.category, prompt: p.prompt,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      });
      added++;
    }
  });
  const defaultCats = [...new Set(LLM_DEFAULT_PROMPTS.map(p => p.category))];
  defaultCats.forEach(c => { if (!_llm.categories.includes(c)) _llm.categories.push(c); });
  _llmSaveQueries(_llm.queries);
  _llmSaveCategories(_llm.categories);
  _renderLlmList();
  _renderLlmRight();
  if (added === 0) alert('All default prompts are already present.');
  else alert(`${added} default prompt${added > 1 ? 's' : ''} restored.`);
}

function _llmCommitResults(id) {
  const html = document.getElementById('llm-rich-editor')?.innerHTML || '';
  _llm.results[id] = html;
  _llmSaveResults(_llm.results);
  const q = _llm.queries.find(x => x.id === id);
  if (q) { q.resultsAt = new Date().toISOString(); _llmSaveQueries(_llm.queries); }
  _llm.activeQueryId  = id;
  _llm.editingQueryId = null;
  _renderLlmList();
  _renderLlmView();
}

function _llmCancelResults(id) {
  _llm.activeQueryId  = id;
  _llm.editingQueryId = null;
  _renderLlmView();
}

function _llmCopyPrompt(id) {
  const q = _llm.queries.find(x => x.id === id);
  if (!q?.prompt) return;
  navigator.clipboard.writeText(q.prompt).then(() => {
    const hint = document.getElementById(`llm-copy-hint-${id}`);
    if (hint) { hint.textContent = '✓ Prompt copied to clipboard'; setTimeout(() => { hint.textContent = ''; }, 2500); }
  }).catch(() => {});
}

// ── Utility ───────────────────────────────────────────────────────────────────
function _esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
