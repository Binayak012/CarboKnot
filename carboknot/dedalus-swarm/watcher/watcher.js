// Carboknot Dedalus Swarm — Watcher agent.
//
// Runs long-running on Dedalus Machine 1.
// Responsibilities:
//   1. Poll Climatiq data-versions every WATCH_INTERVAL_MS. If the data
//      version changed or a category's cache is older than STALE_MS,
//      refetch emission factors for that category.
//   2. Every ENRICHER_PULL_MS, pull enrichment-results.json from the
//      Enricher Machine's HTTP endpoint and merge new classifications
//      into the cache.
//   3. Expose three HTTP routes on PORT:
//        GET /health         → { ok, uptime_s }
//        GET /cache-status   → { last_refresh, refreshed_categories }
//        GET /cache          → full cache JSON
//
// State persists to watcher-state.json on the VM's persistent disk.
//
// Environment:
//   CLIMATIQ_API_KEY        required
//   ENRICHER_ORIGIN         e.g. http://<enricher-internal-ip>:8080
//   PORT                    default 8080
//   WATCH_INTERVAL_MS       default 10 * 60 * 1000  (10 min)
//   ENRICHER_PULL_MS        default 5 * 60 * 1000   (5 min)
//   STALE_MS                default 7 * 24 * 60 * 60 * 1000  (7 days)

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
await loadEnvFile(resolve(__dirname, '.env')).catch(() => {});

const CLIMATIQ_API_KEY = process.env.CLIMATIQ_API_KEY || '';
const ENRICHER_ORIGIN = (process.env.ENRICHER_ORIGIN || '').replace(/\/+$/, '');
const PORT = Number(process.env.PORT) || 8080;
const WATCH_INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS) || 10 * 60 * 1000;
const ENRICHER_PULL_MS = Number(process.env.ENRICHER_PULL_MS) || 5 * 60 * 1000;
const STALE_MS = Number(process.env.STALE_MS) || 7 * 24 * 60 * 60 * 1000;
const STATE_PATH = resolve(__dirname, 'watcher-state.json');
const STARTED_AT = Date.now();

// Categories the watcher keeps warm. Mirrors carboknot/extension/src/engine/lca.json.
const CATEGORIES = [
  'audio_electronics',
  'laptops',
  'apparel_bottoms',
  'footwear',
  'home_goods',
  'general'
];

/** @type {{ data_version: string | null, last_refresh: string | null, cache: Record<string, { refreshed_at: string, kg_per_usd: number, source: string }>, enrichments: Record<string, string> }} */
let state = {
  data_version: null,
  last_refresh: null,
  cache: {},
  enrichments: {}
};

await loadState();

log('started', {
  climatiq_key: CLIMATIQ_API_KEY ? 'set' : 'MISSING',
  enricher_origin: ENRICHER_ORIGIN || 'MISSING',
  port: PORT
});

// --- HTTP server ---
const server = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/health') {
    return res.end(JSON.stringify({ ok: true, uptime_s: Math.floor((Date.now() - STARTED_AT) / 1000) }));
  }
  if (url.pathname === '/cache-status') {
    return res.end(JSON.stringify({
      last_refresh: state.last_refresh,
      refreshed_categories: Object.keys(state.cache),
      data_version: state.data_version,
      enrichment_count: Object.keys(state.enrichments).length
    }));
  }
  if (url.pathname === '/cache') {
    return res.end(JSON.stringify({
      last_refresh: state.last_refresh,
      data_version: state.data_version,
      cache: state.cache,
      enrichments: state.enrichments
    }));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not_found' }));
});
server.listen(PORT, () => log('listening', { port: PORT }));

