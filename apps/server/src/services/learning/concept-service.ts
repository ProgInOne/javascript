import {
  assessPrerequisite,
  conceptReport,
  effectiveMastery,
  endOfLocalDay,
  initialConceptState,
  localDateOf,
  misconceptionStatusAt,
  type EngineDeps,
} from '@proginone/learning-engine';
import type {
  ConceptDetail,
  CoursePrerequisiteWarnings,
  LessonPrerequisite,
  LessonPrerequisites,
  MasteryEvidenceView,
} from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { listEvidence, loadConceptStates, recentReviews } from '../../db/user/learning-state.ts';
import { listObservationsForConcepts } from '../../db/user/misconceptions.ts';
import { activeAssessmentAttemptIds } from '../../db/user/practice-sets.ts';
import { listLessonStatuses } from '../../db/user/progress.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { learnerContext } from '../practice/engine.ts';
import { resolutionOf } from '../practice/signals.ts';

export const DEFAULT_EVIDENCE_LIMIT = 20;
const REVIEWS_SHOWN = 10;

type Breakdown = ReturnType<typeof listEvidence>['rows'][number]['breakdown'];

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Explanation fields of a stored breakdown (loosely typed: older engine versions may differ). */
function explain(
  b: Breakdown,
): Pick<MasteryEvidenceView, 'observation' | 'weight' | 'factors' | 'reason'> {
  const obs = b['observation'] as { outcome?: unknown; o?: unknown } | undefined;
  const outcome = obs?.outcome;
  const factors = b['factors'];
  return {
    observation:
      obs &&
      (outcome === 'correct' ||
        outcome === 'partial' ||
        outcome === 'incorrect' ||
        outcome === 'error')
        ? { outcome, o: num(obs.o) ?? 0 }
        : null,
    weight: num(b['weight']),
    factors:
      factors && typeof factors === 'object'
        ? Object.fromEntries(
            Object.entries(factors as Record<string, { value?: unknown; why?: unknown }>).map(
              ([key, f]) => [
                key,
                { value: num(f.value) ?? 0, why: typeof f.why === 'string' ? f.why : '' },
              ],
            ),
          )
        : null,
    reason: typeof b['reason'] === 'string' ? b['reason'] : null,
  };
}

/**
 * `GET /concepts/:id`: the concept detail sheet (ui-ux.md 개념 상세, FR-DASH-02) — stage and
 * effective mastery now, what the next stage still needs, the evidence behind the score,
 * the next review, prerequisites, misconceptions and related lessons.
 */
export class ConceptService {
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

