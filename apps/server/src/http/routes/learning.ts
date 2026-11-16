import {
  conceptDetailQuerySchema,
  goalRequestSchema,
  heartbeatRequestSchema,
  learnerPatchSchema,
  lessonProgressRequestSchema,
  masteryChangesQuerySchema,
  mistakeListQuerySchema,
  recentActivityQuerySchema,
  reviewQueueQuerySchema,
} from '@proginone/shared';
import { Hono } from 'hono';
import type { PracticeServices } from '../../services/practice/index.ts';
import type { AppEnv } from '../env.ts';
import { contentIdParam, jsonBody, limitBody } from './input.ts';

/**
 * Reading progress, lesson prerequisites, review queue, activity heartbeat and recent activity,
 * the dashboard summary, goals, the concept detail and its related exercises, the learner
 * profile, the mistake notes and mastery changes
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
    .get('/activity/recent', (c) =>
      c.json(services.recentActivity.list(recentActivityQuerySchema.parse(c.req.query()))),
    )
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
    })
    .get('/concepts/:id/exercises', (c) =>
      c.json(services.relatedExercises.list(contentIdParam(c.req.param('id')))),
    )
    .get('/lessons/:id/prerequisites', (c) =>
      c.json(services.concepts.lessonPrerequisites(contentIdParam(c.req.param('id')))),
    )
    .get('/mastery', (c) => c.json(services.mastery.get()))
    .get('/mastery-changes', (c) =>
      c.json(services.masteryChanges.get(masteryChangesQuerySchema.parse(c.req.query()))),
    )
    .get('/mistakes', (c) =>
      c.json(services.mistakes.list(mistakeListQuerySchema.parse(c.req.query()))),
    )
    .get('/mistakes/:exerciseId', (c) =>
      c.json(services.mistakes.get(contentIdParam(c.req.param('exerciseId')))),
    )
    .get('/learner', (c) => c.json(services.learner.get()))
    .patch('/learner', small, async (c) => {
      const patch = learnerPatchSchema.parse(await jsonBody(c));
      return c.json(services.learner.update(patch));
    });
}
