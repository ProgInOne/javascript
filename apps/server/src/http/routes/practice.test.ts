import {
  apiErrorSchema,
  attemptResponseSchema,
  practiceSetViewSchema,
  type AttemptResponse,
  type PracticeSetView,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { CORRECT, runFor, WRONG } from '../../test/answers.ts';
import { EX } from '../../test/content-fixture.ts';
import { count, MINUTE, practiceApp, T0 } from '../../test/practice-app.ts';

type Ctx = Awaited<ReturnType<typeof practiceApp>>;

const LESSON = 'js-basics.start.first-program';
const RUN_BASED = new Set<string>([EX.fillCode, EX.implement, EX.fixBug, EX.web]);
const errorCode = (json: unknown) => apiErrorSchema.parse(json).error.code;

async function lessonSet(ctx: Ctx): Promise<PracticeSetView> {
  const res = await ctx.call('POST', '/practice-sets', { kind: 'lesson', lessonId: LESSON });
  expect(res.status).toBe(200);
  return practiceSetViewSchema.parse(res.json);
}

/** Submits an answer for an item the way the web app does (run plan → sandbox → attempt). */
async function submit(
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

const parsed = (res: { status: number; json: unknown }): AttemptResponse => {
  expect(res.status).toBe(201);
  return attemptResponseSchema.parse(res.json);
};

describe('POST /practice-sets (lesson)', () => {
  it('builds a lesson set once and returns it while active', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    expect(set.kind).toBe('lesson');
    expect(set.status).toBe('active');
    expect(set.lessonId).toBe(LESSON);
    expect(new Set(set.items.map((i) => i.exerciseId))).toEqual(new Set(Object.values(EX)));
    expect(set.items.every((i) => i.status === 'pending' && i.attempts === 0)).toBe(true);
    expect(set.items[0]?.targetConcept).toEqual({
      id: 'js.basics.statement',
      title: 'js.basics.statement',
    });
    expect(set.passRule).toMatchObject({ minCorrect: 0.7, minConceptScore: 50 });
    expect(set.nextItemId).toBe(set.items[0]?.id);

    const again = await lessonSet(ctx);
    expect(again.id).toBe(set.id);
    expect(count(ctx, 'practice_sets')).toBe(1);
    const got = await ctx.call('GET', `/practice-sets/${set.id}`);
    expect(practiceSetViewSchema.parse(got.json)).toEqual(set);
    const progress = ctx.userDb.sqlite
      .prepare('SELECT status, practice_set_id FROM lesson_progress')
      .get();
    expect(progress).toEqual({ status: 'practicing', practice_set_id: set.id });
  });

  it('leaves out reported exercises', async () => {
    const ctx = await practiceApp();
    await ctx.call('POST', `/exercises/${EX.predict}/reports`, { reason: 'wrong_answer' });
    const set = await lessonSet(ctx);
    expect(set.items.map((i) => i.exerciseId)).not.toContain(EX.predict);
  });

  it('answers 404 for unknown lessons and sets, 409 without exercises', async () => {
    const ctx = await practiceApp();
    const unknown = await ctx.call('POST', '/practice-sets', { kind: 'lesson', lessonId: 'a.b.c' });
    expect(unknown.status).toBe(404);
    const empty = await ctx.call('POST', '/practice-sets', {
      kind: 'lesson',
      lessonId: 'js-basics.start.reading-errors',
    });
    expect(empty.status).toBe(409);
    expect(errorCode(empty.json)).toBe('PRACTICE_NO_EXERCISES');
    expect((await ctx.call('GET', '/practice-sets/01JD3Z8Q6V2K9M4T7R1X5W0BNC')).status).toBe(404);
    expect((await ctx.call('GET', '/practice-sets/nope')).status).toBe(404);
    const bad = await ctx.call('POST', '/practice-sets', { kind: 'nope' });
    expect(bad.status).toBe(400);
  });
});

describe('POST /attempts', () => {
  it('grades every type end to end, applies the engine and completes the set', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    let last: AttemptResponse | undefined;
    for (const item of set.items) {
      const res = await submit(ctx, item);
      for (const marker of ['SOLUTION-MARK', 'QUIET!', 'HIDDEN-MARK']) {
        expect(res.text).not.toContain(marker);
      }
      last = parsed(res);
      expect(last.attempt).toMatchObject({
        outcome: 'correct',
        correct: true,
        engineApplied: true,
      });
      expect(last.item).toEqual({ id: item.id, status: 'answered', attempts: 1 });
      const change = last.masteryChanges.find((m) => m.conceptId === 'js.basics.statement');
      expect(change?.scoreAfter).toBeGreaterThan(change?.scoreBefore ?? 100);
    }
    expect(last?.set.status).toBe('completed');
    expect(last?.set.progress).toEqual({ total: 7, answered: 7, skipped: 0, pending: 0 });
    expect(last?.set.nextItemId).toBeNull();
    const result = last?.set.result;
    expect(result).toMatchObject({ total: 7, answered: 7, correct: 7 });
    expect(result?.pass?.checks.allAnswered).toBe(true);
    expect(result?.pass?.checks.minDistinctTypes.actual).toBe(6);
    expect(result?.pass?.passed).toBe(true);

    // Engine effects are persisted.
    const mastery = ctx.userDb.sqlite
      .prepare('SELECT concept_id, stage, score FROM concept_mastery ORDER BY concept_id')
      .all() as { concept_id: string; stage: string; score: number }[];
    expect(mastery.map((m) => m.concept_id)).toEqual(['js.basics.comment', 'js.basics.statement']);
    expect(mastery[1]?.score).toBeGreaterThanOrEqual(50);
    expect(count(ctx, 'attempts')).toBe(7);
    expect(count(ctx, 'submissions')).toBe(7);
    expect(count(ctx, 'exercise_snapshots')).toBe(7);
    expect(
      ctx.userDb.sqlite
        .prepare("SELECT COUNT(*) AS n FROM mastery_evidence WHERE kind = 'attempt'")
        .get(),
    ).toEqual({ n: 8 }); // 7 primary + 1 secondary tag
    // FSRS: the card is created when the set's pending ratings are applied.
    expect(ctx.userDb.sqlite.prepare('SELECT concept_id, reps FROM concept_memory').all()).toEqual([
      { concept_id: 'js.basics.statement', reps: 1 },
    ]);
    expect(count(ctx, 'review_logs')).toBe(1);
    expect(
      ctx.userDb.sqlite
        .prepare('SELECT COUNT(*) AS n FROM pending_ratings WHERE flushed_at IS NULL')
        .get(),
    ).toEqual({ n: 0 });
    expect(
      ctx.userDb.sqlite.prepare('SELECT status, practice_set_id FROM lesson_progress').get(),
    ).toEqual({
      status: 'completed',
      practice_set_id: null,
    });
    expect(
      ctx.userDb.sqlite
        .prepare(
          'SELECT date, attempts_count, correct_count, lessons_completed FROM daily_activity',
        )
        .all(),
    ).toEqual([{ date: '2026-11-14', attempts_count: 7, correct_count: 7, lessons_completed: 1 }]);

    // A finished set is closed; asking again builds the next one.
    const closed = await submit(ctx, set.items[0] ?? { id: '', exerciseId: '' });
    expect(closed.status).toBe(409);
    expect(errorCode(closed.json)).toBe('PRACTICE_SET_CLOSED');
    expect((await lessonSet(ctx)).id).not.toBe(set.id);
  });

  it('reports wrong answers with misconception titles and never leaks hidden checks', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const mcq = set.items.find((i) => i.exerciseId === EX.mcq);
    const impl = set.items.find((i) => i.exerciseId === EX.implement);
    if (!mcq || !impl) throw new Error('fixture set misses items');

    const wrong = parsed(await submit(ctx, mcq, { correct: false }));
    expect(wrong.attempt.outcome).toBe('incorrect');
    expect(wrong.grade.misconceptions).toEqual([
      { id: 'js.mc.log-is-return', title: 'console.log를 반환으로 생각함' },
    ]);
    const res = await submit(ctx, impl, { correct: false });
    const failed = parsed(res);
    expect(failed.attempt.outcome).toBe('incorrect');
    const hidden = failed.grade.checkResults?.find((c) => c.id === 'hidden');
    expect(hidden).toMatchObject({ passed: false, visible: false });
    expect(hidden?.detail).toBeUndefined();
    expect(res.text).not.toContain('QUIET!');

    // A retry on the same item counts as the second attempt in the item.
    const retry = parsed(await submit(ctx, mcq));
    expect(retry.attempt).toMatchObject({ attemptInItem: 2, attemptNo: 2, correct: true });
    expect(retry.item.attempts).toBe(2);
  });

  it('records hints before the attempt and rates it accordingly', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const item = set.items.find((i) => i.exerciseId === EX.fillText);
    if (!item) throw new Error('fixture set misses fill_blank');
    await ctx.call('POST', `/exercises/${item.exerciseId}/hints`, { practiceSetItemId: item.id });
    parsed(await submit(ctx, item));
    expect(
      ctx.userDb.sqlite.prepare('SELECT hint_level_max, solution_viewed FROM attempts').get(),
    ).toEqual({ hint_level_max: 1, solution_viewed: 0 });
    expect(ctx.userDb.sqlite.prepare('SELECT rating FROM pending_ratings').get()).toEqual({
      rating: 'hard',
    });
  });

  it('stores crashed runs without applying the engine', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const item = set.items.find((i) => i.exerciseId === EX.implement);
    if (!item) throw new Error('fixture set misses implement_function');
    const res = parsed(await submit(ctx, item, { status: 'crashed' }));
    expect(res.attempt).toMatchObject({ outcome: 'error', engineApplied: false, attemptInItem: 0 });
    expect(res.masteryChanges).toEqual([]);
    expect(res.item).toEqual({ id: item.id, status: 'pending', attempts: 0 });
    expect(ctx.userDb.sqlite.prepare('SELECT engine_applied, outcome FROM attempts').get()).toEqual(
      {
        engine_applied: 0,
        outcome: 'error',
      },
    );
    const stored = ctx.userDb.sqlite.prepare('SELECT run_result_json FROM submissions').get() as {
      run_result_json: string;
    };
    expect(JSON.parse(stored.run_result_json)).toMatchObject({
      v: 1,
      result: { status: 'crashed' },
    });
    for (const table of [
      'concept_mastery',
      'mastery_evidence',
      'pending_ratings',
      'daily_activity',
    ]) {
      expect(count(ctx, table)).toBe(0);
    }
  });

  it('validates the request against the item and the exercise type', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const impl = set.items.find((i) => i.exerciseId === EX.implement);
    const mcq = set.items.find((i) => i.exerciseId === EX.mcq);
    if (!impl || !mcq) throw new Error('fixture set misses items');

    const mismatch = await submit(ctx, mcq, { body: { exerciseId: EX.predict } });
    expect(mismatch.status).toBe(400);
    expect(errorCode(mismatch.json)).toBe('PRACTICE_ITEM_MISMATCH');
    const noRun = await ctx.call('POST', '/attempts', {
      practiceSetItemId: impl.id,
      exerciseId: impl.exerciseId,
      answer: CORRECT[EX.implement],
      startedAt: T0,
      activeMs: 1000,
    });
    expect(noRun.status).toBe(400);
    expect(errorCode(noRun.json)).toBe('EXERCISE_RUN_REQUIRED');
    const badRun = await submit(ctx, impl, { body: { runResult: { v: 1, type: 'result' } } });
    expect(badRun.status).toBe(400);
    expect(errorCode(badRun.json)).toBe('VALIDATION_RUN_RESULT_INVALID');
    const badAnswer = await submit(ctx, mcq, { body: { answer: { optionId: 7 } } });
    expect(badAnswer.status).toBe(400);
    expect(errorCode(badAnswer.json)).toBe('VALIDATION_ANSWER_INVALID');
    const unknownItem = await submit(ctx, { id: '01JD3Z8Q6V2K9M4T7R1X5W0BNC', exerciseId: EX.mcq });
    expect(unknownItem.status).toBe(404);
    expect(count(ctx, 'attempts')).toBe(0);
  });

  it('writes nothing when a write fails mid-transaction', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const item = set.items.find((i) => i.exerciseId === EX.implement);
    if (!item) throw new Error('fixture set misses implement_function');
    // attempts, submissions and concept_mastery are written before the evidence rows.
    ctx.userDb.sqlite.exec(
      "CREATE TRIGGER fail_evidence BEFORE INSERT ON mastery_evidence BEGIN SELECT RAISE(ABORT, 'injected'); END",
    );
    const res = await submit(ctx, item);
    expect(res.status).toBe(500);
    expect(errorCode(res.json)).toBe('INTERNAL');
    for (const table of [
      'attempts',
      'submissions',
      'exercise_snapshots',
      'concept_mastery',
      'mastery_evidence',
      'pending_ratings',
      'daily_activity',
    ]) {
      expect(count(ctx, table)).toBe(0);
    }
    expect(
      ctx.userDb.sqlite.prepare('SELECT status FROM practice_set_items WHERE id = ?').get(item.id),
    ).toEqual({ status: 'pending' });

    ctx.userDb.sqlite.exec('DROP TRIGGER fail_evidence');
    expect(parsed(await submit(ctx, item)).attempt.correct).toBe(true);
  });
});
