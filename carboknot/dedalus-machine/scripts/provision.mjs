// End-to-end provisioner for the Carboknot proxy + warmer on a Dedalus Machine.
//
// Steps:
//   1. Create Machine (size from CLI env; defaults to "B": 2 vCPU / 2048 MiB / 20 GiB).
//   2. Wait for phase=running.
//   3. apt install curl + NodeSource node 22.
//   4. Upload proxy/index.js, proxy/package.json, and a remote .env.
//   5. Write start.sh and launch proxy under setsid+nohup.
//   6. Create a public Preview for port 8787.
//   7. Health-check the Preview URL.
//
// Usage:
//   DEDALUS_API_KEY=... node provision.mjs
//   MACHINE_SIZE=A node provision.mjs        # 1 vCPU / 1024 MiB / 10 GiB
//   GEMINI_API_KEY=... node provision.mjs    # bakes the key into the remote .env
//
// Prints the resulting machine_id and preview URL at the end.

import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildClient, idem, waitForPhase, runCommand, uploadFile } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..'); // /ledger
const PROXY_DIR = resolve(REPO_ROOT, 'carboknot', 'proxy');

const SIZES = {
  A: { vcpu: 1, memory_mib: 1024, storage_gib: 10 },
  B: { vcpu: 2, memory_mib: 2048, storage_gib: 20 },
};
const size = SIZES[(process.env.MACHINE_SIZE ?? 'B').toUpperCase()] ?? SIZES.B;
const REMOTE_BASE = '/home/machine/proxy';

