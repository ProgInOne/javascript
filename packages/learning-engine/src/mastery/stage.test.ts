import { describe, expect, it } from 'vitest';
import { defaultEngineConfig as config } from '../config.ts';
import { SEOUL, T0 } from '../test/fixtures.ts';
import type { EvidenceFact, ReviewFact } from '../types.ts';
import { DAY_MS, HOUR_MS } from '../util/time.ts';
import type { GateInput, GateReport } from './stage.ts';
import { countSpacedReviews, decideStage, evaluateGates } from './stage.ts';

let seq = 0;
function fact(overrides: Partial<EvidenceFact> = {}): EvidenceFact {
  seq += 1;
  return {
    attemptId: `a${seq}`,
    at: T0,
    exerciseId: `e${seq}`,
    exerciseType: 'predict_output',
    difficulty: 2,
    variantGroupKey: `g${seq}`,
    isPrimary: true,
    correct: true,
    credit: 1,
    unassisted: true,
    setKind: 'lesson',
    weight: 1,
    ...overrides,
  };
}

/** Facts that satisfy every proficient diversity gate. */
function proficientFacts(): EvidenceFact[] {
  return [fact(), fact({ exerciseType: 'fix_bug', difficulty: 3 }), fact()];
}

function gates(overrides: Partial<GateInput>): GateReport {
  return evaluateGates(config, {
    effective: 90,
    evidenceWeightSum: 5,
    history: proficientFacts(),
    reviews: [],
    dayBoundary: SEOUL,
    ...overrides,
  });
}

function missingOf(result: GateReport['proficient']): string[] {
  return result.missing.map((m) => m.gate);
}

describe('practicing gate', () => {
  it('needs evidence_weight_sum ≥ 1.0 exactly', () => {
    expect(gates({ evidenceWeightSum: 1 }).practicing.met).toBe(true);
    expect(gates({ evidenceWeightSum: 0.999 }).practicing.missing).toEqual([
      { gate: 'evidence_weight_sum', required: 1, actual: 0.999 },
    ]);
  });
});

describe('proficient gate thresholds', () => {
  it('meets with every condition at its exact threshold', () => {
    expect(gates({ effective: 70, evidenceWeightSum: 3 }).proficient).toEqual({
      met: true,
      missing: [],
    });
  });

  it('reports each missing condition', () => {
    expect(missingOf(gates({ effective: 69.999 }).proficient)).toEqual(['effective']);
    expect(missingOf(gates({ evidenceWeightSum: 2.999 }).proficient)).toEqual([
      'evidence_weight_sum',
    ]);
    expect(
      gates({ history: [fact(), fact({ difficulty: 3 }), fact()] }).proficient.missing,
    ).toEqual([{ gate: 'distinct_types', required: 2, actual: 1 }]);
    expect(
      gates({ history: [fact(), fact({ exerciseType: 'fix_bug', difficulty: 3 })] }).proficient
        .missing,
    ).toEqual([{ gate: 'distinct_variant_groups', required: 3, actual: 2 }]);
    expect(
      missingOf(gates({ history: [fact(), fact({ exerciseType: 'fix_bug' }), fact()] }).proficient),
    ).toEqual(['level3_correct']);
  });

  it('counts only qualifying (credit ≥ 0.5) primary correct answers', () => {
    const base = [fact(), fact({ exerciseType: 'fix_bug', difficulty: 3 })];
    expect(gates({ history: [...base, fact({ credit: 0.5 })] }).proficient.met).toBe(true);
    expect(missingOf(gates({ history: [...base, fact({ credit: 0.4999 })] }).proficient)).toEqual([
      'distinct_variant_groups',
    ]);
    expect(missingOf(gates({ history: [...base, fact({ isPrimary: false })] }).proficient)).toEqual(
      ['distinct_variant_groups'],
    );
    expect(missingOf(gates({ history: [...base, fact({ correct: false })] }).proficient)).toEqual([
      'distinct_variant_groups',
    ]);
  });

  it('counts variant groups, not exercises', () => {
    const history = [
      fact({ variantGroupKey: 'tpl' }),
      fact({ variantGroupKey: 'tpl', exerciseType: 'fix_bug', difficulty: 3 }),
      fact({ variantGroupKey: 'tpl' }),
    ];
    expect(gates({ history }).proficient.missing).toEqual([
      { gate: 'distinct_variant_groups', required: 3, actual: 1 },
    ]);
  });
});

function review(at: number, rating: ReviewFact['rating'] = 'good', groups = ['g-a']): ReviewFact {
  return { reviewedAt: at, rating, variantGroupKeys: groups };
}