  get(id: string, evidenceLimit = DEFAULT_EVIDENCE_LIMIT): ConceptDetail {
    const now = this.#now();
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const engine = this.#engine;
    const concept = repo.getConceptDetail(id);
    if (!concept) {
      throw new AppError('NOT_FOUND', 404, '개념을 찾을 수 없습니다.', { details: { id } });
    }
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const edges = repo.listPrerequisites().filter((e) => e.conceptId === id);
    const states = loadConceptStates(
      orm,
      learnerId,
      [id, ...edges.map((e) => e.prerequisiteId)],
      engine.fsrs,
    );
    const state = states.get(id) ?? initialConceptState(id);
    const report = conceptReport(engine, state, now, dayBoundary);
    const m = state.mastery;
    const memory = state.memory;
    const listed = listEvidence(orm, learnerId, id, evidenceLimit);
    // Per-attempt evidence of an assessment in progress would reveal its results early
    // (learning-engine.md#단원-평가-세트); it appears once the assessment ends.
    const withheld = activeAssessmentAttemptIds(orm, learnerId);
    const shown = listed.rows.filter((r) => r.attemptId === null || !withheld.has(r.attemptId));
    const evidence = { rows: shown, total: listed.total - (listed.rows.length - shown.length) };
    const titles = repo.getConcepts(edges.map((e) => e.prerequisiteId));
    const observations = listObservationsForConcepts(orm, learnerId, [id]);
    const mcTitles = repo.getMisconceptions(observations.map((o) => o.state.misconceptionId));

    return {
      concept: {
        id: concept.id,
        title: concept.title,
        summary: concept.summary,
        importance: concept.importance,
        course: concept.course,
        mdnUrl: concept.docUrl,
      },
      mastery: {
        stage: m.stage,
        score: m.score,
        effective: report.effective,
        decay: report.decay,
        retrievability: report.retrievability,
        needsReview: report.needsReview,
        evidenceWeightSum: m.evidenceWeightSum,
        consecutiveFailures: m.consecutiveFailures,
        lastAttemptAt: m.lastAttemptAt,
        stageChangedAt: m.stageChangedAt,
      },
      nextStage: report.nextStage
        ? {
            stage: report.nextStage.stage,
            met: report.nextStage.met,
            missing: report.nextStage.missing.map((s) => ({ ...s })),
          }
        : null,
      memory: memory
        ? {
            dueAt: memory.card.dueAt,
            dueDate: localDateOf(memory.card.dueAt, dayBoundary),
            dueToday: !memory.suspended && memory.card.dueAt < endOfLocalDay(now, dayBoundary),
            lastReviewAt: memory.card.lastReviewAt,
            state: memory.card.state,
            reps: memory.card.reps,
            lapses: memory.card.lapses,
            suspended: memory.suspended,
          }
        : null,
      evidence: evidence.rows.map((row) => {
        const fact = row.breakdown.fact;
        return {
          id: row.id,
          createdAt: row.createdAt.getTime(),
          kind: row.kind,
          attemptId: row.attemptId,
          scoreBefore: row.scoreBefore,
          scoreAfter: row.scoreAfter,
          stageBefore: row.stageBefore,
          stageAfter: row.stageAfter,
          exercise: fact
            ? { id: fact.exerciseId, type: fact.exerciseType, difficulty: fact.difficulty }
            : null,
          ...explain(row.breakdown),
        };
      }),
      evidenceTotal: evidence.total,
      reviews: recentReviews(orm, learnerId, id, REVIEWS_SHOWN),
      prerequisites: edges.map((e) => {
        const s = states.get(e.prerequisiteId) ?? initialConceptState(e.prerequisiteId);
        return {
          concept: {
            id: e.prerequisiteId,
            title: titles.get(e.prerequisiteId)?.title ?? e.prerequisiteId,
          },
          strength: e.strength,
          stage: s.mastery.stage,
          effective: effectiveMastery(engine, s.mastery.score, s.memory, now).effective,
        };
      }),
      misconceptions: observations.map(({ state: o, aiDescription }) => {
        const status = misconceptionStatusAt(engine.config, o, now);
        return {
          id: o.misconceptionId,
          title: mcTitles.get(o.misconceptionId)?.title ?? aiDescription ?? o.misconceptionId,
          status,
          source: o.source,
          firstSeenAt: o.firstSeenAt,
          lastSeenAt: o.lastSeenAt,
          confirmCount: o.confirmCount,
          resolution: resolutionOf(engine, { ...o, status }),
        };
      }),
      lessons: concept.lessons,
    };
  }

