import {
  conceptDetailSchema,
  practiceSetViewSchema,
  reviewQueueSchema,
  type ConceptDetail,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { ASSESS, ASSESSMENT, EX } from '../../test/content-fixture.ts';
import { DAY, practiceApp, T0 } from '../../test/practice-app.ts';
import { createSet, LESSON, parsed, submit, type Ctx } from '../../test/practice-flow.ts';

// Scenario test of the `mastered` gate (learning-engine.md#숙련-단계와-게이트, roadmap M6 테스트):
// one learner over three weeks through the HTTP API, a real temp user.db and a fake clock. The
// first test is the path that reaches `mastered`; the others change exactly one thing and stay
// `proficient` with exactly that gate condition missing.
//
// Days are learner-local (Asia/Seoul, day start 04:00); every session is at 19:00. FSRS (real
// ts-fsrs, fuzz seeded by the concept id) is deterministic, so the review due date is too.

const CONCEPT = 'js.basics.statement';

/** 19:00 in Seoul on day `n` (T0 is 10:00, Saturday 2026-11-14). */
const evening = (n: number) => T0 + n * DAY + 9 * 3_600_000;

/** What the learner does on a day besides the reviews that are due. */
type Session =
  | { kind: 'review' }
  | { kind: 'assessment' }
  /** An `extra` set of these exercises; `hints: 3` opens the whole ladder before answering. */
  | { kind: 'extra'; exerciseIds: string[]; hints?: number };

/** Answers every item of a set correctly, including items adaptation appends. */
async function answerSet(ctx: Ctx, setId: string, hints = 0) {
  for (let step = 0; step < 30; step++) {
    const set = practiceSetViewSchema.parse(
      (await ctx.call('GET', `/practice-sets/${setId}`)).json,
    );
    const next = set.items.find((i) => i.id === set.nextItemId);
    if (!next) return set;
    if (set.kind === 'assessment') {
      ctx.clock.now += 60_000;
      const res = await ctx.call('POST', '/attempts', {
        practiceSetItemId: next.id,
        exerciseId: next.exerciseId,
        answer: next.exerciseId === ASSESS.commentL3 ? { value: false } : { optionId: 'b' },
        confidence: 'sure',
        startedAt: ctx.clock.now - 40_000,
        activeMs: 30_000,
      });
      expect(res.status).toBe(201);
      continue;
    }
    for (let level = 0; level < hints; level++) {
      const res = await ctx.call('POST', `/exercises/${next.exerciseId}/hints`, {
        practiceSetItemId: next.id,
      });
      expect(res.status).toBe(200);
    }
    parsed(await submit(ctx, next));
  }
  throw new Error(`set ${setId} did not finish`);
}

async function run(ctx: Ctx, session: Session) {
  switch (session.kind) {
    case 'review': {
      const set = await createSet(ctx, { kind: 'review' });
      await answerSet(ctx, set.id);
      return;
    }
    case 'assessment': {
      const set = await createSet(ctx, { kind: 'assessment', lessonId: ASSESSMENT });
      await answerSet(ctx, set.id);
      return;
    }
    case 'extra': {
      const set = await createSet(ctx, { kind: 'extra', exerciseIds: session.exerciseIds });
      await answerSet(ctx, set.id, session.hints ?? 0);
      return;
    }
  }
}

async function detail(ctx: Ctx): Promise<ConceptDetail> {
  const res = await ctx.call('GET', `/concepts/${CONCEPT}`);
  expect(res.status).toBe(200);
  return conceptDetailSchema.parse(res.json);
}

async function isDue(ctx: Ctx) {
  const queue = reviewQueueSchema.parse((await ctx.call('GET', '/review-queue')).json);
  return queue.due.some((d) => d.conceptId === CONCEPT);
}

/** The concept's FSRS ratings as `day:rating` (day = whole days since day 0's evening). */
function ratings(ctx: Ctx): string[] {
  const rows = ctx.userDb.sqlite
    .prepare(
      'SELECT rating, reviewed_at FROM review_logs WHERE concept_id = ? ORDER BY reviewed_at',
    )
    .all(CONCEPT) as { rating: string; reviewed_at: number }[];
  return rows.map((r) => `${String(Math.floor((r.reviewed_at - evening(0)) / DAY))}:${r.rating}`);
}

/** Day 0: read the lesson and answer its set right → `proficient`, first FSRS rating. */
async function learn(ctx: Ctx) {
  ctx.clock.now = evening(0);
  await ctx.call('POST', `/lessons/${LESSON}/progress`, { readProgress: 1 });
  const set = await createSet(ctx, { kind: 'lesson', lessonId: LESSON });
  await answerSet(ctx, set.id);
}

const gate = (name: string, required: number, actual: number) => ({
  gate: name,
  required,
  actual,
});

/** The first review falls due on day 5 (FSRS-7 after a `good` first rating). */
const DUE_DAY = 5;

describe('mastered gate over three weeks (fake clock, HTTP API, real user.db)', () => {
  it('reaches mastered only on the day the last gate condition is met', async () => {
    const ctx = await practiceApp();
    await learn(ctx);
    // Practice alone: proficient, with the memory and application conditions still open.
    const day0 = await detail(ctx);
    expect(day0.mastery.stage).toBe('proficient');
    expect(day0.mastery.effective).toBeGreaterThanOrEqual(85);
    expect(day0.nextStage).toEqual({
      stage: 'mastered',
      met: false,
      missing: [gate('spaced_reviews', 2, 0), gate('independent_application', 1, 0)],
    });

    // The learner comes back every evening, reviews whatever is due, takes the unit assessment
    // a week after that review and practises the concept once more a week later.
    const plan: Record<number, Session> = {
      12: { kind: 'assessment' },
      19: { kind: 'extra', exerciseIds: [EX.predict] },
    };
    const reviewDays: number[] = [];
    const stages: string[] = [];
    const missing: Record<number, string[]> = {};
    for (let day = 1; day <= 21; day++) {
      ctx.clock.now = evening(day);
      if (await isDue(ctx)) {
        reviewDays.push(day);
        await run(ctx, { kind: 'review' });
      }
      const session = plan[day];
      if (session) await run(ctx, session);
      const d = await detail(ctx);
      stages.push(d.mastery.stage);
      missing[day] = d.nextStage?.missing.map((m) => `${m.gate}:${String(m.actual)}`) ?? [];
    }

    // One due review (day 5); the next due date is weeks away for a learner this good.
    expect(reviewDays).toEqual([DUE_DAY]);
    expect(ratings(ctx)).toEqual(['0:good', '5:easy', '12:good', '19:good']);
    // Day 5 is only 5 days after day 0: not a spaced review yet.
    expect(missing[DUE_DAY]).toEqual(['spaced_reviews:0', 'independent_application:0']);
    // Day 12: the assessment is independent application and, 7 days after the review, the first
    // spaced review (assessment items are their own variant groups).
    expect(missing[12]).toEqual(['spaced_reviews:1']);
    // Day 19: the second spaced review from another variant group completes the gate.
    expect(stages.slice(0, 18).every((s) => s === 'proficient')).toBe(true);
    expect(stages.slice(18)).toEqual(['mastered', 'mastered', 'mastered']);
    const end = await detail(ctx);
    expect(end.nextStage).toBeNull();
    expect(end.mastery.stageChangedAt).toBeGreaterThanOrEqual(evening(19));
    expect(end.mastery.stageChangedAt).toBeLessThan(evening(20));
    // The promotion is recorded as a stage gate with every condition met.
    const gates = ctx.userDb.sqlite
      .prepare(
        "SELECT stage_before, stage_after, breakdown_json FROM mastery_evidence WHERE concept_id = ? AND kind = 'stage_gate' AND stage_after = 'mastered'",
      )
      .all(CONCEPT) as { stage_before: string; breakdown_json: string }[];
    expect(gates).toHaveLength(1);
    expect(gates[0]?.stage_before).toBe('proficient');
    expect(gates[0]?.breakdown_json).toContain('"promoted"');
  });

  // Each scenario keeps day 0 (lesson set) and the due review on day 5, then changes one thing.
  it.each<{ name: string; plan: Record<number, Session[]>; ratings: string[]; missing: object }>([
    {
      name: 'reviews less than 7 local days apart',
      plan: {
        11: [{ kind: 'assessment' }],
        17: [{ kind: 'extra', exerciseIds: [EX.predict] }],
      },
      ratings: ['0:good', '5:easy', '11:good', '17:good'],
      missing: [gate('spaced_reviews', 2, 0)],
    },
    {
      name: 'both spaced reviews backed by the same variant group',
      plan: {
        12: [{ kind: 'extra', exerciseIds: [EX.mcq] }],
        // The assessment comes after the day's rating, so it adds no review of its own.
        19: [{ kind: 'extra', exerciseIds: [EX.mcq] }, { kind: 'assessment' }],
      },
      ratings: ['0:good', '5:easy', '12:good', '19:good'],
      missing: [gate('spaced_reviews', 2, 1)],
    },
    {
      name: 'no independent application (no assessment, nothing above L3)',
      plan: {
        12: [{ kind: 'extra', exerciseIds: [EX.mcq] }],
        19: [{ kind: 'extra', exerciseIds: [EX.predict] }],
      },
      ratings: ['0:good', '5:easy', '12:good', '19:good'],
      missing: [gate('independent_application', 1, 0)],
    },
    {
      name: 'an again among the last three ratings',
      plan: {
        12: [{ kind: 'assessment' }],
        // Correct only after the whole hint ladder: rated `again` (the score still rises).
        13: [{ kind: 'extra', exerciseIds: [EX.mcq], hints: 3 }],
        20: [{ kind: 'extra', exerciseIds: [EX.predict] }],
      },
      ratings: ['0:good', '5:easy', '12:good', '13:again', '20:good'],
      missing: [gate('recent_again', 0, 1)],
    },
  ])('stays proficient with $name', async ({ plan, ratings: expected, missing }) => {
    const ctx = await practiceApp();
    await learn(ctx);
    ctx.clock.now = evening(DUE_DAY);
    expect(await isDue(ctx)).toBe(true);
    await run(ctx, { kind: 'review' });
    for (let day = DUE_DAY + 1; day <= 21; day++) {
      ctx.clock.now = evening(day);
      for (const session of plan[day] ?? []) await run(ctx, session);
    }
    expect(ratings(ctx)).toEqual(expected);
    const end = await detail(ctx);
    expect(end.mastery.stage).toBe('proficient');
    expect(end.mastery.effective).toBeGreaterThanOrEqual(85);
    expect(end.nextStage).toEqual({ stage: 'mastered', met: false, missing });
  });
});
