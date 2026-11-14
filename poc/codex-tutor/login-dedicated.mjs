// Official ChatGPT login for the dedicated CODEX_HOME via app-server (account/login/start, type chatgpt).
// Prints the authUrl, then waits (max 30 min) for account/login/completed.
import { CodexClient } from './client.mjs';
import { resolve } from 'node:path';
const c = new CodexClient({ env: { ...process.env, CODEX_HOME: resolve('codex-home') } });
await c.initialize();
const done = new Promise((r) => c.on((ev) => {
  if (ev.method === 'account/login/completed') r(ev.params);
}));
const res = await c.request('account/login/start', { type: 'chatgpt' });
console.log('loginId:', res.loginId);
console.log('AUTH_URL:', res.authUrl);
const result = await Promise.race([done, new Promise((r) => setTimeout(() => r({ timeout: true }), 1800000))]);
console.log('login result:', JSON.stringify({ success: result.success, error: result.error, timeout: result.timeout }));
const acct = await c.request('account/read', { refreshToken: false });
console.log('dedicated loggedIn:', !!acct.account, 'plan:', acct.account?.planType);
await c.close();
