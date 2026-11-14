import {
  isAiMisconception,
  misconceptionStatusAt,
  observationOf,
  resolutionTarget,
  type ApplyAttemptInput,
  type ConceptGraph,
  type EngineDeps,
  type ExerciseCandidate,
  type MisconceptionState,
  type MisconceptionUpdate,
  type RemediationContext,
  type RemediationSuggestion,
  type WorkedExample,
} from '@proginone/learning-engine';
import type { MisconceptionChange, Remediation } from '@proginone/shared';
import type { ContentRepository } from '../../db/content/repository.ts';
import type { Orm } from '../../db/user/connection.ts';
import { loadConceptStates } from '../../db/user/learning-state.ts';
import {
  listAllObservations,
  loadObservations,
  recentRemediations,
  type StoredObservation,
} from '../../db/user/misconceptions.ts';
import { appliedItemAttempts, type PracticeItemRow } from '../../db/user/practice-sets.ts';

// Learner signals around an attempt: misconception observations and relearning context
// (learning-engine.md#오개념-상태-전이, #재학습-규칙). Reads only; the attempt service writes.

/** The engine's misconception input for an attempt, plus the stored rows it was built from. */
export function misconceptionInput(
  repo: ContentRepository,
  orm: Orm,
  learnerId: string,
  candidate: ExerciseCandidate,
  observedIds: readonly string[],
): {
  input: NonNullable<ApplyAttemptInput['misconceptions']>;
  stored: Map<string, StoredObservation>;
} {
  const known = repo.getMisconceptions(observedIds);
  // Recognition types point to misconceptions through the chosen option; the others through a
  // wrong-answer pattern defined on the exercise.
  const source = candidate.category === 'recognition' ? 'distractor' : 'pattern';
  const observed = observedIds.flatMap((id) => {
    const mc = known.get(id);
    return mc ? [{ misconceptionId: id, conceptId: mc.conceptId, source } as const] : [];
  });
  const targets = repo.misconceptionsTargetedBy(candidate.id);
  const stored = loadObservations(orm, learnerId, [
    ...observed.map((o) => o.misconceptionId),
    ...targets,
  ]);
  return {
    input: { observed, targets, states: [...stored.values()].map((s) => s.state) },
    stored,
  };
}

/** `concept_prerequisites` as the engine graph. */
export function conceptGraph(repo: ContentRepository): ConceptGraph {
  return { prerequisites: repo.listPrerequisites() };
}

/** Concepts reachable over `required` edges within `depth` (the relearning search space). */
function requiredPrerequisites(graph: ConceptGraph, conceptId: string, depth: number): string[] {
  const seen = new Set([conceptId]);
  let frontier = [conceptId];
  for (let d = 0; d < depth; d++) {
    frontier = graph.prerequisites
      .filter((e) => e.strength === 'required' && frontier.includes(e.conceptId))
      .map((e) => e.prerequisiteId)
      .filter((id) => !seen.has(id));
    for (const id of frontier) seen.add(id);
  }
  seen.delete(conceptId);
  return [...seen];
}

/**
 * Relearning context for an attempt on `conceptId` in a set. `items` are the set's items before
 * this attempt; the current item is left out of `setItems`.
 */
export function remediationContext(
  repo: ContentRepository,
  orm: Orm,
  engine: EngineDeps,
  input: {
    learnerId: string;
    conceptId: string;
    setId: string;
    items: readonly PracticeItemRow[];
    currentItemId: string;
    now: number;
  },
): RemediationContext {
  const { learnerId, conceptId, setId, items, currentItemId, now } = input;
  const r = engine.config.remediation;
  const graph = conceptGraph(repo);
  const prerequisites = requiredPrerequisites(graph, conceptId, r.prerequisiteDepth);
  const states = loadConceptStates(orm, learnerId, prerequisites, engine.fsrs);

  const others = items.filter((i) => i.id !== currentItemId);
  const latest = new Map<string, { correct: boolean; at: number }>();
  for (const a of appliedItemAttempts(
    orm,
    others.map((i) => i.id),
  )) {
    if (a.itemId === null) continue;
    latest.set(a.itemId, { correct: observationOf(a) >= 0.5, at: a.submittedAt.getTime() });
  }
  const setItems = others.flatMap((i) => {
    const last = latest.get(i.id);
    return last ? [{ itemId: i.id, conceptId: i.targetConceptId, ...last }] : [];
  });

  const history = recentRemediations(orm, learnerId, conceptId, now - r.historyWindowMs);
  const statusOf = new Map(items.map((i) => [i.id, i.status]));
  const openSuggestionInSet = history.some(
    (h) =>
      h.practiceSetId === setId &&
      (h.itemIds.length === 0 || h.itemIds.some((id) => statusOf.get(id) === 'pending')),
  );

  const workedExamples = repo
    .listExercisesForConcepts([conceptId], ['worked_example'])
    .flatMap((e): WorkedExample[] => {
      const stage = e.workedExampleStage;
      return stage === 0 || stage === 1 || stage === 2
        ? [{ exerciseId: e.id, conceptId, stage }]
        : [];
    });

  return {
    graph,
    states: [...states.values()],
    setItems,
    workedExamples,
    history,
    openSuggestionInSet,
  };
}

