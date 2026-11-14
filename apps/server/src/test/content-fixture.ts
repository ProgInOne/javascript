import { join } from 'node:path';
import { CONTENT_DDL } from '@proginone/content-schema/db';
import { leakFingerprints, redactSpec } from '@proginone/exercise-kit';
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

/** A tiny content.db (2 lessons, 2 concepts, 7 exercises of all 6 types) written with the real DDL. */
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
  ins('misconceptions', {
    id: 'js.mc.log-is-return',
    concept_id: 'js.basics.statement',
    title: 'console.log를 반환으로 생각함',
    description: '출력하면 값이 돌아온다고 생각합니다.',
    correction: 'console.log는 값을 화면에 보여 줄 뿐 돌려주지 않습니다.',
    remedial_exercise_ids_json: '[]',
  });
  for (const ex of FIXTURE_EXERCISES) {
    ins('exercises', {
      id: ex.id,
      type: ex.type,
      difficulty: ex.difficulty,
      lesson_id: ex.lessonId ?? 'js-basics.start.first-program',
      prompt: `${ex.type} 문제`,
      code: ex.code ?? null,
      spec_json: JSON.stringify(ex.spec),
      public_spec_json: JSON.stringify(redactSpec(ex.type, ex.spec)),
      leak_fingerprints_json: JSON.stringify(leakFingerprints(ex.type, ex.spec)),
      hints_json: JSON.stringify({ v: 1, levels: ['힌트 1', '힌트 2', '힌트 3'] }),
      explanation: `${ex.id} 해설`,
      estimated_seconds: 60,
      review_status: 'trusted',
      content_hash: `hash-${ex.id}`,
      dedupe_signature: `sig-${ex.id}`,
    });
    for (const c of ex.concepts ?? [{ id: 'js.basics.statement', weight: 1 }]) {
      ins('exercise_concepts', {
        exercise_id: ex.id,
        concept_id: c.id,
        weight: c.weight,
        is_primary: c.weight === 1 ? 1 : 0,
      });
    }
  }
  db.close();
  return path;
}

// ── Exercises: one or more per implemented type, with real exercise-kit specs ──
// Answer keys carry markers (`*-MARK`, `QUIET!`) so tests can assert they never reach a response.

const P = 'js-basics.start.first-program';

export const EX = {
  mcq: `${P}.mcq-x`,
  mcqMulti: `${P}.mcq-multi-x`,
  trueFalse: `${P}.tf-x`,
  fillText: `${P}.fill-semicolon`,
  fillCode: `${P}.fill-add`,
  predict: `${P}.predict-log`,
  parsons: `${P}.parsons-greet`,
  findBug: `${P}.find-bug-x`,
  implement: `${P}.impl-shout`,
  fixBug: `${P}.fix-shout`,
  web: `${P}.web-list`,
} as const;

/** Markers that only exist in answer keys / hidden checks of the fixture specs. */
export const ANSWER_MARKERS = ['RATIONALE-MARK', 'SOLUTION-MARK', 'QUIET!', 'HIDDEN-MARK'];
/** Spec keys that hold answer keys (exercise-kit testing fixtures use the same list). */
export const ANSWER_KEY_FIELDS = [
  'correct',
  'rationale',
  'misconception',
  'accept',
  'acceptRegex',
  'misconceptionMap',
  'expected',
  'misconceptionByAnswer',
  'solution',
  'misconceptionIfFail',
  'bugMisconception',
  'missedMisconception',
  'misconceptionIfWrong',
  'answer',
  'distractors',
  'alternatives',
  'replaces',
  'bugLines',
  'acceptLines',
  'symptomCheck',
  'fixedCode',
];

const shoutChecks = [
  { kind: 'call', id: 'basic', args: ['hi'], expect: { equals: 'HI!' } },
  {
    kind: 'call',
    id: 'hidden',
    visible: false,
    description: '다른 단어도 외칩니다.',
    args: ['quiet'],
    expect: { equals: 'QUIET!' },
  },
];

interface FixtureExercise {
  id: string;
  type: string;
  difficulty: number;
  spec: unknown;
  code?: string;
  lessonId?: string;
  concepts?: { id: string; weight: number }[];
}

