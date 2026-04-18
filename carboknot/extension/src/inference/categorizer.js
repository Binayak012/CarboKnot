// Carboknot — 3-tier categorization cascade (Phase 3).
//
//   Tier 1  regex         instant, in-thread
//   Tier 2  WebLLM (Phi-3) on-device, 3s budget
//   Tier 3  Daedalus proxy title-only, user-visible network call
//
// Phase 1 stub that always returns 'general' so the engine exercises its
// uncertainty-widening behaviour. Tier wiring lands in Phase 3.

import { listCategories } from '../engine/carbon.js';

/**
 * @param {string} _title
 * @returns {Promise<{ category: string, source: 'regex'|'webllm'|'proxy'|'fallback' }>}
 */
export async function categorize(_title) {
  // Phase 1: everything falls through to `general` so the confidence
  // interval widens by design and the "category uncertain" tag fires.
  const _known = listCategories();
  return { category: 'general', source: 'fallback' };
}
