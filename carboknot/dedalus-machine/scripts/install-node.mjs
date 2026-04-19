// Retry Node install: delete corrupted dir, redownload, verify, extract.
import { buildClient, runCommand } from './lib.mjs';

const DM_ID = process.env.DM_ID;
if (!DM_ID) { console.error('DM_ID missing'); process.exit(2); }
const client = buildClient();

const REMOTE_BASE = '/home/machine/proxy';
const NODE_VERSION = 'v22.11.0';

console.log('[install-node] cleaning up corrupted node dir...');
await runCommand(client, DM_ID,
  'rm -rf /home/machine/node /home/machine/node-* /home/machine/node.tar.* && ls /home/machine/',
  { label: 'clean' }
);

// Use different CDN mirror to avoid network corruption
const MIRROR = `https://registry.npmmirror.com/-/binary/node/release/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz`;

console.log('[install-node] downloading fresh node binary...');
await runCommand(client, DM_ID,
  `cd /home/machine
curl -fSL --retry 5 --retry-delay 3 --max-time 120 -o node.tar.gz '${MIRROR}'
ls -lh /home/machine/node.tar.gz`,
  { label: 'download', timeoutMs: 300_000 }
);

console.log('[install-node] extracting...');
await runCommand(client, DM_ID,
  `cd /home/machine
tar -xzf node.tar.gz
mv node-${NODE_VERSION}-linux-x64 node
rm -f node.tar.gz
ls /home/machine/node/bin/
/home/machine/node/bin/node -v`,
  { label: 'extract + verify' }
);

console.log('[install-node] launching proxy...');
await runCommand(client, DM_ID,
  `mkdir -p ${REMOTE_BASE}/data
pkill -f 'node.*index.js' 2>/dev/null || true
sleep 1
nohup bash ${REMOTE_BASE}/start.sh > ${REMOTE_BASE}/server.log 2>&1 &
echo "pid=$!"`,
  { label: 'launch' }
);

await new Promise(r => setTimeout(r, 8000));

await runCommand(client, DM_ID,
  `ss -lntp | grep :8787 || echo NOT_LISTENING
echo "=== log ==="
tail -n 80 ${REMOTE_BASE}/server.log 2>/dev/null || echo "(empty)"`,
  { label: 'listen check' }
);

await runCommand(client, DM_ID,
  'curl -fsS http://127.0.0.1:8787/health 2>&1',
  { label: 'health' }
);
