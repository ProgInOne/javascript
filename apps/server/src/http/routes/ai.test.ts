import {
  aiLoginEventSchema,
  aiLoginResponseSchema,
  aiModelsResponseSchema,
  aiStatusResponseSchema,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { practiceApp } from '../../test/practice-app.ts';

/** Reads SSE events from a streaming response until `until` is satisfied, then cancels. */
async function readEvents(
  res: Response,
  until: (events: { event: string; data: unknown }[]) => boolean,
  onEvent?: (event: { event: string; data: unknown }) => void,
) {
  const reader = (res.body as ReadableStream<Uint8Array> | null)?.getReader();
  if (!reader) throw new Error('no body');
  const decoder = new TextDecoder();
  const events: { event: string; data: unknown }[] = [];
  let buffer = '';
  let comments = 0;
  while (!until(events)) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      if (block.startsWith(':')) {
        comments++;
        continue;
      }
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? '';
      const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null') as unknown;
      const entry = { event, data };
      events.push(entry);
      onEvent?.(entry);
    }
  }
  await reader.cancel();
  return { events, comments };
}

describe('/ai', () => {
  it('reports status and usage', async () => {
    const ctx = await practiceApp();
    const res = await ctx.call('GET', '/ai/status');
    expect(res.status).toBe(200);
    expect(aiStatusResponseSchema.parse(res.json)).toMatchObject({
      provider: 'mock',
      status: { state: 'ready', planType: 'mock' },
      usage: { highestUsedPercent: 0 },
      pendingLogin: null,
    });
  });

  it('streams status snapshots and login completion on /ai/events', async () => {
    const ctx = await practiceApp();
    ctx.ai.provider.setStatus({ state: 'logged_out' });
    const res = await ctx.open('GET', '/ai/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    let loginStarted = false;
    const { events } = await readEvents(
      res,
      (list) => list.some((e) => e.event === 'login'),
      (e) => {
        if (!loginStarted && e.event === 'status') {
          loginStarted = true;
          void ctx.call('POST', '/ai/login').then((login) => {
            expect(aiLoginResponseSchema.parse(login.json).authUrl).toContain('mock-login');
          });
        }
      },
    );
    expect(aiStatusResponseSchema.parse(events[0]?.data).status).toEqual({ state: 'logged_out' });
    const login = events.find((e) => e.event === 'login');
    expect(aiLoginEventSchema.parse(login?.data)).toMatchObject({ success: true });
    const ready = events.filter((e) => e.event === 'status').at(-1);
    expect(aiStatusResponseSchema.parse(ready?.data).status.state).toMatch(/ready|logged_out/);
    expect(ctx.ai.service.snapshot().status.state).toBe('ready');
  });

  it('sends keep-alive comments', async () => {
    const ctx = await practiceApp();
    const res = await ctx.open('GET', '/ai/events');
    const started = Date.now();
    const { comments } = await readEvents(res, () => Date.now() - started > 160);
    expect(comments).toBeGreaterThanOrEqual(1);
  });

  it('lists models, logs out and maps AI errors to API errors', async () => {
    const ctx = await practiceApp();
    const models = await ctx.call('GET', '/ai/models');
    expect(aiModelsResponseSchema.parse(models.json).models[0]?.id).toBe('mock-tutor');
    const out = await ctx.call('POST', '/ai/logout');
    expect(aiStatusResponseSchema.parse(out.json).status).toEqual({ state: 'logged_out' });
    const denied = await ctx.call('GET', '/ai/models');
    expect(denied.status).toBe(409);
    expect(denied.json).toMatchObject({ error: { code: 'AI_NOT_CONNECTED', retryable: false } });
  });
});
