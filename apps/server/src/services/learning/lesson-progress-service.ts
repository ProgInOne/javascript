import { applyLessonRead, initialConceptState, type EngineDeps } from '@proginone/learning-engine';
import type { LessonProgress, LessonProgressRequest } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { insertEvidence, loadConceptStates, upsertMastery } from '../../db/user/learning-state.ts';
import { getLessonProgress, upsertLessonProgress } from '../../db/user/progress.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { learnerContext } from '../practice/engine.ts';

export interface LessonProgressServiceDeps {
  userDb: UserDb;
  content: ContentAccess;
  engine: EngineDeps;
  now: Clock;
}

/** Reading position and progress of a lesson (`lesson_progress`). */
export class LessonProgressService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #engine: EngineDeps;
  readonly #now: Clock;

  constructor(deps: LessonProgressServiceDeps) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#engine = deps.engine;
    this.#now = deps.now;
  }

  /**
   * Records reading progress. The first visit starts the lesson (`reading`) and applies
   * `applyLessonRead`: the concepts it introduces move from `not_started` to `introduced`
   * (no FSRS card yet; that waits for practice). Later calls keep the furthest progress and
   * never move a practicing or completed lesson back.
   */
  record(lessonId: string, request: LessonProgressRequest): LessonProgress {
    const repo = this.#content.repo;
    const orm = this.#userDb.orm;
    const lesson = repo.getLessonPlan(lessonId);
    if (!lesson) {
      throw new AppError('NOT_FOUND', 404, '단원을 찾을 수 없습니다.', {
        details: { id: lessonId },
      });
    }
    const now = this.#now();
    const { learnerId } = learnerContext(this.#userDb);
    const progress = getLessonProgress(orm, learnerId, lessonId);
    const firstVisit = progress === null || progress.status === 'not_started';

    const read = firstVisit
      ? applyLessonRead(this.#engine, {
          concepts: (() => {
            const states = loadConceptStates(orm, learnerId, lesson.introduces, this.#engine.fsrs);
            return lesson.introduces.map((id) => states.get(id) ?? initialConceptState(id));
          })(),
          now,
        })
      : { mastery: [], evidence: [] };

    const row = {
      learnerId,
      lessonId,
      status: progress === null || firstVisit ? ('reading' as const) : progress.status,
      lastSectionId:
        request.lastSectionId === undefined
          ? (progress?.lastSectionId ?? null)
          : request.lastSectionId,
      readProgress: Math.max(progress?.readProgress ?? 0, request.readProgress),
      practiceSetId: progress?.practiceSetId ?? null,
      startedAt: progress?.startedAt ?? new Date(now),
      completedAt: progress?.completedAt ?? null,
      contentHashSeen: lesson.contentHash,
      updatedAt: new Date(now),
    };
    orm.transaction(() => {
      upsertLessonProgress(orm, row);
      for (const update of read.mastery) upsertMastery(orm, learnerId, update, now);
      for (const record of read.evidence) insertEvidence(orm, learnerId, record);
    });

    const titles = repo.getConcepts(read.mastery.map((m) => m.conceptId));
    return {
      lessonId,
      status: row.status,
      readProgress: row.readProgress,
      lastSectionId: row.lastSectionId,
      practiceSetId: row.practiceSetId,
      startedAt: row.startedAt.getTime(),
      completedAt: row.completedAt?.getTime() ?? null,
      introducedConcepts: read.mastery.map((m) => ({
        id: m.conceptId,
        title: titles.get(m.conceptId)?.title ?? m.conceptId,
      })),
    };
  }
}
