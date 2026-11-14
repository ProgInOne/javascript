/**
 * Adaptation during a set (learning-engine.md#진행-중-적응-nextadaptivestep).
 */
import { describe, expect, it } from 'vitest';
import { initialConceptState } from '../mastery/initial.ts';
import type { RemediationSuggestion } from '../remediation/detect.ts';
import { deps, T0 } from '../test/fixtures.ts';
import type { AdaptiveRequest, ItemOutcome, SetItemSnapshot } from './adaptive.ts';
import { nextAdaptiveStep } from './adaptive.ts';
import type { ExerciseCandidate } from './candidates.ts';

function candidate(
  id: string,
  difficulty: number,
  overrides: Partial<ExerciseCandidate> = {},
): ExerciseCandidate {
  return {
    id,
    type: 'predict_output',
    category: 'recall',
    difficulty: difficulty as ExerciseCandidate['difficulty'],
    estimatedSeconds: 60,
    variantGroupKey: id,
    concepts: [
      { conceptId: overrides.concepts?.[0]?.conceptId ?? 'c.main', weight: 1, isPrimary: true },
    ],
    origin: 'authored',
    ...overrides,
  };
}

function item(
  id: string,
  position: number,
  difficulty: number,
  overrides: Partial<SetItemSnapshot> = {},
): SetItemSnapshot {
  return {
    id,
    position,
    exerciseId: `ex-${id}`,
    targetConceptId: 'c.main',
    status: 'pending',
    reason: 'lesson_practice',
    type: 'mcq_single',
    difficulty,
    variantGroupKey: `ex-${id}`,
    touched: false,
    ...overrides,
  };
}

const answeredOk = (id: string, at: number): ItemOutcome => ({
  itemId: id,
  conceptId: 'c.main',
  correct: true,
  unassisted: true,
  at,
});

function request(overrides: Partial<AdaptiveRequest>): AdaptiveRequest {
  return {
    set: { kind: 'lesson', items: [] },
    itemId: 'i2',
    event: 'answered',
    outcomes: [],
    solutionJustViewed: false,
    remediation: null,
    candidates: [],
    concepts: [initialConceptState('c.main')],
    lastSeenAtByGroup: {},
    seed: 'set-1',
    now: T0,
    ...overrides,
  };
}

/** Two answered warm-up items, then pending items i3 (next), i4 (L1), i5 (L2), i6 (L3). */
const items = [
  item('i1', 0, 1, { status: 'answered', touched: true }),
  item('i2', 1, 1, { status: 'answered', touched: true }),
  item('i3', 2, 1),
  item('i4', 3, 1),
  item('i5', 4, 2),
  item('i6', 5, 3),
];

describe('difficulty step-up', () => {
  it('replaces the next untouched warm-up item (not the current next item) with one a level harder', () => {
    const actions = nextAdaptiveStep(
      deps,
      request({
        set: { kind: 'lesson', items },
        outcomes: [answeredOk('i1', T0), answeredOk('i2', T0 + 1)],
        candidates: [candidate('hard-2', 2), candidate('hard-3', 3), candidate('easy-1', 1)],
      }),
    );
    expect(actions).toHaveLength(1);
    const [action] = actions;
    expect(action?.kind).toBe('replace');
    if (action?.kind !== 'replace') throw new Error('not a replace');
    expect(action.itemId).toBe('i4');
    expect(action.item).toMatchObject({
      exerciseId: 'hard-2',
      difficulty: 2,
      position: 3,
      reason: 'difficulty_step_up',
      targetConceptId: 'c.main',
    });
  });

  it('needs two first-try unassisted correct items of the same concept in a row', () => {
    const helped = { ...answeredOk('i1', T0), unassisted: false };
    const other = { ...answeredOk('i1', T0), conceptId: 'c.other' };
    for (const first of [helped, other]) {
      const actions = nextAdaptiveStep(
        deps,
        request({
          set: { kind: 'lesson', items },
          outcomes: [first, answeredOk('i2', T0 + 1)],
          candidates: [candidate('hard-2', 2)],
        }),
      );
      expect(actions).toEqual([]);
    }
  });

  it('skips touched items and does not step up review or assessment sets', () => {
    const touched = items.map((i) =>
      i.id === 'i4' || i.id === 'i5' ? { ...i, touched: true } : i,
    );
    const base = {
      outcomes: [answeredOk('i1', T0), answeredOk('i2', T0 + 1)],
      candidates: [candidate('hard-2', 2), candidate('hard-3', 3)],
    };
    expect(
      nextAdaptiveStep(deps, request({ ...base, set: { kind: 'lesson', items: touched } })),
    ).toEqual([]);
    expect(nextAdaptiveStep(deps, request({ ...base, set: { kind: 'review', items } }))).toEqual(
      [],
    );
    expect(
      nextAdaptiveStep(deps, request({ ...base, set: { kind: 'assessment', items } })),
    ).toEqual([]);
  });
});

