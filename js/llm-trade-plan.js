/* ── llm-trade-plan.js ── LLM Trade Plan tab ─────────────────────── */

const LLM_PLAN_KEY = 'tj-llm-trade-plans-v1';

// ── Storage ───────────────────────────────────────────────────────────

function loadLlmTradePlans() {
  try { return JSON.parse(localStorage.getItem(LLM_PLAN_KEY) || '[]'); }
  catch { return []; }
}

function saveLlmTradePlans(plans) {
  localStorage.setItem(LLM_PLAN_KEY, JSON.stringify(plans));
}

function getLlmTradePlansForBackup() { return loadLlmTradePlans(); }

function restoreLlmTradePlansFromBackup(plans) {
  if (!Array.isArray(plans)) return;
  const existing = loadLlmTradePlans();
  const map = new Map(existing.map(p => [p.id, p]));
  for (const p of plans) map.set(p.id, p);
  saveLlmTradePlans([...map.values()]);
}

// ── State ─────────────────────────────────────────────────────────────

const LTP_STATE = {
  selectedId: null, // null = empty, string = plan id (new or existing)
  isNew: false,
};

// ── Init ──────────────────────────────────────────────────────────────

function ltpShowInBody(container) {
  container.innerHTML = `
<div class="ltp-layout">
  <div class="ltp-left">
    <div class="ltp-left-header">
      <span class="ltp-left-title">LLM Trade Plans</span>
      <button class="llm-new-btn" onclick="ltpNewPlan()">+ New</button>
    </div>
    <div class="ltp-list" id="ltp-list"></div>
  </div>
  <div class="ltp-right">
    <div class="ltp-right-inner" id="ltp-right-inner"></div>
  </div>
</div>`;
  ltpRenderList();
  ltpRenderRight();
}

// ── Left panel ────────────────────────────────────────────────────────

function ltpRenderList() {
  const list = document.getElementById('ltp-list');
  if (!list) return;
  const plans = loadLlmTradePlans();

  if (!plans.length) {
    list.innerHTML = '<div class="ltp-list-empty">No plans yet.<br>Click <strong>+ New</strong> to create one.</div>';
    return;
  }

  list.innerHTML = plans.map(p => {
    const card      = p.cardData || {};
    const sym       = card.symbol || '—';
    const color     = card.customColor || tickerColor(sym);
    const typeCls   = card.optionType === 'put' ? 'put' : 'call';
    const typeLabel = card.optionType === 'put' ? 'PUT' : 'CALL';
    const isActive  = p.id === LTP_STATE.selectedId;
    const llmLabel  = p.llm === 'Other' && p.llmOther ? p.llmOther : (p.llm || p.llmSource || '');

    const updatedLabel = (() => {
      if (!p.lastUpdated) return null;
      const d = new Date(p.lastUpdated);
      if (isNaN(d)) return null;
      const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                        .toLowerCase().replace(' ', '');
      return `${datePart}, ${timePart}`;
    })();

    const expiry  = card.expiryDate  ? fmtShortDate(card.expiryDate)  : null;
    const strike  = card.strikePrice != null ? fmtPrice(card.strikePrice) : null;
    const at      = card.triggerPrice != null ? fmtPrice(card.triggerPrice) : null;
    const notes   = card.notes ? esc(card.notes).slice(0, 120) : null;

    const detailParts = [
      expiry ? `<span class="ltp-detail-val">${expiry}</span>` : null,
      strike ? `<span class="ltp-detail-label">S</span><span class="ltp-detail-val">${strike}</span>` : null,
      at     ? `<span class="ltp-detail-label">AT</span><span class="ltp-detail-val">${at}</span>` : null,
    ].filter(Boolean).join('');

    return `
<div class="ltp-list-item${isActive ? ' active' : ''}" onclick="ltpSelectPlan('${esc(p.id)}')">
  <div class="ltp-list-top">
    <span class="ltp-list-sym" style="color:${color}">$${esc(sym)}</span>
    <span class="ltp-type-pill ${typeCls}">${typeLabel}</span>
  </div>
  ${detailParts ? `<div class="ltp-list-detail">${detailParts}</div>` : ''}
  ${notes ? `<div class="ltp-list-notes">${notes}</div>` : ''}
  <div class="ltp-list-bottom">
    ${llmLabel ? `<span class="ltp-source-pill">${esc(llmLabel)}</span>` : ''}
    ${updatedLabel ? `<span class="ltp-list-updated">updated ${updatedLabel}</span>` : ''}
  </div>
</div>`;
  }).join('');
}

// ── Right panel ───────────────────────────────────────────────────────

