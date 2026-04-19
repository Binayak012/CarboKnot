// Tiny runtime context helpers shared by the dashboard hooks.
//
// The dashboard is built once and shipped two ways:
//
//   1. As a Chrome extension page (`chrome-extension://<id>/...`). In this
//      mode it MUST always reflect the user's real Dexie data — never seed,
//      never mocks. An empty install just shows the empty state until the
//      service worker writes its first view.
//
//   2. As a standalone Vite preview (`http://localhost:4173/...`) used by
//      developers and reviewers. There is no service worker here, the
//      Dexie origin is fresh, and we want a rich set of demo rows so the
//      poster UI doesn't look hollow during design work.
//
// `isExtensionContext()` is the single switch that distinguishes the two.

export function isExtensionContext(): boolean {
  try {
    return (
      typeof chrome !== 'undefined' &&
      !!chrome.runtime &&
      typeof chrome.runtime.id === 'string' &&
      chrome.runtime.id.length > 0
    );
  } catch {
    return false;
  }
}
