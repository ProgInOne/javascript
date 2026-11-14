import type { EngineConfig, EngineDeps } from '../config.ts';
import { ENGINE_VERSION } from '../config.ts';
import type { PendingRating } from '../memory/rating.ts';
import { ratingForAttempt } from '../memory/rating.ts';
import type {
  AttemptFacts,
  AttemptId,
  ConceptId,
  ConceptMasteryState,
  ConceptState,
  EvidenceFact,
  ExerciseFacts,
  MasteryStage,
  Outcome,
} from '../types.ts';
import type { DayBoundary } from '../util/time.ts';
import { effectiveMastery } from './effective.ts';
import type { Factor, FactorKey } from './evidence.ts';
import { computeEvidence } from './evidence.ts';
import type { GateReport, GateResult, StageChangeReason } from './stage.ts';
import { decideStage, evaluateGates, nextGateStage, qualifyingFacts } from './stage.ts';
import { updateScore } from './update.ts';

/** `breakdown_json` of an `attempt` evidence row (see learning-engine.md#설명-가능성). */
export interface AttemptBreakdown {
  readonly v: 1;
  readonly engineVersion: string;
  readonly formula: 'ewma-v1';
  readonly observation: { readonly outcome: Outcome; readonly o: number };
  readonly factors: Readonly<Record<FactorKey, Factor>>;
  readonly weight: number;
  readonly step: number;
  readonly scoreBefore: number;
  readonly scoreAfter: number;
  readonly effectiveAfter: number;
  /** Persist as-is; the server passes it back through {@link ConceptState.history}. */
  readonly fact: EvidenceFact;
  /** Gate the learner works towards after this attempt (absent at `mastered`). */
  readonly gates: Partial<Record<'practicing' | 'proficient' | 'mastered', GateResult>>;
}

/** `breakdown_json` of a `stage_gate` evidence row. */
export interface StageGateBreakdown {
  readonly v: 1;
  readonly engineVersion: string;
  readonly reason: Exclude<StageChangeReason, 'unchanged'>;
  readonly effective: number;
  readonly gates: GateReport | null;
}

/** A `mastery_evidence` row without `id`/`learner_id` (the server adds those). */
export interface MasteryEvidenceRecord {
  readonly conceptId: ConceptId;
  readonly attemptId: AttemptId | null;
  readonly kind: 'attempt' | 'stage_gate';
  readonly scoreBefore: number;
  readonly scoreAfter: number;
  readonly stageBefore: MasteryStage;
  readonly stageAfter: MasteryStage;
  readonly breakdown: AttemptBreakdown | StageGateBreakdown;
  readonly createdAt: number;
}

/** New `concept_mastery` row. Write `after` with `updated_at = now`. */
export interface MasteryUpdate {
  readonly conceptId: ConceptId;
  readonly before: ConceptMasteryState;
  readonly after: ConceptMasteryState;
  readonly engineVersion: string;
}

export interface AttemptEffects {
  readonly mastery: readonly MasteryUpdate[];
  readonly evidence: readonly MasteryEvidenceRecord[];
  /** Primary concept only. Merge and apply with `flushPendingRatings`. */
  readonly pendingRatings: readonly PendingRating[];
}

export interface ApplyAttemptInput {
  readonly attempt: AttemptFacts;
  readonly exercise: ExerciseFacts;
  /** Current state of the tagged concepts. Missing concepts start from `not_started`. */
  readonly concepts: readonly ConceptState[];
  readonly now: number;
  readonly dayBoundary: DayBoundary;
}

export function initialMasteryState(conceptId: ConceptId): ConceptMasteryState {
  return {
    conceptId,
    score: 0,
    stage: 'not_started',
    evidenceWeightSum: 0,
    distinctTypesCorrect: [],
    maxDifficultyCorrect: 0,
    consecutiveFailures: 0,
    lastAttemptAt: null,
    stageChangedAt: null,
  };
}

export function initialConceptState(conceptId: ConceptId): ConceptState {
  return { mastery: initialMasteryState(conceptId), history: [], reviews: [], memory: null };
}

