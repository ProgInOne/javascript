import { join } from 'node:path';
import { CONTENT_DB_SCHEMA_VERSION, CONTENT_DDL } from '@proginone/content-schema/db';
import {
  instantiateTemplate,
  instantiateVariant,
  leakFingerprints,
  redactSpec,
  sampleSeeds,
} from '@proginone/exercise-kit';
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
  // Examples: editable JS, one marked not editable, and CSS (no run, so no draft).
  {
    type: 'component',
    name: 'RunnableExample',
    props: { id: 'hello', lang: 'js', code: "console.log('hi');" },
    children: [],
  },
  {
    type: 'component',
    name: 'RunnableExample',
    props: { id: 'fixed', lang: 'js', code: '1;', editable: false },
    children: [],
  },
  {
    type: 'component',
    name: 'RunnableExample',
    props: { id: 'style', lang: 'css', code: 'p { color: red; }' },
    children: [],
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
    schema_version: String(CONTENT_DB_SCHEMA_VERSION),
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
  // The module's unit assessment (kind: assessment; learning-engine.md#단원-평가-세트).
  ins('lessons', {
    ...lesson(ASSESSMENT, 2),
    title: '시작하기 단원 평가',
    kind: 'assessment',
  });
  db.prepare('UPDATE modules SET assessment_id = ? WHERE id = ?').run(
    ASSESSMENT,
    'js-basics.start',
  );
  // The module's project (kind: project; content-and-exercises.md#프로젝트-단원-kind-project).
  ins('lessons', {
    ...lesson(PROJECT, 3),
    title: '미니 프로젝트',
    kind: 'project',
    estimated_minutes: 50,
    read_minutes: 5,
  });
  db.prepare('UPDATE modules SET project_id = ? WHERE id = ?').run(PROJECT, 'js-basics.start');
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
  // Relearning looks at required prerequisites (learning-engine.md#재학습-규칙).
  ins('concept_prerequisites', {
    concept_id: 'js.basics.statement',
    prerequisite_id: 'js.basics.comment',
    strength: 'required',
  });
  ins('misconceptions', {
    id: 'js.mc.log-is-return',
    concept_id: 'js.basics.statement',
    title: 'console.log를 반환으로 생각함',
    description: '출력하면 값이 돌아온다고 생각합니다.',
    correction: 'console.log는 값을 화면에 보여 줄 뿐 돌려주지 않습니다.',
    remedial_exercise_ids_json: '[]',
  });
  for (const role of ['js.basics.statement', 'js.basics.comment']) {
    ins('lesson_concepts', { lesson_id: ASSESSMENT, concept_id: role, role: 'reviews' });
  }
  ins('lesson_concepts', {
    lesson_id: PROJECT,
    concept_id: 'js.basics.statement',
    role: 'practices',
  });
  ins('lesson_concepts', { lesson_id: PROJECT, concept_id: 'js.basics.comment', role: 'reviews' });
  ins('assessments', {
    id: ASSESSMENT,
    scope_type: 'module',
    scope_id: 'js-basics.start',
    title: '시작하기 단원 평가',
    exercise_ids_json: JSON.stringify(ASSESSMENT_EXERCISES.map((e) => e.id)),
    selection_rule_json: JSON.stringify({
      v: 1,
      itemCount: null,
      conceptIds: ['js.basics.statement', 'js.basics.comment'],
    }),
    pass_ratio: 0.8,
  });
  for (const ex of [
    ...FIXTURE_EXERCISES,
    ...LESSON_BLOCK_EXERCISES,
    ...REMEDIAL_EXERCISES,
    ...ASSESSMENT_EXERCISES,
    ...PROJECT_EXERCISES,
  ]) {
    ins('exercises', {
      id: ex.id,
      type: ex.type,
      difficulty: ex.difficulty,
      lesson_id: ex.lessonId ?? 'js-basics.start.first-program',
      usage: ex.usage ?? 'practice',
      prompt: `${ex.type} 문제`,
      code: ex.code ?? null,
      spec_json: JSON.stringify(ex.spec),
      public_spec_json: JSON.stringify(redactSpec(ex.type, ex.spec)),
      leak_fingerprints_json: JSON.stringify(leakFingerprints(ex.type, ex.spec)),
      hints_json: JSON.stringify({ v: 1, levels: ['힌트 1', '힌트 2', '힌트 3'] }),
      explanation: `${ex.id} 해설`,
      estimated_seconds: 60,
      // Wrong options/patterns pointing to misconceptions (content-cli derives this from specs).
      misconception_ids_json: JSON.stringify(
        JSON.stringify(ex.spec).includes('js.mc.log-is-return') ? ['js.mc.log-is-return'] : [],
      ),
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
  usage?: 'practice' | 'remedial' | 'assessment' | 'project' | 'check' | 'try';
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

/**
 * The first lesson's own body items (D-091): "이해도 확인" checks (`usage: check`, answered by
 * `inline-attempts`) and a "직접 써 보기" task (`usage: try`, checked by `try-attempts`). Kept out of
 * FIXTURE_EXERCISES: practice sets never serve them.
 */
export const BLOCK = {
  checkMcq: `${P}.check-mcq`,
  checkPredict: `${P}.check-predict`,
  tryShout: `${P}.try-shout`,
} as const;

const fixtureById = (id: string): FixtureExercise => {
  const ex = FIXTURE_EXERCISES.find((e) => e.id === id);
  if (!ex) throw new Error(`no fixture exercise ${id}`);
  return ex;
};

export const LESSON_BLOCK_EXERCISES: FixtureExercise[] = [
  { ...fixtureById(EX.mcq), id: BLOCK.checkMcq, usage: 'check' },
  { ...fixtureById(EX.predict), id: BLOCK.checkPredict, usage: 'check' },
  { ...fixtureById(EX.implement), id: BLOCK.tryShout, usage: 'try' },
];

// ── Remedial exercises: outside lesson and review sets, used by adaptive items and weakness sets ──

const choice = {
  options: [
    { id: 'a', text: '`2`를 돌려준다', misconception: 'js.mc.log-is-return' },
    { id: 'b', text: '`2`를 출력한다' },
    { id: 'c', text: '아무 일도 없다' },
  ],
  correct: 'b',
};

/** `usage: remedial` choice exercises (answer `b` is correct, `a` points to the misconception). */
export const REMEDIAL = {
  statementL1: `${P}.remedial-statement-l1`,
  statementL2: `${P}.remedial-statement-l2`,
  statementL3: `${P}.remedial-statement-l3`,
  statementL4: `${P}.remedial-statement-l4`,
  commentL1a: `${P}.remedial-comment-l1a`,
  commentL1b: `${P}.remedial-comment-l1b`,
  commentL2: `${P}.remedial-comment-l2`,
} as const;

const remedial = (id: string, difficulty: number, concept: string): FixtureExercise => ({
  id,
  type: 'mcq_single',
  difficulty,
  usage: 'remedial',
  spec: choice,
  concepts: [{ id: concept, weight: 1 }],
});

export const REMEDIAL_EXERCISES: FixtureExercise[] = [
  remedial(REMEDIAL.statementL1, 1, 'js.basics.statement'),
  remedial(REMEDIAL.statementL2, 2, 'js.basics.statement'),
  remedial(REMEDIAL.statementL3, 3, 'js.basics.statement'),
  remedial(REMEDIAL.statementL4, 4, 'js.basics.statement'),
  remedial(REMEDIAL.commentL1a, 1, 'js.basics.comment'),
  remedial(REMEDIAL.commentL1b, 1, 'js.basics.comment'),
  remedial(REMEDIAL.commentL2, 2, 'js.basics.comment'),
];

// ── Unit assessment: usage `assessment`, only served by assessment sets ──

export const ASSESSMENT = 'js-basics.start.start-review';

/** Assessment items (answer `b` is correct). Easy → hard: statement L2, comment L2, … */
export const ASSESS = {
  statementL2: `${ASSESSMENT}.mcq-statement-l2`,
  statementL3: `${ASSESSMENT}.mcq-statement-l3`,
  statementL4: `${ASSESSMENT}.mcq-statement-l4`,
  commentL2: `${ASSESSMENT}.mcq-comment-l2`,
  commentL3: `${ASSESSMENT}.tf-comment-l3`,
} as const;

const assessmentItem = (
  id: string,
  difficulty: number,
  concept: string,
  type = 'mcq_single',
): FixtureExercise => ({
  id,
  type,
  difficulty,
  usage: 'assessment',
  lessonId: ASSESSMENT,
  spec:
    type === 'true_false'
      ? {
          statement: '주석은 실행된다.',
          answer: false,
          misconceptionIfWrong: 'js.mc.log-is-return',
        }
      : { ...choice, options: choice.options.map((o) => ({ ...o, rationale: 'RATIONALE-MARK' })) },
  concepts: [{ id: concept, weight: 1 }],
});

export const ASSESSMENT_EXERCISES: FixtureExercise[] = [
  assessmentItem(ASSESS.statementL2, 2, 'js.basics.statement'),
  assessmentItem(ASSESS.statementL3, 3, 'js.basics.statement'),
  assessmentItem(ASSESS.statementL4, 4, 'js.basics.statement'),
  assessmentItem(ASSESS.commentL2, 2, 'js.basics.comment'),
  assessmentItem(ASSESS.commentL3, 3, 'js.basics.comment', 'true_false'),
];

// ── Project: one milestone web_task (usage `project`), served only on the project screen ──

export const PROJECT = 'js-basics.start.mini-project';
export const PROJECT_EXERCISE = `${PROJECT}.build`;
/** Check ids of the project's three milestones, in order. */
export const PROJECT_CHECKS = ['p-title', 'p-list', 'p-note'] as const;

/** The project's preparation practice (answer `b` is correct), served only in its own set. */
export const PROJECT_PREP = `${PROJECT}.mcq-prep`;

export const PROJECT_EXERCISES: FixtureExercise[] = [
  {
    id: PROJECT_PREP,
    type: 'mcq_single',
    difficulty: 2,
    lessonId: PROJECT,
    spec: choice,
    concepts: [{ id: 'js.basics.statement', weight: 1 }],
  },
  {
    id: PROJECT_EXERCISE,
    type: 'web_task',
    difficulty: 4,
    usage: 'project',
    lessonId: PROJECT,
    spec: {
      focus: 'project',
      starter: { files: [{ path: 'index.html', content: '<main></main>' }] },
      solution: {
        files: [
          {
            path: 'index.html',
            content: '<main><h1>목록</h1><ul></ul><p>끝</p><!-- SOLUTION-MARK --></main>',
          },
        ],
      },
      checks: [
        { kind: 'dom', id: 'p-title', visible: true, selector: 'h1', expect: { exists: true } },
        { kind: 'dom', id: 'p-list', visible: true, selector: 'ul', expect: { exists: true } },
        { kind: 'dom', id: 'p-note', visible: true, selector: 'p', expect: { exists: true } },
      ],
      milestones: [
        { id: 'm1', title: '제목 만들기', checks: ['p-title'] },
        { id: 'm2', title: '목록 만들기', checks: ['p-list'] },
        { id: 'm3', title: '안내 문장 넣기', checks: ['p-note'] },
      ],
    },
    concepts: [
      { id: 'js.basics.statement', weight: 1 },
      { id: 'js.basics.comment', weight: 0.5 },
    ],
  },
];

// ── Parametric template (D-056): a unit whose only practice is one template ──

export const TPL_LESSON = 'js-basics.start.arithmetic';
export const TPL_CONCEPT = 'js.basics.arithmetic';
export const TPL = `${TPL_LESSON}.t.sum`;
/** Answer-key marker of the fixture template's misconception map (never in a response). */
export const TPL_MARKER = 'TPL-MARK';

export const TEMPLATE_SOURCE = {
  id: TPL,
  type: 'predict_output',
  params: {
    a: { kind: 'int', min: 1, max: 9 },
    b: { kind: 'int', min: 2, max: 9 },
    c: { kind: 'int', min: 2, max: 5 },
  },
  constraints: [],
  render: { prompt: '무엇이 출력되나요?' },
  spec: {
    lang: 'js',
    code: 'console.log({{a}} + {{b}} * {{c}});\n',
    answerKind: 'console',
    misconceptionByAnswer: { '{{(a + b) * c}}': 'js.mc.log-is-return' },
  },
  hints: [
    '`*`가 먼저예요.',
    '`{{b}} * {{c}}`부터 계산해요.',
    `그다음 {{a}}를 더해요. ${TPL_MARKER}`,
  ],
  explanation: '`{{b}} * {{c}}`를 먼저 계산해요.',
  variantPolicy: { minDistinctFromRecent: 3 },
};

/** The fixture template's answer for a variant (what `check --run` would have recorded). */
export function templateAnswer(variantId: string): string {
  const { a, b, c } = instantiateVariant(TEMPLATE_SOURCE, variantId).params as Record<
    string,
    number
  >;
  return String((a ?? 0) + (b ?? 0) * (c ?? 0));
}

/**
 * Adds the template unit to a fixture content.db: a lesson introducing `TPL_CONCEPT` with no bank
 * exercises and the template `TPL` whose verified pool is its first `poolSize` sample seeds.
 * Returns the pool's variant IDs in sample order.
 */
export function addTemplateFixture(path: string, poolSize = 6): string[] {
  const db = new Database(path);
  const ins = (table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row);
    db.prepare(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`,
    ).run(row);
  };
  ins('lessons', {
    id: TPL_LESSON,
    module_id: 'js-basics.start',
    title: '산술',
    summary: '요약',
    order_index: 4,
    estimated_minutes: 20,
    read_minutes: 5,
    objectives_json: '["계산한다"]',
    body_compiled: '[]',
    body_text: '',
    sections_json: JSON.stringify({ v: 1, sections: [] }),
    content_hash: 'h-tpl',
  });
  ins('concepts', {
    id: TPL_CONCEPT,
    course_id: 'js-basics',
    title: '산술 연산',
    summary: 's',
    importance: 'core',
    introduced_in_lesson_id: TPL_LESSON,
  });
  ins('lesson_concepts', { lesson_id: TPL_LESSON, concept_id: TPL_CONCEPT, role: 'introduces' });
  ins('exercise_templates', {
    id: TPL,
    type: 'predict_output',
    difficulty: 2,
    lesson_id: TPL_LESSON,
    usage: 'practice',
    variant_group: null,
    primary_concept_id: TPL_CONCEPT,
    concepts_json: JSON.stringify([{ conceptId: TPL_CONCEPT, weight: 1, isPrimary: true }]),
    template_json: JSON.stringify(TEMPLATE_SOURCE),
    misconception_ids_json: '["js.mc.log-is-return"]',
    tags_json: '[]',
    estimated_seconds: 60,
    variant_count_hint: 320,
    min_distinct_from_recent: 3,
    review_status: 'trusted',
    template_hash: 'tpl-hash',
  });
  const ids: string[] = [];
  sampleSeeds(TPL, poolSize).forEach((seed, i) => {
    const variantId = instantiateTemplate(TEMPLATE_SOURCE, seed).variantId;
    const expected = { kind: 'console', lines: [templateAnswer(variantId)] };
    ins('template_variants', {
      variant_id: variantId,
      template_id: TPL,
      seed: variantId.split('@')[1],
      sample_index: i,
      expected_json: JSON.stringify(expected),
      answer_key: JSON.stringify(expected),
      content_hash: `hash-${variantId}`,
    });
    ids.push(variantId);
  });
  db.close();
  return ids;
}
