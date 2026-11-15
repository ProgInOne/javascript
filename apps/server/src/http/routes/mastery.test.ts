import { masteryOverviewSchema, type MasteryOverview } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { EX } from '../../test/content-fixture.ts';
import { DAY, practiceApp } from '../../test/practice-app.ts';
import { answerAll, lessonSet, parsed, submit, type Ctx } from '../../test/practice-flow.ts';

// Course progress and the concept map (ui-ux.md 대시보드, FR-DASH-01/02).

const overview = async (ctx: Ctx): Promise<MasteryOverview> => {
  const res = await ctx.call('GET', '/mastery');
  expect(res.status).toBe(200);
  return masteryOverviewSchema.parse(res.json);
};

const tile = (o: MasteryOverview, id: string) =>
  o.courses.flatMap((c) => c.modules.flatMap((m) => m.concepts)).find((t) => t.id === id);

describe('GET /mastery', () => {
  it('lists every concept by module, all not started for a new learner', async () => {
    const ctx = await practiceApp();
    const o = await overview(ctx);
    expect(o.date).toBe('2026-11-14');
    expect(o.courses).toHaveLength(1);
    const course = o.courses[0];
    expect(course).toMatchObject({
      id: 'js-basics',
      lessons: { total: 4, completed: 0 },
      stageCounts: { not_started: 2, introduced: 0, practicing: 0, proficient: 0, mastered: 0 },
    });
    expect(course?.modules).toEqual([
      {
        id: 'js-basics.start',
        title: expect.any(String) as string,
        lessons: { total: 4, completed: 0 },
        concepts: [
          expect.objectContaining({
            id: 'js.basics.statement',
            stage: 'not_started',
            effective: 0,
            reviewDue: false,
            nextReviewDate: null,
            misconceptions: [],
          }),
          expect.objectContaining({ id: 'js.basics.comment', stage: 'not_started' }),
        ],
      },
    ]);
  });

  it('shows progress, the next review and the review marker as time passes', async () => {
    const ctx = await practiceApp();
    await answerAll(ctx, await lessonSet(ctx));
    const after = await overview(ctx);
    expect(after.courses[0]?.lessons).toEqual({ total: 4, completed: 1 });
    const statement = tile(after, 'js.basics.statement');
    expect(statement?.stage).not.toBe('not_started');
    expect(statement?.effective).toBeGreaterThan(0);
    expect(statement?.reviewDue).toBe(false);
    expect(statement?.nextReviewDate).toMatch(/^2026-11-\d{2}$/);
    const counts = after.courses[0]?.stageCounts;
    expect(counts && Object.values(counts).reduce((a, b) => a + b, 0)).toBe(2);
    expect(counts?.not_started).toBeLessThan(2);

    // On the review date the tile carries the "복습 예정" marker; the stage stays.
    const due = Date.parse(`${statement?.nextReviewDate ?? ''}T12:00:00+09:00`);
    ctx.clock.now = due + DAY;
    const later = tile(await overview(ctx), 'js.basics.statement');
    expect(later).toMatchObject({ stage: statement?.stage, reviewDue: true });
  });

  it('lists active misconceptions of a concept', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const mcq = set.items.find((i) => i.exerciseId === EX.mcq);
    if (!mcq) throw new Error('no mcq item');
    // A confident wrong answer confirms the misconception at once.
    parsed(await submit(ctx, mcq, { correct: false, body: { confidence: 'sure' } }));
    expect(tile(await overview(ctx), 'js.basics.statement')?.misconceptions).toEqual([
      { id: 'js.mc.log-is-return', title: 'console.log를 반환으로 생각함', status: 'confirmed' },
    ]);
  });
});