describe('spaced reviews (mastered memory condition)', () => {
  // T0 is 2026-03-02 10:00 KST (local date 2026-03-02).
  it('counts a good review 7 local days after the previous one, honouring the 04:00 day start', () => {
    // 2026-03-09 03:59 KST still belongs to 03-08 (6 days); 04:00 starts 03-09 (7 days).
    const sixDays = T0 + 7 * DAY_MS - 6 * HOUR_MS - 60_000;
    const sevenDays = T0 + 7 * DAY_MS - 6 * HOUR_MS;
    expect(countSpacedReviews(config, [review(T0), review(sixDays)], SEOUL)).toBe(0);
    expect(countSpacedReviews(config, [review(T0), review(sevenDays)], SEOUL)).toBe(1);
  });

  it('ignores hard/again and needs two different variant groups for two reviews', () => {
    const d = (n: number) => T0 + n * DAY_MS;
    expect(countSpacedReviews(config, [review(d(0)), review(d(7), 'hard')], SEOUL)).toBe(0);
    expect(countSpacedReviews(config, [review(d(0)), review(d(7)), review(d(14))], SEOUL)).toBe(1);
    expect(
      countSpacedReviews(
        config,
        [review(d(0)), review(d(7)), review(d(14), 'easy', ['g-b'])],
        SEOUL,
      ),
    ).toBe(2);
    // Unordered input is sorted first; the gap is measured from the immediately previous review.
    expect(
      countSpacedReviews(
        config,
        [review(d(10), 'good', ['g-b']), review(d(7)), review(d(0))],
        SEOUL,
      ),
    ).toBe(1);
  });
});

describe('mastered gate', () => {
  const d = (n: number) => T0 + n * DAY_MS;
  const spaced = [review(d(0)), review(d(7)), review(d(14), 'good', ['g-b'])];
  const independent = fact({ setKind: 'assessment', difficulty: 3 });

  it('meets with spaced reviews, independent application and effective ≥ 85', () => {
    const report = gates({
      effective: 85,
      reviews: spaced,
      history: [...proficientFacts(), independent],
    });
    expect(report.mastered).toEqual({ met: true, missing: [] });
  });

  it('reports missing memory, application, effective and recent again', () => {
    const report = gates({ effective: 84.999, reviews: [...spaced, review(d(15), 'again')] });
    expect(missingOf(report.mastered)).toEqual([
      'effective',
      'independent_application',
      'recent_again',
    ]);
  });

  it('accepts L4+ unassisted answers as independent application, but not assisted ones', () => {
    const base = { effective: 90, reviews: spaced };
    expect(
      gates({ ...base, history: [...proficientFacts(), fact({ difficulty: 4 })] }).mastered.met,
    ).toBe(true);
    expect(
      missingOf(
        gates({
          ...base,
          history: [...proficientFacts(), fact({ difficulty: 4, unassisted: false })],
        }).mastered,
      ),
    ).toEqual(['independent_application']);
    expect(
      missingOf(
        gates({ ...base, history: [...proficientFacts(), fact({ difficulty: 3 })] }).mastered,
      ),
    ).toEqual(['independent_application']);
  });

  it('only looks at the last three reviews for again', () => {
    const history = [...proficientFacts(), independent];
    const old = [review(d(-1), 'again'), ...spaced, review(d(21), 'good', ['g-c'])];
    expect(gates({ history, reviews: old }).mastered.met).toBe(true);
  });
});

describe('decideStage', () => {
  const all = gates({
    reviews: [review(T0), review(T0 + 7 * DAY_MS), review(T0 + 14 * DAY_MS, 'good', ['b'])],
    history: [...proficientFacts(), fact({ difficulty: 4 })],
  });
  const promote = { allowDemotion: false };
  const demote = { allowDemotion: true };

  it('moves at most one step up', () => {
    expect(all.mastered.met).toBe(true);
    expect(decideStage(config, 'not_started', 90, all, promote).stage).toBe('introduced');
    expect(decideStage(config, 'introduced', 90, all, promote).stage).toBe('practicing');
    expect(decideStage(config, 'practicing', 90, all, promote).stage).toBe('proficient');
    expect(decideStage(config, 'proficient', 90, all, promote).stage).toBe('mastered');
  });

  it('demotes with a 10-point hysteresis only when allowed', () => {
    const low = gates({ effective: 60 });
    expect(decideStage(config, 'proficient', 60, low, demote)).toEqual({
      stage: 'proficient',
      reason: 'unchanged',
    });
    expect(decideStage(config, 'proficient', 59.99, all, demote)).toEqual({
      stage: 'practicing',
      reason: 'demoted_effective',
    });
    expect(decideStage(config, 'proficient', 59.99, low, promote).stage).toBe('proficient');
    expect(decideStage(config, 'mastered', 75, all, demote).stage).toBe('mastered');
    expect(decideStage(config, 'mastered', 74.99, all, demote).stage).toBe('proficient');
    expect(decideStage(config, 'mastered', 10, all, promote).stage).toBe('mastered');
  });
});
