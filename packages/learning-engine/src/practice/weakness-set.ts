import type { EngineDeps } from '../config.ts';
import { effectiveMastery } from '../mastery/effective.ts';
import type { ConceptId, ConceptState, ExerciseId, Importance, MasteryStage } from '../types.ts';
import { MASTERY_STAGES } from '../types.ts';
import { clamp } from '../util/math.ts';
import { tieBreakKeys } from '../util/rng.ts';
import type { ExerciseCandidate, PlannedItem, SelectionContext } from './candidates.ts';
import { pickBest, plan, primaryConceptOf, recentTypesOf } from './candidates.ts';
import type { InsufficientCandidates } from './lesson-set.ts';

/**
 * Weakness practice (learning-engine.md#약점-집중-세트, FR-DASH-04).
 *
 * ```text
 * weakness = (100 − effective) × importanceFactor
 *          × (1 + 0.5 × confirmedMisconceptions + 0.25 × suspectedMisconceptions)
 *          × (1 + 0.2 × min(consecutiveFailures, 3))
 * ```
 */

export interface WeakConceptInput {
  readonly state: ConceptState;
  readonly importance: Importance;
  /** Active content misconceptions of the concept (AI proposals excluded). */
  readonly confirmedMisconceptions: number;
  readonly suspectedMisconceptions: number;
}

export interface WeakConceptEntry {
  readonly conceptId: ConceptId;
  readonly weakness: number;
  readonly effective: number;
  readonly stage: MasteryStage;
  readonly factors: {
    readonly gap: number;
    readonly importanceFactor: number;
    readonly misconceptionFactor: number;
    readonly failureFactor: number;
  };
  readonly confirmedMisconceptions: number;
  readonly suspectedMisconceptions: number;
  readonly consecutiveFailures: number;
}

/** Concepts at `introduced` or above, weakest first (ties: concept ID). */
export function rankWeakConcepts(
  deps: EngineDeps,
  input: { readonly concepts: readonly WeakConceptInput[]; readonly now: number },
): WeakConceptEntry[] {
  const { config } = deps;
  const introduced = MASTERY_STAGES.indexOf('introduced');
  return input.concepts
    .filter((c) => MASTERY_STAGES.indexOf(c.state.mastery.stage) >= introduced)
    .map((c): WeakConceptEntry => {
      const m = c.state.mastery;
      const { effective } = effectiveMastery(deps, m.score, c.state.memory, input.now);
      const factors = {
        gap: 100 - effective,
        importanceFactor: config.importanceFactor[c.importance],
        misconceptionFactor: 1 + 0.5 * c.confirmedMisconceptions + 0.25 * c.suspectedMisconceptions,
        failureFactor: 1 + 0.2 * Math.min(m.consecutiveFailures, 3),
      };
      return {
        conceptId: m.conceptId,
        weakness:
          factors.gap *
          factors.importanceFactor *
          factors.misconceptionFactor *
          factors.failureFactor,
        effective,
        stage: m.stage,
        factors,
        confirmedMisconceptions: c.confirmedMisconceptions,
        suspectedMisconceptions: c.suspectedMisconceptions,
        consecutiveFailures: m.consecutiveFailures,
      };
    })
    .sort(
      (a, b) =>
        b.weakness - a.weakness ||
        (a.conceptId < b.conceptId ? -1 : a.conceptId > b.conceptId ? 1 : 0),
    );
}

/**
 * Targets of an automatic weakness set: the top `min` entries, then up to `max` while an entry
 * still reaches `keepRatio` of the top weakness (a clearly weaker tail is left for later).
 * Entries without weakness (mastered with full recall) are never picked.
 */
export function selectWeaknessTargets(
  deps: EngineDeps,
  entries: readonly WeakConceptEntry[],
): WeakConceptEntry[] {
  const { minConcepts, maxConcepts, keepRatio } = deps.config.weakness;
  const positive = entries.filter((e) => e.weakness > 0);
  const top = positive[0]?.weakness ?? 0;
  return positive.filter(
    (e, i) => i < minConcepts || (i < maxConcepts && e.weakness >= top * keepRatio),
  );
}

