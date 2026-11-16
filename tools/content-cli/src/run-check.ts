import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkContent, type SpecValidator } from './check.ts';
import type { Diagnostics } from './diagnostics.ts';
import {
  emptyStore,
  EXPECTATIONS_FILE,
  predictInputHash,
  serializeExpectations,
  TEMPLATE_EXPECTATIONS_FILE,
  writeExpectations,
  type ExpectationStore,
} from './expectations.ts';
import { variantAsExercise, variantInputHash } from './templates.ts';
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
  kind: 'exercise' | 'example' | 'template';
  /** Exercise ID, `<lesson id>#<example id>`, or a template variant ID (`<template id>@<seed>`). */
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
  /** An expectation file (predict or template) differs from the computed one. */
  expectationsChanged: boolean;
  /** Paths written. */
  wrote: string[];
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
    templateExpectations: emptyStore(),
    skipExpectations: true,
  });
  if (first.diagnostics.errorCount > 0) {
    return {
      diagnostics: first.diagnostics,
      items: [],
      ran: false,
      expectationsChanged: false,
      wrote: [],
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

  // Every pooled sample variant of every template runs like an authored exercise (D-056).
  const variantSpecs = new Map<string, Record<string, unknown>>();
  for (const tpl of first.templates) {
    for (const variant of tpl.variants) {
      variantSpecs.set(variant.variantId, variant.spec);
      tasks.push({
        kind: 'template',
        id: variant.variantId,
        file: rel(tpl.file),
        type: tpl.source.type,
        verify: () => verifyExercise(variantAsExercise(tpl.source, variant), options.runner),
      });
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
  const templateStore: ExpectationStore = emptyStore();
  for (const item of items) {
    if (item.kind === 'template') {
      // Every variant that did not fail is verified (types without code to run are skipped, not
      // failed); predict variants also carry their answer key. Only these seeds are served.
      const spec = variantSpecs.get(item.id);
      if (!spec || item.outcome.status === 'fail') continue;
      if (item.type === 'predict_output' && item.outcome.expected === undefined) continue;
      templateStore.entries[item.id] = {
        inputHash: variantInputHash(item.type, spec),
        expected: item.outcome.expected ?? null,
      };
      continue;
    }
    const spec = specs.get(item.id);
    if (item.type !== 'predict_output' || item.outcome.expected === undefined || !spec) continue;
    store.entries[item.id] = { inputHash: predictInputHash(spec), expected: item.outcome.expected };
  }

  const stale: string[] = [];
  const wrote: string[] = [];
  for (const [name, computed] of [
    [EXPECTATIONS_FILE, store],
    [TEMPLATE_EXPECTATIONS_FILE, templateStore],
  ] as const) {
    const file = join(root, name);
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
    // No templates and no file: nothing to keep in sync.
    if (current === '' && Object.keys(computed.entries).length === 0) continue;
    if (current === serializeExpectations(computed)) continue;
    stale.push(file);
    if (!options.frozen) wrote.push(writeExpectations(root, computed, name));
  }
  const expectationsChanged = stale.length > 0;

  const final = checkContent(root, {
    validateSpec: options.validateSpec,
    expectations: store,
    quantity: options.quantity ?? false,
    templateExpectations: templateStore,
  });
  if (options.frozen) {
    for (const file of stale) {
      final.diagnostics.error(
        file,
        '실행 기대값 파일이 최신이 아닙니다. pnpm content:check:run을 실행하고 바뀐 파일을 커밋하세요',
      );
    }
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
