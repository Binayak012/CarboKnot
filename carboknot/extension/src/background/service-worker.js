// Carboknot background service worker.
//
// Zero-trust invariant: this worker may only reach the configured proxy
// origin below. No other fetch destinations are permitted.
//
// Responsibilities:
//   - Open the dashboard tab when a content script asks for it.
//   - Once per day (and on install), fetch <PROXY>/swarm/cache-status from
//     the Render-hosted proxy and stash the result in the local `settings`
//     store under key 'swarm_status'. The dashboard renders this as
//     "Cache last refreshed: <relative> via Dedalus swarm".
//     The call has a 4-second timeout and any failure is silent — the
//     extension must keep working if the swarm is down.
//
// /api/reason and /api/categorize handlers land in a later phase.

import {
  putSetting,
  logEvent,
  logView,
  getCacheEntry,
  putCacheEntry,
  bulkPutCacheEntries
} from '../storage/db.js';
import category_map from '../engine/category_map.json' with { type: 'json' };

// Keep this in sync with carboknot/extension/manifest.config.ts host_permissions.
// Point at http://localhost:8787 for local dev, or your Dedalus Machine's
// public URL in production. Render is no longer used — the proxy and the
// factor warmer are co-located on a single Machine (see dedalus-machine/README.md).
export const PROXY_ORIGIN = 'http://localhost:8787';

const CLIMATIQ_FETCH_TIMEOUT_MS = 4000;
const REASON_FETCH_TIMEOUT_MS = 5000;

// Cache key must match the content-script's engine/climatiq.js exactly so
// both sides agree on which bucket a <category, price> pair lands in.
function priceBucket(price) {
  const size = price < 50 ? 5 : price < 200 ? 10 : price < 1000 ? 25 : 100;
  return Math.round(price / size) * size;
}
function cacheKey(category, price) {
  return `${category}::${priceBucket(price)}`;
}

const SWARM_STATUS_ALARM = 'swarm_status_refresh';
const SWARM_HYDRATE_ALARM = 'swarm_cache_hydrate';
const SWARM_STATUS_PERIOD_MIN = 24 * 60;
const SWARM_HYDRATE_PERIOD_MIN = 24 * 60;
const SWARM_FETCH_TIMEOUT_MS = 4000;
const SWARM_HYDRATE_TIMEOUT_MS = 8000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SWARM_STATUS_ALARM, {
    delayInMinutes: 0.1,
    periodInMinutes: SWARM_STATUS_PERIOD_MIN
  });
  chrome.alarms.create(SWARM_HYDRATE_ALARM, {
    delayInMinutes: 0.2,
    periodInMinutes: SWARM_HYDRATE_PERIOD_MIN
  });
  refreshSwarmStatus().catch(() => {});
  hydrateCacheBundle().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SWARM_STATUS_ALARM) {
    refreshSwarmStatus().catch(() => {});
  }
  if (alarm.name === SWARM_HYDRATE_ALARM) {
    hydrateCacheBundle().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'open_dashboard') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/index.html') });
    sendResponse({ ok: true });
    return false;
  }
  // Let the dashboard force a refresh on mount so judges see fresh data
  // without waiting for the 24h alarm.
  if (msg?.type === 'swarm_status_refresh') {
    refreshSwarmStatus()
      .then((status) => sendResponse({ ok: true, status }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === 'swarm_cache_hydrate') {
    hydrateCacheBundle()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }
  if (msg?.type === 'explain_alternative') {
    // Payload must match proxy/index.js#handleReason: nested
    // { original: { title, kg_total, category }, alternative: {...} }.
    // The proxy returns { rationale, source } — we surface it to panel.js
    // as `reasoning` so the existing caller stays unchanged.
    const original = msg.original || {};
    const alternative = msg.alternative || {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REASON_FETCH_TIMEOUT_MS);
    fetch(`${PROXY_ORIGIN}/api/reason`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        original: {
          title: original.title,
          kg_total: Number(original.kg),
          category: original.category
        },
        alternative: {
          title: alternative.title,
          kg_total: Number(alternative.kg),
          category: alternative.category || original.category
        }
      })
    })
      .then((res) => {
        if (!res.ok) throw new Error(`reason http ${res.status}`);
        return res.json();
      })
      .then((data) =>
        sendResponse({
          ok: true,
          reasoning: data?.rationale ?? data?.reasoning,
          source: data?.source
        })
      )
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }))
      .finally(() => clearTimeout(timer));
    return true;
  }
  if (msg?.type === 'climatiq_estimate') {
    handleClimatiqEstimate(msg)
      .then((response) => sendResponse(response))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) })
      );
    return true;
  }
  // Content scripts run in the merchant page's origin; their IndexedDB is
  // per-site, so dashboard reads (which run in the extension origin) would
  // never see those writes. Route every persisted event through the worker.
  if (msg?.type === 'log_view') {
    const payload = msg.payload || {};
    logView(payload)
      .then((id) => sendResponse({ ok: true, id }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) })
      );
    return true;
  }
  if (msg?.type === 'log_event') {
    logEvent(msg.event_type, msg.details)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) })
      );
    return true;
  }
  return false;
});

/**
 * Cache-first Climatiq estimate for a <category, price> pair.
 *
 * Runs entirely in the service worker so cache reads, cache writes, and
 * audit events all land in the extension's own IndexedDB — the per-merchant
 * origin has no visibility into this store. On any failure (timeout,
 * non-2xx, malformed body) we resolve with `{ ok: false, ... }` so the
 * caller falls back to the local engine.
 *
 * @param {{ category: string, price: number }} msg
 * @returns {Promise<
 *   | { ok: true, source: 'cache' | 'climatiq', co2e_kg: number, emission_factor_id: string, emission_factor_name?: string, cached_at?: string }
 *   | { ok: false, error: string }
 * >}
 */
