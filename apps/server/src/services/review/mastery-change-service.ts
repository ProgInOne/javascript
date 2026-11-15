import { addDays, localDateOf, startOfLocalDay, weekStartOf } from '@proginone/learning-engine';
import {
  MASTERY_STAGES,
  masteryChangesQuerySchema,
  type MasteryChanges,
  type MasteryStage,
} from '@proginone/shared';
import type { z } from 'zod';
import type { UserDb } from '../../db/user/connection.ts';
import { activeAssessmentAttemptIds } from '../../db/user/practice-sets.ts';
import { listStageChanges } from '../../db/user/review-history.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { learnerContext } from '../practice/engine.ts';

const rankOf = (stage: MasteryStage) => MASTERY_STAGES.indexOf(stage);

/**
 * `GET /mastery-changes` (FR-DASH-04 숙련도 변화): stage promotions and demotions from the
 * evidence log (`mastery_evidence` already keeps `stage_before`/`stage_after` per update, so no
 * separate history is stored), with a per-week summary in the learner's Monday-start weeks.
 */
export class MasteryChangeService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #now: Clock;

  constructor(deps: { userDb: UserDb; content: ContentAccess; now: Clock }) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#now = deps.now;
  }

  get(rawQuery: z.input<typeof masteryChangesQuerySchema> = {}): MasteryChanges {
    const query = masteryChangesQuerySchema.parse(rawQuery);
    const orm = this.#userDb.orm;
    const now = this.#now();
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const today = localDateOf(now, dayBoundary);
    const firstWeek = addDays(weekStartOf(today), -7 * (query.weeks - 1));
    const since = startOfLocalDay(firstWeek, dayBoundary);
    // Evidence of an assessment in progress would reveal its results early.
    const withheld = activeAssessmentAttemptIds(orm, learnerId);
    const rows = listStageChanges(orm, learnerId, since).filter(
      (r) => r.attemptId === null || !withheld.has(r.attemptId),
    );
    const titles = this.#content.repo.getConcepts(rows.map((r) => r.conceptId));
    const changes = rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      date: localDateOf(r.createdAt, dayBoundary),
      concept: { id: r.conceptId, title: titles.get(r.conceptId)?.title ?? r.conceptId },
      stageBefore: r.stageBefore,
      stageAfter: r.stageAfter,
      direction: rankOf(r.stageAfter) > rankOf(r.stageBefore) ? ('up' as const) : ('down' as const),
      scoreBefore: r.scoreBefore,
      scoreAfter: r.scoreAfter,
    }));

    const weeks = Array.from({ length: query.weeks }, (_, i) => {
      const weekStart = addDays(firstWeek, 7 * i);
      const mine = changes.filter((c) => weekStartOf(c.date) === weekStart);
      return {
        weekStart,
        promotions: mine.filter((c) => c.direction === 'up').length,
        demotions: mine.filter((c) => c.direction === 'down').length,
        concepts: new Set(mine.map((c) => c.concept.id)).size,
      };
    });
    return {
      date: today,
      weeks,
      recent: changes.slice(0, query.limit),
      totals: {
        promotions: changes.filter((c) => c.direction === 'up').length,
        demotions: changes.filter((c) => c.direction === 'down').length,
      },
    };
  }
}
