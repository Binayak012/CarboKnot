// Carboknot carbon engine.
//
// Deterministic, local, and interpretable by contract. Every call to
// computeCarbon MUST return a `trace` object with inputs, lookup source,
// computation steps, confidence interval, and methodology version.
// This is the structural guarantee behind the d_model claim: the engine
// cannot produce a number without also producing the steps that made it.

import LCA_DATA from './lca.json' with { type: 'json' };

export const METHODOLOGY_VERSION = 'carboknot-v1';
export { LCA_DATA };

/**
 * @typedef {Object} CarbonResult
 * @property {number} kg_total         Total kg CO2e point estimate.
 * @property {Object} stages           { manufacturing, shipping, packaging, end_of_life } in kg.
 * @property {Object} confidence       { low, high, width_pct, reason }.
 * @property {number} equivalent_miles Equivalent miles driven (1 kg CO2e ≈ 2.5 miles).
 * @property {Object} trace            Full interpretability payload (see below).
 * @property {string} category         Resolved category key from lca.json.
 * @property {boolean} category_uncertain  True when the caller fell through to `general`.
 */

/**
 * Compute the carbon footprint of a product.
 *
 * @param {string} title         Product title (for the trace; not used in math).
 * @param {number} price         Price in USD. Must be > 0.
 * @param {string} [category]    Category key from lca.json. Falls back to `general`.
 * @returns {CarbonResult}
 */
export function computeCarbon(title, price, category) {
  if (!(typeof price === 'number' && isFinite(price) && price > 0)) {
    throw new Error(`computeCarbon: price must be a positive number, got ${price}`);
  }

  const knownCategory = Object.prototype.hasOwnProperty.call(LCA_DATA, category);
  const resolvedCategory = knownCategory ? category : 'general';
  const categoryUncertain = !knownCategory || resolvedCategory === 'general';

  const lca = LCA_DATA[resolvedCategory];
  const base_kg = price * lca.kg_per_usd;

  const stages = {
    manufacturing: base_kg * lca.breakdown.manufacturing,
    shipping:      base_kg * lca.breakdown.shipping,
    packaging:     base_kg * lca.breakdown.packaging,
    end_of_life:   base_kg * lca.breakdown.end_of_life
  };

  const kg_total = stages.manufacturing + stages.shipping + stages.packaging + stages.end_of_life;

  const confidence = {
    low:       kg_total * (1 - lca.confidence_multiplier),
    high:      kg_total * (1 + lca.confidence_multiplier),
    width_pct: lca.confidence_multiplier * 100,
    reason:    lca.uncertainty_source
  };

  // 1 kg CO2e ≈ 2.5 miles driven (US passenger vehicle average).
  const equivalent_miles = Math.round(kg_total * 2.5);

  const trace = {
    inputs: { title: String(title || ''), price, category: resolvedCategory },
    lookup: {
      source: lca.citation,
      kg_per_usd: lca.kg_per_usd,
      breakdown_weights: { ...lca.breakdown }
    },
    computation: [
      `base = $${price} × ${lca.kg_per_usd} kg/USD = ${base_kg.toFixed(2)} kg`,
      `manufacturing = ${base_kg.toFixed(2)} × ${lca.breakdown.manufacturing} = ${stages.manufacturing.toFixed(2)} kg`,
      `shipping      = ${base_kg.toFixed(2)} × ${lca.breakdown.shipping} = ${stages.shipping.toFixed(2)} kg`,
      `packaging     = ${base_kg.toFixed(2)} × ${lca.breakdown.packaging} = ${stages.packaging.toFixed(2)} kg`,
      `end_of_life   = ${base_kg.toFixed(2)} × ${lca.breakdown.end_of_life} = ${stages.end_of_life.toFixed(2)} kg`,
      `total = ${kg_total.toFixed(2)} kg CO2e`
    ],
    confidence: {
      low: confidence.low,
      high: confidence.high,
      width_pct: confidence.width_pct,
      reason: confidence.reason
    },
    // Flat alias required by the interpretability spec (docs/interpretability.md).
    // Keeps the nested `confidence.reason` above for backward-compat with the
    // Phase-0 engine test and any consumer still reading the nested shape.
    confidence_reason: confidence.reason,
    assumptions: [...lca.assumptions],
    methodology_version: METHODOLOGY_VERSION,
    category_uncertain: categoryUncertain
  };

  return {
    kg_total,
    stages,
    confidence,
    equivalent_miles,
    trace,
    category: resolvedCategory,
    category_uncertain: categoryUncertain
  };
}

/**
 * List of category keys available in the bundled dataset.
 * Used by the categorizer fallback and the dashboard legend.
 */
export function listCategories() {
  return Object.keys(LCA_DATA);
}
