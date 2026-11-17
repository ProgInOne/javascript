import type { BandName, EngineDeps, PassRule, PracticeBand } from '../config.ts';
import { effectiveMastery } from '../mastery/effective.ts';
import type { ConceptId, ConceptState, Importance } from '../types.ts';
import { clamp } from '../util/math.ts';
import { tieBreakKeys } from '../util/rng.ts';
import type {
  ExerciseCandidate,
  PlannedItem,
  PracticeItemReason,
  SelectionContext,
} from './candidates.ts';
import { pickBest, plan, primaryConceptOf, recentTypesOf, scoreCandidate } from './candidates.ts';
import { breakTypeRuns } from './order.ts';
import { lessonPassRule } from './pass-rule.ts';

export interface LessonSetConcept {
  readonly conceptId: ConceptId;
  readonly importance: Importance;
  /** Current learner state; missing = never practiced. */
  readonly state?: ConceptState;
}

export interface LessonSetRequest extends SelectionContext {
  readonly lesson: {
    readonly id: string;
    readonly importance: Importance;
    /** `lesson_concepts.role = 'introduces'`, in lesson order. */
    readonly introduces: readonly ConceptId[];
    /** `lesson_concepts.role = 'reviews'`. */
    readonly reviews: readonly ConceptId[];
    /** `lesson.yaml` `practice.passRule` overrides. */
    readonly passRule?: Partial<PassRule>;
  };
  /** Introduced and reviewed concepts with their importance and state. */
  readonly concepts: readonly LessonSetConcept[];
  /** Candidates whose primary concept is one of the lesson's concepts. */
  readonly candidates: readonly ExerciseCandidate[];
  /** Seeds tie-breaking; use the practice set ID. */
  readonly seed: string;
}

export interface InsufficientCandidates {
  readonly conceptId: ConceptId;
  readonly requested: number;
  readonly available: number;
}

export interface SetRationale {
  readonly requestedSize: number;
  readonly size: number;
  /** Items planned per introduced concept. */
  readonly quotas: Readonly<Record<ConceptId, number>>;
  readonly insufficientCandidates: readonly InsufficientCandidates[];
  readonly interleavedReviewConcepts: readonly ConceptId[];
  /** A production exercise was available and is included. */
  readonly productionIncluded: boolean;
  /**
   * A writing exercise (`ExerciseFacts.writing`) of an introduced concept was available and is
   * included (D-084). False when the lesson has none.
   */
  readonly writingIncluded: boolean;
  readonly estimatedSeconds: number;
}

export interface LessonSet {
  readonly items: readonly PlannedItem[];
  readonly passRule: PassRule;
  readonly rationale: SetRationale;
}

/** Splits `total` by weights with the largest-remainder method (ties: earlier index). */
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

function bandFor(bands: readonly PracticeBand[], difficulty: number): BandName {
  const band = bands.find((b) => difficulty >= b.minDifficulty && difficulty <= b.maxDifficulty);
  return band?.name ?? (difficulty < (bands[0]?.minDifficulty ?? 1) ? 'warmup' : 'challenge');
}

/** Number of distinct variant groups (a set holds at most one exercise per group). */
function groupsOf(pool: readonly ExerciseCandidate[]): number {
  return new Set(pool.map((candidate) => candidate.variantGroupKey)).size;
}

/**
 * Builds the first practice set of a lesson (learning-engine.md#단원-연습-세트):
 * size by lesson importance, ≥ 3 items per introduced concept and the rest by concept
 * importance, warm-up/core/challenge bands (30/50/20%), at least one production exercise and at
 * least one writing exercise (D-084) when available, one interleaved item per reviewed concept below effective 70, sorted by difficulty
 * without three same-type items in a row, and one exercise per variant group.
 */
