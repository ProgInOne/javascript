import { join } from 'node:path';
import { CONTENT_DDL } from '@proginone/content-schema/db';
import Database from 'better-sqlite3';
import { tmpDir } from './helpers.ts';

const body = [
  {
    type: 'component',
    name: 'Section',
    props: { kind: 'objectives', id: 'objectives' },
    children: [],
  },
  {
    type: 'paragraph',
    children: [
      { type: 'text', value: '문장은 ' },
      {
        type: 'component',
        name: 'ConceptLink',
        props: { to: 'js.basics.comment' },
        children: [{ type: 'text', value: '주석' }],
      },
    ],
  },
];

/** A tiny content.db (2 lessons, 3 concepts, 1 exercise) written with the real DDL. */
export function writeContentDb(meta: Record<string, string> = {}): string {
  const path = join(tmpDir('proginone-contentdb-'), 'content.db');
  const db = new Database(path);
  db.exec(CONTENT_DDL);
  const ins = (table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row);
    db.prepare(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`,
    ).run(row);
  };
  for (const [key, value] of Object.entries({
    schema_version: '1',
    pack_version: '2026.11.14.1',
    ...meta,
  })) {
    ins('content_meta', { key, value });
  }
  ins('tracks', { id: 'web', title: '웹', summary: '웹 기초', order_index: 0 });
  ins('courses', {
    id: 'js-basics',
    track_id: 'web',
    title: 'JavaScript 기초',
    summary: 'JS',
    language: 'javascript',
    level: 'basic',
    order_index: 0,
    estimated_minutes: 50,
    objectives_json: '["쓴다"]',
  });
  ins('courses', {
    id: 'secret',
    track_id: 'web',
    title: '숨김',
    summary: 's',
    language: 'css',
    level: 'intro',
    order_index: 1,
    estimated_minutes: 0,
    status: 'hidden',
    objectives_json: '[]',
  });
  ins('modules', {
    id: 'js-basics.start',
    course_id: 'js-basics',
    title: '시작하기',
    summary: 's',
    order_index: 0,
  });
  const lesson = (id: string, order: number) => ({
    id,
    module_id: 'js-basics.start',
    title: `단원 ${order}`,
    summary: '요약',
    order_index: order,
    estimated_minutes: 25,
    read_minutes: 10,
    objectives_json: '["목표"]',
    body_compiled: JSON.stringify(body),
    body_text: '문장은 주석',
    sections_json: JSON.stringify({
      v: 1,
      sections: [{ id: 'objectives', kind: 'objectives', title: null }],
    }),
    content_hash: 'h',
  });
  ins('lessons', lesson('js-basics.start.first-program', 0));
  ins('lessons', lesson('js-basics.start.reading-errors', 1));
  const concept = (id: string, lessonId: string) => ({
    id,
    course_id: 'js-basics',
    title: id,
    summary: 's',
    importance: 'core',
    introduced_in_lesson_id: lessonId,
  });
  ins('concepts', concept('js.basics.statement', 'js-basics.start.first-program'));
  ins('concepts', concept('js.basics.comment', 'js-basics.start.reading-errors'));
  ins('lesson_concepts', {
    lesson_id: 'js-basics.start.first-program',
    concept_id: 'js.basics.statement',
    role: 'introduces',
  });
  ins('exercises', {
    id: 'js-basics.start.first-program.mcq-x',
    type: 'mcq_single',
    difficulty: 1,
    lesson_id: 'js-basics.start.first-program',
    prompt: '?',
    spec_json: '{"answer":"a"}',
    public_spec_json: '{}',
    hints_json: '{"v":1,"levels":["a","b","c"]}',
    explanation: 'e',
    estimated_seconds: 30,
    review_status: 'trusted',
    content_hash: 'h',
    dedupe_signature: 'd',
  });
  db.close();
  return path;
}
