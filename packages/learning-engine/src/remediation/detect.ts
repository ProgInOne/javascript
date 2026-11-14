import type { EngineDeps } from '../config.ts';
import { initialConceptState } from '../mastery/initial.ts';
import { effectiveMastery } from '../mastery/effective.ts';
import type {
  ConceptId,
  ConceptState,
  EvidenceFact,
  ExerciseId,
  MasteryStage,
  PracticeSetKind,
} from '../types.ts';
import { MASTERY_STAGES } from '../types.ts';

/**
 * Relearning (learning-engine.md#재학습-규칙, FR-LRN-05). The result is a suggestion the learner
 * may decline; the engine never locks content.
 *
 * Escalation for one concept, using earlier suggestions inside `historyWindowMs`:
 * 1. a weak `required` prerequisite (depth ≤ 2) not checked yet → prerequisite check set
 * 2. worked example stages not done yet → those stages (0 full solution → 1 blanks → 2 solve)
 * 3. no worked example and no easier item yet → one item a level easier with hint 1 opened
 * 4. otherwise (stage 2 or the easier item done and still failing) → reread the lesson section,
 *    with the tutor badge (a hint only; the tutor never opens by itself, D-010)
 */

export interface ConceptPrerequisite {
  readonly conceptId: ConceptId;
  readonly prerequisiteId: ConceptId;
  readonly strength: 'required' | 'helpful';
}

/** `concept_prerequisites` edges (content.db). */
export interface ConceptGraph {
  readonly prerequisites: readonly ConceptPrerequisite[];
}

export type RemediationTrigger = 'set_consecutive_failures' | 'recent_consecutive_failures';
export type RemediationKind =
  'prerequisite_check' | 'worked_example' | 'easier_with_hint' | 'reread_lesson';

/** Latest outcome of one earlier item of the current set. */
export interface SetItemOutcome {
  readonly itemId: string;
  /** `practice_set_items.target_concept_id`. */
  readonly conceptId: ConceptId | null;
  /** Observation `o ≥ 0.5` of the item's latest attempt. */
  readonly correct: boolean;
  /** Submission time of that attempt. */
  readonly at: number;
}

/** A worked example exercise (`usage: worked_example`) of a concept. */
export interface WorkedExample {
  readonly exerciseId: ExerciseId;
  readonly conceptId: ConceptId;
  readonly stage: 0 | 1 | 2;
}

/** An earlier suggestion (`remediation_suggestions` row). */
export interface RemediationHistoryEntry {
  readonly conceptId: ConceptId;
  readonly kind: RemediationKind;
  readonly prerequisiteId: ConceptId | null;
  /** Highest worked example stage the suggestion contained. */
  readonly workedExampleStage: number | null;
  readonly at: number;
}

export interface RemediationContext {
  readonly graph: ConceptGraph;
  /** States of the concept's prerequisites up to depth 2. Missing concepts are `not_started`. */
  readonly states: readonly ConceptState[];
  /** Earlier items of the current set (the current item excluded); empty outside a set. */
  readonly setItems: readonly SetItemOutcome[];
  readonly workedExamples: readonly WorkedExample[];
  /** Suggestions for this concept (any set), newest last. */
  readonly history: readonly RemediationHistoryEntry[];
  /**
   * The current set already holds a suggestion for this concept whose items are not finished.
   * No new suggestion is made until the learner has gone through it.
   */
  readonly openSuggestionInSet: boolean;
}

/** One prerequisite looked at, for the explanation ("선수 개념 상태"). */
export interface PrerequisiteCheck {
  readonly conceptId: ConceptId;
  readonly depth: number;
  readonly effective: number;
  readonly stage: MasteryStage;
  readonly weak: boolean;
  /** Checked by an earlier suggestion inside the history window: skipped this time. */
  readonly recentlyChecked: boolean;
}

