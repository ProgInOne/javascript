import { exerciseStatsSchema, type ExerciseStats } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { ASSESS, ASSESSMENT, EX } from '../../test/content-fixture.ts';
import { practiceApp } from '../../test/practice-app.ts';
import { createSet, errorCode, lessonSet, submit, type Ctx } from '../../test/practice-flow.ts';

async function stats(ctx: Ctx, id: string): Promise<ExerciseStats> {
  const res = await ctx.call('GET', `/exercises/${id}/stats`);
  expect(res.status).toBe(200);
  return exerciseStatsSchema.parse(res.json);
}

describe('GET /exercises/:id/stats (FR-EX-10)', () => {
  it('starts empty, with null rates', async () => {
    const ctx = await practiceApp();
    expect(await stats(ctx, EX.mcq)).toEqual({
      exerciseId: EX.mcq,
      attempts: 0,
      timesServed: 0,
      firstTries: 0,
      firstTryCorrect: 0,
      firstTryCorrectRate: null,
      averageActiveMs: null,
      hintUsedAttempts: 0,
      hintUsageRate: null,
      solutionViewedAttempts: 0,
      lastAttemptAt: null,
    });
  });

  it('counts attempts, first tries, active time, hints and servings', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const item = set.items.find((i) => i.exerciseId === EX.mcq);
    if (!item) throw new Error('the lesson set has no mcq item');
    // Wrong first try, then a hint, then right: one first try (incorrect), two attempts.
    expect((await submit(ctx, item, { correct: false })).status).toBe(201);
    const hint = await ctx.call('POST', `/exercises/${EX.mcq}/hints`, {
      practiceSetItemId: item.id,
    });
    expect(hint.status).toBe(200);
    const second = await submit(ctx, item, { body: { activeMs: 10_000 } });
    expect(second.status).toBe(201);
    const s = await stats(ctx, EX.mcq);
    expect(s).toMatchObject({
      attempts: 2,
      timesServed: 1,
      firstTries: 1,
      firstTryCorrect: 0,
      firstTryCorrectRate: 0,
      hintUsedAttempts: 1,
      solutionViewedAttempts: 0,
      averageActiveMs: 20_000, // (30 000 + 10 000) / 2
    });
    expect(s.hintUsageRate).toBeCloseTo(1 / 2);
    expect(s.lastAttemptAt).toBe(ctx.clock.now);
  });

  it('leaves out attempts of an assessment in progress', async () => {
    const ctx = await practiceApp();
    const set = await createSet(ctx, { kind: 'assessment', lessonId: ASSESSMENT });
    const item = set.items.find((i) => i.exerciseId !== ASSESS.commentL3);
    if (!item) throw new Error('empty assessment');
    const res = await ctx.call('POST', '/attempts', {
      practiceSetItemId: item.id,
      exerciseId: item.exerciseId,
      answer: { optionId: 'a' },
      confidence: 'sure',
      startedAt: ctx.clock.now - 10_000,
      activeMs: 10_000,
    });
    expect(res.status).toBe(201);
    // Served, but the withheld result does not show through the first-try rate.
    expect(await stats(ctx, item.exerciseId)).toMatchObject({
      timesServed: 1,
      attempts: 0,
      firstTryCorrectRate: null,
    });
  });

  it('answers 404 for unknown exercises', async () => {
    const ctx = await practiceApp();
    const res = await ctx.call('GET', '/exercises/nope.nope.nope.nope/stats');
    expect(res.status).toBe(404);
    expect(errorCode(res.json)).toBe('NOT_FOUND');
  });
});
