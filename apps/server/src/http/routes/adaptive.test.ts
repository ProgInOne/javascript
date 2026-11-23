import {
  practiceSetViewSchema,
  skipItemResponseSchema,
  weakConceptsSchema,
  type PracticeSetView,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { REMEDIAL } from '../../test/content-fixture.ts';
import { count, DAY, practiceApp } from '../../test/practice-app.ts';
import {
  createSet,
  errorCode,
  lessonSet,
  parsed,
  submit,
  type Ctx,
} from '../../test/practice-flow.ts';

// Adaptive items, skipping and weakness sets
// (learning-engine.md#진행-중-적응-nextadaptivestep, #약점-집중-세트).

async function getSet(ctx: Ctx, id: string): Promise<PracticeSetView> {
  return practiceSetViewSchema.parse((await ctx.call('GET', `/practice-sets/${id}`)).json);
}

/** Answers pending items in order (re-reading the set after each answer, like the web app). */
async function answerRest(ctx: Ctx, setId: string, correct = true) {
  for (;;) {
    const set = await getSet(ctx, setId);
    const next = set.items.find((i) => i.id === set.nextItemId);
    if (!next) return set;
    parsed(await submit(ctx, next, { correct }));
  }
}

/** A lesson set answered all wrong: the concept is weak with a confirmed misconception. */
async function weakLearner(ctx: Ctx) {
  const set = await lessonSet(ctx);
  await answerRest(ctx, set.id, false);
}

describe('relearning items in a set', () => {
  it('appends a prerequisite check after two wrong items and keeps it out of the pass rule', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const [a, b] = set.items;
    if (!a || !b) throw new Error('set too small');
    const n = set.items.length;
    parsed(await submit(ctx, a, { correct: false }));
    const res = parsed(await submit(ctx, b, { correct: false }));
    expect(res.remediation?.kind).toBe('prerequisite_check');
    expect(res.remediation?.itemIds).toHaveLength(3);
    expect(res.adaptations.map((x) => [x.kind, x.reason, x.position, x.targetConcept?.id])).toEqual(
      [
        ['append', 'remedial_prereq', n, 'js.basics.comment'],
        ['append', 'remedial_prereq', n + 1, 'js.basics.comment'],
        ['append', 'remedial_prereq', n + 2, 'js.basics.comment'],
      ],
    );
    expect(res.adaptations.map((x) => x.itemId)).toEqual(res.remediation?.itemIds);
    expect(new Set(res.adaptations.map((x) => x.exerciseId))).toEqual(
      new Set([REMEDIAL.commentL1a, REMEDIAL.commentL1b, REMEDIAL.commentL2]),
    );
    expect(res.set.progress).toEqual({ total: n + 3, answered: 2, skipped: 0, pending: n + 1 });
    const stored = ctx.userDb.sqlite
      .prepare('SELECT item_ids_json FROM remediation_suggestions')
      .get() as {
      item_ids_json: string;
    };
    expect(JSON.parse(stored.item_ids_json)).toEqual(res.remediation?.itemIds);

    const done = await answerRest(ctx, set.id);
    expect(done.status).toBe('completed');
    expect(done.result?.total).toBe(n + 3);
    // n - 2 of the n lesson items right: the relearning items do not dilute or lift the bar.
    expect(done.result?.pass?.checks.minCorrect.actual).toBeCloseTo((n - 2) / n, 6);
  });
});

describe('POST /practice-sets/:id/items/:itemId/skip', () => {
  it('skips a pending item and completes the set when it was the last one', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const [first, ...rest] = set.items;
    if (!first) throw new Error('empty set');
    const res = await ctx.call('POST', `/practice-sets/${set.id}/items/${first.id}/skip`);
    expect(res.status).toBe(200);
    const skipped = skipItemResponseSchema.parse(res.json);
    expect(skipped.item).toEqual({ id: first.id, status: 'skipped', attempts: 0 });
    // Every practice exercise of the concept is already in the lesson set: nothing to add.
    expect(skipped.adaptations).toEqual([]);
    expect(skipped.set.progress).toMatchObject({ skipped: 1, pending: set.items.length - 1 });
    expect(skipped.set.nextItemId).toBe(rest[0]?.id);

    const again = await ctx.call('POST', `/practice-sets/${set.id}/items/${first.id}/skip`);
    expect(again.status).toBe(409);
    expect(errorCode(again.json)).toBe('PRACTICE_ITEM_DONE');

    const last = rest.pop();
    for (const item of rest) parsed(await submit(ctx, item));
    if (!last) throw new Error('set too small');
    const end = skipItemResponseSchema.parse(
      (await ctx.call('POST', `/practice-sets/${set.id}/items/${last.id}/skip`)).json,
    );
    expect(end.set.status).toBe('completed');
    const n = set.items.length;
    expect(end.set.result).toMatchObject({ total: n, answered: n - 2, skipped: 2 });
    // The concept's ratings are applied when the set ends, also when it ends with a skip.
    expect(count(ctx, 'review_logs')).toBe(1);
    const closed = await ctx.call('POST', `/practice-sets/${set.id}/items/${last.id}/skip`);
    expect(errorCode(closed.json)).toBe('PRACTICE_SET_CLOSED');
    const missing = await ctx.call(
      'POST',
      `/practice-sets/${set.id}/items/01JD3Z8Q6V2K9M4T7R1X5W0BNC/skip`,
    );
    expect(missing.status).toBe(404);
  });
});