async function readLocalEnv() {
  const raw = await readFile(resolve(PROXY_DIR, '.env'), 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return out;
}

function buildRemoteEnv(local) {
  const refreshToken = local.WARMER_REFRESH_TOKEN?.trim() || randomBytes(24).toString('hex');
  const lines = [
    '# Carboknot proxy on Dedalus Machine — written by provision.mjs',
    `DEDALUS_API_KEY=${local.DEDALUS_API_KEY ?? ''}`,
    `DEDALUS_API_ENDPOINT=${local.DEDALUS_API_ENDPOINT ?? 'https://api.dedaluslabs.ai/v1/chat/completions'}`,
    `DEDALUS_MODEL=${local.DEDALUS_MODEL ?? 'openai/gpt-5'}`,
    `CLIMATIQ_API_KEY=${local.CLIMATIQ_API_KEY ?? ''}`,
    `CLIMATIQ_API_ENDPOINT=${local.CLIMATIQ_API_ENDPOINT ?? 'https://api.climatiq.io/data/v1/estimate'}`,
    `CLIMATIQ_DATA_VERSION=${local.CLIMATIQ_DATA_VERSION ?? '^21'}`,
    'WARMER_ENABLED=true',
    `WARMER_REFRESH_MIN=${local.WARMER_REFRESH_MIN ?? '240'}`,
    `WARMER_CACHE_PATH=${REMOTE_BASE}/data/cache.json`,
    `WARMER_CLIMATIQ_DELAY_MS=${local.WARMER_CLIMATIQ_DELAY_MS ?? '500'}`,
    `WARMER_INITIAL_DELAY_MS=${local.WARMER_INITIAL_DELAY_MS ?? '5000'}`,
    `WARMER_REFRESH_TOKEN=${refreshToken}`,
    `ALLOWED_ORIGINS=${local.ALLOWED_ORIGINS ?? ''}`,
    `REASON_RATE_LIMIT_PER_MIN=${local.REASON_RATE_LIMIT_PER_MIN ?? '10'}`,
    `GEMINI_API_KEY=${process.env.GEMINI_API_KEY ?? local.GEMINI_API_KEY ?? ''}`,
    `GEMINI_MODEL=${local.GEMINI_MODEL ?? 'gemini-2.5-flash'}`,
    `CORPUS_DB_PATH=${REMOTE_BASE}/data/corpus.db`,
    'PORT=8787',
  ];
  return { body: lines.join('\n') + '\n', refreshToken };
}

async function main() {
  const client = buildClient();
  console.log(`[provision] size=${JSON.stringify(size)}`);

  console.log('[provision] creating machine...');
  const created = await client.machines.create(
    { ...size },
    { headers: { 'Idempotency-Key': idem() } },
  );
  const machineId = created.machine_id;
  console.log(`[provision] machine_id=${machineId} phase=${created.status?.phase}`);

  console.log('[provision] waiting for running...');
  await waitForPhase(client, machineId, 'running', { timeoutMs: 300_000 });

  console.log('[provision] basic whoami/uname...');
  await runCommand(client, machineId, 'whoami && uname -a && (which node || echo no-node) && (which curl || echo no-curl)');

  // apt-get is not usable on Dedalus Machines (root fs is read-only).
  // Install Node 22 from the official prebuilt tarball into /home/machine/node,
  // which lives on the persistent writable volume.
  console.log('[provision] installing node 22 from binary tarball...');
  const NODE_VERSION = 'v22.11.0';
  const NODE_TARBALL = `node-${NODE_VERSION}-linux-x64.tar.xz`;
  const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}`;
  await runCommand(
    client,
    machineId,
    `set -euo pipefail
cd /home/machine
if [ ! -x /home/machine/node/bin/node ]; then
  curl -fsSL -o /home/machine/${NODE_TARBALL} ${NODE_URL}
  tar -xJf /home/machine/${NODE_TARBALL} -C /home/machine/
  mv /home/machine/node-${NODE_VERSION}-linux-x64 /home/machine/node
  rm -f /home/machine/${NODE_TARBALL}
fi
/home/machine/node/bin/node -v && /home/machine/node/bin/npm -v`,
    { timeoutMs: 600_000, label: 'install node 22' },
  );

  const local = await readLocalEnv();
  const { body: envBody, refreshToken } = buildRemoteEnv(local);

  console.log('[provision] uploading proxy files...');
  await uploadFile(client, machineId, {
    localPath: resolve(PROXY_DIR, 'index.js'),
    remotePath: `${REMOTE_BASE}/index.js`,
    readFile,
  });
  await uploadFile(client, machineId, {
    localPath: resolve(PROXY_DIR, 'package.json'),
    remotePath: `${REMOTE_BASE}/package.json`,
    readFile,
  });

  console.log('[provision] writing .env...');
  const envB64 = Buffer.from(envBody).toString('base64');
  const envChunks = [];
  for (let i = 0; i < envB64.length; i += 1000) envChunks.push(envB64.slice(i, i + 1000));
  await runCommand(
    client,
    machineId,
    `set -euo pipefail
mkdir -p ${REMOTE_BASE}/data
cat <<'___EOF___' | base64 -d > ${REMOTE_BASE}/.env
${envChunks.join('\n')}
___EOF___
chmod 600 ${REMOTE_BASE}/.env
echo wrote .env $(stat -c%s ${REMOTE_BASE}/.env) bytes`,
    { label: 'write .env' },
  );

  console.log('[provision] writing start.sh...');
  await runCommand(
    client,
    machineId,
    `cat > ${REMOTE_BASE}/start.sh <<'___START___'
#!/bin/bash
export PATH=/home/machine/node/bin:$PATH
cd ${REMOTE_BASE}
set -a
. ${REMOTE_BASE}/.env
set +a
exec /home/machine/node/bin/node --experimental-sqlite index.js
___START___
chmod +x ${REMOTE_BASE}/start.sh`,
    { label: 'write start.sh' },
  );

  console.log('[provision] launching proxy...');
  // Write a one-shot launcher script then run it so the background process
  // is fully detached before the exec-API call returns. Keeping the shell
  // open with & inside a single exec command can leave file descriptors
  // attached to the exec service and cause subsequent executions to fail.
  await runCommand(
    client,
    machineId,
    `set -euo pipefail
pkill -f 'node.*index.js' 2>/dev/null || true
sleep 1
mkdir -p ${REMOTE_BASE}/data
nohup bash ${REMOTE_BASE}/start.sh > ${REMOTE_BASE}/server.log 2>&1 &
PROXY_PID=$!
disown $PROXY_PID 2>/dev/null || true
echo "proxy launched pid=$PROXY_PID"`,
    { label: 'start proxy' },
  );

  console.log('[provision] giving it 5s to come up...');
  await new Promise((r) => setTimeout(r, 5000));

  console.log('[provision] checking local listen + log tail...');
  await runCommand(
    client,
    machineId,
    `ss -lntp 2>/dev/null | grep :8787 || echo "NOT LISTENING (yet)"
echo "--- log tail ---"
tail -n 50 ${REMOTE_BASE}/server.log 2>/dev/null || echo "(no log yet)"
pgrep -a node 2>/dev/null || echo "(no node process)"`,
    { label: 'listen check' },
  );
  await runCommand(
    client,
    machineId,
    `curl -fsS http://127.0.0.1:8787/health 2>&1 || (echo "HEALTH FAILED"; tail -n 50 ${REMOTE_BASE}/server.log 2>/dev/null)`,
    { label: 'local health' },
  );

  console.log('[provision] creating public preview for :8787...');
  const preview = await client.machines.previews.create(
    { machine_id: machineId, port: 8787, protocol: 'https', visibility: 'public' },
    { headers: { 'Idempotency-Key': idem() } },
  );
  console.log(`[provision] preview ${JSON.stringify(preview)}`);

  console.log('\n===== DONE =====');
  console.log(`machine_id:         ${machineId}`);
  console.log(`warmer refresh tok: ${refreshToken}`);
  console.log(`preview url:        ${preview.url ?? '(pending — re-fetch in 5s)'}`);
  console.log('\nNext: paste the preview URL as PROXY_ORIGIN in the extension.');
}

main().catch((err) => {
  console.error('[provision] FAILED:', err?.status ?? '', err?.message ?? err);
  if (err?.error) console.error('[provision] body:', JSON.stringify(err.error));
  process.exit(1);
});
