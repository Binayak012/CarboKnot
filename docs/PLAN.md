# Carboknot — Final Locked Plan

> **This replaces every previous doc. Read this one. Reference this one.**
> Authored by Rahul. If anything in this plan conflicts with reality on disk, trust the disk — ask Cursor to reconcile; do not edit code based on what this plan says should exist.

---

## The shape of what you're shipping

**Frontend:** Chrome extension. Generic product-page extractor (schema.org / OpenGraph / microdata) plus 5 custom adapters (Amazon, eBay, Walmart, Target, Best Buy). Badge on product page → click opens panel → panel shows breakdown + interpretability trace + three alternatives + "Why is this lower carbon?" button. Dashboard in a new tab shows trend, budget ring, top categories, recent views, and a live "privacy receipt" section.

**Carbon numbers:** Climatiq API via `/classifications/v1/estimate` (spend-based, EXIOBASE). Cache-on-first-fetch: first time you see a new category/price bucket, one API call fires. Every subsequent view of that bucket is local. Cache lives in IndexedDB.

**Reasoning** (the "Why is this lower carbon?" button): Dedalus LLM API (`api.dedaluslabs.ai/v1/chat/completions`, model `openai/gpt-5`). User-triggered, one call per click.

**Proxy:** Hosted on Render (Node/Hono, HTTPS, always-on). Holds Climatiq key and Dedalus key. Endpoints: `/api/climatiq`, `/api/reason`, `/health`.

**Dedalus Machine:** runs a scheduled job that pre-warms the Climatiq cache for the 20 most-common demo product categories. Legitimate Dedalus Machines usage, claimable in the "best containers" submission as cache-warming infrastructure.

---

## The locked pitch

You are **no longer a zero-trust app**. You are a **data-first carbon receipt with minimal disclosed sharing**.

**One-line:** Carboknot turns every product page into a carbon receipt — with real peer-reviewed LCA data, minimal disclosed data sharing, and computation that gets fully local as you use it.

**Three-sentence Devpost description:** Every sustainability app today either uses generic category averages or sends your entire browsing history to servers you don't control. Carboknot does neither. We call Climatiq once per product category/price you've never seen, cache the result locally, and never call again — your footprint calculation gets progressively more local with every day of use, and the only thing we send is a classification code and a price.

**Telora business-model paragraph (Devpost):** Carboknot is a consumer wedge for decision intelligence infrastructure. The same classification engine that tells a shopper a $349 headphone costs ~42 kg CO2e can tell a procurement officer what a vendor switch costs in scope-3 emissions, or tell a university what a supplier change costs across twelve sustainability metrics. Consumer funnel feeds B2B API. The architecture is the product.

**New Beat 5 of the demo (memorize word-for-word):**
> "Watch this. I'll visit a product I've never looked at before. DevTools network tab — one request to our Render proxy, which forwards a classification code and a price to Climatiq, returns peer-reviewed LCA data, 300 milliseconds. Now I refresh the same page. Zero requests. That product is cached locally forever. The only thing that ever left my laptop was a category code and a dollar amount. No title, no identity, no browsing history. Over a week of normal use, your cache warms up and you're running almost fully offline."

---

## Sponsor stack, final

- **Telora ($40K)** — pitch framing, Devpost paragraph locked above. Primary target.
- **Dedalus Labs** — two angles:
  - LLM API powers the "Why is this lower carbon?" reasoning feature.
  - Dedalus Machine runs cache-warming job (partial "best containers" claim, $1000 pool).
- **Climatiq** — not a hackathon sponsor, cite prominently in methodology for credibility.
- **Orchids ($300 / $200)** — stretch, mention if dashboard looks premium.

**Drop:** d_model, K2 Think (replaced by Dedalus LLM), KnotAPI, Photon, Regeneron, Eragon, Gemini.

---

## The architecture, one diagram in words

```
[Browser extension]
  ├─ Content script (on any product page)
  │    └─ adapter cascade: amazon → ebay → walmart → target → bestbuy → generic(schema/OG/microdata)
  │         └─ computeCarbonWithClimatiq(title, price, category)
  │              ├─ check IndexedDB cache [category::price_bucket]
  │              ├─ HIT  → return cached, tag "Climatiq-backed (cached)"
  │              └─ MISS → chrome.runtime.sendMessage → service worker
  │                            → fetch POST <RENDER_PROXY>/api/climatiq
  │                            → on success: cache + return, tag "Climatiq-backed (fresh)"
  │                            → on failure: fall back to local computeCarbon, tag "Local estimate"
  ├─ Panel (opens on badge click)
  │    └─ "Why is this lower carbon?" button
  │         → chrome.runtime.sendMessage → service worker
  │              → fetch POST <RENDER_PROXY>/api/reason
  │                    → forwards to api.dedaluslabs.ai/v1/chat/completions (model openai/gpt-5)
  │              → display rationale, tag "via Dedalus (GPT-5)"
  └─ Dashboard (new tab)
       └─ reads IndexedDB only
       └─ shows trend / budget / categories / recent views / privacy receipt

[Render proxy]  (Node/Hono, HTTPS, always-on)
  ├─ POST /api/climatiq → https://api.climatiq.io/classifications/v1/estimate (Bearer CLIMATIQ_KEY)
  ├─ POST /api/reason   → https://api.dedaluslabs.ai/v1/chat/completions       (Bearer DEDALUS_KEY)
  ├─ GET  /health
  └─ CORS locked to extension origin, rate limit 60/min, no body logging

[Dedalus Machine]  (persistent VM)
  └─ Scheduled job: warms Climatiq cache for top-20 categories overnight
        → writes to a shared JSON artifact the extension bundles at build time as seed cache
        → this is the "best containers" claim: legitimate container-based background work
```

