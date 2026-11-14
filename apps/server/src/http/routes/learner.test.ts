import { learnerProfileSchema } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { MINUTE, practiceApp, T0 } from '../../test/practice-app.ts';
import { errorCode, LESSON } from '../../test/practice-flow.ts';

// Onboarding answers (ui-ux.md#온보딩과-목표-설정).

const profile = (json: unknown) => learnerProfileSchema.parse(json);

describe('GET/PATCH /learner', () => {
  it('needs onboarding on first run and never again once it is done', async () => {
    const ctx = await practiceApp();
    expect(profile((await ctx.call('GET', '/learner')).json)).toEqual({
      experienceLevel: 'none',
      onboardedAt: null,
      needsOnboarding: true,
    });

    const level = await ctx.call('PATCH', '/learner', { experienceLevel: 'some' });
    expect(level.status).toBe(200);
    expect(profile(level.json)).toMatchObject({ experienceLevel: 'some', needsOnboarding: true });

    const done = profile((await ctx.call('PATCH', '/learner', { onboarded: true })).json);
    expect(done).toEqual({ experienceLevel: 'some', onboardedAt: T0, needsOnboarding: false });

    // Completing again keeps the first time.
    ctx.clock.now += MINUTE;
    expect(profile((await ctx.call('PATCH', '/learner', { onboarded: true })).json)).toEqual(done);
    expect(profile((await ctx.call('GET', '/learner')).json)).toEqual(done);
  });

  it('does not ask learners who already have records (v0.1 data)', async () => {
    const ctx = await practiceApp();
    await ctx.call('POST', `/lessons/${LESSON}/progress`, { readProgress: 0.1 });
    expect(profile((await ctx.call('GET', '/learner')).json)).toMatchObject({
      onboardedAt: null,
      needsOnboarding: false,
    });
  });

  it('rejects unknown fields and values', async () => {
    const ctx = await practiceApp();
    for (const body of [{ experienceLevel: 'expert' }, { onboarded: false }, { name: 'x' }]) {
      const res = await ctx.call('PATCH', '/learner', body);
      expect(res.status).toBe(400);
      expect(errorCode(res.json)).toBe('VALIDATION_FAILED');
    }
  });
});
