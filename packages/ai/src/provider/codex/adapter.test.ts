import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AIStatus } from '@proginone/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { AIError } from '../../errors.ts';
import type { ProviderEvent, ProviderRequest } from '../types.ts';
import { CodexAdapter, type CodexAdapterOptions } from './adapter.ts';
import { TUTOR_CONFIG_TOML } from './home.ts';

// Contract tests against a fake `codex` executable that replays recorded app-server messages
// (testing/fake-codex.mjs). The real Codex never runs in CI.

const FAKE = fileURLToPath(new URL('./testing/fake-codex.mjs', import.meta.url));

interface Scenario {
  account?: { type: string; planType: string } | null;
  version?: string;
  featureOverrides?: Record<string, string>;
  turns?: unknown[];
  exitOnStart?: boolean;
  crashAfterInit?: boolean;
  resumeFails?: boolean;
  threadOverride?: Record<string, unknown>;
  reportedCodexHome?: string;
}

const adapters: CodexAdapter[] = [];
afterEach(async () => {
  await Promise.all(adapters.splice(0).map((a) => a.dispose()));
});

function setup(scenario: Scenario = {}, opts: Partial<CodexAdapterOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'proginone-codex-test-'));
  const logPath = join(dir, 'rpc.log');
  const scenarioPath = join(dir, 'scenario.json');
  writeFileSync(scenarioPath, JSON.stringify({ ...scenario, log: logPath }));
  const dataDir = join(dir, 'data');
  const events: ProviderEvent[] = [];
  const adapter = new CodexAdapter({
    codexPath: FAKE,
    dataDir,
    env: { ...process.env, FAKE_CODEX_SCENARIO: scenarioPath },
    clientVersion: '0.0.0-test',
    backoff: { baseMs: 20, maxMs: 40, jitter: 0, maxFailures: 3 },
    interruptTimeoutMs: 300,
    ...opts,
  });
  adapter.onEvent((e) => events.push(e));
  adapters.push(adapter);
  /** Lines the client sent (and spawn markers). */
  const sent = (): Record<string, unknown>[] =>
    existsSync(logPath)
      ? readFileSync(logPath, 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l) as Record<string, unknown>)
      : [];
  return { adapter, dataDir, events, sent };
}

const request = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  taskName: 'tutor.reply',
  baseInstructions: 'BASE',
  developerInstructions: 'DEV',
  input: '<learner_question>\n왜?\n</learner_question>',
  effort: 'low',
  thread: { kind: 'ephemeral' },
  timeoutMs: 5_000,
  ...over,
});

const delta = (text: string) => ({
  notify: {
    method: 'item/agentMessage/delta',
    params: { threadId: '$thread', turnId: '$turn', itemId: 'i1', delta: text },
  },
});
const item = (phase: 'started' | 'completed', value: Record<string, unknown>) => ({
  notify: {
    method: `item/${phase}`,
    params: { threadId: '$thread', turnId: '$turn', item: value },
  },
});

