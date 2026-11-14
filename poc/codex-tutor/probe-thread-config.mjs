// E2 (no model call): does thread/start honor isolation overrides over the user's global config
// (approval_policy=never, sandbox_mode=danger-full-access)? Inspect the effective settings returned.
import { CodexClient } from './client.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cwd = mkdtempSync(join(tmpdir(), 'proginone-codex-ws-'));
const c = new CodexClient();
await c.initialize();
const variants = {
  defaults: { cwd, ephemeral: true },
  isolated: {
    cwd, ephemeral: true, approvalPolicy: 'untrusted', sandbox: 'read-only', serviceName: 'proginone',
    baseInstructions: 'TEST BASE', developerInstructions: 'TEST DEV', config: { web_search: 'disabled' },
  },
};
for (const [name, params] of Object.entries(variants)) {
  const r = await c.request('thread/start', params);
  const t = r.thread || {};
  const redacted = { ...r, thread: { id: t.id, ephemeral: t.ephemeral, cwd: t.cwd, status: t.status } };
  console.log(`== ${name}`);
  console.log(JSON.stringify(redacted, (k, v) => (k === 'instructionSources' ? v : v), 2).slice(0, 2500));
}
await c.close();
