import type { Observation, RunResult, SerializedValue } from '@proginone/shared';

import { fromJson, type JsonValue } from '../common/values.ts';

/** Test helper: a completed RunResult with the given observations. */
export function makeRun(observations: unknown[], overrides: Partial<RunResult> = {}): RunResult {
  return {
    v: 1,
    type: 'result',
    runId: 'run-1',
    status: 'completed',
    durationMs: 5,
    console: [],
    consoleTruncated: false,
    droppedConsoleEntries: 0,
    errors: [],
    observations: observations.map((o) => ({ status: 'ok', ...(o as object) })) as Observation[],
    pendingAtEnd: { timers: 0, intervals: 0 },
    ...overrides,
  };
}

export const sv = (value: JsonValue): SerializedValue => fromJson(value);

export function returned(id: string, value: JsonValue, extra: object = {}): object {
  return { op: 'callFunction', id, outcome: 'returned', value: sv(value), ...extra };
}

export function logEntries(...lines: string[]): object[] {
  return lines.map((line, seq) => ({
    seq,
    level: 'log',
    at: seq,
    args: [{ t: 'string', v: line }],
  }));
}
