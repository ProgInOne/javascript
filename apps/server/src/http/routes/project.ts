import { projectAttemptRequestSchema } from '@proginone/shared';
import { Hono } from 'hono';
import type { ProjectService } from '../../services/practice/project-service.ts';
import type { AppEnv } from '../env.ts';
import { contentIdParam, jsonBody, limitBody } from './input.ts';

/**
 * `/lessons/:id/project` of a `kind: project` unit (docs/design/system-architecture.md#api-규약).
 * Grading runs carry learner code and a sandbox `RunResult` (≤ 1MB by contract), like `/attempts`.
 */
export function projectRoutes(service: ProjectService) {
  return new Hono<AppEnv>()
    .get('/lessons/:id/project', (c) => c.json(service.get(contentIdParam(c.req.param('id')))))
    .post('/lessons/:id/project/attempts', limitBody(3 * 1024 * 1024), async (c) => {
      const id = contentIdParam(c.req.param('id'));
      const request = projectAttemptRequestSchema.parse(await jsonBody(c));
      return c.json(service.submit(id, request), 201);
    });
}
