import {
  assessmentAttemptResponseSchema,
  lessonDetailSchema,
  practiceSetViewSchema,
  skipItemResponseSchema,
  type PracticeSetView,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { ANSWER_MARKERS, ASSESS, ASSESSMENT } from '../../test/content-fixture.ts';
import { DAY, practiceApp } from '../../test/practice-app.ts';
import { createSet, errorCode, LESSON, type Ctx } from '../../test/practice-flow.ts';

// Unit assessments (learning-engine.md#단원-평가-세트): locks, one submission per item, results
// withheld until the end, W_ctx and the independent-application evidence.

const RIGHT = { optionId: 'b' };
const WRONG = { optionId: 'a' };
const answerOf = (exerciseId: string, correct: boolean) =>
  exerciseId === ASSESS.commentL3 ? { value: !correct } : correct ? RIGHT : WRONG;

const assessmentSet = (ctx: Ctx) => createSet(ctx, { kind: 'assessment', lessonId: ASSESSMENT });

async function answer(ctx: Ctx, item: { id: string; exerciseId: string }, correct = true) {
  ctx.clock.now += 60_000;
  return ctx.call('POST', '/attempts', {
    practiceSetItemId: item.id,
    exerciseId: item.exerciseId,
    answer: answerOf(item.exerciseId, correct),
    confidence: 'sure',
    startedAt: ctx.clock.now - 40_000,
    activeMs: 30_000,
  });
}

/** Keys that must never appear in a response before the assessment ends. */
const LEAKS = ['grade', 'explanation', 'outcome', 'masteryChanges', 'misconceptionChanges'];

function expectNoLeak(json: unknown) {
  const text = JSON.stringify(json);
  for (const key of LEAKS) expect(text).not.toContain(`"${key}"`);
  for (const marker of [...ANSWER_MARKERS, '해설']) expect(text).not.toContain(marker);
}

describe('POST /practice-sets (assessment)', () => {
  it('builds the assessment once, easy to hard, covering every concept', async () => {
    const ctx = await practiceApp();
    const set = await assessmentSet(ctx);
    expect(set).toMatchObject({ kind: 'assessment', status: 'active', lessonId: ASSESSMENT });
    expect(set.passRule).toBeNull();
    expect(set.items).toHaveLength(5);
    expect(new Set(set.items.map((i) => i.exerciseId))).toEqual(new Set(Object.values(ASSESS)));
    expect(set.items.every((i) => i.reason === 'assessment')).toBe(true);
    const difficulties = set.items.map((i) => i.difficulty);
    expect(difficulties).toEqual([...difficulties].sort((a, b) => a - b));
    expect(new Set(set.items.map((i) => i.targetConcept?.id))).toEqual(
      new Set(['js.basics.statement', 'js.basics.comment']),
    );
    expect((await assessmentSet(ctx)).id).toBe(set.id);
    expect(
      ctx.userDb.sqlite.prepare('SELECT status, practice_set_id FROM lesson_progress').get(),
    ).toEqual({ status: 'practicing', practice_set_id: set.id });
  });

  it('refuses the wrong set kind for a unit (PRACTICE_KIND_MISMATCH)', async () => {
    const ctx = await practiceApp();
    const asLesson = await ctx.call('POST', '/practice-sets', {
      kind: 'lesson',
      lessonId: ASSESSMENT,
    });
    expect(asLesson.status).toBe(409);
    expect(errorCode(asLesson.json)).toBe('PRACTICE_KIND_MISMATCH');
    const asAssessment = await ctx.call('POST', '/practice-sets', {
      kind: 'assessment',
      lessonId: LESSON,
    });
    expect(asAssessment.status).toBe(409);
    expect(errorCode(asAssessment.json)).toBe('PRACTICE_KIND_MISMATCH');
  });

  it('keeps assessment items out of lesson practice', async () => {
    const ctx = await practiceApp();
    const lesson = await createSet(ctx, { kind: 'lesson', lessonId: LESSON });
    const ids = new Set(Object.values(ASSESS) as string[]);
    expect(lesson.items.some((i) => ids.has(i.exerciseId))).toBe(false);
  });

  it('announces the rules on the lesson (item count, pass ratio)', async () => {
    const ctx = await practiceApp();
    const lesson = lessonDetailSchema.parse((await ctx.call('GET', `/lessons/${ASSESSMENT}`)).json);
    expect(lesson.kind).toBe('assessment');
    expect(lesson.assessment).toEqual({
      itemCount: 5,
      passRatio: 0.8,
      conceptCount: 2,
      estimatedMinutes: 15,
    });
    const regular = lessonDetailSchema.parse((await ctx.call('GET', `/lessons/${LESSON}`)).json);
    expect(regular.assessment).toBeNull();
  });
});

describe('assessment locks', () => {
  it('refuses hints and the solution, with or without the item context', async () => {
    const ctx = await practiceApp();
    const set = await assessmentSet(ctx);
    const item = set.items[0];
    if (!item) throw new Error('empty');
    for (const body of [{ practiceSetItemId: item.id }, {}]) {
      for (const path of ['hints', 'solution']) {
        const res = await ctx.call('POST', `/exercises/${item.exerciseId}/${path}`, body);
        expect(res.status).toBe(403);
        expect(errorCode(res.json)).toBe('EXERCISE_LOCKED_IN_ASSESSMENT');
        expectNoLeak(res.json);
      }
    }
    expect(ctx.userDb.sqlite.prepare('SELECT COUNT(*) AS n FROM hint_events').get()).toEqual({
      n: 0,
    });
  });

  it('refuses inline attempts on assessment items (they would reveal the result)', async () => {
    const ctx = await practiceApp();
    const res = await ctx.call('POST', `/exercises/${ASSESS.statementL2}/inline-attempts`, {
      answer: RIGHT,
      startedAt: ctx.clock.now - 1000,
      activeMs: 1000,
    });
    expect(res.status).toBe(403);
    expect(errorCode(res.json)).toBe('EXERCISE_LOCKED_IN_ASSESSMENT');
    expectNoLeak(res.json);
  });

  it('locks the tutor and the mistake explanation while the assessment runs', async () => {
    const ctx = await practiceApp();
    const set = await assessmentSet(ctx);
    const item = set.items[0];
    if (!item) throw new Error('empty');
    const hint = await ctx.call('POST', `/exercises/${item.exerciseId}/ai-hint`, {
      practiceSetItemId: item.id,
    });
    expect(errorCode(hint.json)).toBe('AI_LOCKED_IN_ASSESSMENT');
    const thread = await ctx.call('POST', '/tutor/threads', {
      scopeType: 'lesson',
      scopeId: ASSESSMENT,
    });
    const threadId = (thread.json as { id: string }).id;
    const asked = await ctx.call('POST', `/tutor/threads/${threadId}/messages`, {
      question: '정답이 뭐예요?',
    });
    expect(asked.status).toBe(403);
    expect(errorCode(asked.json)).toBe('AI_LOCKED_IN_ASSESSMENT');
    const byExercise = await ctx.call('POST', `/tutor/threads/${threadId}/messages`, {
      question: '정답이 뭐예요?',
      exerciseId: item.exerciseId,
    });
    expect(errorCode(byExercise.json)).toBe('AI_LOCKED_IN_ASSESSMENT');

    const wrong = await answer(ctx, item, false);
    const attemptId = assessmentAttemptResponseSchema.parse(wrong.json).attempt.id;
    const explain = await ctx.call('POST', `/attempts/${attemptId}/explanation`);
    expect(errorCode(explain.json)).toBe('AI_LOCKED_IN_ASSESSMENT');
  });
});

describe('POST /attempts (assessment)', () => {
  it('records each answer once and withholds results until the end', async () => {
    const ctx = await practiceApp();
    const set = await assessmentSet(ctx);
    const [first, second] = set.items;
    if (!first || !second) throw new Error('empty');

    const res = await answer(ctx, first, false);
    expect(res.status).toBe(201);
    expectNoLeak(res.json);
    const body = assessmentAttemptResponseSchema.parse(res.json);
    expect(body).toMatchObject({
      withheld: true,
      item: { id: first.id, status: 'answered', attempts: 1 },
      set: { status: 'active', nextItemId: second.id, result: null },
    });

    const again = await answer(ctx, first, true);
    expect(again.status).toBe(409);
    expect(errorCode(again.json)).toBe('PRACTICE_ITEM_DONE');

    const view = await ctx.call('GET', `/practice-sets/${set.id}`);
    expectNoLeak(view.json);
    const parsedView = practiceSetViewSchema.parse(view.json);
    expect(parsedView.items[0]).toMatchObject({ status: 'answered', lastOutcome: null });
    expect(parsedView.result).toBeNull();

    // The concept detail does not show the per-attempt evidence yet.
    const concept = (await ctx.call('GET', `/concepts/${first.targetConcept?.id ?? ''}`)).json as {
      evidence: { attemptId: string | null }[];
    };
    expect(concept.evidence.some((e) => e.attemptId === body.attempt.id)).toBe(false);
  });

  it('reveals every answer and explanation at the end, with missed concepts', async () => {
    const ctx = await practiceApp();
    const set = await assessmentSet(ctx);
    let last: unknown;
    for (const item of set.items) {
      // Everything right except the comment items.
      const res = await answer(ctx, item, item.targetConcept?.id !== 'js.basics.comment');
      last = res.json;
    }
    const end = assessmentAttemptResponseSchema.parse(last);
    expect(end.set.status).toBe('completed');
    const result = end.set.result?.assessment;
    expect(result).toMatchObject({
      correct: 3,
      total: 5,
      ratio: 0.6,
      passRatio: 0.8,
      passed: false,
    });
    expect(result?.missedConcepts).toEqual([
      { id: 'js.basics.comment', title: 'js.basics.comment' },
    ]);
    expect(result?.weaknessConceptIds).toEqual(['js.basics.comment']);
    expect(result?.items).toHaveLength(5);
    const tf = result?.items.find((i) => i.exerciseId === ASSESS.commentL3);
    expect(tf).toMatchObject({ correct: false, outcome: 'incorrect', status: 'answered' });
    expect(tf?.explanation).toBe(`${ASSESS.commentL3} 해설`);
    expect(tf?.solution.kind).toBe('text');
    expect(tf?.misconceptions.map((m) => m.id)).toEqual(['js.mc.log-is-return']);
    const mcq = result?.items.find((i) => i.exerciseId === ASSESS.statementL2);
    expect(mcq).toMatchObject({ correct: true, solution: { kind: 'choice', choiceId: 'b' } });

    const view = practiceSetViewSchema.parse(
      (await ctx.call('GET', `/practice-sets/${set.id}`)).json,
    );
    expect(view.result?.assessment).toEqual(result);
    expect(view.items.every((i) => i.lastOutcome !== null)).toBe(true);
    // Not passed: the unit is not completed, and the next request is a retake.
    expect(
      ctx.userDb.sqlite.prepare('SELECT status, practice_set_id FROM lesson_progress').get(),
    ).toEqual({ status: 'practicing', practice_set_id: null });
    // After the end the lock is lifted; a retake (a new active attempt) locks its items again.
    expect((await ctx.call('POST', `/exercises/${ASSESS.statementL2}/hints`, {})).status).toBe(200);
    expect((await assessmentSet(ctx)).id).not.toBe(set.id);
    expect((await ctx.call('POST', `/exercises/${ASSESS.statementL3}/hints`, {})).status).toBe(403);
  });

  it('completes the unit when passed; skipped items count as wrong', async () => {
    const ctx = await practiceApp();
    const set = await assessmentSet(ctx);
    const items = [...set.items];
    const skipped = items.pop();
    if (!skipped) throw new Error('empty');
    for (const item of items) await answer(ctx, item, true);
    const res = await ctx.call('POST', `/practice-sets/${set.id}/items/${skipped.id}/skip`);
    expect(res.status).toBe(200);
    const body = skipItemResponseSchema.parse(res.json);
    expect(body.adaptations).toEqual([]);
    expect(body.set.result?.assessment).toMatchObject({ correct: 4, total: 5, passed: true });
    expect(body.set.result?.assessment?.items.at(-1)).toMatchObject({
      status: 'skipped',
      outcome: null,
      correct: false,
    });
    expect(ctx.userDb.sqlite.prepare('SELECT status FROM lesson_progress').get()).toEqual({
      status: 'completed',
    });
  });

  it('weights correct answers 1.2× and stores independent-application evidence', async () => {
    const ctx = await practiceApp();
    const set = await assessmentSet(ctx);
    const item = set.items[0];
    if (!item) throw new Error('empty');
    await answer(ctx, item, true);
    const row = ctx.userDb.sqlite
      .prepare(
        "SELECT breakdown_json FROM mastery_evidence WHERE kind = 'attempt' ORDER BY created_at DESC LIMIT 1",
      )
      .get() as { breakdown_json: string };
    const breakdown = JSON.parse(row.breakdown_json) as {
      factors: { context: { value: number; why: string } };
      fact: { setKind: string; unassisted: boolean; correct: boolean; weight: number };
    };
    expect(breakdown.factors.context).toEqual({ value: 1.2, why: 'assessment' });
    expect(breakdown.fact).toMatchObject({
      setKind: 'assessment',
      unassisted: true,
      correct: true,
    });
  });

  it('prefers items not seen before on a retake', async () => {
    const ctx = await practiceApp();
    // Only 5 items: a retake reuses them, and the rationale says how many were seen.
    const first = await assessmentSet(ctx);
    for (const item of first.items) await answer(ctx, item, true);
    ctx.clock.now += DAY;
    const retake: PracticeSetView = await assessmentSet(ctx);
    expect(retake.id).not.toBe(first.id);
    expect(retake.items).toHaveLength(5);
    const scope = ctx.userDb.sqlite
      .prepare('SELECT scope_json FROM practice_sets WHERE id = ?')
      .get(retake.id) as { scope_json: string };
    expect(JSON.parse(scope.scope_json)).toMatchObject({
      passRatio: 0.8,
      rationale: { seenItems: 5, uncovered: [] },
    });
  });
});
