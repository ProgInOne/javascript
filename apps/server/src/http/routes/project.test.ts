import {
  dailyPlanSchema,
  lessonDetailSchema,
  masteryOverviewSchema,
  mistakeListSchema,
  projectAttemptResponseSchema,
  projectViewSchema,
  type ProjectAttemptResponse,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { runFor } from '../../test/answers.ts';
import {
  ANSWER_MARKERS,
  PROJECT,
  PROJECT_CHECKS,
  PROJECT_EXERCISE,
  PROJECT_PREP,
} from '../../test/content-fixture.ts';
import { count, MINUTE, practiceApp } from '../../test/practice-app.ts';
import {
  answerAll,
  createSet,
  errorCode,
  LESSON,
  lessonSet,
  type Ctx,
} from '../../test/practice-flow.ts';

// Project units (content-and-exercises.md#프로젝트-단원-kind-project, D-048): one milestone
// web_task outside practice sets, partial runs recorded but not counted, completion on the run
// that first passes every milestone.

const PAGE = ['<h1>목록</h1>', '<ul></ul>', '<p>끝</p>'];

/** The learner's page with the first `n` milestones built. */
const answerWith = (n: number) => ({
  files: [{ path: 'index.html', content: `<main>${PAGE.slice(0, n).join('')}</main>` }],
});

/** A grading run the way the web app sends it (run plan → sandbox → attempt). */
async function run(
  ctx: Ctx,
  milestones: number,
  options: { status?: 'crashed'; body?: object } = {},
) {
  const answer = answerWith(milestones);
  const plan = await ctx.call('POST', `/exercises/${PROJECT_EXERCISE}/run-plan`, {
    answer,
    purpose: 'grading',
  });
  expect(plan.status).toBe(200);
  const runResult = runFor(plan.json, {
    passing: PROJECT_CHECKS.slice(0, milestones),
    ...(options.status ? { status: options.status } : {}),
  });
  ctx.clock.now += MINUTE;
  return ctx.call('POST', `/lessons/${PROJECT}/project/attempts`, {
    exerciseId: PROJECT_EXERCISE,
    answer,
    runResult,
    startedAt: ctx.clock.now - 50_000,
    activeMs: 45_000,
    ...options.body,
  });
}

const parsedRun = (res: { status: number; json: unknown }): ProjectAttemptResponse => {
  expect(res.status).toBe(201);
  return projectAttemptResponseSchema.parse(res.json);
};

const view = async (ctx: Ctx) => {
  const res = await ctx.call('GET', `/lessons/${PROJECT}/project`);
  expect(res.status).toBe(200);
  return projectViewSchema.parse(res.json);
};

const progressRow = (ctx: Ctx) =>
  ctx.userDb.sqlite
    .prepare(
      'SELECT status, practice_set_id, completed_at FROM lesson_progress WHERE lesson_id = ?',
    )
    .get(PROJECT) as {
    status: string;
    practice_set_id: string | null;
    completed_at: number | null;
  };

describe('project units: content and practice sets', () => {
  it('announces the project on the lesson and starts with no progress', async () => {
    const ctx = await practiceApp();
    const lesson = lessonDetailSchema.parse((await ctx.call('GET', `/lessons/${PROJECT}`)).json);
    expect(lesson).toMatchObject({
      kind: 'project',
      project: {
        exerciseId: PROJECT_EXERCISE,
        milestoneCount: 3,
        practiceCount: 1,
        estimatedMinutes: 45,
      },
    });
    expect(await view(ctx)).toEqual({
      lessonId: PROJECT,
      exerciseId: PROJECT_EXERCISE,
      status: 'not_started',
      completedAt: null,
      milestones: [
        { id: 'm1', title: '제목 만들기', checkCount: 1, passed: null, blocked: false },
        { id: 'm2', title: '목록 만들기', checkCount: 1, passed: null, blocked: false },
        { id: 'm3', title: '안내 문장 넣기', checkCount: 1, passed: null, blocked: false },
      ],
      passedCount: 0,
      runCount: 0,
      lastRun: null,
      savedAnswer: null,
      savedAt: null,
    });
    const regular = await ctx.call('GET', `/lessons/${LESSON}`);
    expect(lessonDetailSchema.parse(regular.json).project ?? null).toBeNull();
  });

  it('refuses an assessment set for a project and the project API for other units', async () => {
    const ctx = await practiceApp();
    const res = await ctx.call('POST', '/practice-sets', { kind: 'assessment', lessonId: PROJECT });
    expect(res.status).toBe(409);
    expect(errorCode(res.json)).toBe('PRACTICE_KIND_MISMATCH');
    expect(JSON.stringify(res.json)).toContain('"expected":"project"');
    const other = await ctx.call('GET', `/lessons/${LESSON}/project`);
    expect(other.status).toBe(409);
    expect(errorCode(other.json)).toBe('PRACTICE_KIND_MISMATCH');
    expect((await ctx.call('GET', '/lessons/js-basics.start.nope/project')).status).toBe(404);
  });

  it('serves the preparation practice in its own set only, without completing the unit', async () => {
    const ctx = await practiceApp();
    const prep = await createSet(ctx, { kind: 'lesson', lessonId: PROJECT });
    expect(prep.passRule).toBeNull();
    expect(prep.items.map((i) => i.exerciseId)).toContain(PROJECT_PREP);
    // Only the unit's own items: no interleaved review items of other units.
    expect(prep.items.map((i) => i.exerciseId)).toEqual([PROJECT_PREP]);
    const last = await answerAll(ctx, prep);
    expect(last.set.status).toBe('completed');
    expect(last.set.result?.pass ?? null).toBeNull();
    expect(progressRow(ctx)).toMatchObject({ status: 'practicing', completed_at: null });
    expect((await view(ctx)).status).toBe('practicing');
  });

  it('keeps project-unit exercises out of other units, review and weakness sets', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    expect(set.items.map((i) => i.exerciseId)).not.toContain(PROJECT_EXERCISE);
    expect(set.items.map((i) => i.exerciseId)).not.toContain(PROJECT_PREP);
    // The project still counts as practicing after the preparation set (milestones complete it).
    expect(JSON.stringify(await answerAll(ctx, set))).not.toContain(PROJECT_PREP);
    const retry = await ctx.call('POST', '/practice-sets', {
      kind: 'extra',
      exerciseIds: [PROJECT_EXERCISE],
    });
    expect(retry.status).toBe(409);
    expect(errorCode(retry.json)).toBe('PRACTICE_KIND_MISMATCH');
    const weakness = await ctx.call('POST', '/practice-sets', {
      kind: 'weakness',
      conceptIds: ['js.basics.statement'],
    });
    expect(JSON.stringify(weakness.json)).not.toContain(PROJECT_EXERCISE);
    expect(JSON.stringify(weakness.json)).not.toContain(PROJECT_PREP);
  });
});

