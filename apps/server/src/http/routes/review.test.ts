import {
  masteryChangesSchema,
  mistakeDetailSchema,
  mistakeListSchema,
  type MistakeDetail,
  type MistakeList,
  type PracticeSetView,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { ASSESS, ASSESSMENT, EX } from '../../test/content-fixture.ts';
import { DAY, MINUTE, practiceApp } from '../../test/practice-app.ts';
import {
  answerAll,
  createSet,
  errorCode,
  lessonSet,
  parsed,
  submit,
  type Ctx,
} from '../../test/practice-flow.ts';

// Review screen read models (ui-ux.md 오답 노트, 숙련도 변화; FR-DASH-04): mistake notes derived
// from attempts, "다시 풀기" extra sets and stage changes from the evidence log.

const notes = async (ctx: Ctx, query = ''): Promise<MistakeList> => {
  const res = await ctx.call('GET', `/mistakes${query}`);
  expect(res.status).toBe(200);
  return mistakeListSchema.parse(res.json);
};

const detail = async (ctx: Ctx, exerciseId: string): Promise<MistakeDetail> => {
  const res = await ctx.call('GET', `/mistakes/${exerciseId}`);
  expect(res.status).toBe(200);
  return mistakeDetailSchema.parse(res.json);
};

const itemOf = (set: PracticeSetView, exerciseId: string) => {
  const item = set.items.find((i) => i.exerciseId === exerciseId);
  if (!item) throw new Error(`no item for ${exerciseId}`);
  return item;
};

/** Answers one item of a set wrongly, the rest correctly. */
async function lessonWithMistake(ctx: Ctx, exerciseId: string, body: object = {}) {
  const set = await lessonSet(ctx);
  parsed(await submit(ctx, itemOf(set, exerciseId), { correct: false, body }));
  return set;
}

describe('GET /mistakes', () => {
  it('is empty for a new learner', async () => {
    const ctx = await practiceApp();
    expect(await notes(ctx)).toEqual({
      items: [],
      total: 0,
      counts: { all: 0, open: 0, resolved: 0 },
      facets: { courses: [], modules: [], concepts: [] },
    });
  });

  it('collects the latest wrong attempt per exercise with its concept and misconception', async () => {
    const ctx = await practiceApp();
    await lessonWithMistake(ctx, EX.mcq, { confidence: 'sure' });
    const list = await notes(ctx);
    expect(list.total).toBe(1);
    expect(list.counts).toEqual({ all: 1, open: 1, resolved: 0 });
    expect(list.items[0]).toMatchObject({
      exerciseId: EX.mcq,
      type: 'mcq_single',
      concept: { id: 'js.basics.statement' },
      module: { id: 'js-basics.start' },
      course: { id: 'js-basics' },
      lastWrongOutcome: 'incorrect',
      lastWrongContext: 'lesson',
      wrongCount: 1,
      confidentWrong: true,
      misconceptions: [{ id: 'js.mc.log-is-return', title: 'console.log를 반환으로 생각함' }],
      status: 'open',
      resolvedAt: null,
      archived: false,
      retry: { available: true, blockedBy: null },
    });
    expect(list.facets.courses.map((c) => c.id)).toEqual(['js-basics']);
    expect(list.facets.modules).toEqual([
      { id: 'js-basics.start', title: expect.any(String) as string, courseId: 'js-basics' },
    ]);
    expect(list.facets.concepts.map((c) => c.id)).toEqual(['js.basics.statement']);
  });

  it('filters by course, module, concept and status, and pages', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    for (const id of [EX.mcq, EX.trueFalse, EX.predict]) {
      const item = set.items.find((i) => i.exerciseId === id);
      if (item) parsed(await submit(ctx, item, { correct: false }));
    }
    const all = await notes(ctx);
    expect(all.total).toBeGreaterThanOrEqual(2);
    // Newest wrong attempt first.
    const times = all.items.map((n) => n.lastWrongAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect((await notes(ctx, '?courseId=js-basics')).total).toBe(all.total);
    expect((await notes(ctx, '?courseId=other')).total).toBe(0);
    expect((await notes(ctx, '?moduleId=js-basics.start')).total).toBe(all.total);
    const statement = all.items.filter((n) => n.concept?.id === 'js.basics.statement').length;
    expect((await notes(ctx, '?conceptId=js.basics.statement')).total).toBe(statement);
    expect((await notes(ctx, '?status=resolved')).total).toBe(0);
    const page = await notes(ctx, '?limit=1&offset=1');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.exerciseId).toBe(all.items[1]?.exerciseId);
    expect(page.total).toBe(all.total);
  });

  it('sorts confident wrong answers first on request', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    parsed(
      await submit(ctx, itemOf(set, EX.mcq), { correct: false, body: { confidence: 'sure' } }),
    );
    parsed(
      await submit(ctx, itemOf(set, EX.trueFalse), {
        correct: false,
        body: { confidence: 'guess' },
      }),
    );
    expect((await notes(ctx)).items.map((n) => n.exerciseId)).toEqual([EX.trueFalse, EX.mcq]);
    expect((await notes(ctx, '?sort=confident')).items.map((n) => n.exerciseId)).toEqual([
      EX.mcq,
      EX.trueFalse,
    ]);
  });

  it('rejects unknown query parameters', async () => {
    const ctx = await practiceApp();
    const res = await ctx.call('GET', '/mistakes?status=done');
    expect(res.status).toBe(400);
    expect(errorCode(res.json)).toBe('VALIDATION_FAILED');
  });
});

