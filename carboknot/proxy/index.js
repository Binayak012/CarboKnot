// Carboknot stateless proxy.
//
// Zero-trust invariants (enforced by structure, not policy):
//   - No database. No disk writes of request/response bodies.
//   - No logs of product titles, URLs, or user identifiers. Only counts + errors.
//   - API keys live in env vars, never in source, never returned to clients.
//   - CORS locked to the Carboknot extension origin(s) in ALLOWED_ORIGINS.
//   - Rate limited per IP (token bucket, in memory).
//
// Routes:
//   GET  /health             → { ok: true, uptime_s, now }
//   GET  /swarm/cache-status → { last_refresh, refreshed_categories, source }
//                              forwards to SWARM_WATCHER_ORIGIN/cache-status,
//                              returns graceful fallback on any error
//   GET  /swarm/cache        → raw cache JSON proxied from the watcher VM
//   POST /api/reason         → { rationale, source: 'dedalus_llm' | 'fallback' }
//                              takes { original, alternative } where each is
//                              { title, kg_total, category }. Calls Dedalus LLM
//                              once with a 4s timeout. Falls back silently.
//   POST /knot/webhook       → receives signed Knot TransactionLink webhook,
//                              verifies HMAC-SHA256, enqueues confirmed purchase
//                              (merchant + amount_usd + occurred_at only — no PII).
//   GET  /knot/pending       → returns unacknowledged confirmed transactions for
//                              the extension service worker to match locally.
//   POST /knot/ack           → { ids: string[] } marks items as acknowledged,
//                              removes them from the in-memory queue.
//   POST /api/k2/reason      → { explanation, dominant_stage, confidence_note,
//                                 source: 'k2_think_v2' | 'fallback' }
//                              takes the deterministic engine trace
//                              { title, price, category, kg_total, stages,
//                                confidence, confidence_reason } and asks
//                              K2 Think V2 to narrate WHY the Climatiq-grounded
//                              number is what it is. K2 never produces the
//                              number — the trace is the ground truth.
//
// Environment:
//   DEDALUS_API_KEY              required for /api/reason to work
//   DEDALUS_API_ENDPOINT         default https://api.dedaluslabs.ai/v1/chat/completions
//   DEDALUS_MODEL                default openai/gpt-5
//   K2_API_KEY                   required for /api/k2/reason to call K2 Think V2
//   K2_API_ENDPOINT              default https://api.k2think.ai/v1/chat/completions
//   K2_MODEL                     default LLM360/K2-Think
//   SWARM_WATCHER_ORIGIN         required for /swarm/* (e.g. https://watcher.dedalus.cloud)
//   ALLOWED_ORIGINS              CSV, e.g. chrome-extension://abc,http://localhost:5173
//   REASON_RATE_LIMIT_PER_MIN    default 10
//   KNOT_WEBHOOK_SECRET          HMAC-SHA256 signing secret from Knot dashboard
//   PORT                         default 8787

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, timingSafeEqual } from 'node:crypto';

// --- env bootstrap (tiny .env loader so we don't need dotenv as a dep) ---
const __dirname = dirname(fileURLToPath(import.meta.url));
await loadEnvFile(resolve(__dirname, '.env')).catch(() => {});

const PORT = Number(process.env.PORT) || 8787;
const DEDALUS_API_KEY = process.env.DEDALUS_API_KEY || '';
const DEDALUS_API_ENDPOINT =
  process.env.DEDALUS_API_ENDPOINT || 'https://api.dedaluslabs.ai/v1/chat/completions';
const DEDALUS_MODEL = process.env.DEDALUS_MODEL || 'openai/gpt-5';
const K2_API_KEY = process.env.K2_API_KEY || '';
const K2_API_ENDPOINT =
  process.env.K2_API_ENDPOINT || 'https://api.k2think.ai/v1/chat/completions';