/** Gate report for the stage after `stage`, in breakdown form. */
export function nextGateBreakdown(
  stage: MasteryStage,
  gates: GateReport,
): AttemptBreakdown['gates'] {
  const next = nextGateStage(stage);
  return next === null ? {} : { [next]: gates[next] };
}

function stageGateRecord(
  conceptId: ConceptId,
  attemptId: AttemptId | null,
  before: ConceptMasteryState,
  after: ConceptMasteryState,
  reason: Exclude<StageChangeReason, 'unchanged'>,
  effective: number,
  gates: GateReport | null,
  now: number,
): MasteryEvidenceRecord {
  return {
    conceptId,
    attemptId,
    kind: 'stage_gate',
    scoreBefore: before.score,
    scoreAfter: after.score,
    stageBefore: before.stage,
    stageAfter: after.stage,
    breakdown: { v: 1, engineVersion: ENGINE_VERSION, reason, effective, gates },
    createdAt: now,
  };
}

/**
 * Re-evaluates the stage of a concept without a new attempt (e.g. after FSRS reviews).
 * Only promotes; see {@link decideStage}.
 */
export function reevaluateStage(
  deps: EngineDeps,
  state: ConceptState,
  now: number,
  dayBoundary: DayBoundary,
): { update: MasteryUpdate | null; evidence: MasteryEvidenceRecord | null } {
  const { config } = deps;
  const before = state.mastery;
  const { effective } = effectiveMastery(deps, before.score, state.memory, now);
  const gates = evaluateGates(config, {
    effective,
    evidenceWeightSum: before.evidenceWeightSum,
    history: state.history,
    reviews: state.reviews,
    dayBoundary,
  });
  // Without an attempt, `not_started` has nothing to introduce it.
  if (before.stage === 'not_started') return { update: null, evidence: null };
  // Promotion only: without an attempt, time passing must not demote.
  const decision = decideStage(config, before.stage, effective, gates, { allowDemotion: false });
  if (decision.reason === 'unchanged') return { update: null, evidence: null };
  const after: ConceptMasteryState = { ...before, stage: decision.stage, stageChangedAt: now };
  return {
    update: { conceptId: before.conceptId, before, after, engineVersion: ENGINE_VERSION },
    evidence: stageGateRecord(
      before.conceptId,
      null,
      before,
      after,
      decision.reason,
      effective,
      gates,
      now,
    ),
  };
}

function nextMasteryCounters(
  config: EngineConfig,
  before: ConceptMasteryState,
  fact: EvidenceFact,
  scoreAfter: number,
  now: number,
): ConceptMasteryState {
  const qualifies = qualifyingFacts(config, [fact]).length === 1;
  let consecutiveFailures = before.consecutiveFailures;
  if (fact.isPrimary) {
    if (fact.correct && fact.unassisted) consecutiveFailures = 0;
    else if (!fact.correct) consecutiveFailures += 1;
  }
  return {
    ...before,
    score: scoreAfter,
    evidenceWeightSum: before.evidenceWeightSum + fact.weight,
    distinctTypesCorrect:
      qualifies && !before.distinctTypesCorrect.includes(fact.exerciseType)
        ? [...before.distinctTypesCorrect, fact.exerciseType]
        : before.distinctTypesCorrect,
    maxDifficultyCorrect: qualifies
      ? Math.max(before.maxDifficultyCorrect, fact.difficulty)
      : before.maxDifficultyCorrect,
    consecutiveFailures,
    lastAttemptAt: now,
  };
}

/**
 * Applies one graded attempt: evidence, score, stage per tagged concept, plus the pending FSRS
 * rating of the primary concept. FSRS cards are not touched here.
 */
