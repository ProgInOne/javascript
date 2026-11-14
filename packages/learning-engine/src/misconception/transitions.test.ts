/**
 * Misconception state transitions (learning-engine.md#오개념-상태-전이) and scenario 6.
 */
import { describe, expect, it } from 'vitest';
import { applyAttempt, initialConceptState } from '../mastery/apply.ts';
import type { AttemptBreakdown } from '../mastery/apply.ts';
import { attempt, deps, exercise, SEOUL, T0 } from '../test/fixtures.ts';
import { DAY_MS } from '../util/time.ts';
import type { MisconceptionAttempt, MisconceptionState } from './transitions.ts';
import { misconceptionStatusAt, updateMisconceptions } from './transitions.ts';

const MC = 'js.mc.plus-adds-strings';
const config = deps.config;

function wrong(
  overrides: Partial<MisconceptionAttempt> & { exerciseId?: string; at?: number } = {},
): MisconceptionAttempt {
  return {
    attemptId: `w-${overrides.at ?? T0}-${overrides.exerciseId ?? 'ex-a'}`,
    exerciseId: 'ex-a',
    at: T0,
    correct: false,
    unassisted: true,
    confidence: 'unsure',
    observed: [{ misconceptionId: MC, conceptId: 'c.main', source: 'distractor' }],
    targets: [MC],
    ...overrides,
  };
}

function right(at: number, exerciseId = 'ex-t'): MisconceptionAttempt {
  return {
    attemptId: `r-${at}-${exerciseId}`,
    exerciseId,
    at,
    correct: true,
    unassisted: true,
    confidence: 'sure',
    observed: [],
    targets: [MC],
  };
}

/** Applies attempts in order, folding the rows like the server. */
function run(attempts: MisconceptionAttempt[], start: MisconceptionState[] = []) {
  let states = start;
  const transitions: string[][] = [];
  for (const a of attempts) {
    const updates = updateMisconceptions(config, {
      attempt: a,
      states,
      now: a.at,
      dayBoundary: SEOUL,
    });
    for (const u of updates) {
      states = [...states.filter((s) => s.misconceptionId !== u.misconceptionId), u.after];
      transitions.push([...u.transitions]);
    }
    if (updates.length === 0) transitions.push([]);
  }
  return { state: states.find((s) => s.misconceptionId === MC), transitions };
}

describe('scenario 6: choosing a misconception option while sure', () => {
  it('weighs the wrong answer 1.2 and confirms the misconception at once', () => {
    const ex = exercise({ type: 'mcq_single', category: 'recognition', difficulty: 2 });
    const effects = applyAttempt(deps, {
      attempt: attempt({ outcome: 'incorrect', score: 0, confidence: 'sure' }),
      exercise: ex,
      concepts: [initialConceptState('c.main')],
      now: T0,
      dayBoundary: SEOUL,
      misconceptions: {
        observed: [{ misconceptionId: MC, conceptId: 'c.main', source: 'distractor' }],
        targets: [MC],
        states: [],
      },
    });
    const record = effects.evidence.find((e) => e.kind === 'attempt');
    const breakdown = record?.breakdown as AttemptBreakdown;
    expect(breakdown.factors.confidence.value).toBe(1.2);
    expect(effects.misconceptions).toHaveLength(1);
    expect(effects.misconceptions[0]?.before).toBeNull();
    expect(effects.misconceptions[0]?.after.status).toBe('confirmed');
    expect(effects.misconceptions[0]?.after.confirmCount).toBe(1);
    expect(effects.misconceptions[0]?.transitions).toEqual(['confirmed']);
  });
});

