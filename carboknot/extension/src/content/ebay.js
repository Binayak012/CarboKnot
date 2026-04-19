// Carboknot — eBay product-page adapter.
// Identical flow to amazon.js with only the DOM selectors and URL pattern changed.

import { computeCarbonWithClimatiq } from '../engine/carbon.js';
import { openPanel } from './panel.js';

const PRODUCT_URL_RE = /\/itm\/\d+/;
const MERCHANT = 'ebay';

// Patterns anchor on word-start only (no trailing \b) so regular
// pluralisation ("Headphones", "Sneakers", "Boots") still matches.
const CATEGORY_PATTERNS = [
  { re: /\b(headphone|earbud|earphone|speaker|soundbar|airpods)/i,   category: 'audio_electronics' },
  { re: /\b(jean|pant|trouser|chino|slack|legging)/i,                category: 'apparel_bottoms'   },
  { re: /\b(macbook|laptop|notebook\s*pc|chromebook|thinkpad)/i,     category: 'laptops'           },
  { re: /\b(shoe|sneaker|boot|loafer|trainer)/i,                     category: 'footwear'          },
  { re: /\b(detergent|soap|cleaner|laundry|dish\s*pod|dishwasher)/i, category: 'home_goods'        }
];

function detectCategory(title) {
  const t = String(title || '');
  for (const p of CATEGORY_PATTERNS) {
    if (p.re.test(t)) return p.category;
  }
  return 'general';
}

function extractTitle() {
  const el = document.querySelector('.x-item-title__mainTitle');
  return el ? el.innerText.trim() : '';
}

function extractPrice() {
  const el = document.querySelector('.x-price-primary span');
  if (!el) return NaN;
  const raw = el.innerText || el.textContent || '';
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

function tierOf(kg) {
  return kg < 5 ? 'low' : kg < 30 ? 'mid' : 'high';
}

function findAnchor() {
  return (
    document.querySelector('.vim.x-price-section') ||
    document.querySelector('#apex_desktop') ||
    document.body
  );
}

function renderBadge(result, anchor) {
  const existing = document.querySelector('.carboknot-badge');
  if (existing) existing.remove();

  const badge = document.createElement('div');
  badge.className = 'carboknot-badge';
  badge.setAttribute('data-tier', tierOf(result.kg_total));
  badge.setAttribute('role', 'button');
  badge.setAttribute('tabindex', '0');
  badge.setAttribute('aria-label', 'Open carbon breakdown');

  const kgLine    = document.createElement('div');
  kgLine.className = 'carboknot-kg';
  kgLine.textContent = `${result.kg_total.toFixed(1)} kg CO₂e`;

  const milesLine = document.createElement('div');
  milesLine.className = 'carboknot-miles';
  milesLine.textContent = `≈ ${result.equivalent_miles} miles driven`;

  const ciLine    = document.createElement('div');
  ciLine.className = 'carboknot-ci';
  ciLine.textContent = `±${result.confidence.width_pct.toFixed(0)}% confidence`;

  badge.append(kgLine, milesLine, ciLine);

  const onOpen = () => openPanel(result);
  badge.addEventListener('click', onOpen);
  badge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  });

  anchor.prepend(badge);
}

let lastKey = '';

async function run() {
  if (!PRODUCT_URL_RE.test(location.pathname)) return;

  const title = extractTitle();
  const price = extractPrice();
  if (!title || !Number.isFinite(price)) return;

  const key = `${title}|${price}`;
  if (key === lastKey) return;
  lastKey = key;

  const category = detectCategory(title);
  const result = await computeCarbonWithClimatiq(title, price, category);

  renderBadge(result, findAnchor());

  chrome.runtime.sendMessage({
    type: 'log_view',
    payload: {
      url: location.href,
      title,
      price,
      category: result.category,
      category_uncertain: result.category_uncertain,
      merchant: MERCHANT,
      kg_total: result.kg_total,
      trace: result.trace
    }
  }).catch(() => {});
}

run();

const mo = new MutationObserver(() => run());
mo.observe(document.body, { childList: true, subtree: true });
setTimeout(() => mo.disconnect(), 20000);
