// Carboknot — Climatiq client-side wrapper.
//
// All Climatiq state — the cache, the network call, the audit events —
// lives inside the service worker (see background/service-worker.js).
// This module is a thin messaging client: it sends the request, waits
// up to REQUEST_TIMEOUT_MS, and translates the response into the shape
// the engine wrapper expects. On any failure we return `null` so the
// caller can fall back to the local engine. Users never wait on a
// blocked page.
//
// Why keep the cache/audit in the SW? Content scripts run in the
// merchant page's origin; IndexedDB is origin-scoped, so a hit on
// amazon.com wouldn't help the same SKU browsed later on ebay.com. The
// SW has a stable extension-owned origin shared with the dashboard.

const REQUEST_TIMEOUT_MS = 4000;

/**
 * Snap `price` into a bucket so nearby prices share a cache line.
 * Bucket sizes: <50 → 5, <200 → 10, <1000 → 25, else → 100.
 * Kept exported for unit tests and parity with the SW's internal copy.
 * @param {number} price
 * @returns {number}
 */
export function priceBucket(price) {
  const size = price < 50 ? 5 : price < 200 ? 10 : price < 1000 ? 25 : 100;
  return Math.round(price / size) * size;
}

/**
 * Build the cache key. Must stay in sync with the SW's `cacheKey`.
 * @param {string} category
 * @param {number} price
 * @returns {string}
 */
export function cacheKey(category, price) {
  return `${category}::${priceBucket(price)}`;
}

function sendMessageWithTimeout(message, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // chrome.runtime.lastError fires when the SW is unreachable
        // (e.g. during extension reload). Treat as a miss.
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response ?? null);
      });
    } catch (_) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * Resolve a <category, price> pair to a Climatiq-backed estimate.
 *
 * Delegates everything to the service worker: cache lookup, proxy call,
 * cache write, and the `climatiq_cache_hit` / `climatiq_cache_miss`
 * audit events. We only translate the response shape.
 *
 * @param {string} category  Internal category key (e.g. 'audio_electronics').
 * @param {number} price     USD price. Should already be validated upstream.
 * @returns {Promise<
 *   | { co2e_kg: number, source: 'cache',    emission_factor_id: string, emission_factor_name?: string, cached_at: string }
 *   | { co2e_kg: number, source: 'climatiq', emission_factor_id: string, emission_factor_name?: string }
 *   | null
 * >}
 */
export async function getEstimate(category, price) {
  const response = await sendMessageWithTimeout(
    { type: 'climatiq_estimate', category, price },
    REQUEST_TIMEOUT_MS
  );

  if (
    !response ||
    response.ok !== true ||
    typeof response.co2e_kg !== 'number' ||
    typeof response.emission_factor_id !== 'string' ||
    (response.source !== 'cache' && response.source !== 'climatiq')
  ) {
    return null;
  }

  if (response.source === 'cache') {
    return {
      co2e_kg: response.co2e_kg,
      source: 'cache',
      emission_factor_id: response.emission_factor_id,
      emission_factor_name: response.emission_factor_name,
      cached_at:
        typeof response.cached_at === 'string'
          ? response.cached_at
          : new Date().toISOString()
    };
  }

  return {
    co2e_kg: response.co2e_kg,
    source: 'climatiq',
    emission_factor_id: response.emission_factor_id,
    emission_factor_name: response.emission_factor_name
  };
}
