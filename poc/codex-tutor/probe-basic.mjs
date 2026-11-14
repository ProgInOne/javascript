// E1: initialize, account, rate limits, models. Prints sanitized summary only.
import { CodexClient } from './client.mjs';
const c = new CodexClient();
const init = await c.initialize();
console.log('initialize keys:', Object.keys(init), 'userAgent:', init.userAgent);
const acct = await c.request('account/read', { refreshToken: false });
console.log('account/read keys:', Object.keys(acct), 'authMode:', acct.account?.type, 'plan:', acct.account?.planType, 'requiresOpenaiAuth:', acct.requiresOpenaiAuth);
const rl = await c.request('account/rateLimits/read', undefined).catch((e) => ({ err: e.message }));
console.log('rateLimits:', JSON.stringify(rl).slice(0, 800));
const models = await c.request('model/list', {});
console.log('models:', models.data.map((m) => `${m.id}${m.isDefault ? '*' : ''}${m.hidden ? '(hidden)' : ''} efforts=${(m.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort??e).join('/')}`).join('\n  '));
console.log('stderr lines:', c.stderr.length);
await c.close();
