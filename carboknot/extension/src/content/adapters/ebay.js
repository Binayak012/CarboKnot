// Carboknot — eBay PDP adapter.

import { parsePrice } from './generic.js';

const URL_RE = /ebay\.com\/itm\/\d+/;

export function matches(url) {
  return URL_RE.test(url);
}

export function extract(doc) {
  const titleEl = doc.querySelector('.x-item-title__mainTitle');
  const priceEl = doc.querySelector('.x-price-primary span');
  if (!titleEl || !priceEl) return null;

  const title = (titleEl.innerText || titleEl.textContent || '').trim();
  const price = parsePrice(priceEl.innerText || priceEl.textContent);
  if (!title || price == null) return null;

  return { title, price, method: 'site_custom' };
}
