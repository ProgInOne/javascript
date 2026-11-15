import type { EngineDeps } from '../config.ts';
import type { ConceptId, Importance } from '../types.ts';
import { tieBreakKeys } from '../util/rng.ts';
import type { ExerciseCandidate, PlannedItem, SelectionContext } from './candidates.ts';
import { pickBest, plan, primaryConceptOf } from './candidates.ts';

/**
 * Unit assessment sets (learning-engine.md#단원-평가-세트).
 *
 * An assessment is a fixed snapshot: it is planned once, never adapted, never remediated, and
 * hints, the tutor and the solution are locked until it ends (enforced by the server). The
 * engine only picks the items and judges the result; evidence (`W_ctx` 1.2 for correct answers,
 * the independent-application gate) comes from `applyAttempt` with `setKind: 'assessment'`.
 */

export interface AssessmentSetConcept {
  readonly conceptId: ConceptId;
  readonly importance: Importance;
}

export interface AssessmentSetRequest extends SelectionContext {
  readonly assessment: {
    readonly id: string;
    /** Concepts the assessment covers (`lesson.yaml` `concepts.reviewed`), in content order. */
    readonly concepts: readonly AssessmentSetConcept[];
    /** Requested size; `null` = every usable item up to `config.assessment.maxItems`. */
    readonly itemCount: number | null;
  };
  /** The assessment's own exercises (`usage: assessment`), minus reported/unsupported ones. */
  readonly candidates: readonly ExerciseCandidate[];
  /** Seeds tie-breaking; use the practice set ID. */
  readonly seed: string;
}

export interface AssessmentSetRationale {
  readonly requestedSize: number;
  readonly size: number;
  /** Items per covered concept. */
  readonly coverage: Readonly<Record<ConceptId, number>>;
  /** Concepts without any item (no candidate, or fewer slots than concepts). */
  readonly uncovered: readonly ConceptId[];
  /** Items whose variant group the learner has already seen (retakes of a small pool). */
  readonly seenItems: number;
  readonly estimatedSeconds: number;
}

export interface AssessmentSet {
  readonly items: readonly PlannedItem[];
  readonly rationale: AssessmentSetRationale;
}

/** Splits `total` by shares with the largest-remainder method (ties: lower index). */
function apportion(total: number, shares: readonly number[]): number[] {
  const raw = shares.map((share) => total * share);
  const result = raw.map(Math.floor);
  let left = total - result.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    left -= 1;
  }
  return result;
}

const IMPORTANCE_RANK: Readonly<Record<Importance, number>> = { core: 0, standard: 1, minor: 2 };

/**
 * Plans an assessment:
 *
 * 1. **Coverage**: one item per concept (concepts with the fewest candidates first, then
 *    `core` before `standard` before `minor`, then content order), aiming at L3.
 * 2. **Fill**: remaining slots follow the assessment difficulty mix (L1 10%, L2 30%, L3 35%,
 *    L4 20%, L5 5%), always from the concepts with the fewest items so far.
 * 3. **Order**: easier first, the same concept never twice in a row.
 *
 * Every pick prefers variant groups the learner has never seen (`freshness` tiers of
 * {@link pickBest}), so a retake gets new items while the pool lasts. One item per variant
 * group.
 */
