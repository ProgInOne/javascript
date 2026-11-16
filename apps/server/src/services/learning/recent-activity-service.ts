import { localDateOf } from '@proginone/learning-engine';
import { recentActivityQuerySchema, type RecentActivityList } from '@proginone/shared';
import type { z } from 'zod';
import type { UserDb } from '../../db/user/connection.ts';
import { listRecentLessonCompletions, listRecentSets } from '../../db/user/recent-activity.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { learnerContext } from '../practice/engine.ts';

/** A lesson completed within this long of a passed lesson set is shown on that set's row. */
const SAME_EVENT_MS = 5_000;

/**
 * `GET /activity/recent` (FR-DASH-01 "최근 활동", ui-ux.md 대시보드, D-061): the latest practice
 * sets and completed lessons, derived from the learning records. One row per practice set (a
 * learning "session" in the learner's terms: lesson practice, review, weakness, assessment, …);
 * a passed lesson set carries its lesson's completion, and lessons completed without a set row
 * (project units) get their own row. An assessment still in progress shows only how many items
 * were answered (learning-engine.md#단원-평가-세트).
 */
export class RecentActivityService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #now: Clock;

  constructor(deps: { userDb: UserDb; content: ContentAccess; now: Clock }) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#now = deps.now;
  }

  list(rawQuery: z.input<typeof recentActivityQuerySchema> = {}): RecentActivityList {
    const { limit } = recentActivityQuerySchema.parse(rawQuery);
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const sets = listRecentSets(orm, learnerId, limit);
    const lessons = listRecentLessonCompletions(orm, learnerId, limit);

    const lessonIds = new Set<string>();
    for (const s of sets) if (s.lessonId) lessonIds.add(s.lessonId);
    for (const l of lessons) lessonIds.add(l.lessonId);
    const lessonTitle = new Map<string, string>();
    for (const id of lessonIds) {
      const title = repo.getLessonPlan(id)?.title;
      if (title) lessonTitle.set(id, title);
    }
    const conceptTitles = repo.getConcepts([...new Set(sets.flatMap((s) => s.conceptIds))]);

    const covered = new Set<string>();
    const items: RecentActivityList['items'] = sets.map((s) => {
      const withheld = s.kind === 'assessment' && s.status === 'active';
      const completion =
        s.kind === 'lesson' && s.lessonPassed && s.lessonId !== null && s.completedAt !== null
          ? lessons.find(
              (l) =>
                l.lessonId === s.lessonId &&
                Math.abs(l.completedAt - (s.completedAt ?? 0)) <= SAME_EVENT_MS,
            )
          : undefined;
      if (completion) covered.add(completion.lessonId);
      const title = s.lessonId ? lessonTitle.get(s.lessonId) : undefined;
      const conceptIds = s.lessonId ? [] : s.conceptIds;
      return {
        type: 'practice' as const,
        id: s.id,
        at: s.at,
        date: localDateOf(s.at, dayBoundary),
        setKind: s.kind,
        status: s.status,
        lesson: s.lessonId ? { id: s.lessonId, title: title ?? s.lessonId } : null,
        concepts: conceptIds.slice(0, 3).map((id) => ({
          id,
          title: conceptTitles.get(id)?.title ?? id,
        })),
        conceptCount: conceptIds.length,
        total: s.total,
        answered: s.answered,
        correct: withheld ? null : s.correct,
        stageUps: withheld ? null : s.stageUps,
        lessonCompleted: completion !== undefined,
        assessment: withheld ? null : s.assessment,
      };
    });
    for (const l of lessons) {
      if (covered.has(l.lessonId)) continue;
      items.push({
        type: 'lesson',
        id: l.lessonId,
        at: l.completedAt,
        date: localDateOf(l.completedAt, dayBoundary),
        lesson: { id: l.lessonId, title: lessonTitle.get(l.lessonId) ?? l.lessonId },
      });
    }
    items.sort((a, b) => b.at - a.at);
    return { date: localDateOf(this.#now(), dayBoundary), items: items.slice(0, limit) };
  }
}
