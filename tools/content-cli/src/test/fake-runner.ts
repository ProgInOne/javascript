import type { Observation, RunError, RunPlan, RunResult } from '@proginone/run-contract';
import type { PlanRunner } from '../verify/cases.ts';

/** What a fake program does when "run": console lines, errors, final status. */
export interface FakeProgram {
  lines?: string[] | (() => string[]);
  errors?: RunError[];
  status?: RunResult['status'];
}

/**
 * A runner without a browser: looks the plan's code up in `programs` (by the joined file
 * contents) and answers the `consoleOutput` / `waitSettled` steps from it. Other steps get no
 * observation, so checks that need them fail as not observed. Unknown code runs silently.
 */
export function fakeRunner(
  programs: Record<string, FakeProgram>,
): PlanRunner & { plans: RunPlan[] } {
  const plans: RunPlan[] = [];
  return {
    plans,
    run(plan) {
      plans.push(plan);
      const program = programs[plan.files.map((f) => f.content).join('\n')] ?? {};
      const lines = typeof program.lines === 'function' ? program.lines() : (program.lines ?? []);
      const entries = lines.map((line, seq) => ({
        seq,
        level: 'log' as const,
        at: seq,
        args: [{ t: 'string' as const, v: line }],
      }));
      const errors = program.errors ?? [];
      const observations: Observation[] = [];
      for (const step of plan.checks.steps) {
        if (step.op === 'consoleOutput')
          observations.push({
            op: 'consoleOutput',
            id: step.id,
            status: 'ok',
            entries,
            truncated: false,
          });
        if (step.op === 'waitSettled')
          observations.push({ op: 'waitSettled', id: step.id, status: 'ok', settled: true });
      }
      return Promise.resolve({
        v: 1,
        type: 'result',
        runId: `run-${plans.length}`,
        status: program.status ?? (errors.length > 0 ? 'error' : 'completed'),
        durationMs: 1,
        console: entries,
        consoleTruncated: false,
        droppedConsoleEntries: 0,
        errors,
        observations,
        pendingAtEnd: { timers: 0, intervals: 0 },
      });
    },
  };
}

export const runtimeError = (name: string, message: string, line = 1): RunError => ({
  phase: 'runtime',
  name,
  message,
  position: { file: 'main.js', line },
});

export const syntaxError = (message: string, line = 1): RunError => ({
  phase: 'syntax',
  name: 'SyntaxError',
  message,
  position: { file: 'main.js', line },
});
