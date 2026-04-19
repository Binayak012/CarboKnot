# Carboknot

Browser agent that turns every product page into a **carbon receipt** — peer-reviewed LCA data via Climatiq, cached locally after the first fetch, with minimal disclosed data sharing.

> **Note:** The single source of truth for the team is [`docs/PLAN.md`](../docs/PLAN.md). This README is a short orientation — if it conflicts with the plan, the plan wins.

## Architecture

```
carboknot/
├── extension/          Chrome MV3 extension (Vite + @crxjs)
│   └── src/
│       ├── engine/       Carbon math: Climatiq-backed primary path + local fallback
│       ├── storage/      Dexie.js — views, audit_log, settings, climatiq_cache
│       ├── inference/    Category detection (regex + WebLLM)
│       ├── content/      dispatcher.js + per-site adapters (amazon, ebay, walmart, target, bestbuy, generic)
│       ├── background/   Service worker — the ONLY place outbound fetch lives
│       └── dashboard/    React dashboard: trend, budget ring, top categories, recent views, privacy receipt
└── proxy/              Render-hosted stateless proxy
                        — holds Climatiq + Dedalus keys, forwards /api/climatiq & /api/reason
```

## Data-sharing posture

Carboknot is **not** a zero-trust app. It is a **data-first carbon receipt with minimal disclosed sharing**. Three outbound calls exist, and all are user-visible:

1. **`/api/climatiq`** — on first view of a new `(category, price_bucket)` pair. We send only an ISIC4 classification code and a price; nothing else. Results are cached in IndexedDB and reused forever.
2. **`/api/reason`** — only when the user clicks "Why is this lower carbon?" on an alternative. We send two product titles and two kg values to Dedalus GPT-5 for a two-sentence rationale.
3. **`/api/k2/reason`** — only when the user expands the "Why this footprint?" section in the breakdown panel. We send the already-visible trace fields (title, price, category, kg_total, per-stage kg, confidence interval) to K2 Think V2 via the proxy. K2 narrates the breakdown in three sentences and **never** produces or revises the kg number — Climatiq + the local LCA engine remain the single source of truth. Falls back to a local explanation if K2 is unavailable.

No titles, URLs, identity, or browsing history are transmitted for carbon lookups. Open DevTools' Network tab to verify.

## Development

```bash
pnpm install
pnpm dev              # builds extension in watch mode into extension/dist
pnpm proxy            # runs the Render-style proxy locally on :8787
pnpm test:engine      # smoke-tests the carbon math engine in Node
```

Load `extension/dist` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

## Team

- **Rahul** — Render deploy, Dedalus Machine, key management, integration, pitch.
- **Person A** — runs the big Cursor prompt; implements adapters, Climatiq client, service-worker wiring, proxy.
- **Person B** — dashboard owner (`extension/src/dashboard/App.jsx`, `Settings.jsx`, `seed.js`): trend, budget ring, categories, recent views, **privacy receipt** section.
- **Person C** — `docs/METHODOLOGY.md`, slide deck, demo script.

See [`docs/PLAN.md`](../docs/PLAN.md) for the full locked plan, per-role task list, schedule, and cutoff rules.

## Sponsors referenced

- **Telora** — pitch framing (primary target).
- **Dedalus Labs** — LLM for alternative reasoning + Dedalus Machine for cache-warming job.
- **Climatiq** — peer-reviewed LCA data source (cited for credibility, not a hackathon sponsor).
- **Orchids** — stretch, mention if dashboard looks premium.
