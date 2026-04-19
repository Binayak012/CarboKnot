// Read-only probe against the Dedalus Machines API.
//
// Verifies three things before we try to do anything billable:
//   1. Our DEDALUS_API_KEY is accepted by the DCS (Machines) API.
//   2. The machine in DM_ID exists and we can see its lifecycle state.
//   3. We can list org-level machine usage (sanity-check the credit story).
//
// No machine is created, woken, destroyed, or executed on. This script
// spends nothing.

import 'dotenv/config';
import Dedalus from 'dedalus';

const API_KEY = process.env.DEDALUS_API_KEY;
const DM_ID = process.env.DM_ID;

if (!API_KEY) {
  console.error('[probe] DEDALUS_API_KEY missing from env');
  process.exit(2);
}
if (!DM_ID) {
  console.error('[probe] DM_ID missing from env (expected e.g. dm-019da323-...)');
  process.exit(2);
}

const client = new Dedalus({ apiKey: API_KEY });

function mask(k) {
  if (!k || k.length < 12) return '***';
  return `${k.slice(0, 12)}...${k.slice(-4)}`;
}

console.log('[probe] DEDALUS_API_KEY =', mask(API_KEY));
console.log('[probe] DM_ID           =', DM_ID);
console.log('[probe] baseURL         = https://dcs.dedaluslabs.ai');
console.log('');

async function step(name, fn) {
  process.stdout.write(`[probe] ${name}... `);
  try {
    const result = await fn();
    console.log('ok');
    return result;
  } catch (err) {
    console.log('FAILED');
    const status = err?.status || err?.response?.status;
    const body = err?.response?.data || err?.error || err?.message;
    console.log(`        status: ${status ?? '(no status)'}`);
    console.log(`        body:   ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    if (status === 401 || status === 403) {
      console.log('        → auth failed; regenerate the key at https://www.dedaluslabs.ai/dashboard/api-keys');
    }
    if (status === 402) {
      console.log('        → insufficient credit; check billing tab');
    }
    if (status === 404) {
      console.log('        → resource not found; verify DM_ID');
    }
    throw err;
  }
}

try {
  const machine = await step('retrieve machine', () =>
    client.machines.retrieve({ machine_id: DM_ID })
  );
  console.log(`        phase:   ${machine.status?.phase ?? 'unknown'}`);
  console.log(`        reason:  ${machine.status?.reason ?? '-'}`);
  console.log(`        vcpu:    ${machine.vcpu ?? '?'}`);
  console.log(`        memory:  ${machine.memory_mib ?? '?'} MiB`);
  console.log(`        storage: ${machine.storage_gib ?? '?'} GiB`);
  console.log(`        created: ${machine.created_at ?? '-'}`);

  // List machines on the org (should at least include ours). Confirms
  // list-scope permission on the key.
  const list = await step('list machines on org', () =>
    client.machines.list()
  );
  const items = Array.isArray(list) ? list : list?.machines || list?.data || [];
  console.log(`        count:   ${items.length}`);

  console.log('');
  console.log('[probe] PASSED. Key is valid for DCS. Machine is reachable.');

  if (machine.status?.phase === 'running') {
    console.log('[probe] Machine is RUNNING. Ready to provision.');
  } else if (machine.status?.phase === 'sleeping') {
    console.log('[probe] Machine is SLEEPING. Will need to wake before provisioning (sub-second, cheap).');
  } else if (machine.status?.phase === 'starting' || machine.status?.phase === 'accepted' || machine.status?.phase === 'placement_pending') {
    console.log('[probe] Machine is still BOOTING. Wait ~30s and re-run.');
  } else if (machine.status?.phase === 'failed') {
    console.log('[probe] Machine is in FAILED state. Destroy and recreate.');
    process.exit(3);
  } else {
    console.log(`[probe] Unexpected phase: ${machine.status?.phase}. Proceed cautiously.`);
  }
} catch (_err) {
  process.exit(1);
}
