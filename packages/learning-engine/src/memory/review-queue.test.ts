import { describe, expect, it } from 'vitest';
import { initialMasteryState } from '../mastery/apply.ts';
import { deps, reviewedMemory, SEOUL, T0 } from '../test/fixtures.ts';
import type { Importance } from '../types.ts';
import { DAY_MS, HOUR_MS } from '../util/time.ts';
import type { ReviewQueueConcept } from './review-queue.ts';
import { buildReviewQueue } from './review-queue.ts';

/** A concept reviewed `ageDays` ago with an interval of `intervalDays`. */
function concept(
  id: string,
  ageDays: number,
  intervalDays: number,
  overrides: Partial<ReviewQueueConcept> & { importance?: Importance; score?: number } = {},
): ReviewQueueConcept {
  const { score = 90, ...rest } = overrides;
  return {
    memory: reviewedMemory(id, T0 - ageDays * DAY_MS, intervalDays),
    mastery: { ...initialMasteryState(id), score, stage: 'proficient' },
    importance: 'standard',
    lastRating: 'good',
    ...rest,
  };
}

function queue(concepts: ReviewQueueConcept[], budgetMinutes = 60, now = T0) {
  return buildReviewQueue(deps, { concepts, budgetMinutes, now, dayBoundary: SEOUL });
}

describe('buildReviewQueue', () => {
  it('scenario 16: 10-minute budget with 12 due concepts keeps the top priorities', () => {
    // Overdue ratio grows with i, so c11 has the highest priority.
    const concepts = Array.from({ length: 12 }, (_, i) =>
      concept(`c${String(i).padStart(2, '0')}`, 4 + i, 4),
    );
    const result = queue(concepts, 10);
    // 90 s per item → 6 items in 600 s.
    expect(result.due.map((e) => e.conceptId)).toEqual(['c11', 'c10', 'c09', 'c08', 'c07', 'c06']);
    expect(result.deferred.map((e) => e.conceptId)).toEqual([
      'c05',
      'c04',
      'c03',
      'c02',
      'c01',
      'c00',
    ]);
    expect(result.due.reduce((sum, e) => sum + e.estimatedSeconds, 0)).toBeLessThanOrEqual(600);
  });

  it('includes reviews due later today but not tomorrow, and skips suspended concepts', () => {
    // T0 = 10:00 KST; the learner day ends at 04:00 KST next calendar day (+18 h).
    const laterToday = concept('later', 0, 0.7); // due 10:00 + 16.8 h
    const tomorrow = concept('tomorrow', 0, 0.76); // due 10:00 + 18.24 h
    const suspended = concept('suspended', 10, 4);
    const result = queue([
      laterToday,
      tomorrow,
      { ...suspended, memory: { ...suspended.memory, suspended: true } },
    ]);
    expect(result.due.map((e) => e.conceptId)).toEqual(['later']);
    expect(result.deferred).toEqual([]);
    expect(laterToday.memory.card.dueAt).toBeLessThan(T0 + 18 * HOUR_MS);
    expect(tomorrow.memory.card.dueAt).toBeGreaterThan(T0 + 18 * HOUR_MS);
  });

  it('computes priority from overdue ratio, importance and misconceptions', () => {
    const [entry] = queue([
      concept('c', 8, 4, { importance: 'core', activeMisconceptions: 2 }),
    ]).due;
    expect(entry?.factors).toEqual({
      overdueRatio: 2,
      importanceFactor: 1.3,
      misconceptionFactor: 2,
    });
    expect(entry?.priority).toBeCloseTo(5.2, 10);
    expect(entry?.overdue).toBe(true);
    expect(entry?.overdueDays).toBe(4);
    const [minor] = queue([concept('m', 4, 4, { importance: 'minor' })]).due;
    expect(minor?.priority).toBeCloseTo(0.8, 10);
    expect(minor?.overdue).toBe(false);
  });

  it('plans two items after again or when effective < 60', () => {
    const result = queue([
      concept('again', 5, 4, { lastRating: 'again' }),
      concept('weak', 5, 4, { score: 50 }),
      concept('fine', 5, 4, { estimatedSecondsPerItem: 40 }),
    ]);
    const byId = Object.fromEntries(result.due.map((e) => [e.conceptId, e]));
    expect(byId['again']?.itemCount).toBe(2);
    expect(byId['weak']?.itemCount).toBe(2);
    expect(byId['fine']).toMatchObject({ itemCount: 1, estimatedSeconds: 40 });
  });

  it('caps the queue at maxDailyReviews and handles tiny budgets', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      concept(`c${String(i).padStart(2, '0')}`, 5, 4, { estimatedSecondsPerItem: 1 }),
    );
    expect(queue(many, 600).due).toHaveLength(20);
    expect(queue(many, 600).deferred).toHaveLength(5);
    expect(queue([concept('big', 5, 4, { estimatedSecondsPerItem: 600 })], 1).due).toHaveLength(1);
    expect(queue([concept('a', 5, 4)], 0).deferred).toHaveLength(1);
  });

  it('breaks ties deterministically', () => {
    const concepts = [concept('b', 5, 4), concept('a', 5, 4), concept('c', 5, 4)];
    expect(queue(concepts).due.map((e) => e.conceptId)).toEqual(['a', 'b', 'c']);
    expect(queue([...concepts].reverse()).due.map((e) => e.conceptId)).toEqual(['a', 'b', 'c']);
  });
});
