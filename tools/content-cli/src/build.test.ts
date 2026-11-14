import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentTables } from '@proginone/content-schema/db';
import Database from 'better-sqlite3';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { buildContent, type ExerciseKitHooks } from './build.ts';
import { EXERCISE, EXERCISE_YAML, LESSON, writeContent } from './test/fixture.ts';

const kit: ExerciseKitHooks = {
  validateSpec: () => ({ ok: true }),
  redact: (_type, spec) => ({ ...spec, answer: undefined }),
  leakFingerprints: () => ['fp1'],
};

function build(
  patch?: (files: Record<string, unknown>) => void,
  options: { includeDrafts?: boolean } = {},
) {
  const out = join(mkdtempSync(join(tmpdir(), 'proginone-build-')), 'content.db');
  const result = buildContent(writeContent(patch), out, {
    kit,
    now: new Date('2026-11-14T00:00:00Z'),
    ...options,
  });
  return { out, result };
}

/** Marks the fixture exercise as an AI draft (and drops references that need approved ones). */
const makeDraft = (f: Record<string, unknown>) => {
  (f[EXERCISE_YAML] as Record<string, unknown>)['review'] = {
    status: 'draft',
    draftedBy: 'ai:codex',
  };
  const mc = (f['misconceptions/js.yaml'] as Record<string, unknown>[])[0];
  if (mc) delete mc['remediation'];
  f['courses/js-basics/modules/01-start/lessons/01-first-program/lesson.mdx'] = (
    f['courses/js-basics/modules/01-start/lessons/01-first-program/lesson.mdx'] as string
  ).replace(/<InlineExercise[^>]*\/>/, '확인');
};

describe('buildContent', () => {
  it('writes a content.db with the curriculum, concepts, and exercises', () => {
    const { out, result } = build();
    expect(result.written).toBe(true);
    expect(result.stats).toEqual({
      courses: 1,
      lessons: 1,
      concepts: 2,
      exercises: 1,
      skippedDrafts: 0,
      includedDrafts: 0,
    });

    const db = new Database(out, { readonly: true });
    const meta = Object.fromEntries(
      (
        db.prepare('SELECT key, value FROM content_meta').all() as { key: string; value: string }[]
      ).map((r) => [r.key, r.value]),
    );
    expect(meta).toMatchObject({
      pack_version: '2026.11.14.1',
      schema_version: '1',
      built_at: '2026-11-14T00:00:00.000Z',
    });
    expect(meta['content_hash']).toMatch(/^[0-9a-f]{64}$/);

    const lesson = db.prepare('SELECT * FROM lessons').get() as Record<string, unknown>;
    expect(lesson).toMatchObject({
      id: LESSON,
      estimated_minutes: 25,
      read_minutes: 10,
      importance: 'core',
    });
    const sections = JSON.parse(lesson['sections_json'] as string) as { sections: unknown[] };
    expect(sections.sections).toHaveLength(12);

    const concept = db.prepare("SELECT * FROM concepts WHERE id = 'js.basics.console-log'").get();
    expect(concept).toMatchObject({ course_id: 'js-basics', introduced_in_lesson_id: LESSON });

    const ex = db.prepare('SELECT * FROM exercises').get() as Record<string, unknown>;
    expect(ex).toMatchObject({
      id: EXERCISE,
      review_status: 'trusted',
      leak_fingerprints_json: '["fp1"]',
    });
    expect(JSON.parse(ex['hints_json'] as string)).toEqual({ v: 1, levels: ['a', 'b', 'c'] });
    expect(db.prepare('SELECT is_primary FROM exercise_concepts').get()).toEqual({ is_primary: 1 });

    const hits = db
      .prepare("SELECT entity_id FROM content_search WHERE content_search MATCH '콘솔에'")
      .all();
    expect(hits.length).toBeGreaterThan(0);
    db.close();
  });

  it('writes nothing when the check fails', () => {
    const { out, result } = build((f) => {
      (f[EXERCISE_YAML] as Record<string, unknown>)['prompt'] = '<b>x</b>';
    });
    expect(result.written).toBe(false);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.partial`)).toBe(false);
  });

  it('skips draft exercises', () => {
    const { out, result } = build(makeDraft);
    expect(result.written).toBe(true);
    expect(result.stats).toMatchObject({ exercises: 0, skippedDrafts: 1, includedDrafts: 0 });
    const db = new Database(out, { readonly: true });
    expect(db.prepare("SELECT value FROM content_meta WHERE key = 'includes_drafts'").get()).toBe(
      undefined,
    );
    db.close();
  });

  it('includes draft exercises as auto_verified with includeDrafts (development builds)', () => {
    const { out, result } = build(makeDraft, { includeDrafts: true });
    expect(result.written).toBe(true);
    expect(result.stats).toMatchObject({ exercises: 1, skippedDrafts: 0, includedDrafts: 1 });
    const db = new Database(out, { readonly: true });
    expect(db.prepare('SELECT id, review_status FROM exercises').get()).toEqual({
      id: EXERCISE,
      review_status: 'auto_verified',
    });
    expect(
      db.prepare("SELECT value FROM content_meta WHERE key = 'includes_drafts'").get(),
    ).toEqual({ value: '1' });
    db.close();
  });

  it('keeps the Drizzle schema in sync with the DDL', () => {
    const { out } = build();
    const db = new Database(out, { readonly: true });
    for (const table of Object.values(contentTables)) {
      const { name, columns } = getTableConfig(table);
      const actual = (db.pragma(`table_info(${name})`) as { name: string }[])
        .map((c) => c.name)
        .sort();
      expect(columns.map((c) => c.name).sort(), name).toEqual(actual);
    }
    db.close();
  });
});