  /**
   * `GET /lessons/:id/prerequisites` (FR-CUR-02, FR-CUR-05): the direct prerequisites of the
   * concepts the lesson introduces (`required` first, then `helpful`), then the concepts the lesson
   * reviews, minus what the lesson itself introduces — each with the learner's mastery. A weak
   * `required` prerequisite (the relearning rule: `effective < 60` or below `practicing`) is a
   * warning; the screen never locks (learning-engine.md#재학습-규칙).
   */
  lessonPrerequisites(lessonId: string): LessonPrerequisites {
    const repo = this.#content.repo;
    const lesson = repo.getLessonPlan(lessonId);
    if (!lesson || !repo.getLesson(lessonId)) {
      throw new AppError('NOT_FOUND', 404, '단원을 찾을 수 없습니다.', {
        details: { id: lessonId },
      });
    }
    const own = new Set(lesson.introduces);
    const entries = new Map<string, LessonPrerequisite['strength']>();
    const edges = repo.listPrerequisites().filter((e) => own.has(e.conceptId));
    for (const strength of ['required', 'helpful'] as const) {
      for (const e of edges) {
        if (e.strength !== strength || own.has(e.prerequisiteId)) continue;
        if (!entries.has(e.prerequisiteId)) entries.set(e.prerequisiteId, strength);
      }
    }
    for (const id of lesson.reviews) {
      if (!own.has(id) && !entries.has(id)) entries.set(id, 'reviewed');
    }
    const ids = [...entries.keys()];
    const concepts = repo.getConceptsWithLesson(ids);
    const now = this.#now();
    const { learnerId } = learnerContext(this.#userDb);
    const states = loadConceptStates(this.#userDb.orm, learnerId, ids, this.#engine.fsrs);
    const prerequisites = ids.flatMap((id): LessonPrerequisite[] => {
      const concept = concepts.get(id);
      if (!concept) return [];
      const state = states.get(id);
      const readiness = assessPrerequisite(this.#engine, state ?? initialConceptState(id), now);
      return [
        {
          concept: { id, title: concept.title, summary: concept.summary },
          strength: entries.get(id) ?? 'reviewed',
          stage: readiness.stage,
          effective: readiness.effective,
          weak: readiness.weak,
          practiced: state !== undefined && state.mastery.lastAttemptAt !== null,
          lesson: concept.lesson && concept.lesson.id !== lessonId ? concept.lesson : null,
        },
      ];
    });
    return {
      lessonId,
      prerequisites,
      warnings: prerequisites
        .filter((p) => p.strength === 'required' && p.weak)
        .map((p) => p.concept.id),
    };
  }

  /**
   * `GET /courses/:id/prerequisite-warnings` (FR-CUR-05, D-073): the course detail's `!` icons.
   * Same rule as the lesson warning (D-052: weak direct `required` prerequisites of the concepts
   * a lesson introduces), but only for lessons not completed yet, and only once the learner has
   * started the course — for a new learner every lesson after the first would carry the icon.
   */
  coursePrerequisiteWarnings(courseId: string): CoursePrerequisiteWarnings {
    const repo = this.#content.repo;
    if (!repo.listCourseIds().includes(courseId)) {
      throw new AppError('NOT_FOUND', 404, '과정을 찾을 수 없습니다.', {
        details: { id: courseId },
      });
    }
    // Assessments and projects introduce no concepts, so they never warn (D-052).
    const lessons = repo.listCourseLessons(courseId, ['lesson']);
    const { learnerId } = learnerContext(this.#userDb);
    const statuses = listLessonStatuses(
      this.#userDb.orm,
      learnerId,
      repo.listCourseLessons(courseId, ['lesson', 'assessment', 'project']).map((l) => l.id),
    );
    const started = [...statuses.values()].some((s) => s !== 'not_started');
    if (!started) return { courseId, lessons: [] };

    const edges = repo.listPrerequisites();
    const perLesson = lessons
      .filter((l) => statuses.get(l.id) !== 'completed')
      .map((l) => {
        const own = new Set(repo.getLessonPlan(l.id)?.introduces ?? []);
        const required = new Set(
          edges
            .filter(
              (e) =>
                e.strength === 'required' && own.has(e.conceptId) && !own.has(e.prerequisiteId),
            )
            .map((e) => e.prerequisiteId),
        );
        return { lessonId: l.id, required: [...required] };
      })
      .filter((l) => l.required.length > 0);
    const ids = [...new Set(perLesson.flatMap((l) => l.required))];
    const concepts = repo.getConceptsWithLesson(ids);
    const states = loadConceptStates(this.#userDb.orm, learnerId, ids, this.#engine.fsrs);
    const now = this.#now();
    const weak = new Set(
      ids.filter(
        (id) =>
          assessPrerequisite(this.#engine, states.get(id) ?? initialConceptState(id), now).weak,
      ),
    );
    return {
      courseId,
      lessons: perLesson.flatMap((l) => {
        const list = l.required.flatMap((id) => {
          const concept = concepts.get(id);
          if (!concept || !weak.has(id)) return [];
          const lesson = concept.lesson && concept.lesson.id !== l.lessonId ? concept.lesson : null;
          return [{ id, title: concept.title, lesson }];
        });
        return list.length > 0 ? [{ lessonId: l.lessonId, concepts: list }] : [];
      }),
    };
  }
}
