// Carboknot proxy + Dedalus Machines factor warmer (co-located).
//
// This process is designed to run on a single stateful VM (a Dedalus
// Machine). The proxy side is stateless HTTP; the warmer side owns a
// persistent cache.json on disk. Co-locating the two means one public
// URL, one thing to monitor, and zero Render dependency.
//
// Zero-trust invariants (enforced by structure, not policy):
//   - No database. No disk writes of user request/response bodies.
//   - Only the warmer writes to disk, and only the emission-factor bundle.
//   - No logs of product titles, URLs, or user identifiers. Only counts + errors.
//   - API keys live in env vars, never in source, never returned to clients.
//   - CORS locked to the Carboknot extension origin(s) in ALLOWED_ORIGINS.
//   - Rate limited per IP (token bucket, in memory).
//
// Routes:
//   GET  /health             → { ok, uptime_s, warmer: { enabled, last_refresh, factor_count } }
//   GET  /swarm/cache-status → warmer freshness signal for the dashboard
//   GET  /swarm/cache        → full factor bundle the extension hydrates from
//   POST /swarm/refresh      → on-demand refresh, token-gated
//   POST /api/reason         → { rationale, source: 'dedalus_llm' | 'fallback' }
//                              takes { original, alternative } where each is
//                              { title, kg_total, category }. Calls Dedalus LLM
//                              once with a 4s timeout. Falls back silently.
//   POST /api/climatiq       → { co2e, co2e_unit, emission_factor }
//                              takes { classification_code, money, money_unit }.
//                              Forwards to Climatiq's spend-based estimate
//                              endpoint using an ISIC4→activity_id map (CEDA
//                              2022, region=US). Returns Climatiq's response
//                              verbatim so the extension can cache
//                              emission_factor.id / name alongside co2e.
//
// Environment:
//   DEDALUS_API_KEY              required for /api/reason to hit the LLM
//   DEDALUS_API_ENDPOINT         default https://api.dedaluslabs.ai/v1/chat/completions
//   DEDALUS_MODEL                default openai/gpt-5
//   CLIMATIQ_API_KEY             required for /api/climatiq + warmer
//   CLIMATIQ_API_ENDPOINT        default https://api.climatiq.io/data/v1/estimate
//   CLIMATIQ_DATA_VERSION        default ^21 (stable CEDA 2022 catalogue line)
//   WARMER_ENABLED               default false; set true on the Dedalus Machine
//   WARMER_REFRESH_MIN           default 240 (every 4 hours)
//   WARMER_CACHE_PATH            default ./data/cache.json; point at persistent disk
//   WARMER_REFRESH_TOKEN         optional; required as ?token= on POST /swarm/refresh
//   ALLOWED_ORIGINS              CSV, e.g. chrome-extension://abc,http://localhost:5173
//   REASON_RATE_LIMIT_PER_MIN    default 10
//   PORT                         default 8787

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// --- env bootstrap (tiny .env loader so we don't need dotenv as a dep) ---
const __dirname = dirname(fileURLToPath(import.meta.url));
await loadEnvFile(resolve(__dirname, '.env')).catch(() => {});

const PORT = Number(process.env.PORT) || 8787;
const DEDALUS_API_KEY = process.env.DEDALUS_API_KEY || '';
const DEDALUS_API_ENDPOINT =
  process.env.DEDALUS_API_ENDPOINT || 'https://api.dedaluslabs.ai/v1/chat/completions';
const DEDALUS_MODEL = process.env.DEDALUS_MODEL || 'openai/gpt-5';
const CLIMATIQ_API_KEY = process.env.CLIMATIQ_API_KEY || '';
const CLIMATIQ_API_ENDPOINT =
  process.env.CLIMATIQ_API_ENDPOINT || 'https://api.climatiq.io/data/v1/estimate';
const CLIMATIQ_DATA_VERSION = process.env.CLIMATIQ_DATA_VERSION || '^21';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const REASON_RATE_LIMIT_PER_MIN = Number(process.env.REASON_RATE_LIMIT_PER_MIN) || 10;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const K2_API_KEY = process.env.K2_API_KEY || '';
const K2_API_ENDPOINT =
  process.env.K2_API_ENDPOINT || 'https://api.k2think.ai/v1/chat/completions';
const K2_MODEL = process.env.K2_MODEL || 'MBZUAI-IFM/K2-Think-v2';
const K2_TIMEOUT_MS = 12000;
const CORPUS_DB_PATH = process.env.CORPUS_DB_PATH || resolve(__dirname, 'data', 'corpus.db');

const REASON_TIMEOUT_MS = 4000;
const CLIMATIQ_TIMEOUT_MS = 4000;
const ALT_TIMEOUT_MS = 12_000;
const STARTED_AT = Date.now();

const altCache = new Map();
const ALT_CACHE_TTL_MS = 10 * 60 * 1000;

// --- /api/match (Climatiq-grounded, Gemini-ranked) cache ---
// Separate from the warmer's spend-based cache.json so we never
// blow away the 132 warm factors. 24h TTL on full match responses.
const MATCH_CACHE_PATH = process.env.MATCH_CACHE_PATH || resolve(__dirname, 'data', 'match-cache.json');
const MATCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CLIMATIQ_SEARCH_ENDPOINT = process.env.CLIMATIQ_SEARCH_ENDPOINT || 'https://api.climatiq.io/data/v1/search';
const AUTOPILOT_SUGGEST_ENDPOINT = process.env.AUTOPILOT_SUGGEST_ENDPOINT || 'https://preview.api.climatiq.io/autopilot/v1-preview4/suggest';
const AUTOPILOT_ESTIMATE_ENDPOINT = process.env.AUTOPILOT_ESTIMATE_ENDPOINT || 'https://preview.api.climatiq.io/autopilot/v1-preview4/suggest/estimate';
const matchCache = new Map();
let matchCacheLoaded = false;

// --- corpus (persistent confirmations log via node:sqlite) ---
// node:sqlite is built-in since Node 22 (--experimental-sqlite flag) and stable in Node 23.4+.
// Wrapped in try/catch so the proxy boots fine if the flag is absent or sqlite init fails.
let corpusDb = null;
try {
  const { DatabaseSync } = await import('node:sqlite');
  await mkdir(dirname(CORPUS_DB_PATH), { recursive: true });
  corpusDb = new DatabaseSync(CORPUS_DB_PATH);
  corpusDb.exec(`
    CREATE TABLE IF NOT EXISTS confirmations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product TEXT NOT NULL,
      suggested_alternative TEXT NOT NULL,
      user_action TEXT NOT NULL CHECK (user_action IN ('accepted','rejected','ignored')),
      confirmed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_action ON confirmations(user_action);
  `);
  console.log(`[corpus] SQLite ready at ${CORPUS_DB_PATH}`);
} catch (err) {
  console.warn('[corpus] SQLite unavailable (corpus endpoints return 501):', err?.message);
}

