/**
 * Scenario 22: recomputing from the raw attempt stream gives the same result as the live,
 * persisted path. The live path round-trips every stored value through JSON like the database.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineDeps } from '../config.ts';
import { defaultEngineConfig } from '../config.ts';
import type { AttemptBreakdown } from '../mastery/apply.ts';
import { applyAttempt, initialConceptState } from '../mastery/apply.ts';
import { attempt, exercise, SEOUL, T0 } from '../test/fixtures.ts';
import type { AttemptFacts, ConceptId, ConceptState, ExerciseFacts } from '../types.ts';
import { DAY_MS, HOUR_MS } from '../util/time.ts';
import { flushPendingRatings } from './flush.ts';
import { createTsFsrsPort } from './fsrs-adapter.ts';
import type { PendingRating } from './rating.ts';

let deps: EngineDeps;
beforeAll(async () => {
  deps = { config: defaultEngineConfig, fsrs: await createTsFsrsPort(defaultEngineConfig.fsrs) };
});

interface SetEvent {
  readonly at: number;
  readonly answers: readonly { exercise: ExerciseFacts; attempt: AttemptFacts }[];
}

const tagA = [{ conceptId: 'c.a', weight: 1, isPrimary: true }] as const;
const tagAB = [
  { conceptId: 'c.b', weight: 1, isPrimary: true },
  { conceptId: 'c.a', weight: 0.4, isPrimary: false },
] as const;

function stream(): SetEvent[] {
  const days = [0, 0, 1, 4, 11, 12, 25, 40];
  return days.map((d, s) => {
    const at = T0 + d * DAY_MS + s * HOUR_MS;
    const answers = [0, 1, 2, 3].map((i) => {
      const ex = exercise({
        id: `t${i % 3}@${s}`,
        variantGroupKey: `t${i % 3}`,
        difficulty: (1 + ((s + i) % 4)) as 1 | 2 | 3 | 4,
        type: i % 2 === 0 ? 'predict_output' : 'fix_bug',
        category: i % 2 === 0 ? 'recall' : 'production',
        concepts: i === 3 ? [...tagAB] : [...tagA],
      });
      const wrong = (s + i) % 5 === 0;
      const a = attempt({
        attemptId: `s${s}-${i}`,
        submittedAt: at + i * 60_000,
        outcome: wrong ? 'incorrect' : 'correct',
        score: wrong ? 0 : 1,
        confidence: (['sure', 'unsure', null] as const)[i % 3] ?? null,
        setKind: s % 3 === 2 ? 'review' : 'lesson',
      });
      return { exercise: ex, attempt: a };
    });
    return { at, answers };
  });
}

/** In-memory "database" whose rows are JSON strings. */
class Store {
  private rows = new Map<ConceptId, string>();

  private readonly roundTrip: boolean;

  constructor(roundTrip: boolean) {
    this.roundTrip = roundTrip;
  }

  get(id: ConceptId): ConceptState {
    const row = this.rows.get(id);
    if (row === undefined) return initialConceptState(id);
    const parsed = JSON.parse(row) as ConceptState & {
      memory: (ConceptState['memory'] & { card: { raw: unknown } }) | null;
    };
    if (!this.roundTrip) return parsed;
    return {
      ...parsed,
      memory:
        parsed.memory === null
          ? null
          : { ...parsed.memory, card: deps.fsrs.fromRaw(parsed.memory.card.raw) },
    };
  }

  put(state: ConceptState): void {
    this.rows.set(state.mastery.conceptId, JSON.stringify(state));
  }
}

function run(roundTrip: boolean): Record<string, unknown> {
  const live = new Map<ConceptId, ConceptState>();
  const store = new Store(roundTrip);
  const read = (id: ConceptId) =>
    roundTrip ? store.get(id) : (live.get(id) ?? initialConceptState(id));
  const write = (state: ConceptState) => {
    if (roundTrip) store.put(state);
    else live.set(state.mastery.conceptId, state);
  };

  for (const set of stream()) {
    const pending: PendingRating[] = [];
    for (const { exercise: ex, attempt: a } of set.answers) {
      const ids = ex.concepts.map((c) => c.conceptId);
      const effects = applyAttempt(deps, {
        attempt: a,
        exercise: ex,
        concepts: ids.map(read),
        now: a.submittedAt,
        dayBoundary: SEOUL,
      });
      for (const update of effects.mastery) {
        const state = read(update.conceptId);
        const facts = effects.evidence
          .filter((e) => e.conceptId === update.conceptId && e.kind === 'attempt')
          .map((e) => (JSON.parse(JSON.stringify(e.breakdown)) as AttemptBreakdown).fact);
        write({ ...state, mastery: update.after, history: [...state.history, ...facts] });
      }
      pending.push(...effects.pendingRatings);
    }
    const end = set.at + HOUR_MS;
    const ids = [...new Set(pending.map((p) => p.conceptId))];
    const flushed = flushPendingRatings(deps, {
      pending,
      concepts: ids.map(read),
      now: end,
      dayBoundary: SEOUL,
    });
    for (const id of ids) {
      const state = read(id);
      const memory = flushed.memory.find((m) => m.conceptId === id) ?? state.memory;
      const logs = flushed.reviewLogs.filter((l) => l.conceptId === id);
      const update = flushed.mastery.find((m) => m.conceptId === id);
      write({
        ...state,
        mastery: update?.after ?? state.mastery,
        memory,
        reviews: [
          ...state.reviews,
          ...logs.map((l) => ({
            reviewedAt: l.reviewedAt,
            rating: l.rating,
            variantGroupKeys: l.sourceVariantGroupKeys,
          })),
        ],
      });
    }
  }
  return Object.fromEntries(
    ['c.a', 'c.b'].map((id) => {
      const s = read(id);
      return [id, { mastery: s.mastery, card: s.memory?.card ?? null, reviews: s.reviews.length }];
    }),
  );
}

describe('scenario 22: replay equals the live computation', () => {
  it('gives the same score, stage and card state from the same attempt stream', () => {
    const replayed = run(false);
    const persisted = run(true);
    expect(persisted).toEqual(replayed);
    const a = replayed['c.a'] as { mastery: { stage: string }; reviews: number };
    expect(a.reviews).toBeGreaterThan(3);
    expect(a.mastery.stage).not.toBe('not_started');
  });
});
