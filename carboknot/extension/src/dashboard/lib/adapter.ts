// Bridges the live Dexie ViewRow shape (defined in src/storage/db.js) into the
// shape the dashboard expects (defined here in lib/types.ts). The Dexie row
// stores the carbon trace as a JSON string with `confidence.low/high/width_pct`
// nested inside, plus a top-level `occurred_at` ISO timestamp. The dashboard
// wants a flat ViewRow with `ts`, `kg_ci_low`, `kg_ci_high`, `price_usd`, and
// `data_source` available at the top level.

import type { ViewRow, Trace, ClimatiqCacheStats } from './types';

type DexieViewRow = {
  id?: number;
  url?: string;
  title: string;
  price?: number;
  category: string;
  category_uncertain?: boolean;
  merchant: string;
  kg_total: number;
  trace: string;
  occurred_at: string;
  purchased?: boolean;
};

const DEFAULT_CONFIDENCE_WIDTH = 0.2;

// `merchant` is now a free-form slug produced by the content-script
// dispatcher (amazon, ebay, walmart, target, bestbuy, etsy, shopify, or
// any registrable-domain label like `nike`/`apple` for sites we haven't
// explicitly catalogued). We only normalize casing and whitespace so
// everything downstream groups/filters consistently; unknown slugs
// flow through unchanged rather than being coerced to 'amazon'.
function normalizeMerchant(m: string | undefined): string {
  const s = (m ?? '').trim().toLowerCase();
  return s || 'other';
}

function normalizeSource(
  s: string | undefined
): ViewRow['data_source'] {
  if (s === 'climatiq_fresh' || s === 'climatiq_cached' || s === 'local_fallback') {
    return s;
  }
  return 'local_fallback';
}

function normalizeConfidenceLevel(
  level: string | undefined
): 'high' | 'medium' | 'low' {
  if (level === 'high' || level === 'medium' || level === 'low') return level;
  return 'medium';
}

// Convert one Dexie ViewRow into a dashboard ViewRow. Always returns a fully
// populated row, falling back gracefully when the trace JSON is missing fields
// (older view rows from Phase 1 will not have all the new fields).
export function adaptViewRow(row: DexieViewRow): ViewRow {
  let parsedTrace: Partial<Trace> = {};
  try {
    parsedTrace = JSON.parse(row.trace ?? '{}');
  } catch {
    parsedTrace = {};
  }

  // Confidence may be stored as { low, high, width_pct, reason } (engine v1)
  // or { level, score } (Climatiq path). Handle both.
  const rawConf: any = (parsedTrace as any).confidence ?? {};
  const widthPct =
    typeof rawConf.width_pct === 'number'
      ? rawConf.width_pct
      : DEFAULT_CONFIDENCE_WIDTH;
  const kgCiLow =
    typeof rawConf.low === 'number'
      ? rawConf.low
      : Math.max(0, row.kg_total * (1 - widthPct));
  const kgCiHigh =
    typeof rawConf.high === 'number'
      ? rawConf.high
      : row.kg_total * (1 + widthPct);

  // Confidence score: prefer explicit 0–1 number, otherwise derive from width.
  const confidenceScore =
    typeof rawConf.score === 'number'
      ? rawConf.score
      : Math.max(0.3, 1 - widthPct);

  const dataSource = normalizeSource(
    (parsedTrace as any).data_source ?? (parsedTrace as any).lookup_source
  );

  // Build a normalized Trace object so the drawer always renders cleanly.
  const normalizedTrace: Trace = {
    inputs: {
      category: row.category,
      price_usd: row.price ?? (parsedTrace as any)?.inputs?.price ?? 0,
      currency: 'USD',
      region: (parsedTrace as any)?.inputs?.region
    },
    lookup_source: dataSource,
    computation_steps: Array.isArray((parsedTrace as any).computation)
      ? (parsedTrace as any).computation
      : Array.isArray((parsedTrace as any).computation_steps)
      ? (parsedTrace as any).computation_steps
      : [],
    confidence: {
      level: normalizeConfidenceLevel(rawConf.level),
      score: confidenceScore
    },
    assumptions: Array.isArray((parsedTrace as any).assumptions)
      ? (parsedTrace as any).assumptions
      : [],
    methodology_version:
      (parsedTrace as any).methodology_version ?? 'v2.4.1',
    data_source: dataSource,
    isic4_code: (parsedTrace as any).isic4_code,
    climatiq_activity_id: (parsedTrace as any).climatiq_activity_id
  };

  return {
    id: String(row.id ?? cryptoSafeId()),
    ts: row.occurred_at ? Date.parse(row.occurred_at) : Date.now(),
    merchant: normalizeMerchant(row.merchant),
    title: row.title,
    category: row.category,
    category_uncertain: !!row.category_uncertain,
    kg_total: row.kg_total,
    kg_ci_low: kgCiLow,
    kg_ci_high: kgCiHigh,
    price_usd: row.price ?? 0,
    data_source: dataSource,
    trace: JSON.stringify(normalizedTrace),
    purchased: !!row.purchased
  };
}

export function adaptViewRows(rows: DexieViewRow[]): ViewRow[] {
  return rows.map(adaptViewRow);
}

export function defaultCacheStats(): ClimatiqCacheStats {
  return { hit_count_session: 0, miss_count_session: 0, total_entries: 0 };
}

function cryptoSafeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
