import { describe, expect, it } from 'vitest';
import { fakeSource } from '../test/fake-source.ts';
import { estimateTokens, truncateToTokens } from './budget.ts';
import { buildContext, type ContextSpec } from './builder.ts';
import { neutralize, tag } from './sections.ts';

const section = (kind: string, variants: string[]) => ({ kind, ref: null, variants });

describe('estimateTokens', () => {
  it('counts Hangul syllables as one token and other text as four characters', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('한글')).toBe(2);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('한a')).toBe(2);
  });

  it('truncates to the budget with a marker', () => {
    const cut = truncateToTokens('가'.repeat(100), 20);
    expect(estimateTokens(cut)).toBeLessThanOrEqual(20);
    expect(cut).toContain('…(생략)');
  });
});

describe('buildContext', () => {
  const spec = (total: number): ContextSpec<null> => ({
    totalBudgetTokens: total,
    sections: [
      {
        kind: 'low',
        required: false,
        priority: 1,
        maxTokens: 100,
        load: () => Promise.resolve(section('low', ['가'.repeat(50), '가'.repeat(10)])),
      },
      {
        kind: 'high',
        required: true,
        priority: 10,
        maxTokens: 100,
        load: () => Promise.resolve(section('high', ['나'.repeat(80), '나'.repeat(40)])),
      },
    ],
  });

  it('keeps spec order in output and gives budget by priority', async () => {
    const built = await buildContext(spec(200), fakeSource(), null, { rehydrate: false });
    expect(built.blocks).toEqual(['가'.repeat(50), '나'.repeat(80)]);
    expect(built.estimatedTokens).toBe(130);
  });

  it('shrinks then drops lower-priority sections when over budget', async () => {
    const tight = await buildContext(spec(95), fakeSource(), null, { rehydrate: false });
    expect(tight.blocks).toEqual(['가'.repeat(10), '나'.repeat(80)]);
    const tighter = await buildContext(spec(85), fakeSource(), null, { rehydrate: false });
    expect(tighter.blocks).toEqual(['나'.repeat(80)]);
    expect(tighter.manifest.find((m) => m.kind === 'low')).toMatchObject({ included: false });
  });

  it('cuts a required section instead of dropping it', async () => {
    const small = spec(10);
    const high = small.sections[1];
    if (high) high.maxTokens = 30;
    const built = await buildContext(small, fakeSource(), null, { rehydrate: false });
    expect(built.manifest.find((m) => m.kind === 'high')).toMatchObject({
      included: true,
      truncated: true,
    });
    expect(built.manifest.find((m) => m.kind === 'low')).toMatchObject({ included: false });
  });
});

describe('sections', () => {
  it('neutralizes only our own tags inside data', () => {
    expect(neutralize('<div>ok</div> </learner_code> <Exercise>')).toBe(
      '<div>ok</div> &lt;/learner_code> &lt;Exercise>',
    );
  });

  it('escapes attribute values', () => {
    expect(tag('a', { x: '"><b', n: 1, skip: null }, null)).toBe('<a x="&quot;&gt;&lt;b" n="1"/>');
  });
});
