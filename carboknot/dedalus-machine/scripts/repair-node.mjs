// Install Node 22 from a prebuilt tarball into /home/machine/node (persistent,
// writable) and (re)start the Carboknot proxy.
//
// Usage:
//   DEDALUS_API_KEY=... DM_ID=dm-... node repair-node.mjs

import { buildClient, runCommand } from './lib.mjs';

const DM_ID = process.env.DM_ID;
if (!DM_ID) { console.error('[repair] DM_ID missing'); process.exit(2); }

const REMOTE_BASE = '/home/machine/proxy';
const NODE_VERSION = 'v22.11.0';
const NODE_TARBALL = `node-${NODE_VERSION}-linux-x64.tar.xz`;
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}`;

async function main() {
  const client = buildClient();

  console.log('[repair] downloading + extracting Node to /home/machine/node ...');
  await runCommand(
    client,
    DM_ID,
    `set -euo pipefail
cd /home/machine
if [ ! -x node/bin/node ]; then
  curl -fsSL -o ${NODE_TARBALL} ${NODE_URL}
  tar -xJf ${NODE_TARBALL}
  rm -rf node
  mv node-${NODE_VERSION}-linux-x64 node
  rm -f ${NODE_TARBALL}
fi
/home/machine/node/bin/node -v
/home/machine/node/bin/npm -v`,
    { label: 'install node 22', timeoutMs: 600_000 },
  );

  console.log('[repair] rewriting start.sh to use persistent node ...');
  await runCommand(
    client,
    DM_ID,
    `cat > ${REMOTE_BASE}/start.sh <<'___START___'
#!/bin/bash
set -euo pipefail
export PATH=/home/machine/node/bin:$PATH
cd ${REMOTE_BASE}
set -a
. ${REMOTE_BASE}/.env
set +a
exec /home/machine/node/bin/node --experimental-sqlite index.js
___START___
chmod +x ${REMOTE_BASE}/start.sh
echo start.sh ready`,
    { label: 'rewrite start.sh' },
  );

  console.log('[repair] restarting proxy ...');
  await runCommand(
    client,
    DM_ID,
    `cd ${REMOTE_BASE}
pkill -f 'node index.js' || true
sleep 1
setsid nohup bash ${REMOTE_BASE}/start.sh > ${REMOTE_BASE}/server.log 2>&1 </dev/null &
disown || true
echo launched pid_candidates=$(pgrep -f 'node index.js' || echo none)`,
    { label: 'relaunch proxy' },
  );

  console.log('[repair] waiting 8s for port ...');
  await new Promise((r) => setTimeout(r, 8000));

  await runCommand(
    client,
    DM_ID,
    `ss -lntp 2>/dev/null | grep :8787 || echo "NOT LISTENING"
echo "--- server.log tail ---"
tail -n 60 ${REMOTE_BASE}/server.log || echo no log`,
    { label: 'listen + log' },
  );

  await runCommand(
    client,
    DM_ID,
    `curl -fsS http://127.0.0.1:8787/health && echo || (echo FAILED; tail -n 40 ${REMOTE_BASE}/server.log)`,
    { label: 'local health' },
  );
}

main().catch((err) => {
  console.error('[repair] FAILED:', err?.status ?? '', err?.message ?? err);
  process.exit(1);
});
