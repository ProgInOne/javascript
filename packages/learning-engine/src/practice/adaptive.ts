import type { EngineDeps } from '../config.ts';
import type { RemediationSuggestion } from '../remediation/detect.ts';
import type { ConceptId, ConceptState, ExerciseId, PracticeSetKind } from '../types.ts';
import { tieBreakKeys } from '../util/rng.ts';
import type {
  ExerciseCandidate,
  PlannedItem,
  PracticeItemReason,
  SelectionContext,
} from './candidates.ts';
import { pickBest, plan, primaryConceptOf, recentTypesOf } from './candidates.ts';

/**
 * Adaptation while a set is in progress (learning-engine.md#진행-중-적응-nextadaptivestep).
 *
 * | event | action |
 * |---|---|
 * | 2 first-try unassisted correct items in a row on a concept | replace one remaining untouched warm-up item (≤ L2) of the concept with one a level harder (`difficulty_step_up`) |
 * | relearning suggestion | append its items: prerequisite check, worked example stages or one easier item (`remedial_*`) |
 * | first answer after viewing the solution | append a sibling of the same variant group, else the same concept and type (`solution_followup`) |
 * | item skipped | append one item of the same concept and difficulty, another type (`skip_followup`) |
 *
 * Items are only appended at the end or replaced while pending and untouched; seen items never
 * change. Assessment sets never adapt; review sets do not step up (their difficulty is fixed).
 */

/** One item of the set as stored (`practice_set_items` + exercise facts). */
export interface SetItemSnapshot {
  readonly id: string;
  readonly position: number;
  readonly exerciseId: ExerciseId;
  readonly targetConceptId: ConceptId | null;
  readonly status: 'pending' | 'answered' | 'skipped';
  readonly reason: string;
  readonly type: string;
  readonly difficulty: number;
  readonly variantGroupKey: string;
  /** Any attempt, hint or solution view happened on the item. */
  readonly touched: boolean;
}

/** Latest outcome of an answered item (the current one included). */
export interface ItemOutcome {
  readonly itemId: string;
  readonly conceptId: ConceptId | null;
  /** Observation `o ≥ 0.5` of the item's latest attempt. */
  readonly correct: boolean;
  /** First try in the item without hint, solution or tutor. */
  readonly unassisted: boolean;
  readonly at: number;
}

export interface AdaptiveRequest extends SelectionContext {
  readonly set: {
    readonly kind: PracticeSetKind;
    /** Items with the current item's new status already applied. */
    readonly items: readonly SetItemSnapshot[];
  };
  /** The item that was just answered or skipped. */
  readonly itemId: string;
  readonly event: 'answered' | 'skipped';
  /** `answered`: outcomes of answered items in submission order, the current one last. */
  readonly outcomes: readonly ItemOutcome[];
  /** `answered`: the first attempt submitted after the learner viewed the item's solution. */
  readonly solutionJustViewed: boolean;
  /** `answered`: the relearning suggestion of this attempt. */
  readonly remediation: RemediationSuggestion | null;
  /**
   * Exercises of the set's own pool for the item's concept (step-up and follow-ups draw from
   * these, so a lesson set stays within lesson-level exercises).
   */
  readonly candidates: readonly ExerciseCandidate[];
  /**
   * Extra exercises for relearning items only: `usage: remedial` exercises of the concept and its
   * prerequisite, and the suggested worked examples.
   */
  readonly remedialCandidates?: readonly ExerciseCandidate[];
  readonly concepts: readonly ConceptState[];
  /** Seeds tie-breaking; use the set ID plus the item ID. */
  readonly seed: string;
}

export type AdaptiveAction =
  | {
      readonly kind: 'replace';
      readonly itemId: string;
      readonly reason: 'difficulty_step_up';
      readonly item: PlannedItem;
    }
  | { readonly kind: 'append'; readonly reason: PracticeItemReason; readonly item: PlannedItem };

/** Reasons that never trigger another follow-up when skipped (no endless sets). */
const NO_FOLLOWUP: ReadonlySet<string> = new Set([
  'solution_followup',
  'skip_followup',
  'remedial_prereq',
  'remedial_worked_example',
  'remedial_easier',
]);

const STEP_UP_KINDS: ReadonlySet<PracticeSetKind> = new Set([
  'lesson',
  'weakness',
  'extra',
  'custom',
]);

/** Upper difficulty of the warm-up band (items a step-up may replace). */
function warmupMax(deps: EngineDeps): number {
  return deps.config.practice.bands.find((b) => b.name === 'warmup')?.maxDifficulty ?? 2;
}

