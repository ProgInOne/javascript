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
  });
});