/** API view of misconception updates. */
export function misconceptionChanges(
  engine: EngineDeps,
  repo: ContentRepository,
  updates: readonly MisconceptionUpdate[],
): MisconceptionChange[] {
  const titles = repo.getMisconceptions(updates.map((u) => u.misconceptionId));
  return updates.map((u) => ({
    misconceptionId: u.misconceptionId,
    title: titles.get(u.misconceptionId)?.title ?? u.misconceptionId,
    conceptId: u.conceptId,
    statusBefore: u.before?.status ?? null,
    statusAfter: u.after.status,
    transitions: [...u.transitions],
    resolution: resolutionOf(engine, u.after),
  }));
}

export function resolutionOf(engine: EngineDeps, state: MisconceptionState) {
  return {
    done:
      state.status === 'suspected' || state.status === 'confirmed' ? state.resolution.length : 0,
    required: resolutionTarget(engine.config, state.status),
  };
}

/** API view of a relearning suggestion. */
export function remediationView(
  repo: ContentRepository,
  input: { id: string; suggestion: RemediationSuggestion; itemIds: readonly string[] },
): Remediation {
  const s = input.suggestion;
  const ids = [s.conceptId, ...s.prerequisitesChecked.map((p) => p.conceptId)];
  const concepts = repo.getConcepts(ids);
  const title = (id: string) => concepts.get(id)?.title ?? id;
  const lessonId = concepts.get(s.conceptId)?.introducedInLessonId ?? null;
  const lesson = lessonId === null ? null : repo.getLessonPlan(lessonId);
  const ref = (p: RemediationSuggestion['prerequisitesChecked'][number]) => ({
    conceptId: p.conceptId,
    title: title(p.conceptId),
    stage: p.stage,
    effective: p.effective,
  });
  return {
    id: input.id,
    concept: { id: s.conceptId, title: title(s.conceptId) },
    trigger: s.trigger,
    kind: s.kind,
    prerequisite: s.prerequisite === null ? null : ref(s.prerequisite),
    check: s.check === null ? null : { ...s.check },
    workedExampleStages: s.workedExamples.map((w) => w.stage),
    targetDifficulty: s.targetDifficulty,
    autoHintLevel: s.autoHintLevel,
    tutorBadge: s.tutorBadge,
    lesson: lesson ? { id: lesson.id, title: lesson.title } : null,
    prerequisitesChecked: s.prerequisitesChecked.map((p) => ({
      ...ref(p),
      depth: p.depth,
      weak: p.weak,
    })),
    itemIds: [...input.itemIds],
  };
}

/**
 * Active (`suspected`/`confirmed`, time rules applied) content misconceptions per concept.
 * AI-proposed rows are left out: they never feed selection, priority or weakness.
 */
export function activeMisconceptionsByConcept(
  engine: EngineDeps,
  orm: Orm,
  learnerId: string,
  now: number,
): Map<string, { confirmed: string[]; suspected: string[] }> {
  const out = new Map<string, { confirmed: string[]; suspected: string[] }>();
  for (const { state } of listAllObservations(orm, learnerId)) {
    if (isAiMisconception(state.misconceptionId)) continue;
    const status = misconceptionStatusAt(engine.config, state, now);
    if (status !== 'suspected' && status !== 'confirmed') continue;
    const entry = out.get(state.conceptId) ?? { confirmed: [], suspected: [] };
    if (
      !entry.confirmed.includes(state.misconceptionId) &&
      !entry.suspected.includes(state.misconceptionId)
    ) {
      entry[status].push(state.misconceptionId);
    }
    out.set(state.conceptId, entry);
  }
  return out;
}

/** Exercises that target the learner's active misconceptions (`misconceptionTarget` = 1). */
export function misconceptionTargetIds(
  repo: ContentRepository,
  active: ReadonlyMap<string, { confirmed: string[]; suspected: string[] }>,
): string[] {
  const targets = repo.misconceptionTargets();
  const out = new Set<string>();
  for (const { confirmed, suspected } of active.values()) {
    for (const mc of [...confirmed, ...suspected]) {
      for (const ex of targets.get(mc) ?? []) out.add(ex);
    }
  }
  return [...out].sort();
}
