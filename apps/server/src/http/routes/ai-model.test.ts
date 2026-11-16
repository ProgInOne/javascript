import { mockModels } from '@proginone/ai';
import { aiModelsResponseSchema, pickModel, tutorThreadSchema } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { EX } from '../../test/content-fixture.ts';
import { practiceApp } from '../../test/practice-app.ts';

// FR-SET-01 model selection (docs/design/ai-system.md#모델-선택, D-060): `settings.ai.model` is
// passed to the provider when a task runs; a saved model the provider stops listing falls back to
// the default model without failing the task, and the saved value is kept.

async function ask(ctx: Awaited<ReturnType<typeof practiceApp>>, threadId?: string) {
  const id =
    threadId ??
    tutorThreadSchema.parse(
      (await ctx.call('POST', '/tutor/threads', { scopeType: 'exercise', scopeId: EX.mcq })).json,
    ).id;
  const res = await ctx.call('POST', `/tutor/threads/${id}/messages`, { question: '왜?' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('event: done');
  return { id, request: ctx.ai.provider.requests.at(-1) };
}

describe('AI model selection · settings.ai.model', () => {
  it('lists the models and defaults to the provider default', async () => {
    const ctx = await practiceApp();
    const { models } = aiModelsResponseSchema.parse((await ctx.call('GET', '/ai/models')).json);
    expect(models.map((m) => [m.id, m.isDefault])).toEqual([
      ['mock-tutor', true],
      ['mock-tutor-deep', false],
    ]);
    expect((await ctx.call('GET', '/settings')).json).toMatchObject({ 'ai.model': null });
    const { request } = await ask(ctx);
    expect(request).toMatchObject({ model: 'mock-tutor', effort: 'low' });
  });

  it('runs tasks on the saved model and rebuilds the tutor thread after a change', async () => {
    const ctx = await practiceApp();
    const first = await ask(ctx);
    expect(first.request?.thread).toEqual({ kind: 'persistent', resumeId: null });
    const again = await ask(ctx, first.id);
    expect(again.request?.thread).toMatchObject({ resumeId: expect.any(String) as string });

    const saved = await ctx.call('PATCH', '/settings', { 'ai.model': 'mock-tutor-deep' });
    expect(saved.json).toMatchObject({ 'ai.model': 'mock-tutor-deep' });
    const changed = await ask(ctx, first.id);
    // The deep model supports medium/high only: the tutor's `low` moves up to `medium`.
    expect(changed.request).toMatchObject({ model: 'mock-tutor-deep', effort: 'medium' });
    expect(changed.request?.thread).toEqual({ kind: 'persistent', resumeId: null });
  });

  it('falls back to the default when the saved model disappears, keeping the setting', async () => {
    const ctx = await practiceApp();
    await ctx.call('PATCH', '/settings', { 'ai.model': 'mock-tutor-deep' });
    expect((await ask(ctx)).request?.model).toBe('mock-tutor-deep');

    ctx.ai.provider.setModels(mockModels().filter((m) => m.id !== 'mock-tutor-deep'));
    // The settings screen refreshes the list (the runner's cache is refreshed with it).
    const { models } = aiModelsResponseSchema.parse((await ctx.call('GET', '/ai/models')).json);
    expect(models.map((m) => m.id)).toEqual(['mock-tutor']);
    const { request } = await ask(ctx);
    expect(request).toMatchObject({ model: 'mock-tutor', effort: 'low' });
    expect((await ctx.call('GET', '/settings')).json).toMatchObject({
      'ai.model': 'mock-tutor-deep',
    });
  });

  it('refreshes a stale model list on its own', async () => {
    const ctx = await practiceApp();
    await ctx.call('PATCH', '/settings', { 'ai.model': 'mock-tutor-deep' });
    expect((await ask(ctx)).request?.model).toBe('mock-tutor-deep');
    ctx.ai.provider.setModels(mockModels().filter((m) => m.id !== 'mock-tutor-deep'));
    ctx.clock.now += 11 * 60_000;
    expect((await ask(ctx)).request?.model).toBe('mock-tutor');
  });

  it('rejects an invalid model setting', async () => {
    const ctx = await practiceApp();
    expect((await ctx.call('PATCH', '/settings', { 'ai.model': '' })).status).toBe(400);
    expect((await ctx.call('PATCH', '/settings', { 'ai.model': 'x'.repeat(201) })).status).toBe(
      400,
    );
    expect((await ctx.call('PATCH', '/settings', { 'ai.model': null })).status).toBe(200);
  });
});

describe('pickModel', () => {
  const models = mockModels();
  it('picks the saved model, else the default, and flags a missing saved model', () => {
    expect(pickModel(models, null)).toMatchObject({ model: { id: 'mock-tutor' }, fallback: false });
    expect(pickModel(models, 'mock-tutor-deep')).toMatchObject({
      model: { id: 'mock-tutor-deep' },
      fallback: false,
    });
    expect(pickModel(models, 'gone')).toMatchObject({
      model: { id: 'mock-tutor' },
      fallback: true,
    });
    expect(pickModel([], 'gone')).toEqual({ model: null, fallback: true });
  });
});
