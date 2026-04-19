// Carboknot — Nike PDP adapter.
//
// Nike's PDP renders structured data, but it arrives after a React
// hydration pass and their JSON-LD sometimes wraps the actual Product
// in a ProductGroup. The generic adapter now descends into hasVariant,
// but this site-specific adapter is cheaper and more robust in the
// common case because the title/price selectors are stable across
// Nike's main regions.
//
// Pure DOM reads only. No fetch, no storage, no side effects.

import { parsePrice } from './generic.js';

const URL_RE = /\/\/(www\.)?nike\.com\/.+/i;

export function matches(url) {
  return URL_RE.test(url);
}

// Nike uses several title containers depending on the page template
// (PDP, membership-gated launches, SNKRS). We try the most specific
// selector first and fall through.
const TITLE_SELECTORS = [
  'h1#pdp_product_title',
  'h1[data-testid="product_title"]',
  'h1[data-test="product-title"]',
  '#pdp_product_title',
  'h1.headline-2'
];

// Price element has migrated a few times; this list is ordered by
// specificity. We intentionally read the `.textContent` (not `innerText`)
// so the currency symbol comes along for parsePrice to strip.
const PRICE_SELECTORS = [
  '[data-testid="currentPrice-container"]',
  '[data-testid="product-price"]',
  '[data-test="product-price"]',
  '.product-price.is--current-price',
  '.product-price'
];

function readFirst(doc, selectors) {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) {
      const text = (el.textContent || '').trim();
      if (text) return text;
    }
  }
  return '';
}

export function extract(doc) {
  const title = readFirst(doc, TITLE_SELECTORS);
  const priceRaw = readFirst(doc, PRICE_SELECTORS);
  if (!title) return null;

  const price = parsePrice(priceRaw);
  if (price == null) return null;

  return { title, price, method: 'site_custom' };
}
