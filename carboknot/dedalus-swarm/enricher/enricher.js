// Carboknot Dedalus Swarm — Enricher agent.
//
// Runs long-running on Dedalus Machine 2.
// Responsibilities:
//   1. Every ENRICH_INTERVAL_MS, read uncategorized-queue.json and classify
//      each pending product title via the Dedalus LLM API. Writes results
//      to enrichment-results.json, which the Watcher pulls from the HTTP
//      endpoint below.
//   2. Expose HTTP routes on PORT:
//        GET  /health          → { ok, uptime_s }
//        GET  /enrichments     → { results: { <title>: <category> } }
//        POST /enqueue         → append a title to the pending queue.
//                                Accepts { titles: string[] }.
//
// The category labels are ISIC-style short tokens matching
// carboknot/extension/src/engine/lca.json:
//   audio_electronics, laptops, apparel_bottoms, footwear, home_goods, general
//
// Environment:
//   DEDALUS_API_KEY         required
//   DEDALUS_API_ENDPOINT    default https://api.dedaluslabs.ai/v1/chat/completions
//   DEDALUS_MODEL           default openai/gpt-5
//   PORT                    default 8080
//   ENRICH_INTERVAL_MS      default 120000  (2 min)

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
await loadEnvFile(resolve(__dirname, '.env')).catch(() => {});

const DEDALUS_API_KEY = process.env.DEDALUS_API_KEY || '';
const DEDALUS_API_ENDPOINT =
  process.env.DEDALUS_API_ENDPOINT || 'https://api.dedaluslabs.ai/v1/chat/completions';
const DEDALUS_MODEL = process.env.DEDALUS_MODEL || 'openai/gpt-5';
const PORT = Number(process.env.PORT) || 8080;
const ENRICH_INTERVAL_MS = Number(process.env.ENRICH_INTERVAL_MS) || 120000;
const QUEUE_PATH = resolve(__dirname, 'uncategorized-queue.json');
const RESULTS_PATH = resolve(__dirname, 'enrichment-results.json');
const STARTED_AT = Date.now();

const CATEGORIES = ['audio_electronics', 'laptops', 'apparel_bottoms', 'footwear', 'home_goods', 'general'];

let queue = [];
let results = {};

await loadFiles();
log('started', {
  dedalus_key: DEDALUS_API_KEY ? 'set' : 'MISSING',
  model: DEDALUS_MODEL,
  queue_size: queue.length,
  known_results: Object.keys(results).length
});

// --- HTTP ---
const server = createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    return res.end(JSON.stringify({ ok: true, uptime_s: Math.floor((Date.now() - STARTED_AT) / 1000) }));
  }
  if (req.method === 'GET' && url.pathname === '/enrichments') {
    return res.end(JSON.stringify({ results, pending: queue.length }));
  }
  if (req.method === 'POST' && url.pathname === '/enqueue') {
    try {
      const body = await readJson(req);
      const titles = Array.isArray(body?.titles) ? body.titles.filter((s) => typeof s === 'string') : [];
      for (const t of titles) if (!queue.includes(t) && !results[t]) queue.push(t);
      await saveQueue();
      return res.end(JSON.stringify({ ok: true, queue_size: queue.length }));
    } catch (err) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'bad_payload' }));
    }
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not_found' }));
});
server.listen(PORT, () => log('listening', { port: PORT }));

// --- Enrichment loop ---
async function enrichLoop() {
  if (queue.length === 0) return;
  if (!DEDALUS_API_KEY) { log('skip_no_key'); return; }

  const batch = queue.splice(0, 10);
  log('enrich_batch_start', { size: batch.length });

  for (const title of batch) {
    try {
      const cat = await classifyWithDedalus(title);
      if (CATEGORIES.includes(cat)) {
        results[title] = cat;
        log('classified', { category: cat });
      } else {
        results[title] = 'general';
        log('classified_fallback_general', { raw: cat });
      }
    } catch (err) {
      queue.push(title);
      log('classify_failed', { err: err?.message || String(err) });
    }
  }
  await saveResults();
  await saveQueue();
}

async function classifyWithDedalus(title) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(DEDALUS_API_ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        authorization: `Bearer ${DEDALUS_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: DEDALUS_MODEL,
        messages: [
          {
            role: 'system',
            content:
              `You are a product classifier. Respond with exactly one token from this list and nothing else: ${CATEGORIES.join(', ')}. ` +
              `Map the product to the best match. If unsure, say general.`
          },
          { role: 'user', content: `Classify: "${title}"` }
        ],
        max_tokens: 10,
        temperature: 0
      })
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const body = await res.json();
    const raw = body?.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
    return raw.split(/\s+/)[0].replace(/[^a-z_]/g, '');
  } finally {
    clearTimeout(t);
  }
}

setInterval(enrichLoop, ENRICH_INTERVAL_MS).unref();
enrichLoop();

// --- utils ---

async function loadFiles() {
  try { queue = JSON.parse(await readFile(QUEUE_PATH, 'utf8')); } catch { queue = []; }
  try { results = JSON.parse(await readFile(RESULTS_PATH, 'utf8')); } catch { results = {}; }
}
async function saveQueue()   { await writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2)); }
async function saveResults() { await writeFile(RESULTS_PATH, JSON.stringify(results, null, 2)); }

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 65536) { reject(new Error('too_large')); req.destroy(); return; }
      data += c;
    });
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function log(event, extra) {
  console.log(JSON.stringify({ t: new Date().toISOString(), agent: 'enricher', event, ...extra }));
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