---

## What changed from Phase 0-3 work

**Preserving:**
- Carbon engine (`carbon.js`, `lca.json`) — stays, becomes fallback path
- Dexie storage (`views`, `audit_log`, `settings` v2) — stays
- Phase 3 dashboard work by Person B — continues unchanged
- Manifest MV3 scaffolding — stays, just broader matches
- Alternatives engine — stays

**Changing:**
- Content script: single dispatcher + adapter pattern instead of two separate files
- Engine: new `computeCarbonWithClimatiq` path wrapping existing `computeCarbon` as fallback
- Storage: new `climatiq_cache` store in `version(3)` migration
- Service worker: new message handlers `climatiq_estimate` and `explain_alternative`
- Proxy: fully implemented, deployed to Render
- Dashboard: new "Privacy receipt" section (Person B's add-on)

**Deleting:**
- `extension/src/content/ebay.js` (logic moves to `adapters/ebay.js`)

**Not touching:**
- `extension/src/dashboard/App.jsx` (Person B owns)
- `extension/src/dashboard/Settings.jsx` (Person B owns)
- `extension/src/dashboard/seed.js` (Person B owns)

---

## Team division, final

- **Rahul (you):** Render deploy, Dedalus Machine setup, Climatiq/Dedalus key management, integration checks, pitch rehearsal, backup video. Own "the proxy works at 8 AM."
- **Person A (Cursor operator):** Runs the one big Cursor prompt below. Verifies Cursor's output. Fixes anything that breaks. Does NOT touch dashboard files — those are Person B's.
- **Person B (dashboard):** Continues Phase 3 dashboard. Adds new "Privacy receipt" section (spec below). Updates Settings modal "Network allowlist" text to new wording.
- **Person C (writer):** Rewrites `docs/METHODOLOGY.md` for the Climatiq-backed approach (one page). Writes the six-slide deck. Rehearses demo script 2x tonight.

---

## The one big Cursor prompt

Copy everything between the triple-backticks into Cursor. One prompt. Runs autonomously. Handles the pivot.

```
You are pivoting Carboknot to Climatiq-with-cache and expanding site coverage. Phase 1-2 content script works. Phase 3 dashboard is in progress by another engineer — DO NOT touch extension/src/dashboard/App.jsx, Settings.jsx, or seed.js.

STRICT RULES:
- pnpm test:engine must still be 7/7 after your changes.
- All outbound network calls live in extension/src/background/service-worker.js only. Never in content scripts, engine, storage, or dashboard.
- API keys (Climatiq, Dedalus) live only in proxy/.env. Never in extension code or checked into git.
- Preserve Dexie version(1) and version(2). Add version(3).
- Do not invent endpoints. Use exactly:
  - Climatiq: https://api.climatiq.io/classifications/v1/estimate
  - Dedalus LLM: https://api.dedaluslabs.ai/v1/chat/completions (model "openai/gpt-5")

=== PART 1: Generic extractor + 5 custom adapters (90 min) ===

Create extension/src/content/adapters/ directory.

File: extension/src/content/adapters/generic.js
Export { matches, extract }.
- matches(url): always returns true (fallback).
- extract(document): tries three sub-extractors, returns first non-null result.
  a. schemaOrg(document): iterate all <script type="application/ld+json"> tags. JSON.parse each (wrap in try/catch, skip malformed). Look for @type === "Product" at top level or inside @graph array. Pull name (string), offers.price or offers[0].price (number, may be string — parse). Return { title, price, method: 'schema.org' } or null.
  b. openGraph(document): read <meta property="og:type">. If equals "product" or "og:product", read <meta property="og:title"> and <meta property="product:price:amount">. Parse price. Return { title, price, method: 'opengraph' } or null.
  c. microdata(document): find element with [itemtype*="schema.org/Product"]. Inside it, find [itemprop="name"] (.textContent.trim()) and [itemprop="price"] (.content attribute OR .textContent). Parse price, strip $€£ and commas. Return { title, price, method: 'microdata' } or null.
- Price parser helper: given a string or number, return number > 0 or null. Strip currency symbols, commas, whitespace. parseFloat. Reject NaN, <=0, or >100000.

File: extension/src/content/adapters/amazon.js
- matches(url): /amazon\.com\/.*\/dp\/[A-Z0-9]+/.test(url)
- extract(document):
    title = document.getElementById('productTitle')?.innerText?.trim()
    priceEl = document.querySelector('.a-price .a-offscreen')
    price = priceEl ? parseFloat(priceEl.innerText.replace(/[^0-9.]/g, '')) : null
    if (!title || !price || isNaN(price)) return null
    return { title, price, method: 'amazon_custom' }

File: extension/src/content/adapters/ebay.js
- matches(url): /ebay\.com\/itm\/\d+/.test(url)
- extract(document):
    title = document.querySelector('.x-item-title__mainTitle')?.innerText?.trim()
    priceEl = document.querySelector('.x-price-primary span')
    price = parse price from priceEl
    return { title, price, method: 'ebay_custom' } or null

File: extension/src/content/adapters/walmart.js
- matches(url): /walmart\.com\/ip\//.test(url)
- extract(document): try h1[itemprop="name"] then h1.lh-copy. Price from [itemprop="price"] then [data-testid="price-wrap"] span.
- Return { title, price, method: 'walmart_custom' } or null

File: extension/src/content/adapters/target.js
- matches(url): /target\.com\/p\//.test(url)
- extract(document): h1 element for title. [data-test="product-price"] for price.

File: extension/src/content/adapters/bestbuy.js
- matches(url): /bestbuy\.com\/site\//.test(url)
- extract(document): .sku-title h1 for title. .priceView-customer-price span for price.

File: extension/src/content/dispatcher.js (NEW)
This becomes the main content script, replacing the current amazon.js/ebay.js as entry points.
- Import all 6 adapters: amazon, ebay, walmart, target, bestbuy, generic.
- Import detectCategory from '../engine/carbon.js', computeCarbonWithClimatiq from '../engine/carbon.js', logView from '../storage/db.js', openPanel from './panel.js', injectBadge helper.
- On document_idle:
    const url = window.location.href
    const adapters = [amazon, ebay, walmart, target, bestbuy, generic]
    let extracted = null
    for (const a of adapters) {
      if (a.matches(url)) {
        extracted = a.extract(document)
        if (extracted) break
      }
    }
    if (!extracted) return  // silent, no logging
    const category = detectCategory(extracted.title)
    const result = await computeCarbonWithClimatiq(extracted.title, extracted.price, category)
    await logView({ url, title: extracted.title, price: extracted.price, category, kg_total: result.kg_total, trace: result.trace })
    injectBadge(result, openPanel)  // existing badge logic

Move the injectBadge function from current amazon.js into dispatcher.js (it stays identical).

DELETE extension/src/content/ebay.js (fully — its logic is now in adapters/ebay.js).

REPLACE extension/src/content/amazon.js contents with: export { } from './dispatcher.js'  -- OR just have it import and run the dispatcher. Whichever your bundler prefers. The manifest will point to dispatcher.js instead.

File: extension/manifest.config.ts
Update content_scripts to a single entry:
  {
    matches: [
      "*://*.amazon.com/*",
      "*://*.ebay.com/*",
      "*://*.walmart.com/*",
      "*://*.target.com/*",
      "*://*.bestbuy.com/*",
      "*://*.shopify.com/*",
      "*://*.myshopify.com/*",
      "*://*.etsy.com/*"
    ],
    js: ["src/content/dispatcher.js"],
    css: ["src/content/badge.css"],
    run_at: "document_idle"
  }
Add host_permissions: ["https://api.climatiq.io/*"] -- proxy URL is added at deploy time.

=== PART 2: Climatiq client + cache (60 min) ===

File: extension/src/engine/category_map.json
Export an object mapping 11 internal categories to ISIC4 codes:
{
  "audio_electronics":  { "code": "26", "description": "Computer, electronic and optical products" },
  "laptops":            { "code": "26", "description": "Computer, electronic and optical products" },
  "smartphones":        { "code": "26", "description": "Computer, electronic and optical products" },
  "apparel_tops":       { "code": "14", "description": "Wearing apparel" },
  "apparel_bottoms":    { "code": "14", "description": "Wearing apparel" },
  "footwear":           { "code": "15", "description": "Leather and related products" },
  "home_goods":         { "code": "20", "description": "Chemicals and chemical products" },
  "beauty":             { "code": "20", "description": "Chemicals and chemical products" },
  "books":              { "code": "18", "description": "Printing and recorded media" },
  "food_packaged":      { "code": "10", "description": "Food products" },
  "toys":               { "code": "32", "description": "Other manufacturing" },
  "general":            { "code": "32", "description": "Other manufacturing" }
}

File: extension/src/engine/climatiq.js
Exports:
- priceBucket(price): returns the bucketed price as a number.
    if (price < 50)  return Math.round(price / 5)  * 5
    if (price < 200) return Math.round(price / 10) * 10
    if (price < 1000) return Math.round(price / 25) * 25
    return Math.round(price / 100) * 100
- cacheKey(category, price): return `${category}::${priceBucket(price)}`
- async getEstimate(category, price):
    1. key = cacheKey(category, price)
    2. cached = await db.climatiq_cache.get(key)  -- but do NOT import Dexie directly. Add a helper getCacheEntry(key) in storage/db.js and import that.
    3. If cached, await logEvent('climatiq_cache_hit'), return { co2e_kg: cached.co2e_kg, source: 'cache', emission_factor_id: cached.emission_factor_id, cached_at: cached.cached_at }
    4. If not cached:
       Send chrome.runtime.sendMessage({ type: 'climatiq_estimate', category, price })
       Use a 4-second timeout wrapper (Promise.race with a setTimeout that resolves to { ok: false, error: 'timeout' })
       On { ok: true, data }:
         await putCacheEntry(key, { key, co2e_kg: data.co2e, emission_factor_id: data.emission_factor.id, emission_factor_name: data.emission_factor.name, cached_at: new Date().toISOString() })
         await logEvent('climatiq_cache_miss')
         return { co2e_kg: data.co2e, source: 'climatiq', emission_factor_id: data.emission_factor.id, emission_factor_name: data.emission_factor.name }
       On failure: return null

File: extension/src/engine/carbon.js
DO NOT MODIFY the existing computeCarbon function. Add a new exported function:

async function computeCarbonWithClimatiq(title, price, category) {
  const remote = await getEstimate(category, price)  // import from './climatiq.js'

  if (remote !== null) {
    // Build result using remote data, but keep same shape as computeCarbon output
    const local = computeCarbon(title, price, category)  // for the stages breakdown structure
    const scalingFactor = remote.co2e_kg / local.kg_total  // rescale stages to match Climatiq total
    const stages = {
      manufacturing: local.stages.manufacturing * scalingFactor,
      shipping:      local.stages.shipping * scalingFactor,
      packaging:     local.stages.packaging * scalingFactor,
      end_of_life:   local.stages.end_of_life * scalingFactor
    }
    const confidence = {
      low:  remote.co2e_kg * 0.85,
      high: remote.co2e_kg * 1.15,
      width_pct: 15
    }
    const trace = {
      ...local.trace,
      data_source: remote.source === 'cache' ? 'climatiq_cached' : 'climatiq_fresh',
      lookup: {
        source: `Climatiq / EXIOBASE (${remote.emission_factor_name || 'spend-based'})`,
        emission_factor_id: remote.emission_factor_id,
        methodology: 'ISIC4 classification → EXIOBASE spend-based factor'
      },
      confidence_reason: 'Climatiq peer-reviewed LCA data (±15% typical for spend-based)'
    }
    return {
      kg_total: remote.co2e_kg,
      stages,
      confidence,
      equivalent_miles: Math.round(remote.co2e_kg * 2.5),
      trace
    }
  }

  // Fallback: local computation with widened CI and flagged source
  const result = computeCarbon(title, price, category)
  result.trace.data_source = 'local_fallback'
  result.trace.confidence_reason = 'Climatiq unavailable. Local category-average fallback. ' + (result.trace.confidence_reason || '')
  result.confidence.low  *= 0.75  // widen
  result.confidence.high *= 1.25
  result.confidence.width_pct = Math.round(result.confidence.width_pct * 1.5)
  return result
}

export { computeCarbonWithClimatiq }

=== PART 3: Dexie v3 migration (15 min) ===

Modify extension/src/storage/db.js:
- After the existing version(2) block, add:
  db.version(3).stores({
    views:          '++id, url, occurred_at, category, merchant',
    audit_log:      '++id, event_type, timestamp',
    settings:       '&key',
    climatiq_cache: '&key, cached_at'
  });
- Export new helpers:
  - async getCacheEntry(key): return db.climatiq_cache.get(key)
  - async putCacheEntry(entry): return db.climatiq_cache.put(entry)
  - async getClimatiqCacheStats(): return {
      total_entries: await db.climatiq_cache.count(),
      hit_count_session: (count audit_log entries today with event_type 'climatiq_cache_hit'),
      miss_count_session: (count audit_log entries today with event_type 'climatiq_cache_miss')
    }

Do not drop existing exports (logView, getHistory, logEvent, resetAll, getSetting, putSetting, getViewsInRange).

=== PART 4: Service worker (30 min) ===

Modify extension/src/background/service-worker.js.

At top, define:
const PROXY_ORIGIN = 'https://carboknot-proxy.onrender.com'  // Rahul replaces this at deploy time

Import category_map from '../engine/category_map.json'.

Add two message handlers (chrome.runtime.onMessage.addListener):

Handler 1: { type: 'climatiq_estimate', category, price }
  const mapping = category_map[category] || category_map.general
  fetch(`${PROXY_ORIGIN}/api/climatiq`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      classification_code: mapping.code,
      money: price,
      money_unit: 'usd'
    })
  })
    .then(r => r.json())
    .then(data => sendResponse({ ok: true, data }))
    .catch(e => sendResponse({ ok: false, error: e.message }))
  return true  // async response

Handler 2: { type: 'explain_alternative', original, alternative }
  fetch(`${PROXY_ORIGIN}/api/reason`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      original_title: original.title,
      original_kg: original.kg,
      alt_title: alternative.title,
      alt_kg: alternative.kg
    })
  })
    .then(r => r.json())
    .then(data => sendResponse({ ok: true, reasoning: data.reasoning }))
    .catch(e => sendResponse({ ok: false, error: e.message }))
  return true

=== PART 5: Render proxy (45 min) ===

Fill in proxy/index.js. Use Hono (lighter than Express) or Express — whichever is easier.

Dependencies in proxy/package.json: hono (or express), dotenv. Nothing else.

Environment variables (from proxy/.env):
  CLIMATIQ_API_KEY  (required)
  DEDALUS_API_KEY   (required)
  ALLOWED_ORIGINS   (optional, defaults to "chrome-extension://*")
  PORT              (defaults 8787)

Endpoints:

POST /api/climatiq
  Body validation:
    - classification_code: string, non-empty
    - money: number, > 0, < 1000000
    - money_unit: must be 'usd' (or support 'eur', 'gbp' if trivial)
  Forward to https://api.climatiq.io/classifications/v1/estimate:
    headers: { Authorization: `Bearer ${CLIMATIQ_API_KEY}`, 'Content-Type': 'application/json' }
    body: {
      classification: {
        classification_type: "isic4",
        classification_code: <code>,
        source: "EXIOBASE"
      },
      parameters: {
        money: <money>,
        money_unit: <money_unit>
      }
    }
  On 200: pass climatiq response body through to client.
  On 4xx/5xx: respond with { error: "climatiq_error", status, message } (log server-side; do not leak API key).

POST /api/reason
  Body validation:
    - original_title: string < 200 chars
    - original_kg: number > 0
    - alt_title: string < 200 chars
    - alt_kg: number >= 0 and < original_kg
  Forward to https://api.dedaluslabs.ai/v1/chat/completions:
    headers: { Authorization: `Bearer ${DEDALUS_API_KEY}`, 'Content-Type': 'application/json' }
    body: {
      model: "openai/gpt-5",
      messages: [
        {
          role: "system",
          content: "You are a concise sustainability analyst. Respond in exactly two sentences. Be specific about carbon-saving mechanisms like avoided manufacturing, shipping differences, or packaging reductions. No moralizing."
        },
        {
          role: "user",
          content: `A user is choosing between new "${original_title}" (${original_kg.toFixed(1)} kg CO2e) and alternative "${alt_title}" (${alt_kg.toFixed(1)} kg CO2e). Explain the carbon saving mechanism in two sentences.`
        }
      ]
    }
  On 200: extract response.choices[0].message.content. Respond { reasoning: content }.
  On error: respond { error: "reasoning_unavailable" }.

GET /health
  Respond { ok: true, version: 'carboknot-proxy-v1', services: { climatiq: !!process.env.CLIMATIQ_API_KEY, dedalus: !!process.env.DEDALUS_API_KEY } }

CORS:
  Allow origin matching ALLOWED_ORIGINS env var (default 'chrome-extension://*'). Methods POST, GET, OPTIONS. Headers Content-Type only.

Rate limiting:
  In-memory Map keyed by client IP (req.headers['x-forwarded-for'] || req.ip). Token bucket: 60 requests per minute. On exceed: return 429 with { error: "rate_limited" }.

Logging:
  Only log: ISO timestamp, method, path, response status, origin. Never log request body. Never log response body. Never log headers beyond origin.

Update proxy/.env.example:
  CLIMATIQ_API_KEY=your_climatiq_key_here
  DEDALUS_API_KEY=your_dedalus_key_here
  ALLOWED_ORIGINS=chrome-extension://*
  PORT=8787

Create proxy/render.yaml (or proxy/Dockerfile) for Render deployment:
  # render.yaml
  services:
    - type: web
      name: carboknot-proxy
      env: node
      buildCommand: pnpm install
      startCommand: node index.js
      envVars:
        - key: CLIMATIQ_API_KEY
          sync: false  # set manually in Render dashboard
        - key: DEDALUS_API_KEY
          sync: false
        - key: ALLOWED_ORIGINS
          value: chrome-extension://*

Create proxy/README.md with 10-line deploy instructions for Rahul (the human running it).

=== PART 6: Panel button wiring (20 min) ===

Modify extension/src/content/panel.js.

Find the "Why is this lower carbon?" button click handler (Phase 2 currently uses local rationale from alternatives.js).

Change it to:
  1. Show a spinner (".carboknot-alt-why-spinner" class — add CSS if missing).
  2. chrome.runtime.sendMessage({ type: 'explain_alternative', original: { title: <product title>, kg: <original carbon> }, alternative: { title: alt.name, kg: alt.carbon_kg } }, response => {
       remove spinner
       if (response.ok) {
         render response.reasoning in the drawer
         tag with "via Dedalus (GPT-5)" instead of "Local reasoning"
       } else {
         render the original alt.rationale (existing fallback)
         tag with "Local reasoning" (existing behavior)
       }
     });
  3. Timeout at 5 seconds in content script as well (belt and suspenders).
  4. Log audit_log 'explain_alternative_requested' on click, 'explain_alternative_remote_success' or 'explain_alternative_fallback' on response.

=== PART 7: Verification ===

1. pnpm test:engine → must be 7/7.
2. pnpm build → must succeed.
3. Grep extension/src/ for 'fetch(' | 'axios' | 'XMLHttpRequest'. The ONLY match should be in extension/src/background/service-worker.js. Any match elsewhere is a critical bug.
4. Grep extension/src/ for 'api.climatiq.io' | 'api.dedaluslabs.ai'. These should appear ONLY in proxy/index.js, NEVER in extension/src/.

Report back:
- All files modified, created, deleted (with line counts).
- pnpm test:engine result.
- pnpm build result.
- Grep results for both zero-trust checks.
- Any deviation from spec, with justification.

HARD RULES:
- Do not modify extension/src/dashboard/App.jsx, Settings.jsx, or seed.js.
- Do not inline Climatiq or Dedalus API keys anywhere in extension code.
- Preserve all 7 engine tests.
- Preserve version(1) and version(2) Dexie schema.
- If computeCarbonWithClimatiq falls back to local, the trace must clearly flag data_source as 'local_fallback'.
```

---

## What Person B adds to the dashboard

### New "Privacy receipt" section (below "Top Categories")

```
Climatiq lookups this session
    Cache hits:   <number>     (stayed local)
    API calls:    <number>     (category + price sent, nothing else)
    Cache size:   <number> products

Every new product category/price combination you view triggers one
outbound call to our proxy, which forwards only the ISIC4 classification
code and the price to Climatiq. No titles, no URLs, no identity, no
browsing history. Cached results are reused forever.
```

Reads from `getClimatiqCacheStats()` which Cursor's Part 3 exports.

### Updated Settings modal — "Network allowlist" section

**Current state: minimal disclosed API usage**

Carboknot makes outbound network calls in exactly two cases:

1. The first time you view a product in a category/price range you haven't seen before, we fetch a peer-reviewed carbon estimate from Climatiq via our proxy. We send only an ISIC4 classification code and a price. Subsequent views of similar products are served from local cache.
2. When you click "Why is this lower carbon?" on an alternative, we send the two product titles and their carbon estimates to Dedalus GPT-5 for a two-sentence reasoning trace.

That is everything. No identity, no browsing history, no titles for carbon lookups. Open DevTools Network tab to verify.

---

## What Rahul does while Cursor runs

### Step 1: Climatiq curl test (5 min, do this first)

After you rotate the key, paste into terminal:

```bash
curl -X POST https://api.climatiq.io/classifications/v1/estimate \
  -H "Authorization: Bearer YOUR_NEW_CLIMATIQ_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "classification": {
      "classification_type": "isic4",
      "classification_code": "26",
      "source": "EXIOBASE"
    },
    "parameters": {
      "money": 349.99,
      "money_unit": "usd"
    }
  }'
```

Expected: JSON with `co2e`, `co2e_unit: "kg"`, `emission_factor: { ... }`. If you get an auth error, key is wrong. If you get `no_emission_factors_found`, try `classification_code "25"` instead.

**If this fails, your whole plan fails. Fix it before anything else.**

### Step 2: Dedalus curl test (5 min)

```bash
curl https://api.dedaluslabs.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_NEW_DEDALUS_KEY" \
  -d '{
    "model": "openai/gpt-5",
    "messages": [
      {"role": "user", "content": "Respond in one word: hello"}
    ]
  }'
```

Expected: JSON with `choices[0].message.content` containing "hello" or similar.

### Step 3: Render deploy (30 min)

Once Cursor finishes Part 5, the proxy code exists.

1. Push your repo to GitHub (`Binayak012/CarboKnot`).
2. Go to render.com, sign up / log in.
3. New → Web Service → connect the GitHub repo, root directory `proxy/`.
4. Build command: `pnpm install`. Start command: `node index.js`.
5. Environment variables in Render dashboard:
   - `CLIMATIQ_API_KEY` = your rotated Climatiq key
   - `DEDALUS_API_KEY` = your rotated Dedalus key
   - `ALLOWED_ORIGINS` = `chrome-extension://*`
6. Deploy. Wait ~3 minutes. Copy the public URL (something like `https://carboknot-proxy.onrender.com`).
7. `curl https://<your-render-url>/health` — confirm it returns `{ ok: true, ... }`.
8. Update `PROXY_ORIGIN` constant in `extension/src/background/service-worker.js` to the real URL.
9. `pnpm build` extension. Reload in Chrome. Test end-to-end.

### Step 4: Dedalus Machine cache-warming job (30 min, optional but claims the prize)

This is a standalone Node script that runs ONCE on a Dedalus Machine to pre-populate the Climatiq cache for common category/price buckets.

Create `dedalus-machine/warm-cache.js`:
- Node script. No deps except `node-fetch` (or use native fetch on Node 20+).
- Read Climatiq key from env.
- Iterate a hardcoded list of (category, price_bucket) pairs covering the 5 demo categories × 4 price brackets = 20 pairs.
- For each, POST to Climatiq `/classifications/v1/estimate`.
- Write results to `dedalus-machine/warmed-cache.json`.
- Script finishes; exit 0.

Then on your laptop:

```bash
brew install dedalus-labs/tap/dedalus
export DEDALUS_API_KEY=your_key
dedalus machines create --vcpu 1 --memory-mib 1024 --storage-gib 10
# note the machine ID
dedalus ssh dm-<id>
# inside machine:
apt install nodejs
# upload warm-cache.js (use scp or cat > warm-cache.js)
CLIMATIQ_API_KEY=... node warm-cache.js
# copy warmed-cache.json back to your laptop
exit
```

Commit `warmed-cache.json` to the repo. The extension can read it on first install to seed the cache:
- In `extension/src/engine/climatiq.js`, add an `initializeCacheFromBundle()` function that reads `warmed-cache.json` at install time and pre-populates `db.climatiq_cache`.

This gives you a real, defensible "we use Dedalus Machines for container-based background cache warming" claim. Your Devpost submission includes:
- The `warm-cache.js` source
- Screenshot of `dedalus machines exec` output
- Architecture slide showing the Machine as cache-warmer

**If Dedalus Machine setup takes more than 45 minutes, abandon.** Commit a placeholder `warmed-cache.json` with a few manually-generated entries and document the intended design in Devpost. Partial claim is better than no demo.

---

## What Person C writes tonight

### `docs/METHODOLOGY.md` (new, one page)

**What Carboknot computes.** Per-product carbon footprint estimates based on spend-based Life Cycle Assessment (LCA), using Climatiq's classification API with the EXIOBASE emission factor database. Products are mapped to ISIC4 industry classification codes, and the price in USD is converted to kg CO2e using EXIOBASE's sector-specific emission factors, which account for upstream supply chain emissions (GHG Protocol Scope 3.1).

**Data sources.**
- Climatiq API (`api.climatiq.io`): peer-reviewed LCA data. We use their Classifications endpoint with EXIOBASE source.
- EXIOBASE: environmentally-extended input-output model, standard reference for spend-based carbon accounting. Current data version covers 2019 emission factors with automatic inflation adjustment.
- Climatiq methodology docs: https://www.climatiq.io/methodology

**How confidence intervals work.** Climatiq-backed estimates carry ±15% confidence interval, reflecting typical uncertainty of spend-based LCA methodology. When Climatiq is unavailable and we fall back to local category averages, confidence widens to ±30%.

**Known limitations.**
- Spend-based estimates are sector-average, not product-specific. A $349 high-end headphone and a $349 entry-level camera both map to ISIC4 code 26 and receive similar kg CO2e estimates. True product-specific LCA would require component-level data we don't have.
- EXIOBASE factors reflect 2019 supply chain structures adjusted for inflation; post-2019 changes (e.g. renewable electricity shifts) may cause underestimation for some categories.
- The ISIC4 category mapping is one-to-many: "audio electronics" covers speakers, headphones, and soundbars with the same emission factor. Precision would require a finer taxonomy.
- Alternative reduction factors (refurb 60%, durable 40%, refill 75%) are category-average estimates, not product-specific measurements. Real variance is high.
- We use purchaser prices passed through Climatiq's inflation and margin adjustment. Manual input of trade/tax margins would improve accuracy but is not currently exposed in the UI.

### The three-minute demo script

- **Beat 1 (25s) — Problem:** "Every sustainability app today either uses generic category averages and calls it a day, or sends your entire browsing history to servers you don't control. We built the third option."
- **Beat 2 (40s) — Badge on Amazon:** Visit Sony WH-1000XM5. Badge appears: "42.3 kg CO2e, driving 105 miles." Click. Breakdown panel opens. Expand accordion. Show Climatiq source citation. Point at: "That number came from peer-reviewed LCA data, via Climatiq's EXIOBASE classification."
- **Beat 3 (30s) — Alternatives:** Three cards. Back Market refurb saves 25 kg. Click "Why is this lower carbon?" — show GPT-5 response appear with "via Dedalus (GPT-5)" tag. "Refurbishing a premium headphone skips the manufacturing phase, which is ~70% of the footprint in consumer electronics."
- **Beat 4 (30s) — Dashboard:** Click toolbar icon. Dashboard with trend, budget ring, privacy receipt section showing "Cache hits: 14, API calls: 3." Point at: "Over time, most of your views are served from local cache. We only call Climatiq for products you've never priced before."
- **Beat 5 (30s) — The mic drop rewritten:** "Open DevTools Network tab. I'll visit a new product — one request to our Render proxy, 300ms, returns carbon data. Refresh the same page. Zero requests. Cached locally. The only things that ever leave your device are a classification code and a dollar amount. Nothing else."
- **Beat 6 (25s) — Roadmap & Telora framing:** "This is the consumer wedge for decision intelligence infrastructure. The same engine generalizes to procurement, university supplier audits, scope-3 reporting. Consumer funnel feeds B2B API. The architecture is the product."

### Six-slide deck

1. **Problem.** Sustainability apps today: generic or surveillance. One visual.
2. **Architecture.** Four-tier diagram: browser extension → proxy → Climatiq + Dedalus → IndexedDB. Zero-trust-lite invariants called out.
3. **Demo.** Three screenshots: badge, panel with Climatiq tag, privacy receipt.
4. **Methodology.** Five bullets from METHODOLOGY.md. "Known limitations" called out by name.
5. **Roadmap & Telora.** Now (consumer), 6 months (B2B procurement API), 18 months (institutional decision intelligence partner channel).
6. **Team.** Names, roles, one-liners.

---

## Updated schedule from now

Assume roughly 10–10:30 PM now. Hard demo at 8 AM.

| Time        | Cursor                    | Rahul                           | Person B                         | Person C            |
| ----------- | ------------------------- | ------------------------------- | -------------------------------- | ------------------- |
| Now–11 PM   | Run Cursor prompt (Parts 1-4) | Rotate keys, curl tests      | Phase 3 dashboard                | Methodology doc     |
| 11 PM–12 AM | Parts 5-6                 | Deploy proxy to Render          | Add privacy receipt section      | Slides + pitch      |
| 12–1 AM     | Part 7 verify             | Wire real proxy URL             | Update Settings text             | Rehearsal 1         |
| 1–2 AM      | — (Cursor done)           | Dedalus Machine warm-cache      | Final dashboard polish           | Rehearsal 2         |
| 2–3 AM      | —                         | Verify end-to-end, backup video | Done                             | Rehearsal 3 w/ team |
| 3–4 AM      | —                         | Freeze build, final tests       | Sleep                            | Sleep               |
| 4–8 AM      | Sleep                     | Sleep                           | Sleep                            | Sleep               |
| 8 AM        | —                         | Devpost submit + coffee         | —                                | Final rehearsal     |

---

## Cutoff rules

- **Midnight:** if proxy isn't deployed and `/health` isn't green, revert to local-only fallback. `computeCarbon` still works. Pitch becomes "bundled category-average data" — weaker pitch but working demo.
- **1 AM:** if Dedalus Machine setup is failing, ship without it. Commit a minimal `warmed-cache.json` and describe the design in Devpost. Partial claim still valid.
- **2 AM:** freeze. No more commits.
- **3 AM:** sleep is mandatory. 4 hours minimum.

---

## Final reminders

- **Rotate both API keys before you do anything else.** The ones pasted in chat are burned.
- The Climatiq free tier is **100 requests per day**. Your demo rehearsal and judge traffic combined must stay under this. Cache-on-first-fetch protects you — but test the curl **once**, not ten times.
- The mic drop is different now. It's "watch it stay local on repeat views," not "zero packets." Rehearse the new phrasing, don't default to old language.
- **Never say "zero-trust"** in the demo, slides, or Devpost submission. That language died when you chose Climatiq. Say **"minimal disclosed data sharing"** or **"data-first with local caching"**.
- If anything in this plan conflicts with reality on disk, trust the disk. Ask Cursor to reconcile. Do not edit code based on what this plan says should exist.

**Ship it.**
