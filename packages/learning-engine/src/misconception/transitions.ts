import type { EngineConfig } from '../config.ts';
import type { AttemptId, ConceptId, Confidence, ExerciseId } from '../types.ts';
import type { DayBoundary } from '../util/time.ts';
import { daysBetween, localDateOf } from '../util/time.ts';

/**
 * Misconception observations (learning-engine.md#오개념-상태-전이, FR-LRN-06).
 *
 * ```text
 * [new] → suspected   chosen wrong option / matched pattern that points to the misconception
 * suspected → confirmed  more evidence from a different exercise within 30 days, or `sure`
 * suspected → dismissed  30 days without evidence, or 2 first-try correct targeted answers
 * confirmed → resolved   2 first-try correct targeted answers ≥ 1 local day apart, no new
 *                        evidence in between
 * resolved → confirmed   new evidence (relapse)
 * dismissed → suspected  new evidence
 * ```
 *
 * There is no stored "resolving" status: progress towards `resolved` is the list of qualifying
 * targeted answers since the last evidence ({@link MisconceptionState.resolution}).
 */

export const MISCONCEPTION_STATUSES = ['suspected', 'confirmed', 'resolved', 'dismissed'] as const;
export type MisconceptionStatus = (typeof MISCONCEPTION_STATUSES)[number];
export const MISCONCEPTION_SOURCES = ['distractor', 'pattern', 'ai'] as const;
/** `distractor`: chosen wrong option · `pattern`: rule-based wrong-answer pattern · `ai`: proposal. */
export type MisconceptionSource = (typeof MISCONCEPTION_SOURCES)[number];

/** Prefix of AI-proposed, unclassified misconceptions (`ai.<ULID>`): tutor context only. */
export const AI_MISCONCEPTION_PREFIX = 'ai.';

/** One evidence attempt (`evidence_attempt_ids_json`, joined with `attempts`). */
export interface MisconceptionEvidence {
  readonly attemptId: AttemptId;
  readonly exerciseId: ExerciseId;
  readonly at: number;
  readonly source: MisconceptionSource;
}

/** A first-try, unassisted correct answer on a targeted exercise since the last evidence. */
export interface ResolutionStep {
  readonly attemptId: AttemptId;
  readonly at: number;
}

/** One `misconception_observations` row (the learner's current view of a misconception). */
export interface MisconceptionState {
  readonly misconceptionId: string;
  readonly conceptId: ConceptId;
  readonly status: MisconceptionStatus;
  /** Source of the first evidence. */
  readonly source: MisconceptionSource;
  /** All evidence, oldest first. Never empty (FR-AI-09). */
  readonly evidence: readonly MisconceptionEvidence[];
  /** `resolution_attempt_ids_json`: progress towards `resolved`/`dismissed`. */
  readonly resolution: readonly ResolutionStep[];
  /** Times the observation entered `confirmed` (including relapses). */
  readonly confirmCount: number;
  readonly firstSeenAt: number;
  /** Time of the latest evidence. */
  readonly lastSeenAt: number;
  readonly resolvedAt: number | null;
}

/** What one attempt says about misconceptions. */
export interface MisconceptionAttempt {
  readonly attemptId: AttemptId;
  readonly exerciseId: ExerciseId;
  readonly at: number;
  /** Observation `o ≥ 0.5`. */
  readonly correct: boolean;
  /** First try in the item, no hint, solution or tutor. */
  readonly unassisted: boolean;
  readonly confidence: Confidence | null;
  /**
   * Misconceptions the learner's wrong answer points to (grader `misconceptionIds`), with the
   * concept and the kind of evidence. Ignored when the answer is correct.
   */
  readonly observed: readonly {
    readonly misconceptionId: string;
    readonly conceptId: ConceptId;
    readonly source: Exclude<MisconceptionSource, 'ai'>;
  }[];
  /**
   * Misconceptions this exercise targets: listed in `misconceptions.remedial_exercise_ids_json`,
   * or one of its wrong options/patterns points to the misconception.
   */
  readonly targets: readonly string[];
}

export type MisconceptionTransition =
  | 'observed'
  | 'evidence_added'
  | 'confirmed'
  | 'reopened'
  | 'relapsed'
  | 'resolution_progress'
  | 'resolved'
  | 'dismissed_by_targets'
  | 'dismissed_expired';

/** A row to insert (`before === null`) or update. */
export interface MisconceptionUpdate {
  readonly misconceptionId: string;
  readonly conceptId: ConceptId;
  readonly before: MisconceptionState | null;
  readonly after: MisconceptionState;
  /** Transitions in the order they happened (an expiry can precede a new observation). */
  readonly transitions: readonly MisconceptionTransition[];
}

export function isActiveMisconception(status: MisconceptionStatus): boolean {
  return status === 'suspected' || status === 'confirmed';
}

/** AI-proposed rows are kept for the tutor only: never confirmed, never targeted. */
export function isAiMisconception(misconceptionId: string): boolean {
  return misconceptionId.startsWith(AI_MISCONCEPTION_PREFIX);
}