async function handleClimatiqEstimate(msg) {
  const category = msg.category;
  const price = msg.price;
  const key = cacheKey(category, price);

  try {
    const cached = await getCacheEntry(key);
    if (cached && typeof cached.co2e_kg === 'number') {
      logEvent('climatiq_cache_hit').catch(() => {});
      return {
        ok: true,
        source: 'cache',
        co2e_kg: cached.co2e_kg,
        emission_factor_id: cached.emission_factor_id,
        emission_factor_name: cached.emission_factor_name,
        cached_at: cached.cached_at
      };
    }
  } catch (_) {
    // Cache read failure is non-fatal; fall through to the network call.
  }

  const mapping = category_map[category] || category_map.general;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIMATIQ_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${PROXY_ORIGIN}/api/climatiq`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        classification_code: mapping.code,
        money: price,
        money_unit: 'usd'
      })
    });
    if (!res.ok) throw new Error(`climatiq http ${res.status}`);
    const data = await res.json();
    if (
      typeof data?.co2e !== 'number' ||
      !data?.emission_factor?.id
    ) {
      throw new Error('climatiq malformed response');
    }

    const cached_at = new Date().toISOString();
    await putCacheEntry({
      key,
      co2e_kg: data.co2e,
      emission_factor_id: data.emission_factor.id,
      emission_factor_name: data.emission_factor.name,
      cached_at
    }).catch(() => {});
    logEvent('climatiq_cache_miss').catch(() => {});

    return {
      ok: true,
      source: 'climatiq',
      co2e_kg: data.co2e,
      emission_factor_id: data.emission_factor.id,
      emission_factor_name: data.emission_factor.name
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch /swarm/cache-status from the proxy with a 4s timeout and persist
 * the result locally. Never throws — all errors are swallowed and logged
 * to the local audit_log only.
 * @returns {Promise<{ last_refresh: string | null, refreshed_categories: string[], fetched_at: string, source: 'dedalus_swarm' | 'fallback' }>}
 */
async function refreshSwarmStatus() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SWARM_FETCH_TIMEOUT_MS);
  const fetched_at = new Date().toISOString();

  try {
    const res = await fetch(`${PROXY_ORIGIN}/swarm/cache-status`, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`swarm status http ${res.status}`);
    const body = await res.json();
    const status = {
      last_refresh: typeof body?.last_refresh === 'string' ? body.last_refresh : null,
      refreshed_categories: Array.isArray(body?.refreshed_categories)
        ? body.refreshed_categories.filter((c) => typeof c === 'string')
        : [],
      fetched_at,
      source: 'dedalus_swarm'
    };
    await putSetting('swarm_status', status);
    await logEvent('swarm_status_refreshed', {
      ok: true,
      category_count: status.refreshed_categories.length
    });
    return status;
  } catch (err) {
    const fallback = {
      last_refresh: null,
      refreshed_categories: [],
      fetched_at,
      source: 'fallback'
    };
    await putSetting('swarm_status', fallback).catch(() => {});
    await logEvent('swarm_status_refreshed', {
      ok: false,
      reason: err?.name === 'AbortError' ? 'timeout' : 'error'
    }).catch(() => {});
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bulk-hydrate the local climatiq_cache store from the Dedalus Machine's
 * warmed bundle at /swarm/cache. This is the whole point of the warmer:
 * the first product a user visits after install hits a warm cache entry
 * (1 ms IndexedDB read) instead of paying a 300-800 ms Climatiq round trip.
 *
 * Never throws. On any failure (proxy down, malformed response, bundle
 * empty) returns { ok: false, ... } and the SW's cache-miss path will
 * populate entries lazily as users browse.
 *
 * @returns {Promise<{ ok: boolean, factor_count?: number, last_refresh?: string | null, reason?: string }>}
 */
async function hydrateCacheBundle() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SWARM_HYDRATE_TIMEOUT_MS);
  try {
    const res = await fetch(`${PROXY_ORIGIN}/swarm/cache`, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'accept': 'application/json' }
    });
    if (!res.ok) {
      // 503 cache_empty is expected on a freshly-booted warmer; not an error.
      const reason = res.status === 503 ? 'cache_empty' : `http_${res.status}`;
      await logEvent('swarm_cache_hydrate', { ok: false, reason }).catch(() => {});
      return { ok: false, reason };
    }
    const body = await res.json();
    const factors = body && typeof body === 'object' ? body.factors : null;
    if (!factors || typeof factors !== 'object') {
      await logEvent('swarm_cache_hydrate', { ok: false, reason: 'malformed' }).catch(() => {});
      return { ok: false, reason: 'malformed' };
    }

    const entries = [];
    for (const [key, f] of Object.entries(factors)) {
      if (!f || typeof f.co2e_kg !== 'number' || !f.emission_factor_id) continue;
      entries.push({
        key,
        co2e_kg: f.co2e_kg,
        emission_factor_id: f.emission_factor_id,
        emission_factor_name: f.emission_factor_name,
        cached_at: f.refreshed_at || body.last_refresh || new Date().toISOString()
      });
    }
    const written = await bulkPutCacheEntries(entries);
    await logEvent('swarm_cache_hydrate', {
      ok: true,
      factor_count: written,
      last_refresh: body.last_refresh || null
    }).catch(() => {});
    return {
      ok: true,
      factor_count: written,
      last_refresh: body.last_refresh || null
    };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : 'error';
    await logEvent('swarm_cache_hydrate', { ok: false, reason }).catch(() => {});
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