describe('GET /mistakes/:exerciseId', () => {
  it('shows the learner answer, feedback and explanation but not an unseen solution', async () => {
    const ctx = await practiceApp();
    await lessonWithMistake(ctx, EX.implement);
    const res = await ctx.call('GET', `/mistakes/${EX.implement}`);
    expect(res.status).toBe(200);
    const d = mistakeDetailSchema.parse(res.json);
    expect(d.note.exerciseId).toBe(EX.implement);
    expect(d.attempts).toHaveLength(1);
    expect(d.attempts[0]).toMatchObject({
      outcome: 'incorrect',
      context: 'lesson',
      confidence: 'sure',
      answer: { kind: 'files', files: [{ path: 'main.js' }] },
    });
    expect(d.attempts[0]?.feedback.length).toBeGreaterThan(0);
    expect(d.explanation).toBe(`${EX.implement} 해설`);
    expect(d.solution).toBeNull();
    expect(d.solutionSource).toBeNull();
    expect(res.text).not.toContain('SOLUTION-MARK');
    expect(res.text).not.toContain('QUIET!');
  });

  it('shows choice answers with their option text', async () => {
    const ctx = await practiceApp();
    await lessonWithMistake(ctx, EX.mcq);
    const d = await detail(ctx, EX.mcq);
    expect(d.attempts[0]?.answer).toMatchObject({ kind: 'choice', choiceId: 'a' });
    expect(d.attempts[0]?.misconceptions.map((m) => m.id)).toEqual(['js.mc.log-is-return']);
  });

  it('shows the reference answer once the learner opened it', async () => {
    const ctx = await practiceApp();
    await lessonWithMistake(ctx, EX.implement);
    for (let i = 0; i < 3; i++) await ctx.call('POST', `/exercises/${EX.implement}/hints`);
    expect((await ctx.call('POST', `/exercises/${EX.implement}/solution`)).status).toBe(200);
    const d = await detail(ctx, EX.implement);
    expect(d.solutionSource).toBe('viewed');
    expect(d.solution?.kind).toBe('files');
    expect(JSON.stringify(d.solution)).toContain('SOLUTION-MARK');
  });

  it('is 404 for an exercise without wrong attempts', async () => {
    const ctx = await practiceApp();
    const res = await ctx.call('GET', `/mistakes/${EX.mcq}`);
    expect(res.status).toBe(404);
    expect(errorCode(res.json)).toBe('NOT_FOUND');
  });
});