export function applyAttempt(deps: EngineDeps, input: ApplyAttemptInput): AttemptEffects {
  const { config } = deps;
  const { attempt, exercise, now, dayBoundary } = input;
  const byId = new Map(input.concepts.map((state) => [state.mastery.conceptId, state]));
  const mastery: MasteryUpdate[] = [];
  const evidence: MasteryEvidenceRecord[] = [];
  const pendingRatings: PendingRating[] = [];

  for (const tag of exercise.concepts) {
    const state = byId.get(tag.conceptId) ?? initialConceptState(tag.conceptId);
    const before = state.mastery;
    const ev = computeEvidence(config, { attempt, exercise, tag, history: state.history, now });
    const { step, score } = updateScore(config, before.score, ev.o, ev.weight);
    const fact: EvidenceFact = {
      attemptId: attempt.attemptId,
      at: attempt.submittedAt,
      exerciseId: exercise.id,
      exerciseType: exercise.type,
      difficulty: exercise.difficulty,
      variantGroupKey: exercise.variantGroupKey,
      isPrimary: tag.isPrimary,
      correct: ev.correct,
      credit: ev.credit,
      unassisted: ev.unassisted,
      setKind: attempt.setKind,
      weight: ev.weight,
    };
    const counted = nextMasteryCounters(config, before, fact, score, now);
    const { effective } = effectiveMastery(deps, score, state.memory, now);
    const gates = evaluateGates(config, {
      effective,
      evidenceWeightSum: counted.evidenceWeightSum,
      history: [...state.history, fact],
      reviews: state.reviews,
      dayBoundary,
    });
    const decision = decideStage(config, before.stage, effective, gates, {
      allowDemotion: score < before.score,
    });
    const after: ConceptMasteryState =
      decision.reason === 'unchanged'
        ? counted
        : { ...counted, stage: decision.stage, stageChangedAt: now };

    mastery.push({ conceptId: tag.conceptId, before, after, engineVersion: ENGINE_VERSION });
    evidence.push({
      conceptId: tag.conceptId,
      attemptId: attempt.attemptId,
      kind: 'attempt',
      scoreBefore: before.score,
      scoreAfter: score,
      stageBefore: before.stage,
      stageAfter: after.stage,
      breakdown: {
        v: 1,
        engineVersion: ENGINE_VERSION,
        formula: 'ewma-v1',
        observation: { outcome: ev.outcome, o: ev.o },
        factors: ev.factors,
        weight: ev.weight,
        step,
        scoreBefore: before.score,
        scoreAfter: score,
        effectiveAfter: effective,
        fact,
        gates: nextGateBreakdown(after.stage, gates),
      },
      createdAt: now,
    });
    if (decision.reason !== 'unchanged') {
      evidence.push(
        stageGateRecord(
          tag.conceptId,
          attempt.attemptId,
          before,
          after,
          decision.reason,
          effective,
          gates,
          now,
        ),
      );
    }
    if (tag.isPrimary) {
      pendingRatings.push({
        conceptId: tag.conceptId,
        rating: ratingForAttempt(attempt, exercise),
        attemptId: attempt.attemptId,
        variantGroupKey: exercise.variantGroupKey,
        at: attempt.submittedAt,
      });
    }
  }
  return { mastery, evidence, pendingRatings };
}

/**
 * Lesson body read to the end: concepts the lesson introduces move from `not_started` to
 * `introduced`. Other stages are left alone.
 */
export function applyLessonRead(
  _deps: EngineDeps,
  input: { readonly concepts: readonly ConceptState[]; readonly now: number },
): { mastery: MasteryUpdate[]; evidence: MasteryEvidenceRecord[] } {
  const mastery: MasteryUpdate[] = [];
  const evidence: MasteryEvidenceRecord[] = [];
  for (const state of input.concepts) {
    const before = state.mastery;
    if (before.stage !== 'not_started') continue;
    const after: ConceptMasteryState = {
      ...before,
      stage: 'introduced',
      stageChangedAt: input.now,
    };
    mastery.push({ conceptId: before.conceptId, before, after, engineVersion: ENGINE_VERSION });
    evidence.push(
      stageGateRecord(
        before.conceptId,
        null,
        before,
        after,
        'introduced_by_reading',
        before.score,
        null,
        input.now,
      ),
    );
  }
  return { mastery, evidence };
}