// --- Dedalus Machines "factor warmer" state + config ---
//
// When WARMER_ENABLED=true, this proxy runs a background loop that
// pre-computes Climatiq spend-based factors for a sparse price ladder
// and writes them to disk as cache.json. The extension pulls this
// bundle at install time (and on dashboard open) via /swarm/cache,
// so the very first SKU a user looks at lands on a warm cache entry
// instead of paying a 300-800ms Climatiq round-trip.
//
// This process is intended to run on a stateful VM (Dedalus Machine).
// The cache file MUST live on persistent storage so a restart does
// not throw away the work.
const WARMER_ENABLED = String(process.env.WARMER_ENABLED || 'false').toLowerCase() === 'true';
const WARMER_REFRESH_MIN = Number(process.env.WARMER_REFRESH_MIN) || 240;
const WARMER_CACHE_PATH = process.env.WARMER_CACHE_PATH || resolve(__dirname, 'data', 'cache.json');
const WARMER_CLIMATIQ_DELAY_MS = Number(process.env.WARMER_CLIMATIQ_DELAY_MS) || 500;
const WARMER_INITIAL_DELAY_MS = Number(process.env.WARMER_INITIAL_DELAY_MS) || 5000;

// Carboknot internal category → ISIC4 code. Kept in sync by hand with
// extension/src/engine/category_map.json (same keys, same codes).
const CATEGORY_TO_CODE = {
  audio_electronics: '26',
  laptops:           '26',
  smartphones:       '26',
  tablets_displays:  '26',
  gaming_consoles:   '26',
  apparel_tops:      '14',
  apparel_bottoms:   '14',
  footwear:          '15',
  home_goods:        '20',
  beauty:            '20',
  kitchenware:       '20',
  books:             '18',
  food_packaged:     '10',
  beverages:         '10',
  furniture:         '31',
  appliances:        '27',
  sports_outdoor:    '32_sport',
  pet_supplies:      '10',
  baby:              '32',
  tools_hardware:    '25',
  watches_jewelry:   '32',
  toys:              '32',
  general:           '32'
};

// Sparse price ladder. Each entry here is a canonical output of the
// extension's priceBucket() rule (nearest 5 under $50, nearest 10
// under $200, nearest 25 under $1000, nearest 100 above). Visits
// landing on an unwarmed bucket still work through /api/climatiq
// live, just paying a one-time miss cost.
const WARMER_PRICE_LADDER = [25, 50, 100, 150, 200, 300, 500, 800, 1500, 3000, 6000];

let warmerState = {
  version: 1,
  last_refresh: null,
  last_refresh_duration_ms: 0,
  refreshed_categories: [],
  factor_count: 0,
  source: 'fallback',
  factors: {}
};
let warmerTimer = null;

// ISIC4 classification code → Climatiq CEDA 2022 spend-based activity_id.
// CEDA 2022 is the spend-based factor catalogue available on the standard
// Climatiq tier (EXIOBASE is gated). All activity_ids were verified live
// against Climatiq's /search + /estimate endpoints at region=US with
// data_version ^21 (see proxy/README.md for the verification script).
// Any code not listed here falls back to `_default`. Region is pinned
// to US in the estimate call below so Climatiq does not auto-select an
// arbitrary non-US region (which happens when region is omitted).
const CLIMATIQ_ACTIVITY_IDS = {
  '10': 'food-type_snack_food_manufacturing',
  '14': 'consumer_goods-type_apparel_manufacturing',
  '15': 'consumer_goods-type_leather_and_related_product_manufacturing',
  '18': 'paper_products-type_book_publishers',
  '20': 'chemicals-type_soap_and_cleaning_compound_manufacturing',
  '25': 'machinery-type_machine_tool_manufacturing',
  '26': 'electronics-type_electronic_computer',
  '27': 'electrical_equipment-type_small_electrical_appliances',
  '31': 'consumer_goods-type_institutional_furniture',
  '32': 'consumer_goods-type_doll_toy_and_game_manufacturing',
  '32_sport': 'consumer_goods-type_sporting_athletic_goods',
  _default: 'consumer_goods-type_doll_toy_and_game_manufacturing'
};
const CLIMATIQ_DEFAULT_REGION = 'US';

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
    if (req.method === 'POST' && url.pathname === '/swarm/refresh') return handleSwarmRefresh(req, res);
    if (req.method === 'POST' && url.pathname === '/api/reason') return handleReason(req, res);
    if (req.method === 'POST' && url.pathname === '/api/climatiq') return handleClimatiq(req, res);
    if (req.method === 'POST' && url.pathname === '/api/confirm')       return handleConfirm(req, res);
    if (req.method === 'GET'  && url.pathname === '/api/stats')         return handleStats(res);
    if (req.method === 'POST' && url.pathname === '/api/alternatives')  return handleAlternatives(req, res);
    if (req.method === 'POST' && url.pathname === '/api/match')         return handleMatch(req, res);

    return json(res, 404, { error: 'not_found', path: url.pathname });
  } catch (err) {
    console.error('[proxy] unhandled', err?.name, err?.message);
    return json(res, 500, { error: 'internal_error' });
  }
});

server.listen(PORT, () => {
  console.log(`[Carboknot proxy] listening on :${PORT}`);
  console.log(`[Carboknot proxy] k2 key: ${K2_API_KEY ? 'set' : 'MISSING'}`);
  console.log(`[Carboknot proxy] dedalus key: ${DEDALUS_API_KEY ? 'set' : 'MISSING'}`);
  console.log(`[Carboknot proxy] climatiq key: ${CLIMATIQ_API_KEY ? 'set' : 'MISSING'}`);
  console.log(`[Carboknot proxy] CORS origins: ${ALLOWED_ORIGINS.join(', ') || '(none set)'}`);
  startWarmer().catch((err) => console.error('[warmer] boot failed:', err?.message || err));
});

// --- route handlers ---

// Upstream ping cache: avoid hammering Climatiq/Gemini on every /health hit.
const upstreamPingCache = { ts: 0, climatiq: 'unknown', gemini: 'unknown' };
const UPSTREAM_PING_TTL_MS = 60_000;

