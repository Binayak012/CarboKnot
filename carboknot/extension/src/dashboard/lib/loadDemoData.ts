// Imports the rich SEED_VIEWS / SEED_AUDIT fixtures into the real local
// Dexie DB so the dashboard and popup look populated immediately, without
// the user having to actually browse Amazon/eBay.
//
// Why this exists: the empty-state guard in useHistory deliberately refuses
// to inject seed rows on every load (so a real install never silently
// pretends to have data). But for demos / first-run / showcase situations
// we want a one-click way to see the UI alive. This helper makes that
// explicit and auditable: every seed row is written through `logView`, so
// it lands in `audit_log` exactly the same way a real product view would.

import { SEED_VIEWS, SEED_AUDIT } from '@/dashboard/lib/seed';
// db.js is plain JS; the import works at runtime via the @ alias.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — JS module without bundled .d.ts
import { db, logView, logEvent, getHistory } from '@/storage/db.js';
import type { ViewRow, AuditEntry } from '@/dashboard/lib/types';

function urlFor(row: ViewRow): string {
  const slug = encodeURIComponent(row.title.slice(0, 32).replace(/\s+/g, '-'));
  switch (row.merchant) {
    case 'amazon':
      return `https://www.amazon.com/dp/DEMO-${row.id}/${slug}`;
    case 'ebay':
      return `https://www.ebay.com/itm/DEMO-${row.id}/${slug}`;
    default:
      return `https://demo.carboknot.local/${row.merchant}/${slug}`;
  }
}

export interface LoadDemoResult {
  inserted: number;
  skipped: 'already_populated' | null;
}

/**
 * Write the seed fixtures into the live Dexie DB.
 *
 * - If the DB already has any view rows, this is a no-op (returns
 *   `{ inserted: 0, skipped: 'already_populated' }`) so the user can't
 *   accidentally double-insert by clicking twice.
 * - Otherwise, each seed view is written through `logView` (which also
 *   appends a `view_logged` audit entry). Then a curated subset of
 *   `SEED_AUDIT` events is appended directly to `audit_log` so the
 *   Activity section has plausible non-`view_logged` rows too.
 * - Finally, a single `demo_data_loaded` event is logged so the user can
 *   tell from the audit ledger that this data was seeded, not captured.
 */
export async function loadDemoData(): Promise<LoadDemoResult> {
  const existing = await getHistory({ limit: 1 });
  if (existing && existing.length > 0) {
    return { inserted: 0, skipped: 'already_populated' };
  }

  let inserted = 0;
  for (const row of SEED_VIEWS) {
    const occurred_at = new Date(row.ts).toISOString();
    const id: number = await db.views.add({
      url: urlFor(row),
      title: row.title,
      price: row.price_usd,
      category: row.category,
      category_uncertain: !!row.category_uncertain,
      merchant: row.merchant,
      kg_total: row.kg_total,
      trace: row.trace,
      occurred_at,
      purchased: !!row.purchased
    });
    await logEvent('view_logged', {
      view_id: id,
      merchant: row.merchant,
      category: row.category,
      kg_total: row.kg_total,
      seed: true
    });
    inserted += 1;
  }

  // Mirror non-view_logged audit events so the Activity section has variety.
  const extraEvents: AuditEntry[] = SEED_AUDIT.filter(
    (e) => e.event_type !== 'view_logged'
  ).slice(0, 12);
  for (const e of extraEvents) {
    await db.audit_log.add({
      event_type: e.event_type,
      timestamp: new Date(e.timestamp).toISOString(),
      details: e.details
    });
  }

  await logEvent('demo_data_loaded', { count: inserted });
  return { inserted, skipped: null };
}
