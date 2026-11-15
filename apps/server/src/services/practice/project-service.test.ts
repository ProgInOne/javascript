import { describe, expect, it } from 'vitest';
import { milestoneViews } from './project-service.ts';

// Milestone states of the project screen (D-048): event checks run in order on one page.

const spec = {
  checks: [
    { kind: 'dom', id: 'has-form' },
    { kind: 'event', id: 'add' },
    { kind: 'dom', id: 'has-footer' },
    { kind: 'event', id: 'toggle' },
  ],
  milestones: [
    { id: 'm1', title: '폼', checks: ['has-form'] },
    { id: 'm2', title: '추가', checks: ['add'] },
    { id: 'm3', title: '바닥글', checks: ['has-footer'] },
    { id: 'm4', title: '완료', checks: ['toggle'] },
  ],
};
const run = (...passed: boolean[]) =>
  passed.map((p, i) => ({ id: `m${String(i + 1)}`, passed: p }));
const states = (results: ReturnType<typeof run> | null) =>
  milestoneViews(spec, results).map((m) => (m.blocked ? 'blocked' : m.passed));

describe('milestoneViews', () => {
  it('has no result before the first run', () => {
    expect(states(null)).toEqual([null, null, null, null]);
  });

  it('marks event milestones after a failed one as blocked, not other kinds', () => {
    expect(states(run(false, false, false, false))).toEqual([false, 'blocked', false, 'blocked']);
    expect(states(run(true, false, true, false))).toEqual([true, false, true, 'blocked']);
  });

  it('keeps a passed milestone passed after a failed one', () => {
    expect(states(run(true, false, true, true))).toEqual([true, false, true, true]);
  });
});
