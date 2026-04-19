// Carboknot — content-script dispatcher.
//
// Single entry point for every product page we observe. Picks the first
// adapter whose `matches(url)` returns true, extracts {title, price}, runs
// the Climatiq-preferring engine wrapper, logs the view locally, and
// injects the badge. Clicking the badge opens the interpretability panel.
//
// Invariants:
//   - `generic` MUST stay last in the adapter array (it always matches).
//   - Any thrown error is swallowed so a page render can never be broken.
//   - We dedupe on a <title|price> key so Amazon's variant swaps don't
//     re-log the same product.
//
// Adapters run once on `document_idle` (from the manifest). If the first
// pass fails we keep watching briefly for late-rendered DOM (Amazon
// variant pickers, Shopify hydration, etc.) before giving up.

import * as amazon from './adapters/amazon.js';
import * as ebay from './adapters/ebay.js';
import * as walmart from './adapters/walmart.js';
import * as target from './adapters/target.js';
import * as bestbuy from './adapters/bestbuy.js';
import * as nike from './adapters/nike.js';
import * as generic from './adapters/generic.js';

import { detectCategory, computeCarbonWithClimatiq } from '../engine/carbon.js';
import { logView } from './bridge.js';
import { openPanel } from './panel.js';

// Site-specific adapters first; `generic` MUST stay last because its
// matches() is always true. Each adapter is tagged so the diagnostic
// logs name the adapter that actually ran.
const ADAPTERS = [
  { name: 'amazon', ...amazon },
  { name: 'ebay', ...ebay },
  { name: 'walmart', ...walmart },
  { name: 'target', ...target },
  { name: 'bestbuy', ...bestbuy },
  { name: 'nike', ...nike },
  { name: 'generic', ...generic }
];
const LATE_RENDER_BUDGET_MS = 20000;

// Maps hostname to the merchant slug we persist on each view row. Kept
// in lock-step with manifest.config.ts#content_scripts[0].matches — if
// a host is in the manifest, it gets an explicit slug here so the
// dashboard chip is consistent. Anything not matched falls through to
// the registrable-domain label (e.g. 'nike.co.uk' → 'nike').
const MERCHANT_HOST_PATTERNS = [
  { re: /(^|\.)adidas\./i, slug: 'adidas' },
  { re: /(^|\.)amazon\./i, slug: 'amazon' },
  { re: /(^|\.)apple\./i, slug: 'apple' },
  { re: /(^|\.)backmarket\./i, slug: 'backmarket' },
  { re: /(^|\.)bestbuy\./i, slug: 'bestbuy' },
  { re: /(^|\.)bhphotovideo\./i, slug: 'bhphotovideo' },
  { re: /(^|\.)costco\./i, slug: 'costco' },
  { re: /(^|\.)ebay\./i, slug: 'ebay' },
  { re: /(^|\.)etsy\./i, slug: 'etsy' },
  { re: /(^|\.)homedepot\./i, slug: 'homedepot' },
  { re: /(^|\.)kohls\./i, slug: 'kohls' },
  { re: /(^|\.)lowes\./i, slug: 'lowes' },
  { re: /(^|\.)macys\./i, slug: 'macys' },
  { re: /\.myshopify\.com$/i, slug: 'shopify' },
  { re: /(^|\.)nike\./i, slug: 'nike' },
  { re: /(^|\.)nordstrom\./i, slug: 'nordstrom' },
  { re: /(^|\.)rei\./i, slug: 'rei' },
  { re: /(^|\.)sephora\./i, slug: 'sephora' },
  { re: /(^|\.)target\./i, slug: 'target' },
  { re: /(^|\.)walmart\./i, slug: 'walmart' },
  { re: /(^|\.)wayfair\./i, slug: 'wayfair' }
];

function detectMerchant(url) {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch (_) {
    return 'other';
  }
  for (const p of MERCHANT_HOST_PATTERNS) {
    if (p.re.test(hostname)) return p.slug;
  }
  // Use the registrable domain's first label as a coarse fallback so
  // that a site we haven't explicitly catalogued still shows up with
  // a stable, readable chip in the dashboard (e.g. 'nike', 'apple').
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2].toLowerCase();
  return 'other';
}

function pickAdapter(url) {
  for (const a of ADAPTERS) {
    try {
      if (a.matches(url)) return a;
    } catch (_) {
      // A broken matcher must not block the rest.
    }
  }
  return null;
}

function tierOf(kg) {
  return kg < 5 ? 'low' : kg < 30 ? 'mid' : 'high';
}

