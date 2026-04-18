// Carboknot — WebLLM (Phi-3 Mini) loader (Phase 3).
// This is Tier 2 of the categorization cascade. Loaded lazily; guarded by
// a 3-second wall-clock budget in categorizer.js. If the model fails to
// load or answer within budget, we fall through to the Daedalus proxy.
//
// Phase 1 stub.

/**
 * @returns {Promise<null | ((title: string) => Promise<string>)>}
 *   A categorizer function, or null if WebLLM cannot be initialised here.
 */
export async function loadWebLLM() {
  return null;
}
