import { attemptRequestSchema, createPracticeSetRequestSchema } from '@proginone/shared';
import { Hono } from 'hono';
import type { AttemptService } from '../../services/practice/attempt-service.ts';
import type { PracticeSetService } from '../../services/practice/practice-set-service.ts';
import type { AppEnv } from '../env.ts';
import { jsonBody, limitBody, rowIdParam } from './input.ts';

/** `/practice-sets` (docs/design/system-architecture.md#api-규약). */
export function practiceSetRoutes(service: PracticeSetService, attempts: AttemptService) {
  return new Hono<AppEnv>()
    .use(limitBody(64 * 1024))
    .post('/', async (c) => {
      const request = createPracticeSetRequestSchema.parse(await jsonBody(c));
      return c.json(service.create(request));
    })
    .get('/:id', (c) => c.json(service.get(rowIdParam(c.req.param('id')))))
    .post('/:id/items/:itemId/skip', (c) =>
      c.json(attempts.skip(rowIdParam(c.req.param('id')), rowIdParam(c.req.param('itemId')))),
    );
}

/** `/attempts`. Bodies carry learner code and a sandbox `RunResult` (≤ 1MB by contract). */
export function attemptRoutes(service: AttemptService) {
  return new Hono<AppEnv>().use(limitBody(3 * 1024 * 1024)).post('/', async (c) => {
    const request = attemptRequestSchema.parse(await jsonBody(c));
    return c.json(service.submit(request), 201);
  });
}
