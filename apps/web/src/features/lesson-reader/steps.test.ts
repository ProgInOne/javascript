import { describe, expect, it } from 'vitest';
import { groupSteps, stepIndexOf } from './steps.ts';

const section = (kind: string, id = kind) => ({
  type: 'component',
  name: 'Section',
  props: { kind, id },
  children: [],
});

describe('groupSteps', () => {
  it('groups the standard sections into the five steps', () => {
    const kinds = [
      'objectives',
      'prerequisites',
      'intro',
      'principle',
      'examples',
      'walkthrough',
      'pitfalls',
      'in-practice',
      'check',
      'practice',
      'summary',
      'next',
    ];
    const steps = groupSteps(kinds.map((k) => section(k)));
    expect(steps.map((s) => [s.label, s.sectionIds])).toEqual([
      ['왜 배울까', ['objectives', 'prerequisites', 'intro']],
      ['원리', ['principle']],
      ['직접 해 보기', ['examples', 'walkthrough']],
      ['주의', ['pitfalls', 'in-practice']],
      ['확인', ['check', 'practice', 'summary', 'next']],
    ]);
    expect(steps.map((s) => s.id)).toEqual([
      'step-why',
      'step-principle',
      'step-try',
      'step-caution',
      'step-check',
    ]);
  });

  it('leaves out missing steps and never reorders the content', () => {
    const paragraph = { type: 'paragraph', children: [] };
    const body = [
      paragraph,
      section('intro'),
      section('examples'),
      // Out of the usual order: stays where the author put it.
      section('principle'),
      section('custom', 'extra'),
      section('summary'),
    ];
    const steps = groupSteps(body);
    expect(steps.map((s) => [s.key, s.sectionIds])).toEqual([
      ['why', ['intro']],
      ['try', ['examples', 'principle', 'extra']],
      ['check', ['summary']],
    ]);
    expect(steps[0]?.nodes[0]).toBe(paragraph);
    expect(steps.flatMap((s) => s.nodes)).toEqual(body);
    expect(stepIndexOf(steps, 'principle')).toBe(1);
    expect(stepIndexOf(steps, null)).toBe(-1);
  });

  it('returns no steps for a body without standard sections', () => {
    expect(groupSteps([{ type: 'paragraph', children: [] }])).toEqual([]);
    expect(groupSteps([])).toEqual([]);
  });
});