function ltpRenderRight() {
  const inner = document.getElementById('ltp-right-inner');
  if (!inner) return;

  // Empty state
  if (!LTP_STATE.selectedId && !LTP_STATE.isNew) {
    inner.innerHTML = `
<div class="ltp-empty-state">
  <button class="ltp-new-btn" onclick="ltpNewPlan()">+ New LLM Trade Plan</button>
  <p class="ltp-empty-hint">Paste JSON from your LLM to create a trade plan card,<br>or select a saved plan from the list.</p>
</div>`;
    return;
  }

  // Editor state — JSON + preview
  const plans      = loadLlmTradePlans();
  const plan       = LTP_STATE.isNew ? null : plans.find(p => p.id === LTP_STATE.selectedId);
  const rawJson    = plan?.rawJson || '';
  const currentLlm  = plan?.llm || (plan?.llmSource && !LLM_TYPES.includes(plan.llmSource) ? 'Other' : plan?.llmSource) || 'Grok';
  const currentOther = plan?.llmOther || (!LLM_TYPES.includes(plan?.llmSource || '') ? (plan?.llmSource || '') : '');
  const llmLabel   = currentLlm === 'Other' && currentOther ? currentOther : currentLlm;

  const llmOptions = LLM_TYPES.map(t =>
    `<option value="${t}"${t === currentLlm ? ' selected' : ''}>${t}</option>`
  ).join('');

  inner.innerHTML = `
<div class="ltp-editor-wrap">
  <div class="ltp-editor-header">
    <div class="ltp-editor-meta">
      ${plan ? `<span class="ltp-source-pill">${esc(llmLabel)}</span>` : ''}
      ${plan?.lastUpdated ? `<span class="ltp-view-date">Updated: ${plan.lastUpdated}</span>` : ''}
    </div>
    <div class="ltp-editor-btns">
      ${plan ? `
        <button class="ltp-transfer-btn" onclick="ltpTransferToTradePlan('${esc(plan.id)}')">&#8594; Transfer to Trade Plan</button>
        <button class="ltp-del-btn" onclick="ltpDeletePlan('${esc(plan.id)}')">&#128465;</button>
      ` : ''}
      <button class="ltp-cancel-btn" onclick="ltpCancel()">Cancel</button>
      <button class="ltp-save-btn" onclick="ltpSave()">&#10003; Save</button>
    </div>
  </div>

  <div class="ltp-form-row">
    <label class="ltp-label">LLM Source</label>
    <div class="llm-form-llm-row">
      <select class="llm-form-select" id="ltp-llm-select" onchange="ltpToggleLlmOther()">
        ${llmOptions}
      </select>
      <input class="llm-form-input" id="ltp-llm-other" placeholder="Specify LLM name…"
             value="${esc(currentOther)}"
             style="display:${currentLlm === 'Other' ? 'block' : 'none'}">
    </div>
  </div>

  <div class="ltp-cols">
    <div class="ltp-col-json">
      <label class="ltp-label">Trade Plan JSON
        <span class="ltp-label-hint">— paste from your LLM, preview updates live</span>
      </label>
      <textarea class="ltp-json-editor" id="ltp-json-editor"
        placeholder='Paste trade plan JSON from your LLM here…'
        oninput="ltpUpdatePreview()">${esc(rawJson)}</textarea>
      <div class="ltp-json-error" id="ltp-json-error" style="display:none"></div>
    </div>
    <div class="ltp-col-preview">
      <div class="ltp-preview-wrap" id="ltp-preview-wrap">
        <div class="ltp-preview-label-row">
          <label class="ltp-label">Preview</label>
          ${plan ? `
          <button class="ltp-edit-icon-btn" onclick="ltpOpenIdeaModal('${esc(plan.id)}')" title="Edit via form dialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>` : ''}
        </div>
        <div class="ltp-preview-body" id="ltp-preview-body">
          <div class="ltp-preview-empty">Enter valid JSON to see preview</div>
        </div>
      </div>
    </div>
  </div>
</div>`;

  if (rawJson) ltpUpdatePreview();
}

// ── Live preview ──────────────────────────────────────────────────────

function ltpUpdatePreview() {
  const ta   = document.getElementById('ltp-json-editor');
  const body = document.getElementById('ltp-preview-body');
  const err  = document.getElementById('ltp-json-error');
  if (!ta || !body) return;

  const raw = ta.value.trim();
  if (!raw) {
    body.innerHTML = '<div class="ltp-preview-empty">Enter valid JSON to see preview</div>';
    if (err) err.style.display = 'none';
    return;
  }

  let cardData;
  try {
    cardData = JSON.parse(raw);
    if (err) err.style.display = 'none';
  } catch (e) {
    body.innerHTML = '<div class="ltp-preview-empty">Invalid JSON — fix the syntax above</div>';
    if (err) { err.textContent = e.message; err.style.display = 'block'; }
    return;
  }

  if (!cardData.symbol) {
    body.innerHTML = '<div class="ltp-preview-empty">JSON missing required "symbol" field</div>';
    return;
  }

  if (!cardData.id) cardData.id = '_preview_';
  body.innerHTML = `<div class="ltp-preview-card">${renderIdeaCard(cardData)}</div>`;
  body.querySelectorAll('.option-card, .icon-btn').forEach(el => {
    el.style.pointerEvents = 'none';
    el.style.cursor = 'default';
  });
}

function ltpToggleLlmOther() {
  const sel = document.getElementById('ltp-llm-select');
  const inp = document.getElementById('ltp-llm-other');
  if (sel && inp) inp.style.display = sel.value === 'Other' ? 'block' : 'none';
}

// ── Open idea modal for editing ───────────────────────────────────────

function ltpOpenIdeaModal(planId) {
  const plans = loadLlmTradePlans();
  const plan  = plans.find(p => p.id === planId);
  if (!plan?.cardData) return;

  const cardData = plan.cardData;

  // Ensure card is in ideas store so the modal can load it
  ltpSyncToIdeas(cardData);

  // After the modal saves, sync the updated idea back into this LTP plan
  _ideaPostSaveHook = function(updatedIdea) {
    const latestPlans = loadLlmTradePlans();
    const idx = latestPlans.findIndex(p => p.id === planId);
    if (idx >= 0) {
      latestPlans[idx] = {
        ...latestPlans[idx],
        cardData:    updatedIdea,
        rawJson:     JSON.stringify(updatedIdea, null, 2),
        lastUpdated: new Date().toISOString(),
      };
      saveLlmTradePlans(latestPlans);
    }
    // Refresh the LTP view to show updated JSON + preview
    ltpRenderList();
    ltpRenderRight();
  };

  openEditIdeaModal(cardData.id);
}

// ── Actions ───────────────────────────────────────────────────────────

function ltpNewPlan() {
  LTP_STATE.selectedId = null;
  LTP_STATE.isNew      = true;
  ltpRenderList();
  ltpRenderRight();
}

function ltpSelectPlan(id) {
  LTP_STATE.selectedId = id;
  LTP_STATE.isNew      = false;
  ltpRenderList();
  ltpRenderRight();
}

function ltpCancel() {
  LTP_STATE.selectedId = null;
  LTP_STATE.isNew      = false;
  ltpRenderList();
  ltpRenderRight();
}

function ltpSave() {
  const selectEl = document.getElementById('ltp-llm-select');
  const otherEl  = document.getElementById('ltp-llm-other');
  const jsonEl   = document.getElementById('ltp-json-editor');
  if (!selectEl || !jsonEl) return;

  const llm      = selectEl.value || 'Grok';
  const llmOther = otherEl?.value.trim() || '';
  const rawJson  = jsonEl.value.trim();

  if (!rawJson) { alert('Please enter a Trade Plan JSON.'); return; }

  let cardData;
  try { cardData = JSON.parse(rawJson); }
  catch { alert('Invalid JSON — please fix the syntax before saving.'); return; }

  if (!cardData.symbol) { alert('JSON must include a "symbol" field.'); return; }
  if (!cardData.id) cardData.id = uid();

  const plans = loadLlmTradePlans();
  const now = new Date().toISOString();

  if (!LTP_STATE.isNew && LTP_STATE.selectedId) {
    const idx = plans.findIndex(p => p.id === LTP_STATE.selectedId);
    if (idx >= 0) plans[idx] = { ...plans[idx], llm, llmOther, lastUpdated: now, rawJson, cardData };
  } else {
    const newPlan = { id: uid(), llm, llmOther, lastUpdated: now, rawJson, cardData };
    plans.unshift(newPlan);
    LTP_STATE.selectedId = newPlan.id;
    LTP_STATE.isNew      = false;
  }

  saveLlmTradePlans(plans);
  ltpRenderList();
  ltpRenderRight();
}

function ltpDeletePlan(id) {
  if (!confirm('Delete this LLM Trade Plan?')) return;

  const plans = loadLlmTradePlans();
  const plan  = plans.find(p => p.id === id);
  saveLlmTradePlans(plans.filter(p => p.id !== id));
  if (plan?.cardData?.id) ltpRemoveFromIdeas(plan.cardData.id);

  LTP_STATE.selectedId = null;
  LTP_STATE.isNew      = false;
  ltpRenderList();
  ltpRenderRight();
}

// ── Transfer to Trade Plan tab ────────────────────────────────────────

function ltpTransferToTradePlan(id) {
  const plan = loadLlmTradePlans().find(p => p.id === id);
  if (!plan?.cardData?.symbol) { alert('No valid card data to transfer.'); return; }

  ltpSyncToIdeas(plan.cardData);

  const btn = document.querySelector('.ltp-transfer-btn');
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '&#10003; Transferred!';
    btn.style.background   = 'var(--green)';
    btn.style.borderColor  = 'var(--green)';
    btn.style.color        = '#fff';
    setTimeout(() => {
      btn.innerHTML          = orig;
      btn.style.background   = '';
      btn.style.borderColor  = '';
      btn.style.color        = '';
    }, 1800);
  }
}

// ── Sync helpers ──────────────────────────────────────────────────────

function ltpSyncToIdeas(cardData) {
  const ideas = loadIdeas();
  const idx   = ideas.findIndex(i => i.id === cardData.id);
  if (idx >= 0) ideas[idx] = { ...ideas[idx], ...cardData };
  else ideas.push(cardData);
  saveIdeas(ideas);
}

function ltpRemoveFromIdeas(cardId) {
  saveIdeas(loadIdeas().filter(i => i.id !== cardId));
}
