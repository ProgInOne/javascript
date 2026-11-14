/**
 * Test helpers: a deterministic fake FSRS port and builders for engine inputs.
 * The fake keeps the same contract as the ts-fsrs adapter with trivially checkable numbers.
 */
import { defaultEngineConfig } from '../config.ts';
import type { EngineDeps } from '../config.ts';
import type { AttemptEffects } from '../mastery/apply.ts';
import { applyAttempt, initialConceptState } from '../mastery/apply.ts';
import type {
  AttemptFacts,
  ConceptMemoryState,
  ConceptState,
  EvidenceFact,
  ExerciseFacts,
  FsrsCard,
  FsrsCardState,
  FsrsPort,
  FsrsRating,
  ReviewFact,
} from '../types.ts';
import type { DayBoundary } from '../util/time.ts';
import { DAY_MS } from '../util/time.ts';

export const SEOUL: DayBoundary = { timeZone: 'Asia/Seoul', dayStartHour: 4 };
/** 2026-03-02 10:00 in Seoul (01:00 UTC). */
export const T0 = Date.UTC(2026, 2, 2, 1, 0, 0);

const GROWTH: Record<FsrsRating, number> = { again: 0.5, hard: 1.2, good: 2.5, easy: 4 };

function makeCard(cardId: string, fields: Omit<FsrsCard, 'raw'>): FsrsCard {
  return {
    ...fields,
    raw: {
      cardId,
      dueAt: fields.dueAt,
      stability: fields.stability,
      difficulty: fields.difficulty,
      state: fields.state,
      lastReviewAt: fields.lastReviewAt,
      reps: fields.reps,
      lapses: fields.lapses,
    },
  };
}

/** R(t) = 0.9^(t / S): R equals 0.9 exactly when t = S days. */
export const fakeFsrs: FsrsPort = {
  modelVersion: 'FAKE-1',
  newCard(cardId, now) {
    return makeCard(cardId, {
      dueAt: now,
      stability: 0,
      difficulty: 5,
      state: 'new',
      lastReviewAt: null,
      reps: 0,
      lapses: 0,
    });
  },
  review(card, rating, now) {
    const cardId = card.raw['cardId'] as string;
    const stability = Math.max(1, (card.stability || 1) * GROWTH[rating]);
    const state: FsrsCardState = rating === 'again' ? 'relearning' : 'review';
    const elapsedDays = card.lastReviewAt === null ? 0 : (now - card.lastReviewAt) / DAY_MS;
    const scheduledDays =
      card.lastReviewAt === null ? 0 : (card.dueAt - card.lastReviewAt) / DAY_MS;
    const next = makeCard(cardId, {
      dueAt: now + Math.round(stability) * DAY_MS,
      stability,
      difficulty: card.difficulty,
      state,
      lastReviewAt: now,
      reps: card.reps + 1,
      lapses: card.lapses + (rating === 'again' && card.state === 'review' ? 1 : 0),
    });
    return {
      card: next,
      log: {
        raw: { cardId, rating, reviewTime: now },
        elapsedDays,
        scheduledDays,
        stateBefore: card.state,
      },
    };
  },
  retrievability(card, now) {
    if (card.lastReviewAt === null || card.stability <= 0) return 0;
    return 0.9 ** ((now - card.lastReviewAt) / DAY_MS / card.stability);
  },
  fromRaw(raw) {
    const r = raw as Record<string, unknown>;
    return makeCard(String(r['cardId']), {
      dueAt: Number(r['dueAt']),
      stability: Number(r['stability']),
      difficulty: Number(r['difficulty']),
      state: r['state'] as FsrsCardState,
      lastReviewAt: r['lastReviewAt'] === null ? null : Number(r['lastReviewAt']),
      reps: Number(r['reps']),
      lapses: Number(r['lapses']),
    });
  },
};

export const deps: EngineDeps = { config: defaultEngineConfig, fsrs: fakeFsrs };

let exerciseSeq = 0;

export function exercise(overrides: Partial<ExerciseFacts> = {}): ExerciseFacts {
  exerciseSeq += 1;
  const id = overrides.id ?? `ex-${exerciseSeq}`;
  return {
    id,
    type: 'predict_output',
    category: 'recall',
    difficulty: 2,
    estimatedSeconds: 60,
    variantGroupKey: overrides.variantGroupKey ?? id,
    concepts: [{ conceptId: 'c.main', weight: 1, isPrimary: true }],
    ...overrides,
  };
}

let attemptSeq = 0;

export function attempt(overrides: Partial<AttemptFacts> = {}): AttemptFacts {
  attemptSeq += 1;
  return {
    attemptId: `at-${attemptSeq}`,
    outcome: 'correct',
    score: 1,
    confidence: 'sure',
    hintLevelMax: 0,
    solutionViewed: false,
    tutorAssisted: false,
    attemptInItem: 1,
    activeMs: 30_000,
    setKind: 'lesson',
    submittedAt: T0,
    ...overrides,
  };
}

/** Folds `applyAttempt` results back into a concept state, as the server would persist them. */
export function fold(state: ConceptState, effects: AttemptEffects): ConceptState {
  const update = effects.mastery.find((m) => m.conceptId === state.mastery.conceptId);
  if (update === undefined) return state;
  const facts: EvidenceFact[] = effects.evidence
    .filter((e) => e.conceptId === state.mastery.conceptId && e.kind === 'attempt')
    .map((e) => ('fact' in e.breakdown ? e.breakdown.fact : null))
    .filter((f): f is EvidenceFact => f !== null);
  return { ...state, mastery: update.after, history: [...state.history, ...facts] };
}

/** Learner simulator for one concept: applies attempts in order and keeps the state. */
export class Learner {
  state: ConceptState;
  readonly effects: AttemptEffects[] = [];

  constructor(conceptId = 'c.main', state?: ConceptState) {
    this.state = state ?? initialConceptState(conceptId);
  }

  answer(ex: ExerciseFacts, at: Partial<AttemptFacts> = {}, now?: number): AttemptEffects {
    const a = attempt(at);
    const effects = applyAttempt(deps, {
      attempt: a,
      exercise: ex,
      concepts: [this.state],
      now: now ?? a.submittedAt,
      dayBoundary: SEOUL,
    });
    this.effects.push(effects);
    this.state = fold(this.state, effects);
    return effects;
  }

  withMemory(memory: ConceptMemoryState | null): this {
    this.state = { ...this.state, memory };
    return this;
  }

  withReviews(reviews: ReviewFact[]): this {
    this.state = { ...this.state, reviews };
    return this;
  }
}

export function reviewedMemory(
  conceptId: string,
  lastReviewAt: number,
  stabilityDays: number,
): ConceptMemoryState {
  return {
    conceptId,
    fsrsVersion: fakeFsrs.modelVersion,
    suspended: false,
    card: fakeFsrs.fromRaw({
      cardId: conceptId,
      dueAt: lastReviewAt + stabilityDays * DAY_MS,
      stability: stabilityDays,
      difficulty: 5,
      state: 'review',
      lastReviewAt,
      reps: 2,
      lapses: 0,
    }),
  };
}
