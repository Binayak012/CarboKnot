// Carboknot — content-script storage bridge.
//
// Every content script runs in the merchant page's origin (amazon.com,
// ebay.com, target.com, …). IndexedDB is origin-scoped, so anything a
// content script writes via Dexie lands in that site's local database
// and is invisible to the dashboard (which lives on the extension's
// own origin). That's why this bridge exists: persistence goes through
// the service worker, which has a stable single origin shared with the
// dashboard. Reads stay in storage/db.js for dashboard code.
//
// Every wrapper is fire-and-forget-safe: a failed message never throws,
// it resolves to `null`. The call sites (dispatcher.js, panel.js) treat
// storage as best-effort so a rejected promise can never break a page.

function sendMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response ?? null);
      });
    } catch (_) {
      // chrome.runtime can be missing if the extension was just reloaded.
      resolve(null);
    }
  });
}

/**
 * Persist a product view through the service worker.
 * @param {Object} payload  same shape `storage/db.js#logView` accepts
 * @returns {Promise<{ ok: true, id: number } | { ok: false, error: string } | null>}
 */
export async function logView(payload) {
  return sendMessage({ type: 'log_view', payload });
}

/**
 * Append an audit event through the service worker.
 * @param {string} event_type
 * @param {Object} [details]
 * @returns {Promise<{ ok: true } | { ok: false, error: string } | null>}
 */
export async function logEvent(event_type, details) {
  return sendMessage({ type: 'log_event', event_type, details });
}
