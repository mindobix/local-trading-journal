/* ── llm-import.js ── Daily Plan: paste LLM output → plan + ideas ─── */
//
// Adds an "Import LLM" flow to the Trade Plan → Daily sub-tab.
// User pastes the full LLM response into a textarea; on paste we:
//   1. Pull out every balanced JSON object that looks like a trade plan idea
//   2. Pull "Market Analysis" and "Trade Plan" prose sections from what's left
//   3. Pick a target date (first idea's createdAt, else today)
//   4. Splice the prose into that day's plan HTML under the matching <h4>'s
//   5. Upsert ideas (dedupe by id)
//   6. Re-render the plan view
//
// All work is local — no network calls, no LLM round-trip.

const _LLM_STATUS_VALUES = new Set(['active', 'triggered', 'hit', 'stopped']);

let _llmImportReady = false;

// ── Modal open / close ────────────────────────────────────────────
function openLlmImportModal() {
  const overlay = document.getElementById('llm-import-overlay');
  const modal   = document.getElementById('llm-import-modal');
  const ta      = document.getElementById('llm-import-ta');
  const status  = document.getElementById('llm-import-status');
  if (!overlay || !modal) return;
  ta.value = '';
  status.textContent = '';
  status.className = 'llm-import-status';
  overlay.classList.add('open');
  modal.classList.add('open');
  setTimeout(() => ta.focus(), 30);
}

function closeLlmImportModal() {
  document.getElementById('llm-import-overlay')?.classList.remove('open');
  document.getElementById('llm-import-modal')?.classList.remove('open');
}

