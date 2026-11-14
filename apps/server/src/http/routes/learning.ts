import {
  conceptDetailQuerySchema,
  goalRequestSchema,
  heartbeatRequestSchema,
  lessonProgressRequestSchema,
  reviewQueueQuerySchema,
} from '@proginone/shared';
import { Hono } from 'hono';
import type { PracticeServices } from '../../services/practice/index.ts';
import type { AppEnv } from '../env.ts';
import { contentIdParam, jsonBody, limitBody } from './input.ts';

/**
 * Reading progress, review queue, activity heartbeat and the dashboard summary
 * (docs/design/system-architecture.md#api-규약).
 */
export function learningRoutes(services: PracticeServices) {
  // Mounted at the API root: limit bodies per route, not with a catch-all middleware.
  const small = limitBody(16 * 1024);
  return new Hono<AppEnv>()
    .post('/lessons/:id/progress', small, async (c) => {
      const id = contentIdParam(c.req.param('id'));
      const request = lessonProgressRequestSchema.parse(await jsonBody(c));
      return c.json(services.lessons.record(id, request));
    })
    .get('/review-queue', (c) => {
      const query = reviewQueueQuerySchema.parse(c.req.query());
      return c.json(services.review.queue(query.budgetMinutes));
    })
    .post('/activity/heartbeat', small, async (c) => {
      const request = heartbeatRequestSchema.parse(await jsonBody(c));
      return c.json(services.activity.heartbeat(request));
    })
    .get('/dashboard', (c) => c.json(services.dashboard.get()))
    .get('/weak-concepts', (c) => c.json(services.weakness.list()))
    .get('/daily-plan', (c) => c.json(services.dailyPlan.get()))
    .get('/goals', (c) => c.json(services.goals.get()))
    .put('/goals', small, async (c) => {
      const request = goalRequestSchema.parse(await jsonBody(c));
      return c.json(services.goals.put(request));
    })
    .get('/concepts/:id', (c) => {
      const id = contentIdParam(c.req.param('id'));
      const query = conceptDetailQuerySchema.parse(c.req.query());
      return c.json(services.concepts.get(id, query.evidenceLimit));
    });
}