const K2_MODEL = process.env.K2_MODEL || 'LLM360/K2-Think';
const SWARM_WATCHER_ORIGIN = (process.env.SWARM_WATCHER_ORIGIN || '').replace(/\/+$/, '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const REASON_RATE_LIMIT_PER_MIN = Number(process.env.REASON_RATE_LIMIT_PER_MIN) || 10;
const KNOT_WEBHOOK_SECRET = process.env.KNOT_WEBHOOK_SECRET || '';
const KNOT_CLIENT_ID = process.env.KNOT_CLIENT_ID || '';
const KNOT_SECRET = process.env.KNOT_SECRET || '';
const KNOT_API_BASE = (process.env.KNOT_API_BASE || 'https://development.knotapi.com').replace(/\/+$/, '');

const SWARM_TIMEOUT_MS = 4000;
const REASON_TIMEOUT_MS = 4000;
// K2 is a reasoning model and can take a few seconds longer than GPT-5.
// Give it headroom but still bail before the extension UI feels stuck.
const K2_TIMEOUT_MS = 8000;
const STARTED_AT = Date.now();

// --- Knot confirmed-purchase queue ---
// In-memory only. Entries are dropped after 2 hours whether or not the
// extension polls. Max 200 entries guards against webhook flooding.
// Each entry: { id, merchant, amount_usd, occurred_at }
// Zero PII — no card numbers, no user IDs, no product titles.
const KNOT_QUEUE_MAX = 200;
const KNOT_QUEUE_TTL_MS = 2 * 60 * 60 * 1000;
const knotQueue = new Map(); // id → { merchant, amount_usd, occurred_at, queued_at }

// Periodic GC — drop entries older than TTL.
setInterval(() => {
  const cutoff = Date.now() - KNOT_QUEUE_TTL_MS;
  for (const [id, entry] of knotQueue) {
    if (entry.queued_at < cutoff) knotQueue.delete(id);
  }
}, 10 * 60 * 1000).unref();

// --- Knot subscription queue ---
// Populated by CARD_UPDATED webhook after fetching subscription details from Knot API.
// Entries survive 24 hours. Max 100 entries.
const SUB_QUEUE_MAX = 100;
const SUB_QUEUE_TTL_MS = 24 * 60 * 60 * 1000;
const subQueue = new Map(); // subscription_id → enriched subscription object

setInterval(() => {
  const cutoff = Date.now() - SUB_QUEUE_TTL_MS;
  for (const [id, entry] of subQueue) {
    if (entry.queued_at < cutoff) subQueue.delete(id);
  }
}, 60 * 60 * 1000).unref();

// --- Knot cancellation result queue ---
// Populated by CANCELLATION_SUCCEEDED / CANCELLATION_FAILED webhooks.
const cancellationQueue = new Map(); // subscription_id → { status, ts }

setInterval(() => {
  const cutoff = Date.now() - SUB_QUEUE_TTL_MS;
  for (const [id, entry] of cancellationQueue) {
    if (entry.ts < cutoff) cancellationQueue.delete(id);
  }
}, 60 * 60 * 1000).unref();

// --- Subscription carbon estimation ---
// kg CO₂e per annual USD spent, derived from spend-based LCA averages.
// Streaming/digital: data-center electricity (very low).
// Telecom: network infrastructure + device manufacturing amortised.
// Meal kits: food production + cold-chain delivery (high).
// Physical subscriptions: manufacturing + last-mile shipping.
const SUB_KG_PER_ANNUAL_USD = {
  'netflix': 0.12,
  'hulu': 0.12,
  'disney+': 0.12,
  'spotify': 0.08,
  'apple': 0.10,
  'verizon': 0.18,
  't-mobile': 0.18,
  'spectrum': 0.15,
  'xfinity internet': 0.15,
  'xfinity mobile': 0.18,
  'hellofresh': 2.80,
  'blue apron': 2.80,
  'home chef': 2.50,
  'everyplate': 2.30,
  'dollar shave club': 0.45,
  "harry's": 0.45,
};

function calcAnnualUsd(priceTotal, billingCycle) {
  const price = parseFloat(priceTotal || '0');
  if (!Number.isFinite(price) || price <= 0) return 0;
  switch ((billingCycle || '').toUpperCase()) {
    case 'WEEKLY':    return price * 52;
    case 'MONTHLY':   return price * 12;
    case 'QUARTERLY': return price * 4;
    case 'ANNUAL': case 'YEARLY': return price;
    default: return price * 12;
  }
}

function estimateKgAnnual(merchantName, annualUsdVal) {
  const key = (merchantName || '').toLowerCase();
  let factor = SUB_KG_PER_ANNUAL_USD[key];
  if (!factor) {
    const match = Object.entries(SUB_KG_PER_ANNUAL_USD).find(([k]) => key.includes(k));
    factor = match?.[1] ?? 0.20;
  }
  return Math.round(annualUsdVal * factor * 10) / 10;
}

function knotAuthHeader() {
  return `Basic ${Buffer.from(`${KNOT_CLIENT_ID}:${KNOT_SECRET}`).toString('base64')}`;
}

// Knot's webhook signature format:
//   Header: knot-signature: t=<unix_ms>,v1=<hex_hmac>
//   HMAC input: "<timestamp>.<raw_body>" with the webhook signing secret.
// Adjust field names in the payload parser below to match your Knot plan's
// actual schema — check Knot's dashboard → Webhooks → Event payload docs.
function verifyKnotSignature(rawBody, sigHeader) {
  if (!KNOT_WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(
    (sigHeader || '').split(',').map((s) => s.split('='))
  );
  const ts = parts['t'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;
  const expected = createHmac('sha256', KNOT_WEBHOOK_SECRET)
    .update(`${ts}.${rawBody}`)
    .digest('hex');
  try {
    return timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// Normalise Knot's merchant identifier → our internal merchant slug.
// Knot sends a merchant object; the `id` field is typically a lowercase slug.
// Extend this table as you enable more merchants in the Knot dashboard.
const KNOT_MERCHANT_MAP = {
  amazon: 'amazon',
  'amazon.com': 'amazon',
  ebay: 'ebay',
  'ebay.com': 'ebay'
};
function normaliseMerchant(raw) {
  const key = String(raw || '').toLowerCase().replace(/^www\./, '');
  return KNOT_MERCHANT_MAP[key] ?? key;
}

// --- rate limiter (token bucket per IP, in memory) ---
const buckets = new Map();
function rateLimitOk(ip) {
  const now = Date.now();
  const capacity = REASON_RATE_LIMIT_PER_MIN;
  const refillPerMs = capacity / 60000;
  const b = buckets.get(ip) || { tokens: capacity, updated: now };
  const tokens = Math.min(capacity, b.tokens + (now - b.updated) * refillPerMs);
  if (tokens < 1) {
    buckets.set(ip, { tokens, updated: now });
    return false;
  }
  buckets.set(ip, { tokens: tokens - 1, updated: now });
  return true;
}
// Periodic GC so map doesn't grow unbounded under burst.
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [ip, b] of buckets) if (b.updated < cutoff) buckets.delete(ip);
}, 60 * 1000).unref();

// --- server ---
const server = createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  applyCors(res, origin);
  if (req.method === 'OPTIONS') return end(res, 204);

  const url = new URL(req.url || '/', 'http://localhost');

  try {
    if (req.method === 'GET' && url.pathname === '/health') return handleHealth(res);
    if (req.method === 'GET' && url.pathname === '/swarm/cache-status') return handleSwarmCacheStatus(res);
    if (req.method === 'GET' && url.pathname === '/swarm/cache') return handleSwarmCache(res);
    if (req.method === 'POST' && url.pathname === '/api/reason') return handleReason(req, res);
    if (req.method === 'POST' && url.pathname === '/knot/webhook') return handleKnotWebhook(req, res);
    if (req.method === 'GET' && url.pathname === '/knot/pending') return handleKnotPending(res);
    if (req.method === 'POST' && url.pathname === '/knot/ack') return handleKnotAck(req, res);
    if (req.method === 'GET' && url.pathname === '/knot/subscriptions') return handleKnotSubsPending(res);
    if (req.method === 'POST' && url.pathname === '/knot/subscriptions/ack') return handleKnotSubsAck(req, res);
    if (req.method === 'GET' && url.pathname === '/knot/cancellations') return handleKnotCancellationsPending(res);
    if (req.method === 'POST' && url.pathname === '/knot/cancellations/ack') return handleKnotCancellationsAck(req, res);
    const cancelMatch = url.pathname.match(/^\/knot\/subscriptions\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) return handleKnotSubCancel(req, res, cancelMatch[1]);
    if (req.method === 'POST' && url.pathname === '/api/k2/reason') return handleK2Reason(req, res);
    if (req.method === 'POST' && url.pathname === '/dev/seed-subs') return handleDevSeedSubs(res);
    if (req.method === 'POST' && url.pathname === '/dev/seed-txs') return handleDevSeedTxs(req, res);
    if (req.method === 'GET' && url.pathname === '/dev/queue-status') return handleDevQueueStatus(res);

    return json(res, 404, { error: 'not_found', path: url.pathname });
  } catch (err) {
    console.error('[proxy] unhandled', err?.name, err?.message);
    return json(res, 500, { error: 'internal_error' });
  }
});

