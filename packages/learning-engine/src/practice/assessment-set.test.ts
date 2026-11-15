/**
 * Unit assessment sets (learning-engine.md#단원-평가-세트).
 */
import { describe, expect, it } from 'vitest';
import { applyAttempt, initialConceptState } from '../mastery/apply.ts';
import { attempt, deps, exercise, SEOUL, T0 } from '../test/fixtures.ts';
import { DAY_MS } from '../util/time.ts';
import { buildAssessmentSet, evaluateAssessment } from './assessment-set.ts';
import type { AssessmentSetRequest } from './assessment-set.ts';
import type { ExerciseCandidate } from './candidates.ts';

function item(conceptId: string, difficulty: number, n = 0, type = 'predict_output') {
  const id = `${conceptId}.L${difficulty}.${n}`;
  return {
    id,
    type,
    category: 'recall',
    difficulty: difficulty as ExerciseCandidate['difficulty'],
    estimatedSeconds: 60,
    variantGroupKey: id,
    concepts: [{ conceptId, weight: 1, isPrimary: true }],
    origin: 'authored',
  } satisfies ExerciseCandidate;
}

function request(overrides: Partial<AssessmentSetRequest> = {}): AssessmentSetRequest {
  return {
    assessment: {
      id: 'js.ops.review',
      concepts: [
        { conceptId: 'c.a', importance: 'core' },
        { conceptId: 'c.b', importance: 'standard' },
        { conceptId: 'c.c', importance: 'minor' },
      ],
      itemCount: null,
    },
    candidates: ['c.a', 'c.b', 'c.c'].flatMap((c) =>
      [1, 2, 3, 4, 5].map((d) => item(c, d, 0, d % 2 === 0 ? 'mcq_single' : 'predict_output')),
    ),
    lastSeenAtByGroup: {},
    now: T0,
    seed: 'set-1',
    ...overrides,
  };
}

describe('buildAssessmentSet', () => {
  it('covers every concept before filling, one item per variant group', () => {
    const set = buildAssessmentSet(
      deps,
      request({ assessment: { ...request().assessment, itemCount: 4 } }),
    );
    expect(set.items).toHaveLength(4);
    expect(new Set(set.items.map((i) => i.targetConceptId))).toEqual(
      new Set(['c.a', 'c.b', 'c.c']),
    );
    expect(set.rationale.uncovered).toEqual([]);
    expect(new Set(set.items.map((i) => i.variantGroupKey)).size).toBe(4);
    expect(set.items.every((i) => i.reason === 'assessment' && i.band === null)).toBe(true);
    expect(set.items.map((i) => i.position)).toEqual([0, 1, 2, 3]);
  });

  it('takes the whole pool (up to maxItems) without an item count', () => {
    const set = buildAssessmentSet(deps, request());
    expect(set.items).toHaveLength(15);
    const many = buildAssessmentSet(
      deps,
      request({
        candidates: ['c.a', 'c.b', 'c.c'].flatMap((c) =>
          [1, 2, 3, 4, 5].flatMap((d) => [item(c, d, 0), item(c, d, 1)]),
        ),
      }),
    );
    expect(many.items).toHaveLength(deps.config.assessment.maxItems);
    expect(many.rationale.requestedSize).toBe(20);
  });

  it('orders easy to hard without repeating a concept back to back', () => {
    const set = buildAssessmentSet(deps, request());
    const difficulties = set.items.map((i) => i.difficulty);
    // Interleaving may move an item by a slot, never across more than one level.
    for (let i = 1; i < difficulties.length; i++) {
      expect((difficulties[i] ?? 0) - (difficulties[i - 1] ?? 0)).toBeGreaterThanOrEqual(-1);
    }
    for (let i = 1; i < set.items.length; i++) {
      expect(set.items[i]?.targetConceptId).not.toBe(set.items[i - 1]?.targetConceptId);
    }
  });

  it('follows the difficulty mix when filling', () => {
    const candidates = ['c.a', 'c.b', 'c.c', 'c.d'].flatMap((c) =>
      [1, 2, 3, 4, 5].flatMap((d) => [item(c, d, 0), item(c, d, 1), item(c, d, 2)]),
    );
    const set = buildAssessmentSet(
      deps,
      request({
        assessment: {
          id: 'a',
          concepts: ['c.a', 'c.b', 'c.c', 'c.d'].map((conceptId) => ({
            conceptId,
            importance: 'standard' as const,
          })),
          itemCount: 20,
        },
        candidates,
      }),
    );
    const count = (d: number) => set.items.filter((i) => i.difficulty === d).length;
    expect([1, 2, 3, 4, 5].map(count)).toEqual([2, 6, 7, 4, 1]);
    // Concepts stay balanced (5 each).
    expect(Object.values(set.rationale.coverage)).toEqual([5, 5, 5, 5]);
  });

  it('prefers unseen items, so a retake gets new ones while the pool lasts', () => {
    const candidates = ['c.a', 'c.b', 'c.c'].flatMap((c) => [item(c, 3, 0), item(c, 3, 1)]);
    const first = buildAssessmentSet(
      deps,
      request({ candidates, assessment: { ...request().assessment, itemCount: 3 } }),
    );
    const seen = Object.fromEntries(first.items.map((i) => [i.variantGroupKey, T0 - DAY_MS]));
    const retake = buildAssessmentSet(
      deps,
      request({
        candidates,
        lastSeenAtByGroup: seen,
        assessment: { ...request().assessment, itemCount: 3 },
        seed: 'set-2',
      }),
    );
    const firstIds = new Set(first.items.map((i) => i.exerciseId));
    expect(retake.items.some((i) => firstIds.has(i.exerciseId))).toBe(false);
    expect(retake.rationale.seenItems).toBe(0);
    // With every item seen, the set still forms (seen items are allowed as a last resort).
    const all = Object.fromEntries(candidates.map((c) => [c.variantGroupKey, T0 - DAY_MS]));
    const third = buildAssessmentSet(
      deps,
      request({
        candidates,
        lastSeenAtByGroup: all,
        assessment: { ...request().assessment, itemCount: 3 },
      }),
    );
    expect(third.items).toHaveLength(3);
    expect(third.rationale.seenItems).toBe(3);
  });

  it('reports uncovered concepts and ignores candidates outside the scope', () => {
    const set = buildAssessmentSet(
      deps,
      request({
        candidates: [item('c.a', 2), item('c.b', 3), item('other', 3)],
      }),
    );
    expect(set.items.map((i) => i.targetConceptId).sort()).toEqual(['c.a', 'c.b']);
    expect(set.rationale.uncovered).toEqual(['c.c']);
  });

  it('covers the scarcest and most important concepts first when slots are short', () => {
    const set = buildAssessmentSet(
      deps,
      request({
        assessment: { ...request().assessment, itemCount: 2 },
        candidates: [
          item('c.a', 2),
          item('c.a', 3),
          item('c.b', 3),
          item('c.c', 3),
          item('c.c', 4),
        ],
      }),
    );
    // c.b has one candidate (first), then c.a (core) before c.c (minor).
    expect(set.items.map((i) => i.targetConceptId).sort()).toEqual(['c.a', 'c.b']);
    expect(set.rationale.uncovered).toEqual(['c.c']);
  });

  it('is deterministic for a seed', () => {
    expect(buildAssessmentSet(deps, request())).toEqual(buildAssessmentSet(deps, request()));
  });
});

