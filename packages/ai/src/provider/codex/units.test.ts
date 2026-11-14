import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AIError } from '../../errors.ts';
import { denyServerRequest } from './deny.ts';
import { parseFeatureList, verifyFeatureFlags } from './features.ts';
import { prepareTutorDirs, TUTOR_CONFIG_TOML } from './home.ts';
import { JsonRpcClient, RpcError } from './rpc.ts';
import { mergeUsage } from './usage.ts';
import { compareVersions, parseCodexVersion } from './version.ts';

const RECORDED_FEATURES = readFileSync(
  new URL('./testing/features-0.155.1.txt', import.meta.url),
  'utf8',
);

describe('feature flag verification', () => {
  it('accepts the flags recorded under the validated bundle (codex-cli 0.155.1)', () => {
    const flags = parseFeatureList(RECORDED_FEATURES);
    expect(flags.length).toBeGreaterThan(100);
    expect(flags.find((f) => f.name === 'shell_tool')).toEqual({
      name: 'shell_tool',
      stage: 'stable',
      enabled: false,
    });
    expect(flags.find((f) => f.name === 'web_search_cached')?.stage).toBe('deprecated');
    expect(verifyFeatureFlags(flags)).toEqual([]);
  });

  it('flags enabled tool features and unknown enabled features', () => {
    const text =
      RECORDED_FEATURES.replace(/^apps\s.*$/m, 'apps    stable   true') +
      'new_thing  under development  true\n';
    const problems = verifyFeatureFlags(parseFeatureList(text));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("'apps'");
    expect(problems[1]).toContain("'new_thing'");
  });

  it('fails closed on empty output', () => {
    expect(verifyFeatureFlags([])).toHaveLength(1);
  });
});

describe('prepareTutorDirs', () => {
  it('writes the bundle, rewrites a tampered file and empties the workspace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proginone-home-'));
    const dirs = { home: join(dir, 'codex-home'), workspace: join(dir, 'codex-workspace') };
    expect(prepareTutorDirs(dirs)).toEqual({ configRewritten: true, workspaceCleared: false });
    expect(prepareTutorDirs(dirs).configRewritten).toBe(false);
    writeFileSync(join(dirs.home, 'config.toml'), '[features]\nshell_tool = true\n');
    mkdirSync(join(dirs.workspace, 'sub'));
    expect(prepareTutorDirs(dirs)).toEqual({ configRewritten: true, workspaceCleared: true });
    expect(readFileSync(join(dirs.home, 'config.toml'), 'utf8')).toBe(TUTOR_CONFIG_TOML);
    expect(readdirSync(dirs.workspace)).toEqual([]);
  });

  it('matches the validated PoC bundle setting for setting', () => {
    const poc = readFileSync(
      new URL('../../../../../poc/codex-tutor/tutor-config.example.toml', import.meta.url),
      'utf8',
    );
    const settings = (s: string) =>
      s
        .split('\n')
        .filter((l) => /^\w+ = /.test(l))
        .sort();
    expect(settings(TUTOR_CONFIG_TOML)).toEqual(settings(poc));
  });
});

describe('denyServerRequest', () => {
  it('declines known requests and answers unknown ones with method-not-found', () => {
    expect(denyServerRequest('item/fileChange/requestApproval')).toEqual({
      reply: { result: { decision: 'decline' } },
      toolRequest: true,
    });
    expect(denyServerRequest('item/permissions/requestApproval').reply).toEqual({
      result: { permissions: {}, scope: 'turn' },
    });
    expect(denyServerRequest('item/tool/requestUserInput').reply).toEqual({
      result: { answers: {} },
    });
    expect(denyServerRequest('nope')).toEqual({
      reply: { error: { code: -32601, message: 'Method not found' } },
      toolRequest: false,
    });
  });
});

describe('JsonRpcClient', () => {
  function client() {
    const sent: string[] = [];
    const notes: string[] = [];
    const logged: string[] = [];
    const rpc = new JsonRpcClient({
      send: (l) => sent.push(l),
      onServerRequest: () => ({ result: { decision: 'decline' } }),
      onNotification: (m) => notes.push(m),
      log: (e) => logged.push(e),
    });
    return { rpc, sent, notes, logged };
  }

  it('correlates responses, routes notifications and answers server requests', async () => {
    const { rpc, sent, notes } = client();
    const p = rpc.request<{ ok: boolean }>('thread/start', { a: 1 });
    expect(JSON.parse(sent[0] ?? '')).toEqual({ id: 1, method: 'thread/start', params: { a: 1 } });
    rpc.handleLine('{"method":"turn/started","params":{}}');
    rpc.handleLine('{"id":7,"method":"item/commandExecution/requestApproval","params":{}}');
    rpc.handleLine('{"id":1,"result":{"ok":true}}');
    await expect(p).resolves.toEqual({ ok: true });
    expect(notes).toEqual(['turn/started']);
    expect(JSON.parse(sent[1] ?? '')).toEqual({ id: 7, result: { decision: 'decline' } });
  });

  it('ignores unparsable lines and rejects errors with their code', async () => {
    const { rpc, logged } = client();
    rpc.handleLine('not json');
    expect(logged).toEqual(['codex.rpc.bad_line']);
    const p = rpc.request('x', undefined);
    rpc.handleLine('{"id":1,"error":{"code":-32600,"message":"bad"}}');
    await expect(p).rejects.toBeInstanceOf(RpcError);
    await expect(p).rejects.toMatchObject({ code: -32600 });
  });

  it('retries overload errors with backoff', async () => {
    const { rpc } = client();
    const slept: number[] = [];
    const p = rpc.requestWithRetry(
      'model/list',
      {},
      {
        sleep: (ms) => {
          slept.push(ms);
          setTimeout(() => {
            rpc.handleLine(`{"id":${slept.length + 1},"result":{"data":[]}}`);
          }, 0);
          return Promise.resolve();
        },
      },
    );
    rpc.handleLine('{"id":1,"error":{"code":-32001,"message":"busy"}}');
    await expect(p).resolves.toEqual({ data: [] });
    expect(slept).toEqual([500]);
  });

  it('rejects pending requests when closed and times out', async () => {
    const { rpc } = client();
    const p = rpc.request('x', undefined);
    rpc.close(new AIError('AI_PROVIDER_ERROR'));
    await expect(p).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
    const { rpc: rpc2 } = client();
    await expect(rpc2.request('slow', undefined, 10)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });
});

describe('versions and usage', () => {
  it('parses and compares versions', () => {
    expect(parseCodexVersion('codex-cli 0.155.1\n')).toBe('0.155.1');
    expect(parseCodexVersion('weird')).toBeNull();
    expect(compareVersions('0.155.1', '0.155.1')).toBe(0);
    expect(compareVersions('0.160.0', '0.155.1')).toBeGreaterThan(0);
    expect(compareVersions('0.99.9', '0.155.1')).toBeLessThan(0);
  });

  it('merges sparse rate-limit updates', () => {
    const first = mergeUsage(
      null,
      {
        primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1 },
        secondary: { usedPercent: 50, windowDurationMins: 10080, resetsAt: 2 },
      },
      5,
    );
    expect(first.highestUsedPercent).toBe(50);
    const next = mergeUsage(
      first,
      { primary: { usedPercent: 70, windowDurationMins: 300, resetsAt: 1 }, secondary: null },
      6,
    );
    expect(next.windows.map((w) => w.usedPercent)).toEqual([70, 50]);
    expect(next.highestUsedPercent).toBe(70);
  });
});
