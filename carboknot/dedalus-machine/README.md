# Carboknot — Dedalus Machine

A single stateful VM that runs the Carboknot proxy **and** the Climatiq
factor warmer in one Node process. Replaces the Render deployment: one
public URL, one thing to monitor, persistent state on disk.

## What it does

1. **Serves the proxy** — `/health`, `/api/climatiq`, `/api/reason`,
   `/swarm/cache-status`, `/swarm/cache`, `/swarm/refresh`.
2. **Runs a warm loop** every `WARMER_REFRESH_MIN` minutes (default 240).
   Each pass:
   - Iterates 7 unique ISIC4 classification codes × 11 price buckets =
     **77 Climatiq calls**, spaced 500 ms apart (~40 s total).
   - Fans out the 77 per-code results to 132 per-category cache keys
     (12 Carboknot categories, some sharing codes).
   - Atomically writes the bundle to `/data/cache.json`.
3. **Publishes the bundle** at `GET /swarm/cache` so the extension's
   service worker can bulk-hydrate its IndexedDB on install/open.

## Why this design

- **One process, one URL.** No cross-service network hops, no Render
  cold-start, no separate orchestrator.
- **Stateful disk** is the feature a Dedalus Machine gives us over a
  stateless container: the warm cache survives restarts, so a restart
  in the middle of a demo doesn't dump the 40 s of work we just did.
- **Gracefully degrades.** If the warmer hasn't run yet (fresh VM), the
  extension still works — the service worker falls through to the live
  `/api/climatiq` path. The warmer is a latency optimisation, not a
  correctness requirement.

## Local smoke test

From the repo root:

```bash
docker build -t carboknot-machine -f dedalus-machine/Dockerfile .
docker run --rm -p 8787:8787 \
  -e CLIMATIQ_API_KEY="$(grep CLIMATIQ_API_KEY proxy/.env | cut -d= -f2-)" \
  -e WARMER_ENABLED=true \
  -e WARMER_INITIAL_DELAY_MS=1000 \
  -v "$(pwd)/data:/data" \
  carboknot-machine
```

In a second terminal:

```bash
# should show warmer.enabled=true
curl -s http://localhost:8787/health | jq

# wait ~45 seconds for the first warm pass, then:
curl -s http://localhost:8787/swarm/cache-status | jq
curl -s http://localhost:8787/swarm/cache | jq '.factor_count, (.factors | keys | length)'
```

A populated `data/cache.json` will appear in the repo root after the
first pass completes.

## Deploying to a Dedalus Machine

1. Claim your $50 Machines credit at your Dedalus dashboard if you haven't.
2. Create a Machine (smallest tier is fine — this process is trivially
   small; ~30 MB RSS, negligible CPU outside the warm pass).
3. Attach or create a persistent volume and mount it at `/data`.
4. Push the `carboknot-machine` image to whatever registry the Machine
   pulls from (Dedalus will tell you: it's either their own registry
   or `ghcr.io` / `docker.io`).
5. Set these env vars on the Machine:

   | Var | Value |
   | --- | --- |
   | `CLIMATIQ_API_KEY` | your Climatiq key |
   | `DEDALUS_API_KEY` | your Dedalus LLM key (if you're keeping `/api/reason`) |
   | `WARMER_ENABLED` | `true` |
   | `WARMER_REFRESH_MIN` | `240` |
   | `WARMER_CACHE_PATH` | `/data/cache.json` |
   | `ALLOWED_ORIGINS` | `chrome-extension://<your-extension-id>` |
   | `WARMER_REFRESH_TOKEN` | a long random string (optional, guards `POST /swarm/refresh`) |
   | `PORT` | `8787` (or whatever Dedalus maps) |

6. Start it. In the Machine logs you should see, in order:
   ```
   [Carboknot proxy] listening on :8787
   [Carboknot proxy] dedalus key: set
   [Carboknot proxy] climatiq key: set
   [warmer] enabled: refresh every 240min, cache at /data/cache.json, ladder=[25,50,100,...]
   ...
   [warmer] refresh: 77/77 ok, 132 factors, 39421ms
   ```
7. Grab the Machine's public URL (call it `$MACHINE`) and point the
   extension at it by editing `extension/src/background/service-worker.js`:
   ```js
   const PROXY_ORIGIN = 'https://<your-machine-url>';
   ```
   Rebuild (`pnpm --filter carboknot-extension build`) and reload the
   extension.

## Running the smoke test against the live Machine

```bash
MACHINE=https://<your-machine-url>
curl -s $MACHINE/health | jq
curl -s $MACHINE/swarm/cache-status | jq
# Force an immediate refresh (token required if WARMER_REFRESH_TOKEN is set):
curl -s -X POST "$MACHINE/swarm/refresh?token=$WARMER_REFRESH_TOKEN" | jq
```

## Cost / quota math

- **Dedalus Machines**: the smallest tier is ~$0.01/hr on comparable
  products → ~$7/month → well inside the $50 hackathon credit for the
  duration of the event and beyond.
- **Climatiq**: one warm pass = 77 calls. At `WARMER_REFRESH_MIN=240`
  that's 6 passes/day = 462 calls/day = ~14 k/month. Comfortably inside
  the standard free tier.

## When NOT to use this

If you want a truly stateless proxy for a production rollout across
many users, you'd split the warmer back onto its own process with a
shared-storage backend (S3 / Redis) and run the proxy as a fleet of
stateless replicas. For a hackathon demo — and for any team <10k
active users — the co-located single-process design is strictly
simpler and strictly more reliable.
