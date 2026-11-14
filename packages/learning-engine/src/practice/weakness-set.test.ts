/**
 * Weakness ranking and weakness sets (learning-engine.md#약점-집중-세트).
 */
import { describe, expect, it } from 'vitest';
import { initialConceptState } from '../mastery/initial.ts';
import { deps, T0 } from '../test/fixtures.ts';
import type { ConceptState, Importance } from '../types.ts';
import type { ExerciseCandidate } from './candidates.ts';
import type { WeakConceptInput } from './weakness-set.ts';
import { buildWeaknessSet, rankWeakConcepts, selectWeaknessTargets } from './weakness-set.ts';

function concept(
  conceptId: string,
  score: number,
  overrides: Partial<ConceptState['mastery']> = {},
): ConceptState {
  const base = initialConceptState(conceptId);
  return { ...base, mastery: { ...base.mastery, score, stage: 'practicing', ...overrides } };
}

function weak(
  state: ConceptState,
  importance: Importance = 'standard',
  confirmed = 0,
  suspected = 0,
): WeakConceptInput {
  return {
    state,
    importance,
    confirmedMisconceptions: confirmed,
    suspectedMisconceptions: suspected,
  };
}

function candidates(conceptId: string, perLevel: number, types = ['predict_output', 'mcq_single']) {
  const out: ExerciseCandidate[] = [];
  for (let d = 1; d <= 5; d++) {
    for (let n = 0; n < perLevel; n++) {
      const id = `${conceptId}.L${d}.${n}`;
      out.push({
        id,
        type: types[n % types.length] ?? 'predict_output',
        category: 'recall',
        difficulty: d as ExerciseCandidate['difficulty'],
        estimatedSeconds: 60,
        variantGroupKey: id,
        concepts: [{ conceptId, weight: 1, isPrimary: true }],
        origin: 'authored',
      });
    }
  }
  return out;
}

describe('rankWeakConcepts', () => {
  it('follows the weakness formula and skips concepts below introduced', () => {
    const ranked = rankWeakConcepts(deps, {
      concepts: [
        weak(concept('a', 50), 'core', 1, 2),
        weak(concept('b', 50, { consecutiveFailures: 5 })),
        weak(concept('c', 90)),
        weak(concept('d', 0, { stage: 'not_started' })),
      ],
      now: T0,
    });
    expect(ranked.map((e) => e.conceptId)).toEqual(['a', 'b', 'c']);
    // (100 − 50) × 1.3 × (1 + 0.5 + 0.5) × 1
    expect(ranked[0]?.weakness).toBeCloseTo(130, 6);
    expect(ranked[0]?.factors).toEqual({
      gap: 50,
      importanceFactor: 1.3,
      misconceptionFactor: 2,
      failureFactor: 1,
    });
    // (100 − 50) × 1 × 1 × (1 + 0.2 × 3)
    expect(ranked[1]?.weakness).toBeCloseTo(80, 6);
  });

  it('selects the top three, then up to five while at least half as weak as the top', () => {
    const entries = rankWeakConcepts(deps, {
      concepts: [10, 20, 30, 40, 50, 60, 95].map((score, i) => weak(concept(`c${i}`, score))),
      now: T0,
    });
    // Weakness 90, 80, 70, 60, 50, 40, 5: the top three, then 60 and 50 (≥ 45).
    expect(selectWeaknessTargets(deps, entries).map((e) => e.conceptId)).toEqual([
      'c0',
      'c1',
      'c2',
      'c3',
      'c4',
    ]);
    const few = entries.slice(-2);
    expect(selectWeaknessTargets(deps, few).map((e) => e.conceptId)).toEqual(['c5', 'c6']);
  });
});

describe('buildWeaknessSet', () => {
  it('plans a ladder per concept from maxDifficultyCorrect − 1 and interleaves concepts', () => {
    const a = concept('a', 50, { maxDifficultyCorrect: 3 });
    const b = concept('b', 30, { maxDifficultyCorrect: 0 });
    const targets = rankWeakConcepts(deps, { concepts: [weak(a), weak(b)], now: T0 });
    const set = buildWeaknessSet(deps, {
      targets,
      concepts: [a, b],
      candidates: [...candidates('a', 2), ...candidates('b', 2)],
      confirmedTargetIds: {},
      lastSeenAtByGroup: {},
      seed: 'set-w',
      now: T0,
    });
    // b is weaker (effective 30 < 40 → 4 items), a has 3 items.
    expect(set.rationale.ladders).toEqual({ b: [1, 1, 2, 3], a: [2, 3, 4] });
    expect(set.items.map((i) => [i.targetConceptId, i.difficulty])).toEqual([
      ['b', 1],
      ['a', 2],
      ['b', 1],
      ['a', 3],
      ['b', 2],
      ['a', 4],
      ['b', 3],
    ]);
    expect(set.items.map((i) => i.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(new Set(set.items.map((i) => i.variantGroupKey)).size).toBe(7);
    expect(set.items.every((i) => i.reason === 'weak_concept')).toBe(true);
  });

  it('puts an exercise targeting a confirmed misconception within the first two items', () => {
    const a = concept('a', 60, { maxDifficultyCorrect: 2 });
    const targets = rankWeakConcepts(deps, { concepts: [weak(a, 'standard', 1)], now: T0 });
    const pool = candidates('a', 2);
    const set = buildWeaknessSet(deps, {
      targets,
      concepts: [a],
      candidates: pool,
      confirmedTargetIds: { a: ['a.L4.1'] },
      lastSeenAtByGroup: {},
      seed: 'set-w',
      now: T0,
    });
    expect(set.items).toHaveLength(4);
    expect(set.items.slice(0, 2).map((i) => i.exerciseId)).toContain('a.L4.1');
    expect(set.items.find((i) => i.exerciseId === 'a.L4.1')?.reason).toBe('misconception_target');
  });

  it('records shortages and stays deterministic', () => {
    const a = concept('a', 20);
    const targets = rankWeakConcepts(deps, { concepts: [weak(a)], now: T0 });
    const input = {
      targets,
      concepts: [a],
      candidates: candidates('a', 1).slice(0, 2),
      confirmedTargetIds: {},
      lastSeenAtByGroup: {},
      seed: 'set-w',
      now: T0,
    };
    const set = buildWeaknessSet(deps, input);
    expect(set.rationale.insufficientCandidates).toEqual([
      { conceptId: 'a', requested: 4, available: 2 },
    ]);
    expect(buildWeaknessSet(deps, input)).toEqual(set);
  });
});
