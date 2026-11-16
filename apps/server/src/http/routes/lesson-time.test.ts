import { dailyPlanSchema, goalStatusSchema } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { practiceApp } from '../../test/practice-app.ts';
import { answerAll, lessonSet, LESSON, type Ctx } from '../../test/practice-flow.ts';

// Per-lesson actual time and pace calibration (FR-GOAL-02, learning-engine.md#목표-페이스-계산-computepace).

const OTHER_LESSON = 'js-basics.start.reading-errors';

const goals = async (ctx: Ctx) => goalStatusSchema.parse((await ctx.call('GET', '/goals')).json);

/** Heartbeats every 90 seconds with fresh input on a lesson page: `n × 90` active seconds. */
async function study(ctx: Ctx, heartbeats: number, lessonId?: string) {
  const beat = () =>
    ctx.call('POST', '/activity/heartbeat', {
      lastInputAt: ctx.clock.now,
      visible: true,
      focused: true,
      ...(lessonId === undefined ? {} : { lessonId }),
    });
  expect((await beat()).status).toBe(200);
  for (let i = 0; i < heartbeats; i++) {
    ctx.clock.now += 90_000;
    expect((await beat()).status).toBe(200);
  }
}

const lessonMs = (ctx: Ctx, lessonId: string) =>
  (
    ctx.userDb.sqlite
      .prepare('SELECT active_ms FROM lesson_progress WHERE lesson_id = ?')
      .get(lessonId) as { active_ms: number | null } | undefined
  )?.active_ms;

/** Minutes today's plan gives a lesson (planned now and "later" together). */
async function plannedMinutes(ctx: Ctx, lessonId: string) {
  const plan = dailyPlanSchema.parse((await ctx.call('GET', '/daily-plan')).json);
  return [...plan.blocks, ...plan.later]
    .filter((b) => b.lesson?.id === lessonId)
    .reduce((sum, b) => sum + b.minutes, 0);
}

const open = (ctx: Ctx, lessonId: string, readProgress = 0.1) =>
  ctx.call('POST', `/lessons/${lessonId}/progress`, { readProgress });

describe('lesson actual time from heartbeats', () => {
  it('adds active time to the lesson on screen while it is in progress', async () => {
    const ctx = await practiceApp();
    expect((await open(ctx, LESSON)).status).toBe(200);
    expect(lessonMs(ctx, LESSON)).toBe(0);

    await study(ctx, 4, LESSON); // 6 minutes of reading
    expect(lessonMs(ctx, LESSON)).toBe(360_000);
    // Saving the reading position keeps the counted time.
    await open(ctx, LESSON, 0.8);
    expect(lessonMs(ctx, LESSON)).toBe(360_000);

    // Time elsewhere in the app (dashboard, review) and on lessons never opened is not a lesson's.
    await study(ctx, 2);
    await study(ctx, 2, OTHER_LESSON);
    expect(lessonMs(ctx, LESSON)).toBe(360_000);
    expect(lessonMs(ctx, OTHER_LESSON)).toBeUndefined();
    // Daily time counts all of it.
    expect((await goals(ctx)).week.days.find((d) => d.date === '2026-11-14')?.activeMinutes).toBe(
      12,
    );

    // Practising counts too, until the lesson is completed.
    const set = await lessonSet(ctx);
    await study(ctx, 2, LESSON);
    expect(lessonMs(ctx, LESSON)).toBe(540_000);
    await answerAll(ctx, set);
    expect(
      ctx.userDb.sqlite
        .prepare('SELECT status FROM lesson_progress WHERE lesson_id = ?')
        .get(LESSON),
    ).toEqual({ status: 'completed' });
    await study(ctx, 3, LESSON); // revisiting a completed lesson
    expect(lessonMs(ctx, LESSON)).toBe(540_000);
  });

  it('leaves lessons started before time was recorded unknown', async () => {
    const ctx = await practiceApp();
    await open(ctx, LESSON);
    // What migration 0006 leaves for rows that existed before it.
    ctx.userDb.sqlite.prepare('UPDATE lesson_progress SET active_ms = NULL').run();
    await study(ctx, 4, LESSON);
    expect(lessonMs(ctx, LESSON)).toBeNull();
    await answerAll(ctx, await lessonSet(ctx));
    expect(lessonMs(ctx, LESSON)).toBeNull();
    expect((await goals(ctx)).pace).toBeNull(); // no target; calibration covered below
  });

  it('rejects a malformed lesson ID', async () => {
    const ctx = await practiceApp();
    const res = await ctx.call('POST', '/activity/heartbeat', {
      lastInputAt: ctx.clock.now,
      visible: true,
      focused: true,
      lessonId: 'x'.repeat(201),
    });
    expect(res.status).toBe(400);
  });
});

describe('pace calibration (fake clock scenario)', () => {
  const target = { dailyMinutes: 30, weeklyDays: 5, targetCourseId: 'js-basics' };

  /** Reads and completes the first lesson in `heartbeats × 90` seconds of active time. */
  async function completeFirstLesson(ctx: Ctx, heartbeats: number) {
    await open(ctx, LESSON);
    await study(ctx, heartbeats, LESSON);
    await open(ctx, LESSON, 1);
    await answerAll(ctx, await lessonSet(ctx));
  }

  it('adapts the estimates to the learner’s actual speed, bounded to 0.5–2.0', async () => {
    // One completed lesson is enough here (the default is five, below).
    const ctx = await practiceApp({
      engineConfig: (c) => ({ ...c, goals: { ...c.goals, calibrationMinLessons: 1 } }),
    });
    await ctx.call('PUT', '/goals', { ...target, targetDate: '2026-12-14' });
    expect((await goals(ctx)).pace).toMatchObject({ calibration: 1, remainingMinutes: 50 });

    // 25 heartbeats × 90 s = 37.5 minutes for a 25-minute lesson: 1.5× the estimate.
    await completeFirstLesson(ctx, 25);
    const pace = (await goals(ctx)).pace;
    expect(pace?.calibration).toBeCloseTo(1.5, 6);
    expect(pace?.remainingMinutes).toBeCloseTo(37.5, 6); // the second lesson, 25 × 1.5

    // Today's plan uses the same ratio for the next lesson.
    ctx.clock.now += 86_400_000; // tomorrow: today's goal is not met yet
    // 37.5 minutes do not fit the 30-minute budget: 30 now (partial), the rest later.
    expect(await plannedMinutes(ctx, OTHER_LESSON)).toBe(38);

    // Without a target course the plan still adapts.
    await ctx.call('PUT', '/goals', { dailyMinutes: 30, weeklyDays: 5 });
    expect(await plannedMinutes(ctx, OTHER_LESSON)).toBe(38);
  });

  it('clamps a very slow lesson to 2.0', async () => {
    const ctx = await practiceApp({
      engineConfig: (c) => ({ ...c, goals: { ...c.goals, calibrationMinLessons: 1 } }),
    });
    await ctx.call('PUT', '/goals', { ...target, targetDate: '2026-12-14' });
    await completeFirstLesson(ctx, 60); // 90 minutes for 25: 3.6×
    expect((await goals(ctx)).pace).toMatchObject({ calibration: 2, remainingMinutes: 50 });
  });

  it('keeps the content estimates until five lessons are timed (default config)', async () => {
    const ctx = await practiceApp();
    await ctx.call('PUT', '/goals', { ...target, targetDate: '2026-12-14' });
    await completeFirstLesson(ctx, 25);
    expect((await goals(ctx)).pace).toMatchObject({ calibration: 1, remainingMinutes: 25 });
  });
});