function findAnchor() {
  return (
    document.getElementById('corePriceDisplay_desktop_feature_div') ||
    document.querySelector('.vim.x-price-section') ||
    null
  );
}

/**
 * Build and inject the Carboknot badge for a computed result.
 *
 * The badge is a three-line card (kg total, equivalent miles, confidence
 * interval width) that sits immediately above the merchant's price block
 * when we can find one. When we can't, we fall back to a fixed-position
 * overlay so the badge is always visible — `inline-size` is preserved so
 * the CSS card styling still applies.
 *
 * @param {import('../engine/carbon.js').CarbonResult} result
 * @param {(evt: Event) => void} onClick
 * @returns {HTMLDivElement}
 */
export function injectBadge(result, onClick) {
  document.querySelector('.carboknot-badge')?.remove();

  const badge = document.createElement('div');
  badge.className = 'carboknot-badge';
  badge.setAttribute('data-tier', tierOf(result.kg_total));
  badge.setAttribute('role', 'button');
  badge.setAttribute('tabindex', '0');
  badge.setAttribute('aria-label', 'Open carbon breakdown');

  const kgLine = document.createElement('div');
  kgLine.className = 'carboknot-kg';
  kgLine.textContent = `${result.kg_total.toFixed(1)} kg CO₂e`;

  const milesLine = document.createElement('div');
  milesLine.className = 'carboknot-miles';
  milesLine.textContent = `≈ ${result.equivalent_miles} miles driven`;

  const ciLine = document.createElement('div');
  ciLine.className = 'carboknot-ci';
  ciLine.textContent = `±${result.confidence.width_pct.toFixed(0)}% confidence`;

  badge.append(kgLine, milesLine, ciLine);

  badge.addEventListener('click', onClick);
  badge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(e);
    }
  });

  const anchor = findAnchor();
  if (anchor) {
    anchor.prepend(badge);
  } else {
    // Fixed-position fallback so the badge is never buried.
    Object.assign(badge.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '2147483647'
    });
    document.body.prepend(badge);
  }
  return badge;
}

let lastKey = '';
let injectionLogged = false;

async function run() {
  const url = window.location.href;

  // One-shot "we are here" log so the user can confirm the content
  // script actually injected. If you don't see this line in the page
  // console, the manifest didn't match or the extension didn't reload.
  if (!injectionLogged) {
    injectionLogged = true;
    try {
      console.info('[Carboknot] content script active on', window.location.hostname);
    } catch (_) {
      // console guarded only because overzealous sites sometimes stub it.
    }
  }

  const adapter = pickAdapter(url);
  if (!adapter) {
    console.info('[Carboknot] no adapter matched', url);
    return false;
  }

  let extracted = null;
  try {
    extracted = adapter.extract(document);
  } catch (err) {
    console.warn('[Carboknot] EXTRACT ERROR', adapter.name, err);
    return false;
  }
  if (!extracted || !extracted.title || !Number.isFinite(extracted.price)) {
    // Not an error — lots of non-product pages (home, category) match
    // our host patterns but legitimately have no product data. We log
    // at info level so you can see the adapter tried and declined.
    console.info('[Carboknot] no product data yet', {
      adapter: adapter.name,
      method: extracted?.method,
      hasTitle: !!extracted?.title,
      hasPrice: Number.isFinite(extracted?.price)
    });
    return false;
  }

  const key = `${extracted.title}|${extracted.price}`;
  if (key === lastKey) return true;
  lastKey = key;

  console.info('[Carboknot] extracted', {
    adapter: adapter.name,
    method: extracted.method,
    title: extracted.title,
    price: extracted.price
  });

  const category = detectCategory(extracted.title);

  let result;
  try {
    result = await computeCarbonWithClimatiq(extracted.title, extracted.price, category);
  } catch (err) {
    console.warn('CARBOKNOT ENGINE ERROR:', err);
    return false;
  }

  try {
    await logView({
      url,
      title: extracted.title,
      price: extracted.price,
      category,
      merchant: detectMerchant(url),
      kg_total: result.kg_total,
      trace: result.trace
    });
  } catch (_) {
    // Storage failures must never break the page.
  }

  injectBadge(result, () => openPanel(result));
  return true;
}

// First pass immediately (we're already at document_idle from the manifest),
// then watch briefly for late-arriving DOM on SPA-ish merchants.
(async () => {
  const done = await run();
  if (done) return;

  const mo = new MutationObserver(() => { run().catch(() => {}); });
  mo.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), LATE_RENDER_BUDGET_MS);
})();