export function nextAdaptiveStep(deps: EngineDeps, input: AdaptiveRequest): AdaptiveAction[] {
  if (input.set.kind === 'assessment') return [];
  const { config } = deps;
  const remedialPool = [...input.candidates, ...(input.remedialCandidates ?? [])];
  const tieBreak = tieBreakKeys(
    input.seed,
    remedialPool.map((c) => c.id),
  );
  const states = new Map(input.concepts.map((s) => [s.mastery.conceptId, s]));
  const inSet = new Set(input.set.items.map((i) => i.exerciseId));
  const usedGroups = new Set(input.set.items.map((i) => i.variantGroupKey));
  const current = input.set.items.find((i) => i.id === input.itemId);
  if (current === undefined) return [];
  const actions: AdaptiveAction[] = [];

  /** Best unused candidate of a concept matching `filter`, aiming at `target` difficulty. */
  const pick = (
    conceptId: ConceptId,
    target: number,
    filter: (c: ExerciseCandidate) => boolean,
    inRange: (c: ExerciseCandidate) => boolean,
    options: { allowGroup?: string; remedial?: boolean } = {},
  ) => {
    const pool = (options.remedial === true ? remedialPool : input.candidates).filter(
      (c) =>
        primaryConceptOf(c) === conceptId &&
        !inSet.has(c.id) &&
        (!usedGroups.has(c.variantGroupKey) || c.variantGroupKey === options.allowGroup) &&
        filter(c),
    );
    const best = pickBest(config, pool, {
      targetDifficulty: target,
      inRange,
      recentTypes: recentTypesOf(config, states.get(conceptId)),
      context: input,
      tieBreak,
    });
    if (best !== null) {
      inSet.add(best.candidate.id);
      usedGroups.add(best.candidate.variantGroupKey);
    }
    return best;
  };
  let nextPosition = Math.max(-1, ...input.set.items.map((i) => i.position)) + 1;
  const append = (
    best: NonNullable<ReturnType<typeof pick>>,
    reason: PracticeItemReason,
    conceptId: ConceptId,
  ) => {
    actions.push({
      kind: 'append',
      reason,
      item: {
        ...plan(best.candidate, best.scored, reason, conceptId, null),
        position: nextPosition,
      },
    });
    nextPosition += 1;
  };

  if (input.event === 'skipped') {
    const conceptId = current.targetConceptId;
    if (conceptId === null || NO_FOLLOWUP.has(current.reason)) return [];
    const best = pick(
      conceptId,
      current.difficulty,
      (c) => c.type !== current.type,
      (c) => c.difficulty === current.difficulty,
    );
    if (best !== null) append(best, 'skip_followup', conceptId);
    return actions;
  }

  // 1. Step up after two first-try unassisted correct items in a row on the concept.
  const conceptId = current.targetConceptId;
  if (conceptId !== null && STEP_UP_KINDS.has(input.set.kind)) {
    const mine = input.outcomes.filter((o) => o.conceptId === conceptId);
    const lastTwo = mine.slice(-2);
    if (
      lastTwo.length === 2 &&
      lastTwo.at(-1)?.itemId === current.id &&
      lastTwo.every((o) => o.correct && o.unassisted)
    ) {
      const firstPending = input.set.items
        .filter((i) => i.status === 'pending')
        .sort((a, b) => a.position - b.position)[0];
      const warmup = input.set.items
        .filter(
          (i) =>
            i.status === 'pending' &&
            !i.touched &&
            i.id !== firstPending?.id &&
            i.targetConceptId === conceptId &&
            i.difficulty <= warmupMax(deps) &&
            i.reason !== 'difficulty_step_up',
        )
        .sort((a, b) => a.position - b.position)[0];
      if (warmup !== undefined) {
        const target = Math.min(5, warmup.difficulty + 1);
        const best = pick(
          conceptId,
          target,
          (c) => c.difficulty === target,
          () => true,
        );
        if (best !== null) {
          actions.push({
            kind: 'replace',
            itemId: warmup.id,
            reason: 'difficulty_step_up',
            item: {
              ...plan(best.candidate, best.scored, 'difficulty_step_up', conceptId, null),
              position: warmup.position,
            },
          });
        }
      }
    }
  }

  // 2. Relearning items.
  const r = input.remediation;
  if (r !== null) {
    if (r.kind === 'prerequisite_check' && r.prerequisite !== null && r.check !== null) {
      const { minDifficulty, maxDifficulty, items } = r.check;
      const picked: NonNullable<ReturnType<typeof pick>>[] = [];
      for (let n = 0; n < items; n++) {
        const best = pick(
          r.prerequisite.conceptId,
          minDifficulty + ((maxDifficulty - minDifficulty) * n) / Math.max(1, items - 1),
          (c) => c.difficulty >= minDifficulty && c.difficulty <= maxDifficulty,
          () => true,
          { remedial: true },
        );
        if (best === null) break;
        picked.push(best);
      }
      // Easiest first, so the check warms up.
      picked.sort((a, b) => a.candidate.difficulty - b.candidate.difficulty);
      for (const best of picked) append(best, 'remedial_prereq', r.prerequisite.conceptId);
    } else if (r.kind === 'worked_example') {
      for (const step of r.workedExamples) {
        const candidate = remedialPool.find((c) => c.id === step.exerciseId);
        if (candidate === undefined || inSet.has(candidate.id)) continue;
        inSet.add(candidate.id);
        usedGroups.add(candidate.variantGroupKey);
        append(
          {
            candidate,
            scored: {
              score: 0,
              factors: {
                freshness: 1,
                difficultyFit: 1,
                typeNovelty: 1,
                misconceptionTarget: 0,
                originPreference: config.practice.originPreference[candidate.origin],
              },
            },
          },
          'remedial_worked_example',
          r.conceptId,
        );
      }
    } else if (r.kind === 'easier_with_hint' && r.targetDifficulty !== null) {
      const target = r.targetDifficulty;
      const best = pick(
        r.conceptId,
        target,
        (c) => c.difficulty <= target,
        (c) => c.difficulty === target,
        { remedial: true },
      );
      if (best !== null) append(best, 'remedial_easier', r.conceptId);
    }
  }

  // 3. A similar exercise after the solution was viewed ("비슷한 문제로 다시 나와요").
  if (input.solutionJustViewed && conceptId !== null) {
    const best =
      pick(
        conceptId,
        current.difficulty,
        (c) => c.variantGroupKey === current.variantGroupKey,
        () => true,
        { allowGroup: current.variantGroupKey },
      ) ??
      pick(
        conceptId,
        current.difficulty,
        (c) => c.type === current.type,
        (c) => c.difficulty === current.difficulty,
      );
    if (best !== null) append(best, 'solution_followup', conceptId);
  }
  return actions;
}
