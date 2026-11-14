import {
  dashboardSchema,
  heartbeatResponseSchema,
  lessonProgressSchema,
  reviewQueueSchema,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { count, DAY, practiceApp, T0 } from '../../test/practice-app.ts';
import {
  answerAll,
  createSet,
  errorCode,
  LESSON,
  lessonSet,
  type Ctx,
} from '../../test/practice-flow.ts';

const progress = (ctx: Ctx, body: object, lessonId = LESSON) =>
  ctx.call('POST', `/lessons/${lessonId}/progress`, body);
const queue = async (ctx: Ctx) =>
  reviewQueueSchema.parse((await ctx.call('GET', '/review-queue')).json);
const beat = async (ctx: Ctx, body: object) =>
  heartbeatResponseSchema.parse((await ctx.call('POST', '/activity/heartbeat', body)).json);

describe('POST /lessons/:id/progress', () => {
  it('starts the lesson on the first visit and introduces its concepts', async () => {
    const ctx = await practiceApp();
    const first = await progress(ctx, { readProgress: 0.2, lastSectionId: 'objectives' });
    expect(first.status).toBe(200);
    expect(lessonProgressSchema.parse(first.json)).toEqual({
      lessonId: LESSON,
      status: 'reading',
      readProgress: 0.2,
      lastSectionId: 'objectives',
      practiceSetId: null,
      startedAt: T0,
      completedAt: null,
      introducedConcepts: [{ id: 'js.basics.statement', title: 'js.basics.statement' }],
    });
    expect(
      ctx.userDb.sqlite.prepare('SELECT concept_id, stage FROM concept_mastery').all(),
    ).toEqual([{ concept_id: 'js.basics.statement', stage: 'introduced' }]);
    expect(
      ctx.userDb.sqlite
        .prepare('SELECT kind, stage_before, stage_after FROM mastery_evidence')
        .all(),
    ).toEqual([{ kind: 'stage_gate', stage_before: 'not_started', stage_after: 'introduced' }]);
    expect(count(ctx, 'concept_memory')).toBe(0); // no card before practice

    ctx.clock.now += 60_000;
    const later = lessonProgressSchema.parse(
      (await progress(ctx, { readProgress: 0.1, lastSectionId: 'example' })).json,
    );
    expect(later).toMatchObject({
      readProgress: 0.2,
      lastSectionId: 'example',
      introducedConcepts: [],
    });
    expect(count(ctx, 'mastery_evidence')).toBe(1);
  });

  it('keeps a practicing lesson practicing', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const res = lessonProgressSchema.parse((await progress(ctx, { readProgress: 1 })).json);
    expect(res).toMatchObject({ status: 'practicing', practiceSetId: set.id, readProgress: 1 });
  });

  it('validates the lesson and the body', async () => {
    const ctx = await practiceApp();
    expect((await progress(ctx, { readProgress: 0.5 }, 'a.b.c')).status).toBe(404);
    const bad = await progress(ctx, { readProgress: 1.5 });
    expect(bad.status).toBe(400);
    expect(errorCode(bad.json)).toBe('VALIDATION_FAILED');
    expect((await progress(ctx, { readProgress: 0.5, lastSectionId: '<b>' })).status).toBe(400);
  });
});

describe('review queue and review sets', () => {
  it('schedules a review after practice and serves it when due', async () => {
    const ctx = await practiceApp();
    await answerAll(ctx, await lessonSet(ctx));
    const card = ctx.userDb.sqlite.prepare('SELECT due_at, reps FROM concept_memory').get() as {
      due_at: number;
      reps: number;
    };
    expect(card.reps).toBe(1);
    expect(card.due_at).toBeGreaterThan(ctx.clock.now + DAY);
    expect((await queue(ctx)).due).toEqual([]);
    const none = await ctx.call('POST', '/practice-sets', { kind: 'review' });
    expect(none.status).toBe(409);
    expect(errorCode(none.json)).toBe('PRACTICE_NOTHING_DUE');

    // Travel past the due date.
    ctx.clock.now = card.due_at + 3 * DAY;
    const due = await queue(ctx);
    expect(due.due.map((e) => e.conceptId)).toEqual(['js.basics.statement']);
    expect(due.due[0]).toMatchObject({ overdue: true, title: 'js.basics.statement' });
    expect(due.budgetMinutes).toBe(20);

    const set = await createSet(ctx, { kind: 'review' });
    expect(set.kind).toBe('review');
    expect(set.passRule).toBeNull();
    expect(set.items.length).toBeGreaterThanOrEqual(1);
    expect(set.items.every((i) => i.targetConcept?.id === 'js.basics.statement')).toBe(true);
    expect(set.items[0]?.reason).toBe('review_due');
    expect((await createSet(ctx, { kind: 'review' })).id).toBe(set.id);

    const last = await answerAll(ctx, set);
    expect(last.set.status).toBe('completed');
    expect(last.set.result?.pass).toBeNull();
    expect(ctx.userDb.sqlite.prepare('SELECT reps FROM concept_memory').get()).toEqual({ reps: 2 });
    expect(count(ctx, 'review_logs')).toBe(2);
    expect(
      ctx.userDb.sqlite.prepare('SELECT COUNT(*) AS n FROM attempts WHERE is_review = 1').get(),
    ).toEqual({ n: set.items.length });
    const today = due.date;
    expect(
      ctx.userDb.sqlite
        .prepare('SELECT reviews_done FROM daily_activity WHERE date = ?')
        .get(today),
    ).toEqual({ reviews_done: 1 });
    expect((await queue(ctx)).due).toEqual([]);
  });

  it('validates the budget', async () => {
    const ctx = await practiceApp();
    expect((await ctx.call('GET', '/review-queue?budgetMinutes=0')).status).toBe(400);
    expect(
      reviewQueueSchema.parse((await ctx.call('GET', '/review-queue?budgetMinutes=5')).json),
    ).toMatchObject({
      budgetMinutes: 5,
      due: [],
      deferred: [],
    });
  });
});