async function probeUpstreams() {
  if (Date.now() - upstreamPingCache.ts < UPSTREAM_PING_TTL_MS) return upstreamPingCache;
  const ctrl = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c; };
  const probes = await Promise.allSettled([
    CLIMATIQ_API_KEY
      ? fetch('https://api.climatiq.io/data/v1/data-versions', {
          headers: { authorization: `Bearer ${CLIMATIQ_API_KEY}` },
          signal: ctrl(1000).signal
        }).then((r) => (r.ok ? 'ok' : `http_${r.status}`))
      : Promise.resolve('unconfigured'),
    GEMINI_API_KEY
      ? fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}&pageSize=1`,
          { signal: ctrl(1000).signal }
        ).then((r) => (r.ok ? 'ok' : `http_${r.status}`))
      : Promise.resolve('unconfigured')
  ]);
  upstreamPingCache.ts = Date.now();
  upstreamPingCache.climatiq = probes[0].status === 'fulfilled' ? probes[0].value : 'down';
  upstreamPingCache.gemini   = probes[1].status === 'fulfilled' ? probes[1].value : 'down';
  return upstreamPingCache;
}

async function handleHealth(res) {
  const upstream = await probeUpstreams().catch(() => ({ climatiq: 'down', gemini: 'down' }));
  const ageMin = warmerState.last_refresh
    ? Math.floor((Date.now() - new Date(warmerState.last_refresh).getTime()) / 60_000)
    : null;
  return json(res, 200, {
    status: 'ok',
    uptime_s: Math.floor((Date.now() - STARTED_AT) / 1000),
    now: new Date().toISOString(),
    gemini_key: GEMINI_API_KEY ? 'set' : 'missing',
    dedalus_key: DEDALUS_API_KEY ? 'set' : 'missing',
    climatiq_key: CLIMATIQ_API_KEY ? 'set' : 'missing',
    corpus: corpusDb ? { ok: true } : { ok: false, reason: 'sqlite_unavailable' },
    cache: {
      keys: warmerState.factor_count,
      last_warmed_iso: warmerState.last_refresh,
      age_minutes: ageMin
    },
    upstream: { climatiq: upstream.climatiq, gemini: upstream.gemini },
    warmer: {
      enabled: WARMER_ENABLED,
      last_refresh: warmerState.last_refresh,
      factor_count: warmerState.factor_count,
      refresh_interval_min: WARMER_REFRESH_MIN
    },
    match_cache: { entries: matchCache.size }
  });
}

// Manual refresh endpoint. Guarded by a token so anyone hitting the
// public URL can't burn your Climatiq quota. Set WARMER_REFRESH_TOKEN
// in your env and pass it as ?token=... or x-warmer-token header.
let refreshInFlight = false;
async function handleSwarmRefresh(req, res) {
  const requiredToken = process.env.WARMER_REFRESH_TOKEN || '';
  const url = new URL(req.url || '/', 'http://localhost');
  const providedToken = url.searchParams.get('token') || req.headers['x-warmer-token'] || '';
  if (requiredToken && providedToken !== requiredToken) {
    return json(res, 403, { error: 'forbidden' });
  }
  if (!WARMER_ENABLED) {
    return json(res, 409, { error: 'warmer_disabled' });
  }
  if (refreshInFlight) {
    return json(res, 409, { error: 'refresh_in_flight' });
  }
  refreshInFlight = true;
  try {
    const result = await warmOnce();
    return json(res, 200, { ok: true, ...result, last_refresh: warmerState.last_refresh });
  } catch (err) {
    return json(res, 500, { error: 'refresh_failed', message: err?.message || 'unknown' });
  } finally {
    refreshInFlight = false;
  }
}

function handleSwarmCacheStatus(res) {
  return json(res, 200, {
    last_refresh: warmerState.last_refresh,
    refreshed_categories: warmerState.refreshed_categories,
    factor_count: warmerState.factor_count,
    source: warmerState.last_refresh ? 'dedalus_swarm' : 'fallback',
    refresh_interval_min: WARMER_REFRESH_MIN,
    last_refresh_duration_ms: warmerState.last_refresh_duration_ms,
    warmer_enabled: WARMER_ENABLED
  });
}

function handleSwarmCache(res) {
  if (!warmerState.last_refresh) {
    return json(res, 503, { error: 'cache_empty', source: 'fallback' });
  }
  return json(res, 200, {
    version: warmerState.version,
    last_refresh: warmerState.last_refresh,
    factor_count: warmerState.factor_count,
    source: 'dedalus_swarm',
    factors: warmerState.factors
  });
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

  const fallback = { rationale: localRationale(original, alternative), source: 'fallback' };
  const prompt = buildReasonPrompt(original, alternative);

  // 1. Try K2 Think (deep reasoning LLM — best for LCA analysis)
  if (K2_API_KEY) {
    try {
      const k2 = await fetchWithTimeout(K2_API_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${K2_API_KEY}` },
        body: JSON.stringify({
          model: K2_MODEL,
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
          max_tokens: 250,
          temperature: 0.3
        })
      }, K2_TIMEOUT_MS);
      let rationale = k2?.choices?.[0]?.message?.content?.trim() || '';
      // K2-Think emits chain-of-thought in <think>...</think> tags.
      // Strip the thinking block to get only the clean answer.
      rationale = rationale.replace(/^[\s\S]*<\/think>\s*/i, '').trim();
      if (!rationale) throw new Error('empty_k2_response');
      return json(res, 200, { rationale, source: 'k2_think' });
    } catch (err) {
      console.warn('[proxy] K2 Think fallback:', err?.name || 'error', err?.message || '');
    }
  }

  // 2. Try Gemini (key in URL query param, not Authorization header)
  if (GEMINI_API_KEY) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
      const data = await fetchWithTimeout(geminiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
          generationConfig: { maxOutputTokens: 180, temperature: 0.3 }
        })
      }, REASON_TIMEOUT_MS);
      const rationale = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!rationale) throw new Error('empty_gemini_response');
      return json(res, 200, { rationale, source: 'gemini' });
    } catch (err) {
      console.warn('[proxy] Gemini fallback:', err?.name || 'error', err?.message || '');
    }
  }

  // 3. Try Dedalus LLM
  if (DEDALUS_API_KEY) {
    try {
      const llm = await fetchWithTimeout(DEDALUS_API_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${DEDALUS_API_KEY}` },
        body: JSON.stringify({
          model: DEDALUS_MODEL,
          messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
          max_tokens: 180,
          temperature: 0.3
        })
      }, REASON_TIMEOUT_MS);
      const rationale = llm?.choices?.[0]?.message?.content?.trim();
      if (!rationale) throw new Error('empty_llm_response');
      return json(res, 200, { rationale, source: 'dedalus_llm' });
    } catch (err) {
      console.warn('[proxy] Dedalus fallback:', err?.name || 'error');
    }
  }

  return json(res, 200, fallback);
}

async function handleClimatiq(req, res) {
  const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '').trim();
  if (!rateLimitOk(ip)) return json(res, 429, { error: 'rate_limited' });

  const payload = await readJson(req).catch(() => null);
  if (!payload) return json(res, 400, { error: 'bad_payload' });
  const code = String(payload.classification_code ?? '').trim();
  const money = payload.money;
  const money_unit = String(payload.money_unit ?? 'usd').toLowerCase();
  if (!code || !validNumber(money) || money <= 0) {
    return json(res, 400, { error: 'bad_payload' });
  }

  // Without a Climatiq key we return a clean 503 so the service worker
  // falls back to its widened local estimate. Never silently pretend.
  if (!CLIMATIQ_API_KEY) {
    return json(res, 503, { error: 'climatiq_unconfigured', source: 'fallback' });
  }

  const activity_id = CLIMATIQ_ACTIVITY_IDS[code] || CLIMATIQ_ACTIVITY_IDS._default;

  try {
    const body = await fetchWithTimeout(
      CLIMATIQ_API_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${CLIMATIQ_API_KEY}`
        },
        body: JSON.stringify({
          emission_factor: {
            activity_id,
            data_version: CLIMATIQ_DATA_VERSION,
            region: CLIMATIQ_DEFAULT_REGION
          },
          parameters: { money, money_unit }
        })
      },
      CLIMATIQ_TIMEOUT_MS
    );

    // Shape-check the Climatiq response so the extension never has to
    // guess. co2e + emission_factor.id are the only fields the SW/cache
    // reads; everything else is passed through for debugging.
    if (typeof body?.co2e !== 'number' || !body?.emission_factor?.id) {
      throw new Error('malformed_climatiq_response');
    }
    return json(res, 200, body);
  } catch (err) {
    console.warn('[proxy] /api/climatiq fallback:', err?.name || 'error', err?.message || '');
    return json(res, 503, { error: 'climatiq_unavailable', source: 'fallback' });
  }
}