export function buildLessonPracticeSet(deps: EngineDeps, input: LessonSetRequest): LessonSet {
  const { config } = deps;
  const p = config.practice;
  const conceptById = new Map(input.concepts.map((c) => [c.conceptId, c]));
  const tieBreak = tieBreakKeys(
    input.seed,
    input.candidates.map((c) => c.id),
  );

  const pools = new Map<ConceptId, ExerciseCandidate[]>();
  for (const candidate of input.candidates) {
    const conceptId = primaryConceptOf(candidate);
    if (conceptId === null) continue;
    const list = pools.get(conceptId) ?? [];
    list.push(candidate);
    pools.set(conceptId, list);
  }
  const available = (conceptId: ConceptId) => groupsOf(pools.get(conceptId) ?? []);

  const requestedSize = p.lessonSetSize[input.lesson.importance];
  const intro = input.lesson.introduces;
  const minimums = intro.map((id) => Math.min(p.minPerConcept, available(id)));
  const minimumTotal = minimums.reduce((a, b) => a + b, 0);

  // Reviewed concepts below the bar get one interleaved item, without eating the minimums.
  const reviewConcepts = input.lesson.reviews
    .filter((id) => available(id) > 0)
    .map((id) => {
      const concept = conceptById.get(id);
      const effective =
        concept?.state === undefined
          ? 0
          : effectiveMastery(deps, concept.state.mastery.score, concept.state.memory, input.now)
              .effective;
      return { id, effective };
    })
    .filter((c) => c.effective < p.interleaveBelowEffective)
    .sort((a, b) => a.effective - b.effective || (a.id < b.id ? -1 : 1))
    .slice(0, Math.max(0, requestedSize - minimumTotal))
    .map((c) => c.id);

  // Quotas: minimums first, then highest averages by importance weight, capped by availability.
  const quotas = [...minimums];
  const extra = intro.map(() => 0);
  let left = requestedSize - reviewConcepts.length - minimumTotal;
  while (left > 0) {
    let best = -1;
    let bestAverage = -1;
    intro.forEach((id, index) => {
      if ((quotas[index] ?? 0) >= available(id)) return;
      const weight = p.importanceWeight[conceptById.get(id)?.importance ?? 'standard'];
      const average = weight / ((extra[index] ?? 0) + 1);
      if (average > bestAverage) {
        bestAverage = average;
        best = index;
      }
    });
    if (best === -1) break;
    quotas[best] = (quotas[best] ?? 0) + 1;
    extra[best] = (extra[best] ?? 0) + 1;
    left -= 1;
  }

  const used = new Set<string>();
  const items: PlannedItem[] = [];
  const pickedTypes = new Map<ConceptId, string[]>();
  const recentTypes = (id: ConceptId) =>
    [...recentTypesOf(config, conceptById.get(id)?.state), ...(pickedTypes.get(id) ?? [])].slice(
      -p.typeNoveltyWindow,
    );
  const take = (
    conceptId: ConceptId,
    target: number,
    inRange: (c: ExerciseCandidate) => boolean,
  ) => {
    const pool = (pools.get(conceptId) ?? []).filter((c) => !used.has(c.variantGroupKey));
    const best = pickBest(config, pool, {
      targetDifficulty: target,
      inRange,
      recentTypes: recentTypes(conceptId),
      context: input,
      tieBreak,
    });
    if (best === null) return null;
    used.add(best.candidate.variantGroupKey);
    pickedTypes.set(conceptId, [...(pickedTypes.get(conceptId) ?? []), best.candidate.type]);
    return best;
  };

  intro.forEach((conceptId, index) => {
    const perBand = apportion(
      quotas[index] ?? 0,
      p.bands.map((b) => b.share),
    );
    p.bands.forEach((band, bandIndex) => {
      for (let n = 0; n < (perBand[bandIndex] ?? 0); n++) {
        const best = take(
          conceptId,
          (band.minDifficulty + band.maxDifficulty) / 2,
          (c) => c.difficulty >= band.minDifficulty && c.difficulty <= band.maxDifficulty,
        );
        if (best === null) return;
        items.push(plan(best.candidate, best.scored, 'lesson_practice', conceptId, band.name));
      }
    });
  });

  // At least one writing exercise, then at least one production exercise, when the lesson has
  // one. Fixing given code (`fix_bug`, a `web_task` page to fix) is production but not writing,
  // so checking production alone let a set hold no writing exercise at all (D-084). A writing
  // exercise is production too, so the second step only runs when the lesson has none.
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const isProduction = (c: ExerciseCandidate) => c.category === 'production';
  const isWriting = (c: ExerciseCandidate) => isProduction(c) && c.writing === true;
  const includes = (match: (c: ExerciseCandidate) => boolean) =>
    items.some((item) => {
      const c = byId.get(item.exerciseId);
      return c !== undefined && match(c);
    });
  const writingIncluded =
    includes(isWriting) ||
    swapIn(deps, input, items, used, tieBreak, recentTypes, {
      match: isWriting,
      // Replace a recognition/recall item when the concept has one, so a fix_bug or a page to fix
      // (debugging practice) stays in the set.
      keep: isProduction,
      reason: 'writing_required',
    });
  const productionIncluded =
    includes(isProduction) ||
    swapIn(deps, input, items, used, tieBreak, recentTypes, {
      match: isProduction,
      keep: () => false,
      reason: 'production_required',
    });

  for (const conceptId of reviewConcepts) {
    const concept = conceptById.get(conceptId);
    const target = clamp(
      concept?.state?.mastery.maxDifficultyCorrect ?? 0,
      config.review.minDifficulty,
      config.review.maxDifficulty,
    );
    const best = take(conceptId, target, (c) => Math.abs(c.difficulty - target) <= 1);
    if (best !== null) {
      items.push(
        plan(
          best.candidate,
          best.scored,
          'interleave_review',
          conceptId,
          bandFor(p.bands, best.candidate.difficulty),
        ),
      );
    }
  }

  const bandOrder = new Map(p.bands.map((b, i) => [b.name, i]));
  const sorted = [...items].sort(
    (a, b) =>
      a.difficulty - b.difficulty ||
      (bandOrder.get(a.band ?? 'core') ?? 0) - (bandOrder.get(b.band ?? 'core') ?? 0) ||
      (tieBreak.get(a.exerciseId) ?? 0) - (tieBreak.get(b.exerciseId) ?? 0) ||
      (a.exerciseId < b.exerciseId ? -1 : 1),
  );
  const ordered = breakTypeRuns(sorted).map((item, position) => ({ ...item, position }));

  const insufficientCandidates = intro
    .filter((id) => available(id) < p.minPerConcept)
    .map((id) => ({ conceptId: id, requested: p.minPerConcept, available: available(id) }));

  return {
    items: ordered,
    passRule: lessonPassRule(config, input.lesson.importance, input.lesson.passRule),
    rationale: {
      requestedSize,
      size: ordered.length,
      quotas: Object.fromEntries(intro.map((id, index) => [id, quotas[index] ?? 0])),
      insufficientCandidates,
      interleavedReviewConcepts: reviewConcepts,
      productionIncluded,
      writingIncluded,
      estimatedSeconds: ordered.reduce((sum, item) => sum + item.estimatedSeconds, 0),
    },
  };
}

