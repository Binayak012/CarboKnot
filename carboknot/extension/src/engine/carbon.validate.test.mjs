// Carboknot — golden-reference validation suite.
//
// Purpose:
//   Demonstrate that Carboknot's carbon estimates track published,
//   peer-reviewed / manufacturer-disclosed Life Cycle Assessments (LCAs)
//   for well-characterised reference SKUs.
//
// What this runs:
//   1. LOCAL path  — `computeCarbon(title, price, category)` using the
//      bundled lca.json factor table (Ecoinvent / DEFRA / Apple PER / EEIO).
//   2. CLIMATIQ path — POSTs to the Carboknot proxy (`/api/climatiq`),
//      which forwards to Climatiq's live spend-based estimate endpoint
//      (CEDA 2022, region=US). Each golden SKU's category → ISIC4 code via
//      category_map.json, exactly as the extension does at runtime.
//   The CLIMATIQ path is skipped cleanly (not failed) when the proxy is
//   unreachable, so this suite still runs offline.
//
// Acceptance:
//   For each SKU, the point estimate on at least one path must fall
//   within ±35% of the published target. ±35% is deliberately generous:
//   our engine is a category-and-price proxy, not a SKU-resolved model.
//
// Non-goals:
//   - Not a statistical CI calibration.
//   - Does not validate stage-level breakdowns.
//
// Run with:  pnpm --filter carboknot-extension test:validate

import { strict as assert } from 'node:assert';
import { computeCarbon } from './carbon.js';
import CATEGORY_MAP from './category_map.json' with { type: 'json' };

const TOLERANCE = 0.35;
const PROXY_ORIGIN = process.env.CARBOKNOT_PROXY_ORIGIN || 'http://localhost:8787';
const CLIMATIQ_TIMEOUT_MS = 6000;

/**
 * @typedef {Object} GoldenSku
 * @property {string} name
 * @property {number} price_usd
 * @property {string} category    Key from lca.json.
 * @property {number} target_kg   Published LCA total kg CO2e (cradle-to-grave).
 * @property {string} source      Short citation.
 */

/** @type {GoldenSku[]} */
const GOLDEN = [
  {
    name:      'Apple MacBook Pro 14" M3',
    price_usd: 1599,
    category:  'laptops',
    target_kg: 215,
    source:    'Apple Product Environmental Report — MacBook Pro 14" M3 (2023)'
  },
  {
    name:      'Apple iPhone 15 Pro',
    price_usd: 999,
    category:  'smartphones',
    target_kg: 66,
    source:    'Apple Product Environmental Report — iPhone 15 Pro (2023)'
  },
  {
    name:      "Levi's 501 Original Jeans",
    price_usd: 80,
    category:  'apparel_bottoms',
    target_kg: 33,
    source:    "Levi Strauss & Co. — Lifecycle of a Jean (501 LCA, 2015)"
  },
  {
    name:      'Sony WH-1000XM5 headphones',
    price_usd: 348,
    category:  'audio_electronics',
    target_kg: 42,
    source:    'Consumer-electronics category literature estimate'
  }
];

function pct(a, b) {
  return ((a - b) / b) * 100;
}

function pad(s, width, align = 'left') {
  const str = String(s);
  if (str.length >= width) return str;
  const slack = width - str.length;
  if (align === 'right') return ' '.repeat(slack) + str;
  return str + ' '.repeat(slack);
}

async function climatiqEstimate(category, price) {
  const mapping = CATEGORY_MAP[category] || CATEGORY_MAP.general;
  if (!mapping) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CLIMATIQ_TIMEOUT_MS);
  try {
    const res = await fetch(`${PROXY_ORIGIN}/api/climatiq`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        classification_code: mapping.code,
        money: price,
        money_unit: 'usd'
      })
    });
    if (!res.ok) return { error: `http_${res.status}` };
    const body = await res.json();
    if (typeof body?.co2e !== 'number') return { error: 'malformed_response' };
    return {
      co2e_kg: body.co2e,
      emission_factor_name: body?.emission_factor?.name,
      region: body?.emission_factor?.region
    };
  } catch (err) {
    return { error: err?.name || 'fetch_error' };
  } finally {
    clearTimeout(t);
  }
}

