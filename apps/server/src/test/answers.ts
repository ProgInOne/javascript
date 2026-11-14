import { fromJson } from '@proginone/exercise-kit';
import { runPlanSchema, type RunPlan, type RunResult } from '@proginone/shared';
import { EX } from './content-fixture.ts';

// Learner answers and sandbox results for the fixture exercises (content-fixture.ts).

const shoutFile = (body: string) => ({
  files: [{ path: 'main.js', content: `function shout(s) {\n  return ${body};\n}\n` }],
});

/** Correct answers by exercise id. */
export const CORRECT: Record<string, unknown> = {
  [EX.mcq]: { optionId: 'b' },
  [EX.fillText]: { blanks: { b1: ';' } },
  [EX.predict]: { console: '2' },
  [EX.fillCode]: { blanks: { b1: "s.toUpperCase() + '!'" } },
  [EX.implement]: shoutFile("s.toUpperCase() + '!'"),
  [EX.fixBug]: shoutFile("s.toUpperCase() + '!'"),
  [EX.web]: { files: [{ path: 'index.html', content: '<main><ul class="cards"></ul></main>' }] },
};

/** Wrong answers by exercise id. */
export const WRONG: Record<string, unknown> = {
  [EX.mcq]: { optionId: 'a' },
  [EX.fillText]: { blanks: { b1: ':' } },
  [EX.predict]: { console: '11' },
  [EX.fillCode]: { blanks: { b1: 's' } },
  [EX.implement]: shoutFile('s'),
  [EX.fixBug]: shoutFile("s + '!'"),
  [EX.web]: { files: [{ path: 'index.html', content: '<main></main>' }] },
};

/** What a correct (or wrong) program observes for each fixture check step. */
const OBSERVED: Record<string, { right: object; wrong: object }> = {
  settle: {
    right: { op: 'waitSettled', settled: true },
    wrong: { op: 'waitSettled', settled: true },
  },
  'basic#0': {
    right: { op: 'callFunction', outcome: 'returned', value: fromJson('HI!') },
    wrong: { op: 'callFunction', outcome: 'returned', value: fromJson('hi') },
  },
  'hidden#0': {
    right: { op: 'callFunction', outcome: 'returned', value: fromJson('QUIET!') },
    wrong: { op: 'callFunction', outcome: 'returned', value: fromJson('quiet') },
  },
  'has-list#q': {
    right: { op: 'domQuery', count: 1, items: [{ tagName: 'UL' }] },
    wrong: { op: 'domQuery', count: 0, items: [] },
  },
  'hidden-items#q': {
    right: { op: 'domQuery', count: 0, items: [] },
    wrong: { op: 'domQuery', count: 0, items: [] },
  },
};

/** A sandbox result for a run plan, as the runner would report it. */
export function runFor(
  rawPlan: unknown,
  options: { correct?: boolean; status?: RunResult['status'] } = {},
): RunResult {
  const plan: RunPlan = runPlanSchema.parse(rawPlan);
  const correct = options.correct ?? true;
  return {
    v: 1,
    type: 'result',
    runId: 'run-1',
    status: options.status ?? 'completed',
    durationMs: 12,
    console: [],
    consoleTruncated: false,
    droppedConsoleEntries: 0,
    errors: [],
    observations:
      options.status === 'crashed'
        ? []
        : (plan.checks.steps.map((step) => {
            const known = OBSERVED[step.id];
            if (!known) throw new Error(`no fixture observation for ${step.id}`);
            return { id: step.id, status: 'ok', ...(correct ? known.right : known.wrong) };
          }) as RunResult['observations']),
    pendingAtEnd: { timers: 0, intervals: 0 },
  };
}