export function buildAssessmentSet(deps: EngineDeps, input: AssessmentSetRequest): AssessmentSet {
  const { config } = deps;
  const conceptIds = input.assessment.concepts.map((c) => c.conceptId);
  const inScope = new Set(conceptIds);
  const pool = input.candidates.filter((c) => {
    const primary = primaryConceptOf(c);
    return primary !== null && inScope.has(primary);
  });
  const groups = new Set(pool.map((c) => c.variantGroupKey)).size;
  const requested = Math.max(
    1,
    Math.min(input.assessment.itemCount ?? config.assessment.maxItems, config.assessment.maxItems),
  );
  const size = Math.min(requested, groups);
  const tieBreak = tieBreakKeys(
    input.seed,
    pool.map((c) => c.id),
  );
  const used = new Set<string>();
  const picked: PlannedItem[] = [];
  const pickedTypes: string[] = [];
  const countOf = new Map<ConceptId, number>(conceptIds.map((id) => [id, 0]));
  const available = (c: ExerciseCandidate) => !used.has(c.variantGroupKey);
  const take = (candidate: ExerciseCandidate, scored: PlannedItem['factors'], score: number) => {
    const conceptId = primaryConceptOf(candidate) ?? '';
    used.add(candidate.variantGroupKey);
    pickedTypes.push(candidate.type);
    countOf.set(conceptId, (countOf.get(conceptId) ?? 0) + 1);
    picked.push(plan(candidate, { score, factors: scored }, 'assessment', conceptId, null));
  };
  const recentTypes = () => pickedTypes.slice(-config.practice.typeNoveltyWindow);

  // 1. Coverage.
  const order = input.assessment.concepts
    .map((c, index) => ({
      ...c,
      index,
      candidates: pool.filter((x) => primaryConceptOf(x) === c.conceptId).length,
    }))
    .filter((c) => c.candidates > 0)
    .sort(
      (a, b) =>
        a.candidates - b.candidates ||
        IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] ||
        a.index - b.index,
    );
  for (const concept of order) {
    if (picked.length >= size) break;
    const best = pickBest(
      config,
      pool.filter((c) => primaryConceptOf(c) === concept.conceptId && available(c)),
      {
        targetDifficulty: 3,
        inRange: (c) => c.difficulty >= 2 && c.difficulty <= 4,
        recentTypes: recentTypes(),
        context: input,
        tieBreak,
      },
    );
    if (best) take(best.candidate, best.scored.factors, best.scored.score);
  }

  // 2. Fill towards the difficulty mix.
  const quota = apportion(size, config.assessment.difficultyMix);
  while (picked.length < size) {
    const left = pool.filter(available);
    if (left.length === 0) break;
    const have = [1, 2, 3, 4, 5].map((d) => picked.filter((i) => i.difficulty === d).length);
    const deficits = quota.map((q, i) => q - (have[i] ?? 0));
    const level = deficits.indexOf(Math.max(...deficits)) + 1;
    const leastCovered = Math.min(
      ...left.map((c) => countOf.get(primaryConceptOf(c) ?? '') ?? Infinity),
    );
    const best = pickBest(
      config,
      left.filter((c) => (countOf.get(primaryConceptOf(c) ?? '') ?? Infinity) === leastCovered),
      {
        targetDifficulty: level,
        inRange: (c) => c.difficulty === level,
        recentTypes: recentTypes(),
        context: input,
        tieBreak,
      },
    );
    if (!best) break;
    take(best.candidate, best.scored.factors, best.scored.score);
  }

  // 3. Order: easy → hard without the same concept twice in a row.
  const byDifficulty = [...picked].sort(
    (a, b) =>
      a.difficulty - b.difficulty ||
      (tieBreak.get(a.exerciseId) ?? 0) - (tieBreak.get(b.exerciseId) ?? 0) ||
      (a.exerciseId < b.exerciseId ? -1 : 1),
  );
  const ordered = noConceptRepeats(byDifficulty);
  const items = ordered.map((item, position) => ({ ...item, position }));
  const coverage: Record<ConceptId, number> = {};
  for (const [id, n] of countOf) if (n > 0) coverage[id] = n;
  return {
    items,
    rationale: {
      requestedSize: requested,
      size: items.length,
      coverage,
      uncovered: conceptIds.filter((id) => (countOf.get(id) ?? 0) === 0),
      seenItems: items.filter((i) => i.factors.freshness < 1).length,
      estimatedSeconds: items.reduce((sum, item) => sum + item.estimatedSeconds, 0),
    },
  };
}

/**
 * Keeps the easy→hard order but never repeats the previous item's concept: at each step the
 * earliest remaining item of another concept is taken (the first one when none is left).
 */
function noConceptRepeats(items: readonly PlannedItem[]): PlannedItem[] {
  const remaining = [...items];
  const out: PlannedItem[] = [];
  while (remaining.length > 0) {
    const last = out.at(-1);
    const next =
      remaining.find((item) => item.targetConceptId !== last?.targetConceptId) ?? remaining[0];
    if (next === undefined) break;
    out.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return out;
}

/** Final state of one assessment item. */
export interface AssessmentResultItem {
  readonly status: 'pending' | 'answered' | 'skipped';
  readonly conceptId: ConceptId | null;
  /** Outcome of the item's single attempt (`correct` only counts as correct). */
  readonly correct: boolean;
}

export interface AssessmentResult {
  readonly total: number;
  readonly correct: number;
  /** `correct / total`; skipped items count as wrong. */
  readonly ratio: number;
  readonly passRatio: number;
  readonly passed: boolean;
  /** Per concept: items and correct items, in first-appearance order. */
  readonly concepts: readonly { conceptId: ConceptId; total: number; correct: number }[];
  /** Concepts with at least one wrong or skipped item (the weakness-set suggestion). */
  readonly missedConceptIds: readonly ConceptId[];
}

/** Judges a finished assessment against its pass ratio (`assessments.pass_ratio`). */
export function evaluateAssessment(
  deps: EngineDeps,
  input: { readonly items: readonly AssessmentResultItem[]; readonly passRatio: number | null },
): AssessmentResult {
  const passRatio = input.passRatio ?? deps.config.assessment.defaultPassRatio;
  const total = input.items.length;
  const correct = input.items.filter((i) => i.status === 'answered' && i.correct).length;
  const ratio = total === 0 ? 0 : correct / total;
  const concepts = new Map<ConceptId, { conceptId: ConceptId; total: number; correct: number }>();
  for (const item of input.items) {
    if (item.conceptId === null) continue;
    const entry = concepts.get(item.conceptId) ?? {
      conceptId: item.conceptId,
      total: 0,
      correct: 0,
    };
    entry.total += 1;
    if (item.status === 'answered' && item.correct) entry.correct += 1;
    concepts.set(item.conceptId, entry);
  }
  const list = [...concepts.values()];
  return {
    total,
    correct,
    ratio,
    passRatio,
    passed: total > 0 && ratio >= passRatio - 1e-9,
    concepts: list,
    missedConceptIds: list.filter((c) => c.correct < c.total).map((c) => c.conceptId),
  };
}
