import {
  inlineAttemptRequestSchema,
  practiceContextSchema,
  reportRequestSchema,
  runPlanRequestSchema,
} from '@proginone/shared';
import { Hono } from 'hono';
import type { AttemptService } from '../../services/practice/attempt-service.ts';
import type { ExerciseService } from '../../services/practice/exercise-service.ts';
import type { AppEnv } from '../env.ts';
import { contentIdParam, jsonBody, limitBody } from './input.ts';

/** `/exercises/:id…` (docs/design/system-architecture.md#api-규약). */
export function exerciseRoutes(service: ExerciseService, attempts: AttemptService) {
  return new Hono<AppEnv>()
    .use(limitBody(1024 * 1024))
    .get('/:id', (c) => {
      const id = contentIdParam(c.req.param('id'));
      const ctx = practiceContextSchema.parse(c.req.query());
      return c.json(service.view(id, ctx));
    })
    .post('/:id/run-plan', async (c) => {
      const id = contentIdParam(c.req.param('id'));
      const request = runPlanRequestSchema.parse(await jsonBody(c));
      return c.json(service.runPlan(id, request));
    })
    .post('/:id/hints', async (c) => {
      const id = contentIdParam(c.req.param('id'));
      const ctx = practiceContextSchema.parse(await jsonBody(c, {}));
      return c.json(service.openHint(id, ctx));
    })
    .post('/:id/solution', async (c) => {
      const id = contentIdParam(c.req.param('id'));
      const ctx = practiceContextSchema.parse(await jsonBody(c, {}));
      return c.json(service.viewSolution(id, ctx));
    })
    .post('/:id/inline-attempts', async (c) => {
      const id = contentIdParam(c.req.param('id'));
      const request = inlineAttemptRequestSchema.parse(await jsonBody(c));
      return c.json(attempts.submitInline(id, request), 201);
    })
    .post('/:id/reports', async (c) => {
      const id = contentIdParam(c.req.param('id'));
      const request = reportRequestSchema.parse(await jsonBody(c));
      return c.json(service.report(id, request), 201);
    });
}