server.listen(PORT, () => {
  console.log(`[Carboknot proxy] listening on :${PORT}`);
  console.log(`[Carboknot proxy] dedalus key: ${DEDALUS_API_KEY ? 'set' : 'MISSING'}`);
  console.log(`[Carboknot proxy] k2 key: ${K2_API_KEY ? 'set' : 'MISSING'}`);
  console.log(`[Carboknot proxy] swarm watcher: ${SWARM_WATCHER_ORIGIN || 'MISSING'}`);
  console.log(`[Carboknot proxy] CORS origins: ${ALLOWED_ORIGINS.join(', ') || '(none set)'}`);
});

// --- route handlers ---

function handleHealth(res) {
  return json(res, 200, {
    ok: true,
    uptime_s: Math.floor((Date.now() - STARTED_AT) / 1000),
    now: new Date().toISOString(),
    dedalus_key: DEDALUS_API_KEY ? 'set' : 'missing',
    k2_key: K2_API_KEY ? 'set' : 'missing',
    swarm_watcher: SWARM_WATCHER_ORIGIN ? 'set' : 'missing'
  });
}

async function handleSwarmCacheStatus(res) {
  const fallback = { last_refresh: null, refreshed_categories: [], source: 'fallback' };
  if (!SWARM_WATCHER_ORIGIN) return json(res, 200, fallback);

  try {
    const body = await fetchWithTimeout(
      `${SWARM_WATCHER_ORIGIN}/cache-status`,
      { headers: { accept: 'application/json' } },
      SWARM_TIMEOUT_MS
    );
    return json(res, 200, {
      last_refresh: typeof body?.last_refresh === 'string' ? body.last_refresh : null,
      refreshed_categories: Array.isArray(body?.refreshed_categories) ? body.refreshed_categories : [],
      source: 'dedalus_swarm'
    });
  } catch (err) {
    console.warn('[proxy] /swarm/cache-status fallback:', err?.name || 'error');
    return json(res, 200, fallback);
  }
}

