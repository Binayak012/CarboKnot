// Carboknot Daedalus proxy — Phase 1 placeholder.
//
// Phase 2 will implement:
//   POST /api/reason        → K2 Think V2
//   POST /api/categorize    → fast fallback LLM
//
// Invariants (enforced in Phase 2):
//   - No database, no request logging, no persistence of any kind.
//   - CORS locked to the Carboknot extension origin.
//   - API keys live only in .env on the Daedalus host; never in the bundle.
//   - Requests carry only product titles and kg numbers. Never URLs, cookies, or user IDs.

console.log('[Carboknot proxy] Phase 2 not yet implemented.');
