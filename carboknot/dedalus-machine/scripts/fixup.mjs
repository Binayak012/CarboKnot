// One-shot fixup: rename node dir, rewrite start.sh, launch proxy
import { buildClient, runCommand } from './lib.mjs';

const DM_ID = process.env.DM_ID;
if (!DM_ID) { console.error('DM_ID missing'); process.exit(2); }

const REMOTE_BASE = '/home/machine/proxy';

const client = buildClient();

console.log('[fixup] renaming node dir...');
await runCommand(client, DM_ID,
  'rm -rf /home/machine/node && mv /home/machine/node-v22.11.0-linux-x64 /home/machine/node && rm -f /home/machine/node.tar.gz && /home/machine/node/bin/node -v && /home/machine/node/bin/npm -v',
  { label: 'rename + verify node' }
);

console.log('[fixup] rewriting start.sh...');
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
chmod +x ${REMOTE_BASE}/start.sh
cat ${REMOTE_BASE}/start.sh`,
  { label: 'write start.sh' }
);

console.log('[fixup] creating data dir and launching...');
await runCommand(client, DM_ID,
  `mkdir -p ${REMOTE_BASE}/data
pkill -f 'node.*index.js' 2>/dev/null || true
sleep 1
nohup bash ${REMOTE_BASE}/start.sh > ${REMOTE_BASE}/server.log 2>&1 &
echo "launched $!"`,
  { label: 'launch' }
);

console.log('[fixup] waiting 8s...');
await new Promise(r => setTimeout(r, 8000));

console.log('[fixup] checking listen...');
await runCommand(client, DM_ID,
  `ss -lntp 2>/dev/null | grep :8787 || echo "NOT LISTENING"
echo "=== server.log ==="
tail -n 60 ${REMOTE_BASE}/server.log 2>/dev/null || echo "(no log)"`,
  { label: 'listen check' }
);

console.log('[fixup] health check...');
await runCommand(client, DM_ID, 'curl -fsS http://127.0.0.1:8787/health 2>&1', { label: 'health' });