export interface RemediationSuggestion {
  readonly conceptId: ConceptId;
  readonly trigger: RemediationTrigger;
  readonly kind: RemediationKind;
  /** `prerequisite_check`: the weakest prerequisite at the shallowest weak depth. */
  readonly prerequisite: PrerequisiteCheck | null;
  /** `prerequisite_check`: size, difficulty range and pass threshold of the check set. */
  readonly check: {
    readonly items: number;
    readonly minDifficulty: number;
    readonly maxDifficulty: number;
    readonly passCorrect: number;
  } | null;
  /** `worked_example`: remaining stages in order. */
  readonly workedExamples: readonly { readonly exerciseId: ExerciseId; readonly stage: number }[];
  /** `easier_with_hint`: difficulty of the easier item. */
  readonly targetDifficulty: number | null;
  /** `easier_with_hint`: hint level to open automatically. */
  readonly autoHintLevel: number;
  /** `reread_lesson`: show the tutor badge (suggestion only). */
  readonly tutorBadge: boolean;
  /** Every prerequisite inspected (explanation). */
  readonly prerequisitesChecked: readonly PrerequisiteCheck[];
}

/**
 * Whether relearning triggers after an attempt on `conceptId` (its primary concept):
 * - the attempt is wrong and the previous `setFailures − 1` items of the same concept in this set
 *   were wrong too, or
 * - `recentFailures` or more primary failures in a row (since the last unassisted correct answer)
 *   fall inside the last `recentWindowMs`.
 * Assessment sets never trigger (help is locked; the end screen suggests weakness practice).
 */
export function remediationTrigger(
  deps: EngineDeps,
  input: {
    readonly conceptId: ConceptId;
    /** The current attempt as an evidence fact of the concept. */
    readonly fact: EvidenceFact;
    /** Concept history including the current fact. */
    readonly history: readonly EvidenceFact[];
    readonly setKind: PracticeSetKind | null;
    readonly context: RemediationContext;
    readonly now: number;
  },
): RemediationTrigger | null {
  const r = deps.config.remediation;
  const { fact, context, now } = input;
  if (fact.correct || input.setKind === 'assessment' || context.openSuggestionInSet) return null;

  const earlier = context.setItems
    .filter((item) => item.conceptId === input.conceptId)
    .sort((a, b) => a.at - b.at)
    .slice(-(r.setFailures - 1));
  if (
    input.setKind !== null &&
    earlier.length === r.setFailures - 1 &&
    earlier.every((item) => !item.correct)
  ) {
    return 'set_consecutive_failures';
  }

  const primary = input.history.filter((f) => f.isPrimary).sort((a, b) => b.at - a.at);
  let recent = 0;
  for (const f of primary) {
    if (f.correct && f.unassisted) break;
    if (!f.correct && now - f.at < r.recentWindowMs) recent += 1;
  }
  return recent >= r.recentFailures ? 'recent_consecutive_failures' : null;
}

function stageIndex(stage: MasteryStage): number {
  return MASTERY_STAGES.indexOf(stage);
}

/**
 * Breadth-first search over `required` edges up to `prerequisiteDepth`. A prerequisite is weak
 * when `effective < 60` or its stage is below `practicing`.
 */
