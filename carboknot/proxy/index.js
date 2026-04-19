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
const CORPUS_DB_PATH = process.env.CORPUS_DB_PATH || resolve(__dirname, 'data', 'corpus.db');

const REASON_TIMEOUT_MS = 4000;
const CLIMATIQ_TIMEOUT_MS = 4000;
const STARTED_AT = Date.now();

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
  apparel_tops:      '14',
  apparel_bottoms:   '14',
  footwear:          '15',
  home_goods:        '20',
  beauty:            '20',
  books:             '18',
  food_packaged:     '10',
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
  '26': 'electronics-type_electronic_computer',
  '32': 'consumer_goods-type_doll_toy_and_game_manufacturing',
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
    if (req.method === 'POST' && url.pathname === '/api/confirm') return handleConfirm(req, res);
    if (req.method === 'GET'  && url.pathname === '/api/stats')   return handleStats(res);

    return json(res, 404, { error: 'not_found', path: url.pathname });
  } catch (err) {
    console.error('[proxy] unhandled', err?.name, err?.message);
    return json(res, 500, { error: 'internal_error' });
  }
});

server.listen(PORT, () => {
  console.log(`[Carboknot proxy] listening on :${PORT}`);
  console.log(`[Carboknot proxy] dedalus key: ${DEDALUS_API_KEY ? 'set' : 'MISSING'}`);
  console.log(`[Carboknot proxy] climatiq key: ${CLIMATIQ_API_KEY ? 'set' : 'MISSING'}`);
  console.log(`[Carboknot proxy] CORS origins: ${ALLOWED_ORIGINS.join(', ') || '(none set)'}`);
  startWarmer().catch((err) => console.error('[warmer] boot failed:', err?.message || err));
});

// --- route handlers ---

function handleHealth(res) {
  return json(res, 200, {
    ok: true,
    uptime_s: Math.floor((Date.now() - STARTED_AT) / 1000),
    now: new Date().toISOString(),
    gemini_key: GEMINI_API_KEY ? 'set' : 'missing',
    dedalus_key: DEDALUS_API_KEY ? 'set' : 'missing',
    climatiq_key: CLIMATIQ_API_KEY ? 'set' : 'missing',
    corpus: corpusDb ? { ok: true } : { ok: false, reason: 'sqlite_unavailable' },
    warmer: {
      enabled: WARMER_ENABLED,
      last_refresh: warmerState.last_refresh,
      factor_count: warmerState.factor_count,
      refresh_interval_min: WARMER_REFRESH_MIN
    }
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

  // 1. Try Gemini (key in URL query param, not Authorization header)
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

  // 2. Try Dedalus LLM
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
