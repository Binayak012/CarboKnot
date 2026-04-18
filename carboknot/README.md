# Carboknot

Zero-trust browser agent that scores the carbon footprint of every e-commerce purchase **on-device**, at the point of sale.

## Architecture

```
carboknot/
├── extension/          Chrome MV3 extension (Vite + @crxjs)
│   └── src/
│       ├── engine/       Deterministic LCA math + trace object (the d_model core)
│       ├── storage/      Dexie.js — local-only view + audit history
│       ├── inference/    3-tier categorizer (regex → WebLLM → proxy fallback)
│       ├── content/      Amazon / eBay DOM adapters, injected badge, panel
│       ├── background/   Service worker, proxy client
│       └── dashboard/    React + Orchids-style local analytics (reads IndexedDB)
└── proxy/              Daedalus-hosted stateless proxy (no DB, no logs)
                        — holds K2 Think key, forwards /api/reason & /api/categorize
```

### Zero-trust invariants

1. **No user data leaves the browser** except the two explicit, user-visible flows:
   - `/api/categorize` — sends a product **title only** when both regex and WebLLM fail.
   - `/api/reason` — sends two titles + two kg values when the user clicks "Why is this better?".
2. **No backend database.** History lives in IndexedDB (Dexie). The proxy is stateless.
3. **Every number is traceable.** `computeCarbon` always returns a `trace` object: inputs, lookup source, computation steps, confidence interval, methodology version.

## Development

```bash
pnpm install
pnpm dev              # builds extension in watch mode into extension/dist
pnpm proxy            # runs the Daedalus proxy locally on :8787
pnpm test:engine      # smoke-tests the carbon math engine in Node
```

Load `extension/dist` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

## Build phases

- **Phase 1** (this commit) — local engine, LCA dataset, Dexie storage, MV3 scaffold.
- **Phase 2** — stateless Daedalus proxy.
- **Phase 3** — 3-tier AI categorizer (regex / WebLLM / proxy).
- **Phase 4** — Amazon + eBay DOM adapters, injected badge + interpretability panel.
- **Phase 5** — React Orchids dashboard as a `web_accessible_resource`.