export function inspectPrerequisites(
  deps: EngineDeps,
  input: {
    readonly conceptId: ConceptId;
    readonly context: RemediationContext;
    readonly now: number;
  },
): PrerequisiteCheck[] {
  const r = deps.config.remediation;
  const { context, now } = input;
  const states = new Map(context.states.map((s) => [s.mastery.conceptId, s]));
  const checkedRecently = new Set(
    context.history
      .filter((h) => h.kind === 'prerequisite_check' && now - h.at < r.historyWindowMs)
      .flatMap((h) => (h.prerequisiteId === null ? [] : [h.prerequisiteId])),
  );
  const seen = new Set<ConceptId>([input.conceptId]);
  const out: PrerequisiteCheck[] = [];
  let frontier = [input.conceptId];
  for (let depth = 1; depth <= r.prerequisiteDepth && frontier.length > 0; depth++) {
    const next: ConceptId[] = [];
    for (const id of frontier) {
      for (const edge of context.graph.prerequisites) {
        if (edge.conceptId !== id || edge.strength !== 'required') continue;
        if (seen.has(edge.prerequisiteId)) continue;
        seen.add(edge.prerequisiteId);
        next.push(edge.prerequisiteId);
        const state = states.get(edge.prerequisiteId) ?? initialConceptState(edge.prerequisiteId);
        const { effective } = effectiveMastery(deps, state.mastery.score, state.memory, now);
        out.push({
          conceptId: edge.prerequisiteId,
          depth,
          effective,
          stage: state.mastery.stage,
          weak:
            effective < r.weakPrerequisiteBelow ||
            stageIndex(state.mastery.stage) < stageIndex('practicing'),
          recentlyChecked: checkedRecently.has(edge.prerequisiteId),
        });
      }
    }
    frontier = next.sort();
  }
  return out;
}

/** Decides the relearning step for a triggered concept (see the module comment). */
export function detectRemediation(
  deps: EngineDeps,
  input: {
    readonly conceptId: ConceptId;
    readonly trigger: RemediationTrigger;
    /** Difficulty of the exercise just failed (the easier item goes one level below). */
    readonly failedDifficulty: number;
    readonly context: RemediationContext;
    readonly now: number;
  },
): RemediationSuggestion {
  const r = deps.config.remediation;
  const { conceptId, trigger, context, now } = input;
  const checked = inspectPrerequisites(deps, { conceptId, context, now });
  const base = {
    conceptId,
    trigger,
    prerequisite: null,
    check: null,
    workedExamples: [],
    targetDifficulty: null,
    autoHintLevel: 0,
    tutorBadge: false,
    prerequisitesChecked: checked,
  } satisfies Omit<RemediationSuggestion, 'kind'>;

  const candidates = checked.filter((c) => c.weak && !c.recentlyChecked);
  const shallowest = Math.min(...candidates.map((c) => c.depth));
  const weakest = candidates
    .filter((c) => c.depth === shallowest)
    .sort((a, b) => a.effective - b.effective || (a.conceptId < b.conceptId ? -1 : 1))[0];
  if (weakest !== undefined) {
    return {
      ...base,
      kind: 'prerequisite_check',
      prerequisite: weakest,
      check: {
        items: r.checkItems,
        minDifficulty: r.checkMinDifficulty,
        maxDifficulty: r.checkMaxDifficulty,
        passCorrect: r.checkPassCorrect,
      },
    };
  }

  const recent = context.history.filter(
    (h) => h.conceptId === conceptId && now - h.at < r.historyWindowMs,
  );
  const doneStage = Math.max(
    -1,
    ...recent.filter((h) => h.kind === 'worked_example').map((h) => h.workedExampleStage ?? -1),
  );
  const byStage = new Map<number, ExerciseId>();
  for (const ex of [...context.workedExamples]
    .filter((ex) => ex.conceptId === conceptId && ex.stage > doneStage)
    .sort((a, b) => a.stage - b.stage || (a.exerciseId < b.exerciseId ? -1 : 1))) {
    if (!byStage.has(ex.stage)) byStage.set(ex.stage, ex.exerciseId);
  }
  if (byStage.size > 0) {
    return {
      ...base,
      kind: 'worked_example',
      workedExamples: [...byStage].map(([stage, exerciseId]) => ({ exerciseId, stage })),
    };
  }

  const triedEasier = recent.some((h) => h.kind === 'easier_with_hint');
  const triedExamples = recent.some((h) => h.kind === 'worked_example');
  if (!triedEasier && !triedExamples) {
    return {
      ...base,
      kind: 'easier_with_hint',
      targetDifficulty: Math.max(1, input.failedDifficulty - 1),
      autoHintLevel: 1,
    };
  }
  return { ...base, kind: 'reread_lesson', tutorBadge: true };
}
