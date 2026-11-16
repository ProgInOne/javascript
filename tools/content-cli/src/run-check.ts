import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkContent, type SpecValidator } from './check.ts';
import type { Diagnostics } from './diagnostics.ts';
import {
  emptyStore,
  EXPECTATIONS_FILE,
  predictInputHash,
  serializeExpectations,
  writeExpectations,
  type ExpectationStore,
} from './expectations.ts';
import {
  collectExamples,
  verifyExample,
  verifyExercise,
  type PlanRunner,
  type VerifyOutcome,
} from './verify/cases.ts';

/**
 * `content-cli check --run`: schema check, then execution verification of every exercise and
 * lesson example (drafts included: verification comes before human review), then the predict
 * answer keys are written to `.generated/predict-expected.json` and the schema check runs again
 * with them (so answer-dependent static rules, e.g. "a misconception answer equals the real
 * answer", are checked too).
 */

export interface RunCheckItem {
  kind: 'exercise' | 'example';
  /** Exercise ID, or `<lesson id>#<example id>`. */
  id: string;
  /** Path relative to the content root. */
  file: string;
  /** Exercise type, or `RunnableExample`. */
  type: string;
  outcome: VerifyOutcome;
}

export interface RunCheckOptions {
  validateSpec: SpecValidator;
  runner: PlanRunner;
  /** Fail instead of writing when the expectation file is out of date (CI). */
  frozen?: boolean;
  /** Verifications in flight at once. Default 4. */
  concurrency?: number;
  /** Also run the quantity rules in the final check (`CheckOptions.quantity`). */
  quantity?: boolean;
}

export interface RunCheckResult {
  /** Final schema-check diagnostics (with the fresh answer keys applied). */
  diagnostics: Diagnostics;
  items: RunCheckItem[];
  /** Whether verification ran (it doesn't when the first schema check has errors). */
  ran: boolean;
  /** The expectation file differs from the computed one. */
  expectationsChanged: boolean;
  /** Path written, if any. */
  wrote: string | null;
  ok: boolean;
}

async function pool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

export async function runCheck(root: string, options: RunCheckOptions): Promise<RunCheckResult> {
  // First pass without stored keys: a stale key must not block computing a new one.
  const first = checkContent(root, {
    validateSpec: options.validateSpec,
    expectations: emptyStore(),
    skipExpectations: true,
  });
  if (first.diagnostics.errorCount > 0) {
    return {
      diagnostics: first.diagnostics,
      items: [],
      ran: false,
      expectationsChanged: false,
      wrote: null,
      ok: false,
    };
  }

  type Task = Omit<RunCheckItem, 'outcome'> & { verify: () => Promise<VerifyOutcome> };
  const tasks: Task[] = [];
  const rel = (file: string) => relative(root, file);
  for (const course of first.source.courses) {
    for (const lesson of course.modules.flatMap((m) => m.lessons)) {
      const lessonId = lesson.meta.data.id;
      for (const example of collectExamples(first.lessons.get(lessonId)?.tree ?? [])) {
        tasks.push({
          kind: 'example',
          id: `${lessonId}#${example.id}`,
          file: rel(lesson.mdxFile),
          type: 'RunnableExample',
          verify: () => verifyExample(example, options.runner),
        });
      }
      for (const { file, data } of lesson.exercises) {
        tasks.push({
          kind: 'exercise',
          id: data.id,
          file: rel(file),
          type: data.type,
          verify: () => verifyExercise(data, options.runner),
        });
      }
    }
  }

  const outcomes = await pool(tasks, options.concurrency ?? 4, (t) => t.verify());
  const items = tasks.map(({ verify: _verify, ...item }, i): RunCheckItem => {
    const outcome = outcomes[i];
    if (!outcome) throw new Error(`no outcome for ${item.id}`);
    return { ...item, outcome };
  });

  const store: ExpectationStore = emptyStore();
  const specs = new Map(
    first.source.courses
      .flatMap((c) => c.modules.flatMap((m) => m.lessons.flatMap((l) => l.exercises)))
      .map(({ data }) => [data.id, data.spec]),
  );
  for (const item of items) {
    const spec = specs.get(item.id);
    if (item.type !== 'predict_output' || item.outcome.expected === undefined || !spec) continue;
    store.entries[item.id] = { inputHash: predictInputHash(spec), expected: item.outcome.expected };
  }

  const file = join(root, EXPECTATIONS_FILE);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const expectationsChanged = current !== serializeExpectations(store);
  let wrote: string | null = null;
  if (expectationsChanged && !options.frozen) wrote = writeExpectations(root, store);

  const final = checkContent(root, {
    validateSpec: options.validateSpec,
    expectations: store,
    quantity: options.quantity ?? false,
  });
  if (expectationsChanged && options.frozen) {
    final.diagnostics.error(
      file,
      '실행 기대값 파일이 최신이 아닙니다. pnpm content:check:run을 실행하고 바뀐 파일을 커밋하세요',
    );
  }
  const failed = items.some((i) => i.outcome.status === 'fail');
  return {
    diagnostics: final.diagnostics,
    items,
    ran: true,
    expectationsChanged,
    wrote,
    ok: !failed && final.diagnostics.errorCount === 0,
  };
}