/**
 * Status at `now` with time-based rules applied: a `suspected` observation without evidence for
 * `dismissAfterDays` reads as `dismissed`. Reads use this without writing; the next attempt that
 * touches the row persists the transition.
 */
export function misconceptionStatusAt(
  config: EngineConfig,
  state: MisconceptionState,
  now: number,
): MisconceptionStatus {
  return expired(config, state, now) ? 'dismissed' : state.status;
}

function expired(config: EngineConfig, state: MisconceptionState, now: number): boolean {
  return (
    state.status === 'suspected' && now - state.lastSeenAt >= config.misconception.dismissAfterMs
  );
}

function canConfirm(misconceptionId: string): boolean {
  return !isAiMisconception(misconceptionId);
}

/**
 * Applies one attempt to the learner's misconception observations. Evidence takes precedence:
 * an exercise that both targets a misconception and is answered with that misconception's wrong
 * option counts as evidence only.
 */
export function updateMisconceptions(
  config: EngineConfig,
  input: {
    readonly attempt: MisconceptionAttempt;
    /** Current rows for the observed and targeted misconceptions (others are ignored). */
    readonly states: readonly MisconceptionState[];
    readonly now: number;
    readonly dayBoundary: DayBoundary;
  },
): MisconceptionUpdate[] {
  const { attempt, now, dayBoundary } = input;
  const byId = new Map(input.states.map((s) => [s.misconceptionId, s]));
  const updates: MisconceptionUpdate[] = [];
  const evidenceIds = new Set<string>();

  if (!attempt.correct) {
    for (const observed of attempt.observed) {
      if (evidenceIds.has(observed.misconceptionId)) continue;
      evidenceIds.add(observed.misconceptionId);
      const before = byId.get(observed.misconceptionId) ?? null;
      const evidence: MisconceptionEvidence = {
        attemptId: attempt.attemptId,
        exerciseId: attempt.exerciseId,
        at: attempt.at,
        source: observed.source,
      };
      updates.push(
        addEvidence(config, before, {
          misconceptionId: observed.misconceptionId,
          conceptId: observed.conceptId,
          evidence,
          sure: attempt.confidence === 'sure',
          now,
        }),
      );
    }
  }

  if (attempt.correct && attempt.unassisted) {
    for (const id of new Set(attempt.targets)) {
      if (evidenceIds.has(id)) continue;
      const before = byId.get(id);
      if (before === undefined) continue;
      const update = addResolutionStep(config, before, attempt, now, dayBoundary);
      if (update !== null) updates.push(update);
    }
  }
  return updates;
}

function addEvidence(
  config: EngineConfig,
  before: MisconceptionState | null,
  input: {
    misconceptionId: string;
    conceptId: ConceptId;
    evidence: MisconceptionEvidence;
    sure: boolean;
    now: number;
  },
): MisconceptionUpdate {
  const { misconceptionId, conceptId, evidence, sure, now } = input;
  const transitions: MisconceptionTransition[] = [];
  const confirmable = canConfirm(misconceptionId);

  if (before === null) {
    const status: MisconceptionStatus = sure && confirmable ? 'confirmed' : 'suspected';
    transitions.push(status === 'confirmed' ? 'confirmed' : 'observed');
    return {
      misconceptionId,
      conceptId,
      before: null,
      after: {
        misconceptionId,
        conceptId,
        status,
        source: evidence.source,
        evidence: [evidence],
        resolution: [],
        confirmCount: status === 'confirmed' ? 1 : 0,
        firstSeenAt: evidence.at,
        lastSeenAt: evidence.at,
        resolvedAt: null,
      },
      transitions,
    };
  }

  let status = before.status;
  if (expired(config, before, now)) {
    status = 'dismissed';
    transitions.push('dismissed_expired');
  }
  // Evidence that confirms a suspicion: `sure`, or a different exercise within the window. An
  // AI proposal alone never confirms; distractor/pattern evidence must back it.
  const backed = before.evidence.filter((e) => e.source !== 'ai');
  const lastBacked = backed.at(-1);
  const fromOtherExercise =
    lastBacked !== undefined &&
    evidence.at - lastBacked.at <= config.misconception.confirmWindowMs &&
    !backed.some((e) => e.exerciseId === evidence.exerciseId);

  let next: MisconceptionStatus;
  switch (status) {
    case 'suspected':
      next = confirmable && (sure || fromOtherExercise) ? 'confirmed' : 'suspected';
      transitions.push(next === 'confirmed' ? 'confirmed' : 'evidence_added');
      break;
    case 'confirmed':
      next = 'confirmed';
      transitions.push('evidence_added');
      break;
    case 'resolved':
      next = confirmable ? 'confirmed' : 'suspected';
      transitions.push(next === 'confirmed' ? 'relapsed' : 'reopened');
      break;
    case 'dismissed':
      next = sure && confirmable ? 'confirmed' : 'suspected';
      transitions.push('reopened');
      if (next === 'confirmed') transitions.push('confirmed');
      break;
  }
  const entered = next === 'confirmed' && status !== 'confirmed';
  return {
    misconceptionId,
    conceptId,
    before,
    after: {
      ...before,
      status: next,
      evidence: [...before.evidence, evidence],
      // New evidence restarts the way out ("그 사이 새 근거 없음").
      resolution: [],
      confirmCount: before.confirmCount + (entered ? 1 : 0),
      lastSeenAt: Math.max(before.lastSeenAt, evidence.at),
      resolvedAt: null,
    },
    transitions,
  };
}