// --- Climatiq watch loop ---
async function watchLoop() {
  try {
    const latest = await fetchJson('https://api.climatiq.io/data/v1/data-versions', {
      headers: { authorization: `Bearer ${CLIMATIQ_API_KEY}` }
    });
    const newest = latest?.latest_release || latest?.data_version || null;
    const stale = Object.entries(state.cache).filter(
      ([, v]) => (Date.now() - Date.parse(v.refreshed_at)) > STALE_MS
    ).map(([c]) => c);
    const missing = CATEGORIES.filter((c) => !state.cache[c]);
    const changed = newest && newest !== state.data_version;

    if (changed || stale.length || missing.length) {
      log('refresh_triggered', { changed, stale: stale.length, missing: missing.length });
      const categoriesToRefresh = changed ? CATEGORIES : [...new Set([...stale, ...missing])];
      for (const cat of categoriesToRefresh) {
        try {
          const ef = await lookupClimatiqForCategory(cat);
          state.cache[cat] = {
            refreshed_at: new Date().toISOString(),
            kg_per_usd: ef.kg_per_usd,
            source: ef.source
          };
        } catch (err) {
          log('category_refresh_failed', { category: cat, err: err?.message || String(err) });
        }
      }
      state.data_version = newest;
      state.last_refresh = new Date().toISOString();
      await saveState();
    } else {
      log('up_to_date', { data_version: newest });
    }
  } catch (err) {
    log('watch_loop_error', { err: err?.message || String(err) });
  }
}

// Minimal Climatiq lookup per category. Uses a hard-coded representative
// activity id + price anchor per category. Treats kg_per_usd as the
// derived proxy factor the extension engine consumes.
const CATEGORY_TO_CLIMATIQ = {
  audio_electronics:   { activity_id: 'consumer_goods-type_consumer_electronics',        anchor_usd: 350 },
  laptops:             { activity_id: 'consumer_goods-type_computers_peripherals',       anchor_usd: 1100 },
  apparel_bottoms:     { activity_id: 'consumer_goods-type_clothing_apparel',            anchor_usd: 70  },
  footwear:            { activity_id: 'consumer_goods-type_footwear',                    anchor_usd: 110 },
  home_goods:          { activity_id: 'consumer_goods-type_cleaning_products',           anchor_usd: 20  },
  general:             { activity_id: 'consumer_goods-type_general_retail',              anchor_usd: 50  }
};

async function lookupClimatiqForCategory(category) {
  const cfg = CATEGORY_TO_CLIMATIQ[category];
  if (!cfg) throw new Error(`no_climatiq_mapping_for_${category}`);
  const body = {
    emission_factor: { activity_id: cfg.activity_id, data_version: state.data_version || '^21' },
    parameters: { money: cfg.anchor_usd, money_unit: 'usd' }
  };
  const resp = await fetchJson('https://api.climatiq.io/data/v1/estimate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${CLIMATIQ_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  }).catch((err) => { throw new Error(`climatiq_${err.message}`); });

  const kg = Number(resp?.co2e);
  if (!Number.isFinite(kg)) throw new Error('climatiq_no_co2e');
  return {
    kg_per_usd: kg / cfg.anchor_usd,
    source: `Climatiq ${resp?.emission_factor?.source || ''} ${resp?.emission_factor?.year || ''}`.trim()
  };
}

// --- Enricher pull loop ---
async function enricherLoop() {
  if (!ENRICHER_ORIGIN) return;
  try {
    const body = await fetchJson(`${ENRICHER_ORIGIN}/enrichments`, {
      headers: { accept: 'application/json' }
    });
    const results = body?.results || {};
    let merged = 0;
    for (const [title, isic] of Object.entries(results)) {
      if (typeof isic === 'string' && isic && state.enrichments[title] !== isic) {
        state.enrichments[title] = isic;
        merged += 1;
      }
    }
    if (merged > 0) {
      log('received_enrichments', { count: merged });
      state.last_refresh = new Date().toISOString();
      await saveState();
    }
  } catch (err) {
    log('enricher_pull_failed', { err: err?.message || String(err) });
  }
}

setInterval(watchLoop, WATCH_INTERVAL_MS).unref();
setInterval(enricherLoop, ENRICHER_PULL_MS).unref();
watchLoop();
enricherLoop();

// --- utils ---

async function fetchJson(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

async function loadState() {
  try {
    const text = await readFile(STATE_PATH, 'utf8');
    state = { ...state, ...JSON.parse(text) };
    log('state_loaded', { categories: Object.keys(state.cache).length });
  } catch { /* fresh start */ }
}

async function saveState() {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

function log(event, extra) {
  console.log(JSON.stringify({ t: new Date().toISOString(), agent: 'watcher', event, ...extra }));
}

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
