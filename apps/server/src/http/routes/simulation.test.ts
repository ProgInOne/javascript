import { dailyPlanSchema, practiceSetViewSchema, reviewQueueSchema } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { DAY, practiceApp, T0 } from '../../test/practice-app.ts';
import { LESSON, parsed, submit, type Ctx } from '../../test/practice-flow.ts';

// 30 days through the HTTP API with a real temp SQLite user.db and a fake clock: each weekday
// the learner opens today's plan and does its blocks (the 30-day engine simulation with many
// concepts lives in packages/learning-engine/src/simulation.test.ts).

/** 19:00 in Seoul on day `n` (T0 is 10:00, Saturday 2026-11-14). */
const evening = (n: number) => T0 + n * DAY + 9 * 3_600_000;

async function answerSet(ctx: Ctx, id: string, day: number, mistakes = true) {
  for (let n = 0; ; n++) {
    const set = practiceSetViewSchema.parse((await ctx.call('GET', `/practice-sets/${id}`)).json);
    const next = set.items.find((i) => i.id === set.nextItemId);
    if (!next) return set;
    // The first week of practice: every fifth answer (shifting by day) wrong. Reviews and later
    // practice: remembered.
    parsed(await submit(ctx, next, { correct: !mistakes || day >= 7 || (n + day) % 5 !== 0 }));
  }
}

async function heartbeats(ctx: Ctx, minutes: number) {
  const beat = () =>
    ctx.call('POST', '/activity/heartbeat', {
      lastInputAt: ctx.clock.now,
      visible: true,
      focused: true,
    });
  await beat();
  for (let s = 0; s < minutes * 60; s += 30) {
    ctx.clock.now += 30_000;
    await beat();
  }
}

describe('30 days through the API', () => {
  it('plans, reviews and records day by day as designed', async () => {
    const ctx = await practiceApp();
    const log: { day: number; date: string; kinds: string[]; reviewed: boolean }[] = [];
    for (let day = 0; day < 30; day++) {
      ctx.clock.now = evening(day);
      const weekday = new Date(ctx.clock.now + 9 * 3_600_000).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const plan = dailyPlanSchema.parse((await ctx.call('GET', '/daily-plan')).json);
      let reviewed = false;
      for (const block of plan.blocks) {
        if (block.kind === 'review') {
          const res = await ctx.call('POST', '/practice-sets', { kind: 'review' });
          expect(res.status, `review set on day ${day}`).toBe(200);
          await answerSet(ctx, practiceSetViewSchema.parse(res.json).id, day, false);
          reviewed = true;
        } else if (block.kind === 'new_lesson' || block.kind === 'continue') {
          const lessonId = block.lesson?.id ?? '';
          await ctx.call('POST', `/lessons/${lessonId}/progress`, { readProgress: 1 });
          if (lessonId !== LESSON) continue; // the fixture's second lesson has no exercises
          const res = await ctx.call('POST', '/practice-sets', { kind: 'lesson', lessonId });
          await answerSet(ctx, practiceSetViewSchema.parse(res.json).id, day);
        } else {
          const res = await ctx.call('POST', '/practice-sets', { kind: 'weakness' });
          expect(res.status, `weakness set on day ${day}`).toBe(200);
          await answerSet(ctx, practiceSetViewSchema.parse(res.json).id, day);
        }
      }
      await heartbeats(ctx, 6);
      if (reviewed) {
        // D-029: a concept rated today is not due again today.
        const queue = reviewQueueSchema.parse((await ctx.call('GET', '/review-queue')).json);
        expect(queue.due).toEqual([]);
        const after = dailyPlanSchema.parse((await ctx.call('GET', '/daily-plan')).json);
        expect(after.blocks.some((b) => b.kind === 'review')).toBe(false);
      }
      log.push({ day, date: plan.date, kinds: plan.blocks.map((b) => b.kind), reviewed });
    }

    // Day 0 is a Saturday; the first weekday starts the first lesson.
    expect(log[0]?.kinds).toEqual(['new_lesson']);
    // Reviews come back on later days, spaced out by FSRS: once the learner stops making
    // mistakes, review days thin out.
    const reviewDays = log.filter((d) => d.reviewed);
    expect(reviewDays.length).toBeGreaterThanOrEqual(3);
    const lastTwoWeeks = log.filter((d) => d.day >= 16);
    expect(lastTwoWeeks.filter((d) => d.reviewed).length).toBeLessThan(lastTwoWeeks.length);

    // One FSRS rating per concept and local day (a same-day `again` excepted).
    const ratings = ctx.userDb.sqlite
      .prepare('SELECT concept_id, rating, reviewed_at FROM review_logs ORDER BY reviewed_at')
      .all() as { concept_id: string; rating: string; reviewed_at: number }[];
    const seen = new Map<string, number>();
    for (const r of ratings) {
      const key = `${r.concept_id}@${new Date(r.reviewed_at + 5 * 3_600_000).toISOString().slice(0, 10)}`;
      if (seen.has(key)) expect(r.rating).toBe('again');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    // Intervals grow: the card is due well after the last review by the end.
    const card = ctx.userDb.sqlite
      .prepare(
        "SELECT stability, reps, due_at, last_review_at FROM concept_memory WHERE concept_id = 'js.basics.statement'",
      )
      .get() as { stability: number; reps: number; due_at: number; last_review_at: number };
    expect(card.reps).toBeGreaterThanOrEqual(4);
    expect(card.stability).toBeGreaterThan(3);
    const mastery = ctx.userDb.sqlite
      .prepare("SELECT stage, score FROM concept_mastery WHERE concept_id = 'js.basics.statement'")
      .get() as { stage: string; score: number };
    expect(['practicing', 'proficient', 'mastered']).toContain(mastery.stage);
    // Every studied weekday met the 5-minute "studied day" bar.
    const days = ctx.userDb.sqlite
      .prepare('SELECT COUNT(*) AS n FROM daily_activity WHERE active_ms >= 300000')
      .get() as { n: number };
    expect(days.n).toBe(log.length);
  });
});
