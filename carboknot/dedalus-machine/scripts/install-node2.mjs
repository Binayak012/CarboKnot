// Install Node via stream-to-tar (avoids intermediate file corruption)
import { buildClient, runCommand } from './lib.mjs';

const DM_ID = process.env.DM_ID;
if (!DM_ID) { console.error('DM_ID missing'); process.exit(2); }
const client = buildClient();

const REMOTE_BASE = '/home/machine/proxy';
const NODE_VERSION = 'v22.11.0';
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz`;

console.log('[install-node2] cleaning old node...');
await runCommand(client, DM_ID,
  'rm -rf /home/machine/node /home/machine/node-* /home/machine/*.tar.* && ls /home/machine/',
  { label: 'clean' }
);

console.log('[install-node2] stream-extract node (no temp file)...');
const r = await runCommand(client, DM_ID,
  `curl -fSL '${NODE_URL}' | tar -xz -C /home/machine/
mv /home/machine/node-${NODE_VERSION}-linux-x64 /home/machine/node 2>/dev/null || true
ls /home/machine/node/bin/
/home/machine/node/bin/node -v`,
  { label: 'stream-extract', timeoutMs: 600_000 }
);

if (r.exit_code !== 0) {
  console.error('[install-node2] Node install failed, aborting');
  process.exit(1);
}

console.log('[install-node2] rewriting start.sh...');
await runCommand(client, DM_ID,
  `cat > ${REMOTE_BASE}/start.sh <<'STARTEOF'
#!/bin/bash
export PATH=/home/machine/node/bin:$PATH
cd ${REMOTE_BASE}
set -a
. ${REMOTE_BASE}/.env
set +a
exec /home/machine/node/bin/node --experimental-sqlite index.js
STARTEOF
chmod +x ${REMOTE_BASE}/start.sh`,
  { label: 'write start.sh' }
);

console.log('[install-node2] launching proxy...');
await runCommand(client, DM_ID,
  `mkdir -p ${REMOTE_BASE}/data
pkill -f 'node.*index.js' 2>/dev/null || true
sleep 1
nohup bash ${REMOTE_BASE}/start.sh > ${REMOTE_BASE}/server.log 2>&1 &
echo "pid=$!"`,
  { label: 'launch' }
);

await new Promise(r => setTimeout(r, 10000));

await runCommand(client, DM_ID,
  `ss -lntp | grep :8787 || echo NOT_LISTENING
echo "=== log ==="
tail -n 80 ${REMOTE_BASE}/server.log 2>/dev/null || echo "(empty)"`,
  { label: 'listen check' }
);

await runCommand(client, DM_ID,
  'curl -fsS http://127.0.0.1:8787/health',
  { label: 'health' }
);
