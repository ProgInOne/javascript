/**
 * Relearning rules (learning-engine.md#재학습-규칙): triggers, prerequisite search and the
 * escalation path. Scenarios 7 and 8.
 */
import { describe, expect, it } from 'vitest';
import { applyAttempt, initialConceptState } from '../mastery/apply.ts';
import { attempt, deps, exercise, Learner, SEOUL, T0 } from '../test/fixtures.ts';
import type { ConceptState } from '../types.ts';
import { DAY_MS } from '../util/time.ts';
import type { RemediationContext, RemediationHistoryEntry, SetItemOutcome } from './detect.ts';
import { detectRemediation, inspectPrerequisites } from './detect.ts';

/**
 * `c.main` requires `p.strong` and `p.weak` (depth 1); `p.weak` requires `p.deep` (depth 2).
 * `p.helpful` is only helpful and never inspected.
 */
const graph: RemediationContext['graph'] = {
  prerequisites: [
    { conceptId: 'c.main', prerequisiteId: 'p.strong', strength: 'required' },
    { conceptId: 'c.main', prerequisiteId: 'p.weak', strength: 'required' },
    { conceptId: 'c.main', prerequisiteId: 'p.helpful', strength: 'helpful' },
    { conceptId: 'p.weak', prerequisiteId: 'p.deep', strength: 'required' },
  ],
};

/** A concept answered correctly `n` times (score rises with each). */
function practiced(conceptId: string, n: number): ConceptState {
  const learner = new Learner(conceptId);
  for (let i = 0; i < n; i++) {
    learner.answer(
      exercise({ concepts: [{ conceptId, weight: 1, isPrimary: true }], difficulty: 3 }),
    );
  }
  return learner.state;
}

const strong = practiced('p.strong', 8); // ≈ 90
const weak = practiced('p.weak', 2); // practicing? no: low score
const deep = practiced('p.deep', 1);

function context(overrides: Partial<RemediationContext> = {}): RemediationContext {
  return {
    graph,
    states: [strong, weak, deep],
    setItems: [],
    workedExamples: [],
    history: [],
    openSuggestionInSet: false,
    ...overrides,
  };
}

/** The previous item of the same concept in this set was wrong. */
const previousWrong: SetItemOutcome[] = [
  { itemId: 'i1', conceptId: 'c.main', correct: false, at: T0 - 60_000 },
];

function failInSet(ctx: RemediationContext, state = initialConceptState('c.main')) {
  return applyAttempt(deps, {
    attempt: attempt({ outcome: 'incorrect', score: 0, confidence: 'unsure' }),
    exercise: exercise({ difficulty: 3 }),
    concepts: [state],
    now: T0,
    dayBoundary: SEOUL,
    remediation: ctx,
  });
}

describe('scenario 7: two wrong answers in a row in a set, weak prerequisite', () => {
  it('suggests a check set on the weakest prerequisite at the shallowest weak depth', () => {
    const effects = failInSet(context({ setItems: previousWrong }));
    const suggestion = effects.remediation;
    expect(suggestion?.trigger).toBe('set_consecutive_failures');
    expect(suggestion?.kind).toBe('prerequisite_check');
    expect(suggestion?.prerequisite?.conceptId).toBe('p.weak');
    expect(suggestion?.prerequisite?.depth).toBe(1);
    expect(suggestion?.check).toEqual({
      items: 3,
      minDifficulty: 1,
      maxDifficulty: 2,
      passCorrect: 2,
    });
    expect(suggestion?.prerequisitesChecked.map((c) => [c.conceptId, c.depth, c.weak])).toEqual([
      ['p.strong', 1, false],
      ['p.weak', 1, true],
      ['p.deep', 2, true],
    ]);
  });

  it('picks the lowest effective mastery among weak prerequisites of the same depth', () => {
    const weaker = practiced('p.strong', 1);
    const effects = failInSet(context({ setItems: previousWrong, states: [weaker, weak, deep] }));
    expect(weaker.mastery.score).toBeLessThan(weak.mastery.score);
    expect(effects.remediation?.prerequisite?.conceptId).toBe('p.strong');
  });

  it('goes to depth 2 when the depth-1 weak prerequisite was checked recently', () => {
    const history: RemediationHistoryEntry[] = [
      {
        conceptId: 'c.main',
        kind: 'prerequisite_check',
        prerequisiteId: 'p.weak',
        workedExampleStage: null,
        at: T0 - DAY_MS,
      },
    ];
    const effects = failInSet(context({ setItems: previousWrong, history }));
    expect(effects.remediation?.prerequisite?.conceptId).toBe('p.deep');
    expect(effects.remediation?.prerequisite?.depth).toBe(2);
  });
});

