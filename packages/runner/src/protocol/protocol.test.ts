import { parseRunResult, type RunPlan } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { resolveLimits } from './limits.ts';
import {
  harnessToShellSchema,
  runnablePlanSchema,
  runRequestSchema,
  shellControlSchema,
} from './messages.ts';

const file = (path: string, language: 'js' | 'html' | 'css', content = '') => ({
  path,
  language,
  content,
});

const plan = (overrides: Partial<RunPlan> = {}): RunPlan => ({
  v: 1,
  mode: 'js-console',
  purpose: 'interactive',
  files: [file('main.js', 'js')],
  entry: 'main.js',
  timers: 'real',
  checks: { v: 1, expose: [], steps: [] },
  ...overrides,
});

describe('runnablePlanSchema (shared RunPlan + runner checks)', () => {
  it('accepts a plan as exercise-kit builds it', () => {
    expect(runnablePlanSchema.safeParse(plan()).success).toBe(true);
  });

  it('rejects oversized requests (S43)', () => {
    const big = 'x'.repeat(200_001);
    expect(
      runnablePlanSchema.safeParse(plan({ files: [file('main.js', 'js', big)] })).success,
    ).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => file(`f${i}.js`, 'js'));
    expect(runnablePlanSchema.safeParse(plan({ files: many, entry: 'f0.js' })).success).toBe(false);
  });

  it.each([
    ['parent paths', { files: [file('a/../main.js', 'js')], entry: 'a/../main.js' }],
    ['duplicate paths', { files: [file('main.js', 'js'), file('main.js', 'js')] }],
    ['a missing entry', { entry: 'other.js' }],
    ['an entry that does not suit the mode', { mode: 'dom' as const }],
  ])('rejects %s', (_, overrides) => {
    expect(runnablePlanSchema.safeParse(plan(overrides)).success).toBe(false);
  });

  it('keeps DOM-only steps out of js-console runs', () => {
    const r = runnablePlanSchema.safeParse(
      plan({
        checks: {
          v: 1,
          expose: [],
          steps: [{ op: 'domQuery', id: 'c1#q', selector: 'p', read: ['count'] }],
        },
      }),
    );
    expect(r.success).toBe(false);
  });
});

describe('resolveLimits', () => {
  it('gives grading and verification 10 seconds', () => {
    expect(resolveLimits('interactive').maxDurationMs).toBe(3_000);
    expect(resolveLimits('grading').maxDurationMs).toBe(10_000);
    expect(resolveLimits('verification', { maxDurationMs: 1_500 }).maxDurationMs).toBe(1_500);
  });

  it('ignores undefined overrides and rejects out-of-range ones', () => {
    expect(resolveLimits('interactive', { quietMs: undefined }).quietMs).toBe(50);
    expect(() => resolveLimits('interactive', { maxDurationMs: 60_000 })).toThrow();
  });
});

describe('channel schemas', () => {
  const runId = '0b5e5b9e-4c8e-4d55-9a49-5f4c1d0a8f11';

  it('accepts the result shape the shell sends with the shared parser', () => {
    const result = {
      v: 1,
      type: 'result',
      runId,
      status: 'completed',
      durationMs: 12,
      console: [{ seq: 1, level: 'log', args: [{ t: 'string', v: 'hi' }], at: 1 }],
      consoleTruncated: false,
      droppedConsoleEntries: 0,
      errors: [],
      observations: [
        {
          op: 'callFunction',
          id: 'c1#0',
          status: 'ok',
          outcome: 'returned',
          value: { t: 'number', v: 3 },
          returnIsArg: [],
        },
      ],
      pendingAtEnd: { timers: 0, intervals: 0 },
    };
    expect(parseRunResult(result).success).toBe(true);
    expect(parseRunResult({ ...result, v: 2 }).success).toBe(false);
  });

  it('validates control messages and harness messages', () => {
    expect(shellControlSchema.safeParse({ v: 1, type: 'ready' }).success).toBe(true);
    expect(shellControlSchema.safeParse({ v: 1, type: 'heartbeat', runId, at: 5 }).success).toBe(
      true,
    );
    expect(shellControlSchema.safeParse({ v: 1, type: 'result', runId }).success).toBe(false);
    expect(
      shellControlSchema.safeParse({ v: 1, type: 'notice', notice: 'navigation-blocked' }).success,
    ).toBe(true);
    expect(shellControlSchema.safeParse({ v: 1, type: 'notice', notice: 'other' }).success).toBe(
      false,
    );
    expect(harnessToShellSchema.safeParse({ type: 'settled' }).success).toBe(true);
    expect(
      harnessToShellSchema.safeParse({ type: 'viewport', reqId: 1, width: 10, height: 10 }).success,
    ).toBe(false);
  });

  it('carries shared observation steps in run requests', () => {
    const r = runRequestSchema.safeParse({
      v: 1,
      type: 'run',
      runId,
      mode: 'js-console',
      purpose: 'grading',
      limits: resolveLimits('grading'),
      stdin: [],
      steps: [{ op: 'consoleOutput', id: 'c1#0' }],
      scripts: [{ id: 0, code: 'console.log(1)' }],
      expose: null,
    });
    expect(r.success).toBe(true);
  });
});
