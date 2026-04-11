/* ── migration.js ── One-time localStorage → IndexedDB migration ──────
 *
 * Called once during app startup (before any UI renders).
 * Reads every localStorage key used by the app and writes it into the
 * appropriate IndexedDB store.  After a successful migration the flag
 * '_migrated_v1' is set in the settings store so the routine is skipped
 * on every subsequent page load.
 *
 * localStorage keys are intentionally left in place so that old browser
 * tabs / cached pages continue to work gracefully.
 * ───────────────────────────────────────────────────────────────────── */

async function runMigrationIfNeeded() {
  try {
    const already = await dbGetSetting('_migrated_v1');
    if (already) return;
  } catch { return; }  // IDB not available — skip silently

  console.log('[TJ] Migrating localStorage → IndexedDB…');

  // ── Helper: migrate a plain-array localStorage key to an IDB store ──
  async function migrateArray(lsKey, storeName) {
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length) await dbReplaceAll(storeName, data);
    } catch (e) {
      console.warn(`[TJ Migration] ${lsKey} →`, e);
    }
  }

  // ── Core entity stores ───────────────────────────────────────────────
  await migrateArray('tj-v1',               'trades');
  await migrateArray('tj-tags-v1',          'tags');
  await migrateArray('tj-mistakes-v1',      'mistakes');
  await migrateArray('tj-rules-v1',         'rules');
  await migrateArray('ow-ideas-v1',         'ideas');
  await migrateArray('tj-llm-trade-plans-v1', 'llmTradePlans');

  // ── Daily plans: stored as { date: html } object → [{ date, html }] ─
  try {
    const raw = localStorage.getItem('tj-plans-v1');
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const recs = Object.entries(obj).map(([date, html]) => ({ date, html }));
        if (recs.length) await dbReplaceAll('plans', recs);
      }
    }
  } catch (e) { console.warn('[TJ Migration] tj-plans-v1 →', e); }

  // ── LLM queries: { queries:[...], categories:[...] } or plain array ──
  try {
    const raw = localStorage.getItem('ltj_llm_queries');
    if (raw) {
      const data    = JSON.parse(raw);
      const queries = Array.isArray(data) ? data : (data?.queries || []);
      if (queries.length) await dbReplaceAll('llmQueries', queries);
      // categories stored separately in settings
      const cats = Array.isArray(data?.categories) ? data.categories : [];
      if (cats.length) await dbPutSetting('ltj_llm_categories', cats);
    }
  } catch (e) { console.warn('[TJ Migration] ltj_llm_queries →', e); }

  // ── Simple settings keys (value stored as-is in settings store) ──────
  const settingsKeys = [
    'ltj_news_config',
    'ltj_news_taxonomy',
    'ltj_llm_results',
    'ltj_llm_categories',
    'tj-cal-month',
    'plan-last-view',
  ];
  for (const k of settingsKeys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw === null) continue;
      let value;
      try { value = JSON.parse(raw); } catch { value = raw; }
      await dbPutSetting(k, value);
    } catch (e) { console.warn(`[TJ Migration] setting ${k} →`, e); }
  }

  // ── Per-symbol prev-report keys (dynamic, any number of symbols) ─────
  try {
    const allKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('ltj_prevRptIds_') || k.startsWith('ltj_prevRptGenAt_'))) {
        allKeys.push(k);
      }
    }
    for (const k of allKeys) {
      const raw = localStorage.getItem(k);
      if (raw === null) continue;
      let value;
      try { value = JSON.parse(raw); } catch { value = raw; }
      await dbPutSetting(k, value);
    }
  } catch (e) { console.warn('[TJ Migration] prevRpt keys →', e); }

  // ── Mark complete ─────────────────────────────────────────────────────
  await dbPutSetting('_migrated_v1', true);
  console.log('[TJ] Migration complete.');
}
