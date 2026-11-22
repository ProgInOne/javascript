import { expect, test } from '@playwright/test';

// Tutor backend against the production build with PROGINONE_AI_PROVIDER=mock (no Codex).
// API-level until the tutor drawer UI lands.

test.describe('tutor API (mock AI)', () => {
  test('connects, streams a reply over SSE and keeps the conversation', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    const token = await page.locator('meta[name="proginone-token"]').getAttribute('content');
    expect(token).toBeTruthy();
    const headers = { 'x-proginone-token': token ?? '' };

    const status = await request.get('/api/v1/ai/status', { headers });
    expect((await status.json()) as unknown).toMatchObject({
      provider: 'mock',
      status: { state: 'ready' },
    });

    const created = await request.post('/api/v1/tutor/threads', {
      headers,
      data: { scopeType: 'lesson', scopeId: 'js-basics.start.first-program' },
    });
    expect([200, 201]).toContain(created.status());
    const thread = (await created.json()) as { id: string };

    const reply = await request.post(`/api/v1/tutor/threads/${thread.id}/messages`, {
      headers,
      data: { question: 'console.log는 무엇을 하나요?', entryPoint: 'free' },
    });
    expect(reply.headers()['content-type']).toContain('text/event-stream');
    const body = await reply.text();
    expect(body).toContain('event: message.created');
    expect(body).toContain('event: delta');
    expect(body).toMatch(/event: done\ndata: \{[^\n]*"status":"complete"/);
    expect(body).not.toContain('<meta>');

    const detail = await request.get(`/api/v1/tutor/threads/${thread.id}/messages`, { headers });
    const messages = ((await detail.json()) as { messages: { role: string; status: string }[] })
      .messages;
    expect(messages.slice(-2).map((m) => [m.role, m.status])).toEqual([
      ['learner', 'complete'],
      ['tutor', 'complete'],
    ]);

    // Long-term memory: summarize the conversation now (session.summarize).
    const summarized = await request.post(`/api/v1/tutor/threads/${thread.id}/summary`, {
      headers,
      data: {},
    });
    expect(summarized.status()).toBe(200);
    expect((await summarized.json()) as unknown).toMatchObject({
      created: true,
      summary: { scopeType: 'tutor_thread', scopeId: thread.id, source: 'ai' },
    });
    const got = await request.get(`/api/v1/tutor/threads/${thread.id}/summary`, { headers });
    expect(
      ((await got.json()) as { summary: { messageCount: number } }).summary.messageCount,
    ).toBeGreaterThanOrEqual(2);
  });

  test('explains a wrong attempt (evaluator.explainMistake) and refuses a correct one', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    const token = await page.locator('meta[name="proginone-token"]').getAttribute('content');
    const headers = { 'x-proginone-token': token ?? '' };
    const exercise = 'js-basics.start.first-program.check-log-role';
    const submit = async (optionId: string) => {
      const res = await request.post(`/api/v1/exercises/${exercise}/inline-attempts`, {
        headers,
        data: {
          answer: { optionId },
          confidence: 'sure',
          startedAt: Date.now() - 20_000,
          activeMs: 15_000,
        },
      });
      expect(res.status()).toBe(201);
      return ((await res.json()) as { attempt: { id: string; correct: boolean } }).attempt;
    };
    const wrong = await submit('b');
    expect(wrong.correct).toBe(false);
    const res = await request.post(`/api/v1/attempts/${wrong.id}/explanation`, {
      headers,
      data: {},
    });
    expect(res.status()).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({
      attemptId: wrong.id,
      source: 'ai',
      fallbackCode: null,
    });

    const right = await submit('a');
    const refused = await request.post(`/api/v1/attempts/${right.id}/explanation`, {
      headers,
      data: {},
    });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'ATTEMPT_CORRECT',
    );
  });
});