async function handleSwarmCache(res) {
  if (!SWARM_WATCHER_ORIGIN) return json(res, 503, { error: 'swarm_unavailable' });
  try {
    const body = await fetchWithTimeout(
      `${SWARM_WATCHER_ORIGIN}/cache`,
      { headers: { accept: 'application/json' } },
      SWARM_TIMEOUT_MS
    );
    return json(res, 200, body);
  } catch (err) {
    console.warn('[proxy] /swarm/cache fallback:', err?.name || 'error');
    return json(res, 503, { error: 'swarm_unavailable' });
  }
}

async function handleReason(req, res) {
  const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '').trim();
  if (!rateLimitOk(ip)) return json(res, 429, { error: 'rate_limited' });

  const payload = await readJson(req).catch(() => null);
  if (!payload || !payload.original || !payload.alternative) {
    return json(res, 400, { error: 'bad_payload' });
  }
  const { original, alternative } = payload;
  if (!validNumber(original?.kg_total) || !validNumber(alternative?.kg_total)) {
    return json(res, 400, { error: 'bad_payload' });
  }

  const fallback = {
    rationale: localRationale(original, alternative),
    source: 'fallback'
  };

  if (!DEDALUS_API_KEY) return json(res, 200, fallback);

  try {
    const prompt = buildReasonPrompt(original, alternative);
    const llm = await fetchWithTimeout(
      DEDALUS_API_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${DEDALUS_API_KEY}`
        },
        body: JSON.stringify({
          model: DEDALUS_MODEL,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ],
          max_tokens: 180,
          temperature: 0.3
        })
      },
      REASON_TIMEOUT_MS
    );
    const rationale = llm?.choices?.[0]?.message?.content?.trim();
    if (!rationale) throw new Error('empty_llm_response');
    return json(res, 200, { rationale, source: 'dedalus_llm' });
  } catch (err) {
    console.warn('[proxy] /api/reason fallback:', err?.name || 'error');
    return json(res, 200, fallback);
  }
}

// --- Knot route handlers ---

async function handleKnotWebhook(req, res) {
  // Read raw body first so we can verify the signature over the exact bytes.
  const rawBody = await readRawBody(req, 8192).catch(() => null);
  if (rawBody === null) return json(res, 400, { error: 'payload_too_large' });

  const sig = req.headers['knot-signature'] || '';
  if (KNOT_WEBHOOK_SECRET && !verifyKnotSignature(rawBody, sig)) {
    console.warn('[proxy] /knot/webhook signature mismatch');
    return json(res, 401, { error: 'invalid_signature' });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json(res, 400, { error: 'bad_json' }); }

  // Route by event type. Knot uses 'event' (CARD_UPDATED) or 'type' (transaction.created)
  // depending on the product — normalise both to uppercase for comparison.
  const eventType = String(payload?.event ?? payload?.type ?? '').toUpperCase();

  if (eventType === 'CARD_UPDATED') return handleCardUpdatedEvent(payload, res);
  if (eventType === 'CANCELLATION_SUCCEEDED') return handleCancellationEvent(payload, 'succeeded', res);
  if (eventType === 'CANCELLATION_FAILED') return handleCancellationEvent(payload, 'failed', res);
  if (eventType === 'NEW_TRANSACTIONS_AVAILABLE') return handleNewTransactionsAvailable(payload, res);

  // Knot event schema (TransactionLink):
  //   payload.type           e.g. "transaction.created"
  //   payload.data.id        unique transaction ID
  //   payload.data.merchant.id   merchant slug
  //   payload.data.amount    integer cents (USD)
  //   payload.data.created_at    ISO-8601 string
  // Adjust these field paths to match your Knot plan's actual schema.
  if (eventType !== 'TRANSACTION.CREATED') return json(res, 200, { ok: true, skipped: true });

  const data = payload?.data ?? {};
  const transactionId = String(data.id ?? '');
  const merchantRaw = data.merchant?.id ?? data.merchant?.name ?? '';
  const amountCents = Number(data.amount);
  const occurredAt = data.created_at ?? new Date().toISOString();

  if (!transactionId || !merchantRaw || !Number.isFinite(amountCents) || amountCents <= 0) {
    return json(res, 400, { error: 'bad_payload' });
  }

  // Evict oldest entry if at capacity before inserting.
  if (knotQueue.size >= KNOT_QUEUE_MAX) {
    const oldest = [...knotQueue.entries()].sort((a, b) => a[1].queued_at - b[1].queued_at)[0];
    if (oldest) knotQueue.delete(oldest[0]);
  }

  knotQueue.set(transactionId, {
    merchant: normaliseMerchant(merchantRaw),
    amount_usd: amountCents / 100,
    occurred_at: occurredAt,
    queued_at: Date.now()
  });

  console.log(`[proxy] /knot/webhook queued transaction (queue size: ${knotQueue.size})`);
  return json(res, 200, { ok: true });
}

async function handleNewTransactionsAvailable(payload, res) {
  const externalUserId = String(payload?.external_user_id ?? '');
  const merchantId = Number(payload?.merchant?.id);
  const merchantName = String(payload?.merchant?.name ?? '');

  if (!externalUserId || !merchantId) return json(res, 200, { ok: true, skipped: true });
  if (!KNOT_CLIENT_ID || !KNOT_SECRET) return json(res, 200, { ok: true, skipped: true });

  const SKIP_STATUSES = new Set(['CANCELLED', 'REFUNDED', 'RETURNED']);
  let cursor = undefined;
  let queued = 0;

  try {
    do {
      const body = { merchant_id: merchantId, external_user_id: externalUserId, limit: 100 };
      if (cursor) body.cursor = cursor;

      const data = await fetchWithTimeout(`${KNOT_API_BASE}/transactions/sync`, {
        method: 'POST',
        headers: { authorization: knotAuthHeader(), 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body)
      }, 8000);

      const transactions = Array.isArray(data?.transactions) ? data.transactions : [];
      for (const tx of transactions) {
        if (SKIP_STATUSES.has(tx.order_status)) continue;
        const amountUsd = parseFloat(tx.price?.total);
        if (!Number.isFinite(amountUsd) || amountUsd <= 0) continue;

        const txId = String(tx.id ?? `${merchantId}_${tx.datetime}_${amountUsd}`);
        if (knotQueue.size >= KNOT_QUEUE_MAX) {
          const oldest = [...knotQueue.entries()].sort((a, b) => a[1].queued_at - b[1].queued_at)[0];
          if (oldest) knotQueue.delete(oldest[0]);
        }
        knotQueue.set(txId, {
          merchant: normaliseMerchant(merchantName),
          amount_usd: amountUsd,
          occurred_at: tx.datetime ?? new Date().toISOString(),
          queued_at: Date.now()
        });
        queued++;
      }
      cursor = data?.next_cursor ?? null;
    } while (cursor);

    console.log(`[proxy] NEW_TRANSACTIONS_AVAILABLE: queued ${queued} transactions for ${merchantName}`);
  } catch (err) {
    console.warn('[proxy] NEW_TRANSACTIONS_AVAILABLE sync failed:', err?.name ?? 'error');
  }
  return json(res, 200, { ok: true, queued });
}

function handleKnotPending(res) {
  seedDemoTxs();
  const items = [];
  for (const [id, entry] of knotQueue) {
    items.push({ id, merchant: entry.merchant, amount_usd: entry.amount_usd, occurred_at: entry.occurred_at });
  }
  return json(res, 200, { items });
}

function seedDemoTxs() {
  const occurred_at = new Date().toISOString();
  const prices = [8.99, 14.99, 24.99, 39.99, 59.99, 89.99, 129.99, 199.99, 299.99, 499.99];
  for (const p of prices) {
    knotQueue.set(`dev_amazon_${p}`, { merchant: 'amazon', amount_usd: p, occurred_at, queued_at: Date.now() });
  }
}

async function handleKnotAck(req, res) {
  const payload = await readJson(req).catch(() => null);
  const ids = Array.isArray(payload?.ids) ? payload.ids : [];
  let removed = 0;
  for (const id of ids) {
    if (knotQueue.delete(String(id))) removed++;
  }
  return json(res, 200, { ok: true, removed });
}

// --- SubscriptionManager handlers ---

async function handleCardUpdatedEvent(payload, res) {
  const subscriptionIds = (payload?.data?.subscriptions ?? [])
    .map((s) => String(s?.id ?? ''))
    .filter(Boolean);

  if (subscriptionIds.length === 0) return json(res, 200, { ok: true, subscriptions: 0 });

  if (!KNOT_CLIENT_ID || !KNOT_SECRET) {
    console.warn('[proxy] CARD_UPDATED: Knot API keys not configured, skipping subscription fetch');
    return json(res, 200, { ok: true, subscriptions: 0 });
  }

  let fetched = 0;
  for (const subId of subscriptionIds) {
    try {
      const sub = await fetchWithTimeout(
        `${KNOT_API_BASE}/subscriptions/${subId}`,
        { headers: { authorization: knotAuthHeader(), accept: 'application/json' } },
        5000
      );
      const annualUsdVal = calcAnnualUsd(sub.price?.total, sub.billing_cycle);
      const kgAnnual = estimateKgAnnual(sub.merchant?.name, annualUsdVal);

      if (subQueue.size >= SUB_QUEUE_MAX) {
        const oldest = [...subQueue.entries()].sort((a, b) => a[1].queued_at - b[1].queued_at)[0];
        if (oldest) subQueue.delete(oldest[0]);
      }

      subQueue.set(subId, {
        id: sub.id ?? subId,
        name: sub.name ?? '',
        merchant_id: sub.merchant?.id ?? 0,
        merchant_name: sub.merchant?.name ?? '',
        status: sub.status ?? 'ACTIVE',
        billing_cycle: sub.billing_cycle ?? 'MONTHLY',
        next_billing_date: sub.next_billing_date ?? null,
        is_cancellable: !!sub.is_cancellable,
        price_total: String(sub.price?.total ?? '0'),
        price_currency: sub.price?.currency ?? 'USD',
        annual_usd: annualUsdVal,
        kg_annual: kgAnnual,
        queued_at: Date.now()
      });
      fetched++;
    } catch (err) {
      console.warn(`[proxy] CARD_UPDATED: failed to fetch subscription ${subId}:`, err?.name ?? 'error');
    }
  }

  console.log(`[proxy] CARD_UPDATED: queued ${fetched}/${subscriptionIds.length} subscriptions`);
  return json(res, 200, { ok: true, subscriptions: fetched });
}

function handleCancellationEvent(payload, status, res) {
  const subId = String(
    payload?.data?.subscription_id ?? payload?.data?.id ?? ''
  );
  if (subId) {
    cancellationQueue.set(subId, { status, ts: Date.now() });
    console.log(`[proxy] cancellation ${status} for subscription ${subId}`);
  }
  return json(res, 200, { ok: true });
}

function seedDemoSubs() {
  const demos = [
    { id: 'sub_hf_001', name: 'HelloFresh Weekly Box', merchant_id: 101, merchant_name: 'HelloFresh', status: 'ACTIVE', billing_cycle: 'weekly', next_billing_date: '2026-04-25', is_cancellable: true, price_total: '59.94', price_currency: 'USD', annual_usd: 3116.88, kg_annual: 431 },
    { id: 'sub_nf_001', name: 'Netflix Standard', merchant_id: 102, merchant_name: 'Netflix', status: 'ACTIVE', billing_cycle: 'monthly', next_billing_date: '2026-05-01', is_cancellable: true, price_total: '15.49', price_currency: 'USD', annual_usd: 185.88, kg_annual: 22 },
    { id: 'sub_sp_001', name: 'Spotify Premium', merchant_id: 103, merchant_name: 'Spotify', status: 'ACTIVE', billing_cycle: 'monthly', next_billing_date: '2026-05-03', is_cancellable: true, price_total: '12.99', price_currency: 'USD', annual_usd: 155.88, kg_annual: 12 },
    { id: 'sub_vz_001', name: 'Verizon Unlimited Plus', merchant_id: 104, merchant_name: 'Verizon', status: 'ACTIVE', billing_cycle: 'monthly', next_billing_date: '2026-05-05', is_cancellable: false, price_total: '80.00', price_currency: 'USD', annual_usd: 960, kg_annual: 173 },
    { id: 'sub_dsc_001', name: 'Dollar Shave Club', merchant_id: 105, merchant_name: 'Dollar Shave Club', status: 'CANCELLED', billing_cycle: 'monthly', next_billing_date: null, is_cancellable: false, price_total: '9.00', price_currency: 'USD', annual_usd: 108, kg_annual: 49 },
  ];
  for (const sub of demos) {
    if (!subQueue.has(sub.id)) subQueue.set(sub.id, { ...sub, queued_at: Date.now() });
  }
}

function handleKnotSubsPending(res) {
  seedDemoSubs();
  const items = [];
  for (const [, entry] of subQueue) items.push(entry);
  return json(res, 200, { items });
}

async function handleKnotSubsAck(req, res) {
  const payload = await readJson(req).catch(() => null);
  const ids = Array.isArray(payload?.ids) ? payload.ids : [];
  let removed = 0;
  for (const id of ids) {
    if (subQueue.delete(String(id))) removed++;
  }
  return json(res, 200, { ok: true, removed });
}

function handleKnotCancellationsPending(res) {
  const items = [];
  for (const [id, entry] of cancellationQueue) {
    items.push({ subscription_id: id, status: entry.status });
  }
  return json(res, 200, { items });
}

async function handleKnotCancellationsAck(req, res) {
  const payload = await readJson(req).catch(() => null);
  const ids = Array.isArray(payload?.ids) ? payload.ids : [];
  let removed = 0;
  for (const id of ids) {
    if (cancellationQueue.delete(String(id))) removed++;
  }
  return json(res, 200, { ok: true, removed });
}

async function handleKnotSubCancel(req, res, subId) {
  if (!KNOT_CLIENT_ID || !KNOT_SECRET) {
    return json(res, 503, { error: 'knot_not_configured' });
  }
  try {
    await fetchWithTimeout(
      `${KNOT_API_BASE}/subscriptions/${subId}/cancel`,
      { method: 'POST', headers: { authorization: knotAuthHeader(), accept: 'application/json' } },
      8000
    );
    return json(res, 202, { ok: true });
  } catch (err) {
    const httpStatus = err?.message?.startsWith('http_')
      ? parseInt(err.message.slice(5), 10)
      : 500;
    return json(res, httpStatus >= 400 && httpStatus < 500 ? httpStatus : 500, {
      error: 'cancel_failed',
      reason: err?.name ?? 'error'
    });
  }
}

// Dev-only: force-reseed subscriptions (useful to reset cancelled status).
function handleDevSeedSubs(res) {
  subQueue.clear();
  seedDemoSubs();
  console.log(`[proxy] /dev/seed-subs: reseeded ${subQueue.size} demo subscriptions`);
  return json(res, 200, { ok: true, seeded: subQueue.size });
}

// Dev-only: seed the transaction queue with Amazon purchases at the given price.
// Body: { price_usd: number }  (defaults to a spread of common prices if omitted)
async function handleDevSeedTxs(req, res) {
  const payload = await readJson(req).catch(() => ({}));
  const priceUsd = Number(payload?.price_usd);

  if (Number.isFinite(priceUsd) && priceUsd > 0) {
    const occurred_at = new Date().toISOString();
    knotQueue.set(`dev_amazon_${priceUsd}_${Date.now()}`, { merchant: 'amazon', amount_usd: priceUsd, occurred_at, queued_at: Date.now() });
    console.log(`[proxy] /dev/seed-txs: injected $${priceUsd} amazon transaction`);
  } else {
    seedDemoTxs();
  }
  return json(res, 200, { ok: true, queue_size: knotQueue.size });
}

// Dev-only: inspect queue sizes for debugging.
function handleDevQueueStatus(res) {
  return json(res, 200, {
    knot_queue: knotQueue.size,
    sub_queue: subQueue.size,
    cancellation_queue: cancellationQueue.size,
    knot_items: [...knotQueue.entries()].map(([id, e]) => ({ id, merchant: e.merchant, amount_usd: e.amount_usd, occurred_at: e.occurred_at }))
  });
}

// K2 Think V2 narrates WHY a deterministic Climatiq-grounded number is what
// it is. The engine's trace is the ground truth; K2 is read-only over it.
// It must never invent or revise kg values — only cite the dominant stage
// and the confidence driver already present in the trace.
async function handleK2Reason(req, res) {
  const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '').trim();
  if (!rateLimitOk(ip)) return json(res, 429, { error: 'rate_limited' });

  const payload = await readJson(req).catch(() => null);
  if (!payload || !validNumber(payload.kg_total) || !payload.stages) {
    return json(res, 400, { error: 'bad_payload' });
  }

  const fallback = {
    explanation: localFootprintExplanation(payload),
    dominant_stage: dominantStage(payload.stages),
    confidence_note: String(payload.confidence_reason || payload?.confidence?.reason || ''),
    source: 'fallback'
  };

  if (!K2_API_KEY) return json(res, 200, fallback);

  try {
    const prompt = buildK2Prompt(payload);
    const llm = await fetchWithTimeout(
      K2_API_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${K2_API_KEY}`
        },
        body: JSON.stringify({
          model: K2_MODEL,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ],
          max_tokens: 260,
          temperature: 0.2
        })
      },
      K2_TIMEOUT_MS
    );
    const explanation = llm?.choices?.[0]?.message?.content?.trim();
    if (!explanation) throw new Error('empty_llm_response');
    return json(res, 200, {
      explanation,
      dominant_stage: fallback.dominant_stage,
      confidence_note: fallback.confidence_note,
      source: 'k2_think_v2'
    });
  } catch (err) {
    console.warn('[proxy] /api/k2/reason fallback:', err?.name || 'error');
    return json(res, 200, fallback);
  }
}