describe('POST /practice-sets (extra: 다시 풀기)', () => {
  it('builds a set of exactly the exercise, resumes it, and resolves the note', async () => {
    const ctx = await practiceApp();
    await lessonWithMistake(ctx, EX.mcq);
    const set = await createSet(ctx, { kind: 'extra', exerciseIds: [EX.mcq] });
    expect(set).toMatchObject({ kind: 'extra', status: 'active', passRule: null, lessonId: null });
    expect(set.items.map((i) => [i.exerciseId, i.reason, i.targetConcept?.id])).toEqual([
      [EX.mcq, 'mistake_retry', 'js.basics.statement'],
    ]);
    expect((await createSet(ctx, { kind: 'extra', exerciseIds: [EX.mcq] })).id).toBe(set.id);

    ctx.clock.now += DAY;
    parsed(await submit(ctx, itemOf(set, EX.mcq)));
    const [note] = (await notes(ctx)).items;
    expect(note).toMatchObject({ exerciseId: EX.mcq, status: 'resolved' });
    expect(note?.resolvedAt).toBe(ctx.clock.now);
    expect((await notes(ctx, '?status=open')).total).toBe(0);
    expect((await notes(ctx, '?status=resolved')).counts).toEqual({ all: 1, open: 0, resolved: 1 });

    // A finished set is not resumed; a new wrong attempt opens the note again.
    const again = await createSet(ctx, { kind: 'extra', exerciseIds: [EX.mcq] });
    expect(again.id).not.toBe(set.id);
    parsed(await submit(ctx, itemOf(again, EX.mcq), { correct: false }));
    expect((await notes(ctx)).items[0]).toMatchObject({
      status: 'open',
      resolvedAt: null,
      wrongCount: 2,
      lastWrongContext: 'extra',
    });
  });

  it('does not resolve a note with a correct answer after viewing the solution', async () => {
    const ctx = await practiceApp();
    await lessonWithMistake(ctx, EX.mcq);
    const set = await createSet(ctx, { kind: 'extra', exerciseIds: [EX.mcq] });
    const item = itemOf(set, EX.mcq);
    for (let i = 0; i < 3; i++) {
      await ctx.call('POST', `/exercises/${EX.mcq}/hints`, { practiceSetItemId: item.id });
    }
    await ctx.call('POST', `/exercises/${EX.mcq}/solution`, { practiceSetItemId: item.id });
    parsed(await submit(ctx, item));
    expect((await notes(ctx)).items[0]?.status).toBe('open');
  });

  it('validates the exercises', async () => {
    const ctx = await practiceApp();
    const dup = await ctx.call('POST', '/practice-sets', {
      kind: 'extra',
      exerciseIds: [EX.mcq, EX.mcq],
    });
    expect(dup.status).toBe(400);
    const empty = await ctx.call('POST', '/practice-sets', { kind: 'extra', exerciseIds: [] });
    expect(empty.status).toBe(400);
    const missing = await ctx.call('POST', '/practice-sets', {
      kind: 'extra',
      exerciseIds: ['js-basics.nope'],
    });
    expect(missing.status).toBe(404);
    const assessment = await ctx.call('POST', '/practice-sets', {
      kind: 'extra',
      exerciseIds: [ASSESS.statementL2],
    });
    expect(assessment.status).toBe(403);
    expect(errorCode(assessment.json)).toBe('EXERCISE_LOCKED_IN_ASSESSMENT');
  });
});