describe('relearning items', () => {
  const base: Omit<RemediationSuggestion, 'kind'> = {
    conceptId: 'c.main',
    trigger: 'set_consecutive_failures',
    prerequisite: null,
    check: null,
    workedExamples: [],
    targetDifficulty: null,
    autoHintLevel: 0,
    tutorBadge: false,
    prerequisitesChecked: [],
  };
  const failing = [
    item('i1', 0, 2, { status: 'answered' }),
    item('i2', 1, 3, { status: 'answered' }),
  ];

  it('appends a three-item L1–L2 check of the prerequisite', () => {
    const prereq = (id: string, d: number) =>
      candidate(id, d, { concepts: [{ conceptId: 'p.weak', weight: 1, isPrimary: true }] });
    const actions = nextAdaptiveStep(
      deps,
      request({
        set: { kind: 'lesson', items: failing },
        remediation: {
          ...base,
          kind: 'prerequisite_check',
          prerequisite: {
            conceptId: 'p.weak',
            depth: 1,
            effective: 20,
            stage: 'introduced',
            weak: true,
            recentlyChecked: false,
          },
          check: { items: 3, minDifficulty: 1, maxDifficulty: 2, passCorrect: 2 },
        },
        candidates: [
          prereq('p1', 1),
          prereq('p2', 2),
          prereq('p3', 1),
          prereq('p4', 3),
          candidate('m1', 1),
        ],
      }),
    );
    expect(actions.map((a) => [a.kind, a.reason, a.item.difficulty, a.item.position])).toEqual([
      ['append', 'remedial_prereq', 1, 2],
      ['append', 'remedial_prereq', 1, 3],
      ['append', 'remedial_prereq', 2, 4],
    ]);
    expect(new Set(actions.map((a) => a.item.exerciseId))).toEqual(new Set(['p1', 'p2', 'p3']));
    expect(actions.every((a) => a.item.targetConceptId === 'p.weak')).toBe(true);
  });

  it('appends worked example stages in order and one easier item', () => {
    const worked = nextAdaptiveStep(
      deps,
      request({
        set: { kind: 'lesson', items: failing },
        remediation: {
          ...base,
          kind: 'worked_example',
          workedExamples: [
            { exerciseId: 'we-0', stage: 0 },
            { exerciseId: 'we-1', stage: 1 },
          ],
        },
        candidates: [candidate('we-1', 2), candidate('we-0', 2)],
      }),
    );
    expect(worked.map((a) => [a.reason, a.item.exerciseId])).toEqual([
      ['remedial_worked_example', 'we-0'],
      ['remedial_worked_example', 'we-1'],
    ]);
    const easier = nextAdaptiveStep(
      deps,
      request({
        set: { kind: 'lesson', items: failing },
        remediation: { ...base, kind: 'easier_with_hint', targetDifficulty: 2, autoHintLevel: 1 },
        candidates: [candidate('e3', 3), candidate('e2', 2), candidate('e1', 1)],
      }),
    );
    expect(easier.map((a) => [a.reason, a.item.exerciseId])).toEqual([['remedial_easier', 'e2']]);
  });

  it('adds nothing for rereading the lesson', () => {
    const actions = nextAdaptiveStep(
      deps,
      request({
        set: { kind: 'lesson', items: failing },
        remediation: { ...base, kind: 'reread_lesson', tutorBadge: true },
        candidates: [candidate('e1', 1)],
      }),
    );
    expect(actions).toEqual([]);
  });
});

describe('follow-ups', () => {
  it('appends a sibling of the variant group after the solution was viewed', () => {
    const current = item('i1', 0, 2, {
      status: 'answered',
      type: 'predict_output',
      variantGroupKey: 'grp',
    });
    const actions = nextAdaptiveStep(
      deps,
      request({
        set: { kind: 'lesson', items: [current] },
        itemId: 'i1',
        solutionJustViewed: true,
        candidates: [
          candidate('same-type', 2),
          candidate('sibling', 2, { variantGroupKey: 'grp', type: 'fill_blank' }),
        ],
      }),
    );
    expect(actions.map((a) => [a.reason, a.item.exerciseId, a.item.position])).toEqual([
      ['solution_followup', 'sibling', 1],
    ]);
  });

  it('falls back to the same concept and type without a sibling', () => {
    const current = item('i1', 0, 2, { status: 'answered', type: 'predict_output' });
    const actions = nextAdaptiveStep(
      deps,
      request({
        set: { kind: 'review', items: [current] },
        itemId: 'i1',
        solutionJustViewed: true,
        candidates: [candidate('other-type', 2, { type: 'mcq_single' }), candidate('same-type', 2)],
      }),
    );
    expect(actions.map((a) => a.item.exerciseId)).toEqual(['same-type']);
  });

  it('appends another type at the same difficulty when an item is skipped, once', () => {
    const skipped = item('i1', 0, 2, { status: 'skipped', type: 'predict_output' });
    const actions = nextAdaptiveStep(
      deps,
      request({
        set: { kind: 'lesson', items: [skipped] },
        itemId: 'i1',
        event: 'skipped',
        candidates: [
          candidate('same-type', 2),
          candidate('other-l3', 3, { type: 'mcq_single' }),
          candidate('other-l2', 2, { type: 'mcq_single' }),
        ],
      }),
    );
    expect(actions.map((a) => [a.reason, a.item.exerciseId])).toEqual([
      ['skip_followup', 'other-l2'],
    ]);
    const followup = item('i2', 1, 2, { status: 'skipped', reason: 'skip_followup' });
    expect(
      nextAdaptiveStep(
        deps,
        request({
          set: { kind: 'lesson', items: [skipped, followup] },
          itemId: 'i2',
          event: 'skipped',
          candidates: [candidate('x', 2, { type: 'fill_blank' })],
        }),
      ),
    ).toEqual([]);
  });

  it('never reuses an exercise or variant group already in the set', () => {
    const current = item('i1', 0, 2, { status: 'answered', type: 'predict_output' });
    const inSet = item('i2', 1, 2, { exerciseId: 'taken', variantGroupKey: 'taken' });
    const actions = nextAdaptiveStep(
      deps,
      request({
        set: { kind: 'lesson', items: [current, inSet] },
        itemId: 'i1',
        solutionJustViewed: true,
        candidates: [candidate('taken', 2)],
      }),
    );
    expect(actions).toEqual([]);
  });
});
