import {
  apiErrorSchema,
  courseDetailSchema,
  courseListSchema,
  lessonDetailSchema,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { ContentAccess } from '../../services/curriculum/content-access.ts';
import { SettingsService } from '../../services/settings/service.ts';
import {
  ASSESSMENT,
  ASSESSMENT_EXERCISES,
  FIXTURE_EXERCISES,
  writeContentDb,
} from '../../test/content-fixture.ts';
import { setupDb, silentLog } from '../../test/helpers.ts';
import type { PracticeServices } from '../../services/practice/index.ts';
import { createApp } from '../app.ts';
import { TOKEN_HEADER } from '../security.ts';

async function setup(content: ContentAccess) {
  const ctx = await setupDb();
  const app = createApp({
    config: { port: 4310, mode: 'production' },
    log: silentLog,
    token: 't',
    backups: ctx.backups,
    settings: new SettingsService({ userDb: ctx.userDb, log: silentLog }),
    content,
    practice: {} as PracticeServices,
    maintenance: ctx.maintenance,
  });
  return (path: string) =>
    app.request(`http://127.0.0.1:4310/api/v1${path}`, {
      headers: { host: '127.0.0.1:4310', [TOKEN_HEADER]: 't' },
    });
}

describe('curriculum routes', () => {
  it('lists published courses by track', async () => {
    const get = await setup(ContentAccess.open(writeContentDb()));
    const list = courseListSchema.parse(await (await get('/courses')).json());
    expect(list.packVersion).toBe('2026.11.14.1');
    expect(list.tracks[0]?.courses.map((c) => c.id)).toEqual(['js-basics']);
    expect(list.tracks[0]?.courses[0]?.lessonCount).toBe(3);
  });

  it('returns a course with modules, lessons, and practice counts', async () => {
    const get = await setup(ContentAccess.open(writeContentDb()));
    const course = courseDetailSchema.parse(await (await get('/courses/js-basics')).json());
    expect(course.modules[0]?.lessons.map((l) => [l.id, l.exerciseCount])).toEqual([
      ['js-basics.start.first-program', FIXTURE_EXERCISES.length],
      ['js-basics.start.reading-errors', 0],
      [ASSESSMENT, ASSESSMENT_EXERCISES.length],
    ]);
    expect((await get('/courses/secret')).status).toBe(404);
  });

  it('returns a lesson with body, concepts, and neighbours but no answer keys', async () => {
    const get = await setup(ContentAccess.open(writeContentDb()));
    const res = await get('/lessons/js-basics.start.first-program');
    const text = await res.text();
    const lesson = lessonDetailSchema.parse(JSON.parse(text));
    expect(lesson.previous).toBeNull();
    expect(lesson.next?.id).toBe('js-basics.start.reading-errors');
    expect(lesson.concepts.map((c) => [c.id, c.role])).toEqual([
      ['js.basics.statement', 'introduces'],
      ['js.basics.comment', 'linked'],
    ]);
    expect(text).not.toContain('answer');
  });

  it('returns 404 for unknown ids', async () => {
    const get = await setup(ContentAccess.open(writeContentDb()));
    const res = await get('/lessons/nope.nope.nope');
    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('answers 503 CONTENT_UNAVAILABLE without a content.db', async () => {
    const get = await setup(ContentAccess.open('/nonexistent/content.db'));
    const res = await get('/courses');
    expect(res.status).toBe(503);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe('CONTENT_UNAVAILABLE');
  });

  it('refuses an unsupported content.db schema version', () => {
    expect(() => ContentAccess.open(writeContentDb({ schema_version: '99' }))).toThrow(
      '지원하지 않습니다',
    );
  });
});
