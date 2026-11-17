import {
  conceptReport,
  endOfLocalDay,
  initialConceptState,
  localDateOf,
  type EngineDeps,
} from '@proginone/learning-engine';
import type { ConceptTileView, MasteryOverview, StageCounts } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { loadConceptStates } from '../../db/user/learning-state.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { learnerContext } from '../practice/engine.ts';
import { activeMisconceptionsByConcept } from '../practice/signals.ts';
import { countCompleted, progressRows } from './course-progress-service.ts';

const emptyCounts = (): StageCounts => ({
  not_started: 0,
  introduced: 0,
  practicing: 0,
  proficient: 0,
  mastered: 0,
});

/**
 * `GET /mastery`: course progress and the concept map (ui-ux.md 대시보드, FR-DASH-01/02). Each
 * course lists its modules with their concepts in learning order and every concept's stage,
 * effective mastery, review marker, next review date and active misconceptions.
 */
export class MasteryService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #engine: EngineDeps;
  readonly #now: Clock;

  constructor(deps: { userDb: UserDb; content: ContentAccess; engine: EngineDeps; now: Clock }) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#engine = deps.engine;
    this.#now = deps.now;
  }

  get(): MasteryOverview {
    const now = this.#now();
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const endOfToday = endOfLocalDay(now, dayBoundary);
    const today = localDateOf(now, dayBoundary);
    const rows = progressRows(this.#userDb);
    const active = activeMisconceptionsByConcept(this.#engine, orm, learnerId, now);
    const mcTitles = repo.getMisconceptions(
      [...active.values()].flatMap((a) => [...a.confirmed, ...a.suspected]),
    );

    const courses = repo.listCourseIds().flatMap((courseId) => {
      const course = repo.getCourse(courseId);
      if (!course) return [];
      const concepts = repo.listCourseConcepts(courseId);
      const states = loadConceptStates(
        orm,
        learnerId,
        concepts.map((c) => c.id),
        this.#engine.fsrs,
      );
      const counts = emptyCounts();
      const tiles = new Map<string, ConceptTileView[]>();
      for (const concept of concepts) {
        const state = states.get(concept.id) ?? initialConceptState(concept.id);
        const report = conceptReport(this.#engine, state, now, dayBoundary);
        const memory = state.memory && !state.memory.suspended ? state.memory : null;
        const mc = active.get(concept.id);
        counts[state.mastery.stage] += 1;
        const tile: ConceptTileView = {
          id: concept.id,
          title: concept.title,
          importance: concept.importance,
          stage: state.mastery.stage,
          effective: report.effective,
          // Same as the review queue: a concept rated today is not due again today (D-029).
          reviewDue:
            (memory !== null &&
              memory.card.dueAt < endOfToday &&
              (memory.card.lastReviewAt === null ||
                localDateOf(memory.card.lastReviewAt, dayBoundary) !== today)) ||
            report.needsReview,
          nextReviewDate: memory ? localDateOf(memory.card.dueAt, dayBoundary) : null,
          misconceptions: [
            ...(mc?.confirmed ?? []).map((id) => ({ id, status: 'confirmed' as const })),
            ...(mc?.suspected ?? []).map((id) => ({ id, status: 'suspected' as const })),
          ].map((m) => ({ ...m, title: mcTitles.get(m.id)?.title ?? m.id })),
        };
        tiles.set(concept.moduleId, [...(tiles.get(concept.moduleId) ?? []), tile]);
      }
      const modules = course.modules.map((m) => ({
        id: m.id,
        title: m.title,
        // Same count as the course list and detail (D-083).
        lessons: countCompleted(m.lessons, rows),
        concepts: tiles.get(m.id) ?? [],
      }));
      return [
        {
          id: course.id,
          title: course.title,
          language: course.language,
          lessons: {
            total: modules.reduce((s, m) => s + m.lessons.total, 0),
            completed: modules.reduce((s, m) => s + m.lessons.completed, 0),
          },
          stageCounts: counts,
          modules,
        },
      ];
    });
    return { date: today, courses };
  }
}
