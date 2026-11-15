import {
  conceptReport,
  effectiveMastery,
  endOfLocalDay,
  initialConceptState,
  localDateOf,
  misconceptionStatusAt,
  type EngineDeps,
} from '@proginone/learning-engine';
import type { ConceptDetail, MasteryEvidenceView } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { listEvidence, loadConceptStates, recentReviews } from '../../db/user/learning-state.ts';
import { listObservationsForConcepts } from '../../db/user/misconceptions.ts';
import { activeAssessmentAttemptIds } from '../../db/user/practice-sets.ts';
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
        mdnUrl: concept.mdnUrl,
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
}
