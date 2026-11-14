import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { aiCallListQuerySchema } from '@proginone/shared';
import { z } from 'zod';
import type { AiService } from '../../services/ai/ai-service.ts';
import type { AppEnv } from '../env.ts';
import { jsonBody, limitBody } from './input.ts';

/** SSE comment interval (docs/design/ai-system.md#sse-이벤트-형식). */
export const KEEP_ALIVE_MS = 15_000;

const cancelLoginSchema = z.object({ loginId: z.string().min(1).max(200) }).strict();

/**
 * `/ai` (docs/design/system-architecture.md#api-규약): connection status, ChatGPT login, models,
 * the AI call log (`GET /ai/calls`, no prompts) and `GET /ai/events` (SSE `status` snapshots
 * and `login` completions). Login is guarded by the
 * same session token and Origin checks as every `/api` route.
 */
export function aiRoutes(ai: AiService, opts: { keepAliveMs?: number } = {}) {
  const keepAliveMs = opts.keepAliveMs ?? KEEP_ALIVE_MS;
  return new Hono<AppEnv>()
    .use(limitBody(4 * 1024))
    .get('/status', async (c) => c.json(await ai.status()))
    .post('/login', async (c) => c.json(await ai.login()))
    .post('/login/cancel', async (c) => {
      const { loginId } = cancelLoginSchema.parse(await jsonBody(c));
      await ai.cancelLogin(loginId);
      return c.json(ai.snapshot());
    })
    .post('/logout', async (c) => c.json(await ai.logout()))
    .post('/reconnect', async (c) => c.json(await ai.reconnect()))
    .get('/models', async (c) => c.json({ models: await ai.models() }))
    .get('/calls', (c) => c.json(ai.calls(aiCallListQuerySchema.parse(c.req.query()))))
    .get('/events', (c) =>
      streamSSE(c, async (stream) => {
        const state = { closed: false };
        const queue: { event: string; data: string }[] = [];
        let wake: (() => void) | null = null;
        const push = (event: string, data: unknown) => {
          queue.push({ event, data: JSON.stringify(data) });
          wake?.();
        };
        push('status', ai.snapshot());
        const unsubscribe = ai.subscribe((e) => {
          push(e.name, e.data);
        });
        const keepAlive = setInterval(() => {
          void stream.write(': keep-alive\n\n').catch(() => undefined);
        }, keepAliveMs);
        stream.onAbort(() => {
          state.closed = true;
          wake?.();
        });
        try {
          while (!state.closed) {
            const next = queue.shift();
            if (next) {
              await stream.writeSSE(next);
              continue;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = null;
          }
        } finally {
          clearInterval(keepAlive);
          unsubscribe();
        }
      }),
    );
}
