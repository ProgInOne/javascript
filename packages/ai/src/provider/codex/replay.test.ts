import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAdapter } from './adapter.ts';
import { PROTOCOL_CODEX_VERSION } from './protocol.ts';
import { RECORDED_SCENARIOS, type ScenarioOutcome } from './testing/scenarios.ts';

// Codex protocol contract tests with recorded replay (docs/design/ai-system.md#codex-프로토콜-계약-테스트).
// The fixtures are real `codex app-server` exchanges recorded by testing/record-codex.ts and
// scrubbed; testing/replay-codex.mjs plays them back. Each test runs the same scenario steps that
// were recorded and checks (1) the adapter still sends the recorded protocol messages and (2) it
// reads the real server messages correctly (status, usage, streamed text, token usage, interrupt,
// lost threads).

const REPLAY = fileURLToPath(new URL('./testing/replay-codex.mjs', import.meta.url));
const RECORDINGS = fileURLToPath(
  new URL(`./testing/recordings/${PROTOCOL_CODEX_VERSION}/`, import.meta.url),
);

interface Entry {
  dir: 'c2s' | 's2c';
  msg: Record<string, unknown> & { method?: string; params?: Record<string, unknown> };
}

function fixture(name: string): Entry[] {
  return readFileSync(join(RECORDINGS, `${name}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => JSON.parse(l) as Entry);
}

const adapters: CodexAdapter[] = [];
afterEach(async () => {
  await Promise.all(adapters.splice(0).map((a) => a.dispose()));
});

async function replay(name: string): Promise<{ outcome: ScenarioOutcome; sent: Entry['msg'][] }> {
  const scenario = RECORDED_SCENARIOS.find((s) => s.name === name);
  if (!scenario) throw new Error(`unknown scenario ${name}`);
  const dir = mkdtempSync(join(tmpdir(), 'proginone-codex-replay-'));
  const logPath = join(dir, 'client.log');
  const adapter = new CodexAdapter({
    codexPath: REPLAY,
    dataDir: join(dir, 'data'),
    env: {
      ...process.env,
      REPLAY_CODEX_FIXTURE: join(RECORDINGS, `${name}.jsonl`),
      REPLAY_CODEX_LOG: logPath,
    },
    clientVersion: '0.0.0-contract',
    interruptTimeoutMs: 2_000,
  });
  adapters.push(adapter);
  const outcome = await scenario.run(adapter);
  await adapter.dispose();
  const sent = existsSync(logPath)
    ? readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Entry['msg'])
    : [];
  return { outcome, sent };
}

/** Client methods in order (requests and notifications), as recorded or as sent. */
const methods = (msgs: Entry['msg'][]) =>
  msgs.filter((m) => typeof m.method === 'string').map((m) => m.method);

const recordedClient = (entries: Entry[]) =>
  entries.filter((e) => e.dir === 'c2s').map((e) => e.msg);

const serverNotifications = (entries: Entry[], method: string) =>
  entries.filter((e) => e.dir === 's2c' && e.msg.method === method).map((e) => e.msg.params ?? {});

const finalText = (entries: Entry[]) =>
  serverNotifications(entries, 'item/completed')
    .map((p) => p['item'] as { type: string; text?: string })
    .filter((i) => i.type === 'agentMessage')
    .map((i) => i.text ?? '');

const lastUsage = (entries: Entry[]) =>
  serverNotifications(entries, 'thread/tokenUsage/updated').map(
    (p) =>
      (p['tokenUsage'] as { last: Record<string, number> }).last as {
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        reasoningOutputTokens: number;
      },
  );

describe('Codex protocol contract (recorded replay)', () => {
  it('has a recording for every scenario', () => {
    const files = readdirSync(RECORDINGS).map((f) => f.replace(/\.jsonl$/, ''));
    expect(files.sort()).toEqual(RECORDED_SCENARIOS.map((s) => s.name).sort());
  });

  it('login-logged-out: reads a logged-out account, starts and cancels the ChatGPT login', async () => {
    const entries = fixture('login-logged-out');
    const { outcome, sent } = await replay('login-logged-out');
    expect(outcome.status).toBe('logged_out');
    expect(outcome.steps).toEqual([
      { status: { state: 'logged_out' } },
      { usage: null },
      { loginStarted: true, pending: true },
      { pendingAfterCancel: null },
    ]);
    expect(methods(sent)).toEqual(methods(recordedClient(entries)));
    const init = sent.find((m) => m.method === 'initialize');
    expect(init?.params).toMatchObject({
      clientInfo: { name: 'proginone' },
      capabilities: { experimentalApi: false },
    });
  });

  it('startup-ready: reads the account plan, rate limits and visible models', async () => {
    const entries = fixture('startup-ready');
    const { outcome, sent } = await replay('startup-ready');
    expect(outcome.status).toBe('ready');
    const [status, usage, models] = outcome.steps as [
      { status: unknown },
      { usage: { windows: { usedPercent: number; resetsAt: string | null }[] } },
      { models: { id: string; isDefault: boolean }[] },
    ];
    expect(status.status).toEqual({ state: 'ready', planType: 'pro' });
    // Usage comes only from what Codex reported (docs: 사용량 표시와 한도 처리).
    const limits = entries.find(
      (e) =>
        e.dir === 's2c' && (e.msg['result'] as { rateLimits?: unknown } | undefined)?.rateLimits,
    )?.msg['result'] as { rateLimits: { primary: { usedPercent: number; resetsAt: number } } };
    expect(usage.usage.windows[0]?.usedPercent).toBe(limits.rateLimits.primary.usedPercent);
    expect(usage.usage.windows[0]?.resetsAt).toBe(
      new Date(limits.rateLimits.primary.resetsAt * 1000).toISOString(),
    );
    expect(models.models.filter((m) => m.isDefault)).toHaveLength(1);
    // One shared rate-limit read even though startup and the caller both asked for usage.
    expect(methods(sent)).toEqual(methods(recordedClient(entries)));
    expect(methods(sent).filter((m) => m === 'account/rateLimits/read')).toHaveLength(1);
  });

  it('turn-stream: isolated ephemeral thread, streamed deltas, final text and token usage', async () => {
    const entries = fixture('turn-stream');
    const { outcome, sent } = await replay('turn-stream');
    const [step] = outcome.steps as [
      { text: string; deltaText: string; deltaCount: number; usage: unknown; toolAttempts: number },
    ];
    expect(step.text).toBe(finalText(entries).join('\n\n'));
    expect(step.deltaText).toBe(step.text);
    expect(step.deltaCount).toBe(serverNotifications(entries, 'item/agentMessage/delta').length);
    const usage = lastUsage(entries).at(-1);
    expect(step.usage).toEqual({
      inputTokens: usage?.inputTokens,
      cachedInputTokens: usage?.cachedInputTokens,
      outputTokens: usage?.outputTokens,
      reasoningTokens: usage?.reasoningOutputTokens,
    });
    expect(step.toolAttempts).toBe(0);
    expect(methods(sent)).toEqual(methods(recordedClient(entries)));
    const start = sent.find((m) => m.method === 'thread/start');
    expect(start?.params).toMatchObject({
      approvalPolicy: 'untrusted',
      sandbox: 'read-only',
      ephemeral: true,
      serviceName: 'proginone',
      config: { web_search: 'disabled' },
    });
  });

  it('turn-structured: passes the output schema and returns the JSON text', async () => {
    const entries = fixture('turn-structured');
    const { outcome, sent } = await replay('turn-structured');
    const [step] = outcome.steps as [{ text: string }];
    expect(step.text).toBe(finalText(entries).join('\n\n'));
    const parsed = JSON.parse(step.text) as { summary: string; nextStep: string };
    expect(parsed.summary.length).toBeGreaterThan(0);
    expect(['retry', 'open_hint', 'review_concept']).toContain(parsed.nextStep);
    const turn = sent.find((m) => m.method === 'turn/start');
    expect(turn?.params).toMatchObject({ effort: 'low', outputSchema: { type: 'object' } });
  });

  it('thread-resume: persistent thread, resume with isolation overrides, lost thread', async () => {
    const entries = fixture('thread-resume');
    const { outcome, sent } = await replay('thread-resume');
    const [first, second, lost] = outcome.steps as [
      { threadId: string; text: string },
      { threadId: string; text: string; usage: { cachedInputTokens: number } },
      { error: string; threadLost: boolean },
    ];
    expect(second.threadId).toBe(first.threadId);
    expect([first.text, second.text]).toEqual(finalText(entries));
    // The resumed turn reuses the cached prompt prefix.
    expect(second.usage.cachedInputTokens).toBeGreaterThan(0);
    expect(lost).toMatchObject({ error: 'AI_PROVIDER_ERROR', threadLost: true });
    expect(methods(sent)).toEqual(methods(recordedClient(entries)));
    const start = sent.find((m) => m.method === 'thread/start');
    expect(start?.params).toMatchObject({ ephemeral: false });
    const resume = sent.filter((m) => m.method === 'thread/resume');
    expect(resume[0]?.params).toMatchObject({
      threadId: first.threadId,
      excludeTurns: true,
      approvalPolicy: 'untrusted',
      sandbox: 'read-only',
    });
  });

  it('turn-interrupt: an abort sends turn/interrupt and ends as cancelled with the partial text', async () => {
    const entries = fixture('turn-interrupt');
    const { outcome, sent } = await replay('turn-interrupt');
    const [step] = outcome.steps as [{ error: string; partialText: string; deltaCount: number }];
    expect(step.error).toBe('AI_CANCELLED');
    expect(step.deltaCount).toBe(1);
    expect(step.partialText.length).toBeGreaterThan(0);
    const completed = serverNotifications(entries, 'turn/completed').at(-1)?.['turn'] as {
      status: string;
    };
    expect(completed.status).toBe('interrupted');
    const interrupt = sent.find((m) => m.method === 'turn/interrupt');
    const started = sent.find((m) => m.method === 'turn/start');
    expect(interrupt?.params).toMatchObject({
      threadId: (started?.params as { threadId: string }).threadId,
    });
    expect(methods(sent)).toEqual(methods(recordedClient(entries)));
  });
});