async function waitFor(check: () => boolean, ms = 3_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('CodexAdapter · startup', () => {
  it('starts lazily in the tutor-only home with the feature bundle and reads the account', async () => {
    const { adapter, dataDir, sent } = setup();
    expect(adapter.currentStatus()).toEqual({ state: 'idle' });
    const status = await adapter.connect();
    expect(status).toEqual({ state: 'ready', planType: 'pro' });
    expect(readFileSync(join(dataDir, 'codex-home', 'config.toml'), 'utf8')).toBe(
      TUTOR_CONFIG_TOML,
    );
    expect(readdirSync(join(dataDir, 'codex-workspace'))).toEqual([]);
    const lines = sent();
    expect(lines[0]).toMatchObject({ codexHome: join(dataDir, 'codex-home') });
    expect(lines.find((l) => l['method'] === 'initialize')).toMatchObject({
      params: {
        clientInfo: { name: 'proginone' },
        capabilities: { experimentalApi: false },
      },
    });
    expect(lines.some((l) => l['method'] === 'initialized')).toBe(true);
    const usage = await adapter.usage();
    expect(usage?.highestUsedPercent).toBe(12);
    expect(usage?.windows[0]?.resetsAt).toBe('2025-11-13T08:00:00.000Z');
  });

  it('reports not_installed when the executable is missing', async () => {
    const { adapter } = setup({}, { codexPath: '/nonexistent/codex' });
    expect((await adapter.connect()).state).toBe('not_installed');
    const error = (await adapter
      .run(request(), { signal: new AbortController().signal })
      .catch((e: unknown) => e)) as AIError;
    expect(error.code).toBe('AI_UNAVAILABLE');
  });

  it('reports an unsupported version', async () => {
    const { adapter } = setup({ version: 'codex-cli 0.150.0' });
    expect(await adapter.connect()).toEqual({
      state: 'unsupported_version',
      found: '0.150.0',
      required: '0.155.1',
    });
  });

  it('refuses the tutor when a tool feature is enabled', async () => {
    const { adapter, sent } = setup({ featureOverrides: { shell_tool: 'true' } });
    const status = await adapter.connect();
    expect(status.state).toBe('isolation_failed');
    expect((status as Extract<AIStatus, { state: 'isolation_failed' }>).problems.join()).toContain(
      'shell_tool',
    );
    // app-server is never spawned
    expect(sent().some((l) => 'spawn' in l)).toBe(false);
    const error = (await adapter
      .run(request(), { signal: new AbortController().signal })
      .catch((e: unknown) => e)) as AIError;
    expect(error.code).toBe('AI_UNAVAILABLE');
    expect(error.details).toMatchObject({ reason: 'isolation_failed' });
  });

  it('refuses the tutor when an unknown feature is enabled', async () => {
    const { adapter } = setup({ featureOverrides: { brand_new_tool: 'true' } });
    const status = await adapter.connect();
    expect(status.state).toBe('isolation_failed');
  });

  it('refuses when app-server reports another CODEX_HOME', async () => {
    const { adapter } = setup({ reportedCodexHome: '/somewhere/else' });
    expect((await adapter.connect()).state).toBe('isolation_failed');
  });

  it('reports logged_out and maps runs to AI_NOT_CONNECTED', async () => {
    const { adapter } = setup({ account: null });
    expect(await adapter.connect()).toEqual({ state: 'logged_out' });
    const error = (await adapter
      .run(request(), { signal: new AbortController().signal })
      .catch((e: unknown) => e)) as AIError;
    expect(error.code).toBe('AI_NOT_CONNECTED');
  });
});

describe('CodexAdapter · turns', () => {
  it('starts an isolated thread, streams deltas and returns the final message and usage', async () => {
    const { adapter, sent } = setup({
      turns: [
        {
          steps: [
            {
              notify: {
                method: 'turn/started',
                params: { threadId: '$thread', turn: { id: '$turn' } },
              },
            },
            item('started', { type: 'reasoning', id: 'r1' }),
            delta('total이 '),
            delta('처음에 undefined예요.'),
            item('completed', {
              type: 'agentMessage',
              id: 'i1',
              text: 'total이 처음에 undefined예요.',
            }),
            {
              notify: {
                method: 'thread/tokenUsage/updated',
                params: {
                  threadId: '$thread',
                  turnId: '$turn',
                  tokenUsage: {
                    total: {},
                    last: {
                      totalTokens: 10,
                      inputTokens: 7,
                      cachedInputTokens: 2,
                      cacheWriteInputTokens: 0,
                      outputTokens: 3,
                      reasoningOutputTokens: 1,
                    },
                    modelContextWindow: 1000,
                  },
                },
              },
            },
          ],
        },
      ],
    });
    const deltas: string[] = [];
    const res = await adapter.run(request(), {
      signal: new AbortController().signal,
      onDelta: (t) => deltas.push(t),
    });
    expect(deltas).toEqual(['total이 ', '처음에 undefined예요.']);
    expect(res).toMatchObject({
      text: 'total이 처음에 undefined예요.',
      model: 'gpt-fake',
      providerThreadId: 'thread-1',
      providerTurnId: 'turn-1',
      usage: { inputTokens: 7, cachedInputTokens: 2, outputTokens: 3, reasoningTokens: 1 },
      toolAttempts: 0,
    });
    const start = sent().find((l) => l['method'] === 'thread/start');
    expect(start?.['params']).toMatchObject({
      approvalPolicy: 'untrusted',
      sandbox: 'read-only',
      config: { web_search: 'disabled' },
      baseInstructions: 'BASE',
      developerInstructions: 'DEV',
      serviceName: 'proginone',
      ephemeral: true,
    });
    expect((start?.['params'] as { cwd: string }).cwd).toMatch(/codex-workspace$/);
    expect(sent().find((l) => l['method'] === 'turn/start')?.['params']).toMatchObject({
      threadId: 'thread-1',
      effort: 'low',
      input: [
        { type: 'text', text: '<learner_question>\n왜?\n</learner_question>', text_elements: [] },
      ],
    });
  });

  it('auto-declines every server request and discards the turn', async () => {
    const { adapter, sent } = setup({
      turns: [
        {
          steps: [
            delta('먼저 ls로 '),
            {
              request: {
                method: 'item/commandExecution/requestApproval',
                params: { threadId: '$thread', turnId: '$turn', itemId: 'c1', command: 'ls' },
              },
            },
            {
              request: {
                method: 'item/tool/call',
                params: { threadId: '$thread', turnId: '$turn' },
              },
            },
            {
              request: { method: 'mcpServer/elicitation/request', params: { threadId: '$thread' } },
            },
            { request: { method: 'execCommandApproval', params: { conversationId: 'x' } } },
            { request: { method: 'some/new/request', params: {} } },
            { waitInterrupt: true },
          ],
        },
      ],
    });
    const error = (await adapter
      .run(request(), { signal: new AbortController().signal })
      .catch((e: unknown) => e)) as AIError;
    expect(error).toBeInstanceOf(AIError);
    expect(error).toMatchObject({ code: 'AI_BAD_OUTPUT', toolAttempt: true });
    const replies = sent().filter((l) => 'id' in l && !('method' in l));
    expect(replies.map((r) => r['result'] ?? r['error'])).toEqual([
      { decision: 'decline' },
      { success: false, contentItems: [] },
      { action: 'decline', content: null, _meta: null },
      { decision: { denied: { rejection: 'ProgInOne 튜터는 도구를 사용하지 않습니다.' } } },
      { code: -32601, message: 'Method not found' },
    ]);
    expect(sent().some((l) => l['method'] === 'turn/interrupt')).toBe(true);
  });

  it.each([
    'commandExecution',
    'fileChange',
    'mcpToolCall',
    'webSearch',
    'dynamicToolCall',
    'collabAgentToolCall',
    'imageGeneration',
    'somethingNew',
  ])('interrupts immediately when a %s item appears and discards the text', async (type) => {
    const { adapter, sent } = setup({
      turns: [
        {
          steps: [
            delta('날씨를 찾아볼게요'),
            item('started', { type, id: 't1' }),
            { waitInterrupt: true },
          ],
        },
      ],
    });
    const error = (await adapter
      .run(request(), { signal: new AbortController().signal })
      .catch((e: unknown) => e)) as AIError;
    expect(error).toMatchObject({ code: 'AI_BAD_OUTPUT', toolAttempt: true });
    const interrupt = sent().find((l) => l['method'] === 'turn/interrupt');
    expect(interrupt?.['params']).toEqual({ threadId: 'thread-1', turnId: 'turn-1' });
  });

  it('cancels with turn/interrupt and keeps the partial text', async () => {
    const { adapter, sent } = setup({
      turns: [{ steps: [delta('반복문은 '), { waitInterrupt: true }] }],
    });
    const controller = new AbortController();
    const error = (await adapter
      .run(request(), {
        signal: controller.signal,
        onDelta: () => {
          controller.abort();
        },
      })
      .catch((e: unknown) => e)) as AIError;
    expect(error).toMatchObject({ code: 'AI_CANCELLED', partialText: '반복문은 ' });
    expect(sent().some((l) => l['method'] === 'turn/interrupt')).toBe(true);
  });

  it('finishes locally when turn/interrupt gets no turn/completed in time', async () => {
    const { adapter } = setup({
      turns: [{ steps: [delta('a'), { waitInterrupt: true, ignoreInterrupt: true }] }],
    });
    const controller = new AbortController();
    const started = Date.now();
    const error = (await adapter
      .run(request(), {
        signal: controller.signal,
        onDelta: () => {
          controller.abort();
        },
      })
      .catch((e: unknown) => e)) as AIError;
    expect(error.code).toBe('AI_CANCELLED');
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it('times out when the first delta does not arrive', async () => {
    const { adapter } = setup({ turns: [{ steps: [{ waitInterrupt: true }] }] });
    const error = (await adapter
      .run(request({ firstDeltaTimeoutMs: 100 }), { signal: new AbortController().signal })
      .catch((e: unknown) => e)) as AIError;
    expect(error.code).toBe('AI_TIMEOUT');
  });

  it('rejects a thread whose effective sandbox is not read-only', async () => {
    const { adapter } = setup({ threadOverride: { sandbox: { type: 'dangerFullAccess' } } });
    const error = (await adapter
      .run(request(), { signal: new AbortController().signal })
      .catch((e: unknown) => e)) as AIError;
    expect(error.code).toBe('AI_UNAVAILABLE');
    expect(adapter.currentStatus().state).toBe('isolation_failed');
  });

  it('resumes persistent threads and reports a lost one', async () => {
    const ok = setup({ turns: [{ steps: [delta('네')] }] });
    const res = await ok.adapter.run(
      request({ thread: { kind: 'persistent', resumeId: 'thread-9' } }),
      {
        signal: new AbortController().signal,
      },
    );
    expect(res.providerThreadId).toBe('thread-9');
    expect(ok.sent().find((l) => l['method'] === 'thread/resume')?.['params']).toMatchObject({
      threadId: 'thread-9',
      approvalPolicy: 'untrusted',
      sandbox: 'read-only',
      excludeTurns: true,
    });

    const lost = setup({ resumeFails: true });
    const error = (await lost.adapter
      .run(request({ thread: { kind: 'persistent', resumeId: 'gone' } }), {
        signal: new AbortController().signal,
      })
      .catch((e: unknown) => e)) as AIError;
    expect(error.threadLost).toBe(true);
  });

  it('maps usageLimitExceeded to AI_RATE_LIMITED and the rate_limited state', async () => {
    const { adapter } = setup({
      turns: [
        {
          steps: [],
          status: 'failed',
          error: {
            message: 'limit',
            codexErrorInfo: 'usageLimitExceeded',
            additionalDetails: null,
          },
        },
      ],
    });
    await adapter.connect();
    await adapter.usage();
    const error = (await adapter
      .run(request(), { signal: new AbortController().signal })
      .catch((e: unknown) => e)) as AIError;
    expect(error.code).toBe('AI_RATE_LIMITED');
    expect(adapter.currentStatus()).toEqual({
      state: 'rate_limited',
      resetsAt: '2025-11-13T08:00:00.000Z',
    });
  });

  it('maps unauthorized to AI_UNAUTHORIZED and logged_out', async () => {
    const { adapter } = setup({
      turns: [
        {
          steps: [],
          status: 'failed',
          error: { message: 'no', codexErrorInfo: 'unauthorized', additionalDetails: null },
        },
      ],
    });
    const error = (await adapter
      .run(request(), { signal: new AbortController().signal })
      .catch((e: unknown) => e)) as AIError;
    expect(error.code).toBe('AI_UNAUTHORIZED');
    expect(adapter.currentStatus().state).toBe('logged_out');
  });
});

describe('CodexAdapter · process lifecycle', () => {
  it('fails the running turn when the process crashes and restarts with backoff', async () => {
    const { adapter, sent } = setup({ turns: [{ steps: [delta('a'), { crash: true }] }] });
    const error = (await adapter
      .run(request(), { signal: new AbortController().signal })
      .catch((e: unknown) => e)) as AIError;
    expect(error.code).toBe('AI_PROVIDER_ERROR');
    expect(adapter.currentStatus().state).toBe('starting');
    await waitFor(() => adapter.currentStatus().state === 'ready');
    expect(sent().filter((l) => 'spawn' in l)).toHaveLength(2);
  });

  it('gives up after repeated failures and recovers with reconnect', async () => {
    const { adapter, sent } = setup({ crashAfterInit: true });
    await adapter.connect();
    await waitFor(() => adapter.currentStatus().state === 'error', 5_000);
    expect(adapter.currentStatus()).toMatchObject({ state: 'error', code: 'AI_UNAVAILABLE' });
    const spawns = sent().filter((l) => 'spawn' in l).length;
    expect(spawns).toBe(3);
    // backoff delays grow: 20ms then 40ms (capped)
    await adapter.reconnect();
    expect(sent().filter((l) => 'spawn' in l).length).toBeGreaterThan(spawns);
  });
});

describe('CodexAdapter · account', () => {
  it('runs the official ChatGPT login flow and emits completion', async () => {
    const { adapter, events, sent } = setup({ account: null });
    expect((await adapter.connect()).state).toBe('logged_out');
    const login = await adapter.login();
    expect(login).toEqual({ loginId: 'login-1', authUrl: 'https://auth.openai.com/fake' });
    expect(adapter.pendingLogin()?.loginId).toBe('login-1');
    expect(sent().find((l) => l['method'] === 'account/login/start')?.['params']).toEqual({
      type: 'chatgpt',
    });
    await waitFor(() => adapter.currentStatus().state === 'ready');
    expect(events).toContainEqual({
      type: 'login',
      login: { loginId: 'login-1', success: true, error: null },
    });
    expect(adapter.pendingLogin()).toBeNull();
  });

  it('logs out', async () => {
    const { adapter } = setup();
    await adapter.connect();
    await adapter.logout();
    expect(adapter.currentStatus().state).toBe('logged_out');
  });

  it('lists visible models only', async () => {
    const { adapter } = setup();
    expect(await adapter.listModels()).toEqual([
      {
        id: 'gpt-fake',
        displayName: 'GPT Fake',
        description: '기본',
        isDefault: true,
        supportedEfforts: ['low', 'medium'],
      },
    ]);
  });
});
