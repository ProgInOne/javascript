import { codeDraftPutSchema, exampleIdSchema } from '@proginone/shared';
import { Hono } from 'hono';
import type { CodeDraftService } from '../../services/practice/code-draft-service.ts';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';
import { contentIdParam, jsonBody, limitBody } from './input.ts';

/** Bodies carry learner code: at most 256 KiB of file text plus JSON overhead. */
const draftBody = limitBody(320 * 1024);

function exampleIdParam(value: string): string {
  const parsed = exampleIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('NOT_FOUND', 404, '찾을 수 없습니다.', {
      details: { id: value.slice(0, 64) },
    });
  }
  return parsed.data;
}

/**
 * Code drafts (FR-CODE-06, NFR-04; system-architecture.md#api-규약): exercises at
 * `/code-drafts/exercises/:id`, lesson examples at `/lessons/:id/example-drafts`.
 * Mounted at the API root.
 */
export function draftRoutes(service: CodeDraftService) {
  return new Hono<AppEnv>()
    .get('/code-drafts/exercises/:id', (c) =>
      c.json(service.getExercise(contentIdParam(c.req.param('id')))),
    )
    .put('/code-drafts/exercises/:id', draftBody, async (c) => {
      const id = contentIdParam(c.req.param('id'));
      const request = codeDraftPutSchema.parse(await jsonBody(c));
      return c.json(service.putExercise(id, request));
    })
    .delete('/code-drafts/exercises/:id', (c) => {
      service.deleteExercise(contentIdParam(c.req.param('id')));
      return c.body(null, 204);
    })
    .get('/lessons/:id/example-drafts', (c) =>
      c.json(service.listExamples(contentIdParam(c.req.param('id')))),
    )
    .put('/lessons/:id/example-drafts/:exampleId', draftBody, async (c) => {
      const id = contentIdParam(c.req.param('id'));
      const exampleId = exampleIdParam(c.req.param('exampleId'));
      const request = codeDraftPutSchema.parse(await jsonBody(c));
      return c.json(service.putExample(id, exampleId, request));
    })
    .delete('/lessons/:id/example-drafts/:exampleId', (c) => {
      service.deleteExample(
        contentIdParam(c.req.param('id')),
        exampleIdParam(c.req.param('exampleId')),
      );
      return c.body(null, 204);
    });
}
