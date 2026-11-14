import { describe, expect, it } from 'vitest';
import {
  conceptSchema,
  containsRawHtml,
  exerciseId,
  exerciseSourceSchema,
  lessonId,
  misconceptionId,
  packSchema,
} from './index.ts';

const exercise = {
  id: 'js-basics.start.first-program.mcq-what-is-console',
  type: 'mcq_single',
  difficulty: 1,
  concepts: [{ id: 'js.basics.console-log', weight: 1 }],
  estimatedSeconds: 40,
  prompt: '`console.log`는 무엇을 하나요?',
  spec: { options: [] },
  hints: ['a', 'b', 'c'],
  explanation: '…',
  review: { status: 'approved', draftedBy: 'ai:codex', reviewedBy: 'human' },
};

describe('slugs', () => {
  it.each([
    [lessonId, 'js-basics.functions.function-basics', true],
    [lessonId, 'js-basics.Functions.x', false],
    [lessonId, 'js-basics.functions', false],
    [exerciseId, 'js-basics.functions.function-basics.mcq-return-vs-log', true],
    [misconceptionId, 'js.mc.log-is-return', true],
    [misconceptionId, 'js.fn.return', false],
  ] as const)('%#', (schema, value, ok) => {
    expect(schema.safeParse(value).success).toBe(ok);
  });
});

describe('exerciseSourceSchema', () => {
  it('accepts a valid exercise and applies defaults', () => {
    const parsed = exerciseSourceSchema.parse(exercise);
    expect(parsed).toMatchObject({
      usage: 'practice',
      variantGroup: null,
      tags: [],
      origin: 'authored',
    });
  });

  it('requires exactly three hints', () => {
    const r = exerciseSourceSchema.safeParse({ ...exercise, hints: ['a', 'b'] });
    expect(r.success).toBe(false);
  });

  it('requires exactly one primary concept', () => {
    const r = exerciseSourceSchema.safeParse({
      ...exercise,
      concepts: [
        { id: 'js.basics.console-log', weight: 1 },
        { id: 'js.basics.statement', weight: 1 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('requires a reviewer for approved exercises', () => {
    const r = exerciseSourceSchema.safeParse({
      ...exercise,
      review: { status: 'approved', draftedBy: 'ai:codex' },
    });
    expect(r.success).toBe(false);
  });

  it('accepts an independent AI reviewer, never the drafter itself (D-027)', () => {
    const review = (draftedBy: string, reviewedBy: string) =>
      exerciseSourceSchema.safeParse({
        ...exercise,
        review: { status: 'approved', draftedBy, reviewedBy },
      }).success;
    expect(review('ai:claude', 'ai:reviewer')).toBe(true);
    expect(review('ai:reviewer', 'human')).toBe(true);
    expect(review('ai:reviewer', 'ai:reviewer')).toBe(false);
    expect(review('human', 'human')).toBe(false);
    // Only `human` and `ai:reviewer` can approve.
    expect(review('ai:codex', 'ai:claude')).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(exerciseSourceSchema.safeParse({ ...exercise, answer: 'x' }).success).toBe(false);
  });
});

describe('catalog', () => {
  it('validates pack versions', () => {
    const base = {
      id: 'p',
      schemaVersion: 1,
      title: 't',
      tracks: [{ id: 'web', title: 'w', summary: 's', courses: ['css'] }],
    };
    expect(packSchema.safeParse({ ...base, version: '2026.11.14.1' }).success).toBe(true);
    expect(packSchema.safeParse({ ...base, version: '1.0.0' }).success).toBe(false);
  });

  it('accepts string and object prerequisites', () => {
    const c = conceptSchema.parse({
      id: 'js.fn.return',
      title: 'return',
      importance: 'core',
      summary: 's',
      prerequisites: ['js.fn.call', { id: 'js.values.let', strength: 'helpful' }],
    });
    expect(c.prerequisites).toHaveLength(2);
  });
});

describe('containsRawHtml', () => {
  it.each([
    ['plain **markdown**', false],
    ['use `<div>` in code', false],
    ['```html\n<p>hi</p>\n```', false],
    ['bad <script>alert(1)</script>', true],
    ['<img src=x onerror=alert(1)>', true],
    ['a < b and c > d', false],
  ])('%s', (md, expected) => {
    expect(containsRawHtml(md)).toBe(expected);
  });
});
