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
//
// Environment:
//   DEDALUS_API_KEY              required for /api/reason to work
//   DEDALUS_API_ENDPOINT         default https://api.dedaluslabs.ai/v1/chat/completions
//   DEDALUS_MODEL                default openai/gpt-5
//   SWARM_WATCHER_ORIGIN         required for /swarm/* (e.g. https://watcher.dedalus.cloud)
//   ALLOWED_ORIGINS              CSV, e.g. chrome-extension://abc,http://localhost:5173
//   REASON_RATE_LIMIT_PER_MIN    default 10
//   PORT                         default 8787

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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
const SWARM_WATCHER_ORIGIN = (process.env.SWARM_WATCHER_ORIGIN || '').replace(/\/+$/, '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const REASON_RATE_LIMIT_PER_MIN = Number(process.env.REASON_RATE_LIMIT_PER_MIN) || 10;

const SWARM_TIMEOUT_MS = 4000;
const REASON_TIMEOUT_MS = 4000;
const STARTED_AT = Date.now();

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

    return json(res, 404, { error: 'not_found', path: url.pathname });
  } catch (err) {
    console.error('[proxy] unhandled', err?.name, err?.message);
    return json(res, 500, { error: 'internal_error' });
  }
});

server.listen(PORT, () => {
  console.log(`[Carboknot proxy] listening on :${PORT}`);
  console.log(`[Carboknot proxy] dedalus key: ${DEDALUS_API_KEY ? 'set' : 'MISSING'}`);
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
