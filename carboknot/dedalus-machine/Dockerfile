# Carboknot proxy + factor warmer, packaged for a Dedalus Machine.
#
# Single-process image:
#   - Serves /health, /swarm/*, /api/reason, /api/climatiq on :8787
#   - Runs the Climatiq factor warmer in-process on a WARMER_REFRESH_MIN cadence
#   - Persists the warmed bundle to /data/cache.json (mount this as a volume)
#
# Build:   docker build -t carboknot-machine -f dedalus-machine/Dockerfile .
# Run:     docker run -p 8787:8787 -v carboknot-data:/data --env-file proxy/.env carboknot-machine
#
# On a Dedalus Machine you generally want:
#   WARMER_ENABLED=true
#   WARMER_CACHE_PATH=/data/cache.json
#   ALLOWED_ORIGINS=chrome-extension://<your-extension-id>

FROM node:22-alpine

WORKDIR /app

# The proxy has no production dependencies (pure Node stdlib), so we only
# need to copy the source. Keeping the COPY scoped means editing the
# extension never invalidates this layer.
COPY proxy/package.json ./proxy/package.json
COPY proxy/index.js ./proxy/index.js

# Persistent volume for the warmer's cache.json. On a Dedalus Machine
# this mount point is backed by the Machine's persistent disk so the
# cache survives restarts.
VOLUME ["/data"]

ENV NODE_ENV=production \
    PORT=8787 \
    WARMER_ENABLED=true \
    WARMER_CACHE_PATH=/data/cache.json \
    WARMER_REFRESH_MIN=240

EXPOSE 8787

# Simple, unprivileged runtime. No package.json scripts so one less
# indirection layer between crash and stderr.
USER node
CMD ["node", "proxy/index.js"]
