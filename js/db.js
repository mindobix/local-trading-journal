/* ── db.js ── IndexedDB core layer ────────────────────────────────────
 *
 * Database: trading-journal-db  (version 4)
 * Object stores:
 *   trades           keyPath: 'id'
 *   tags             keyPath: 'id'
 *   mistakes         keyPath: 'id'
 *   rules            keyPath: 'id'
 *   ideas            keyPath: 'id'
 *   llmTradePlans    keyPath: 'id'
 *   llmQueries       keyPath: 'id'
 *   bankingAccounts  keyPath: 'id'
 *   bankingEntries   keyPath: 'id'
 *   plans            keyPath: 'date'   { date:'YYYY-MM-DD', html:'...' }
 *   settings         keyPath: 'key'    { key:'...', value:... }
 *
 * All functions are async and return Promises.
 * ───────────────────────────────────────────────────────────────────── */

const TJ_DB_NAME    = 'trading-journal-db';
const TJ_DB_VERSION = 4;

let _tjIdb = null;

function _openTjDb() {
  if (_tjIdb) return Promise.resolve(_tjIdb);
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };

    // Safety net: if the open request hangs (stuck upgrade lock), delete and retry once
    const timer = setTimeout(async () => {
      console.warn('[TJ] DB open timed out — deleting stuck DB and retrying');
      try {
        await new Promise((res, rej) => {
          const del = indexedDB.deleteDatabase(TJ_DB_NAME);
          del.onsuccess = res;
          del.onerror   = () => rej(del.error);
        });
        _tjIdb = null;
        _openTjDb().then(resolve, reject);
      } catch (e) { reject(e); }
    }, 4000);

    const req = indexedDB.open(TJ_DB_NAME, TJ_DB_VERSION);
    req.onblocked = () => console.warn('[TJ] DB open blocked by another connection');

    req.onupgradeneeded = e => {
      const db = e.target.result;
      for (const name of ['trades','tags','mistakes','rules','ideas','llmTradePlans','llmQueries','bankingAccounts','bankingEntries']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('plans'))    db.createObjectStore('plans',    { keyPath: 'date' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key'  });
    };

    req.onsuccess = e => { _tjIdb = e.target.result; done(resolve, _tjIdb); };
    req.onerror   = e => done(reject, e.target.error);
  });
}

// ── Read helpers ─────────────────────────────────────────────────────

async function dbGetAll(storeName) {
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGet(storeName, key) {
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── Write helpers ────────────────────────────────────────────────────

/** Put a single record (insert or update). */
async function dbPut(storeName, record) {
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite').objectStore(storeName).put(record);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/** Delete a single record by key. */
async function dbDelete(storeName, key) {
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Replace the entire contents of a store in a single transaction.
 * Equivalent to clear() + put(each record).
 */
async function dbReplaceAll(storeName, records) {
  const db = await _openTjDb();
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeName, 'readwrite');
    } catch (e) {
      reject(e);
      return;
    }
    const store = tx.objectStore(storeName);
    store.clear();
    for (const r of records) store.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error || new Error(`Transaction aborted on store "${storeName}"`));
  });
}

// ── Settings convenience helpers ─────────────────────────────────────

/** Get a named setting value (returns undefined if not set). */
async function dbGetSetting(key) {
  const rec = await dbGet('settings', key);
  return rec !== undefined ? rec.value : undefined;
}

/** Persist a named setting value. */
async function dbPutSetting(key, value) {
  return dbPut('settings', { key, value });
}

/** Remove a named setting. */
async function dbDeleteSetting(key) {
  return dbDelete('settings', key);
}
