// Carboknot — Best Buy PDP adapter.

import { parsePrice } from './generic.js';

const URL_RE = /bestbuy\.com\/site\//;

export function matches(url) {
  return URL_RE.test(url);
}

export function extract(doc) {
  const titleEl = doc.querySelector('.sku-title h1');
  const priceEl = doc.querySelector('.priceView-customer-price span');
  if (!titleEl || !priceEl) return null;

  const title = (titleEl.innerText || titleEl.textContent || '').trim();
  const price = parsePrice(priceEl.innerText || priceEl.textContent);
  if (!title || price == null) return null;

  return { title, price, method: 'site_custom' };
}