describe('POST /lessons/:id/project/attempts', () => {
  it('records partial runs without mastery evidence and resumes from the latest code', async () => {
    const ctx = await practiceApp();
    const first = parsedRun(await run(ctx, 1));
    expect(first.attempt).toMatchObject({
      outcome: 'partial',
      correct: false,
      graded: true,
      counted: false,
    });
    expect(first.grade.milestones?.map((m) => m.passed)).toEqual([true, false, false]);
    expect(first.grade.explanation).toBe('');
    expect(first.newlyPassed).toEqual(['m1']);
    expect(first.completedNow).toBe(false);
    expect(first.masteryChanges).toEqual([]);
    expect(first.project).toMatchObject({ status: 'practicing', passedCount: 1, runCount: 1 });
    for (const marker of ANSWER_MARKERS) expect(JSON.stringify(first)).not.toContain(marker);

    const second = parsedRun(await run(ctx, 2));
    expect(second.newlyPassed).toEqual(['m2']);
    expect(second.project.passedCount).toBe(2);

    // Nothing reached the engine: no evidence, no mastery, attempts kept with engine_applied 0.
    expect(count(ctx, 'mastery_evidence')).toBe(0);
    expect(count(ctx, 'concept_mastery')).toBe(0);
    expect(
      ctx.userDb.sqlite
        .prepare('SELECT engine_applied, practice_set_item_id FROM attempts ORDER BY submitted_at')
        .all(),
    ).toEqual([
      { engine_applied: 0, practice_set_item_id: null },
      { engine_applied: 0, practice_set_item_id: null },
    ]);
    expect(progressRow(ctx)).toEqual({
      status: 'practicing',
      practice_set_id: null,
      completed_at: null,
    });

    // Unfinished runs are not wrong answers: the mistake notes stay empty.
    const mistakes = mistakeListSchema.parse((await ctx.call('GET', '/mistakes')).json);
    expect(mistakes.items.map((m) => m.exerciseId)).not.toContain(PROJECT_EXERCISE);

    // Resume: milestone results of the latest run and its code.
    const resumed = await view(ctx);
    expect(resumed.milestones.map((m) => m.passed)).toEqual([true, true, false]);
    expect(resumed.savedAnswer).toEqual(answerWith(2));
    expect(resumed.savedAt).toBe(ctx.clock.now);
    expect(resumed.lastRun).toMatchObject({ outcome: 'partial', at: ctx.clock.now });
  });

  it('keeps the milestones of the last graded run when the sandbox fails', async () => {
    const ctx = await practiceApp();
    parsedRun(await run(ctx, 1));
    const crashed = parsedRun(await run(ctx, 2, { status: 'crashed' }));
    expect(crashed.attempt).toMatchObject({ graded: false, counted: false });
    expect(crashed.newlyPassed).toEqual([]);
    expect(crashed.project).toMatchObject({ passedCount: 1, runCount: 1 });
    // The code is still the learner's latest: resume from it.
    expect(crashed.project.savedAnswer).toEqual(answerWith(2));
  });

  it('completes the unit on the first run that passes every milestone, and counts it once', async () => {
    const ctx = await practiceApp();
    parsedRun(await run(ctx, 1));
    const hint = await ctx.call('POST', `/exercises/${PROJECT_EXERCISE}/hints`, {});
    expect(hint.status).toBe(200);

    const done = parsedRun(await run(ctx, 3));
    expect(done.attempt).toMatchObject({ outcome: 'correct', correct: true, counted: true });
    expect(done.completedNow).toBe(true);
    expect(done.newlyPassed).toEqual(['m2', 'm3']);
    expect(done.grade.explanation).toContain('해설');
    expect(done.masteryChanges.map((m) => m.conceptId).sort()).toEqual([
      'js.basics.comment',
      'js.basics.statement',
    ]);
    expect(done.project).toMatchObject({ status: 'completed', passedCount: 3, runCount: 2 });
    expect(progressRow(ctx)).toMatchObject({ status: 'completed', completed_at: ctx.clock.now });

    // One evidence row per tagged concept: a first try (W_try 1) with the hint weight kept.
    const evidence = ctx.userDb.sqlite
      .prepare(
        "SELECT concept_id, breakdown_json FROM mastery_evidence WHERE kind = 'attempt' ORDER BY concept_id",
      )
      .all() as { concept_id: string; breakdown_json: string }[];
    expect(evidence.map((e) => e.concept_id)).toEqual(['js.basics.comment', 'js.basics.statement']);
    const factors = (
      JSON.parse(evidence[1]?.breakdown_json ?? '{}') as {
        factors: Record<string, { value: number }>;
      }
    ).factors;
    expect(factors['try']?.value).toBe(1);
    expect(factors['hint']?.value).toBeLessThan(1);
    expect(factors['context']?.value).toBe(1);
    const evidenceRows = count(ctx, 'mastery_evidence');
    // No FSRS card: spaced scheduling stays with practice and review sets.
    expect(count(ctx, 'pending_ratings')).toBe(0);
    expect(
      ctx.userDb.sqlite
        .prepare('SELECT lessons_completed, attempts_count FROM daily_activity')
        .get(),
    ).toEqual({ lessons_completed: 1, attempts_count: 2 });

    // Later runs are recorded but neither count again nor undo the completion.
    const again = parsedRun(await run(ctx, 1));
    expect(again.attempt).toMatchObject({ counted: false, correct: false });
    expect(again.completedNow).toBe(false);
    expect(again.grade.explanation).toContain('해설');
    expect(again.project).toMatchObject({ status: 'completed', passedCount: 1 });
    expect(count(ctx, 'mastery_evidence')).toBe(evidenceRows);
    expect(progressRow(ctx).status).toBe('completed');

    const mastery = masteryOverviewSchema.parse((await ctx.call('GET', '/mastery')).json);
    expect(mastery.courses[0]?.lessons).toEqual({ total: 4, completed: 1 });
  });

  it('validates the exercise and the run result', async () => {
    const ctx = await practiceApp();
    const wrong = await run(ctx, 1, { body: { exerciseId: `${LESSON}.mcq-x` } });
    expect(wrong.status).toBe(400);
    expect(errorCode(wrong.json)).toBe('PRACTICE_ITEM_MISMATCH');
    const bad = await run(ctx, 1, { body: { runResult: { v: 1, type: 'nope' } } });
    expect(bad.status).toBe(400);
    expect(errorCode(bad.json)).toBe('VALIDATION_RUN_RESULT_INVALID');
    const regular = await ctx.call('POST', `/lessons/${LESSON}/project/attempts`, {
      exerciseId: PROJECT_EXERCISE,
      answer: answerWith(1),
      startedAt: ctx.clock.now,
      activeMs: 0,
    });
    expect(regular.status).toBe(409);
    expect(count(ctx, 'attempts')).toBe(0);
  });
});

describe('projects in planning', () => {
  it('continues a project in progress in today’s plan', async () => {
    const ctx = await practiceApp();
    parsedRun(await run(ctx, 1));
    const plan = dailyPlanSchema.parse((await ctx.call('GET', '/daily-plan')).json);
    const block = [...plan.blocks, ...plan.later].find((b) => b.kind === 'continue');
    expect(block?.lesson).toMatchObject({ id: PROJECT, status: 'practicing', kind: 'project' });
    // 45 practice minutes, a third of the milestones done.
    expect(block?.minutes).toBe(30);
  });

  it('leaves a completed project out of the plan', async () => {
    const ctx = await practiceApp();
    parsedRun(await run(ctx, 3));
    await createSet(ctx, { kind: 'lesson', lessonId: LESSON });
    const plan = dailyPlanSchema.parse((await ctx.call('GET', '/daily-plan')).json);
    const lessons = [...plan.blocks, ...plan.later].map((b) => b.lesson?.id ?? null);
    expect(lessons).not.toContain(PROJECT);
  });
});
