// Carboknot background service worker.
//
// Phase 1: scaffold only. This worker will gain two responsibilities in
// later phases:
//   - Phase 2/3: forward /api/categorize and /api/reason to the Daedalus
//                stateless proxy (never directly to any third-party API).
//   - Phase 4:   open the dashboard tab when requested from a content script.
//
// Zero-trust invariant: this worker may only reach the Daedalus proxy
// origin configured below. No other fetch destinations are permitted.

export const DAEDALUS_PROXY_ORIGIN =
  // Overridden in Phase 2 once the proxy is deployed.
  // Local dev default matches proxy/index.js.
  'http://localhost:8787';

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Carboknot] service worker installed.');
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'open_dashboard') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/index.html') });
    sendResponse({ ok: true });
    return false;
  }
  // /api/reason and /api/categorize handlers land in Phase 2.
  return false;
});
