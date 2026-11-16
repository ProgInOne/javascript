import { describe, expect, it } from 'vitest';
import { initialConceptState } from '../mastery/apply.ts';
import type { ReviewQueueEntry } from '../memory/review-queue.ts';
import { deps, T0 } from '../test/fixtures.ts';
import type { ConceptState, Difficulty, ExerciseCategory } from '../types.ts';
import { createRng } from '../util/rng.ts';
import type { ExerciseCandidate, PlannedItem } from './candidates.ts';
import { interleave } from './order.ts';
import type { ReviewSetConcept, ReviewSetRequest } from './review-set.ts';
import { buildReviewSet } from './review-set.ts';

const TYPES: [string, ExerciseCategory][] = [
  ['predict_output', 'recall'],
  ['fill_blank', 'recall'],
  ['fix_bug', 'production'],
];

function candidates(conceptId: string, count = 6): ExerciseCandidate[] {
  return Array.from({ length: count }, (_, i) => {
    const [type, category] = TYPES[i % TYPES.length] ?? ['predict_output', 'recall'];
    const id = `${conceptId}.r${i}`;
    return {
      id,
      type,
      category,
      difficulty: ((i % 5) + 1) as Difficulty,
      estimatedSeconds: 50 + i,
      variantGroupKey: id,
      origin: i % 2 === 0 ? 'template' : 'authored',
      concepts: [{ conceptId, weight: 1, isPrimary: true }],
    };
  });
}

function entry(conceptId: string, itemCount: 1 | 2 = 1): ReviewQueueEntry {
  return {
    conceptId,
    priority: 1,
    factors: { overdueRatio: 1, importanceFactor: 1, misconceptionFactor: 1 },
    dueAt: T0,
    overdue: false,
    overdueDays: 0,
    itemCount,
    estimatedSeconds: 90 * itemCount,
  };
}

function concept(conceptId: string, moduleId: string, maxDifficultyCorrect = 3): ReviewSetConcept {
  const state: ConceptState = initialConceptState(conceptId);
  return {
    conceptId,
    moduleId,
    state: { ...state, mastery: { ...state.mastery, maxDifficultyCorrect } },
  };
}

function request(overrides: Partial<ReviewSetRequest> = {}): ReviewSetRequest {
  const layout: [string, string, 1 | 2][] = [
    ['m1.a', 'm1', 2],
    ['m1.b', 'm1', 1],
    ['m1.c', 'm1', 1],
    ['m1.d', 'm1', 1],
    ['m2.e', 'm2', 1],
    ['m2.f', 'm2', 2],
  ];
  return {
    entries: layout.map(([id, , n]) => entry(id, n)),
    concepts: layout.map(([id, m]) => concept(id, m)),
    candidates: layout.flatMap(([id]) => candidates(id)),
    lastSeenAtByGroup: {},
    seed: 'review-01',
    now: T0,
    ...overrides,
  };
}

function assertInterleaved(items: readonly PlannedItem[], moduleOf: (id: string) => string) {
  for (let i = 1; i < items.length; i++) {
    expect(items[i]?.targetConceptId).not.toBe(items[i - 1]?.targetConceptId);
  }
  for (let i = 2; i < items.length; i++) {
    const modules = [items[i - 2], items[i - 1], items[i]].map((it) =>
      moduleOf(it?.targetConceptId ?? ''),
    );
    expect(new Set(modules).size).toBeGreaterThan(1);
  }
}

