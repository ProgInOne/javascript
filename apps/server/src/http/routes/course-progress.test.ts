import {
  courseProgressDetailSchema,
  courseProgressListSchema,
  masteryOverviewSchema,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { ASSESSMENT, PROJECT } from '../../test/content-fixture.ts';
import { MINUTE, practiceApp } from '../../test/practice-app.ts';
import { LESSON, type Ctx } from '../../test/practice-flow.ts';

// Course progress for the course list and detail (D-083).

const READING_ERRORS = 'js-basics.start.reading-errors';

const list = async (ctx: Ctx) =>
  courseProgressListSchema.parse((await ctx.call('GET', '/course-progress')).json);
const detail = async (ctx: Ctx, id = 'js-basics') =>
  courseProgressDetailSchema.parse((await ctx.call('GET', `/courses/${id}/progress`)).json);

/** Writes a `lesson_progress` row as of the test clock. */
function progress(ctx: Ctx, lessonId: string, status: string, readProgress = 0) {
  ctx.userDb.sqlite
    .prepare(
      `INSERT INTO lesson_progress (learner_id, lesson_id, status, read_progress, updated_at)
       VALUES ('01JD3Z8Q6V2K9M4T7R1X5W0BNC', ?, ?, ?, ?)
       ON CONFLICT (learner_id, lesson_id) DO UPDATE
         SET status = excluded.status, read_progress = excluded.read_progress,
             updated_at = excluded.updated_at`,
    )
    .run(lessonId, status, readProgress, ctx.clock.now);
}

describe('GET /course-progress and /courses/:id/progress (D-083)', () => {
  it('starts every course not started, with the first lesson next', async () => {
    const ctx = await practiceApp();
    const courses = (await list(ctx)).courses;
    expect(courses.map((c) => c.courseId)).toContain('js-basics');
    expect(courses.find((c) => c.courseId === 'js-basics')).toEqual({
      courseId: 'js-basics',
      // Assessments and projects count like lessons, as on the dashboard.
      lessons: { total: 4, completed: 0 },
      state: 'not_started',
      next: { id: LESSON, title: '단원 0', status: 'not_started' },
    });
    const d = await detail(ctx);
    expect(d.modules).toEqual([
      { moduleId: 'js-basics.start', lessons: { total: 4, completed: 0 } },
    ]);
    expect(d.lessonStatuses.map((l) => [l.lessonId, l.status, l.readProgress])).toEqual([
      [LESSON, 'not_started', 0],
      [READING_ERRORS, 'not_started', 0],
      [ASSESSMENT, 'not_started', 0],
      [PROJECT, 'not_started', 0],
    ]);
  });

  it('follows reading through the API and continues the latest lesson in progress', async () => {
    const ctx = await practiceApp();
    await ctx.call('POST', `/lessons/${READING_ERRORS}/progress`, { readProgress: 0.4 });
    ctx.clock.now += MINUTE;
    await ctx.call('POST', `/lessons/${LESSON}/progress`, { readProgress: 0.2 });

    let d = await detail(ctx);
    expect(d.state).toBe('in_progress');
    expect(d.next).toMatchObject({ id: LESSON, status: 'reading' });
    expect(d.lessonStatuses.find((l) => l.lessonId === READING_ERRORS)).toEqual({
      lessonId: READING_ERRORS,
      status: 'reading',
      readProgress: 0.4,
    });

    ctx.clock.now += MINUTE;
    await ctx.call('POST', `/lessons/${READING_ERRORS}/progress`, { readProgress: 0.6 });
    d = await detail(ctx);
    expect(d.next).toMatchObject({ id: READING_ERRORS, status: 'reading' });
  });

  it('falls back to the first unfinished lesson and ends completed', async () => {
    const ctx = await practiceApp();
    progress(ctx, LESSON, 'completed', 1);
    progress(ctx, READING_ERRORS, 'completed', 1);
    let summary = (await list(ctx)).courses.find((c) => c.courseId === 'js-basics');
    expect(summary).toMatchObject({
      lessons: { total: 4, completed: 2 },
      state: 'in_progress',
      next: { id: ASSESSMENT, status: 'not_started' },
    });

    progress(ctx, ASSESSMENT, 'completed', 0);
    progress(ctx, PROJECT, 'completed', 0);
    summary = (await list(ctx)).courses.find((c) => c.courseId === 'js-basics');
    expect(summary).toMatchObject({
      lessons: { total: 4, completed: 4 },
      state: 'completed',
      next: null,
    });
    expect((await detail(ctx)).modules[0]?.lessons).toEqual({ total: 4, completed: 4 });
  });

  it('counts the same as the dashboard course progress (GET /mastery)', async () => {
    const ctx = await practiceApp();
    progress(ctx, LESSON, 'completed', 1);
    progress(ctx, PROJECT, 'practicing');
    const mastery = masteryOverviewSchema.parse((await ctx.call('GET', '/mastery')).json);
    const courses = (await list(ctx)).courses;
    for (const c of mastery.courses) {
      expect(courses.find((p) => p.courseId === c.id)?.lessons).toEqual(c.lessons);
      const d = await detail(ctx, c.id);
      expect(d.modules.map((m) => m.lessons)).toEqual(c.modules.map((m) => m.lessons));
    }
  });

  it('404 for an unknown course', async () => {
    const ctx = await practiceApp();
    expect((await ctx.call('GET', '/courses/nope/progress')).status).toBe(404);
  });
});
