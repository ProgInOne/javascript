import {
  buildDailyPlan,
  localDateOf,
  type DailyPlanBlock,
  type EngineDeps,
} from '@proginone/learning-engine';
import type { DailyPlanBlockView, DailyPlanView } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { listMasteryConceptIds } from '../../db/user/learning-state.ts';
import {
  getDailyActivity,
  latestActiveLesson,
  listLessonProgress,
  type LessonProgressRow,
} from '../../db/user/progress.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { learnerContext } from '../practice/engine.ts';
import type { WeaknessService } from '../practice/weakness.ts';
import type { ReviewService } from '../review/review-service.ts';
import type { GoalService } from './goal-service.ts';
import { courseLessonEstimates, goalView, lessonEstimate, loadGoal } from './planning-input.ts';

/** `GET /daily-plan`: today's plan (learning-engine.md#오늘의-학습-구성-builddailyplan). */
export class DailyPlanService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #engine: EngineDeps;
  readonly #now: Clock;
  readonly #review: ReviewService;
  readonly #weakness: WeaknessService;
  readonly #goals: GoalService;

  constructor(deps: {
    userDb: UserDb;
    content: ContentAccess;
    engine: EngineDeps;
    now: Clock;
    review: ReviewService;
    weakness: WeaknessService;
    goals: GoalService;
  }) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#engine = deps.engine;
    this.#now = deps.now;
    this.#review = deps.review;
    this.#weakness = deps.weakness;
    this.#goals = deps.goals;
  }

  get(): DailyPlanView {
    const now = this.#now();
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const date = localDateOf(now, dayBoundary);
    const { row, goal } = loadGoal(this.#engine, orm, learnerId);
    const progress = listLessonProgress(orm, learnerId);
    const progressById = new Map(progress.map((p) => [p.lessonId, p]));

    // Continue: the most recently active lesson being read or practised.
    const active = latestActiveLesson(orm, learnerId);
    const activeCourse = active ? repo.courseOfLesson(active.lessonId) : null;
    const activeLesson =
      active && activeCourse
        ? repo.listCourseLessons(activeCourse).find((l) => l.id === active.lessonId)
        : undefined;
    const continueLesson =
      active && activeLesson ? lessonEstimate(orm, activeLesson, active) : null;

    // Next: the first untouched lesson of the target course (else the current course, else the
    // first course of the catalog).
    const courseId =
      goal.targetCourseId ?? activeCourse ?? lastCourse(repo, progress) ?? repo.listCourseIds()[0];
    const next =
      courseId === undefined
        ? undefined
        : courseLessonEstimates(repo, orm, learnerId, courseId).find(
            (l) => (l.progress?.status ?? 'not_started') === 'not_started',
          );

    const reviews = this.#review.allDue();
    const weak = this.#weakness.rank(now).entries;
    const pace = this.#goals.pace(goal, now);
    const plan = buildDailyPlan(this.#engine, {
      goal,
      todayActiveMs: getDailyActivity(orm, learnerId, date)?.activeMs ?? 0,
      reviewQueue: reviews.entries,
      continueLesson,
      nextLesson: next ? next.estimate : null,
      weakConcepts: weak,
      pace,
      firstRun: progress.length === 0 && listMasteryConceptIds(orm, learnerId).length === 0,
    });

    const conceptTitles = repo.getConcepts(
      [...plan.blocks, ...plan.later].flatMap((b) => [...b.conceptIds]),
    );
    const lessonTitles = new Map<string, string>();
    for (const l of [activeLesson, next?.lesson]) if (l) lessonTitles.set(l.id, l.title);
    const view = (b: DailyPlanBlock): DailyPlanBlockView => {
      const lessonProgress: LessonProgressRow | undefined =
        b.lessonId === null ? undefined : progressById.get(b.lessonId);
      return {
        kind: b.kind,
        minutes: b.minutes,
        reason: b.reason,
        concepts: b.conceptIds.map((id) => ({
          id,
          title: reviews.titles.get(id) ?? conceptTitles.get(id)?.title ?? id,
        })),
        lesson:
          b.lessonId === null
            ? null
            : {
                id: b.lessonId,
                title: lessonTitles.get(b.lessonId) ?? b.lessonId,
                status: lessonProgress?.status ?? 'not_started',
                practiceSetId: lessonProgress?.practiceSetId ?? null,
              },
        partial: b.partial,
      };
    };
    return {
      date,
      goal: goalView(repo, row, goal),
      activeMinutesToday: plan.activeMinutesToday,
      budgetMinutes: plan.budgetMinutes,
      goalMet: plan.goalMet,
      mode: plan.mode,
      blocks: plan.blocks.map(view),
      later: plan.later.map(view),
      totalMinutes: plan.blocks.reduce((s, b) => s + b.minutes, 0),
      pace,
    };
  }
}

/** Course of the most recently updated lesson progress, if any. */
function lastCourse(
  repo: ContentAccess['repo'],
  progress: readonly LessonProgressRow[],
): string | null {
  const latest = [...progress].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  return latest ? repo.courseOfLesson(latest.lessonId) : null;
}
