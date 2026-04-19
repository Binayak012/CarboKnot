// Shared helpers for Dedalus Machine orchestration scripts.
//
// Centralises: client construction, idempotency-key generation, exec-and-wait,
// base64 file uploads. Keep this thin so provision / destroy / probe scripts
// stay obvious.

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import Dedalus from 'dedalus';

export function buildClient() {
  const key = process.env.DEDALUS_API_KEY;
  if (!key) {
    console.error('[lib] DEDALUS_API_KEY missing');
    process.exit(2);
  }
  return new Dedalus({ apiKey: key });
}

export function idem() { return randomUUID(); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitForPhase(client, machineId, target, { timeoutMs = 300_000, intervalMs = 2000 } = {}) {
  const started = Date.now();
  // Tolerate either string or array of targets.
  const targets = Array.isArray(target) ? target : [target];
  while (Date.now() - started < timeoutMs) {
    const dm = await client.machines.retrieve({ machine_id: machineId });
    const phase = dm.status?.phase;
    const reason = dm.status?.reason ?? '-';
    process.stdout.write(`  phase=${phase} reason=${reason}\n`);
    if (targets.includes(phase)) return dm;
    if (phase === 'failed' || phase === 'destroyed') {
      throw new Error(`machine entered terminal phase=${phase} reason=${reason}`);
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for phase=${targets.join('|')}`);
}

// Run a shell command on the machine and wait for it to finish.
// Returns { exit_code, stdout, stderr }. Logs stdout/stderr when `log=true`.
export async function runCommand(client, machineId, cmd, { timeoutMs = 600_000, log = true, label } = {}) {
  const command = Array.isArray(cmd) ? cmd : ['/bin/bash', '-c', cmd];
  const tag = label ?? (Array.isArray(cmd) ? cmd.slice(0, 2).join(' ') : cmd.slice(0, 60));
  if (log) console.log(`[exec] ${tag}`);
  const exec = await client.machines.executions.create({ machine_id: machineId, command });
  const execId = exec.execution_id ?? exec.id;

  const started = Date.now();
  let result = exec;
  while (!['succeeded', 'failed'].includes(result.status)) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`exec timeout (${tag})`);
    }
    await sleep(1500);
    result = await client.machines.executions.retrieve({ machine_id: machineId, execution_id: execId });
  }

  const output = await client.machines.executions.output({ machine_id: machineId, execution_id: execId });
  const stdout = output.stdout ?? '';
  const stderr = output.stderr ?? '';
  const exitCode = output.exit_code ?? result.exit_code ?? (result.status === 'succeeded' ? 0 : 1);

  if (log) {
    if (stdout.trim()) console.log(`  stdout: ${truncate(stdout, 600)}`);
    if (stderr.trim()) console.log(`  stderr: ${truncate(stderr, 600)}`);
    console.log(`  status=${result.status} exit=${exitCode}`);
  }
  return { status: result.status, exit_code: exitCode, stdout, stderr };
}

// Write a local file's contents to a remote absolute path via base64.
// Safe for JS + .env payloads; do not use for multi-megabyte blobs.
export async function uploadFile(client, machineId, { localPath, remotePath, readFile }) {
  const buf = await readFile(localPath);
  const b64 = Buffer.from(buf).toString('base64');
  // Chunk base64 into lines of 1000 chars to avoid any CLI edge cases.
  const chunks = [];
  for (let i = 0; i < b64.length; i += 1000) chunks.push(b64.slice(i, i + 1000));
  const heredoc = chunks.join('\n');
  const dir = remotePath.replace(/\/[^/]+$/, '');
  const script = `set -euo pipefail
mkdir -p '${dir}'
cat <<'___B64_EOF___' | base64 -d > '${remotePath}'
${heredoc}
___B64_EOF___
echo wrote ${remotePath} $(stat -c%s '${remotePath}') bytes`;
  return runCommand(client, machineId, script, { label: `upload ${remotePath}` });
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n) + `... [+${s.length - n} chars]`;
}