// --- helpers ---

function buildReasonPrompt(orig, alt) {
  const saving = Math.max(0, orig.kg_total - alt.kg_total);
  const pct = orig.kg_total > 0 ? Math.round((saving / orig.kg_total) * 100) : 0;
  return {
    system:
      'You are an LCA expert explaining why one product has a lower carbon footprint than another. ' +
      'Respond in 2 short sentences, max 60 words total. Cite the main emission stage that is reduced ' +
      '(manufacturing, shipping, packaging, or end-of-life). Do not use emojis. Do not restate the numbers.',
    user:
      `Original: "${orig.title}" — ${orig.kg_total.toFixed(1)} kg CO2e, category ${orig.category || 'unknown'}.\n` +
      `Alternative: "${alt.title}" — ${alt.kg_total.toFixed(1)} kg CO2e (${pct}% less), category ${alt.category || orig.category || 'unknown'}.\n` +
      `Explain why the alternative is lower carbon.`
  };
}

function localRationale(orig, alt) {
  const pct = orig.kg_total > 0
    ? Math.round(((orig.kg_total - alt.kg_total) / orig.kg_total) * 100)
    : 0;
  return `Avoids new-unit manufacturing, the dominant emission stage for this category. Estimated ${pct}% less CO2e based on category-level LCA averages.`;
}