describe('scenario 8: same, prerequisites fine, worked examples exist', () => {
  const healthy = [strong, practiced('p.weak', 8), practiced('p.deep', 8)];
  const workedExamples = [
    { exerciseId: 'we-2', conceptId: 'c.main', stage: 2 as const },
    { exerciseId: 'we-0', conceptId: 'c.main', stage: 0 as const },
    { exerciseId: 'we-1', conceptId: 'c.main', stage: 1 as const },
    { exerciseId: 'we-other', conceptId: 'c.other', stage: 0 as const },
  ];

  it('suggests the worked example from stage 0', () => {
    const effects = failInSet(
      context({ setItems: previousWrong, states: healthy, workedExamples }),
    );
    expect(effects.remediation?.kind).toBe('worked_example');
    expect(effects.remediation?.workedExamples).toEqual([
      { exerciseId: 'we-0', stage: 0 },
      { exerciseId: 'we-1', stage: 1 },
      { exerciseId: 'we-2', stage: 2 },
    ]);
  });

  it('continues from the next stage, then rereads the lesson after stage 2', () => {
    const at = T0 - DAY_MS;
    const partly = failInSet(
      context({
        setItems: previousWrong,
        states: healthy,
        workedExamples,
        history: [
          {
            conceptId: 'c.main',
            kind: 'worked_example',
            prerequisiteId: null,
            workedExampleStage: 1,
            at,
          },
        ],
      }),
    );
    expect(partly.remediation?.workedExamples).toEqual([{ exerciseId: 'we-2', stage: 2 }]);
    const done = failInSet(
      context({
        setItems: previousWrong,
        states: healthy,
        workedExamples,
        history: [
          {
            conceptId: 'c.main',
            kind: 'worked_example',
            prerequisiteId: null,
            workedExampleStage: 2,
            at,
          },
        ],
      }),
    );
    expect(done.remediation?.kind).toBe('reread_lesson');
    expect(done.remediation?.tutorBadge).toBe(true);
  });

  it('without worked examples: one level easier with hint 1, then rereading', () => {
    const first = failInSet(context({ setItems: previousWrong, states: healthy }));
    expect(first.remediation?.kind).toBe('easier_with_hint');
    expect(first.remediation?.targetDifficulty).toBe(2);
    expect(first.remediation?.autoHintLevel).toBe(1);
    const second = failInSet(
      context({
        setItems: previousWrong,
        states: healthy,
        history: [
          {
            conceptId: 'c.main',
            kind: 'easier_with_hint',
            prerequisiteId: null,
            workedExampleStage: null,
            at: T0 - 60_000,
          },
        ],
      }),
    );
    expect(second.remediation?.kind).toBe('reread_lesson');
  });

  it('forgets suggestions older than the 7-day window', () => {
    const effects = failInSet(
      context({
        setItems: previousWrong,
        states: healthy,
        history: [
          {
            conceptId: 'c.main',
            kind: 'easier_with_hint',
            prerequisiteId: null,
            workedExampleStage: null,
            at: T0 - 8 * DAY_MS,
          },
        ],
      }),
    );
    expect(effects.remediation?.kind).toBe('easier_with_hint');
  });
});