export interface WeaknessSetRequest extends SelectionContext {
  /** Target concepts in priority order (from {@link selectWeaknessTargets} or the learner). */
  readonly targets: readonly WeakConceptEntry[];
  readonly concepts: readonly ConceptState[];
  /** Candidates whose primary concept is a target. */
  readonly candidates: readonly ExerciseCandidate[];
  /** Exercises that target each concept's confirmed misconceptions. */
  readonly confirmedTargetIds: Readonly<Record<ConceptId, readonly ExerciseId[]>>;
  /** Seeds tie-breaking; use the practice set ID. */
  readonly seed: string;
}

export interface WeaknessSet {
  readonly items: readonly PlannedItem[];
  readonly rationale: {
    readonly targets: readonly WeakConceptEntry[];
    /** Planned difficulty ladder per concept. */
    readonly ladders: Readonly<Record<ConceptId, readonly number[]>>;
    readonly insufficientCandidates: readonly InsufficientCandidates[];
    readonly estimatedSeconds: number;
  };
}

/**
 * Builds a weakness set: per concept 3 items (4 with a confirmed misconception or effective
 * below 40) on a ladder starting at `max(1, maxDifficultyCorrect − 1)` and rising one level per
 * item (`start, start, +1, +2` for four). An exercise that targets a confirmed misconception is
 * placed within the concept's first two items. Concepts are interleaved round-robin so each
 * concept keeps its ladder order.
 */
export function buildWeaknessSet(deps: EngineDeps, input: WeaknessSetRequest): WeaknessSet {
  const { config } = deps;
  const w = config.weakness;
  const states = new Map(input.concepts.map((s) => [s.mastery.conceptId, s]));
  const tieBreak = tieBreakKeys(
    input.seed,
    input.candidates.map((c) => c.id),
  );
  const used = new Set<string>();
  const perConcept: PlannedItem[][] = [];
  const ladders: Record<ConceptId, number[]> = {};
  const insufficientCandidates: InsufficientCandidates[] = [];

  for (const target of input.targets) {
    const state = states.get(target.conceptId);
    const count =
      target.confirmedMisconceptions > 0 || target.effective < w.extraItemBelowEffective
        ? w.itemsMax
        : w.itemsMin;
    const start = Math.max(1, (state?.mastery.maxDifficultyCorrect ?? 0) - 1);
    const steps = count === 4 ? [0, 0, 1, 2] : [0, 1, 2];
    const ladder = steps.map((s) => clamp(start + s, 1, 5));
    ladders[target.conceptId] = ladder;
    const recent = recentTypesOf(config, state);
    const confirmedTargets = new Set(input.confirmedTargetIds[target.conceptId] ?? []);
    const items: PlannedItem[] = [];
    let targeted = false;
    for (const [index, difficulty] of ladder.entries()) {
      const pool = input.candidates.filter(
        (c) => primaryConceptOf(c) === target.conceptId && !used.has(c.variantGroupKey),
      );
      const mustTarget = index === 1 && !targeted && pool.some((c) => confirmedTargets.has(c.id));
      const best = pickBest(
        config,
        mustTarget ? pool.filter((c) => confirmedTargets.has(c.id)) : pool,
        {
          targetDifficulty: difficulty,
          inRange: (c) => c.difficulty === difficulty,
          recentTypes: recent,
          context: input,
          tieBreak,
        },
      );
      if (best === null) break;
      const isTarget = confirmedTargets.has(best.candidate.id);
      targeted ||= isTarget;
      used.add(best.candidate.variantGroupKey);
      recent.push(best.candidate.type);
      items.push(
        plan(
          best.candidate,
          best.scored,
          isTarget ? 'misconception_target' : 'weak_concept',
          target.conceptId,
          null,
        ),
      );
    }
    if (items.length < count) {
      insufficientCandidates.push({
        conceptId: target.conceptId,
        requested: count,
        available: items.length,
      });
    }
    perConcept.push(items);
  }

  const ordered: PlannedItem[] = [];
  for (let round = 0; perConcept.some((items) => items.length > round); round++) {
    for (const items of perConcept) {
      const item = items[round];
      if (item !== undefined) ordered.push(item);
    }
  }
  const items = ordered.map((item, position) => ({ ...item, position }));
  return {
    items,
    rationale: {
      targets: input.targets,
      ladders,
      insufficientCandidates,
      estimatedSeconds: items.reduce((sum, item) => sum + item.estimatedSeconds, 0),
    },
  };
}
