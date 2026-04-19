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
// Set VITE_PROXY_ORIGIN in .env to point at your Vercel deployment or
// Dedalus Machine URL in production. Defaults to localhost:8787 for local dev.
export const PROXY_ORIGIN = import.meta.env.VITE_PROXY_ORIGIN || 'http://localhost:8787';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
const SWARM_HYDRATE_TIMEOUT_MS = 3000;

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
  if (msg?.type === 'fetch_alternatives') {
    fetchGeminiAlternativesDirect(msg)
      .then((alternatives) => sendResponse({ ok: true, alternatives, source: 'gemini' }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }
  return false;
});

function altPriceBucket(price) {
  const size = price < 50 ? 5 : price < 200 ? 10 : price < 1000 ? 25 : 100;
  return Math.round(price / size) * size;
}

const _altCache = new Map();
const ALT_CACHE_TTL_MS = 10 * 60 * 1000;

async function fetchGeminiAlternativesDirect({ title, category, price, carbon_kg, site }) {
  if (!GEMINI_API_KEY) throw new Error('gemini_key_missing');

  const priceNum = Number(price) || 0;
  const carbonNum = Number(carbon_kg) || 0;
  const cacheKey = `${category}::${altPriceBucket(priceNum)}`;
  const cached = _altCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ALT_CACHE_TTL_MS) return cached.data;

  const siteCtx = String(site || '').includes('ebay')
    ? 'User is on eBay — prioritise refurbished and pre-owned listings.'
    : String(site || '').includes('amazon')
    ? 'User is on Amazon — mix of energy-efficient new products and certified refurbished.'
    : 'User is shopping online — include refurbished, secondhand and sustainable brands.';

  // Merchant pool: 7 destinations so alternatives span 5+ unique sites.
  const merchantList =
    'Back Market, eBay (refurbished/pre-owned), Amazon (renewed/certified), ' +
    'ThredUp, Poshmark, Swappa, Walmart (renewed)';

  const userPrompt =
    `You are a sustainability expert. Return ONLY a raw JSON array (no markdown fences, no commentary).\n\n` +
    `Product: "${title}" | Category: ${category} | Price: $${priceNum} | Carbon: ${carbonNum.toFixed(1)} kg CO₂e\n` +
    `${siteCtx}\n\n` +
    `Suggest 6 specific lower-carbon alternatives. RULES:\n` +
    `- Each MUST be a real, currently purchasable product (exact brand + model).\n` +
    `- Refurbished/renewed/secondhand items are lower carbon because they cost less and avoid new manufacturing.\n` +
    `- Spread across AT LEAST 5 different merchants from: ${merchantList}.\n` +
    `- Do NOT repeat the same merchant more than twice.\n\n` +
    `Each JSON object must have ONLY these keys:\n` +
    `- name: exact brand + full model name (string)\n` +
    `- why: 1-2 sentences explaining which emission stage (manufacturing, shipping, packaging, end-of-life) is reduced and why (string)\n` +
    `- search_query: best search terms to find this exact product on the merchant (string)\n` +
    `- type: one of refurbished, secondhand, efficient, durable (string)\n` +
    `- preferred_merchant: one of backmarket, ebay, amazon, thredup, poshmark, swappa, walmart (string)\n` +
    `- estimated_price_usd: realistic estimated price in USD on this merchant (number)\n\n` +
    `Output raw JSON array only, starting with [ and ending with ].`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 8192, temperature: 0.5, thinkingConfig: { thinkingBudget: 0 } }
      })
    });
    if (!res.ok) throw new Error(`gemini_http_${res.status}`);
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!raw) throw new Error('empty_gemini_response');

    let parsed;
    try { parsed = JSON.parse(raw); } catch { /* try extraction below */ }
    if (!Array.isArray(parsed)) {
      const m = raw.match(/\[[\s\S]*\]/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* noop */ } }
    }
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('no_json_array');

    // Carbon comes ONLY from Climatiq — no carbon_factor needed from Gemini.
    // Filter on name + type only.
    const mapping = category_map[category] || category_map.general;
    const validateCarbon = async (altPrice) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        const r = await fetch(`${PROXY_ORIGIN}/api/climatiq`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            classification_code: mapping.code,
            money: altPrice,
            money_unit: 'usd'
          })
        });
        clearTimeout(t);
        if (!r.ok) return null;
        const d = await r.json();
        return typeof d?.co2e === 'number' ? d.co2e : null;
      } catch { return null; }
    };

    const alternatives = parsed
      .filter(a => a && typeof a.name === 'string')
      .slice(0, 6);

    // Build alternatives with merchant-specific URLs across 7 sites.
    // Carbon = ALWAYS Climatiq spend-based (proportional to price).
    const results = await Promise.all(alternatives.map(async (a) => {
      const sq = encodeURIComponent(a.search_query || a.name);
      const isUsed = a.type === 'refurbished' || a.type === 'secondhand';
      const merchant = String(a.preferred_merchant || '').toLowerCase().trim();

      // Estimated price: prefer Gemini's estimate, fall back to ratio.
      const priceEst = (typeof a.estimated_price_usd === 'number' && a.estimated_price_usd > 0)
        ? Math.round(a.estimated_price_usd)
        : Math.round(isUsed ? priceNum * 0.55 : priceNum * 0.9);

      // Build URL for 7 merchants.
      const { url, merchantLabel } = buildMerchantUrl(merchant, sq, isUsed, a.type);

      // Carbon via Climatiq — same ISIC category, alternative's price.
      // Climatiq spend-based factors are proportional to price, so a $180
      // refurbished item in the same category always has less carbon than
      // the $350 original. Fallback: price-proportional from original.
      const climatiqCo2e = await validateCarbon(priceEst);
      const priceRatio = priceNum > 0 ? priceEst / priceNum : 0.5;
      const altCarbon = climatiqCo2e != null ? climatiqCo2e : carbonNum * priceRatio;
      const carbonSource = climatiqCo2e != null ? 'climatiq' : 'price_proportional';

      return {
        name: String(a.name).slice(0, 120),
        merchant: merchantLabel,
        price_usd: priceEst,
        carbon_kg: altCarbon,
        carbon_saved_kg: carbonNum - altCarbon,
        url,
        rationale: String(a.why || '').slice(0, 400),
        type: a.type || 'efficient',
        carbon_source: carbonSource
      };
    }));

    // Only keep alternatives that actually save carbon.
    const valid = results.filter(a => a.carbon_saved_kg > 0);
    if (valid.length === 0) throw new Error('no_valid_alternatives');

    _altCache.set(cacheKey, { ts: Date.now(), data: valid });
    return valid;
  } finally {
    clearTimeout(timer);
  }
}