describe('misconception transitions', () => {
  it('starts as suspected when not sure', () => {
    const { state, transitions } = run([wrong()]);
    expect(state?.status).toBe('suspected');
    expect(state?.evidence.map((e) => e.attemptId)).toHaveLength(1);
    expect(transitions).toEqual([['observed']]);
  });

  it('confirms with evidence from another exercise within 30 days', () => {
    const { state, transitions } = run([
      wrong(),
      wrong({ exerciseId: 'ex-b', at: T0 + 10 * DAY_MS }),
    ]);
    expect(state?.status).toBe('confirmed');
    expect(transitions[1]).toEqual(['confirmed']);
  });

  it('does not confirm with the same exercise again', () => {
    const { state } = run([wrong(), wrong({ at: T0 + DAY_MS })]);
    expect(state?.status).toBe('suspected');
    expect(state?.evidence).toHaveLength(2);
  });

  it('does not confirm when the other exercise comes after more than 30 days', () => {
    // The suspicion first expires (30 days without evidence), then is reopened.
    const { state, transitions } = run([
      wrong(),
      wrong({ exerciseId: 'ex-b', at: T0 + 31 * DAY_MS }),
    ]);
    expect(state?.status).toBe('suspected');
    expect(transitions[1]).toEqual(['dismissed_expired', 'reopened']);
  });

  it('reads an old suspicion as dismissed without writing', () => {
    const { state } = run([wrong()]);
    if (!state) throw new Error('no state');
    expect(misconceptionStatusAt(config, state, T0 + 29 * DAY_MS)).toBe('suspected');
    expect(misconceptionStatusAt(config, state, T0 + 30 * DAY_MS)).toBe('dismissed');
  });

  it('dismisses a suspicion after two first-try correct targeted answers', () => {
    const { state, transitions } = run([wrong(), right(T0 + 1000), right(T0 + 2000, 'ex-u')]);
    expect(state?.status).toBe('dismissed');
    expect(transitions.slice(1)).toEqual([['resolution_progress'], ['dismissed_by_targets']]);
  });

  it('resolves a confirmed misconception after two targeted answers a day apart', () => {
    const { state, transitions } = run([
      wrong({ confidence: 'sure' }),
      right(T0 + DAY_MS),
      right(T0 + DAY_MS + 1000, 'ex-u'), // same day: does not count
      right(T0 + 2 * DAY_MS, 'ex-u'),
    ]);
    expect(state?.status).toBe('resolved');
    expect(state?.resolvedAt).toBe(T0 + 2 * DAY_MS);
    expect(transitions.slice(1)).toEqual([['resolution_progress'], [], ['resolved']]);
  });

  it('restarts resolution when new evidence arrives in between', () => {
    const { state } = run([
      wrong({ confidence: 'sure' }),
      right(T0 + DAY_MS),
      wrong({ exerciseId: 'ex-c', at: T0 + 2 * DAY_MS }),
      right(T0 + 3 * DAY_MS),
    ]);
    expect(state?.status).toBe('confirmed');
    expect(state?.resolution).toHaveLength(1);
  });

  it('relapses from resolved to confirmed on new evidence', () => {
    const { state, transitions } = run([
      wrong({ confidence: 'sure' }),
      right(T0 + DAY_MS),
      right(T0 + 2 * DAY_MS),
      wrong({ exerciseId: 'ex-d', at: T0 + 10 * DAY_MS }),
    ]);
    expect(state?.status).toBe('confirmed');
    expect(state?.confirmCount).toBe(2);
    expect(state?.resolvedAt).toBeNull();
    expect(transitions.at(-1)).toEqual(['relapsed']);
  });

  it('reopens a dismissed observation as suspected', () => {
    const { state, transitions } = run([
      wrong(),
      right(T0 + 1000),
      right(T0 + 2000, 'ex-u'),
      wrong({ exerciseId: 'ex-e', at: T0 + 5 * DAY_MS }),
    ]);
    expect(state?.status).toBe('suspected');
    expect(transitions.at(-1)).toEqual(['reopened']);
  });

  it('ignores targeted answers that used help, and correct answers as evidence', () => {
    const helped = { ...right(T0 + 1000), unassisted: false };
    const correctWithObserved = { ...wrong({ at: T0 + 2000 }), correct: true, unassisted: false };
    const { state } = run([wrong(), helped, correctWithObserved]);
    expect(state?.status).toBe('suspected');
    expect(state?.evidence).toHaveLength(1);
    expect(state?.resolution).toHaveLength(0);
  });

  it('never confirms an AI-proposed misconception', () => {
    const id = 'ai.01JD3Z8Q6V2K9M4T7R1X5W0BNC';
    const updates = updateMisconceptions(config, {
      attempt: wrong({
        confidence: 'sure',
        observed: [{ misconceptionId: id, conceptId: 'c.main', source: 'pattern' }],
      }),
      states: [],
      now: T0,
      dayBoundary: SEOUL,
    });
    expect(updates[0]?.after.status).toBe('suspected');
  });

  it('confirms an AI suspicion only once distractor evidence backs it', () => {
    const aiRow: MisconceptionState = {
      misconceptionId: MC,
      conceptId: 'c.main',
      status: 'suspected',
      source: 'ai',
      evidence: [{ attemptId: 'a0', exerciseId: 'ex-z', at: T0, source: 'ai' }],
      resolution: [],
      confirmCount: 0,
      firstSeenAt: T0,
      lastSeenAt: T0,
      resolvedAt: null,
    };
    // Another exercise, but the earlier evidence is an AI proposal: not enough on its own.
    const first = run([wrong({ exerciseId: 'ex-b', at: T0 + DAY_MS })], [aiRow]);
    expect(first.state?.status).toBe('suspected');
    if (!first.state) throw new Error('no state');
    const second = run([wrong({ exerciseId: 'ex-c', at: T0 + 2 * DAY_MS })], [first.state]);
    expect(second.state?.status).toBe('confirmed');
  });
});
