#!/usr/bin/env node
// Fake `codex` executable that replays a recorded app-server exchange (recordings/<version>/*.jsonl,
// made by record-codex.ts from the real Codex). Used by replay.test.ts in CI.
//
// Each recorded client message owns the server messages that followed it until the next client
// message ("segment"); a server response is moved to the request it answers. When the client
// under test sends the k-th request of a method, the replay answers with the k-th recorded
// request's response (its id rewritten) and then plays that request's segment. Placeholders from
// scrubbing ($CODEX_HOME, $WORKSPACE) become the real paths of this run. Read-only requests the
// recording has fewer of reuse their last recorded response; any other unrecorded request fails
// with an error so protocol drift shows up in the test. Every client line is appended to
// REPLAY_CODEX_LOG.
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const fixturePath = process.env.REPLAY_CODEX_FIXTURE;
if (!fixturePath) process.exit(2);
const [metaLine, ...lines] = readFileSync(fixturePath, 'utf8').trim().split('\n');
const meta = JSON.parse(metaLine).meta;
const entries = lines.map((l) => JSON.parse(l));
const args = process.argv.slice(2);
const out = (text) => process.stdout.write(text);

if (args[0] === '--version') {
  out(`codex-cli ${meta.codexVersion}\n`);
  process.exit(0);
}
if (args[0] === 'features' && args[1] === 'list') {
  out(readFileSync(new URL(`./features-${meta.codexVersion}.txt`, import.meta.url), 'utf8'));
  process.exit(0);
}
if (args[0] !== 'app-server') process.exit(2);

const REUSABLE = new Set(['account/read', 'account/rateLimits/read', 'model/list']);
const log = (entry) => {
  if (process.env.REPLAY_CODEX_LOG) {
    appendFileSync(process.env.REPLAY_CODEX_LOG, `${JSON.stringify(entry)}\n`);
  }
};

// ── Index the recording ────────────────────────────────────────────────────────
const kindOf = (msg) =>
  msg.method !== undefined && msg.id !== undefined
    ? 'request'
    : msg.method !== undefined
      ? 'notification'
      : 'response';

/** Client messages in order, each with its response (requests) and its segment. */
const clientMessages = [];
const requestsByRecordedId = new Map();
for (const entry of entries) {
  if (entry.dir === 'c2s') {
    const record = { msg: entry.msg, kind: kindOf(entry.msg), response: null, segment: [] };
    clientMessages.push(record);
    if (record.kind === 'request') requestsByRecordedId.set(entry.msg.id, record);
    continue;
  }
  const kind = kindOf(entry.msg);
  if (kind === 'response' && requestsByRecordedId.has(entry.msg.id)) {
    requestsByRecordedId.get(entry.msg.id).response = entry.msg;
    continue;
  }
  const owner = clientMessages.at(-1);
  if (owner) owner.segment.push(entry.msg);
  else log({ unowned: entry.msg });
}
const keyOf = (record) =>
  record.kind === 'response' ? 'response' : `${record.kind}:${record.msg.method}`;
const byKey = new Map();
for (const record of clientMessages) {
  const key = keyOf(record);
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(record);
}
const seen = new Map();

// ── Replay ─────────────────────────────────────────────────────────────────────
const substitutions = [
  ['$CODEX_HOME', process.env.CODEX_HOME ?? ''],
  ['$WORKSPACE', process.cwd()],
];
const materialize = (msg) => {
  let text = JSON.stringify(msg);
  for (const [token, value] of substitutions) text = text.replaceAll(token, value);
  return JSON.parse(text);
};
const send = (msg) => out(`${JSON.stringify(materialize(msg))}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return;
  const msg = JSON.parse(line);
  log(msg);
  const kind = kindOf(msg);
  const key = kind === 'response' ? 'response' : `${kind}:${msg.method}`;
  const index = seen.get(key) ?? 0;
  seen.set(key, index + 1);
  const recorded = byKey.get(key)?.[index];
  if (!recorded) {
    if (kind !== 'request') return;
    const last = REUSABLE.has(msg.method)
      ? byKey
          .get(key)
          ?.map((r) => r.response)
          .filter(Boolean)
          .at(-1)
      : undefined;
    log({ unrecorded: msg.method, reused: last !== undefined });
    if (last) send({ ...last, id: msg.id });
    else
      send({ id: msg.id, error: { code: -32603, message: `unrecorded request: ${msg.method}` } });
    return;
  }
  if (kind === 'request' && recorded.response) send({ ...recorded.response, id: msg.id });
  for (const next of recorded.segment) send(next);
});
