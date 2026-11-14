/**
 * AI misconception proposals (ai-system.md#misconceptionpropose): suspicion only, never a
 * confirmation or relapse; dismissed rows reopen.
 */
import { describe, expect, it } from 'vitest';
import { SEOUL, T0, deps } from '../test/fixtures.ts';
import { DAY_MS } from '../util/time.ts';
import type { MisconceptionEvidence, MisconceptionState } from './transitions.ts';
import { proposeMisconception, updateMisconceptions } from './transitions.ts';

const config = deps.config;
const MC = 'js.mc.plus-adds-strings';
const ai = (attemptId: string, at: number, exerciseId = 'ex-a'): MisconceptionEvidence => ({
  attemptId,
  exerciseId,
  at,
  source: 'ai',
});

function propose(state: MisconceptionState | null, evidence: MisconceptionEvidence[], now = T0) {
  return proposeMisconception(config, {
    misconceptionId: MC,
    conceptId: 'c.main',
    evidence,
    state,
    now,
  });
}

describe('proposeMisconception', () => {
  it('records a new suspicion with the cited wrong attempts', () => {
    const update = propose(null, [ai('a2', T0 + 10), ai('a1', T0)]);
    expect(update?.transitions).toEqual(['observed']);
    expect(update?.after).toMatchObject({
      status: 'suspected',
      source: 'ai',
      confirmCount: 0,
      firstSeenAt: T0,
      lastSeenAt: T0 + 10,
    });
    expect(update?.after.evidence.map((e) => e.attemptId)).toEqual(['a1', 'a2']);
  });

  it('never changes an active, confirmed or resolved observation', () => {
    const suspected = propose(null, [ai('a1', T0)])?.after ?? null;
    expect(propose(suspected, [ai('a2', T0 + 1)])).toBeNull();
    if (!suspected) throw new Error('no state');
    expect(propose({ ...suspected, status: 'confirmed' }, [ai('a2', T0 + 1)])).toBeNull();
    expect(propose({ ...suspected, status: 'resolved' }, [ai('a2', T0 + 1)])).toBeNull();
    expect(propose(null, [])).toBeNull();
  });

  it('reopens a dismissed or expired suspicion, but not with known evidence', () => {
    const suspected = propose(null, [ai('a1', T0)])?.after;
    if (!suspected) throw new Error('no state');
    const later = T0 + 40 * DAY_MS;
    const reopened = propose(suspected, [ai('a2', later)], later);
    expect(reopened?.transitions).toEqual(['dismissed_expired', 'reopened']);
    expect(reopened?.after).toMatchObject({ status: 'suspected', lastSeenAt: later });
    const dismissed = { ...suspected, status: 'dismissed' as const };
    expect(propose(dismissed, [ai('a1', T0)], T0)).toBeNull();
  });

  it('is never enough to confirm: a later AI-backed row confirms only with deterministic evidence', () => {
    const state = propose(null, [ai('a1', T0, 'ex-a')])?.after;
    if (!state) throw new Error('no state');
    // A wrong option on another exercise backs the suspicion but the AI evidence does not count
    // as the first backed evidence, so it stays suspected (learning-engine.md#오개념-상태-전이).
    const updates = updateMisconceptions(config, {
      attempt: {
        attemptId: 'w1',
        exerciseId: 'ex-b',
        at: T0 + DAY_MS,
        correct: false,
        unassisted: true,
        confidence: 'unsure',
        observed: [{ misconceptionId: MC, conceptId: 'c.main', source: 'distractor' }],
        targets: [],
      },
      states: [state],
      now: T0 + DAY_MS,
      dayBoundary: SEOUL,
    });
    expect(updates[0]?.after.status).toBe('suspected');
  });
});
