import { describe, expect, it } from 'vitest';
import { initialConceptState } from '../mastery/apply.ts';
import { deps, T0 } from '../test/fixtures.ts';
import type { Difficulty, ExerciseCategory, Importance } from '../types.ts';
import { DAY_MS } from '../util/time.ts';
import type { ExerciseCandidate, PlannedItem } from './candidates.ts';
import type { LessonSetRequest } from './lesson-set.ts';
import { buildLessonPracticeSet } from './lesson-set.ts';

const TYPES: [string, ExerciseCategory][] = [
  ['mcq_single', 'recognition'],
  ['predict_output', 'recall'],
  ['fill_blank', 'recall'],
  ['implement_function', 'production'],
];

function candidate(
  conceptId: string,
  i: number,
  overrides: Partial<ExerciseCandidate> = {},
): ExerciseCandidate {
  const [type, category] = TYPES[i % TYPES.length] ?? ['mcq_single', 'recognition'];
  const id = `${conceptId}.ex${i}`;
  return {
    id,
    type,
    category,
    difficulty: ((i % 4) + 1) as Difficulty,
    estimatedSeconds: 60,
    variantGroupKey: id,
    origin: 'authored',
    concepts: [{ conceptId, weight: 1, isPrimary: true }],
    ...overrides,
  };
}

function pool(conceptId: string, count: number, overrides: Partial<ExerciseCandidate> = {}) {
  return Array.from({ length: count }, (_, i) => candidate(conceptId, i, overrides));
}

function request(overrides: Partial<LessonSetRequest> = {}): LessonSetRequest {
  const intro: [string, Importance][] = [
    ['c.a', 'core'],
    ['c.b', 'standard'],
    ['c.c', 'standard'],
    ['c.d', 'minor'],
  ];
  return {
    lesson: {
      id: 'js-basics.values.variables',
      importance: 'core',
      introduces: intro.map(([id]) => id),
      reviews: [],
    },
    concepts: intro.map(([conceptId, importance]) => ({ conceptId, importance })),
    candidates: intro.flatMap(([id]) => pool(id, 12)),
    lastSeenAtByGroup: {},
    seed: 'set-01',
    now: T0,
    ...overrides,
  };
}

