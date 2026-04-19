export interface Trace {
  inputs: {
    category: string;
    price_usd: number;
    currency: string;
    region?: string;
  };
  lookup_source: 'climatiq_fresh' | 'climatiq_cached' | 'local_fallback';
  computation_steps: string[];
  confidence: {
    level: 'high' | 'medium' | 'low';
    score: number;
  };
  assumptions: string[];
  methodology_version: string;
  data_source: 'climatiq_fresh' | 'climatiq_cached' | 'local_fallback';
  isic4_code?: string;
  climatiq_activity_id?: string;
}

export interface ViewRow {
  id: string;
  ts: number;
  merchant: 'amazon' | 'ebay' | 'walmart' | 'target' | 'bestbuy';
  title: string;
  category: string;
  category_uncertain: boolean;
  kg_total: number;
  kg_ci_low: number;
  kg_ci_high: number;
  price_usd: number;
  data_source: 'climatiq_fresh' | 'climatiq_cached' | 'local_fallback';
  trace: string;
  purchased?: boolean;
}

export interface ClimatiqCacheStats {
  hit_count_session: number;
  miss_count_session: number;
  total_entries: number;
}

export interface AuditEntry {
  id?: number;
  event_type: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export type SubscriptionStatus =
  | 'ACTIVE'
  | 'CANCELLING'
  | 'CANCELLED'
  | 'CANCEL_FAILED'
  | 'UNKNOWN';

export interface SubscriptionRow {
  id: string;
  name: string;
  merchant_id: number;
  merchant_name: string;
  status: SubscriptionStatus;
  billing_cycle: string;
  next_billing_date: string | null;
  is_cancellable: boolean;
  price_total: string;
  price_currency: string;
  annual_usd: number;
  kg_annual: number;
  synced_at: string;
}
