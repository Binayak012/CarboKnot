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

// v2 adds a key-value settings store.
db.version(2).stores({
  views:     '++id, url, occurred_at, category, merchant',
  audit_log: '++id, event_type, timestamp',
  settings:  'key'
});

// v3 adds purchased confirmation fields to views.
// purchased: true once a Knot transaction webhook confirms the item was bought.
// knot_transaction_id: the Knot transaction ID for audit trail.
db.version(3).stores({
  views:     '++id, url, occurred_at, category, merchant, purchased',
  audit_log: '++id, event_type, timestamp',
  settings:  'key'
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
 * @param {string} event_type
 * @param {Object} [details]
 */
export async function logEvent(event_type, details) {
  return db.audit_log.add({
    event_type,
    timestamp: new Date().toISOString(),
    details: details ? { ...details } : undefined
  });
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
 * Mark a view row as a confirmed purchase from a Knot transaction webhook.
 * @param {number} viewId
 * @param {string} knotTransactionId
 */
export async function markPurchased(viewId, knotTransactionId) {
  await db.views.update(viewId, {
    purchased: true,
    knot_transaction_id: knotTransactionId
  });
  await logEvent('purchase_confirmed', { view_id: viewId });
}

/**
 * Read all view rows that match a merchant, amount window, and time window.
 * Used by the service worker to match Knot transactions to local browse history.
 * @param {{ merchant: string, amount_usd: number, occurred_at: string }} tx
 * @returns {Promise<Array>}
 */
export async function findMatchingViews({ merchant, amount_usd, occurred_at }) {
  const txTime = Date.parse(occurred_at);
  const WINDOW_MS = 4 * 60 * 60 * 1000; // ±4 hours
  const rows = await db.views
    .where('merchant').equals(merchant)
    .filter((row) => {
      if (row.purchased) return false;
      const rowTime = Date.parse(row.occurred_at);
      if (Math.abs(rowTime - txTime) > WINDOW_MS) return false;
      // Transaction total includes tax/shipping so it may exceed page price.
      // Accept if transaction is between 90% and 150% of the page price.
      const ratio = amount_usd / row.price;
      return ratio >= 0.9 && ratio <= 1.5;
    })
    .toArray();
  // Return closest match first.
  rows.sort((a, b) =>
    Math.abs(Date.parse(a.occurred_at) - txTime) -
    Math.abs(Date.parse(b.occurred_at) - txTime)
  );
  return rows;
}

/**
 * Wipe all local data. Used by the "Reset" action in Settings.
 */
export async function resetAll() {
  await db.views.clear();
  await db.audit_log.clear();
  await db.settings.clear();
  await logEvent('reset_all', {});
}
