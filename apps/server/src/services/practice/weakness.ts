import {
  buildWeaknessSet,
  inspectPrerequisites,
  rankWeakConcepts,
  selectWeaknessTargets,
  type EngineDeps,
  type WeakConceptEntry,
} from '@proginone/learning-engine';
import type { WeakConcept, WeakConcepts } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { excludedExerciseIds } from '../../db/user/exercise-records.ts';
import { listMasteryConceptIds, loadConceptStates } from '../../db/user/learning-state.ts';
import { lastSeenAtByGroup, seenExerciseIds } from '../../db/user/practice-sets.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { candidateOf, learnerContext } from './engine.ts';
import { activeMisconceptionsByConcept, conceptGraph, misconceptionTargetIds } from './signals.ts';
import { templateCandidates } from './templates.ts';

/** Concepts shown on the weakness screen (ui-ux.md#약점-집중: "최대 10개"). */
export const WEAK_CONCEPTS_SHOWN = 10;

/** Weak concept ranking and weakness sets (learning-engine.md#약점-집중-세트). */
export class WeaknessService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #engine: EngineDeps;
  readonly #now: Clock;

  constructor(deps: { userDb: UserDb; content: ContentAccess; engine: EngineDeps; now: Clock }) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#engine = deps.engine;
    this.#now = deps.now;
  }

  /**
   * `rankWeakConcepts` over every concept with records that the content pack still has.
   * `entries` keeps only weak concepts: below the weakness bar (`dailyPlan.weaknessBelowEffective`)
   * or with a confirmed misconception. The weakness score is positive for anything under 100, so
   * without the bar a concept stayed "weak" after practice raised it. `ranked` is every concept,
   * for sets the learner asks for by name (D-095).
   */
  rank(now = this.#now()) {
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const { learnerId } = learnerContext(this.#userDb);
    const ids = listMasteryConceptIds(orm, learnerId);
    const concepts = repo.getConcepts(ids);
    const states = loadConceptStates(orm, learnerId, ids, this.#engine.fsrs);
    const active = activeMisconceptionsByConcept(this.#engine, orm, learnerId, now);
    const ranked = rankWeakConcepts(this.#engine, {
      concepts: ids.flatMap((id) => {
        const concept = concepts.get(id);
        const state = states.get(id);
        if (!concept || !state) return [];
        return [
          {
            state,
            importance: concept.importance,
            confirmedMisconceptions: active.get(id)?.confirmed.length ?? 0,
            suspectedMisconceptions: active.get(id)?.suspected.length ?? 0,
          },
        ];
      }),
      now,
    });
    const bar = this.#engine.config.dailyPlan.weaknessBelowEffective;
    const entries = ranked.filter((e) => e.effective < bar || e.confirmedMisconceptions > 0);
    return { entries, ranked, states, active, concepts, learnerId, now };
  }

  /** `GET /weak-concepts`. */
  list(): WeakConcepts {
    const repo = this.#content.repo;
    const { entries, active, now } = this.rank();
    const shown = entries.filter((e) => e.weakness > 0).slice(0, WEAK_CONCEPTS_SHOWN);
    const graph = conceptGraph(repo);
    const prereqIds = graph.prerequisites
      .filter((e) => e.strength === 'required' && shown.some((s) => s.conceptId === e.conceptId))
      .map((e) => e.prerequisiteId);
    const titles = repo.getConcepts([...shown.map((e) => e.conceptId), ...prereqIds]);
    const prereqStates = loadConceptStates(
      this.#userDb.orm,
      learnerContext(this.#userDb).learnerId,
      prereqIds,
      this.#engine.fsrs,
    );
    const mcIds = shown.flatMap((e) => {
      const a = active.get(e.conceptId);
      return a ? [...a.confirmed, ...a.suspected] : [];
    });
    const mcTitles = repo.getMisconceptions(mcIds);
    const title = (id: string) => titles.get(id)?.title ?? id;
    const view = (e: WeakConceptEntry): WeakConcept => {
      const a = active.get(e.conceptId);
      return {
        concept: { id: e.conceptId, title: title(e.conceptId) },
        weakness: e.weakness,
        effective: e.effective,
        stage: e.stage,
        consecutiveFailures: e.consecutiveFailures,
        factors: { ...e.factors },
        misconceptions: [
          ...(a?.confirmed ?? []).map((id) => ({ id, status: 'confirmed' as const })),
          ...(a?.suspected ?? []).map((id) => ({ id, status: 'suspected' as const })),
        ].map((m) => ({ ...m, title: mcTitles.get(m.id)?.title ?? m.id })),
        prerequisites: inspectPrerequisites(this.#engine, {
          conceptId: e.conceptId,
          context: {
            graph: {
              prerequisites: graph.prerequisites.filter((p) => p.conceptId === e.conceptId),
            },
            states: [...prereqStates.values()],
            setItems: [],
            workedExamples: [],
            history: [],
            openSuggestionInSet: false,
          },
          now,
        }).map((p) => ({
          concept: { id: p.conceptId, title: title(p.conceptId) },
          stage: p.stage,
          effective: p.effective,
          weak: p.weak,
        })),
      };
    };
    return {
      concepts: shown.map(view),
      suggested: selectWeaknessTargets(this.#engine, entries).map((e) => e.conceptId),
    };
  }

  /**
   * Plans a weakness set: the learner's `conceptIds` (in that order, if they have records, even
   * above the weakness bar), or the automatic targets. Null when there is nothing to practise.
   */
  planSet(seed: string, conceptIds?: readonly string[]) {
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const { entries, ranked, states, active, learnerId, now } = this.rank();
    const targets =
      conceptIds === undefined
        ? selectWeaknessTargets(this.#engine, entries)
        : conceptIds.flatMap((id) => ranked.filter((e) => e.conceptId === id));
    if (targets.length === 0) return null;
    const ids = targets.map((t) => t.conceptId);
    const excluded = excludedExerciseIds(orm, learnerId);
    const candidates = [
      ...repo
        .listExercisesForConcepts(ids, ['practice', 'remedial'])
        .filter((e) => !excluded.has(e.id)),
      ...templateCandidates({
        repo,
        orm,
        learnerId,
        templates: repo.listTemplates({ conceptIds: ids, usages: ['practice', 'remedial'] }),
        seed,
        excluded,
      }),
    ]
      .map(candidateOf)
      .filter((c) => c !== null);
    const allTargets = repo.misconceptionTargets();
    const confirmedTargetIds = Object.fromEntries(
      ids.map((id) => [
        id,
        (active.get(id)?.confirmed ?? []).flatMap((mc) => [...(allTargets.get(mc) ?? [])]),
      ]),
    );
    const plan = buildWeaknessSet(this.#engine, {
      targets,
      concepts: ids.flatMap((id) => {
        const state = states.get(id);
        return state ? [state] : [];
      }),
      candidates,
      confirmedTargetIds,
      lastSeenAtByGroup: lastSeenAtByGroup(orm, learnerId),
      seenExerciseIds: seenExerciseIds(orm, learnerId),
      misconceptionTargetIds: misconceptionTargetIds(repo, active),
      seed,
      now,
    });
    return { learnerId, now, conceptIds: ids, items: plan.items, rationale: plan.rationale };
  }
}
