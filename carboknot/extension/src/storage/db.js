// Carboknot local storage.
//
// Zero-trust invariant: everything in this file lives only in the user's
// browser (IndexedDB via Dexie). Nothing written here is replicated,
// synced, or transmitted anywhere. The audit_log store is an append-only
// ledger the user can inspect to verify what the extension has done.

import Dexie from 'dexie';

/** @typedef {Object} ViewRow
 *  @property {number} [id]
 *  @property {string} url
 *  @property {string} title
 *  @property {number} price
 *  @property {string} category
 *  @property {boolean} category_uncertain
 *  @property {string} merchant           e.g. 'amazon' or 'ebay'
 *  @property {number} kg_total
 *  @property {string} trace              JSON-stringified trace object
 *  @property {string} occurred_at        ISO-8601 timestamp
 */

/** @typedef {Object} AuditRow
 *  @property {number} [id]
 *  @property {string} event_type         e.g. 'view_logged', 'proxy_call', 'settings_changed'
 *  @property {string} timestamp          ISO-8601
 *  @property {Object} [details]
 */

export const db = new Dexie('carboknot');

db.version(1).stores({
  views:     '++id, url, occurred_at, category, merchant',
  audit_log: '++id, event_type, timestamp'
});

// v2 adds a key-value settings store. Used by the dashboard for the monthly
// budget input, by the service worker for the Dedalus swarm cache-status
// heartbeat (key 'swarm_status'), and for any future local preferences.
// Rows shape: { key: string, value: any }.
db.version(2).stores({
  views:     '++id, url, occurred_at, category, merchant',
  audit_log: '++id, event_type, timestamp',
  settings:  'key'
});

// v3 adds the Climatiq response cache. Keys are '<category>::<price_bucket>'
// so nearby prices in the same category share a cache line and we stay well
// under Climatiq's free-tier quota. Rows shape:
//   { key, co2e_kg, emission_factor_id, emission_factor_name, cached_at }
// The `&key` marker asserts uniqueness (tightening v2's implicit primary key).
db.version(3).stores({
  views:          '++id, url, occurred_at, category, merchant',
  audit_log:      '++id, event_type, timestamp',
  settings:       '&key',
  climatiq_cache: '&key, cached_at'
});

/**
 * Append a product view to the local history.
 * @param {Object} input
 * @param {string} input.url
 * @param {string} input.title
 * @param {number} input.price
 * @param {string} input.category
 * @param {boolean} [input.category_uncertain]
 * @param {string} input.merchant
 * @param {number} input.kg_total
 * @param {Object} input.trace
 * @returns {Promise<number>} the inserted row id
 */
export async function logView({
  url,
  title,
  price,
  category,
  category_uncertain = false,
  merchant,
  kg_total,
  trace
}) {
  const occurred_at = new Date().toISOString();
  const id = await db.views.add({
    url,
    title,
    price,
    category,
    category_uncertain: !!category_uncertain,
    merchant,
    kg_total,
    trace: JSON.stringify(trace),
    occurred_at
  });
  await logEvent('view_logged', { view_id: id, merchant, category, kg_total });
  return id;
}

/**
 * Read the full view history, newest first.
 * @param {Object} [opts]
 * @param {number} [opts.limit]       max rows
 * @param {string} [opts.sinceIso]    only rows with occurred_at >= this ISO string
 * @returns {Promise<ViewRow[]>}
 */
export async function getHistory({ limit, sinceIso } = {}) {
  let rows = await db.views.orderBy('occurred_at').reverse().toArray();
  if (sinceIso) rows = rows.filter((r) => r.occurred_at >= sinceIso);
  if (typeof limit === 'number') rows = rows.slice(0, limit);
  return rows;
}

/**
 * Append an event to the local audit log. Never transmitted anywhere.
 * `details` is optional — when omitted, the row is just
 * `{ event_type, timestamp }` which is what the privacy-receipt counters
 * in the dashboard rely on.
 * @param {string} event_type
 * @param {Object} [details]
 */
export async function logEvent(event_type, details) {
  const row = {
    event_type,
    timestamp: new Date().toISOString()
  };
  if (details) row.details = { ...details };
  return db.audit_log.add(row);
}

/**
 * Read the audit log, newest first.
 * @param {number} [limit]
 * @returns {Promise<AuditRow[]>}
 */
export async function getAuditLog(limit) {
  const rows = await db.audit_log.orderBy('timestamp').reverse().toArray();
  return typeof limit === 'number' ? rows.slice(0, limit) : rows;
}

/**
 * Read a single settings value. Returns `undefined` if the key is unset.
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getSetting(key) {
  const row = await db.settings.get(key);
  return row?.value;
}

/**
 * Write a settings value. Overwrites any prior value for the same key.
 * @param {string} key
 * @param {any} value
 * @returns {Promise<string>} the key
 */
export async function putSetting(key, value) {
  return db.settings.put({ key, value });
}

/**
 * Wipe all local data. Used by the "Reset" action in Settings.
 */
export async function resetAll() {
  await db.views.clear();
  await db.audit_log.clear();
  await db.settings.clear();
  await db.climatiq_cache.clear();
  await logEvent('reset_all', {});
}

/**
 * Read a single Climatiq cache entry by key, or `undefined` if missing.
 * @param {string} key
 * @returns {Promise<{key: string, co2e_kg: number, emission_factor_id: string, emission_factor_name?: string, cached_at: string} | undefined>}
 */
export async function getCacheEntry(key) {
  return db.climatiq_cache.get(key);
}

/**
 * Upsert a Climatiq cache entry. Caller owns the key + cached_at.
 * @param {{key: string, co2e_kg: number, emission_factor_id: string, emission_factor_name?: string, cached_at: string}} entry
 * @returns {Promise<string>} the key
 */
export async function putCacheEntry(entry) {
  return db.climatiq_cache.put(entry);
}

/**
 * Bulk-upsert many Climatiq cache entries in a single Dexie transaction.
 * Used by the service worker's install-time warm-hydrate to load the
 * Dedalus Machine's pre-computed factor bundle into IndexedDB in one
 * round trip.
 *
 * @param {Array<{key: string, co2e_kg: number, emission_factor_id: string, emission_factor_name?: string, cached_at: string}>} entries
 * @returns {Promise<number>} the number of entries written
 */
export async function bulkPutCacheEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  await db.climatiq_cache.bulkPut(entries);
  return entries.length;
}

/**
 * Cache health numbers surfaced in the dashboard's "Privacy receipt".
 *
 * `hit_count_session` / `miss_count_session` count today's audit events
 * by string-prefix match on the ISO timestamp (`YYYY-MM-DD`). This keeps
 * the query cheap — the `audit_log.event_type` index does the selective
 * work, the date filter is a per-row substring check. No cross-day
 * aggregation is attempted here; the dashboard can layer that on later.
 *
 * @returns {Promise<{ total_entries: number, hit_count_session: number, miss_count_session: number }>}
 */
export async function getClimatiqCacheStats() {
  const todayPrefix = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  const [total_entries, hit_count_session, miss_count_session] = await Promise.all([
    db.climatiq_cache.count(),
    db.audit_log
      .where('event_type').equals('climatiq_cache_hit')
      .and((r) => typeof r.timestamp === 'string' && r.timestamp.startsWith(todayPrefix))
      .count(),
    db.audit_log
      .where('event_type').equals('climatiq_cache_miss')
      .and((r) => typeof r.timestamp === 'string' && r.timestamp.startsWith(todayPrefix))
      .count()
  ]);

  return { total_entries, hit_count_session, miss_count_session };
}
