import { Hono } from 'hono';
import type { ContentAccess } from '../../services/curriculum/content-access.ts';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';

const notFound = (what: string, id: string) =>
  new AppError('NOT_FOUND', 404, `${what}을(를) 찾을 수 없습니다.`, { details: { id } });

export function curriculumRoutes(content: ContentAccess) {
  return new Hono<AppEnv>()
    .get('/courses', (c) => c.json(content.repo.listCourses()))
    .get('/courses/:id', (c) => {
      const id = c.req.param('id');
      const course = content.repo.getCourse(id);
      if (!course) throw notFound('과정', id);
      return c.json(course);
    })
    .get('/lessons/:id', (c) => {
      const id = c.req.param('id');
      const lesson = content.repo.getLesson(id);
      if (!lesson) throw notFound('단원', id);
      return c.json(lesson);
    });
}
