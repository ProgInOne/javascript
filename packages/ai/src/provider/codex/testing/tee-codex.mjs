#!/usr/bin/env node
// Recording wrapper around the real `codex` executable (used only by record-codex.ts, never in
// CI). The adapter runs it as its Codex path: `--version` and `features list` pass through;
// `app-server` spawns the real app-server and appends every JSONL line it relays to
// TEE_CODEX_RECORD as `{"dir":"c2s"|"s2c","line":"..."}`. The raw file holds unscrubbed data
// (account, paths) and stays in a temporary directory; scrub-recording.mjs turns it into a
// committed fixture.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const real = process.env.TEE_CODEX_REAL;
const record = process.env.TEE_CODEX_RECORD;
if (!real || !record) {
  process.stderr.write('TEE_CODEX_REAL and TEE_CODEX_RECORD are required\n');
  process.exit(2);
}

const args = process.argv.slice(2);
const child = spawn(real, args, {
  stdio: args[0] === 'app-server' ? ['pipe', 'pipe', 'inherit'] : 'inherit',
});

if (args[0] === 'app-server') {
  const log = (dir, line) => {
    if (line.trim() !== '') appendFileSync(record, `${JSON.stringify({ dir, line })}\n`);
  };
  createInterface({ input: process.stdin }).on('line', (line) => {
    log('c2s', line);
    child.stdin.write(`${line}\n`);
  });
  process.stdin.on('end', () => child.stdin.end());
  createInterface({ input: child.stdout }).on('line', (line) => {
    log('s2c', line);
    process.stdout.write(`${line}\n`);
  });
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => child.kill(sig));
}