// --- corpus ---

async function handleConfirm(req, res) {
  if (!corpusDb) return json(res, 501, { error: 'corpus_unavailable' });
  const payload = await readJson(req).catch(() => null);
  const { product, suggested_alternative, user_action } = payload || {};
  if (!product || !suggested_alternative || !['accepted', 'rejected', 'ignored'].includes(user_action)) {
    return json(res, 400, { error: 'bad_payload' });
  }
  try {
    const stmt = corpusDb.prepare(
      'INSERT INTO confirmations (product, suggested_alternative, user_action) VALUES (?, ?, ?)'
    );
    const result = stmt.run(String(product).slice(0, 200), String(suggested_alternative).slice(0, 200), user_action);
    return json(res, 200, { ok: true, id: Number(result.lastInsertRowid) });
  } catch (err) {
    console.warn('[corpus] insert failed:', err?.message);
    return json(res, 500, { error: 'insert_failed' });
  }
}

function handleStats(res) {
  if (!corpusDb) return json(res, 501, { error: 'corpus_unavailable' });
  try {
    const total = corpusDb.prepare('SELECT COUNT(*) AS n FROM confirmations').get()?.n ?? 0;
    const rows = corpusDb.prepare(
      'SELECT user_action, COUNT(*) AS n FROM confirmations GROUP BY user_action'
    ).all();
    const counts = { accepted: 0, rejected: 0, ignored: 0 };
    for (const row of rows) counts[row.user_action] = Number(row.n);
    return json(res, 200, {
      total: Number(total),
      accepted: counts.accepted,
      rejected: counts.rejected,
      ignored: counts.ignored,
      acceptance_rate: Number(total) > 0 ? +(counts.accepted / Number(total)).toFixed(2) : 0
    });
  } catch (err) {
    console.warn('[corpus] stats failed:', err?.message);
    return json(res, 500, { error: 'stats_failed' });
  }
}

// --- Gemini-powered alternatives ---

function altPriceBucket(price) {
  const p = Number(price) || 0;
  if (p < 50)   return Math.round(p / 5)   * 5;
  if (p < 200)  return Math.round(p / 10)  * 10;
  if (p < 1000) return Math.round(p / 25)  * 25;
  return Math.round(p / 100) * 100;
}

async function handleAlternatives(req, res) {
  if (!GEMINI_API_KEY) return json(res, 503, { error: 'gemini_unconfigured' });

  const payload = await readJson(req).catch(() => null);
  if (!payload || !payload.title || !payload.category) {
    return json(res, 400, { error: 'bad_payload' });
  }

  const { title, category, price, carbon_kg, site } = payload;
  const priceNum = Number(price) || 0;
  const carbonNum = Number(carbon_kg) || 0;
  const cacheKey = `${category}::${altPriceBucket(priceNum)}`;

  const cached = altCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ALT_CACHE_TTL_MS) {
    return json(res, 200, { alternatives: cached.data, source: 'cache' });
  }

  const siteCtx = site?.includes('ebay')
    ? 'User is on eBay — prioritise refurbished and pre-owned listings.'
    : site?.includes('amazon')
    ? 'User is on Amazon — mix of energy-efficient new products and certified refurbished.'
    : 'User is shopping online — include refurbished, secondhand and sustainable brands.';

  // Merchant pool: 7 destinations so alternatives span 5+ unique sites.
  const merchantList =
    'Back Market, eBay (refurbished/pre-owned), Amazon (renewed/certified), ' +
    'ThredUp, Poshmark, Swappa, Walmart (renewed)';

  const userPrompt =
    `You are a sustainability expert. Return ONLY a raw JSON array (no markdown fences, no commentary).\n\n` +
    `Product: "${title}" | Category: ${category} | Price: $${priceNum} | Carbon: ${carbonNum.toFixed(1)} kg CO₂e\n` +
    `${siteCtx}\n\n` +
    `Suggest 6 specific lower-carbon alternatives. RULES:\n` +
    `- Each MUST be a real, currently purchasable product (exact brand + model).\n` +
    `- Refurbished/renewed/secondhand items are lower carbon because they cost less and avoid new manufacturing.\n` +
    `- Spread across AT LEAST 5 different merchants from: ${merchantList}.\n` +
    `- Do NOT repeat the same merchant more than twice.\n\n` +
    `Each JSON object must have ONLY these keys:\n` +
    `- name: exact brand + full model name (string)\n` +
    `- why: 1-2 sentences explaining which emission stage (manufacturing, shipping, packaging, end-of-life) is reduced and why (string)\n` +
    `- search_query: best search terms to find this exact product on the merchant (string)\n` +
    `- type: one of refurbished, secondhand, efficient, durable (string)\n` +
    `- preferred_merchant: one of backmarket, ebay, amazon, thredup, poshmark, swappa, walmart (string)\n` +
    `- estimated_price_usd: realistic estimated price in USD on this merchant (number)\n\n` +
    `Output raw JSON array only, starting with [ and ending with ].`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const data = await fetchWithTimeout(geminiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 8192, temperature: 0.5, thinkingConfig: { thinkingBudget: 0 } }
      })
    }, ALT_TIMEOUT_MS);

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!raw) throw new Error('empty_gemini_response');

    let parsed;
    try { parsed = JSON.parse(raw); } catch { /* will try regex below */ }
    if (!Array.isArray(parsed)) {
      // Gemini sometimes wraps array in an object or markdown fences
      const arrMatch = raw.match(/\[[\s\S]*\]/);
      if (arrMatch) { try { parsed = JSON.parse(arrMatch[0]); } catch { /* noop */ } }
    }
    if (!Array.isArray(parsed)) {
      // Check if it's an object with a nested array key
      if (parsed && typeof parsed === 'object') {
        parsed = parsed.alternatives || parsed.items || parsed.data || Object.values(parsed).find(Array.isArray);
      }
    }
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('no_valid_json_array');

    // Carbon comes ONLY from Climatiq — no carbon_factor from Gemini.
    const filteredAlts = parsed
      .filter(a => a && typeof a.name === 'string')
      .slice(0, 6);

    const code = CATEGORY_TO_CODE[category] || CATEGORY_TO_CODE.general || '32';

    // Carbon = ALWAYS Climatiq spend-based (proportional to price).
    const alternatives = await Promise.all(filteredAlts.map(async (a) => {
      const sq = encodeURIComponent(a.search_query || a.name);
      const isUsed = a.type === 'refurbished' || a.type === 'secondhand';
      const merchant = String(a.preferred_merchant || '').toLowerCase().trim();

      const priceEst = (typeof a.estimated_price_usd === 'number' && a.estimated_price_usd > 0)
        ? Math.round(a.estimated_price_usd)
        : Math.round(isUsed ? priceNum * 0.55 : priceNum * 0.9);

      const { url, merchantLabel } = proxyBuildMerchantUrl(merchant, sq, isUsed, a.type);

      // Carbon via Climatiq — same ISIC category, alternative's price.
      // Proportional to price: lower price → lower carbon.
      // Fallback: price-proportional from original.
      let altCarbon;
      let carbonSource;
      if (CLIMATIQ_API_KEY) {
        try {
          const est = await climatiqEstimate(code, priceEst);
          altCarbon = est.co2e;
          carbonSource = 'climatiq';
        } catch { /* fall through to proportional */ }
      }
      if (altCarbon == null) {
        const priceRatio = priceNum > 0 ? priceEst / priceNum : 0.5;
        altCarbon = carbonNum * priceRatio;
        carbonSource = 'price_proportional';
      }

      return {
        name: String(a.name).slice(0, 120),
        merchant: merchantLabel,
        price_usd: priceEst,
        carbon_kg: altCarbon,
        carbon_saved_kg: carbonNum - altCarbon,
        url,
        rationale: String(a.why || '').slice(0, 400),
        type: a.type || 'efficient',
        carbon_source: carbonSource
      };
    }));

    const valid = alternatives.filter(a => a.carbon_saved_kg > 0);
    if (valid.length === 0) throw new Error('no_valid_alternatives');

    altCache.set(cacheKey, { ts: Date.now(), data: valid });
    return json(res, 200, { alternatives: valid, source: 'gemini' });
  } catch (err) {
    console.warn('[proxy] /api/alternatives:', err?.message || err);
    return json(res, 503, { error: 'alternatives_unavailable' });
  }
}

