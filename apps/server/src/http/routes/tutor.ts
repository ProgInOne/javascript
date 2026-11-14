import {
  aiHintRequestSchema,
  createTutorThreadRequestSchema,
  postTutorMessageRequestSchema,
  tutorThreadListQuerySchema,
} from '@proginone/shared';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { MemoryService } from '../../services/tutor/memory-service.ts';
import type { TutorService } from '../../services/tutor/tutor-service.ts';
import type { AppEnv } from '../env.ts';
import { KEEP_ALIVE_MS } from './ai.ts';
import { contentIdParam, jsonBody, limitBody, rowIdParam } from './input.ts';

/** Bodies carry up to 10 learner files of 20,000 characters plus a run summary. */
const MESSAGE_BODY_LIMIT = 512 * 1024;

/**
 * `/tutor` (docs/design/system-architecture.md#api-규약 "튜터"). `POST /threads/:id/messages`
 * answers with SSE: `message.created` → (`status`) → `delta`… (`reset`) → `done` | `error`.
 * The turn runs to the end even if the client disconnects; the web reloads the thread.
 */
export function tutorRoutes(
  tutor: TutorService,
  opts: { keepAliveMs?: number; memory?: MemoryService } = {},
) {
  const keepAliveMs = opts.keepAliveMs ?? KEEP_ALIVE_MS;
  const memory = opts.memory;
  const routes = new Hono<AppEnv>()
    .post('/threads', limitBody(4 * 1024), async (c) => {
      const request = createTutorThreadRequestSchema.parse(await jsonBody(c));
      const { thread, created } = tutor.createThread(request);
      return c.json(thread, created ? 201 : 200);
    })
    .get('/threads', (c) => {
      const query = tutorThreadListQuerySchema.parse(c.req.query());
      return c.json(tutor.listThreads(query));
    })
    .get('/threads/:id/messages', (c) => c.json(tutor.detail(rowIdParam(c.req.param('id')))))
    .post('/threads/:id/messages', limitBody(MESSAGE_BODY_LIMIT), async (c) => {
      const threadId = rowIdParam(c.req.param('id'));
      const request = postTutorMessageRequestSchema.parse(await jsonBody(c));
      // Validation, the assessment lock and the AI state are checked before streaming starts,
      // so those failures are ordinary JSON errors and nothing is stored.
      const turn = await tutor.prepareMessage(threadId, request);
      return streamSSE(c, async (stream) => {
        let open = true;
        stream.onAbort(() => {
          open = false;
        });
        const keepAlive = setInterval(() => {
          if (open) void stream.write(': keep-alive\n\n').catch(() => undefined);
        }, keepAliveMs);
        let writes = Promise.resolve();
        try {
          await turn.run((event, data) => {
            if (!open) return;
            writes = writes
              .then(() => stream.writeSSE({ event, data: JSON.stringify(data) }))
              .catch(() => {
                open = false;
              });
          });
          await writes;
        } finally {
          clearInterval(keepAlive);
        }
      });
    })
    .post('/threads/:id/messages/:messageId/cancel', (c) =>
      c.json(tutor.cancel(rowIdParam(c.req.param('id')), rowIdParam(c.req.param('messageId')))),
    );
  if (!memory) return routes;
  // Long-term memory: the thread's rolling summary (session.summarize).
  return routes
    .get('/threads/:id/summary', (c) => c.json(memory.summary(rowIdParam(c.req.param('id')))))
    .post('/threads/:id/summary', limitBody(1024), async (c) =>
      c.json(await memory.summarizeThread(rowIdParam(c.req.param('id')), 'manual')),
    );
}

/** `POST /exercises/:id/ai-hint`: tutor.hint at the hint level already opened. */
export function aiHintRoutes(tutor: TutorService) {
  return new Hono<AppEnv>().post('/:id/ai-hint', limitBody(MESSAGE_BODY_LIMIT), async (c) => {
    const id = contentIdParam(c.req.param('id'));
    const request = aiHintRequestSchema.parse(await jsonBody(c, {}));
    return c.json(await tutor.aiHint(id, request));
  });
}