describe('relearning triggers', () => {
  it('does not trigger on a correct answer, a first wrong answer or in an assessment', () => {
    expect(failInSet(context()).remediation).toBeNull();
    const correct = applyAttempt(deps, {
      attempt: attempt(),
      exercise: exercise(),
      concepts: [initialConceptState('c.main')],
      now: T0,
      dayBoundary: SEOUL,
      remediation: context({ setItems: previousWrong }),
    });
    expect(correct.remediation).toBeNull();
    const assessment = applyAttempt(deps, {
      attempt: attempt({ outcome: 'incorrect', score: 0, setKind: 'assessment' }),
      exercise: exercise(),
      concepts: [initialConceptState('c.main')],
      now: T0,
      dayBoundary: SEOUL,
      remediation: context({ setItems: previousWrong }),
    });
    expect(assessment.remediation).toBeNull();
  });

  it('ignores items of other concepts and needs the previous item of the concept wrong', () => {
    const items: SetItemOutcome[] = [
      { itemId: 'i1', conceptId: 'c.main', correct: false, at: T0 - 120_000 },
      { itemId: 'i2', conceptId: 'c.main', correct: true, at: T0 - 60_000 },
      { itemId: 'i3', conceptId: 'c.other', correct: false, at: T0 - 30_000 },
    ];
    expect(failInSet(context({ setItems: items })).remediation).toBeNull();
  });

  it('stays quiet while an earlier suggestion in the set is unfinished', () => {
    const effects = failInSet(context({ setItems: previousWrong, openSuggestionInSet: true }));
    expect(effects.remediation).toBeNull();
  });

  it('triggers on three failures in a row within 7 days across sets', () => {
    const learner = new Learner();
    const wrong = { outcome: 'incorrect' as const, score: 0, confidence: 'unsure' as const };
    learner.answer(exercise(), { ...wrong, submittedAt: T0 - 8 * DAY_MS });
    learner.answer(exercise(), { ...wrong, submittedAt: T0 - 2 * DAY_MS });
    const effects = applyAttempt(deps, {
      attempt: attempt({ ...wrong, setKind: 'review' }),
      exercise: exercise(),
      concepts: [learner.state],
      now: T0,
      dayBoundary: SEOUL,
      remediation: context(),
    });
    // Only two of the three failures are inside the window.
    expect(effects.remediation).toBeNull();
    learner.answer(exercise(), { ...wrong, submittedAt: T0 - DAY_MS });
    const again = applyAttempt(deps, {
      attempt: attempt({ ...wrong, setKind: 'review' }),
      exercise: exercise(),
      concepts: [learner.state],
      now: T0,
      dayBoundary: SEOUL,
      remediation: context(),
    });
    expect(again.remediation?.trigger).toBe('recent_consecutive_failures');
  });

  it('resets the failure run after an unassisted correct answer', () => {
    const learner = new Learner();
    const wrong = { outcome: 'incorrect' as const, score: 0 };
    learner.answer(exercise(), { ...wrong, submittedAt: T0 - 3 * DAY_MS });
    learner.answer(exercise(), { ...wrong, submittedAt: T0 - 2 * DAY_MS });
    learner.answer(exercise(), { submittedAt: T0 - DAY_MS });
    learner.answer(exercise(), { ...wrong, submittedAt: T0 - 1000 });
    const effects = applyAttempt(deps, {
      attempt: attempt({ ...wrong }),
      exercise: exercise(),
      concepts: [learner.state],
      now: T0,
      dayBoundary: SEOUL,
      remediation: context(),
    });
    expect(effects.remediation).toBeNull();
  });
});

describe('inspectPrerequisites', () => {
  it('follows required edges only, breadth first, without revisiting', () => {
    const cyclic: RemediationContext['graph'] = {
      prerequisites: [
        { conceptId: 'c.main', prerequisiteId: 'a', strength: 'required' },
        { conceptId: 'a', prerequisiteId: 'c.main', strength: 'required' },
        { conceptId: 'a', prerequisiteId: 'b', strength: 'required' },
        { conceptId: 'b', prerequisiteId: 'c', strength: 'required' },
      ],
    };
    const checked = inspectPrerequisites(deps, {
      conceptId: 'c.main',
      context: context({ graph: cyclic, states: [] }),
      now: T0,
    });
    expect(checked.map((c) => [c.conceptId, c.depth, c.stage, c.weak])).toEqual([
      ['a', 1, 'not_started', true],
      ['b', 2, 'not_started', true],
    ]);
  });

  it('detectRemediation is deterministic for the same input', () => {
    const input = {
      conceptId: 'c.main',
      trigger: 'set_consecutive_failures' as const,
      failedDifficulty: 3,
      context: context(),
      now: T0,
    };
    expect(detectRemediation(deps, input)).toEqual(detectRemediation(deps, input));
  });
});