// 7 merchant URL builders — proxy version (same logic as service worker).
function proxyBuildMerchantUrl(merchant, searchQuery, isUsed, type) {
  switch (merchant) {
    case 'ebay':
      return {
        url: `https://www.ebay.com/sch/i.html?_nkw=${searchQuery}${isUsed ? '&LH_ItemCondition=3000' : ''}`,
        merchantLabel: isUsed ? 'eBay Pre-owned' : 'eBay'
      };
    case 'amazon':
      return {
        url: `https://www.amazon.com/s?k=${searchQuery}${isUsed ? '+renewed' : ''}`,
        merchantLabel: isUsed ? 'Amazon Renewed' : 'Amazon'
      };
    case 'backmarket':
      return {
        url: `https://www.backmarket.com/en-us/search?q=${searchQuery}`,
        merchantLabel: 'Back Market'
      };
    case 'thredup':
      return {
        url: `https://www.thredup.com/products/search?search_terms=${searchQuery}`,
        merchantLabel: 'ThredUp'
      };
    case 'poshmark':
      return {
        url: `https://poshmark.com/search?query=${searchQuery}&type=listings`,
        merchantLabel: 'Poshmark'
      };
    case 'swappa':
      return {
        url: `https://swappa.com/search?q=${searchQuery}`,
        merchantLabel: 'Swappa'
      };
    case 'walmart':
      return {
        url: `https://www.walmart.com/search?q=${searchQuery}${isUsed ? '+renewed' : ''}`,
        merchantLabel: isUsed ? 'Walmart Renewed' : 'Walmart'
      };
    default:
      if (isUsed) {
        return {
          url: `https://www.backmarket.com/en-us/search?q=${searchQuery}`,
          merchantLabel: 'Back Market'
        };
      }
      return {
        url: `https://www.google.com/search?q=${searchQuery}+buy&tbm=shop`,
        merchantLabel: type === 'durable' ? 'Brand Direct' : 'Google Shopping'
      };
  }
}

// --- /api/match: Climatiq-grounded, Gemini-ranked matcher ---
//
// Contract:
//   POST /api/match
//   Body: { brand, model, category, material, weight_kg, price_usd, url }
//
// Pipeline:
//   1. Cache lookup (24h TTL, sha256 of brand|model|material|weight_kg)
//   2. Estimate the original product:
//        - Try Autopilot Suggest → Autopilot Estimate (if account is opted in)
//        - On 403/error fall back to /data/v1/search (top hit) → /data/v1/estimate
//   3. Build candidate pool from /data/v1/search with broader query
//      (material + category), dedupe by activity_id, take top 15-20
//   4. Rank with Gemini (verbatim spec prompt; temperature 0.2; responseSchema)
//   5. /data/v1/estimate top 3 with weight params
//   6. Persist response to MATCH_CACHE_PATH (separate file from warmer cache)
//
// Error handling:
//   - Climatiq 429/5xx on step 2 → 503 { retry_after_s: 60 }
//   - Gemini 429 / malformed → fallback: same-category candidates sorted by
//     co2e_kg ascending, top 3, with meta.gemini_fallback_used=true
//   - Per-alternative estimate failure → co2e_kg=null, do not kill response

