// Carboknot — Amazon PDP adapter.
// Pure DOM extraction only.

import { parsePrice } from './generic.js';

const URL_RE = /amazon\.com\/.*\/dp\/[A-Z0-9]+/;

export function matches(url) {
  return URL_RE.test(url);
}

export function extract(doc) {
  const titleEl = doc.querySelector('#productTitle');
  const priceEl = doc.querySelector('.a-price .a-offscreen');
  if (!titleEl || !priceEl) return null;

  const title = (titleEl.innerText || titleEl.textContent || '').trim();
  const price = parsePrice(priceEl.innerText || priceEl.textContent);
  if (!title || price == null) return null;

  return { title, price, method: 'site_custom' };
}