function addResolutionStep(
  config: EngineConfig,
  before: MisconceptionState,
  attempt: MisconceptionAttempt,
  now: number,
  dayBoundary: DayBoundary,
): MisconceptionUpdate | null {
  const { resolveCorrect, resolveMinDays, dismissCorrect } = config.misconception;
  const transitions: MisconceptionTransition[] = [];
  let status = before.status;
  if (expired(config, before, now)) {
    status = 'dismissed';
    transitions.push('dismissed_expired');
  }
  if (status !== 'suspected' && status !== 'confirmed') {
    return transitions.length === 0
      ? null
      : {
          misconceptionId: before.misconceptionId,
          conceptId: before.conceptId,
          before,
          after: { ...before, status },
          transitions,
        };
  }
  const step: ResolutionStep = { attemptId: attempt.attemptId, at: attempt.at };
  const last = before.resolution.at(-1);
  if (status === 'confirmed' && last !== undefined) {
    const gap = daysBetween(localDateOf(last.at, dayBoundary), localDateOf(step.at, dayBoundary));
    // Same-day repeats do not show that the correction held.
    if (gap < resolveMinDays) return null;
  }
  const resolution = [...before.resolution, step];
  let next: MisconceptionStatus = status;
  let resolvedAt: number | null = before.resolvedAt;
  if (status === 'suspected' && resolution.length >= dismissCorrect) {
    next = 'dismissed';
    transitions.push('dismissed_by_targets');
  } else if (status === 'confirmed' && resolution.length >= resolveCorrect) {
    next = 'resolved';
    resolvedAt = attempt.at;
    transitions.push('resolved');
  } else {
    transitions.push('resolution_progress');
  }
  return {
    misconceptionId: before.misconceptionId,
    conceptId: before.conceptId,
    before,
    after: { ...before, status: next, resolution, resolvedAt },
    transitions,
  };
}

/** Required steps out of the current status (`resolved` from confirmed, `dismissed` from suspected). */
export function resolutionTarget(config: EngineConfig, status: MisconceptionStatus): number {
  return status === 'confirmed'
    ? config.misconception.resolveCorrect
    : status === 'suspected'
      ? config.misconception.dismissCorrect
      : 0;
}

/**
 * An AI misconception proposal the app has validated (docs/design/ai-system.md#misconceptionpropose,
 * FR-AI-09): `evidence` are the learner's wrong attempts the proposal cited. AI never decides the
 * learner's state, so a proposal only ever records a suspicion:
 *
 * - no observation yet → new `suspected` row (source `ai`);
 * - `dismissed` (or `suspected` past its expiry) → reopened as `suspected` with the evidence;
 * - `suspected`, `confirmed` or `resolved` → unchanged (`null`): an active row is already known,
 *   and only deterministic evidence (a wrong option or pattern) may confirm or relapse.
 */
export function proposeMisconception(
  config: EngineConfig,
  input: {
    readonly misconceptionId: string;
    readonly conceptId: ConceptId;
    /** Wrong attempts cited by the proposal (`source` should be `ai`). Must not be empty. */
    readonly evidence: readonly MisconceptionEvidence[];
    readonly state: MisconceptionState | null;
    readonly now: number;
  },
): MisconceptionUpdate | null {
  const { misconceptionId, conceptId, state, now } = input;
  const evidence = [...input.evidence].sort((a, b) => a.at - b.at);
  const first = evidence[0];
  const latest = evidence.at(-1);
  if (first === undefined || latest === undefined) return null;
  if (state === null) {
    return {
      misconceptionId,
      conceptId,
      before: null,
      after: {
        misconceptionId,
        conceptId,
        status: 'suspected',
        source: 'ai',
        evidence,
        resolution: [],
        confirmCount: 0,
        firstSeenAt: first.at,
        lastSeenAt: latest.at,
        resolvedAt: null,
      },
      transitions: ['observed'],
    };
  }
  const transitions: MisconceptionTransition[] = [];
  let status = state.status;
  if (expired(config, state, now)) {
    status = 'dismissed';
    transitions.push('dismissed_expired');
  }
  if (status !== 'dismissed') return null;
  const known = new Set(state.evidence.map((e) => e.attemptId));
  const added = evidence.filter((e) => !known.has(e.attemptId));
  if (added.length === 0) return null;
  transitions.push('reopened');
  return {
    misconceptionId,
    conceptId,
    before: state,
    after: {
      ...state,
      status: 'suspected',
      evidence: [...state.evidence, ...added],
      resolution: [],
      lastSeenAt: Math.max(state.lastSeenAt, latest.at),
      resolvedAt: null,
    },
    transitions,
  };
}
