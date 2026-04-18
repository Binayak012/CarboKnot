# Carboknot Dedalus Swarm runbook

Two Dedalus Machines, coordinating. Watcher polls Climatiq + exposes cache
over HTTP. Enricher classifies ambiguous titles via Dedalus LLM + exposes
results over HTTP. Watcher pulls enrichments from Enricher every 5 min.

This runbook is for **Rahul** to execute solo. Paste blocks into your terminal
in order. Hard stop at 2 AM — if anything is unresolved by then, fall back to
watcher-only mode (see end of file).

---

## Prerequisites

- `node --version` is 20+ (confirmed: you're on 22.22.0)
- Keys moved OUT of notes app into password manager
- GitHub repo is at `Binayak012/CarboKnot` and you have push access

## Step 1 — install the Dedalus CLI (3 min)

```bash
brew install dedalus-labs/tap/dedalus
dedalus --version    # confirm it prints a version
```

If Homebrew refuses the tap, use the alt install Dedalus documents (curl
installer from their docs site). Do not paste the API key anywhere the
shell history records — use `read -s DEDALUS_API_KEY` or the method below.

## Step 2 — export keys safely for this shell session (2 min)

Open a new terminal window that you'll leave open until 2 AM. Paste these
one at a time. They stay only in this shell's memory, not in history.

```bash
read -s DEDALUS_API_KEY && export DEDALUS_API_KEY
# paste your Dedalus key, press enter (nothing echoes)

read -s CLIMATIQ_API_KEY && export CLIMATIQ_API_KEY
# paste your Climatiq key, press enter (nothing echoes)
```

Verify they loaded:

```bash
echo "dedalus: ${DEDALUS_API_KEY:0:6}... (len=${#DEDALUS_API_KEY})"
echo "climatiq: ${CLIMATIQ_API_KEY:0:6}... (len=${#CLIMATIQ_API_KEY})"
```

## Step 3 — create both Machines (5 min)

```bash
dedalus machines create --name carboknot-watcher  --vcpu 1 --memory-mib 1024 --storage-gib 10
# copy the machine id printed. Export as:
export WATCHER_ID=<paste-machine-id-here>

dedalus machines create --name carboknot-enricher --vcpu 1 --memory-mib 1024 --storage-gib 10
export ENRICHER_ID=<paste-machine-id-here>

dedalus machines list     # screenshot this — proof of two running VMs for Devpost
```

## Step 4 — deploy the watcher (15 min)

From the repo root:

```bash
cd /Users/mandal/Downloads/ledger/carboknot/dedalus-swarm/watcher

# SCP the agent code to the VM (replace scp command if Dedalus uses a
# different copy mechanism — check `dedalus --help`):
dedalus ssh $WATCHER_ID -- "mkdir -p /root/watcher"
dedalus scp watcher.js    $WATCHER_ID:/root/watcher/watcher.js
dedalus scp package.json  $WATCHER_ID:/root/watcher/package.json

# Install node + start the agent:
dedalus ssh $WATCHER_ID -- bash -lc '
  apt-get update -qq && apt-get install -y nodejs npm &&
  cd /root/watcher &&
  cat > .env <<ENV
CLIMATIQ_API_KEY='"$CLIMATIQ_API_KEY"'
PORT=8080
ENV
  nohup node watcher.js > watcher.log 2>&1 &
  sleep 2 &&
  tail -n 20 watcher.log
'
```

Verify from inside the VM:

```bash
dedalus ssh $WATCHER_ID -- 'curl -s http://localhost:8080/health'
# expected: {"ok":true,"uptime_s":...}

dedalus ssh $WATCHER_ID -- 'curl -s http://localhost:8080/cache-status'
# expected: {"last_refresh":"...","refreshed_categories":[...],...}
```

Capture the **internal IP** (the one Dedalus gives you for inter-machine
traffic). Export it:

```bash
# if dedalus provides an internal-ip command:
export WATCHER_INTERNAL_IP=$(dedalus machines inspect $WATCHER_ID --json | jq -r '.private_ip')
echo $WATCHER_INTERNAL_IP
```

## Step 5 — deploy the enricher (15 min)

```bash
cd /Users/mandal/Downloads/ledger/carboknot/dedalus-swarm/enricher

dedalus ssh $ENRICHER_ID -- "mkdir -p /root/enricher"
dedalus scp enricher.js   $ENRICHER_ID:/root/enricher/enricher.js
dedalus scp package.json  $ENRICHER_ID:/root/enricher/package.json

dedalus ssh $ENRICHER_ID -- bash -lc '
  apt-get update -qq && apt-get install -y nodejs npm &&
  cd /root/enricher &&
  cat > .env <<ENV
DEDALUS_API_KEY='"$DEDALUS_API_KEY"'
DEDALUS_MODEL=openai/gpt-5
PORT=8080
ENV
  nohup node enricher.js > enricher.log 2>&1 &
  sleep 2 &&
  tail -n 20 enricher.log
'
```

Export the enricher's internal IP:

```bash
export ENRICHER_INTERNAL_IP=$(dedalus machines inspect $ENRICHER_ID --json | jq -r '.private_ip')
echo $ENRICHER_INTERNAL_IP
```

## Step 6 — wire the two Machines together (5 min)

Now tell the watcher where the enricher is:

```bash
dedalus ssh $WATCHER_ID -- bash -lc "
  echo ENRICHER_ORIGIN=http://$ENRICHER_INTERNAL_IP:8080 >> /root/watcher/.env &&
  pkill -f 'node watcher.js' || true &&
  cd /root/watcher &&
  nohup node watcher.js > watcher.log 2>&1 &
"
```

Seed the enricher with a few test titles so it proves the LLM call works:

```bash
dedalus ssh $ENRICHER_ID -- "curl -s -X POST http://localhost:8080/enqueue \
  -H 'content-type: application/json' \
  -d '{\"titles\":[\"Sony WH-1000XM5 Wireless Headphones\",\"MacBook Air M3 13-inch\",\"Levis 501 Original Fit Jeans\"]}'"

# Wait 30s for it to classify, then:
dedalus ssh $ENRICHER_ID -- 'curl -s http://localhost:8080/enrichments'
# expected: {"results":{"Sony...": "audio_electronics", "MacBook...": "laptops", "Levis...": "apparel_bottoms"}, "pending":0}
```

Verify coordination — watcher should have pulled the enrichments by now:

```bash
sleep 300   # wait 5 min for the enricher pull loop to fire
dedalus ssh $WATCHER_ID -- 'tail -n 30 /root/watcher/watcher.log | grep received_enrichments'
# expected: at least one line with "received_enrichments","count":3
```

**That line in the log is the Best Swarm proof.** Screenshot it.

## Step 7 — expose the watcher publicly (10 min)

The Render proxy needs to hit the watcher over the public internet.
Check Dedalus's docs for the exact expose mechanism. Typical options:

**Option A: built-in port exposure**

```bash
dedalus machines ports add $WATCHER_ID --internal-port 8080 --public   # or similar flag; check `dedalus machines ports --help`
# note the public URL/port
```

**Option B: if Dedalus doesn't expose ports directly**, put Cloudflare
Tunnel or ngrok in front of the watcher (only the watcher — enricher
stays private). Example with cloudflared:

```bash
dedalus ssh $WATCHER_ID -- bash -lc "
  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared &&
  chmod +x /usr/local/bin/cloudflared &&
  nohup cloudflared tunnel --url http://localhost:8080 > tunnel.log 2>&1 &
  sleep 5 &&
  grep 'trycloudflare.com' tunnel.log
"
# the URL printed is your public watcher URL
```

Export it:

```bash
export SWARM_WATCHER_ORIGIN=https://<the-public-url-you-got>
curl -s $SWARM_WATCHER_ORIGIN/cache-status
# expected: valid JSON
```

## Step 8 — plug it into the Render proxy

Open Render dashboard → your `carboknot-proxy` service → Environment →
set `SWARM_WATCHER_ORIGIN` to the URL from Step 7. Render auto-redeploys.

Verify end-to-end:

```bash
curl -s https://<your-render-url>/swarm/cache-status
# expected: {"last_refresh":"...","refreshed_categories":[...],"source":"dedalus_swarm"}
```

Tell Rahul-in-Cursor: **"Render live at https://<your-render-url>. Swarm
watcher at $SWARM_WATCHER_ORIGIN."** He swaps PROXY_ORIGIN in the
extension, rebuilds, and you reload the extension in Chrome. Dashboard's
swarm footer goes live.

---

## Fallback — watcher only (if you're at 1:45 AM and not done)

Shut down the enricher, keep the watcher:

```bash
dedalus machines stop $ENRICHER_ID
# watcher keeps running, just without enrichments
# Slide 2 becomes "Dedalus Machine (watcher)" not "Dedalus Swarm"
# Devpost claim: Best Containers ($250 pool), not Best Swarm ($500)
```

---

## Hard stop at 2 AM

Whatever's running at 2 AM, runs. Stop debugging. Go sleep.