describe('mistake notes and assessments', () => {
  const answer = async (ctx: Ctx, item: { id: string; exerciseId: string }, correct: boolean) => {
    ctx.clock.now += MINUTE;
    const value = item.exerciseId === ASSESS.commentL3;
    return ctx.call('POST', '/attempts', {
      practiceSetItemId: item.id,
      exerciseId: item.exerciseId,
      answer: value ? { value: !correct } : { optionId: correct ? 'b' : 'a' },
      confidence: 'sure',
      startedAt: ctx.clock.now - 40_000,
      activeMs: 30_000,
    });
  };

  it('hides wrong answers and stage changes until the assessment ends', async () => {
    const ctx = await practiceApp();
    const set = await createSet(ctx, { kind: 'assessment', lessonId: ASSESSMENT });
    const [first, ...rest] = set.items;
    if (!first) throw new Error('empty assessment');
    expect((await answer(ctx, first, false)).status).toBe(201);

    expect((await notes(ctx)).total).toBe(0);
    expect((await ctx.call('GET', `/mistakes/${first.exerciseId}`)).status).toBe(404);
    const during = masteryChangesSchema.parse((await ctx.call('GET', '/mastery-changes')).json);
    expect(during.recent).toEqual([]);

    for (const item of rest) expect((await answer(ctx, item, true)).status).toBe(201);
    const list = await notes(ctx);
    expect(list.items.map((n) => n.exerciseId)).toEqual([first.exerciseId]);
    expect(list.items[0]).toMatchObject({
      lastWrongContext: 'assessment',
      retry: { available: false, blockedBy: 'assessment_only' },
    });
    const d = await detail(ctx, first.exerciseId);
    expect(d.attempts[0]?.feedback).toEqual([]);
    // The finished assessment showed the reference answer on its result screen.
    expect(d.solutionSource).toBe('assessment');
    expect(d.solution).toMatchObject({ kind: expect.any(String) as string });
  });

  it('hides older notes of an exercise that is in an assessment in progress', async () => {
    const ctx = await practiceApp();
    const first = await createSet(ctx, { kind: 'assessment', lessonId: ASSESSMENT });
    for (const [i, item] of first.items.entries()) await answer(ctx, item, i !== 0);
    expect((await notes(ctx)).total).toBe(1);
    // A retake in progress may serve the same item again: its note waits for the end.
    const retake = await createSet(ctx, { kind: 'assessment', lessonId: ASSESSMENT });
    const shared = retake.items.some((i) => i.exerciseId === first.items[0]?.exerciseId);
    expect((await notes(ctx)).total).toBe(shared ? 0 : 1);
  });
});

describe('GET /mastery-changes', () => {
  it('is empty with eight empty weeks for a new learner', async () => {
    const ctx = await practiceApp();
    const res = await ctx.call('GET', '/mastery-changes');
    expect(res.status).toBe(200);
    const body = masteryChangesSchema.parse(res.json);
    expect(body.date).toBe('2026-11-14');
    expect(body.weeks).toHaveLength(8);
    expect(body.weeks.at(-1)).toEqual({
      weekStart: '2026-11-09',
      promotions: 0,
      demotions: 0,
      concepts: 0,
    });
    expect(body.weeks[0]?.weekStart).toBe('2026-09-21');
    expect(body.recent).toEqual([]);
    expect(body.totals).toEqual({ promotions: 0, demotions: 0 });
  });

  it('lists promotions newest first and buckets them by week', async () => {
    const ctx = await practiceApp();
    await answerAll(ctx, await lessonSet(ctx));
    const now = masteryChangesSchema.parse((await ctx.call('GET', '/mastery-changes')).json);
    expect(now.recent.length).toBeGreaterThan(0);
    expect(now.recent.every((c) => c.direction === 'up')).toBe(true);
    expect(now.recent[0]).toMatchObject({
      date: '2026-11-14',
      concept: { id: expect.any(String) as string, title: expect.any(String) as string },
    });
    const times = now.recent.map((c) => c.at);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    const week = now.weeks.at(-1);
    expect(week?.promotions).toBe(now.recent.length);
    expect(week?.concepts).toBeGreaterThan(0);
    expect(now.totals.promotions).toBe(now.recent.length);

    ctx.clock.now += 7 * DAY;
    const later = masteryChangesSchema.parse(
      (await ctx.call('GET', '/mastery-changes?weeks=2&limit=1')).json,
    );
    expect(later.weeks.map((w) => w.weekStart)).toEqual(['2026-11-09', '2026-11-16']);
    expect(later.weeks[0]?.promotions).toBe(now.recent.length);
    expect(later.weeks[1]?.promotions).toBe(0);
    expect(later.recent).toHaveLength(1);
  });

  it('rejects out-of-range queries', async () => {
    const ctx = await practiceApp();
    expect((await ctx.call('GET', '/mastery-changes?weeks=0')).status).toBe(400);
    expect((await ctx.call('GET', '/mastery-changes?limit=500')).status).toBe(400);
  });
});