describe('buildReviewSet', () => {
  it('scenario 17: interleaves concepts and modules', () => {
    const { items, rationale } = buildReviewSet(deps, request());
    expect(items).toHaveLength(8);
    assertInterleaved(items, (id) => id.slice(0, 2));
    expect(
      items
        .filter((i) => i.reason === 'review_reinforce')
        .map((i) => i.targetConceptId)
        .sort(),
    ).toEqual(['m1.a', 'm2.f']);
    expect(rationale.estimatedSeconds).toBe(items.reduce((s, i) => s + i.estimatedSeconds, 0));
    expect(new Set(items.map((i) => i.variantGroupKey)).size).toBe(items.length);
  });

  it('targets clamp(maxDifficultyCorrect, 2, 4)', () => {
    const req = request();
    const low = buildReviewSet(deps, {
      ...req,
      entries: [entry('m1.a')],
      concepts: [concept('m1.a', 'm1', 0)],
    });
    expect(low.items[0]?.difficulty).toBe(2);
    const high = buildReviewSet(deps, {
      ...req,
      entries: [entry('m1.a')],
      concepts: [concept('m1.a', 'm1', 5)],
    });
    expect(high.items[0]?.difficulty).toBe(4);
  });

  it('reports concepts without enough candidates', () => {
    const req = request();
    const { items, rationale } = buildReviewSet(deps, {
      ...req,
      entries: [entry('m1.a', 2)],
      concepts: [concept('m1.a', 'm1')],
      candidates: candidates('m1.a', 1),
    });
    expect(items).toHaveLength(1);
    expect(rationale.insufficientCandidates).toEqual([
      { conceptId: 'm1.a', requested: 2, available: 1 },
    ]);
  });

  it('scenario 23: is deterministic for the same seed and independent of input order', () => {
    const req = request();
    const a = buildReviewSet(deps, req);
    expect(
      buildReviewSet(deps, { ...req, candidates: [...req.candidates].reverse() }).items,
    ).toEqual(a.items);
    expect(buildReviewSet(deps, req).items).toEqual(a.items);
  });
});

describe('interleave', () => {
  it('never repeats a concept back to back when that is possible', () => {
    const rng = createRng('interleave');
    for (let run = 0; run < 200; run++) {
      // Up to 3 modules with up to 4 concepts each; each concept 1–2 items.
      const items: { concept: string; module: string; key: number }[] = [];
      const modules = 2 + Math.floor(rng() * 2);
      for (let m = 0; m < modules; m++) {
        const concepts = 1 + Math.floor(rng() * 3);
        for (let c = 0; c < concepts; c++) {
          const n = 1 + Math.floor(rng() * 2);
          for (let k = 0; k < n; k++)
            items.push({ concept: `m${m}c${c}`, module: `m${m}`, key: rng() });
        }
      }
      // Back-to-back concepts are avoidable iff the largest concept has ≤ others + 1 items.
      const groups = Object.values(Object.groupBy(items, (i) => i.concept));
      const maxConcept = Math.max(...groups.map((g) => g?.length ?? 0));
      if (maxConcept > items.length - maxConcept + 1) continue;
      const ordered = interleave(
        items,
        (i) => i,
        (i) => i.key,
      );
      expect(ordered).toHaveLength(items.length);
      for (let i = 1; i < ordered.length; i++)
        expect(ordered[i]?.concept).not.toBe(ordered[i - 1]?.concept);
    }
  });
});

describe('buildReviewSet with template variants (D-057)', () => {
  const DAY = 86_400_000;
  const bank: ExerciseCandidate = {
    id: 'm1.a.bank',
    type: 'predict_output',
    category: 'recall',
    difficulty: 3,
    estimatedSeconds: 60,
    variantGroupKey: 'm1.a.bank',
    origin: 'authored',
    concepts: [{ conceptId: 'm1.a', weight: 1, isPrimary: true }],
  };
  const variant: ExerciseCandidate = {
    ...bank,
    id: 'm1.a.t.sum@5',
    variantGroupKey: 'm1.a.t.sum',
    origin: 'template',
  };
  const base = request({
    entries: [entry('m1.a')],
    concepts: [concept('m1.a', 'm1')],
    candidates: [bank, variant],
    // Both groups last seen 10 days ago (same freshness bracket).
    lastSeenAtByGroup: { 'm1.a.bank': T0 - 10 * DAY, 'm1.a.t.sum': T0 - 10 * DAY },
  });

  it('prefers the bank item by score when repeats are unknown', () => {
    expect(buildReviewSet(deps, base).items.map((i) => i.exerciseId)).toEqual(['m1.a.bank']);
  });

  it('serves a new variant instead of repeating a seen bank item', () => {
    const items = buildReviewSet(deps, {
      ...base,
      seenExerciseIds: new Set(['m1.a.bank', 'm1.a.t.sum@1']),
    }).items;
    expect(items.map((i) => [i.exerciseId, i.exerciseOrigin])).toEqual([
      ['m1.a.t.sum@5', 'template'],
    ]);
  });

  it('still prefers a fresh group over a new variant of a recently seen template', () => {
    const items = buildReviewSet(deps, {
      ...base,
      lastSeenAtByGroup: { 'm1.a.t.sum': T0 - DAY },
      seenExerciseIds: new Set(['m1.a.t.sum@1']),
    }).items;
    expect(items.map((i) => i.exerciseId)).toEqual(['m1.a.bank']);
  });
});
