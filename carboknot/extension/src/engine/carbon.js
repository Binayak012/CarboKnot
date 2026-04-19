// Carboknot carbon engine.
//
// Deterministic, local, and interpretable by contract. Every call to
// computeCarbon MUST return a `trace` object with inputs, lookup source,
// computation steps, confidence interval, and methodology version.
// This is the structural guarantee behind the d_model claim: the engine
// cannot produce a number without also producing the steps that made it.

import LCA_DATA from './lca.json' with { type: 'json' };
import { getEstimate } from './climatiq.js';

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

// Regex-based tier-1 categorizer. Patterns anchor on word-start only (no
// trailing \b) so plural forms still match ("Headphones", "Sneakers").
// Keys MUST exist in both lca.json and engine/category_map.json.
const CATEGORY_PATTERNS = [
  { re: /\b(headphone|earbud|earphone|airpods|soundbar|speaker)/i,                category: 'audio_electronics' },
  { re: /\b(macbook|laptop|notebook\s*pc|chromebook|thinkpad|ultrabook)/i,        category: 'laptops'           },
  { re: /\b(iphone|galaxy|pixel|smartphone|cell\s*phone)/i,                       category: 'smartphones'       },
  { re: /\b(t-?shirt|tee\b|hoodie|sweater|sweatshirt|blouse|jacket|coat|cardigan)/i, category: 'apparel_tops'   },
  { re: /\b(jean|pant|trouser|chino|slack|legging|short|skirt)/i,                 category: 'apparel_bottoms'   },
  { re: /\b(shoe|sneaker|boot|loafer|trainer|sandal|heel)/i,                      category: 'footwear'          },
  { re: /\b(detergent|soap|cleaner|laundry|dish\s*pod|dishwasher|paper\s*towel)/i, category: 'home_goods'       },
  { re: /\b(shampoo|conditioner|lotion|moisturizer|lipstick|mascara|perfume|cologne)/i, category: 'beauty'      },
  { re: /\b(book|novel|paperback|hardcover|textbook)/i,                           category: 'books'             },
  { re: /\b(snack|cereal|pasta|coffee|tea\b|granola|sauce|oats)/i,                category: 'food_packaged'     },
  { re: /\b(toy|lego|puzzle|doll|action\s*figure|board\s*game)/i,                 category: 'toys'              }
];

/**
 * Deterministic tier-1 category detection from a product title.
 * Returns a key present in lca.json, defaulting to `'general'` when no
 * pattern matches. Cheap and synchronous — no model calls.
 * @param {string} title
 * @returns {string}
 */
export function detectCategory(title) {
  const t = String(title || '');
  for (const p of CATEGORY_PATTERNS) {
    if (p.re.test(t)) return p.category;
  }
  return 'general';
}

/**
 * Variant of {@link computeCarbon} that prefers a Climatiq-backed point
 * estimate when one is available, and widens the local confidence interval
 * when it is not. The shape of the returned object matches `computeCarbon`
 * exactly (same keys, same types) so downstream consumers don't need to
 * branch on the data source — they can read `trace.data_source` to learn
 * which path produced the number.
 *
 * Contract:
 *   - Never throws; falls back to the local engine on any remote failure.
 *   - `stages` always sum to `kg_total` (within float tolerance).
 *   - `confidence.low <= kg_total <= confidence.high`.
 *
 * @param {string} title
 * @param {number} price
 * @param {string} [category]
 * @returns {Promise<import('./carbon.js').CarbonResult & { trace: { data_source: 'climatiq_fresh' | 'climatiq_cached' | 'local_fallback' } }>}
 */
export async function computeCarbonWithClimatiq(title, price, category) {
  const local = computeCarbon(title, price, category);
  const remote = await getEstimate(local.category, price);

  if (remote && Number.isFinite(remote.co2e_kg) && remote.co2e_kg > 0 && local.kg_total > 0) {
    const scalingFactor = remote.co2e_kg / local.kg_total;
    const stages = {
      manufacturing: local.stages.manufacturing * scalingFactor,
      shipping:      local.stages.shipping      * scalingFactor,
      packaging:     local.stages.packaging     * scalingFactor,
      end_of_life:   local.stages.end_of_life   * scalingFactor
    };
    const kg_total = remote.co2e_kg;
    const confidence = {
      low:       remote.co2e_kg * 0.85,
      high:      remote.co2e_kg * 1.15,
      width_pct: 15,
      reason:    local.confidence.reason
    };
    const trace = {
      ...local.trace,
      confidence: {
        low: confidence.low,
        high: confidence.high,
        width_pct: confidence.width_pct,
        reason: confidence.reason
      },
      data_source: remote.source === 'cache' ? 'climatiq_cached' : 'climatiq_fresh',
      climatiq: {
        emission_factor_id: remote.emission_factor_id,
        emission_factor_name: remote.emission_factor_name,
        cached_at: remote.cached_at,
        scaling_factor: scalingFactor
      }
    };
    return {
      kg_total,
      stages,
      confidence,
      equivalent_miles: Math.round(kg_total * 2.5),
      trace,
      category: local.category,
      category_uncertain: local.category_uncertain
    };
  }

  // Fallback: local engine + widened CI.
  const confidence = {
    low:       local.confidence.low  * 0.75,
    high:      local.confidence.high * 1.25,
    width_pct: Math.round(local.confidence.width_pct * 1.5),
    reason:    local.confidence.reason
  };
  const trace = {
    ...local.trace,
    confidence: {
      low: confidence.low,
      high: confidence.high,
      width_pct: confidence.width_pct,
      reason: confidence.reason
    },
    data_source: 'local_fallback'
  };
  return {
    ...local,
    confidence,
    trace
  };
}
