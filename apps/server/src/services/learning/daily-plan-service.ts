import {
  buildDailyPlan,
  localDateOf,
  type DailyPlanBlock,
  type EngineDeps,
} from '@proginone/learning-engine';
import type { DailyPlanBlockView, DailyPlanView } from '@proginone/shared';
import type { LessonKind } from '../../db/content/repository.ts';
import type { UserDb } from '../../db/user/connection.ts';
import { listMasteryConceptIds } from '../../db/user/learning-state.ts';
import {
  getDailyActivity,
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

    // Continue: the lesson of the latest activity, while it is being read or practised with a set
    // still open. A lesson left open before other lessons were studied is not continued (D-089):
    // the plan follows where the learner is now; the course screen still shows it in progress.
    // A lesson whose last set ended without passing is not in progress: the plan moves on to the
    // next lesson and weakness practice instead of repeating it every day (D-033). A project has
    // no set: it is in progress until every milestone passed (D-048).
    const latest =
      [...progress].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
    const active =
      latest &&
      (latest.status === 'reading' ||
        (latest.status === 'practicing' &&
          (latest.practiceSetId !== null ||
            repo.getLessonPlan(latest.lessonId)?.kind === 'project')))
        ? latest
        : null;
    const activeCourse = active ? repo.courseOfLesson(active.lessonId) : null;
    const activeLesson =
      active && activeCourse
        ? repo.listCourseLessons(activeCourse, PLAN_KINDS).find((l) => l.id === active.lessonId)
        : undefined;
    const continueLesson =
      active && activeLesson
        ? lessonEstimate(orm, activeLesson, active, { repo, learnerId })
        : null;

    // Next: the first untouched lesson or project, searched from the target course (else the
    // course of the latest activity) onward in catalog order (track → course), so finishing a
    // course moves on to the next one (html → css → js-basics, D-089). Assessments are taken from
    // the course screen.
    let next: ReturnType<typeof courseLessonEstimates>[number] | undefined;
    for (const courseId of courseSearchOrder(
      repo.listCourseIds(),
      goal.targetCourseId ?? (latest ? repo.courseOfLesson(latest.lessonId) : null),
    )) {
      next = courseLessonEstimates(repo, orm, learnerId, courseId, PLAN_KINDS).find(
        (l) => (l.progress?.status ?? 'not_started') === 'not_started',
      );
      if (next) break;
    }

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
      calibration: pace?.calibration ?? this.#goals.calibration(),
      firstRun: progress.length === 0 && listMasteryConceptIds(orm, learnerId).length === 0,
    });

    const conceptTitles = repo.getConcepts(
      [...plan.blocks, ...plan.later].flatMap((b) => [...b.conceptIds]),
    );
    const planLessons = new Map<string, { title: string; kind: LessonKind }>();
    for (const l of [activeLesson, next?.lesson])
      if (l) planLessons.set(l.id, { title: l.title, kind: l.kind });
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
                title: planLessons.get(b.lessonId)?.title ?? b.lessonId,
                status: lessonProgress?.status ?? 'not_started',
                practiceSetId: lessonProgress?.practiceSetId ?? null,
                kind: planLessons.get(b.lessonId)?.kind ?? 'lesson',
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

/** Units today's plan continues and starts (the pace counts lessons only). */
const PLAN_KINDS = ['lesson', 'project'] as const;

/** Course of the most recently updated lesson progress, if any. */
/**
 * Courses to look for the next lesson in: `start` and the ones after it in catalog order, then
 * the ones before it. An unknown or missing `start` searches from the first course.
 */
export function courseSearchOrder(courseIds: readonly string[], start: string | null): string[] {
  const i = start === null ? -1 : courseIds.indexOf(start);
  return i < 0 ? [...courseIds] : [...courseIds.slice(i), ...courseIds.slice(0, i)];
}
