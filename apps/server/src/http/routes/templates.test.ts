import { exerciseViewSchema, type PracticeSetView } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { chooseVariant } from '../../services/practice/templates.ts';
import {
  TPL,
  TPL_CONCEPT,
  TPL_LESSON,
  TPL_MARKER,
  templateAnswer,
} from '../../test/content-fixture.ts';
import { DAY, MINUTE, practiceApp } from '../../test/practice-app.ts';
import { createSet, errorCode, parsed, type Ctx } from '../../test/practice-flow.ts';

// Parametric template variants end to end over the HTTP API (FR-EX-08, FR-EX-14, D-056, D-057):
// variants are served from the verified pool, graded against the execution-derived key, recorded
// as `<template id>@<seed>`, and later sets prefer new variants.

const lessonSet = (ctx: Ctx) => createSet(ctx, { kind: 'lesson', lessonId: TPL_LESSON });

async function answer(ctx: Ctx, item: { id: string; exerciseId: string }, correct = true) {
  ctx.clock.now += MINUTE;
  const right = templateAnswer(item.exerciseId);
  return ctx.call('POST', '/attempts', {
    practiceSetItemId: item.id,
    exerciseId: item.exerciseId,
    answer: { console: correct ? right : `${right}0` },
    confidence: 'sure',
    startedAt: ctx.clock.now - 40_000,
    activeMs: 30_000,
  });
}

const variantItems = (set: PracticeSetView) =>
  set.items.filter((i) => i.exerciseId.startsWith(`${TPL}@`));

describe('template variants', () => {
  it('serves a pooled variant without answer keys and 404s other seeds', async () => {
    const ctx = await practiceApp({ templates: true });
    const [first] = ctx.pool;
    if (!first) throw new Error('empty pool');
    const res = await ctx.call('GET', `/exercises/${first}`);
    expect(res.status).toBe(200);
    const view = exerciseViewSchema.parse(res.json);
    expect(view).toMatchObject({ id: first, type: 'predict_output', lessonId: TPL_LESSON });
    expect(view.publicSpec['code']).toMatch(/^console\.log\(\d \+ \d \* \d\);/);
    expect(view.publicSpec).not.toHaveProperty('expected');
    expect(view.publicSpec).not.toHaveProperty('misconceptionByAnswer');
    expect(res.text).not.toContain(TPL_MARKER);

    // A seed outside the verified pool was never run: not served.
    expect((await ctx.call('GET', `/exercises/${TPL}@1`)).status).toBe(404);
    expect((await ctx.call('GET', `/exercises/${TPL}@zz`)).status).toBe(404);
    expect((await ctx.call('GET', `/exercises/${TPL_LESSON}.t.gone@1`)).status).toBe(404);
  });

  it('grades a variant by its execution-derived key and records templateId@seed', async () => {
    const ctx = await practiceApp({ templates: true });
    const set = await lessonSet(ctx);
    const [item] = variantItems(set);
    if (!item) throw new Error('no variant item');
    expect(ctx.pool).toContain(item.exerciseId);
    expect(item.targetConcept?.id).toBe(TPL_CONCEPT);

    const right = parsed(await answer(ctx, item));
    expect(right.attempt.correct).toBe(true);

    const rows = ctx.userDb.sqlite
      .prepare(
        'SELECT exercise_id, exercise_origin, variant_group_key FROM attempts ORDER BY submitted_at',
      )
      .all();
    expect(rows).toEqual([
      { exercise_id: item.exerciseId, exercise_origin: 'template', variant_group_key: TPL },
    ]);
  });

  it('flags the misconception answer of a variant', async () => {
    const ctx = await practiceApp({ templates: true });
    const [item] = variantItems(await lessonSet(ctx));
    if (!item) throw new Error('no variant item');
    const code = exerciseViewSchema.parse(
      (await ctx.call('GET', `/exercises/${item.exerciseId}`)).json,
    ).publicSpec['code'] as string;
    const [a, b, c] = (code.match(/\d+/g) ?? []).map(Number);
    ctx.clock.now += MINUTE;
    const res = parsed(
      await ctx.call('POST', '/attempts', {
        practiceSetItemId: item.id,
        exerciseId: item.exerciseId,
        answer: { console: String(((a ?? 0) + (b ?? 0)) * (c ?? 0)) },
        startedAt: ctx.clock.now - 40_000,
        activeMs: 30_000,
      }),
    );
    expect(res.attempt.correct).toBe(false);
    expect(res.grade.misconceptions.map((m) => m.id)).toEqual(['js.mc.log-is-return']);
  });

  it('gives "한 번 더 연습" and the review set new variants of the template', async () => {
    const ctx = await practiceApp({ templates: true });
    const served: string[] = [];
    for (let round = 0; round < 3; round++) {
      const set = await lessonSet(ctx);
      const items = variantItems(set);
      expect(items).toHaveLength(1);
      for (const item of items) {
        served.push(item.exerciseId);
        parsed(await answer(ctx, item));
      }
    }
    expect(new Set(served).size).toBe(3);

    // A month later the concept is due: the review asks yet another variant.
    ctx.clock.now += 30 * DAY;
    const review = await createSet(ctx, { kind: 'review' });
    const [item] = variantItems(review);
    if (!item) throw new Error('no review variant');
    expect(item.reason).toBe('review_due');
    expect(served).not.toContain(item.exerciseId);
    expect(parsed(await answer(ctx, item)).attempt.correct).toBe(true);
  });

  it('serves the same variant again in a mistake-notes retry ("다시 풀기")', async () => {
    const ctx = await practiceApp({ templates: true });
    const [item] = variantItems(await lessonSet(ctx));
    if (!item) throw new Error('no variant item');
    parsed(await answer(ctx, item, false));
    const retry = await createSet(ctx, { kind: 'extra', exerciseIds: [item.exerciseId] });
    expect(retry.items.map((i) => i.exerciseId)).toEqual([item.exerciseId]);
    expect(parsed(await answer(ctx, retry.items[0] ?? item)).attempt.correct).toBe(true);
  });

  it('stops serving a template once one of its variants is reported', async () => {
    const ctx = await practiceApp({ templates: true });
    const [item] = variantItems(await lessonSet(ctx));
    if (!item) throw new Error('no variant item');
    parsed(await answer(ctx, item));
    const report = await ctx.call('POST', `/exercises/${item.exerciseId}/reports`, {
      reason: 'wrong_answer',
    });
    expect(report.status).toBe(201);
    const next = await ctx.call('POST', '/practice-sets', { kind: 'lesson', lessonId: TPL_LESSON });
    expect(next.status).toBe(409);
    expect(errorCode(next.json)).toBe('PRACTICE_NO_EXERCISES');
  });
});

