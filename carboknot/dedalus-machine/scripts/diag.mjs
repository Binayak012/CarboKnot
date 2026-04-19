// Diagnostic: check network reachability + what's on disk.
import { buildClient, runCommand } from './lib.mjs';

const DM_ID = process.env.DM_ID;
if (!DM_ID) { console.error('[diag] DM_ID missing'); process.exit(2); }

const client = buildClient();

await runCommand(client, DM_ID, `ls -la /home/machine/
ls -la /home/machine/node 2>/dev/null | head
echo "--- disk ---"
df -h /home/machine || true
echo "--- curl head ---"
curl -sI https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz | head -n 20 || echo curl-failed
echo "--- curl sample ---"
curl -fsS -o /tmp/test.bin --max-time 60 https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz
ls -la /tmp/test.bin`, { label: 'diag', timeoutMs: 180_000 });
