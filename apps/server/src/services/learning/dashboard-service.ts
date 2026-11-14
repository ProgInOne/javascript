import { localDateOf } from '@proginone/learning-engine';
import type { Dashboard } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { getDailyActivity, latestActiveLesson } from '../../db/user/progress.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { learnerContext } from '../practice/engine.ts';
import type { ReviewService } from '../review/review-service.ts';

/** The minimal v0.1 dashboard: continue learning, today's reviews, today's minutes. */
export class DashboardService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #review: ReviewService;
  readonly #now: Clock;

  constructor(deps: { userDb: UserDb; content: ContentAccess; review: ReviewService; now: Clock }) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#review = deps.review;
    this.#now = deps.now;
  }

  get(): Dashboard {
    const orm = this.#userDb.orm;
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const date = localDateOf(this.#now(), dayBoundary);
    const progress = latestActiveLesson(orm, learnerId);
    const lesson = progress ? this.#content.repo.getLessonPlan(progress.lessonId) : null;
    return {
      date,
      activeMinutesToday: Math.floor(
        (getDailyActivity(orm, learnerId, date)?.activeMs ?? 0) / 60_000,
      ),
      reviewDueCount: this.#review.dueCount(),
      continueLesson:
        progress && lesson
          ? {
              id: lesson.id,
              title: lesson.title,
              status: progress.status,
              readProgress: progress.readProgress,
              practiceSetId: progress.practiceSetId,
            }
          : null,
    };
  }
}