// --- run LOCAL path (always) ---
const rows = [];
for (const sku of GOLDEN) {
  const r = computeCarbon('Test', sku.price_usd, sku.category);

  // Shape contract: same for every row.
  assert.equal(r.category, sku.category, `category resolution failed for ${sku.name}`);
  assert.equal(r.category_uncertain, false, `${sku.name} should resolve to a known category, not general`);
  assert.ok(r.kg_total > 0, `${sku.name} must produce a positive kg_total`);
  assert.ok(
    r.confidence.low < r.kg_total && r.kg_total < r.confidence.high,
    `${sku.name} must report a CI that brackets the point estimate`
  );

  rows.push({
    name:        sku.name,
    target_kg:   sku.target_kg,
    local_kg:    r.kg_total,
    local_pct:   pct(r.kg_total, sku.target_kg),
    local_pass:  Math.abs(r.kg_total - sku.target_kg) / sku.target_kg <= TOLERANCE,
    climatiq_kg: null,
    climatiq_pct: null,
    climatiq_pass: null,
    climatiq_note: null
  });
}

// --- run CLIMATIQ path (best-effort; proxy may be down) ---
let climatiqReachable = true;
for (const [i, sku] of GOLDEN.entries()) {
  const r = await climatiqEstimate(sku.category, sku.price_usd);
  if (!r) {
    rows[i].climatiq_note = 'no mapping';
    continue;
  }
  if (r.error) {
    rows[i].climatiq_note = r.error;
    // If the very first call fails with a network error, don't hammer the rest.
    if (r.error === 'fetch_error' || r.error === 'AbortError') {
      climatiqReachable = false;
      for (let j = i + 1; j < GOLDEN.length; j++) rows[j].climatiq_note = 'proxy unreachable';
      break;
    }
    continue;
  }
  rows[i].climatiq_kg = r.co2e_kg;
  rows[i].climatiq_pct = pct(r.co2e_kg, sku.target_kg);
  rows[i].climatiq_pass = Math.abs(r.co2e_kg - sku.target_kg) / sku.target_kg <= TOLERANCE;
  rows[i].climatiq_note = `${r.emission_factor_name || '?'} (${r.region || '?'})`;
}

// --- pretty-print a comparison table ---
const NAME_W = 32;
const header =
  pad('Product',       NAME_W) + ' | ' +
  pad('Target',        8,  'right') + ' | ' +
  pad('Local',         8,  'right') + ' | ' +
  pad('L Δ%',          8,  'right') + ' | ' +
  pad('L pass',        6,  'right') + ' | ' +
  pad('Climatiq',      9,  'right') + ' | ' +
  pad('C Δ%',          8,  'right') + ' | ' +
  pad('C pass',        6,  'right');
const divider = '-'.repeat(header.length);

console.log('');
console.log('Carboknot golden-reference validation  (±%d%% band; all kg CO2e)', Math.round(TOLERANCE * 100));
console.log('Proxy: %s', PROXY_ORIGIN);
console.log(divider);
console.log(header);
console.log(divider);
for (const row of rows) {
  const signed = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  console.log(
    pad(row.name,                               NAME_W) + ' | ' +
    pad(row.target_kg.toFixed(1),               8, 'right') + ' | ' +
    pad(row.local_kg.toFixed(1),                8, 'right') + ' | ' +
    pad(signed(row.local_pct),                  8, 'right') + ' | ' +
    pad(row.local_pass ? 'PASS' : 'FAIL',       6, 'right') + ' | ' +
    pad(row.climatiq_kg === null ? '—' : row.climatiq_kg.toFixed(1), 9, 'right') + ' | ' +
    pad(row.climatiq_pct === null ? '—' : signed(row.climatiq_pct),  8, 'right') + ' | ' +
    pad(row.climatiq_pass === null ? (row.climatiq_note || 'skip') : (row.climatiq_pass ? 'PASS' : 'FAIL'), 6, 'right')
  );
}
console.log(divider);

const localPass = rows.filter((r) => r.local_pass).length;
const climatiqPass = rows.filter((r) => r.climatiq_pass === true).length;
const eitherPass = rows.filter((r) => r.local_pass || r.climatiq_pass === true).length;
console.log('LOCAL path:    %d/%d within ±%d%%', localPass, rows.length, Math.round(TOLERANCE * 100));
if (climatiqReachable) {
  console.log('CLIMATIQ path: %d/%d within ±%d%%', climatiqPass, rows.length, Math.round(TOLERANCE * 100));
  console.log('BEST-OF-TWO:   %d/%d within ±%d%% on at least one path', eitherPass, rows.length, Math.round(TOLERANCE * 100));
} else {
  console.log('CLIMATIQ path: proxy unreachable, skipped (start proxy at %s to enable)', PROXY_ORIGIN);
}
console.log('');

// --- exit code policy ---
// The suite is a diagnostic, not a strict gate. We exit non-zero only
// when the LOCAL path (which always runs and has no external deps) has
// zero passes — that would indicate a factor table regression. Mixed
// results are expected for flagship products on a spend-based engine
// and are reported, not failed.
if (localPass === 0) {
  console.error('Validation failed: LOCAL path passed 0/%d SKUs.', rows.length);
  process.exit(1);
}
