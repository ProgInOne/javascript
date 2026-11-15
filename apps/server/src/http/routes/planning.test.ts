import {
  conceptDetailSchema,
  dailyPlanSchema,
  goalStatusSchema,
  type DailyPlanView,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { EX } from '../../test/content-fixture.ts';
import { count, DAY, MINUTE, practiceApp } from '../../test/practice-app.ts';
import {
  answerAll,
  errorCode,
  lessonSet,
  LESSON,
  parsed,
  submit,
  type Ctx,
} from '../../test/practice-flow.ts';

// Goals, today's plan and the concept detail (learning-engine.md#오늘의-학습과-목표).

const goals = async (ctx: Ctx) => goalStatusSchema.parse((await ctx.call('GET', '/goals')).json);
const plan = async (ctx: Ctx): Promise<DailyPlanView> =>
  dailyPlanSchema.parse((await ctx.call('GET', '/daily-plan')).json);

/** Heartbeats every 90 seconds with fresh input: `n × 90` active seconds. */
async function study(ctx: Ctx, heartbeats: number) {
  await ctx.call('POST', '/activity/heartbeat', {
    lastInputAt: ctx.clock.now,
    visible: true,
    focused: true,
  });
  for (let i = 0; i < heartbeats; i++) {
    ctx.clock.now += 90_000;
    await ctx.call('POST', '/activity/heartbeat', {
      lastInputAt: ctx.clock.now,
      visible: true,
      focused: true,
    });
  }
}

describe('GET/PUT /goals', () => {
  it('starts with the default goal and keeps a history when the goal changes', async () => {
    const ctx = await practiceApp();
    const initial = await goals(ctx);
    expect(initial).toMatchObject({
      date: '2026-11-14',
      goal: { dailyMinutes: 30, weeklyDays: 5, targetCourse: null, isDefault: true },
      pace: null,
      streakWeeks: 0,
      week: { weekStart: '2026-11-09', studiedDays: 0, weeklyDays: 5, achieved: false },
    });
    expect(initial.week.days).toHaveLength(7);

    const res = await ctx.call('PUT', '/goals', {
      dailyMinutes: 20,
      weeklyDays: 3,
      targetCourseId: 'js-basics',
      targetDate: '2026-12-14',
    });
    expect(res.status).toBe(200);
    const status = goalStatusSchema.parse(res.json);
    expect(status.goal).toMatchObject({
      dailyMinutes: 20,
      weeklyDays: 3,
      targetCourse: { id: 'js-basics', title: 'JavaScript 기초' },
      targetDate: '2026-12-14',
      isDefault: false,
    });
    // Two 25-minute lessons left; 31 days × 3/7 → 13 study days; 50 / 13 ≈ 3.8 ≤ 12 × 0.85.
    expect(status.pace).toMatchObject({
      status: 'on_track',
      remainingMinutes: 50,
      studyDaysLeft: 13,
      newLearningBudget: 12,
    });

    ctx.clock.now += MINUTE;
    await ctx.call('PUT', '/goals', { dailyMinutes: 45, weeklyDays: 5 });
    const rows = ctx.userDb.sqlite
      .prepare(
        'SELECT daily_minutes, effective_to IS NULL AS current FROM goals ORDER BY effective_from',
      )
      .all();
    expect(rows).toEqual([
      { daily_minutes: 20, current: 0 },
      { daily_minutes: 45, current: 1 },
    ]);
    expect((await goals(ctx)).pace).toBeNull();
  });

  it('rejects unknown courses, past dates and half targets', async () => {
    const ctx = await practiceApp();
    const put = (body: object) => ctx.call('PUT', '/goals', body);
    const unknown = await put({
      dailyMinutes: 30,
      weeklyDays: 5,
      targetCourseId: 'nope',
      targetDate: '2026-12-01',
    });
    expect(unknown.status).toBe(400);
    expect(errorCode(unknown.json)).toBe('VALIDATION_FAILED');
    const past = await put({
      dailyMinutes: 30,
      weeklyDays: 5,
      targetCourseId: 'js-basics',
      targetDate: '2026-11-13',
    });
    expect(errorCode(past.json)).toBe('VALIDATION_FAILED');
    expect(
      (await put({ dailyMinutes: 30, weeklyDays: 5, targetCourseId: 'js-basics' })).status,
    ).toBe(400);
    expect((await put({ dailyMinutes: 4, weeklyDays: 5 })).status).toBe(400);
    expect((await put({ dailyMinutes: 30, weeklyDays: 8 })).status).toBe(400);
    expect(count(ctx, 'goals')).toBe(0);
  });

  it('marks the day when the goal is met and counts studied days in the week', async () => {
    const ctx = await practiceApp();
    await ctx.call('PUT', '/goals', { dailyMinutes: 5, weeklyDays: 1 });
    await study(ctx, 3); // 4.5 minutes
    const before = ctx.userDb.sqlite
      .prepare('SELECT active_ms, goal_met FROM daily_activity')
      .get();
    expect(before).toEqual({ active_ms: 270_000, goal_met: 0 });
    await study(ctx, 1);
    const after = ctx.userDb.sqlite.prepare('SELECT goal_met FROM daily_activity').get();
    expect(after).toEqual({ goal_met: 1 });
    const status = await goals(ctx);
    expect(status.week.days.find((d) => d.date === '2026-11-14')).toEqual({
      date: '2026-11-14',
      activeMinutes: 6,
      studied: true,
      goalMet: true,
    });
    expect(status.week).toMatchObject({ studiedDays: 1, achieved: true });
    expect(status.streakWeeks).toBe(1);
  });
});

describe('GET /daily-plan', () => {
  it('first run: start the first lesson', async () => {
    const ctx = await practiceApp();
    const p = await plan(ctx);
    expect(p).toMatchObject({
      date: '2026-11-14',
      budgetMinutes: 30,
      activeMinutesToday: 0,
      goalMet: false,
      mode: 'plan',
      later: [],
      pace: null,
    });
    expect(p.blocks).toEqual([
      {
        kind: 'new_lesson',
        minutes: 25,
        reason: { code: 'new_lesson', why: 'first_lesson' },
        concepts: [],
        lesson: { id: LESSON, title: '단원 0', status: 'not_started', practiceSetId: null },
        partial: false,
      },
    ]);
  });

  it('continues the lesson in progress, then plans reviews and weakness practice', async () => {
    const ctx = await practiceApp();
    await ctx.call('POST', `/lessons/${LESSON}/progress`, { readProgress: 0.6 });
    const reading = await plan(ctx);
    // 10 reading minutes (40% left) + 15 practice minutes.
    expect(reading.blocks.map((b) => [b.kind, b.minutes, b.lesson?.id, b.reason])).toEqual([
      ['continue', 19, LESSON, { code: 'continue_lesson', remainingMinutes: 19 }],
    ]);

    // Practice with mistakes: the lesson stays in progress and the concept is weak.
    const set = await lessonSet(ctx);
    // Miss about 4 in 7 of the statement items so that concept becomes weak.
    const misses = Math.round((set.items.length * 4) / 7);
    let wrong = 0;
    for (const item of set.items) {
      const miss = item.targetConcept?.id === 'js.basics.statement' && wrong < misses;
      if (miss) wrong++;
      parsed(await submit(ctx, item, { correct: !miss }));
    }
    ctx.clock.now += 5 * DAY;
    const later = await plan(ctx);
    const kinds = later.blocks.map((b) => b.kind);
    expect(kinds[0]).toBe('review');
    expect(later.blocks[0]?.concepts.map((c) => c.id)).toEqual(['js.basics.statement']);
    // The weakest concept of this lesson (or its prerequisite, after the relearning check) gets
    // a weakness block.
    const weak = later.blocks.find((b) => b.kind === 'weakness')?.concepts.map((c) => c.id) ?? [];
    expect(weak.length).toBeGreaterThan(0);
    for (const id of weak) expect(['js.basics.statement', 'js.basics.comment']).toContain(id);
    expect(later.totalMinutes).toBeLessThanOrEqual(later.budgetMinutes);
  });

  it('offers extra study once the goal is met', async () => {
    const ctx = await practiceApp();
    await ctx.call('PUT', '/goals', { dailyMinutes: 5, weeklyDays: 5 });
    await study(ctx, 4);
    const p = await plan(ctx);
    expect(p).toMatchObject({
      goalMet: true,
      mode: 'extra',
      budgetMinutes: 10,
      activeMinutesToday: 6,
    });
  });
});

describe('GET /concepts/:id', () => {
  it('explains a concept without records', async () => {
    const ctx = await practiceApp();
    const res = await ctx.call('GET', '/concepts/js.basics.statement');
    expect(res.status).toBe(200);
    const detail = conceptDetailSchema.parse(res.json);
    expect(detail).toMatchObject({
      concept: {
        id: 'js.basics.statement',
        title: 'js.basics.statement',
        importance: 'core',
        course: { id: 'js-basics', title: 'JavaScript 기초' },
      },
      mastery: { stage: 'not_started', score: 0, effective: 0, needsReview: false },
      nextStage: { stage: 'practicing', met: false },
      memory: null,
      evidence: [],
      evidenceTotal: 0,
      reviews: [],
      prerequisites: [
        {
          concept: { id: 'js.basics.comment', title: 'js.basics.comment' },
          strength: 'required',
          stage: 'not_started',
        },
      ],
      misconceptions: [],
      lessons: [
        { id: LESSON, title: '단원 0', role: 'introduces' },
        { id: 'js-basics.start.start-review', title: '시작하기 단원 평가', role: 'reviews' },
        { id: 'js-basics.start.mini-project', title: '미니 프로젝트', role: 'practices' },
      ],
    });
    expect((await ctx.call('GET', '/concepts/js.nope')).status).toBe(404);
  });

  it('shows the evidence behind the score, the gates left and the next review', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const mcq = set.items.find((i) => i.exerciseId === EX.mcq);
    if (!mcq) throw new Error('no choice item');
    // The wrong option points to a misconception.
    parsed(await submit(ctx, mcq, { correct: false }));
    await answerAll(ctx, { ...set, items: set.items.filter((i) => i.id !== mcq.id) });
    const detail = conceptDetailSchema.parse(
      (await ctx.call('GET', '/concepts/js.basics.statement?evidenceLimit=3')).json,
    );
    expect(detail.evidence).toHaveLength(3);
    expect(detail.evidenceTotal).toBeGreaterThanOrEqual(7);
    const attempt = detail.evidence.find((e) => e.kind === 'attempt');
    expect(attempt?.exercise).not.toBeNull();
    expect(attempt?.observation?.outcome).toMatch(/^(correct|incorrect)$/);
    expect(attempt?.factors?.['type']?.why).toMatch(/^(recognition|recall|production):/);
    expect(attempt?.weight).toBeGreaterThan(0);
    expect(detail.mastery.stage).not.toBe('not_started');
    expect(detail.nextStage?.missing.length).toBeGreaterThan(0);
    // The first answer was wrong, so the merged rating was `again`: due again today.
    expect(detail.memory).toMatchObject({ reps: 1, dueToday: true, suspended: false });
    expect(detail.reviews).toHaveLength(1);
    expect(detail.misconceptions.map((m) => [m.id, m.status])).toEqual([
      ['js.mc.log-is-return', 'confirmed'],
    ]);
    expect((await ctx.call('GET', '/concepts/js.basics.statement?evidenceLimit=0')).status).toBe(
      400,
    );
  });
});