describe('weakness practice', () => {
  it('lists weak concepts with misconceptions and prerequisites', async () => {
    const ctx = await practiceApp();
    expect(weakConceptsSchema.parse((await ctx.call('GET', '/weak-concepts')).json)).toEqual({
      concepts: [],
      suggested: [],
    });
    await weakLearner(ctx);
    const list = weakConceptsSchema.parse((await ctx.call('GET', '/weak-concepts')).json);
    const statement = list.concepts.find((c) => c.concept.id === 'js.basics.statement');
    expect(statement).toMatchObject({
      stage: 'practicing',
      misconceptions: [
        { id: 'js.mc.log-is-return', title: 'console.log를 반환으로 생각함', status: 'confirmed' },
      ],
      prerequisites: [
        { concept: { id: 'js.basics.comment', title: 'js.basics.comment' }, weak: true },
      ],
    });
    expect(statement?.factors.misconceptionFactor).toBe(1.5);
    expect(list.suggested).toContain('js.basics.statement');
  });

  it('drops a concept once its mastery is past the weakness bar, but still practises it by name', async () => {
    const ctx = await practiceApp();
    await weakLearner(ctx);
    const before = weakConceptsSchema.parse((await ctx.call('GET', '/weak-concepts')).json);
    expect(before.concepts.map((c) => c.concept.id)).toContain('js.basics.statement');

    // Practice lifted the concept well past the bar (D-095): every weakness score is positive
    // below 100, so the bar is what takes it off the list.
    ctx.userDb.sqlite
      .prepare("UPDATE concept_mastery SET score = 95 WHERE concept_id = 'js.basics.statement'")
      .run();
    const after = weakConceptsSchema.parse((await ctx.call('GET', '/weak-concepts')).json);
    expect(after.concepts.map((c) => c.concept.id)).not.toContain('js.basics.statement');
    expect(after.suggested).not.toContain('js.basics.statement');
    expect(after.concepts.every((c) => c.effective < 60)).toBe(true);

    const named = await createSet(ctx, { kind: 'weakness', conceptIds: ['js.basics.statement'] });
    expect(named.items.every((i) => i.targetConcept?.id === 'js.basics.statement')).toBe(true);
  });

  it('builds a weakness set, resumes it, and answers 409 when nothing is weak', async () => {
    const ctx = await practiceApp();
    const none = await ctx.call('POST', '/practice-sets', { kind: 'weakness' });
    expect(none.status).toBe(409);
    expect(errorCode(none.json)).toBe('PRACTICE_NOTHING_WEAK');

    await weakLearner(ctx);
    const set = await createSet(ctx, { kind: 'weakness', conceptIds: ['js.basics.statement'] });
    expect(set.kind).toBe('weakness');
    expect(set.passRule).toBeNull();
    // Confirmed misconception and low mastery: four items on a rising ladder from L1. (The
    // ladder is L1, L1, L2, L3; exercises seen in the last 7 days give way to fresh ones a level
    // up, as in every set.)
    expect(set.items.map((i) => i.targetConcept?.id)).toEqual(Array(4).fill('js.basics.statement'));
    const levels = set.items.map((i) => i.difficulty);
    expect(levels[0]).toBe(1);
    expect(levels).toEqual([...levels].sort((x, y) => x - y));
    // An exercise targeting the confirmed misconception comes within the first two items.
    expect(set.items.slice(0, 2).some((i) => i.reason === 'misconception_target')).toBe(true);
    expect(new Set(set.items.map((i) => i.exerciseId)).size).toBe(4);

    const resumed = await createSet(ctx, { kind: 'weakness' });
    expect(resumed.id).toBe(set.id);
    const unknown = await ctx.call('POST', '/practice-sets', {
      kind: 'weakness',
      conceptIds: ['js.nope'],
    });
    expect(errorCode(unknown.json)).toBe('PRACTICE_NOTHING_WEAK');
    const tooMany = await ctx.call('POST', '/practice-sets', {
      kind: 'weakness',
      conceptIds: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(tooMany.status).toBe(400);
  });

  it('steps up a remaining warm-up item after two right answers in a row', async () => {
    const ctx = await practiceApp();
    await weakLearner(ctx);
    // Past the 7-day freshness block, so the ladders follow difficulty exactly.
    ctx.clock.now += 8 * DAY;
    const set = await createSet(ctx, {
      kind: 'weakness',
      conceptIds: ['js.basics.statement', 'js.basics.comment'],
    });
    const statement = set.items.filter((i) => i.targetConcept?.id === 'js.basics.statement');
    expect(statement.map((i) => [i.position, i.difficulty])).toEqual([
      [0, 1],
      [2, 1],
      [4, 2],
      [6, 3],
    ]);
    const [s0, s2, s4] = statement;
    if (!s0 || !s2 || !s4) throw new Error('set too small');
    parsed(await submit(ctx, s0));
    const res = parsed(await submit(ctx, s2));
    // The next pending item (position 1) is left alone; the L2 warm-up at position 4 goes up.
    expect(res.adaptations).toEqual([
      {
        kind: 'replace',
        itemId: s4.id,
        position: 4,
        exerciseId: expect.any(String) as string,
        reason: 'difficulty_step_up',
        targetConcept: { id: 'js.basics.statement', title: 'js.basics.statement' },
      },
    ]);
    const after = await getSet(ctx, set.id);
    const row = after.items.find((i) => i.id === s4.id);
    expect(row).toMatchObject({ reason: 'difficulty_step_up', difficulty: 3, status: 'pending' });
    expect(row?.exerciseId).toBe(res.adaptations[0]?.exerciseId);
    expect(after.items).toHaveLength(set.items.length);
    // The replaced item can be answered with its new exercise.
    parsed(await submit(ctx, { id: s4.id, exerciseId: row?.exerciseId ?? '' }));
  });
});