describe('POST /activity/heartbeat', () => {
  it('counts active time between heartbeats with the idle and gap rules', async () => {
    const ctx = await practiceApp();
    const at = (offset: number) => (ctx.clock.now = T0 + offset);
    at(0);
    expect((await beat(ctx, { lastInputAt: T0, visible: true, focused: true })).countedMs).toBe(0);
    at(30_000);
    const active = await beat(ctx, { lastInputAt: T0 + 25_000, visible: true, focused: true });
    expect(active).toEqual({ date: '2026-11-14', countedMs: 30_000, activeMsToday: 30_000 });
    // Last input 5 minutes ago: nothing counts after input + 2 minutes.
    at(60_000);
    expect(
      (await beat(ctx, { lastInputAt: T0 - 5 * 60_000, visible: true, focused: true })).countedMs,
    ).toBe(0);
    // Hidden page.
    at(90_000);
    expect(
      (await beat(ctx, { lastInputAt: T0 + 89_000, visible: false, focused: false })).countedMs,
    ).toBe(0);
    // A gap over 90 seconds (sleep) counts nothing.
    at(300_000);
    expect(
      (await beat(ctx, { lastInputAt: T0 + 299_000, visible: true, focused: true })).countedMs,
    ).toBe(0);
    // A client clock in the future is clamped to the server clock.
    at(330_000);
    expect(
      (await beat(ctx, { lastInputAt: T0 + 10 * DAY, visible: true, focused: true })).countedMs,
    ).toBe(30_000);
    expect(ctx.userDb.sqlite.prepare('SELECT active_ms FROM daily_activity').get()).toEqual({
      active_ms: 60_000,
    });
  });

  it('splits an interval at the 04:00 day start', async () => {
    const ctx = await practiceApp();
    // 2026-11-15 03:59:45 in Asia/Seoul.
    const before4 = Date.UTC(2026, 10, 14, 18, 59, 45);
    ctx.clock.now = before4;
    await beat(ctx, { lastInputAt: before4, visible: true, focused: true });
    ctx.clock.now = before4 + 30_000;
    const res = await beat(ctx, { lastInputAt: before4 + 29_000, visible: true, focused: true });
    expect(res).toEqual({ date: '2026-11-15', countedMs: 30_000, activeMsToday: 15_000 });
    expect(
      ctx.userDb.sqlite.prepare('SELECT date, active_ms FROM daily_activity ORDER BY date').all(),
    ).toEqual([
      { date: '2026-11-14', active_ms: 15_000 },
      { date: '2026-11-15', active_ms: 15_000 },
    ]);
  });
});

describe('GET /dashboard', () => {
  it('summarizes continue-learning, reviews and minutes', async () => {
    const ctx = await practiceApp();
    const empty = dashboardSchema.parse((await ctx.call('GET', '/dashboard')).json);
    expect(empty).toEqual({
      date: '2026-11-14',
      activeMinutesToday: 0,
      reviewDueCount: 0,
      continueLesson: null,
    });

    await progress(ctx, { readProgress: 0.4 });
    await beat(ctx, { lastInputAt: ctx.clock.now, visible: true, focused: true });
    for (let i = 0; i < 4; i++) {
      ctx.clock.now += 30_000;
      await beat(ctx, { lastInputAt: ctx.clock.now, visible: true, focused: true });
    }
    const dash = dashboardSchema.parse((await ctx.call('GET', '/dashboard')).json);
    expect(dash).toEqual({
      date: '2026-11-14',
      activeMinutesToday: 2,
      reviewDueCount: 0,
      continueLesson: {
        id: LESSON,
        title: '단원 0',
        status: 'reading',
        readProgress: 0.4,
        practiceSetId: null,
      },
    });

    // A completed lesson is no longer "in progress"; its review shows up once due.
    await answerAll(ctx, await lessonSet(ctx));
    ctx.clock.now += 60 * DAY;
    const later = dashboardSchema.parse((await ctx.call('GET', '/dashboard')).json);
    expect(later.continueLesson).toBeNull();
    expect(later.reviewDueCount).toBe(1);
  });
});
