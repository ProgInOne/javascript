import {
  CODE_DRAFT_MAX_BYTES,
  codeDraftPutResponseSchema,
  codeDraftResponseSchema,
  exampleDraftListSchema,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { wipeLearningData } from '../../services/data/reset-service.ts';
import { EX, PROJECT_EXERCISE } from '../../test/content-fixture.ts';
import { count, practiceApp } from '../../test/practice-app.ts';
import { answerAll, errorCode, lessonSet, LESSON, type Ctx } from '../../test/practice-flow.ts';

// Server-side code drafts (FR-CODE-06, NFR-04; data-model.md#code_drafts).

const files = (content: string) => [{ path: 'main.js', content }];
const ITEM = '01JD3Z8Q6V2K9M4T7R1X5W0BND';

const put = (ctx: Ctx, exerciseId: string, body: object) =>
  ctx.call('PUT', `/code-drafts/exercises/${exerciseId}`, body);
const get = async (ctx: Ctx, exerciseId: string) => {
  const res = await ctx.call('GET', `/code-drafts/exercises/${exerciseId}`);
  expect(res.status).toBe(200);
  return codeDraftResponseSchema.parse(res.json).draft;
};

describe('exercise drafts', () => {
  it('saves, overwrites with newer edits and ignores stale ones', async () => {
    const ctx = await practiceApp();
    expect(await get(ctx, EX.implement)).toBeNull();

    const first = await put(ctx, EX.implement, {
      files: files('// v1'),
      updatedAt: 1_000,
      practiceSetItemId: ITEM,
    });
    expect(first.status).toBe(200);
    expect(codeDraftPutResponseSchema.parse(first.json)).toEqual({
      applied: true,
      draft: {
        kind: 'exercise',
        id: EX.implement,
        files: files('// v1'),
        updatedAt: 1_000,
        practiceSetItemId: ITEM,
      },
    });

    await put(ctx, EX.implement, { files: files('// v2'), updatedAt: 2_000 });
    // A late request with an older edit does not overwrite the newer draft.
    const stale = codeDraftPutResponseSchema.parse(
      (await put(ctx, EX.implement, { files: files('// v0'), updatedAt: 1_500 })).json,
    );
    expect(stale).toMatchObject({ applied: false, draft: { files: files('// v2') } });
    expect(await get(ctx, EX.implement)).toMatchObject({
      files: files('// v2'),
      updatedAt: 2_000,
      practiceSetItemId: null,
    });
    expect(count(ctx, 'code_drafts')).toBe(1); // one row per exercise
  });

  it('keeps the draft after submission and deletes it on request', async () => {
    const ctx = await practiceApp();
    await put(ctx, EX.implement, { files: files('// mine'), updatedAt: 1 });
    await answerAll(ctx, await lessonSet(ctx));
    expect(await get(ctx, EX.implement)).toMatchObject({ files: files('// mine') });

    expect((await ctx.call('DELETE', `/code-drafts/exercises/${EX.implement}`)).status).toBe(204);
    expect(await get(ctx, EX.implement)).toBeNull();
  });

  it('accepts code exercises only, and project exercises too', async () => {
    const ctx = await practiceApp();
    for (const id of [EX.fixBug, EX.web, PROJECT_EXERCISE]) {
      const res = await put(ctx, id, {
        files: [{ path: 'index.html', content: '<p>x</p>' }],
        updatedAt: 1,
      });
      expect(res.status).toBe(200);
    }
    const mcq = await put(ctx, EX.mcq, { files: files('x'), updatedAt: 1 });
    expect(mcq.status).toBe(400);
    expect(errorCode(mcq.json)).toBe('VALIDATION_FAILED');
    const unknown = await put(ctx, 'js-basics.start.first-program.nope', {
      files: files('x'),
      updatedAt: 1,
    });
    expect(unknown.status).toBe(404);
    expect((await ctx.call('GET', '/code-drafts/exercises/..%2Fx')).status).toBe(404);
  });

  it('treats the code as untrusted input: size, paths and shape are checked', async () => {
    const ctx = await practiceApp();
    const bad: object[] = [
      { files: [], updatedAt: 1 },
      { files: files('x'), updatedAt: -1 },
      { files: [{ path: '../etc/passwd', content: 'x' }], updatedAt: 1 },
      { files: [{ path: '/abs.js', content: 'x' }], updatedAt: 1 },
      { files: [...files('a'), ...files('b')], updatedAt: 1 }, // duplicate path
      { files: files('x'), updatedAt: 1, extra: true },
      { files: files('x'), updatedAt: 1, practiceSetItemId: 'not-a-ulid' },
      // Over the total limit while each file stays under the per-file one.
      {
        files: Array.from({ length: 3 }, (_, i) => ({
          path: `f${String(i)}.js`,
          content: '가'.repeat(Math.ceil(CODE_DRAFT_MAX_BYTES / 3 / 3) + 10),
        })),
        updatedAt: 1,
      },
    ];
    for (const body of bad) {
      const res = await put(ctx, EX.implement, body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    // The request body itself is capped before parsing.
    const huge = await put(ctx, EX.implement, {
      files: files('x'.repeat(400_000)),
      updatedAt: 1,
    });
    expect(huge.status).toBe(413);
    expect(count(ctx, 'code_drafts')).toBe(0);

    // Script-looking text is stored and returned as plain text, never run.
    const script = '</script><script>alert(1)</script>${process.exit(1)}';
    await put(ctx, EX.implement, { files: files(script), updatedAt: 1 });
    expect((await get(ctx, EX.implement))?.files[0]?.content).toBe(script);
  });
});

describe('lesson example drafts', () => {
  const putExample = (ctx: Ctx, exampleId: string, body: object, lessonId = LESSON) =>
    ctx.call('PUT', `/lessons/${lessonId}/example-drafts/${exampleId}`, body);
  const list = async (ctx: Ctx, lessonId = LESSON) =>
    exampleDraftListSchema.parse(
      (await ctx.call('GET', `/lessons/${lessonId}/example-drafts`)).json,
    ).drafts;

  it('keeps one draft per editable example of a lesson', async () => {
    const ctx = await practiceApp();
    expect(await list(ctx)).toEqual([]);
    expect(
      (await putExample(ctx, 'hello', { files: files('// edited'), updatedAt: 5 })).status,
    ).toBe(200);
    expect(await list(ctx)).toEqual([
      {
        kind: 'example',
        id: 'hello',
        files: files('// edited'),
        updatedAt: 5,
        practiceSetItemId: null,
      },
    ]);
    // Another lesson's list does not see it.
    expect(await list(ctx, 'js-basics.start.reading-errors')).toEqual([]);

    expect((await ctx.call('DELETE', `/lessons/${LESSON}/example-drafts/hello`)).status).toBe(204);
    expect(await list(ctx)).toEqual([]);
  });

  it('refuses examples that are not editable or do not exist', async () => {
    const ctx = await practiceApp();
    for (const id of ['fixed', 'style', 'missing']) {
      const res = await putExample(ctx, id, { files: files('x'), updatedAt: 1 });
      expect(res.status, id).toBe(404);
    }
    expect((await putExample(ctx, 'Bad_Id', { files: files('x'), updatedAt: 1 })).status).toBe(404);
    expect(
      (await putExample(ctx, 'hello', { files: files('x'), updatedAt: 1 }, 'js-basics.start.nope'))
        .status,
    ).toBe(404);
    expect(
      (await putExample(ctx, 'hello', { files: files('x'), updatedAt: 1, practiceSetItemId: ITEM }))
        .status,
    ).toBe(400);
    expect(count(ctx, 'code_drafts')).toBe(0);
  });
});

describe('drafts in backups and resets', () => {
  it('are restored with a backup and wiped by a learning data reset (D-045)', async () => {
    const ctx = await practiceApp();
    await put(ctx, EX.implement, { files: files('// backed up'), updatedAt: 1 });
    const backup = await ctx.backups.create('manual');
    await ctx.call('DELETE', `/code-drafts/exercises/${EX.implement}`);
    expect(await get(ctx, EX.implement)).toBeNull();

    await ctx.backups.restore(backup.id);
    expect(await get(ctx, EX.implement)).toMatchObject({ files: files('// backed up') });

    wipeLearningData(ctx.userDb.sqlite);
    expect(count(ctx, 'code_drafts')).toBe(0);
  });
});
