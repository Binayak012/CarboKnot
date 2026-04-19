// Carboknot — Target PDP adapter.

import { parsePrice } from './generic.js';

const URL_RE = /target\.com\/p\//;

export function matches(url) {
  return URL_RE.test(url);
}

export function extract(doc) {
  const titleEl = doc.querySelector('h1');
  const priceEl = doc.querySelector('[data-test="product-price"]');
  if (!titleEl || !priceEl) return null;

  const title = (titleEl.innerText || titleEl.textContent || '').trim();
  const price = parsePrice(priceEl.innerText || priceEl.textContent);
  if (!title || price == null) return null;

  return { title, price, method: 'site_custom' };
}
