// Carboknot — generic fallback adapter.
//
// Order of attempts: schema.org JSON-LD -> OpenGraph meta -> microdata.
// The first sub-extractor that returns a well-formed {title, price} wins;
// everything else is ignored so we never second-guess an authoritative source.
//
// Pure DOM reads only. No fetch, no storage, no side effects.

const MAX_REASONABLE_PRICE = 100000;

// Strip currency symbols, thousand separators, and whitespace, then parseFloat.
// Returns a finite positive number in (0, MAX_REASONABLE_PRICE], or null.
export function parsePrice(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[^0-9.\-]/g, '');
  if (!s) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  if (n > MAX_REASONABLE_PRICE) return null;
  return n;
}

function normaliseTitle(raw) {
  if (raw == null) return '';
  return String(raw).replace(/\s+/g, ' ').trim();
}

function isProductType(type) {
  if (!type) return false;
  if (type === 'Product' || type === 'IndividualProduct') return true;
  if (Array.isArray(type)) return type.some(isProductType);
  return false;
}

function isProductGroupType(type) {
  if (!type) return false;
  if (type === 'ProductGroup' || type === 'ProductModel') return true;
  if (Array.isArray(type)) return type.some(isProductGroupType);
  return false;
}

// JSON-LD on real sites (Nike, Shopify, big-brand PDPs) is a mess:
// single objects, arrays, @graph wrappers, and ProductGroup nodes whose
// `hasVariant` array contains the actual priced Products. We DFS through
// all of those and return the first node we can plausibly extract
// {name, price} from. Anything not a Product/ProductGroup/array/@graph
// is ignored rather than recursed blindly — otherwise we'd chase into
// BreadcrumbList etc.
function pickProductNode(parsed) {
  if (!parsed) return null;
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const hit = pickProductNode(item);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof parsed !== 'object') return null;

  if (parsed['@graph']) {
    const hit = pickProductNode(parsed['@graph']);
    if (hit) return hit;
  }

  const type = parsed['@type'];
  if (isProductType(type)) return parsed;

  if (isProductGroupType(type)) {
    // Try the group itself first (it may have its own offers/price), then
    // descend into variants. Whichever resolves a price wins.
    if (extractPrice(parsed) != null) return parsed;
    const variants = parsed.hasVariant || parsed.variesBy || parsed.model;
    if (variants) {
      const hit = pickProductNode(variants);
      if (hit) return hit;
    }
  }

  return null;
}

function extractOfferPrice(offers) {
  if (!offers) return null;
  if (Array.isArray(offers)) {
    for (const o of offers) {
      const p = extractOfferPrice(o);
      if (p != null) return p;
    }
    return null;
  }
  if (typeof offers === 'object') {
    if (offers.price != null) {
      const p = parsePrice(offers.price);
      if (p != null) return p;
    }
    // AggregateOffer: prefer the low end so we don't over-count.
    if (offers.lowPrice != null) {
      const p = parsePrice(offers.lowPrice);
      if (p != null) return p;
    }
    if (offers.highPrice != null) {
      const p = parsePrice(offers.highPrice);
      if (p != null) return p;
    }
    if (offers.priceSpecification) {
      const p = extractOfferPrice(offers.priceSpecification);
      if (p != null) return p;
    }
  }
  return parsePrice(offers);
}

// Product-level price lookup. Some sites (Nike, Shopify themes) put
// `price` directly on the Product node rather than under `offers`, and
// some hide it on a nested priceSpecification. Always try `offers` first
// since that's the schema.org-canonical place.
function extractPrice(node) {
  if (!node || typeof node !== 'object') return null;
  const fromOffers = extractOfferPrice(node.offers);
  if (fromOffers != null) return fromOffers;
  if (node.price != null) {
    const p = parsePrice(node.price);
    if (p != null) return p;
  }
  if (node.priceSpecification) {
    const p = extractOfferPrice(node.priceSpecification);
    if (p != null) return p;
  }
  return null;
}

function schemaOrg(doc) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    let parsed;
    try {
      parsed = JSON.parse(s.textContent || '');
    } catch (_) {
      continue;
    }
    const product = pickProductNode(parsed);
    if (!product) continue;

    const title = normaliseTitle(product.name);
    const price = extractPrice(product);
    if (!title || price == null) continue;

    return { title, price, method: 'schema.org' };
  }
  return null;
}

function openGraph(doc) {
  const typeMeta = doc.querySelector('meta[property="og:type"]');
  if (!typeMeta) return null;
  if ((typeMeta.getAttribute('content') || '').toLowerCase() !== 'product') return null;

  const titleMeta = doc.querySelector('meta[property="og:title"]');
  const priceMeta = doc.querySelector('meta[property="product:price:amount"]');
  if (!titleMeta || !priceMeta) return null;

  const title = normaliseTitle(titleMeta.getAttribute('content'));
  const price = parsePrice(priceMeta.getAttribute('content'));
  if (!title || price == null) return null;

  return { title, price, method: 'opengraph' };
}

function microdata(doc) {
  const scope = doc.querySelector('[itemtype*="schema.org/Product"]');
  if (!scope) return null;

  const nameEl = scope.querySelector('[itemprop="name"]');
  const priceEl = scope.querySelector('[itemprop="price"]');
  if (!nameEl || !priceEl) return null;

  const title = normaliseTitle(nameEl.textContent);
  // Microdata prices are often in the `content` attribute; fall back to text.
  const rawPrice = priceEl.getAttribute('content') || priceEl.textContent;
  const price = parsePrice(rawPrice);
  if (!title || price == null) return null;

  return { title, price, method: 'microdata' };
}

export function matches(_url) {
  return true;
}

export function extract(doc) {
  return schemaOrg(doc) || openGraph(doc) || microdata(doc) || null;
}

export const __test__ = { parsePrice, normaliseTitle, pickProductNode, extractOfferPrice, extractPrice };
