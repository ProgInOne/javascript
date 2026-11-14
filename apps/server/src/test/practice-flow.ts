import {
  apiErrorSchema,
  attemptResponseSchema,
  practiceSetViewSchema,
  type AttemptResponse,
  type PracticeSetView,
} from '@proginone/shared';
import { expect } from 'vitest';
import { CORRECT, runFor, WRONG } from './answers.ts';
import { EX } from './content-fixture.ts';
import { MINUTE, type practiceApp } from './practice-app.ts';

// The web app's practice flow over the test app: create a set, run, submit.

export type Ctx = Awaited<ReturnType<typeof practiceApp>>;

export const LESSON = 'js-basics.start.first-program';
const RUN_BASED = new Set<string>([EX.fillCode, EX.implement, EX.fixBug, EX.web]);

export const errorCode = (json: unknown) => apiErrorSchema.parse(json).error.code;

export async function createSet(ctx: Ctx, body: object): Promise<PracticeSetView> {
  const res = await ctx.call('POST', '/practice-sets', body);
  expect(res.status).toBe(200);
  return practiceSetViewSchema.parse(res.json);
}

export const lessonSet = (ctx: Ctx) => createSet(ctx, { kind: 'lesson', lessonId: LESSON });

/** Submits an answer for an item the way the web app does (run plan → sandbox → attempt). */
export async function submit(
  ctx: Ctx,
  item: { id: string; exerciseId: string },
  options: { correct?: boolean; status?: 'crashed' | 'completed'; body?: object } = {},
) {
  const correct = options.correct ?? true;
  const answer = (correct ? CORRECT : WRONG)[item.exerciseId];
  let runResult: unknown;
  if (RUN_BASED.has(item.exerciseId)) {
    const plan = await ctx.call('POST', `/exercises/${item.exerciseId}/run-plan`, {
      answer,
      purpose: 'grading',
    });
    runResult = runFor(plan.json, {
      correct,
      ...(options.status ? { status: options.status } : {}),
    });
  }
  ctx.clock.now += MINUTE;
  return ctx.call('POST', '/attempts', {
    practiceSetItemId: item.id,
    exerciseId: item.exerciseId,
    answer,
    ...(runResult === undefined ? {} : { runResult }),
    confidence: 'sure',
    startedAt: ctx.clock.now - 40_000,
    activeMs: 30_000,
    ...options.body,
  });
}

export const parsed = (res: { status: number; json: unknown }): AttemptResponse => {
  expect(res.status).toBe(201);
  return attemptResponseSchema.parse(res.json);
};

/** Answers every item of a set correctly; returns the last response. */
export async function answerAll(ctx: Ctx, set: PracticeSetView): Promise<AttemptResponse> {
  let last: AttemptResponse | undefined;
  for (const item of set.items) last = parsed(await submit(ctx, item));
  if (!last) throw new Error('empty set');
  return last;
}
