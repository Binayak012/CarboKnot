// Minimal smoke test for engine/carbon.js. Run with: pnpm test:engine
// No test framework — just assertions against the contract that computeCarbon
// ALWAYS returns the full trace shape.

import { strict as assert } from 'node:assert';
import { computeCarbon, listCategories, METHODOLOGY_VERSION, LCA_DATA } from './carbon.js';

function approx(a, b, tol = 1e-6) {
  return Math.abs(a - b) <= tol;
}

// 1. Happy path on a known category.
const r1 = computeCarbon('Sony WH-1000XM5 Wireless Headphones', 349.99, 'audio_electronics');
assert.ok(r1.kg_total > 0, 'kg_total must be positive');
assert.equal(r1.category, 'audio_electronics');
assert.equal(r1.category_uncertain, false);
assert.ok(approx(r1.kg_total, 349.99 * 0.12, 1e-6), 'kg_total should match price × kg_per_usd');
assert.ok(r1.stages.manufacturing > 0);
assert.ok(r1.confidence.low < r1.kg_total && r1.kg_total < r1.confidence.high);
assert.equal(r1.confidence.width_pct, 20);
assert.equal(r1.trace.methodology_version, METHODOLOGY_VERSION);
assert.equal(r1.trace.inputs.price, 349.99);
assert.ok(Array.isArray(r1.trace.computation) && r1.trace.computation.length >= 6);
assert.ok(Array.isArray(r1.trace.assumptions) && r1.trace.assumptions.length >= 1);
assert.ok(r1.equivalent_miles > 0);

// 2. Unknown category must fall back to `general` and set category_uncertain.
const r2 = computeCarbon('Mystery Widget', 50, 'this_category_does_not_exist');
assert.equal(r2.category, 'general');
assert.equal(r2.category_uncertain, true);
assert.equal(r2.confidence.width_pct, LCA_DATA.general.confidence_multiplier * 100);
assert.equal(r2.trace.category_uncertain, true);

// 3. Missing category (undefined) must also fall back to `general`.
const r3 = computeCarbon('No-category product', 25);
assert.equal(r3.category, 'general');
assert.equal(r3.category_uncertain, true);

// 4. Invalid price must throw.
assert.throws(() => computeCarbon('x', 0, 'laptops'));
assert.throws(() => computeCarbon('x', -5, 'laptops'));
assert.throws(() => computeCarbon('x', NaN, 'laptops'));
assert.throws(() => computeCarbon('x', 'free', 'laptops'));

// 5. Stage breakdown must sum to the total (within tiny float tolerance).
const sum = r1.stages.manufacturing + r1.stages.shipping + r1.stages.packaging + r1.stages.end_of_life;
assert.ok(approx(sum, r1.kg_total, 1e-9), 'stage sum must equal kg_total');

// 6. Every seed category produces a clean result at $100 with a non-empty trace.
for (const cat of listCategories()) {
  const r = computeCarbon('probe', 100, cat);
  assert.equal(r.category, cat);
  assert.ok(r.trace.lookup.source, `missing citation for ${cat}`);
  assert.ok(r.trace.computation.length >= 6, `thin trace for ${cat}`);
}

// 7. Trace is round-trippable through JSON (storage contract).
const asJson = JSON.parse(JSON.stringify(r1.trace));
assert.deepEqual(asJson.inputs, r1.trace.inputs);
assert.equal(asJson.methodology_version, METHODOLOGY_VERSION);

console.log('✓ carbon.js: all %d checks passed', 7);
console.log('  sample kg_total = %s kg for $349.99 audio_electronics', r1.kg_total.toFixed(2));
console.log('  sample CI       = %s – %s kg (±%s%%)',
  r1.confidence.low.toFixed(2),
  r1.confidence.high.toFixed(2),
  r1.confidence.width_pct.toFixed(0));