/**
 * Replaces an item of an introduced concept with that concept's best unused candidate matching
 * `rule.match`. The replaced item is the concept's lowest-scoring item, skipping items that
 * `rule.keep` protects when the concept has another one. Among concepts, the best candidate wins:
 * fresh before recently served (freshness 0), unseen before repeated, then the score, then the
 * seeded tie-break. Returns whether a matching exercise is now included.
 */
function swapIn(
  deps: EngineDeps,
  input: LessonSetRequest,
  items: PlannedItem[],
  used: Set<string>,
  tieBreak: ReadonlyMap<string, number>,
  recentTypes: (id: ConceptId) => string[],
  rule: {
    readonly match: (candidate: ExerciseCandidate) => boolean;
    readonly keep: (candidate: ExerciseCandidate) => boolean;
    readonly reason: PracticeItemReason;
  },
): boolean {
  const { config } = deps;
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  let best: { candidate: ExerciseCandidate; score: number; tier: number; victim: number } | null =
    null;
  for (const conceptId of input.lesson.introduces) {
    const victims = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.targetConceptId === conceptId);
    if (victims.length === 0) continue;
    const replaceable = victims.filter(({ item }) => {
      const current = byId.get(item.exerciseId);
      return current === undefined || !rule.keep(current);
    });
    const victim = (replaceable.length > 0 ? replaceable : victims).reduce((low, cur) =>
      cur.item.selectScore < low.item.selectScore ? cur : low,
    );
    const target = victim.item.difficulty;
    for (const candidate of input.candidates) {
      if (!rule.match(candidate) || primaryConceptOf(candidate) !== conceptId) continue;
      if (used.has(candidate.variantGroupKey)) continue;
      const { score, factors } = scoreCandidate(config, candidate, {
        targetDifficulty: target,
        recentTypes: recentTypes(conceptId),
        context: input,
      });
      const tier =
        (factors.freshness > 0 ? 0 : 2) + (input.seenExerciseIds?.has(candidate.id) ? 1 : 0);
      const better =
        best === null ||
        tier < best.tier ||
        (tier === best.tier &&
          (score > best.score ||
            (score === best.score &&
              (tieBreak.get(candidate.id) ?? 0) < (tieBreak.get(best.candidate.id) ?? 0))));
      if (better) best = { candidate, score, tier, victim: victim.index };
    }
  }
  if (best === null) return false;
  const old = items[best.victim];
  if (old === undefined) return false;
  used.delete(old.variantGroupKey);
  used.add(best.candidate.variantGroupKey);
  const scored = scoreCandidate(config, best.candidate, {
    targetDifficulty: old.difficulty,
    recentTypes: recentTypes(old.targetConceptId),
    context: input,
  });
  items[best.victim] = plan(
    best.candidate,
    scored,
    rule.reason,
    old.targetConceptId,
    bandFor(config.practice.bands, best.candidate.difficulty),
  );
  return true;
}