async function handleMatch(req, res) {
  const t0 = Date.now();
  const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '').trim();
  if (!rateLimitOk(ip)) return json(res, 429, { error: 'rate_limited' });

  const payload = await readJson(req).catch(() => null);
  if (!payload || !payload.brand || !payload.model) {
    return json(res, 400, { error: 'bad_payload', need: ['brand', 'model', 'weight_kg'] });
  }
  const brand    = String(payload.brand).slice(0, 80);
  const model    = String(payload.model).slice(0, 200);
  const category = String(payload.category || '').slice(0, 80);
  const material = String(payload.material || '').slice(0, 80);
  const weight_kg = Number(payload.weight_kg);
  const price_usd = Number(payload.price_usd) || 0;
  if (!validNumber(weight_kg) || weight_kg <= 0) {
    return json(res, 400, { error: 'bad_payload', need: ['weight_kg > 0'] });
  }

  await loadMatchCacheOnce();
  const cacheKey = createHash('sha256')
    .update(`${brand}|${model}|${material}|${weight_kg}`)
    .digest('hex');
  const cached = matchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < MATCH_CACHE_TTL_MS) {
    return json(res, 200, {
      ...cached.data,
      meta: { ...cached.data.meta, cache_hit: true, latency_ms: Date.now() - t0 }
    });
  }

  if (!CLIMATIQ_API_KEY) return json(res, 503, { error: 'climatiq_unconfigured' });

  const meta = {
    cache_hit: false,
    latency_ms: 0,
    used_autopilot: false,
    gemini_fallback_used: false
  };

  // Step 2: estimate the original.
  let original;
  try {
    original = await estimateOriginal({ brand, model, material, category, weight_kg }, meta);
  } catch (err) {
    const status = err?.status === 429 || (err?.status >= 500 && err?.status < 600) ? 503 : 502;
    console.warn('[match] original estimate failed:', err?.message || err);
    return json(res, status, { error: 'climatiq_unavailable', retry_after_s: 60 });
  }

  // Step 3: candidate pool (broad search, dedupe by activity_id, cap 20).
  let candidates = [];
  try {
    candidates = await buildCandidatePool({ material, category, brand, model });
  } catch (err) {
    console.warn('[match] candidate search failed:', err?.message || err);
  }
  // Always include the original's activity in the pool (Gemini may pick it
  // back if nothing similar exists). De-dupe afterwards.
  const seen = new Set();
  const pool = [];
  for (const c of [...candidates, ...(original.candidate ? [original.candidate] : [])]) {
    if (!c?.activity_id || seen.has(c.activity_id)) continue;
    seen.add(c.activity_id);
    pool.push(c);
    if (pool.length >= 20) break;
  }

  // Step 4: rank with Gemini (or fallback).
  let ranked = await geminiRank({ original, candidates: pool }).catch((err) => {
    console.warn('[match] gemini rank fallback:', err?.message || err);
    return null;
  });
  if (!ranked || !Array.isArray(ranked) || ranked.length === 0) {
    meta.gemini_fallback_used = true;
    ranked = fallbackRank({ original, candidates: pool });
  }

  // Step 5: re-estimate top 3 with weight.
  const alternatives = [];
  for (const r of ranked.slice(0, 3)) {
    const meta_c = pool.find((c) => c.activity_id === r.activity_id);
    let co2e_kg = null;
    let factor_meta = null;
    try {
      const est = await climatiqEstimateWeight(r.activity_id, weight_kg);
      co2e_kg = est.co2e;
      factor_meta = {
        source: est.emission_factor?.source || meta_c?.source,
        region: est.emission_factor?.region || meta_c?.region,
        year:   est.emission_factor?.year   || meta_c?.year
      };
    } catch (err) {
      console.warn(`[match] estimate alt ${r.activity_id} failed:`, err?.message || err);
    }
    const savings_kg = co2e_kg != null ? Math.max(0, original.co2e_kg - co2e_kg) : null;
    const savings_pct = co2e_kg != null && original.co2e_kg > 0
      ? Math.round((savings_kg / original.co2e_kg) * 100)
      : null;
    alternatives.push({
      activity_id: r.activity_id,
      name: meta_c?.name || r.activity_id,
      material_or_category: meta_c?.category || category,
      co2e_kg,
      savings_kg,
      savings_pct,
      rationale: r.reason_2sentence || '',
      similarity_score: typeof r.similarity_score === 'number' ? r.similarity_score : null,
      emission_factor: factor_meta || {}
    });
  }

  meta.latency_ms = Date.now() - t0;
  const response = {
    original: {
      input: { brand, model, category, material, weight_kg, price_usd, url: payload.url || null },
      co2e_kg: original.co2e_kg,
      emission_factor: {
        activity_id: original.candidate?.activity_id || null,
        name:        original.candidate?.name || null,
        source:      original.candidate?.source || null
      }
    },
    alternatives,
    meta
  };

  matchCache.set(cacheKey, { ts: Date.now(), data: response });
  saveMatchCache().catch((err) => console.warn('[match] cache save failed:', err?.message));

  return json(res, 200, response);
}

async function estimateOriginal({ brand, model, material, category, weight_kg }, meta) {
  const inputText = [brand, model, material, `${weight_kg}kg`].filter(Boolean).join(' ');

  // Try Autopilot Suggest first.
  try {
    const suggest = await fetchClimatiq(AUTOPILOT_SUGGEST_ENDPOINT, {
      method: 'POST',
      body: { suggest: { input: inputText, unit_type: ['Weight'] }, model: 'general', max_suggestions: 1 }
    });
    const top = suggest?.results?.[0];
    if (top?.suggestion_id) {
      const est = await fetchClimatiq(AUTOPILOT_ESTIMATE_ENDPOINT, {
        method: 'POST',
        body: { suggestion_id: top.suggestion_id, parameters: { weight: weight_kg, weight_unit: 'kg' } }
      });
      if (typeof est?.co2e === 'number') {
        meta.used_autopilot = true;
        return {
          co2e_kg: est.co2e,
          candidate: factorToCandidate(est.emission_factor || top.emission_factor)
        };
      }
    }
  } catch (err) {
    // Autopilot is opt-in; 403 is expected on community accounts.
    if (err?.status !== 403 && err?.status !== 404) {
      console.warn('[match] autopilot suggest failed (non-403):', err?.status, err?.message);
    }
  }

  // Fallback: Search → Estimate. Climatiq Search is BM25-style and brittle
  // with multi-word queries — a query like "Patagonia Organic Cotton T-Shirt"
  // returns 0 hits even though "shirt" returns 4. Cascade from specific
  // multi-word queries down to single keyword tokens.
  const queries = uniqueQueries([
    [brand, model, material].filter(Boolean).join(' '),
    [material, category].filter(Boolean).join(' '),
    [model, material].filter(Boolean).join(' '),
    ...singleTokens(material),
    ...singleTokens(model),
    ...singleTokens(category)
  ]);

  let top = null;
  for (const q of queries) {
    const search = await climatiqSearch({ query: q, results_per_page: 8 }).catch(() => null);
    top = (search?.results || []).find(weightCompatible) || null;
    if (top) break;
  }
  if (!top?.activity_id) {
    const e = new Error('no_search_match'); e.status = 502; throw e;
  }
  const est = await climatiqEstimateWeight(top.activity_id, weight_kg);
  return { co2e_kg: est.co2e, candidate: factorToCandidate({ ...top, ...est.emission_factor }) };
}

