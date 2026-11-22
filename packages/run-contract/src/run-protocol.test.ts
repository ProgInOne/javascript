import { describe, expect, it } from 'vitest';

import {
  observationStepSchema,
  parseRunResult,
  runPlanSchema,
  withinDepth,
} from './run-protocol.ts';

const baseResult = {
  v: 1,
  type: 'result',
  runId: 'r1',
  status: 'completed',
  durationMs: 12,
  console: [{ seq: 0, level: 'log', args: [{ t: 'number', v: 1 }], at: 1 }],
  consoleTruncated: false,
  droppedConsoleEntries: 0,
  errors: [],
  observations: [
    { op: 'callFunction', id: 'basic#0', outcome: 'returned', value: { t: 'number', v: 6 } },
    { op: 'domQuery', id: 'd#0', count: 1, items: [{ text: 'hi', attrs: { alt: null } }] },
  ],
  pendingAtEnd: { timers: 0, intervals: 0 },
};

describe('run protocol', () => {
  it('parses a valid RunResult and defaults observation status to ok', () => {
    const parsed = parseRunResult(baseResult);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.observations[0]?.status).toBe('ok');
  });

  it('rejects unknown tags, statuses and observation ops', () => {
    expect(parseRunResult({ ...baseResult, status: 'great' }).success).toBe(false);
    expect(
      parseRunResult({
        ...baseResult,
        console: [{ seq: 0, level: 'log', args: [{ t: 'evil' }], at: 0 }],
      }).success,
    ).toBe(false);
    expect(parseRunResult({ ...baseResult, observations: [{ op: 'exec', id: 'x' }] }).success).toBe(
      false,
    );
  });

  it('rejects hostile nesting before zod recursion', () => {
    let deep: unknown = { t: 'null' };
    for (let i = 0; i < 10_000; i++) deep = { t: 'array', items: [deep], length: 1 };
    expect(withinDepth(deep)).toBe(false);
    const result = parseRunResult({
      ...baseResult,
      console: [{ seq: 0, level: 'log', args: [deep], at: 0 }],
    });
    expect(result).toEqual({ success: false, error: 'RunResult nests too deeply' });
  });

  it('rejects __proto__ keys anywhere in the result', () => {
    const forged = JSON.parse(
      '{"op":"domQuery","id":"d#0","count":1,"items":[{"attrs":{"__proto__":{"alt":"x"}}}]}',
    ) as unknown;
    expect(parseRunResult({ ...baseResult, observations: [forged] }).success).toBe(false);
  });

  it('validates observation steps and run plans', () => {
    expect(
      observationStepSchema.safeParse({ op: 'callFunction', id: 'a#0', name: 'sum', args: [] })
        .success,
    ).toBe(true);
    expect(
      observationStepSchema.safeParse({ op: 'callFunction', id: 'a#0', name: 'a b', args: [] })
        .success,
    ).toBe(false);
    expect(
      runPlanSchema.safeParse({
        v: 1,
        mode: 'js-console',
        purpose: 'grading',
        files: [{ path: '../etc/passwd', language: 'js', content: '' }],
        entry: 'main.js',
        timers: 'real',
        checks: { v: 1, expose: [], steps: [] },
      }).success,
    ).toBe(false);
  });
});
