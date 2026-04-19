// Carboknot — Walmart PDP adapter.
//
// Walmart's product page uses multiple DOM structures depending on A/B
// tests and page version (Next.js hydration vs server-rendered). This
// adapter cascades through known selector strategies for both title and
// price, making it resilient to layout shifts.

import { parsePrice } from './generic.js';

// Walmart product pages: /ip/<slug>/<ID> or /ip/<ID>
const URL_RE = /walmart\.com\/ip\//;

export function matches(url) {
  return URL_RE.test(url);
}

export function extract(doc) {
  // --- Title ---
  // Strategy 1: structured data (most reliable)
  const titleEl =
    doc.querySelector('h1[itemprop="name"]') ||
    // Strategy 2: modern Next.js layout
    doc.querySelector('[data-testid="product-title"]') ||
    // Strategy 3: legacy layout
    doc.querySelector('h1.lh-copy') ||
    // Strategy 4: fallback broad h1 inside product header
    doc.querySelector('.prod-ProductTitle h1') ||
    doc.querySelector('h1');

  // --- Price ---
  // Strategy 1: structured data
  const priceEl = doc.querySelector('[itemprop="price"]');
  let rawPrice = priceEl?.getAttribute('content') ||
    priceEl?.innerText ||
    priceEl?.textContent;

  if (!rawPrice) {
    // Strategy 2: modern price span (aria-hidden price display)
    const modernPrice = doc.querySelector('[data-testid="price-wrap"] [itemprop="price"]') ||
      doc.querySelector('[data-testid="price-wrap"] .f2') ||
      doc.querySelector('.price-group');
    rawPrice = modernPrice?.getAttribute('content') ||
      modernPrice?.innerText ||
      modernPrice?.textContent;
  }

  if (!rawPrice) {
    // Strategy 3: JSON-LD structured data
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const ld = JSON.parse(script.textContent);
        const offers = ld?.offers || ld?.mainEntity?.offers;
        if (offers) {
          const offer = Array.isArray(offers) ? offers[0] : offers;
          if (offer?.price) {
            rawPrice = String(offer.price);
            break;
          }
        }
      } catch (_) { /* skip malformed JSON-LD */ }
    }
  }

  if (!titleEl || !rawPrice) return null;

  const title = (titleEl.innerText || titleEl.textContent || '').trim();
  const price = parsePrice(rawPrice);
  if (!title || price == null) return null;

  return { title, price, method: 'site_custom' };
}