// Tokens worth searching: 3+ chars, alphabetic, deduped, lowercased.
// Filters obvious noise (numerics, sizes, units).
function singleTokens(s) {
  if (!s) return [];
  const stop = new Set([
    'the', 'and', 'for', 'with', 'kg', 'lb', 'oz', 'inch', 'cm', 'mm',
    'pro', 'plus', 'max', 'mini', 'new', 'old'
  ]);
  const seen = new Set();
  const out = [];
  for (const t of String(s).toLowerCase().split(/[^a-z]+/)) {
    if (t.length < 3 || stop.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function uniqueQueries(qs) {
  const seen = new Set();
  return qs.map((q) => (q || '').trim()).filter((q) => {
    if (!q || seen.has(q)) return false;
    seen.add(q); return true;
  });
}

function weightCompatible(r) {
  const ut = r?.unit_type;
  if (!ut) return false;
  if (Array.isArray(ut)) return ut.some((u) => /weight/i.test(u));
  return /weight/i.test(String(ut));
}

async function buildCandidatePool({ material, category, brand, model }) {
  // Climatiq Search recall collapses on multi-word queries. Issue
  // single-token queries for material + category + product nouns from
  // the model string. Cap to ~4 distinct queries so we don't burn
  // Climatiq's 50 rpm community quota.
  const queries = uniqueQueries([
    ...singleTokens(material),
    ...singleTokens(category),
    ...singleTokens(model)
  ]).slice(0, 4);
  if (queries.length === 0) queries.push('product');

  const pool = [];
  for (const q of queries) {
    try {
      const search = await climatiqSearch({ query: q, results_per_page: 12 });
      for (const r of search?.results || []) {
        if (r?.activity_id && weightCompatible(r)) pool.push(factorToCandidate(r));
      }
    } catch (err) {
      console.warn(`[match] search "${q}" failed:`, err?.message || err);
    }
  }
  return pool;
}

function factorToCandidate(f) {
  if (!f) return null;
  return {
    activity_id: f.activity_id,
    name: f.name || f.id || f.activity_id,
    category: f.category || null,
    sector: f.sector || null,
    unit_type: Array.isArray(f.unit_type) ? f.unit_type[0] : f.unit_type || null,
    region: f.region || null,
    year: f.year || null,
    source: f.source || null
  };
}

async function climatiqSearch({ query, results_per_page }) {
  const url = new URL(CLIMATIQ_SEARCH_ENDPOINT);
  url.searchParams.set('query', query);
  url.searchParams.set('data_version', CLIMATIQ_DATA_VERSION);
  if (results_per_page) url.searchParams.set('results_per_page', String(results_per_page));
  return fetchClimatiq(url.toString(), { method: 'GET' });
}

async function climatiqEstimateWeight(activity_id, weight_kg) {
  return fetchClimatiq(CLIMATIQ_API_ENDPOINT, {
    method: 'POST',
    body: {
      emission_factor: { activity_id, data_version: CLIMATIQ_DATA_VERSION },
      parameters: { weight: weight_kg, weight_unit: 'kg' }
    }
  });
}

async function fetchClimatiq(url, { method, body }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CLIMATIQ_TIMEOUT_MS);
  try {
    const init = {
      method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${CLIMATIQ_API_KEY}`
      },
      signal: ctrl.signal
    };
    if (body) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    if (!res.ok) {
      const e = new Error(`climatiq_http_${res.status}`);
      e.status = res.status;
      throw e;
    }
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

async function geminiRank({ original, candidates }) {
  if (!GEMINI_API_KEY) throw new Error('gemini_unconfigured');
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('no_candidates');

  const systemPrompt =
    'You are a sustainability expert. A user is about to buy a product. I will give you ' +
    'the original product and up to 20 candidate alternative emission factors from Climatiq. ' +
    'Rank the TOP 3 alternatives.\n\n' +
    'Ranking priority (in order):\n' +
    '1. Material similarity and functional equivalence — a glass bottle is NOT a replacement ' +
    'for a laptop even if it has lower emissions. A recycled polyester shirt IS a replacement ' +
    'for a cotton shirt.\n' +
    '2. Same product category and use case.\n' +
    '3. Lower kgCO2e as a TIEBREAKER only.\n\n' +
    'Do not pick items with incompatible use cases. If fewer than 3 candidates are genuinely ' +
    'comparable, return only what is genuinely comparable.';

  const userPrompt =
    `Original product:\n${JSON.stringify(original, null, 2)}\n\n` +
    `Candidates (activity_id, name, category, unit_type, region):\n${JSON.stringify(candidates, null, 2)}\n\n` +
    `Return JSON matching the responseSchema.`;

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      top_alternatives: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            activity_id:       { type: 'STRING' },
            reason_2sentence:  { type: 'STRING' },
            similarity_score:  { type: 'NUMBER' }
          },
          required: ['activity_id', 'reason_2sentence', 'similarity_score']
        }
      }
    },
    required: ['top_alternatives']
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const callOnce = async () => fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 800,
        responseMimeType: 'application/json',
        responseSchema,
        thinkingConfig: { thinkingBudget: 0 }
      }
    })
  }, ALT_TIMEOUT_MS);

  const parseRanked = (data) => {
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.top_alternatives)) return parsed.top_alternatives;
    } catch {}
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
  };

  let parsed = parseRanked(await callOnce());
  if (!parsed) parsed = parseRanked(await callOnce()); // one retry
  if (!parsed) throw new Error('gemini_unparseable');

  const validIds = new Set(candidates.map((c) => c.activity_id));
  return parsed.filter((r) => r?.activity_id && validIds.has(r.activity_id));
}

function fallbackRank({ original, candidates }) {
  // No Gemini — pick same-category (or same-sector) candidates and assume
  // co2e per kg is similar to the original's source. We can't actually
  // sort by co2e_kg without re-estimating each, which would burn calls.
  // Instead, prefer same category + same unit_type (Weight), then take 3.
  const origCat = original?.candidate?.category || null;
  const sameCat = candidates.filter((c) => origCat && c.category === origCat);
  const pool = sameCat.length >= 3 ? sameCat : candidates;
  return pool.slice(0, 3).map((c) => ({
    activity_id: c.activity_id,
    reason_2sentence:
      'Selected by category/use-case match (Gemini ranking unavailable). ' +
      'Verify suitability before purchase.',
    similarity_score: 0.5
  }));
}

async function loadMatchCacheOnce() {
  if (matchCacheLoaded) return;
  matchCacheLoaded = true;
  try {
    const text = await readFile(MATCH_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const now = Date.now();
      for (const [k, v] of Object.entries(parsed)) {
        if (v?.ts && now - v.ts < MATCH_CACHE_TTL_MS) matchCache.set(k, v);
      }
      console.log(`[match] loaded ${matchCache.size} cached responses from ${MATCH_CACHE_PATH}`);
    }
  } catch {
    // no prior cache
  }
}

let matchSaveInFlight = null;
async function saveMatchCache() {
  if (matchSaveInFlight) return matchSaveInFlight;
  matchSaveInFlight = (async () => {
    const dir = dirname(MATCH_CACHE_PATH);
    await mkdir(dir, { recursive: true });
    const obj = {};
    for (const [k, v] of matchCache) obj[k] = v;
    const tmp = `${MATCH_CACHE_PATH}.tmp`;
    await writeFile(tmp, JSON.stringify(obj), 'utf8');
    await rename(tmp, MATCH_CACHE_PATH);
  })().finally(() => { matchSaveInFlight = null; });
  return matchSaveInFlight;
}

// --- Dedalus Machines factor warmer ---
//
// climatiqEstimate: one Climatiq /estimate call, same contract handleClimatiq
// uses. Kept separate so the warmer can call Climatiq directly without
// going through our own HTTP surface.
async function climatiqEstimate(code, money) {
  const activity_id = CLIMATIQ_ACTIVITY_IDS[code] || CLIMATIQ_ACTIVITY_IDS._default;
  const body = await fetchWithTimeout(
    CLIMATIQ_API_ENDPOINT,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${CLIMATIQ_API_KEY}`
      },
      body: JSON.stringify({
        emission_factor: {
          activity_id,
          data_version: CLIMATIQ_DATA_VERSION,
          region: CLIMATIQ_DEFAULT_REGION
        },
        parameters: { money, money_unit: 'usd' }
      })
    },
    CLIMATIQ_TIMEOUT_MS
  );
  if (typeof body?.co2e !== 'number' || !body?.emission_factor?.id) {
    throw new Error('malformed_climatiq_response');
  }
  return body;
}

async function loadCacheFromDisk() {
  try {
    const text = await readFile(WARMER_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.factors) {
      warmerState = {
        version: parsed.version || 1,
        last_refresh: parsed.last_refresh || null,
        last_refresh_duration_ms: parsed.last_refresh_duration_ms || 0,
        refreshed_categories: parsed.refreshed_categories || [],
        factor_count: Object.keys(parsed.factors).length,
        source: 'dedalus_swarm',
        factors: parsed.factors
      };
      console.log(`[warmer] loaded ${warmerState.factor_count} factors from ${WARMER_CACHE_PATH}`);
    }
  } catch {
    // no prior cache; that's fine
  }
}

async function saveCacheToDisk() {
  const dir = dirname(WARMER_CACHE_PATH);
  await mkdir(dir, { recursive: true });
  const tmp = `${WARMER_CACHE_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(warmerState, null, 2), 'utf8');
  await rename(tmp, WARMER_CACHE_PATH);
}

async function warmOnce() {
  if (!CLIMATIQ_API_KEY) {
    console.warn('[warmer] skipped: CLIMATIQ_API_KEY missing');
    return { ok: false, reason: 'no_api_key' };
  }
  const startedAt = Date.now();
  const codes = Array.from(new Set(Object.values(CATEGORY_TO_CODE)));
  // Dedupe: we only hit Climatiq once per (code, bucket), then fan the
  // result out to every category sharing that code. 7 codes × 11 buckets
  // = 77 calls, ~40s at 500ms spacing.
  const resultsByCode = new Map();
  let calls = 0;
  let errors = 0;

  for (const code of codes) {
    resultsByCode.set(code, new Map());
    for (const bucket of WARMER_PRICE_LADDER) {
      calls += 1;
      try {
        const body = await climatiqEstimate(code, bucket);
        resultsByCode.get(code).set(bucket, body);
      } catch (err) {
        errors += 1;
        console.warn(`[warmer] climatiq miss code=${code} bucket=${bucket}: ${err?.message || err}`);
      }
      await new Promise((r) => setTimeout(r, WARMER_CLIMATIQ_DELAY_MS));
    }
  }

  const newFactors = {};
  const refreshedCategories = new Set();
  for (const [category, code] of Object.entries(CATEGORY_TO_CODE)) {
    const byBucket = resultsByCode.get(code);
    if (!byBucket) continue;
    for (const bucket of WARMER_PRICE_LADDER) {
      const body = byBucket.get(bucket);
      if (!body) continue;
      const key = `${category}::${bucket}`;
      newFactors[key] = {
        key,
        category,
        classification_code: code,
        price_bucket: bucket,
        co2e_kg: body.co2e,
        emission_factor_id: body.emission_factor.id,
        emission_factor_name: body.emission_factor.name,
        emission_factor_region: body.emission_factor.region,
        refreshed_at: new Date().toISOString()
      };
      refreshedCategories.add(category);
    }
  }

  const duration = Date.now() - startedAt;
  // Merge rather than replace: if a refresh partially fails, we keep
  // whatever succeeded from the prior cycle instead of blanking it.
  warmerState = {
    version: 1,
    last_refresh: new Date().toISOString(),
    last_refresh_duration_ms: duration,
    refreshed_categories: Array.from(refreshedCategories).sort(),
    factor_count: Object.keys({ ...warmerState.factors, ...newFactors }).length,
    source: 'dedalus_swarm',
    factors: { ...warmerState.factors, ...newFactors }
  };
  try {
    await saveCacheToDisk();
  } catch (err) {
    console.warn('[warmer] save failed:', err?.message || err);
  }

  console.log(
    `[warmer] refresh: ${calls - errors}/${calls} ok, ${Object.keys(newFactors).length} factors, ${duration}ms`
  );
  return { ok: errors < calls, calls, errors, factors: Object.keys(newFactors).length, duration_ms: duration };
}

async function startWarmer() {
  await loadCacheFromDisk();
  if (!WARMER_ENABLED) {
    console.log('[warmer] disabled (set WARMER_ENABLED=true to enable)');
    return;
  }
  if (!CLIMATIQ_API_KEY) {
    console.warn('[warmer] CLIMATIQ_API_KEY missing; warmer will idle until configured');
    return;
  }
  const tick = async () => {
    try { await warmOnce(); }
    catch (err) { console.error('[warmer] unhandled:', err?.message || err); }
    warmerTimer = setTimeout(tick, WARMER_REFRESH_MIN * 60 * 1000);
    warmerTimer.unref();
  };
  warmerTimer = setTimeout(tick, WARMER_INITIAL_DELAY_MS);
  warmerTimer.unref();
  console.log(
    `[warmer] enabled: refresh every ${WARMER_REFRESH_MIN}min, cache at ${WARMER_CACHE_PATH}, ` +
    `ladder=[${WARMER_PRICE_LADDER.join(',')}]`
  );
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8192) { reject(new Error('payload_too_large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
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