describe('chooseVariant', () => {
  const pool = ['a', 'b', 'c', 'd'].map((x, i) => ({
    variantId: `${TPL}@${x}`,
    sampleIndex: i,
    // a and b share an answer.
    answerKey: x === 'b' ? 'A' : x.toUpperCase(),
  }));
  const tpl = { pool, minDistinctFromRecent: 1 };
  const at = (x: string, t: number) => ({ exerciseId: `${TPL}@${x}`, at: t });

  it('is deterministic per seed and prefers unseen variants', () => {
    const first = chooseVariant(tpl, [], 'set-1');
    expect(chooseVariant(tpl, [], 'set-1')).toEqual(first);
    const picks = new Set(
      ['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => chooseVariant(tpl, [], s)?.variantId),
    );
    expect(picks.size).toBeGreaterThan(1);
    const next = chooseVariant(tpl, [at('a', 1), at('c', 2), at('d', 3)], 'set-1');
    expect(next?.variantId).toBe(`${TPL}@b`);
  });

  it('avoids the answers of the most recent variants while unseen ones remain', () => {
    // Last served `a` (answer A): `b` has the same answer, so `c` or `d` comes first.
    for (const seed of ['x', 'y', 'z', 'w']) {
      const pick = chooseVariant(tpl, [at('a', 1)], seed)?.variantId;
      expect([`${TPL}@c`, `${TPL}@d`]).toContain(pick);
    }
    // Only `b` is unseen: served even though its answer repeats.
    expect(chooseVariant(tpl, [at('a', 1), at('c', 2), at('d', 3)], 'q')?.variantId).toBe(
      `${TPL}@b`,
    );
  });

  it('falls back to the variant served longest ago', () => {
    const all = [at('c', 1), at('a', 2), at('d', 3), at('b', 4), at('c', 5)];
    expect(chooseVariant(tpl, all, 'seed')?.variantId).toBe(`${TPL}@a`);
    expect(chooseVariant({ pool: [], minDistinctFromRecent: 3 }, [], 'seed')).toBeNull();
  });
});
