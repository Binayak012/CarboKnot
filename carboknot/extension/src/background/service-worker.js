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

import { putSetting, logEvent, logView, findMatchingViews, markPurchased } from '../storage/db.js';

// TODO: swap to the real Render URL once the proxy is deployed.
// Keep this in sync with carboknot/extension/manifest.config.ts host_permissions.
export const PROXY_ORIGIN = 'http://localhost:8787';

const SWARM_STATUS_ALARM = 'swarm_status_refresh';
const SWARM_STATUS_PERIOD_MIN = 24 * 60;
const SWARM_FETCH_TIMEOUT_MS = 4000;

const KNOT_POLL_ALARM = 'knot_poll';
const KNOT_POLL_PERIOD_MIN = 15;
const KNOT_FETCH_TIMEOUT_MS = 6000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SWARM_STATUS_ALARM, {
    delayInMinutes: 0.1,
    periodInMinutes: SWARM_STATUS_PERIOD_MIN
  });
  chrome.alarms.create(KNOT_POLL_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: KNOT_POLL_PERIOD_MIN
  });
  refreshSwarmStatus().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SWARM_STATUS_ALARM) {
    refreshSwarmStatus().catch(() => {});
  }
  if (alarm.name === KNOT_POLL_ALARM) {
    pollKnotConfirmations().catch(() => {});
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
  if (msg?.type === 'log_view') {
    logView(msg.data).catch(() => {});
    return false;
  }
  if (msg?.type === 'knot_poll_now') {
    pollKnotConfirmations()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
});

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
 * Poll the proxy for Knot-confirmed purchases, match them against local view
 * history, mark matches as purchased, then acknowledge the proxy queue.
 * All matching is done locally — only merchant + amount reach the proxy.
 */
async function pollKnotConfirmations() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KNOT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${PROXY_ORIGIN}/knot/pending`, {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) return;
    const { items } = await res.json();
    if (!Array.isArray(items) || items.length === 0) return;

    const acknowledged = [];
    for (const tx of items) {
      const matches = await findMatchingViews({
        merchant: tx.merchant,
        amount_usd: tx.amount_usd,
        occurred_at: tx.occurred_at
      });
      if (matches.length > 0) {
        await markPurchased(matches[0].id, tx.id);
      }
      // Ack regardless — if no match, the view was likely never logged or
      // already confirmed. Don't re-process on the next poll.
      acknowledged.push(tx.id);
    }

    if (acknowledged.length > 0) {
      await fetch(`${PROXY_ORIGIN}/knot/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: acknowledged }),
        signal: controller.signal
      }).catch(() => {});
    }
  } catch (err) {
    await logEvent('knot_poll_error', {
      reason: err?.name === 'AbortError' ? 'timeout' : 'error'
    }).catch(() => {});
  } finally {
    clearTimeout(timer);
  }
}

self.pollKnotConfirmations = pollKnotConfirmations;
