// Extension smoke tests: alternatives.js + categorizer.js
// Run with: node src/extension.test.mjs

import { strict as assert } from 'node:assert';
import { getAlternatives } from './engine/alternatives.js';
import { categorize } from './inference/categorizer.js';
import { listCategories } from './engine/carbon.js';

const results = [];

function check(label, fn) {
  results.push({ label, fn });
}

// --- alternatives.js ---

check('known category returns 3 alternatives', () => {
  const alts = getAlternatives('audio_electronics', 42);
  assert.equal(alts.length, 3);
});

check('all alternatives have required fields', () => {
  for (const a of getAlternatives('laptops', 100)) {
    assert.ok(typeof a.name === 'string' && a.name.length > 0, 'name');
    assert.ok(typeof a.merchant === 'string' && a.merchant.length > 0, 'merchant');
    assert.ok(typeof a.price_usd === 'number', 'price_usd');
    assert.ok(typeof a.carbon_kg === 'number' && a.carbon_kg >= 0, 'carbon_kg');
    assert.ok(typeof a.carbon_saved_kg === 'number', 'carbon_saved_kg');
    assert.ok(typeof a.url === 'string' && a.url.startsWith('https://'), 'url');
    assert.ok(typeof a.rationale === 'string' && a.rationale.length > 0, 'rationale');
  }
});

check('carbon_saved_kg equals originalKg minus carbon_kg', () => {
  for (const alt of getAlternatives('footwear', 50)) {
    assert.ok(Math.abs(alt.carbon_saved_kg - (50 - alt.carbon_kg)) < 1e-9, alt.name);
  }
});

check('REFURB alternatives use 0.4 factor', () => {
  const alts = getAlternatives('audio_electronics', 100);
  assert.ok(Math.abs(alts[0].carbon_kg - 40) < 1e-9);
  assert.ok(Math.abs(alts[1].carbon_kg - 40) < 1e-9);
});

check('DURABLE alternatives use 0.6 factor', () => {
  const alts = getAlternatives('audio_electronics', 100);
  assert.ok(Math.abs(alts[2].carbon_kg - 60) < 1e-9);
});

check('unknown category falls back to 3 generic alternatives', () => {
  const alts = getAlternatives('does_not_exist', 20);
  assert.equal(alts.length, 3);
});

check('zero/invalid originalKg yields zero carbon_kg', () => {
  for (const bad of [0, -1, NaN, undefined]) {
    for (const a of getAlternatives('laptops', bad)) {
      assert.equal(a.carbon_kg, 0, `expected 0 for originalKg=${bad}`);
    }
  }
});

check('every known category produces alternatives without throwing', () => {
  for (const cat of listCategories()) {
    assert.ok(getAlternatives(cat, 100).length >= 1, `no alts for ${cat}`);
  }
});

// --- categorizer.js ---

check('categorize returns object with category and source', async () => {
  const r = await categorize('Sony WH-1000XM5');
  assert.ok(typeof r.category === 'string' && r.category.length > 0);
  assert.ok(['regex', 'webllm', 'proxy', 'fallback'].includes(r.source));
});

check('categorize phase-1 stub always returns general/fallback', async () => {
  for (const title of ['laptop', 'jeans', 'running shoes', '']) {
    const r = await categorize(title);
    assert.equal(r.category, 'general');
    assert.equal(r.source, 'fallback');
  }
});

// Run all checks (sync and async)
let passed = 0;
for (const { label, fn } of results) {
  try {
    await fn();
    passed++;
  } catch (e) {
    console.error(`  ✗ ${label}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log(`\n✓ extension tests: ${passed}/${results.length} checks passed`);
