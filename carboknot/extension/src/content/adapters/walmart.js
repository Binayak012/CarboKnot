// Carboknot — Walmart PDP adapter.

import { parsePrice } from './generic.js';

const URL_RE = /walmart\.com\/ip\//;

export function matches(url) {
  return URL_RE.test(url);
}

export function extract(doc) {
  const titleEl =
    doc.querySelector('h1[itemprop="name"]') ||
    doc.querySelector('h1.lh-copy');
  const priceEl = doc.querySelector('[itemprop="price"]');
  if (!titleEl || !priceEl) return null;

  const title = (titleEl.innerText || titleEl.textContent || '').trim();
  const rawPrice =
    priceEl.getAttribute('content') ||
    priceEl.innerText ||
    priceEl.textContent;
  const price = parsePrice(rawPrice);
  if (!title || price == null) return null;

  return { title, price, method: 'site_custom' };
}
