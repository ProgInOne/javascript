import {
  practiceSetReviewSchema,
  practiceSetViewSchema,
  type PracticeSetView,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { ASSESSMENT, EX } from '../../test/content-fixture.ts';
import { practiceApp } from '../../test/practice-app.ts';
import {
  createSet,
  errorCode,
  lessonSet,
  parsed,
  submit,
  type Ctx,
} from '../../test/practice-flow.ts';

// "푼 문제 돌아보기" (D-098): the items of a finished set with the learner's last answer, showing
// only what the learner has already seen (D-044).

const itemOf = (set: PracticeSetView, exerciseId: string) => {
  const item = set.items.find((i) => i.exerciseId === exerciseId);
  if (!item) throw new Error(`no item for ${exerciseId}`);
  return item;
};

/** Answers whatever is still pending (items the engine added too), then ends the set. */
const finish = async (ctx: Ctx, set: PracticeSetView) => {
  for (let round = 0; round < 10; round++) {
    const now = practiceSetViewSchema.parse(
      (await ctx.call('GET', `/practice-sets/${set.id}`)).json,
    );
    if (now.status === 'completed') return;
    const pending = now.items.filter((i) => i.status === 'pending');
    if (pending.length === 0) {
      expect((await ctx.call('POST', `/practice-sets/${set.id}/finish`)).status).toBe(200);
      return;
    }
    for (const item of pending) parsed(await submit(ctx, item));
  }
  throw new Error('set did not finish');
};

const review = async (ctx: Ctx, setId: string) => {
  const res = await ctx.call('GET', `/practice-sets/${setId}/review`);
  expect(res.status).toBe(200);
  return { review: practiceSetReviewSchema.parse(res.json), text: res.text };
};

describe('GET /practice-sets/:id/review', () => {
  it('waits until the set is finished', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const res = await ctx.call('GET', `/practice-sets/${set.id}/review`);
    expect(res.status).toBe(409);
    expect(errorCode(res.json)).toBe('PRACTICE_SET_UNFINISHED');
  });

  it('lists every item with the last answer, feedback and explanation, but no unseen solution', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    // Wrong first, then right: the last attempt is the one shown, with the count.
    parsed(await submit(ctx, itemOf(set, EX.mcq), { correct: false }));
    parsed(await submit(ctx, itemOf(set, EX.mcq)));
    parsed(await submit(ctx, itemOf(set, EX.implement), { correct: false }));
    const skipped = itemOf(set, EX.trueFalse);
    expect(
      (await ctx.call('POST', `/practice-sets/${set.id}/items/${skipped.id}/skip`)).status,
    ).toBe(200);
    await finish(ctx, set);

    const { review: r, text } = await review(ctx, set.id);
    expect(r.setId).toBe(set.id);
    const positions = r.items.map((i) => i.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(r.items.length).toBeGreaterThanOrEqual(set.items.length);

    const mcq = r.items.find((i) => i.exerciseId === EX.mcq);
    expect(mcq).toMatchObject({
      type: 'mcq_single',
      status: 'answered',
      attempts: 2,
      last: { outcome: 'correct', confidence: 'sure', answer: { kind: 'choice' } },
      explanation: `${EX.mcq} 해설`,
      solution: null,
      archived: false,
      concept: { id: 'js.basics.statement' },
    });

    const implement = r.items.find((i) => i.exerciseId === EX.implement);
    expect(implement).toMatchObject({
      attempts: 1,
      last: { outcome: 'incorrect', answer: { kind: 'files', files: [{ path: 'main.js' }] } },
      explanation: `${EX.implement} 해설`,
      solution: null,
      retry: { available: true, blockedBy: null },
    });
    expect(implement?.last?.feedback.length).toBeGreaterThan(0);

    // Skipped before any attempt: nothing was graded, so the explanation was never shown.
    expect(r.items.find((i) => i.itemId === skipped.id)).toMatchObject({
      status: 'skipped',
      attempts: 0,
      last: null,
      explanation: null,
      solution: null,
    });

    // Hidden checks and reference answers never leave the server.
    expect(text).not.toContain('SOLUTION-MARK');
    expect(text).not.toContain('QUIET!');
  });

  it('shows the reference answer once the learner opened it', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const item = itemOf(set, EX.implement);
    parsed(await submit(ctx, item, { correct: false }));
    for (let i = 0; i < 3; i++) {
      await ctx.call('POST', `/exercises/${EX.implement}/hints`, { practiceSetItemId: item.id });
    }
    const opened = await ctx.call('POST', `/exercises/${EX.implement}/solution`, {
      practiceSetItemId: item.id,
    });
    expect(opened.status).toBe(200);
    await finish(ctx, set);

    const { review: r } = await review(ctx, set.id);
    const implement = r.items.find((i) => i.itemId === item.id);
    expect(implement?.solution?.kind).toBe('files');
    expect(JSON.stringify(implement?.solution)).toContain('SOLUTION-MARK');
  });

  it('keeps the explanation and answer locked while the exercise is in an assessment in progress', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const item = itemOf(set, EX.implement);
    parsed(await submit(ctx, item, { correct: false }));
    for (let i = 0; i < 3; i++) {
      await ctx.call('POST', `/exercises/${EX.implement}/hints`, { practiceSetItemId: item.id });
    }
    await ctx.call('POST', `/exercises/${EX.implement}/solution`, { practiceSetItemId: item.id });
    await finish(ctx, set);

    // Content today never puts a practice exercise in an assessment; a later content pack that
    // changes an exercise's usage could. Simulate it on an assessment in progress.
    const assessment = await createSet(ctx, { kind: 'assessment', lessonId: ASSESSMENT });
    const target = assessment.items[0];
    if (!target) throw new Error('empty assessment');
    ctx.userDb.sqlite
      .prepare('UPDATE practice_set_items SET exercise_id = ? WHERE id = ?')
      .run(EX.implement, target.id);

    const { review: r, text } = await review(ctx, set.id);
    const implement = r.items.find((i) => i.itemId === item.id);
    expect(implement).toMatchObject({ explanation: null, solution: null });
    expect(implement?.last?.outcome).toBe('incorrect');
    expect(text).not.toContain('SOLUTION-MARK');
  });

  it('leaves assessments to their result screen', async () => {
    const ctx = await practiceApp();
    const set = await createSet(ctx, { kind: 'assessment', lessonId: ASSESSMENT });
    const res = await ctx.call('GET', `/practice-sets/${set.id}/review`);
    expect(res.status).toBe(409);
    expect(errorCode(res.json)).toBe('PRACTICE_KIND_MISMATCH');
  });

  it('is 404 for an unknown set', async () => {
    const ctx = await practiceApp();
    const res = await ctx.call('GET', '/practice-sets/01JUNKNOWNSET000000000000/review');
    expect(res.status).toBe(404);
    expect(errorCode(res.json)).toBe('NOT_FOUND');
  });
});