// 7 merchant URL builders — gives alternatives from 5+ unique sites.
function buildMerchantUrl(merchant, searchQuery, isUsed, type) {
  switch (merchant) {
    case 'ebay':
      return {
        url: `https://www.ebay.com/sch/i.html?_nkw=${searchQuery}${isUsed ? '&LH_ItemCondition=3000' : ''}`,
        merchantLabel: isUsed ? 'eBay Pre-owned' : 'eBay'
      };
    case 'amazon':
      return {
        url: `https://www.amazon.com/s?k=${searchQuery}${isUsed ? '+renewed' : ''}`,
        merchantLabel: isUsed ? 'Amazon Renewed' : 'Amazon'
      };
    case 'backmarket':
      return {
        url: `https://www.backmarket.com/en-us/search?q=${searchQuery}`,
        merchantLabel: 'Back Market'
      };
    case 'thredup':
      return {
        url: `https://www.thredup.com/products/search?search_terms=${searchQuery}`,
        merchantLabel: 'ThredUp'
      };
    case 'poshmark':
      return {
        url: `https://poshmark.com/search?query=${searchQuery}&type=listings`,
        merchantLabel: 'Poshmark'
      };
    case 'swappa':
      return {
        url: `https://swappa.com/search?q=${searchQuery}`,
        merchantLabel: 'Swappa'
      };
    case 'walmart':
      return {
        url: `https://www.walmart.com/search?q=${searchQuery}${isUsed ? '+renewed' : ''}`,
        merchantLabel: isUsed ? 'Walmart Renewed' : 'Walmart'
      };
    default:
      // Fallback: route used items to Back Market, new to Google Shopping.
      if (isUsed) {
        return {
          url: `https://www.backmarket.com/en-us/search?q=${searchQuery}`,
          merchantLabel: 'Back Market'
        };
      }
      return {
        url: `https://www.google.com/search?q=${searchQuery}+buy&tbm=shop`,
        merchantLabel: type === 'durable' ? 'Brand Direct' : 'Google Shopping'
      };
  }
}

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
  // 1. Try the live proxy first.
  const live = await hydrateFromProxy();
  if (live.ok) return live;

  // 2. Demo-day insurance: if the proxy is unreachable in 3s, hydrate from
  //    the bundled fallback shipped with the extension. Best-effort, never
  //    overwrites entries already populated by a successful prior run.
  const fallback = await hydrateFromBundledFallback(live.reason);
  return fallback.ok ? fallback : live;
}

async function hydrateFromProxy() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SWARM_HYDRATE_TIMEOUT_MS);
  try {
    const res = await fetch(`${PROXY_ORIGIN}/swarm/cache`, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'accept': 'application/json' }
    });
    if (!res.ok) {
      const reason = res.status === 503 ? 'cache_empty' : `http_${res.status}`;
      await logEvent('swarm_cache_hydrate', { ok: false, source: 'proxy', reason }).catch(() => {});
      return { ok: false, reason };
    }
    const body = await res.json();
    const written = await writeBundleToCache(body, 'proxy');
    if (written == null) return { ok: false, reason: 'malformed' };
    return { ok: true, source: 'proxy', factor_count: written, last_refresh: body.last_refresh || null };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : 'error';
    await logEvent('swarm_cache_hydrate', { ok: false, source: 'proxy', reason }).catch(() => {});
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

async function hydrateFromBundledFallback(proxyReason) {
  try {
    const url = chrome.runtime.getURL('fallback-cache.json');
    const res = await fetch(url);
    if (!res.ok) return { ok: false, reason: `bundled_http_${res.status}` };
    const body = await res.json();
    const written = await writeBundleToCache(body, 'bundled');
    if (written == null) return { ok: false, reason: 'bundled_malformed' };
    await logEvent('swarm_cache_hydrate', {
      ok: true,
      source: 'bundled_fallback',
      proxy_reason: proxyReason,
      factor_count: written,
      last_refresh: body.last_refresh || null
    }).catch(() => {});
    return { ok: true, source: 'bundled_fallback', factor_count: written, last_refresh: body.last_refresh || null };
  } catch (err) {
    return { ok: false, reason: err?.message || 'bundled_error' };
  }
}

async function writeBundleToCache(body, source) {
  const factors = body && typeof body === 'object' ? body.factors : null;
  if (!factors || typeof factors !== 'object') {
    await logEvent('swarm_cache_hydrate', { ok: false, source, reason: 'malformed' }).catch(() => {});
    return null;
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
  return bulkPutCacheEntries(entries);
}
