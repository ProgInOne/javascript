import {
  recentActivityListSchema,
  relatedExercisesSchema,
  type RecentActivityList,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { ASSESS, ASSESSMENT, EX, PROJECT } from '../../test/content-fixture.ts';
import { practiceApp } from '../../test/practice-app.ts';
import {
  answerAll,
  createSet,
  errorCode,
  lessonSet,
  LESSON,
  submit,
  type Ctx,
} from '../../test/practice-flow.ts';

// "최근 활동" (FR-DASH-01) and "관련 문제" (FR-DASH-02, FR-EX-10), both derived from the learning
// records (D-061). Results of an assessment in progress never show through either.

async function recent(ctx: Ctx, query = ''): Promise<RecentActivityList> {
  const res = await ctx.call('GET', `/activity/recent${query}`);
  expect(res.status).toBe(200);
  return recentActivityListSchema.parse(res.json);
}

async function answerAssessmentItem(ctx: Ctx, item: { id: string; exerciseId: string }) {
  ctx.clock.now += 60_000;
  const res = await ctx.call('POST', '/attempts', {
    practiceSetItemId: item.id,
    exerciseId: item.exerciseId,
    answer: item.exerciseId === ASSESS.commentL3 ? { value: false } : { optionId: 'b' },
    confidence: 'sure',
    startedAt: ctx.clock.now - 10_000,
    activeMs: 10_000,
  });
  expect(res.status).toBe(201);
}

describe('GET /activity/recent (FR-DASH-01 최근 활동)', () => {
  it('is empty before any practice', async () => {
    const ctx = await practiceApp();
    expect((await recent(ctx)).items).toEqual([]);
  });

  it('summarizes a practice set in progress, then its completion with the lesson', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const [first, ...rest] = set.items;
    if (!first) throw new Error('empty set');
    await submit(ctx, first, { correct: false });
    let list = await recent(ctx);
    expect(list.items).toEqual([
      {
        type: 'practice',
        id: set.id,
        at: ctx.clock.now,
        date: list.date,
        setKind: 'lesson',
        status: 'active',
        lesson: { id: LESSON, title: expect.any(String) as string },
        concepts: [],
        conceptCount: 0,
        total: set.items.length,
        answered: 1,
        correct: 0,
        stageUps: expect.any(Number) as number,
        lessonCompleted: false,
        assessment: null,
      },
    ]);

    const last = await answerAll(ctx, { ...set, items: rest });
    list = await recent(ctx);
    expect(list.items).toHaveLength(1); // the lesson completion rides on the set's row
    expect(list.items[0]).toMatchObject({
      id: set.id,
      status: 'completed',
      answered: set.items.length,
      correct: set.items.length - 1,
      lessonCompleted: last.set.result?.pass?.passed === true,
    });
  });

  it('withholds the results of an assessment in progress until it ends', async () => {
    const ctx = await practiceApp();
    const set = await createSet(ctx, { kind: 'assessment', lessonId: ASSESSMENT });
    const [first, ...rest] = set.items;
    if (!first) throw new Error('empty assessment');
    await answerAssessmentItem(ctx, first);
    const during = (await recent(ctx)).items[0];
    expect(during).toMatchObject({
      setKind: 'assessment',
      status: 'active',
      answered: 1,
      correct: null,
      stageUps: null,
      assessment: null,
    });

    for (const item of rest) await answerAssessmentItem(ctx, item);
    const after = (await recent(ctx)).items[0];
    expect(after).toMatchObject({
      setKind: 'assessment',
      status: 'completed',
      correct: set.items.length,
      assessment: { passed: true, ratio: 1 },
    });
    expect(after?.type === 'practice' && after.stageUps).toEqual(expect.any(Number));
  });

  it('lists review targets, lesson completions without a set row, newest first, up to limit', async () => {
    const ctx = await practiceApp();
    // A wrong answer makes the concept weak enough for a weakness set.
    const lesson = await lessonSet(ctx);
    const wrong = lesson.items.find((i) => i.exerciseId === EX.mcq);
    if (!wrong) throw new Error('no mcq item');
    await submit(ctx, wrong, { correct: false });
    const weak = await createSet(ctx, { kind: 'weakness', conceptIds: ['js.basics.statement'] });
    const item = weak.items[0];
    if (!item) throw new Error('empty weakness set');
    await submit(ctx, item);
    // A project unit completes on the project screen, without a practice set row.
    ctx.clock.now += 60_000;
    ctx.userDb.sqlite
      .prepare(
        `INSERT INTO lesson_progress (learner_id, lesson_id, status, read_progress, started_at,
           completed_at, updated_at)
         VALUES ('01JD3Z8Q6V2K9M4T7R1X5W0BNC', ?, 'completed', 1, ?, ?, ?)`,
      )
      .run(PROJECT, ctx.clock.now, ctx.clock.now, ctx.clock.now);

    const { items } = await recent(ctx);
    expect(items.map((i) => [i.type, i.id])).toEqual([
      ['lesson', PROJECT],
      ['practice', weak.id],
      ['practice', lesson.id],
    ]);
    expect(items[0]).toMatchObject({ lesson: { id: PROJECT, title: '미니 프로젝트' } });
    expect(items[1]).toMatchObject({
      setKind: 'weakness',
      lesson: null,
      concepts: [{ id: 'js.basics.statement', title: 'js.basics.statement' }],
      conceptCount: 1,
      answered: 1,
      correct: 1,
    });
    expect((await recent(ctx, '?limit=1')).items.map((i) => i.id)).toEqual([PROJECT]);
    expect((await ctx.call('GET', '/activity/recent?limit=0')).status).toBe(400);
  });
});

describe('GET /concepts/:id/exercises (FR-DASH-02 관련 문제, FR-EX-10)', () => {
  it('lists the practice exercises of the concept, easiest first, with statistics', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const mcq = set.items.find((i) => i.exerciseId === EX.mcq);
    if (!mcq) throw new Error('no mcq item');
    await submit(ctx, mcq, { correct: false });
    await submit(ctx, mcq);

    const res = await ctx.call('GET', '/concepts/js.basics.statement/exercises');
    expect(res.status).toBe(200);
    const { conceptId, exercises } = relatedExercisesSchema.parse(res.json);
    expect(conceptId).toBe('js.basics.statement');
    const ids = exercises.map((e) => e.id);
    expect(ids).toContain(EX.mcq);
    expect(ids).toContain(EX.implement);
    // Assessment, project and remedial items are never listed.
    expect(ids.some((id) => id.startsWith(`${ASSESSMENT}.`) || id.startsWith(`${PROJECT}.`))).toBe(
      false,
    );
    expect(exercises.map((e) => e.difficulty)).toEqual(
      [...exercises.map((e) => e.difficulty)].sort((a, b) => a - b),
    );
    const row = exercises.find((e) => e.id === EX.mcq);
    expect(row).toMatchObject({
      type: 'mcq_single',
      difficulty: 1,
      prompt: 'mcq_single 문제',
      lesson: { id: LESSON },
      stats: { attempts: 2, firstTries: 1, firstTryCorrect: 0, firstTryCorrectRate: 0 },
    });
    // Answer keys stay on the server.
    expect(res.text).not.toContain('RATIONALE-MARK');
    expect(exercises.find((e) => e.id === EX.implement)?.stats.attempts).toBe(0);
  });

  it('answers 404 for unknown concepts', async () => {
    const ctx = await practiceApp();
    const res = await ctx.call('GET', '/concepts/js.nope.nope/exercises');
    expect(res.status).toBe(404);
    expect(errorCode(res.json)).toBe('NOT_FOUND');
  });
});
