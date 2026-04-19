// Destroy a single Dedalus Machine by ID.
//
// Usage:
//   DEDALUS_API_KEY=... DM_ID=dm-... node destroy.mjs
//
// Retrieves first, confirms the phase, then calls delete(). Prints the
// final state after the API acks.

import 'dotenv/config';
import Dedalus from 'dedalus';

const API_KEY = process.env.DEDALUS_API_KEY;
const DM_ID = process.env.DM_ID;

if (!API_KEY) { console.error('[destroy] DEDALUS_API_KEY missing'); process.exit(2); }
if (!DM_ID) { console.error('[destroy] DM_ID missing'); process.exit(2); }

const client = new Dedalus({ apiKey: API_KEY });

try {
  const { data: before, response } = await client.machines
    .retrieve({ machine_id: DM_ID })
    .withResponse();
  console.log(`[destroy] before: phase=${before.status?.phase} reason=${before.status?.reason ?? '-'}`);
  const rawEtag = response.headers.get('etag') || response.headers.get('ETag');
  // API rejects weak etags (W/"...") — strip to strong form.
  const strongEtag = rawEtag ? rawEtag.replace(/^W\//, '') : null;
  console.log(`[destroy] etag raw=${rawEtag} strong=${strongEtag ?? '(none)'}`);

  const ifMatch = strongEtag || '*';
  const result = await client.machines.delete({ machine_id: DM_ID, 'If-Match': ifMatch });
  console.log(`[destroy] delete acked.`);
  if (result && typeof result === 'object') {
    console.log(`[destroy] response: ${JSON.stringify(result)}`);
  }

  // Confirm the VM is gone from the active list.
  try {
    const after = await client.machines.retrieve({ machine_id: DM_ID });
    console.log(`[destroy] after: phase=${after.status?.phase} reason=${after.status?.reason ?? '-'}`);
  } catch (err) {
    if (err?.status === 404) {
      console.log('[destroy] machine no longer retrievable (404). Fully destroyed.');
    } else {
      console.log(`[destroy] retrieve after delete errored: ${err?.status} ${err?.message}`);
    }
  }
} catch (err) {
  console.error(`[destroy] FAILED: status=${err?.status} message=${err?.message}`);
  if (err?.error) console.error(`[destroy] body: ${JSON.stringify(err.error)}`);
  process.exit(1);
}
