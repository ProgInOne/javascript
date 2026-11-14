#!/usr/bin/env node
// Fake `codex` executable for contract tests (never the real Codex in CI). Speaks the app-server
// JSONL protocol of codex-cli 0.155.1 as recorded in M1-A, scripted by the JSON file in
// FAKE_CODEX_SCENARIO. Every line the client sends is appended to `scenario.log` so tests can
// assert requests and auto-deny replies.
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const scenario = JSON.parse(readFileSync(process.env.FAKE_CODEX_SCENARIO ?? '', 'utf8'));
const args = process.argv.slice(2);
const out = (text) => process.stdout.write(text);

if (args[0] === '--version') {
  out(`${scenario.version ?? 'codex-cli 0.155.1'}\n`);
  process.exit(0);
}
if (args[0] === 'features' && args[1] === 'list') {
  const file = scenario.featuresFile ?? new URL('./features-0.155.1.txt', import.meta.url);
  let text = readFileSync(file, 'utf8');
  for (const [name, value] of Object.entries(scenario.featureOverrides ?? {})) {
    const line = new RegExp(`^${name}\\s.*$`, 'm');
    const replacement = `${name.padEnd(41)}stable             ${value}`;
    text = line.test(text) ? text.replace(line, replacement) : `${text}${replacement}\n`;
  }
  out(text);
  process.exit(0);
}
if (args[0] !== 'app-server') process.exit(2);

const log = (entry) => {
  if (scenario.log) appendFileSync(scenario.log, `${JSON.stringify(entry)}\n`);
};
log({ spawn: process.pid, codexHome: process.env.CODEX_HOME, cwd: process.cwd() });
if (scenario.exitOnStart) process.exit(3);

const send = (msg) => out(`${JSON.stringify(msg)}\n`);
let account =
  scenario.account === undefined ? { type: 'chatgpt', planType: 'pro' } : scenario.account;
let threadSeq = 0;
let turnSeq = 0;
let serverReqSeq = 1000;
const turns = [...(scenario.turns ?? [])];
const waitingReplies = new Map();
let pendingInterrupt = null;
let interruptedEarly = false;

const sub = (value, ctx) =>
  JSON.parse(
    JSON.stringify(value).replaceAll('$thread', ctx.threadId).replaceAll('$turn', ctx.turnId),
  );

async function playTurn(ctx, script) {
  for (const step of script.steps ?? []) {
    if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
    if (step.notify) send(sub(step.notify, ctx));
    if (step.request) {
      const id = serverReqSeq++;
      const reply = new Promise((resolve) => waitingReplies.set(id, resolve));
      send({ id, ...sub(step.request, ctx) });
      await reply;
    }
    if (step.crash) process.exit(9);
    if (step.waitInterrupt) {
      if (!interruptedEarly) await new Promise((resolve) => (pendingInterrupt = resolve));
      interruptedEarly = false;
      if (step.ignoreInterrupt) return;
      send({
        method: 'turn/completed',
        params: {
          threadId: ctx.threadId,
          turn: { id: ctx.turnId, status: 'interrupted', error: null },
        },
      });
      return;
    }
  }
  if (script.complete !== false) {
    send({
      method: 'turn/completed',
      params: {
        threadId: ctx.threadId,
        turn: { id: ctx.turnId, status: script.status ?? 'completed', error: script.error ?? null },
      },
    });
  }
}

function threadResponse(params, threadId) {
  return {
    thread: { id: threadId },
    model: params.model ?? 'gpt-fake',
    modelProvider: 'openai',
    cwd: params.cwd,
    approvalPolicy: params.approvalPolicy ?? 'on-request',
    sandbox: { type: 'readOnly', networkAccess: false },
    ...(scenario.threadOverride ?? {}),
  };
}

createInterface({ input: process.stdin }).on('line', (line) => {
  log(JSON.parse(line));
  const msg = JSON.parse(line);
  if (msg.id !== undefined && msg.method === undefined) {
    waitingReplies.get(msg.id)?.(msg);
    waitingReplies.delete(msg.id);
    return;
  }
  if (msg.id === undefined) return; // client notification (`initialized`)
  const reply = (result) => send({ id: msg.id, result });
  const fail = (code, message) => send({ id: msg.id, error: { code, message } });
  const p = msg.params ?? {};
  switch (msg.method) {
    case 'initialize':
      reply({
        userAgent: 'codex_cli_rs/0.155.1',
        codexHome: scenario.reportedCodexHome ?? process.env.CODEX_HOME,
        platformFamily: 'unix',
        platformOs: 'linux',
      });
      if (scenario.crashAfterInit) setTimeout(() => process.exit(7), 5);
      return;
    case 'account/read':
      return reply({ account, requiresOpenaiAuth: true });
    case 'account/rateLimits/read':
      return reply({
        rateLimits: scenario.rateLimits ?? {
          primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1763020800 },
          secondary: { usedPercent: 3, windowDurationMins: 10080, resetsAt: 1763500000 },
        },
      });
    case 'account/login/start':
      reply({ type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.openai.com/fake' });
      setTimeout(() => {
        account = { type: 'chatgpt', planType: 'pro' };
        send({
          method: 'account/login/completed',
          params: { loginId: 'login-1', success: true, error: null },
        });
        send({ method: 'account/updated', params: { authMode: 'chatgpt', planType: 'pro' } });
      }, 20);
      return;
    case 'account/login/cancel':
      return reply({ status: 'canceled' });
    case 'account/logout':
      account = null;
      reply({});
      send({ method: 'account/updated', params: { authMode: null, planType: null } });
      return;
    case 'model/list':
      return reply({
        data: [
          {
            id: 'gpt-fake',
            displayName: 'GPT Fake',
            description: '기본',
            hidden: false,
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }],
          },
          {
            id: 'gpt-hidden',
            displayName: 'Hidden',
            description: '',
            hidden: true,
            isDefault: false,
            supportedReasoningEfforts: [],
          },
        ],
        nextCursor: null,
      });
    case 'thread/start':
      return reply(threadResponse(p, `thread-${++threadSeq}`));
    case 'thread/resume':
      if (scenario.resumeFails) return fail(-32600, 'thread not found');
      return reply(threadResponse(p, p.threadId));
    case 'turn/start': {
      const turnId = `turn-${++turnSeq}`;
      interruptedEarly = false;
      reply({ turn: { id: turnId, items: [], status: 'inProgress', error: null } });
      const script = turns.shift() ?? { steps: [] };
      void playTurn({ threadId: p.threadId, turnId }, script);
      return;
    }
    case 'turn/interrupt':
      reply({});
      if (pendingInterrupt) pendingInterrupt();
      else interruptedEarly = true;
      pendingInterrupt = null;
      return;
    default:
      return fail(-32601, 'Method not found');
  }
});