describe('evaluateAssessment', () => {
  it('passes at the pass ratio and lists missed concepts', () => {
    const result = evaluateAssessment(deps, {
      passRatio: null,
      items: [
        { status: 'answered', conceptId: 'c.a', correct: true },
        { status: 'answered', conceptId: 'c.a', correct: true },
        { status: 'answered', conceptId: 'c.b', correct: true },
        { status: 'answered', conceptId: 'c.b', correct: true },
        { status: 'skipped', conceptId: 'c.c', correct: false },
      ],
    });
    expect(result).toMatchObject({
      total: 5,
      correct: 4,
      ratio: 0.8,
      passRatio: 0.8,
      passed: true,
    });
    expect(result.missedConceptIds).toEqual(['c.c']);
    expect(result.concepts).toEqual([
      { conceptId: 'c.a', total: 2, correct: 2 },
      { conceptId: 'c.b', total: 2, correct: 2 },
      { conceptId: 'c.c', total: 1, correct: 0 },
    ]);
  });

  it('fails below a content pass ratio', () => {
    const result = evaluateAssessment(deps, {
      passRatio: 0.9,
      items: [
        { status: 'answered', conceptId: 'c.a', correct: true },
        { status: 'answered', conceptId: 'c.b', correct: false },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.missedConceptIds).toEqual(['c.b']);
    expect(evaluateAssessment(deps, { passRatio: 0.8, items: [] }).passed).toBe(false);
  });
});

describe('assessment context evidence', () => {
  it('weights a correct assessment answer 1.2× and counts it as independent application', () => {
    const run = (setKind: 'assessment' | 'lesson') =>
      applyAttempt(deps, {
        attempt: attempt({ setKind }),
        exercise: exercise({ difficulty: 3 }),
        concepts: [initialConceptState('js.fn.return')],
        now: T0,
        dayBoundary: SEOUL,
      });
    const inAssessment = run('assessment');
    const inLesson = run('lesson');
    const fact = (e: typeof inAssessment) => {
      const record = e.evidence.find((r) => r.kind === 'attempt');
      return record && 'fact' in record.breakdown ? record.breakdown.fact : undefined;
    };
    expect(fact(inAssessment)?.weight).toBeCloseTo((fact(inLesson)?.weight ?? 0) * 1.2);
    expect(fact(inAssessment)?.setKind).toBe('assessment');
    expect(fact(inAssessment)?.unassisted).toBe(true);
    expect(inAssessment.remediation).toBeNull();
  });
});
