import { inlineAttemptResponseSchema } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { WRONG } from '../../test/answers.ts';
import { EX } from '../../test/content-fixture.ts';
import { count, DAY, practiceApp } from '../../test/practice-app.ts';
import { lessonSet, parsed, submit, type Ctx } from '../../test/practice-flow.ts';

// Misconception observations and relearning suggestions in attempt responses
// (learning-engine.md#오개념-상태-전이, #재학습-규칙).

const MC = 'js.mc.log-is-return';

async function itemFor(ctx: Ctx, exerciseId: string) {
  const set = await lessonSet(ctx);
  const item = set.items.find((i) => i.exerciseId === exerciseId);
  if (!item) throw new Error(`no item for ${exerciseId}`);
  return item;
}

function observations(ctx: Ctx) {
  return ctx.userDb.sqlite
    .prepare(
      'SELECT misconception_id, concept_id, status, source, evidence_attempt_ids_json AS evidence, resolution_attempt_ids_json AS resolution, confirm_count FROM misconception_observations',
    )
    .all() as {
    misconception_id: string;
    status: string;
    source: string;
    evidence: string;
    resolution: string;
    confirm_count: number;
  }[];
}

describe('misconception observations', () => {
  it('suspects on a distractor, confirms with evidence from another exercise', async () => {
    const ctx = await practiceApp();
    const mcq = await itemFor(ctx, EX.mcq);
    const first = parsed(
      await submit(ctx, mcq, { correct: false, body: { confidence: 'unsure' } }),
    );
    expect(first.misconceptionChanges).toEqual([
      {
        misconceptionId: MC,
        title: 'console.log를 반환으로 생각함',
        conceptId: 'js.basics.statement',
        statusBefore: null,
        statusAfter: 'suspected',
        transitions: ['observed'],
        resolution: { done: 0, required: 2 },
      },
    ]);
    expect(observations(ctx)).toMatchObject([
      { misconception_id: MC, status: 'suspected', source: 'distractor', confirm_count: 0 },
    ]);

    const predict = await itemFor(ctx, EX.predict);
    const second = parsed(
      await submit(ctx, predict, { correct: false, body: { confidence: 'unsure' } }),
    );
    expect(second.misconceptionChanges[0]).toMatchObject({
      statusBefore: 'suspected',
      statusAfter: 'confirmed',
      transitions: ['confirmed'],
    });
    const [row] = observations(ctx);
    expect(row?.status).toBe('confirmed');
    expect(JSON.parse(row?.evidence ?? '[]')).toEqual([first.attempt.id, second.attempt.id]);
    expect(count(ctx, 'misconception_observations')).toBe(1);
  });

  it('confirms at once when the learner was sure (scenario 6)', async () => {
    const ctx = await practiceApp();
    const res = parsed(await submit(ctx, await itemFor(ctx, EX.mcq), { correct: false }));
    expect(res.misconceptionChanges[0]?.statusAfter).toBe('confirmed');
  });

  it('resolves after two first-try correct targeted answers a day apart', async () => {
    const ctx = await practiceApp();
    parsed(await submit(ctx, await itemFor(ctx, EX.mcq), { correct: false }));
    // The predict exercise targets the misconception through its wrong-answer pattern.
    const step = parsed(await submit(ctx, await itemFor(ctx, EX.predict)));
    expect(step.misconceptionChanges[0]).toMatchObject({
      statusAfter: 'confirmed',
      transitions: ['resolution_progress'],
      resolution: { done: 1, required: 2 },
    });
    ctx.clock.now += DAY;
    const res = await ctx.call('POST', `/exercises/${EX.predict}/inline-attempts`, {
      answer: { console: '2' },
      confidence: 'sure',
      startedAt: ctx.clock.now - 20_000,
      activeMs: 10_000,
    });
    const inline = inlineAttemptResponseSchema.parse(res.json);
    expect(inline.misconceptionChanges[0]).toMatchObject({
      statusBefore: 'confirmed',
      statusAfter: 'resolved',
      transitions: ['resolved'],
    });
    expect(observations(ctx)[0]?.status).toBe('resolved');

    // A relapse reopens the same row.
    const relapse = await ctx.call('POST', `/exercises/${EX.predict}/inline-attempts`, {
      answer: WRONG[EX.predict],
      confidence: 'unsure',
      startedAt: ctx.clock.now - 20_000,
      activeMs: 10_000,
    });
    expect(inlineAttemptResponseSchema.parse(relapse.json).misconceptionChanges[0]).toMatchObject({
      statusBefore: 'resolved',
      statusAfter: 'confirmed',
      transitions: ['relapsed'],
    });
    expect(observations(ctx)).toMatchObject([{ status: 'confirmed', confirm_count: 2 }]);
  });
});

describe('relearning suggestions', () => {
  it('suggests checking the weak prerequisite after two wrong items in a row (scenario 7)', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const [a, b, c] = set.items;
    if (!a || !b || !c) throw new Error('set too small');
    const first = parsed(await submit(ctx, a, { correct: false }));
    expect(first.remediation).toBeNull();
    const second = parsed(await submit(ctx, b, { correct: false }));
    expect(second.remediation).toMatchObject({
      concept: { id: 'js.basics.statement', title: 'js.basics.statement' },
      trigger: 'set_consecutive_failures',
      kind: 'prerequisite_check',
      prerequisite: { conceptId: 'js.basics.comment', stage: 'not_started', effective: 0 },
      check: { items: 3, minDifficulty: 1, maxDifficulty: 2, passCorrect: 2 },
      tutorBadge: false,
      lesson: { id: 'js-basics.start.first-program', title: '단원 0' },
      prerequisitesChecked: [
        { conceptId: 'js.basics.comment', depth: 1, weak: true, stage: 'not_started' },
      ],
    });
    const stored = ctx.userDb.sqlite
      .prepare(
        'SELECT id, concept_id, practice_set_id, kind, trigger, prerequisite_id FROM remediation_suggestions',
      )
      .all();
    expect(stored).toEqual([
      {
        id: second.remediation?.id,
        concept_id: 'js.basics.statement',
        practice_set_id: set.id,
        kind: 'prerequisite_check',
        trigger: 'set_consecutive_failures',
        prerequisite_id: 'js.basics.comment',
      },
    ]);
    // One open suggestion per concept and set: a third wrong answer does not repeat it.
    const third = parsed(await submit(ctx, c, { correct: false }));
    expect(third.remediation).toBeNull();
    expect(count(ctx, 'remediation_suggestions')).toBe(1);
  });

  it('does not suggest for inline checks', async () => {
    const ctx = await practiceApp();
    for (let i = 0; i < 3; i++) {
      const res = await ctx.call('POST', `/exercises/${EX.mcq}/inline-attempts`, {
        answer: WRONG[EX.mcq],
        confidence: 'unsure',
        startedAt: ctx.clock.now - 20_000,
        activeMs: 10_000,
      });
      expect(res.status).toBe(201);
      expect(res.json).not.toHaveProperty('remediation');
    }
    expect(count(ctx, 'remediation_suggestions')).toBe(0);
  });
});