function maxTypeRun(items: readonly PlannedItem[]): number {
  let best = 0;
  let run = 0;
  items.forEach((item, i) => {
    run = i > 0 && items[i - 1]?.type === item.type ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

describe('buildLessonPracticeSet', () => {
  it('scenario 14: core lesson with four concepts', () => {
    const { items, rationale, passRule } = buildLessonPracticeSet(deps, request());
    expect(items).toHaveLength(22);
    expect(items.map((item) => item.position)).toEqual([...Array(22).keys()]);

    // Minimum three per concept; the rest by importance (core 3 : standard 2 : minor 1),
    // highest averages with ties in lesson order.
    const perConcept = (id: string) => items.filter((item) => item.targetConceptId === id).length;
    for (const id of ['c.a', 'c.b', 'c.c', 'c.d']) expect(perConcept(id)).toBeGreaterThanOrEqual(3);
    expect(rationale.quotas).toEqual({ 'c.a': 7, 'c.b': 6, 'c.c': 5, 'c.d': 4 });

    // Band ratio 30/50/20 per concept, each item inside its band.
    const bandCounts = (id: string) =>
      ['warmup', 'core', 'challenge'].map(
        (band) => items.filter((item) => item.targetConceptId === id && item.band === band).length,
      );
    expect(bandCounts('c.a')).toEqual([2, 4, 1]);
    expect(bandCounts('c.d')).toEqual([1, 2, 1]);
    const ranges = { warmup: [1, 2], core: [2, 3], challenge: [3, 4] } as const;
    for (const item of items) {
      if (item.band === null) continue;
      const [min, max] = ranges[item.band];
      expect(item.difficulty).toBeGreaterThanOrEqual(min);
      expect(item.difficulty).toBeLessThanOrEqual(max);
    }

    expect(maxTypeRun(items)).toBeLessThanOrEqual(2);
    expect(new Set(items.map((item) => item.variantGroupKey)).size).toBe(22);
    expect(items.some((item) => item.type === 'implement_function')).toBe(true);
    expect(rationale.productionIncluded).toBe(true);
    expect(rationale.insufficientCandidates).toEqual([]);
    expect(passRule).toEqual({
      minCorrect: 0.7,
      minConceptCredit: 0.6,
      minDistinctTypes: 2,
      minLevel3Correct: 1,
    });

    // Mostly easy → hard: the first item is not harder than the last.
    expect(items[0]?.difficulty ?? 0).toBeLessThanOrEqual(items.at(-1)?.difficulty ?? 0);
  });

  it('scenario 15: two candidates per concept fill what they can and report the shortage', () => {
    const req = request();
    const { items, rationale } = buildLessonPracticeSet(deps, {
      ...req,
      candidates: req.lesson.introduces.flatMap((id) => pool(id, 2)),
    });
    expect(items).toHaveLength(8);
    expect(rationale.size).toBe(8);
    expect(rationale.requestedSize).toBe(22);
    expect(rationale.insufficientCandidates).toEqual(
      ['c.a', 'c.b', 'c.c', 'c.d'].map((conceptId) => ({ conceptId, requested: 3, available: 2 })),
    );
  });

  it('scenario 23: same input and seed give the same order, regardless of input order', () => {
    const req = request();
    const a = buildLessonPracticeSet(deps, req);
    const b = buildLessonPracticeSet(deps, { ...req, candidates: [...req.candidates].reverse() });
    expect(b.items).toEqual(a.items);
    expect(buildLessonPracticeSet(deps, req).items).toEqual(a.items);
  });

  it('uses lesson size by importance and applies pass rule overrides', () => {
    const req = request();
    const minor = buildLessonPracticeSet(deps, {
      ...req,
      lesson: {
        ...req.lesson,
        importance: 'minor',
        introduces: ['c.a', 'c.b'],
        passRule: { minDistinctTypes: 3 },
      },
    });
    expect(minor.items).toHaveLength(8);
    // The per-concept minimum wins over the lesson size: four concepts need 12 items.
    expect(
      buildLessonPracticeSet(deps, { ...req, lesson: { ...req.lesson, importance: 'minor' } })
        .items,
    ).toHaveLength(12);
    expect(minor.passRule).toEqual({
      minCorrect: 0.7,
      minConceptCredit: 0.6,
      minDistinctTypes: 3,
      minLevel3Correct: 0,
    });
    expect(
      buildLessonPracticeSet(deps, { ...req, lesson: { ...req.lesson, importance: 'standard' } })
        .items,
    ).toHaveLength(14);
  });

  it('puts one exercise per variant group in a set', () => {
    const shared = pool('c.a', 12).map((c, i) => ({ ...c, variantGroupKey: `tpl-${i % 3}` }));
    const req = request();
    const { items } = buildLessonPracticeSet(deps, {
      ...req,
      lesson: { ...req.lesson, introduces: ['c.a'] },
      concepts: [{ conceptId: 'c.a', importance: 'core' }],
      candidates: shared,
    });
    expect(items).toHaveLength(3);
    expect(new Set(items.map((i) => i.variantGroupKey)).size).toBe(3);
  });

  it('avoids variant groups served in the last 7 days when others exist', () => {
    const req = request();
    const candidates = pool('c.a', 6);
    const recent = Object.fromEntries(
      candidates.slice(0, 3).map((c) => [c.variantGroupKey, T0 - 2 * DAY_MS]),
    );
    const { items } = buildLessonPracticeSet(deps, {
      ...req,
      lesson: { ...req.lesson, importance: 'minor', introduces: ['c.a'] },
      concepts: [{ conceptId: 'c.a', importance: 'core' }],
      candidates,
      lastSeenAtByGroup: recent,
    });
    // All six are needed for an 8-item set; the three fresh ones come first in each band choice.
    expect(items).toHaveLength(6);
    const fresh = buildLessonPracticeSet(deps, {
      ...req,
      lesson: { ...req.lesson, importance: 'minor', introduces: ['c.a', 'c.b'] },
      concepts: [
        { conceptId: 'c.a', importance: 'minor' },
        { conceptId: 'c.b', importance: 'core' },
      ],
      candidates: [...candidates, ...pool('c.b', 12)],
      lastSeenAtByGroup: recent,
    });
    const chosenA = fresh.items.filter((i) => i.targetConceptId === 'c.a');
    expect(chosenA).toHaveLength(3);
    expect(chosenA.every((i) => i.factors.freshness > 0)).toBe(true);
  });

  it('swaps in a production exercise when the bands picked none', () => {
    const req = request();
    // The only production exercise was served 2 days ago, so band filling skips it.
    const production = candidate('c.a', 99, { type: 'fix_bug', category: 'production' });
    const candidates = [
      ...pool('c.a', 8, { type: 'predict_output', category: 'recall' }),
      production,
    ];
    const { items, rationale } = buildLessonPracticeSet(deps, {
      ...req,
      lesson: { ...req.lesson, importance: 'minor', introduces: ['c.a'] },
      concepts: [{ conceptId: 'c.a', importance: 'core' }],
      candidates,
      lastSeenAtByGroup: { [production.variantGroupKey]: T0 - 2 * DAY_MS },
    });
    expect(rationale.productionIncluded).toBe(true);
    expect(items.find((i) => i.type === 'fix_bug')?.reason).toBe('production_required');
    expect(items).toHaveLength(8);
  });

  describe('writing exercise (D-084)', () => {
    const single = (candidates: ExerciseCandidate[], lastSeenAtByGroup = {}) => {
      const req = request();
      return buildLessonPracticeSet(deps, {
        ...req,
        lesson: { ...req.lesson, importance: 'minor', introduces: ['c.a'] },
        concepts: [{ conceptId: 'c.a', importance: 'core' }],
        candidates,
        lastSeenAtByGroup,
      });
    };
    const recall = pool('c.a', 7, { type: 'predict_output', category: 'recall' });
    const fixBug = candidate('c.a', 98, { type: 'fix_bug', category: 'production' });
    const writing = candidate('c.a', 99, {
      type: 'web_task',
      category: 'production',
      writing: true,
    });

    it('swaps in a writing exercise when only code to fix was picked, keeping the fix', () => {
      // The writing exercise was served 2 days ago, so band filling prefers the fresh items.
      const { items, rationale } = single([...recall, fixBug, writing], {
        [writing.variantGroupKey]: T0 - 2 * DAY_MS,
      });
      expect(items).toHaveLength(8);
      expect(rationale.productionIncluded).toBe(true);
      expect(rationale.writingIncluded).toBe(true);
      expect(items.find((i) => i.exerciseId === writing.id)?.reason).toBe('writing_required');
      expect(items.find((i) => i.exerciseId === fixBug.id)?.reason).toBe('lesson_practice');
      expect(items.filter((i) => i.type === 'predict_output')).toHaveLength(6);
    });

    it('one writing exercise satisfies the production rule too', () => {
      const recall8 = pool('c.a', 8, { type: 'predict_output', category: 'recall' });
      const { items, rationale } = single([...recall8, writing], {
        [writing.variantGroupKey]: T0 - 2 * DAY_MS,
      });
      expect(rationale).toMatchObject({ productionIncluded: true, writingIncluded: true });
      expect(items.map((i) => i.reason)).not.toContain('production_required');
      expect(items.filter((i) => i.reason === 'writing_required')).toHaveLength(1);
    });

    it('does not swap when a writing exercise is already in the set', () => {
      const { items, rationale } = single([...recall.slice(0, 6), fixBug, writing]);
      expect(rationale.writingIncluded).toBe(true);
      expect(items.map((i) => i.reason).every((r) => r === 'lesson_practice')).toBe(true);
    });

    it('reports false when the lesson has no writing exercise', () => {
      const { items, rationale } = single([...recall, fixBug]);
      expect(rationale).toMatchObject({ productionIncluded: true, writingIncluded: false });
      expect(items.map((i) => i.reason)).not.toContain('writing_required');
    });

    it('prefers a writing exercise not served recently', () => {
      const old = candidate('c.a', 97, {
        type: 'implement_function',
        category: 'production',
        writing: true,
      });
      // Both lose to the fresh items in band filling only if they are recent, so serve both
      // recently and mark `writing` as already answered: the unseen one wins the swap.
      const req = request();
      const { items } = buildLessonPracticeSet(deps, {
        ...req,
        lesson: { ...req.lesson, importance: 'minor', introduces: ['c.a'] },
        concepts: [{ conceptId: 'c.a', importance: 'core' }],
        candidates: [...recall, fixBug, writing, old],
        lastSeenAtByGroup: {
          [writing.variantGroupKey]: T0 - 2 * DAY_MS,
          [old.variantGroupKey]: T0 - 3 * DAY_MS,
        },
        seenExerciseIds: new Set([writing.id]),
      });
      expect(items.find((i) => i.exerciseId === old.id)?.reason).toBe('writing_required');
      expect(items.map((i) => i.exerciseId)).not.toContain(writing.id);
    });
  });

  it('interleaves one item per reviewed concept below effective 70', () => {
    const req = request();
    const weak = {
      ...initialConceptState('c.old'),
      mastery: { ...initialConceptState('c.old').mastery, score: 40, maxDifficultyCorrect: 3 },
    };
    const strong = {
      ...initialConceptState('c.ok'),
      mastery: { ...initialConceptState('c.ok').mastery, score: 90 },
    };
    const { items, rationale } = buildLessonPracticeSet(deps, {
      ...req,
      lesson: { ...req.lesson, reviews: ['c.old', 'c.ok'] },
      concepts: [
        ...req.concepts,
        { conceptId: 'c.old', importance: 'standard', state: weak },
        { conceptId: 'c.ok', importance: 'standard', state: strong },
      ],
      candidates: [...req.candidates, ...pool('c.old', 4), ...pool('c.ok', 4)],
    });
    expect(items).toHaveLength(22);
    expect(rationale.interleavedReviewConcepts).toEqual(['c.old']);
    const review = items.filter((i) => i.reason === 'interleave_review');
    expect(review.map((i) => i.targetConceptId)).toEqual(['c.old']);
    expect(Math.abs((review[0]?.difficulty ?? 0) - 3)).toBeLessThanOrEqual(1);
  });

  it('prefers types the learner has not seen recently', () => {
    const req = request();
    const learner = initialConceptState('c.a');
    const history = ['mcq_single', 'mcq_single', 'mcq_single'].map((exerciseType, i) => ({
      attemptId: `h${i}`,
      at: T0 - DAY_MS + i,
      exerciseId: `old${i}`,
      exerciseType,
      difficulty: 1 as const,
      variantGroupKey: `old${i}`,
      isPrimary: true,
      correct: true,
      credit: 1,
      unassisted: true,
      setKind: 'lesson' as const,
      weight: 1,
    }));
    const candidates = [
      candidate('c.a', 0, { type: 'mcq_single', category: 'recognition', difficulty: 1 }),
      candidate('c.a', 1, { type: 'fill_blank', category: 'recall', difficulty: 1 }),
    ];
    const { items } = buildLessonPracticeSet(deps, {
      ...req,
      lesson: { ...req.lesson, importance: 'minor', introduces: ['c.a'] },
      concepts: [{ conceptId: 'c.a', importance: 'core', state: { ...learner, history } }],
      candidates,
    });
    expect(items[0]?.type).toBe('fill_blank');
    expect(items[0]?.factors.typeNovelty).toBe(1);
  });
});
