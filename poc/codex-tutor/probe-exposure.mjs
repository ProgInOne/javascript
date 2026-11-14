// E3 (no model call): which MCP servers / skills / plugins would a tutor thread see?
// Compares the shared CODEX_HOME (user's ~/.codex) with a dedicated empty CODEX_HOME.
import { CodexClient } from './client.mjs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const cwd = mkdtempSync(join(tmpdir(), 'proginone-codex-ws-'));
const dedicated = resolve('codex-home');
mkdirSync(dedicated, { recursive: true });
writeFileSync(join(dedicated, 'config.toml'), [
  'approval_policy = "on-request"',
  'sandbox_mode = "read-only"',
  'web_search = "disabled"',
  '',
].join('\n'));
async function probe(label, env) {
  const c = new CodexClient({ env });
  try {
    const init = await c.initialize();
    const acct = await c.request('account/read', { refreshToken: false });
    const mcp = await c.request('mcpServerStatus/list', {}).catch((e) => ({ err: e.message }));
    const skills = await c.request('skills/list', { cwds: [cwd] }).catch((e) => ({ err: e.message }));
    const plugins = await c.request('plugin/installed', {}).catch((e) => ({ err: e.message }));
    const apps = await c.request('app/list', {}).catch((e) => ({ err: e.message }));
    const count = (x) => (x?.err ? `ERR ${x.err}` : Array.isArray(x?.data) ? x.data.length : JSON.stringify(x).slice(0, 160));
    const skillCount = skills?.err ? `ERR ${skills.err}` : (skills.data || []).reduce((n, e) => n + (e.skills?.length || 0), 0);
    console.log(`== ${label}: codexHome=${init.codexHome === dedicated ? 'dedicated' : 'shared'} loggedIn=${!!acct.account}`);
    console.log(`   mcpServers=${count(mcp)} skills=${skillCount} pluginsInstalled=${count(plugins)} apps=${count(apps)}`);
  } finally { await c.close(); }
}
await probe('shared ~/.codex', process.env);
await probe('dedicated CODEX_HOME', { ...process.env, CODEX_HOME: dedicated });