function buildK2Prompt(p) {
  const stageLines = Object.entries(p.stages || {})
    .map(([k, v]) => `  - ${k.replace(/_/g, ' ')}: ${Number(v).toFixed(2)} kg`)
    .join('\n');
  const ci = p.confidence || {};
  const ciLine =
    validNumber(ci.low) && validNumber(ci.high)
      ? `Confidence interval: ${Number(ci.low).toFixed(1)} – ${Number(ci.high).toFixed(1)} kg` +
        (validNumber(ci.width_pct) ? ` (±${Number(ci.width_pct).toFixed(0)}%)` : '')
      : '';
  const confReason = String(p.confidence_reason || ci.reason || '').trim();
  return {
    system:
      'You are K2 Think V2, a reasoning model narrating why a product has a given carbon footprint. ' +
      'The kg CO2e number and per-stage breakdown below are already computed deterministically from ' +
      'Climatiq-sourced LCA data — they are ground truth and must NEVER be revised, recomputed, or ' +
      'contradicted. Your job is to explain the breakdown in plain language: which lifecycle stage ' +
      'dominates, the physical reason it dominates for this category, and what the confidence interval ' +
      'reflects. Respond in 3 short sentences, max 90 words total. Do not restate the exact kg values. ' +
      'Do not use emojis. Do not suggest alternatives (a separate step handles that).',
    user:
      `Product: "${p.title || 'unspecified'}"\n` +
      `Price: $${validNumber(p.price) ? Number(p.price).toFixed(2) : 'n/a'}\n` +
      `Category: ${p.category || 'unknown'}\n` +
      `Total: ${Number(p.kg_total).toFixed(2)} kg CO2e\n` +
      `Stages:\n${stageLines}\n` +
      (ciLine ? `${ciLine}\n` : '') +
      (confReason ? `Confidence driver: ${confReason}\n` : '') +
      `Explain which stage dominates and why, grounded in the breakdown above.`
  };
}

function dominantStage(stages) {
  if (!stages || typeof stages !== 'object') return '';
  let best = '';
  let bestVal = -Infinity;
  for (const [k, v] of Object.entries(stages)) {
    if (validNumber(v) && v > bestVal) { best = k; bestVal = v; }
  }
  return best;
}

function localFootprintExplanation(p) {
  const stage = dominantStage(p.stages).replace(/_/g, ' ');
  if (!stage) return 'Per-stage breakdown not available; see the computation steps above.';
  return `The ${stage} stage dominates this footprint, which is typical for the ${p.category || 'general'} category. The remaining stages contribute smaller shares in the order shown above.`;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

function readRawBody(req, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('payload_too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readJson(req) {
  return readRawBody(req, 8192).then((raw) => JSON.parse(raw));
}

function validNumber(n) { return typeof n === 'number' && Number.isFinite(n); }

function applyCors(res, origin) {
  const allow = ALLOWED_ORIGINS.length === 0
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('access-control-allow-origin', allow);
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, accept');
  res.setHeader('access-control-max-age', '86400');
  res.setHeader('vary', 'origin');
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function end(res, status) { res.statusCode = status; res.end(); }

async function loadEnvFile(path) {
  const text = await readFile(path, 'utf8');
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq === -1) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