export const FIXTURE_EXERCISES: FixtureExercise[] = [
  {
    id: EX.mcq,
    type: 'mcq_single',
    difficulty: 1,
    spec: {
      options: [
        {
          id: 'a',
          text: '`2`를 돌려준다',
          misconception: 'js.mc.log-is-return',
          rationale: 'RATIONALE-MARK',
        },
        { id: 'b', text: '`2`를 출력한다' },
        { id: 'c', text: '아무 일도 없다' },
      ],
      correct: 'b',
    },
  },
  {
    id: EX.mcqMulti,
    type: 'mcq_multi',
    difficulty: 1,
    spec: {
      options: [
        { id: 'a', text: '`console.log`는 값을 출력한다' },
        { id: 'b', text: '문장은 위에서 아래로 실행된다' },
        {
          id: 'c',
          text: '`console.log`는 값을 돌려준다',
          misconception: 'js.mc.log-is-return',
          rationale: 'RATIONALE-MARK',
        },
      ],
      correct: ['a', 'b'],
    },
  },
  {
    id: EX.trueFalse,
    type: 'true_false',
    difficulty: 1,
    spec: {
      statement: '`console.log(2)`는 2를 돌려준다.',
      answer: false,
      misconceptionIfWrong: 'js.mc.log-is-return',
    },
  },
  {
    id: EX.fillText,
    type: 'fill_blank',
    difficulty: 1,
    spec: {
      mode: 'text',
      template: 'console.log("hi"){{blank:b1}}',
      blanks: [{ id: 'b1', accept: [';'] }],
    },
  },
  {
    id: EX.predict,
    type: 'predict_output',
    difficulty: 2,
    code: 'console.log(1 + 1);',
    spec: {
      code: 'console.log(1 + 1);',
      answerKind: 'console',
      expected: { kind: 'console', lines: ['2'] },
      misconceptionByAnswer: { '11': 'js.mc.log-is-return' },
    },
  },
  {
    id: EX.parsons,
    type: 'parsons',
    difficulty: 2,
    spec: {
      lines: [
        { id: 'l1', code: 'const name = "코코";' },
        { id: 'l2', code: 'console.log(name);' },
      ],
      distractors: [
        { id: 'd1', code: 'console.log("name");', misconception: 'js.mc.log-is-return' },
      ],
    },
  },
  {
    id: EX.findBug,
    type: 'find_bug_line',
    difficulty: 2,
    spec: {
      code: 'let total;\ntotal += 1;\nconsole.log(total);',
      bugLines: [1],
      symptom: '출력이 `NaN`입니다.',
      symptomCheck: { console: ['NaN'] },
      fixedCode: 'let total = 0; // SOLUTION-MARK\ntotal += 1;\nconsole.log(total);',
      causeOptions: [
        { id: 'c1', text: 'total에 처음 값이 없다', correct: true },
        { id: 'c2', text: '`+=`는 문자열에만 쓴다', misconception: 'js.mc.log-is-return' },
      ],
    },
  },
  {
    id: EX.fillCode,
    type: 'fill_blank',
    difficulty: 2,
    spec: {
      mode: 'code',
      template: 'function shout(s) {\n  return {{blank:b1}};\n}',
      entry: 'shout',
      blanks: [{ id: 'b1', accept: ["s.toUpperCase() + '!'"] }],
      checks: shoutChecks,
    },
  },
  {
    id: EX.implement,
    type: 'implement_function',
    difficulty: 3,
    concepts: [
      { id: 'js.basics.statement', weight: 1 },
      { id: 'js.basics.comment', weight: 0.5 },
    ],
    spec: {
      starter: { files: [{ path: 'main.js', content: 'function shout(s) {\n  // 여기에\n}\n' }] },
      entry: 'shout',
      solution: {
        files: [
          {
            path: 'main.js',
            content: "function shout(s) {\n  return s.toUpperCase() + '!'; // SOLUTION-MARK\n}\n",
          },
        ],
      },
      checks: shoutChecks,
    },
  },
  {
    id: EX.fixBug,
    type: 'fix_bug',
    difficulty: 3,
    spec: {
      buggy: {
        files: [{ path: 'main.js', content: "function shout(s) {\n  return s + '!';\n}\n" }],
      },
      entry: 'shout',
      solution: {
        files: [
          {
            path: 'main.js',
            content: "function shout(s) {\n  return s.toUpperCase() + '!'; // SOLUTION-MARK\n}\n",
          },
        ],
      },
      checks: shoutChecks,
      bugDescription: '대문자로 바꾸지 않습니다.',
    },
  },
  {
    id: EX.web,
    type: 'web_task',
    difficulty: 2,
    spec: {
      focus: 'html',
      starter: { files: [{ path: 'index.html', content: '<main></main>' }] },
      solution: {
        files: [
          {
            path: 'index.html',
            content: '<main><ul class="cards"></ul><!-- SOLUTION-MARK --></main>',
          },
        ],
      },
      checks: [
        {
          kind: 'dom',
          id: 'has-list',
          visible: true,
          selector: 'ul.cards',
          expect: { exists: true },
        },
        {
          kind: 'dom',
          id: 'hidden-items',
          visible: false,
          selector: 'ul.cards li.HIDDEN-MARK',
          expect: { exists: false },
        },
      ],
    },
  },
];