// ── Apply ─────────────────────────────────────────────────────────
function _runLlmImport(raw) {
  const status = document.getElementById('llm-import-status');
  status.className = 'llm-import-status';
  status.textContent = '';

  const text = (raw || '').trim();
  if (!text) {
    status.textContent = 'Nothing to import — paste the LLM response into the box.';
    status.classList.add('err');
    return;
  }

  let parsed;
  try {
    parsed = _parseLlmContent(text);
  } catch (e) {
    status.textContent = 'Failed to parse — ' + (e.message || e);
    status.classList.add('err');
    return;
  }

  const { marketAnalysis, tradePlan, ideas, targetDate } = parsed;

  if (!ideas.length && !marketAnalysis && !tradePlan) {
    status.textContent = 'Could not find a Market Analysis section, Trade Plan section, or any JSON trade plans in the pasted text.';
    status.classList.add('err');
    return;
  }

  // 1. Update the plan HTML for the target date
  const plans      = loadPlans();
  const existing   = plans[targetDate];
  const startHtml  = existing !== undefined ? existing : PLAN_TEMPLATE;
  let nextHtml     = startHtml;
  if (marketAnalysis) nextHtml = _updateSectionInPlanHtml(nextHtml, 'Market Analysis', marketAnalysis);
  if (tradePlan)      nextHtml = _updateSectionInPlanHtml(nextHtml, 'Trade Plan',      tradePlan);
  if (nextHtml !== startHtml) savePlanForDate(targetDate, nextHtml);

  // 2. Upsert ideas (dedupe by id)
  let added = 0, updated = 0;
  if (ideas.length) {
    const current = loadIdeas().slice();
    const byId    = new Map(current.map((it, idx) => [it.id, idx]));
    for (const raw of ideas) {
      const norm = _normaliseIdea(raw, targetDate);
      if (norm.id && byId.has(norm.id)) {
        current[byId.get(norm.id)] = norm;
        updated++;
      } else {
        current.push(norm);
        added++;
      }
    }
    saveIdeas(current);
  }

  // 3. Re-render — also force-refresh the daily editor for the target date if open
  if (typeof renderPlanView === 'function') renderPlanView();

  const parts = [];
  if (marketAnalysis) parts.push('Market Analysis');
  if (tradePlan)      parts.push('Trade Plan');
  const dateLabel = new Date(targetDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
  const planMsg   = parts.length ? `Updated ${parts.join(' + ')} for ${dateLabel}.` : '';
  const ideasMsg  = (added || updated)
    ? `${added} new + ${updated} updated trade plan${(added + updated) === 1 ? '' : 's'}.`
    : '';
  status.textContent = [planMsg, ideasMsg].filter(Boolean).join(' ');
  status.classList.add('ok');

  // Close shortly after so user sees confirmation
  setTimeout(closeLlmImportModal, 900);
}

// ── Parsing ───────────────────────────────────────────────────────
function _parseLlmContent(raw) {
  const jsonHits = _extractJsonObjects(raw);
  const ideas    = jsonHits
    .map(h => h.obj)
    .filter(o => o && typeof o === 'object' && typeof o.symbol === 'string' && o.symbol.trim());

  // Strip JSON blobs (and any preceding `json` / ```json fence) from the prose
  let textOnly = raw;
  for (let i = jsonHits.length - 1; i >= 0; i--) {
    const h = jsonHits[i];
    let s = h.start;
    const before = textOnly.slice(0, s);
    const m = before.match(/(?:```\s*json\s*\n?|json\s*)$/i);
    if (m) s -= m[0].length;
    textOnly = textOnly.slice(0, s) + textOnly.slice(h.end);
  }
  textOnly = textOnly.replace(/```/g, '');

  // Find Market Analysis and Trade Plan section markers (on their own line-ish)
  const maRe = /(^|\n)[ \t>*#-]*market analysis[ \t>*#:-]*\s*\n/i;
  const tpRe = /(^|\n)[ \t>*#-]*trade plan[ \t>*#:-]*\s*\n/i;
  const maMatch = maRe.exec(textOnly);
  const tpMatch = tpRe.exec(textOnly);

  let marketAnalysis = '';
  let tradePlan      = '';
  if (maMatch && tpMatch && tpMatch.index > maMatch.index) {
    marketAnalysis = textOnly.slice(maMatch.index + maMatch[0].length, tpMatch.index);
    tradePlan      = textOnly.slice(tpMatch.index + tpMatch[0].length);
  } else if (maMatch) {
    marketAnalysis = textOnly.slice(maMatch.index + maMatch[0].length);
  } else if (tpMatch) {
    tradePlan = textOnly.slice(tpMatch.index + tpMatch[0].length);
  }

  marketAnalysis = _trimSection(marketAnalysis);
  tradePlan      = _trimSection(tradePlan);

  // Pick target date from first idea with a valid createdAt, else today
  let targetDate = todayStr();
  for (const idea of ideas) {
    if (typeof idea.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(idea.createdAt)) {
      targetDate = idea.createdAt;
      break;
    }
  }

  return { marketAnalysis, tradePlan, ideas, targetDate };
}

function _trimSection(s) {
  return (s || '')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

// Scan text for balanced top-level JSON objects. Robust to braces inside strings.
function _extractJsonObjects(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] !== '{') { i++; continue; }
    const start = i;
    let depth = 0, inStr = false, escape = false;
    while (i < n) {
      const c = text[i];
      if (escape) { escape = false; i++; continue; }
      if (inStr) {
        if (c === '\\') escape = true;
        else if (c === '"') inStr = false;
        i++;
        continue;
      }
      if (c === '"') { inStr = true; i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
      i++;
    }
    if (depth === 0) {
      const blob = text.slice(start, i);
      try {
        const obj = JSON.parse(blob);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          out.push({ obj, start, end: i });
        }
      } catch (e) { /* skip non-JSON braces */ }
    } else {
      // unbalanced — bail out of this scan window
      i = start + 1;
    }
  }
  return out;
}

// ── Plan HTML splicing ────────────────────────────────────────────
function _updateSectionInPlanHtml(html, sectionTitle, newText) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const want = norm(sectionTitle);
  const headers = Array.from(wrap.querySelectorAll('h3,h4'));
  let target = headers.find(h => norm(h.textContent) === want);
  if (!target) {
    target = document.createElement('h4');
    target.textContent = sectionTitle;
    wrap.appendChild(target);
  } else {
    let next = target.nextElementSibling;
    while (next && !['H3', 'H4'].includes(next.tagName)) {
      const cur = next;
      next = next.nextElementSibling;
      cur.remove();
    }
  }
  target.insertAdjacentHTML('afterend', _paragraphsToHtml(newText));
  return wrap.innerHTML;
}

function _paragraphsToHtml(text) {
  const paras = String(text || '').split(/\n\s*\n/);
  const html = paras
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>')
    .join('');
  return html || '<p><br></p>';
}

// ── Idea normalisation ────────────────────────────────────────────
function _normaliseIdea(raw, fallbackDate) {
  const symbol = String(raw.symbol || '').trim().toUpperCase();
  const optionType = raw.optionType === 'put' ? 'put' : 'call';
  const createdAt = (typeof raw.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.createdAt))
    ? raw.createdAt : (fallbackDate || todayStr());
  const weekOf = (typeof raw.weekOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.weekOf))
    ? raw.weekOf : getMondayOf(createdAt);
  const status = _LLM_STATUS_VALUES.has(raw.status) ? raw.status : 'active';

  let targets = [];
  if (Array.isArray(raw.targets)) {
    targets = raw.targets.map(v => parseFloat(v)).filter(v => !isNaN(v));
  } else if (raw.target1 || raw.target2 || raw.target3) {
    targets = [raw.target1, raw.target2, raw.target3]
      .map(v => parseFloat(v)).filter(v => !isNaN(v));
  }

  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  return {
    id:           (raw.id && String(raw.id).trim()) || uid(),
    symbol,
    optionType,
    strikePrice:  num(raw.strikePrice),
    expiryDate:   typeof raw.expiryDate === 'string' ? raw.expiryDate : null,
    triggerPrice: num(raw.triggerPrice),
    targets,
    stopPrice:    num(raw.stopPrice),
    weekOf,
    createdAt,
    status,
    notes:        typeof raw.notes === 'string' ? raw.notes.trim() : '',
    customColor:  typeof raw.customColor === 'string' && /^#[0-9a-fA-F]{3,6}$/.test(raw.customColor) ? raw.customColor : null,
  };
}

// ── Init ──────────────────────────────────────────────────────────
function initLlmImport() {
  if (_llmImportReady) return;
  _llmImportReady = true;

  document.getElementById('llm-import-overlay')?.addEventListener('click', closeLlmImportModal);
  document.getElementById('llm-import-close')?.addEventListener('click', closeLlmImportModal);
  document.getElementById('llm-import-cancel')?.addEventListener('click', closeLlmImportModal);
  document.getElementById('llm-import-apply')?.addEventListener('click', () => {
    const ta = document.getElementById('llm-import-ta');
    if (ta) _runLlmImport(ta.value);
  });

  const ta = document.getElementById('llm-import-ta');
  if (ta) {
    ta.addEventListener('paste', () => {
      setTimeout(() => {
        const val = ta.value.trim();
        if (val) _runLlmImport(val);
      }, 0);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('llm-import-modal')?.classList.contains('open')) {
      closeLlmImportModal();
    }
  });
}
