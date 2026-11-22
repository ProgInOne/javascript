import {
  finishSetResponseSchema,
  inlineAttemptResponseSchema,
  practiceSetViewSchema,
  type AttemptResponse,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { CORRECT } from '../../test/answers.ts';
import { EX, FIXTURE_EXERCISES } from '../../test/content-fixture.ts';
import { count, practiceApp, T0 } from '../../test/practice-app.ts';
import { errorCode, LESSON, lessonSet, parsed, submit } from '../../test/practice-flow.ts';

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
    expect(set.passRule).toMatchObject({ minCorrect: 0.7, minConceptCredit: 0.6 });
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

/** Every fixture exercise is in the lesson set; one attempt each. */
const N = FIXTURE_EXERCISES.length;
const TYPES = new Set(FIXTURE_EXERCISES.map((e) => e.type)).size;

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
    expect(last?.set.progress).toEqual({ total: N, answered: N, skipped: 0, pending: 0 });
    expect(last?.set.nextItemId).toBeNull();
    const result = last?.set.result;
    expect(result).toMatchObject({ total: N, answered: N, correct: N });
    expect(result?.pass?.checks.allAnswered).toBe(true);
    expect(result?.pass?.checks.minDistinctTypes.actual).toBe(TYPES);
    expect(result?.pass?.passed).toBe(true);

    // Engine effects are persisted.
    const mastery = ctx.userDb.sqlite
      .prepare('SELECT concept_id, stage, score FROM concept_mastery ORDER BY concept_id')
      .all() as { concept_id: string; stage: string; score: number }[];
    expect(mastery.map((m) => m.concept_id)).toEqual(['js.basics.comment', 'js.basics.statement']);
    expect(mastery[1]?.score).toBeGreaterThanOrEqual(50);
    expect(count(ctx, 'attempts')).toBe(N);
    expect(count(ctx, 'submissions')).toBe(N);
    expect(count(ctx, 'exercise_snapshots')).toBe(N);
    expect(
      ctx.userDb.sqlite
        .prepare("SELECT COUNT(*) AS n FROM mastery_evidence WHERE kind = 'attempt'")
        .get(),
    ).toEqual({ n: N + 1 }); // one primary per exercise + 1 secondary tag
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
    ).toEqual([{ date: '2026-11-14', attempts_count: N, correct_count: N, lessons_completed: 1 }]);

    // A finished set is closed; asking again builds the next one.
    const closed = await submit(ctx, set.items[0] ?? { id: '', exerciseId: '' });
    expect(closed.status).toBe(409);
    expect(errorCode(closed.json)).toBe('PRACTICE_SET_CLOSED');
    expect((await lessonSet(ctx)).id).not.toBe(set.id);
  });

  it('judges concepts by the set, not the long-term mastery score (D-081)', async () => {
    // A slow learning rate keeps the mastery score far under the old bar of 50.
    const ctx = await practiceApp({
      engineConfig: (c) => ({ ...c, mastery: { ...c.mastery, alpha: 0.02 } }),
    });
    const CONCEPT = 'js.basics.statement';
    const set = await lessonSet(ctx);
    const [head, ...rest] = set.items;
    if (!head) throw new Error('empty set');
    parsed(await submit(ctx, head, { correct: false }));
    let last: AttemptResponse | undefined;
    for (const item of rest) last = parsed(await submit(ctx, item));
    const pass = last?.set.result?.pass;
    expect(pass?.passed).toBe(true);
    const check = pass?.checks.minConceptCredit;
    expect(check).toMatchObject({ met: true, required: 0.6, below: [] });
    expect(check?.concepts).toHaveLength(1);
    const [concept] = check?.concepts ?? [];
    expect(concept).toMatchObject({ id: CONCEPT, title: CONCEPT, met: true });
    expect(concept?.correct).toBe((concept?.total ?? 0) - 1);
    expect(pass?.checks.minConceptScore).toBeUndefined();
    const score = ctx.userDb.sqlite
      .prepare('SELECT score FROM concept_mastery WHERE concept_id = ?')
      .get(CONCEPT) as { score: number };
    expect(score.score).toBeLessThan(50);
    expect(ctx.userDb.sqlite.prepare('SELECT status FROM lesson_progress').get()).toEqual({
      status: 'completed',
    });
    const stored = ctx.userDb.sqlite
      .prepare('SELECT pass_rule_json, result_json FROM practice_sets WHERE id = ?')
      .get(set.id) as { pass_rule_json: string; result_json: string };
    expect(JSON.parse(stored.pass_rule_json)).toMatchObject({ minConceptCredit: 0.6 });
    const storedResult = JSON.parse(stored.result_json) as {
      pass: { checks: { minConceptCredit: unknown } };
    };
    expect(storedResult.pass.checks.minConceptCredit).toMatchObject({
      below: [],
      concepts: [{ conceptId: CONCEPT, met: true }],
    });
  });

  it('reports a concept under the set bar with its correct count (D-081)', async () => {
    const ctx = await practiceApp({
      engineConfig: (c) => ({
        ...c,
        practice: { ...c.practice, passRule: { ...c.practice.passRule, minConceptCredit: 0.95 } },
      }),
    });
    const set = await lessonSet(ctx);
    const [head, ...rest] = set.items;
    if (!head) throw new Error('empty set');
    parsed(await submit(ctx, head, { correct: false }));
    for (const item of rest) parsed(await submit(ctx, item));
    const view = practiceSetViewSchema.parse(
      (await ctx.call('GET', `/practice-sets/${set.id}`)).json,
    );
    expect(view.passRule?.minConceptCredit).toBe(0.95);
    const check = view.result?.pass?.checks.minConceptCredit;
    expect(view.result?.pass?.passed).toBe(false);
    expect(check?.below).toEqual([{ id: 'js.basics.statement', title: 'js.basics.statement' }]);
    expect(check?.concepts[0]).toMatchObject({ met: false });
    expect(check?.concepts[0]?.correct).toBe((check?.concepts[0]?.total ?? 0) - 1);
    expect(ctx.userDb.sqlite.prepare('SELECT status FROM lesson_progress').get()).toEqual({
      status: 'practicing',
    });
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
    expect(retry.grade.explanation).toBe(`${EX.mcq} 해설`);
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

describe('POST /exercises/:id/inline-attempts', () => {
  const inline = (ctx: Awaited<ReturnType<typeof practiceApp>>, id: string, body: object) =>
    ctx.call('POST', `/exercises/${id}/inline-attempts`, {
      startedAt: T0 - 20_000,
      activeMs: 15_000,
      confidence: 'sure',
      ...body,
    });

  it('grades a lesson check outside any set and updates mastery without FSRS', async () => {
    const ctx = await practiceApp();
    const wrong = await inline(ctx, EX.mcq, { answer: { optionId: 'a' } });
    expect(wrong.status).toBe(201);
    const first = inlineAttemptResponseSchema.parse(wrong.json);
    expect(first.attempt).toMatchObject({
      outcome: 'incorrect',
      engineApplied: true,
      attemptNo: 1,
      attemptInItem: 1,
    });
    expect(first.grade.misconceptions).toEqual([
      { id: 'js.mc.log-is-return', title: 'console.log를 반환으로 생각함' },
    ]);
    expect(first.grade.explanation).toBe(`${EX.mcq} 해설`);

    const right = inlineAttemptResponseSchema.parse(
      (await inline(ctx, EX.mcq, { answer: { optionId: 'b' } })).json,
    );
    expect(right.attempt).toMatchObject({ correct: true, attemptNo: 2, attemptInItem: 2 });
    const change = right.masteryChanges.find((m) => m.conceptId === 'js.basics.statement');
    expect(change?.scoreAfter).toBeGreaterThan(change?.scoreBefore ?? 100);

    expect(
      ctx.userDb.sqlite
        .prepare('SELECT practice_set_item_id, is_review, engine_applied FROM attempts')
        .all(),
    ).toEqual([
      { practice_set_item_id: null, is_review: 0, engine_applied: 1 },
      { practice_set_item_id: null, is_review: 0, engine_applied: 1 },
    ]);
    expect(count(ctx, 'pending_ratings')).toBe(0);
    expect(count(ctx, 'concept_memory')).toBe(0);
    expect(count(ctx, 'practice_sets')).toBe(0);
    expect(
      ctx.userDb.sqlite.prepare('SELECT attempts_count, correct_count FROM daily_activity').get(),
    ).toEqual({ attempts_count: 2, correct_count: 1 });

    // An inline attempt does not count as an attempt in a later practice set item.
    const set = await lessonSet(ctx);
    const mcq = set.items.find((i) => i.exerciseId === EX.mcq);
    if (!mcq) throw new Error('fixture set misses mcq');
    expect(parsed(await submit(ctx, mcq)).attempt).toMatchObject({
      attemptInItem: 1,
      attemptNo: 3,
    });
  });

  it('rejects run-based exercises, bad answers and unknown exercises', async () => {
    const ctx = await practiceApp();
    const run = await inline(ctx, EX.implement, { answer: CORRECT[EX.implement] });
    expect(run.status).toBe(409);
    expect(errorCode(run.json)).toBe('EXERCISE_RUN_REQUIRED');
    const bad = await inline(ctx, EX.mcq, { answer: { optionId: 7 } });
    expect(errorCode(bad.json)).toBe('VALIDATION_ANSWER_INVALID');
    const extra = await inline(ctx, EX.mcq, { answer: { optionId: 'b' }, practiceSetItemId: 'x' });
    expect(extra.status).toBe(400);
    expect((await inline(ctx, 'a.b.c.nope', { answer: { optionId: 'b' } })).status).toBe(404);
    expect(count(ctx, 'attempts')).toBe(0);
  });
});

describe('a wrong answer to the last item', () => {
  /** Answers every item right except the last one, which is answered wrong. */
  async function lastWrong(ctx: Awaited<ReturnType<typeof practiceApp>>) {
    const set = await lessonSet(ctx);
    const items = [...set.items];
    const lastItem = items.pop();
    if (!lastItem) throw new Error('empty set');
    for (const item of items) parsed(await submit(ctx, item));
    const wrong = parsed(await submit(ctx, lastItem, { correct: false }));
    return { set, lastItem, wrong };
  }

  it('keeps the set open so the item can be tried again', async () => {
    const ctx = await practiceApp();
    const { set, lastItem, wrong } = await lastWrong(ctx);
    expect(wrong.attempt.correct).toBe(false);
    expect(wrong.set.status).toBe('active');
    expect(wrong.set.nextItemId).toBeNull();
    expect(wrong.set.result).toBeNull();
    expect(wrong.set.progress).toEqual({ total: N, answered: N, skipped: 0, pending: 0 });
    expect(
      ctx.userDb.sqlite.prepare('SELECT status, practice_set_id FROM lesson_progress').get(),
    ).toEqual({ status: 'practicing', practice_set_id: set.id });
    // Resuming the lesson returns the same open set.
    expect((await lessonSet(ctx)).id).toBe(set.id);

    const retried = parsed(await submit(ctx, lastItem));
    expect(retried.item).toEqual({ id: lastItem.id, status: 'answered', attempts: 2 });
    expect(retried.set.status).toBe('completed');
    expect(retried.set.result).toMatchObject({ total: N, answered: N, correct: N });
    expect(retried.set.result?.pass?.passed).toBe(true);
    expect(
      ctx.userDb.sqlite
        .prepare('SELECT COUNT(*) AS n FROM pending_ratings WHERE flushed_at IS NULL')
        .get(),
    ).toEqual({ n: 0 });
  });

  it('ends the set with "결과 보기" (finish) as it stands', async () => {
    const ctx = await practiceApp();
    const { set } = await lastWrong(ctx);
    const res = await ctx.call('POST', `/practice-sets/${set.id}/finish`);
    expect(res.status).toBe(200);
    const done = finishSetResponseSchema.parse(res.json);
    expect(done.set).toMatchObject({ id: set.id, status: 'completed', nextItemId: null });
    expect(done.set.result).toMatchObject({ total: N, answered: N, correct: N - 1 });
    expect(
      ctx.userDb.sqlite.prepare('SELECT status FROM practice_sets WHERE id = ?').get(set.id),
    ).toEqual({ status: 'completed' });
    expect(
      ctx.userDb.sqlite
        .prepare('SELECT COUNT(*) AS n FROM pending_ratings WHERE flushed_at IS NULL')
        .get(),
    ).toEqual({ n: 0 });
    expect(
      (
        ctx.userDb.sqlite.prepare('SELECT practice_set_id FROM lesson_progress').get() as {
          practice_set_id: string | null;
        }
      ).practice_set_id,
    ).toBeNull();

    const again = await ctx.call('POST', `/practice-sets/${set.id}/finish`);
    expect(again.status).toBe(409);
    expect(errorCode(again.json)).toBe('PRACTICE_SET_CLOSED');
  });

  it('refuses to finish while items are pending', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const res = await ctx.call('POST', `/practice-sets/${set.id}/finish`);
    expect(res.status).toBe(409);
    expect(errorCode(res.json)).toBe('PRACTICE_SET_UNFINISHED');
    const missing = await ctx.call('POST', '/practice-sets/01JD3Z8Q6V2K9M4T7R1X5W0BNC/finish');
    expect(missing.status).toBe(404);
  });
});
