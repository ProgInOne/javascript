import { aiCallListSchema, tutorThreadSchema } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { EX } from '../../test/content-fixture.ts';
import { practiceApp } from '../../test/practice-app.ts';
import { lessonSet, submit } from '../../test/practice-flow.ts';
import { attemptResponseSchema } from '@proginone/shared';

// The ai_calls log is complete for every AI task (docs/design/ai-system.md#ai_calls-기록): task,
// prompt version, provider, model, effort, status, error code, latency and tokens, readable
// through GET /ai/calls without prompts or responses.

describe('ai_calls · GET /ai/calls', () => {
  it('records every task with its versions, model, latency and tokens', async () => {
    const ctx = await practiceApp();
    // tutor.reply
    const thread = tutorThreadSchema.parse(
      (await ctx.call('POST', '/tutor/threads', { scopeType: 'exercise', scopeId: EX.mcq })).json,
    );
    expect(
      (await ctx.call('POST', `/tutor/threads/${thread.id}/messages`, { question: '왜?' })).status,
    ).toBe(200);
    // session.summarize (the mock answers structured tasks with a schema-valid sample)
    expect((await ctx.call('POST', `/tutor/threads/${thread.id}/summary`)).status).toBe(200);
    // tutor.hint
    const set = await lessonSet(ctx);
    const item = set.items.find((i) => i.exerciseId === EX.mcq);
    if (!item) throw new Error('no item');
    await ctx.call('POST', `/exercises/${EX.mcq}/hints`, { practiceSetItemId: item.id });
    expect(
      (await ctx.call('POST', `/exercises/${EX.mcq}/ai-hint`, { practiceSetItemId: item.id }))
        .status,
    ).toBe(200);
    // evaluator.explainMistake
    const attempt = attemptResponseSchema.parse((await submit(ctx, item, { correct: false })).json);
    expect((await ctx.call('POST', `/attempts/${attempt.attempt.id}/explanation`, {})).status).toBe(
      200,
    );
    // misconception.propose
    expect(await ctx.ai.evaluator.proposeMisconceptions('js.basics.statement')).not.toBeNull();

    const { calls } = aiCallListSchema.parse((await ctx.call('GET', '/ai/calls?limit=20')).json);
    expect(calls.map((c) => c.taskName).sort()).toEqual([
      'evaluator.explainMistake',
      'misconception.propose',
      'session.summarize',
      'tutor.hint',
      'tutor.reply',
    ]);
    for (const call of calls) {
      expect(call, call.taskName).toMatchObject({
        provider: 'mock',
        model: 'mock-tutor',
        status: 'ok',
        errorCode: null,
        baseVersion: 2,
      });
      expect(call.taskVersion, call.taskName).toBeGreaterThanOrEqual(1);
      expect(['low', 'medium', 'high'], call.taskName).toContain(call.effort);
      expect(call.latencyTotalMs, call.taskName).toEqual(expect.any(Number));
      expect(call.inputTokens, call.taskName).toEqual(expect.any(Number));
      expect(call.outputTokens, call.taskName).toEqual(expect.any(Number));
      expect(call.contextTokensEstimated, call.taskName).toBeGreaterThan(0);
      expect(call.subjectId, call.taskName).not.toBeNull();
    }
    expect(calls.find((c) => c.taskName === 'evaluator.explainMistake')?.effort).toBe('medium');

    const filtered = aiCallListSchema.parse(
      (await ctx.call('GET', '/ai/calls?taskName=tutor.reply')).json,
    );
    expect(filtered.calls.map((c) => c.taskName)).toEqual(['tutor.reply']);
    expect((await ctx.call('GET', '/ai/calls?limit=0')).status).toBe(400);
  });

  it('records failures with their status and error code', async () => {
    const ctx = await practiceApp();
    const thread = tutorThreadSchema.parse(
      (await ctx.call('POST', '/tutor/threads', { scopeType: 'general' })).json,
    );
    const res = await ctx.call('POST', `/tutor/threads/${thread.id}/messages`, {
      question: '[mock:error:AI_RATE_LIMITED] 질문',
    });
    expect(res.text).toContain('"code":"AI_RATE_LIMITED"');
    const { calls } = aiCallListSchema.parse((await ctx.call('GET', '/ai/calls')).json);
    expect(calls[0]).toMatchObject({
      taskName: 'tutor.reply',
      status: 'rate_limited',
      errorCode: 'AI_RATE_LIMITED',
      provider: 'mock',
      subjectType: 'tutor_message',
    });
    expect(calls[0]?.latencyTotalMs).toEqual(expect.any(Number));
  });
});
