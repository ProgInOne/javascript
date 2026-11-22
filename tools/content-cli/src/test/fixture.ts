import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { SECTION_KINDS } from '../mdx.ts';

export const LESSON = 'js-basics.start.first-program';
export const EXERCISE = `${LESSON}.mcq-what-is-console`;
/** The lesson's own "이해도 확인" item (`usage: check`, D-091). */
export const CHECK = `${LESSON}.check-log-prints`;
/** The lesson's "직접 써 보기" task (`usage: try`, D-091). */
export const TRY = `${LESSON}.try-say-hello`;

/** The fixture lesson's own body blocks (D-091): a TryIt after the walkthrough and a check. */
export const FIXTURE_BLOCKS = {
  walkthrough: `walkthrough.\n\n<TryIt ref="${TRY}" />`,
  check: `<InlineExercise ref="${CHECK}" />`,
};

export function lessonMdx(extra: Partial<Record<string, string>> = {}): string {
  return SECTION_KINDS.map((k) => `<Section kind="${k}">\n${extra[k] ?? `${k}.`}\n</Section>`).join(
    '\n\n',
  );
}

/** A minimal valid content tree; `patch` edits the file map before writing. */
export function writeContent(
  patch: (files: Record<string, unknown>) => void = () => undefined,
): string {
  const files: Record<string, unknown> = {
    'pack.yaml': {
      id: 'test-pack',
      version: '2026.11.14.1',
      schemaVersion: 1,
      title: '테스트',
      tracks: [{ id: 'web', title: '웹', summary: '웹 기초', courses: ['js-basics'] }],
    },
    'concepts/js.yaml': [
      { id: 'js.basics.statement', title: '문장', importance: 'minor', summary: '실행 단위' },
      {
        id: 'js.basics.console-log',
        title: 'console.log',
        importance: 'core',
        summary: '콘솔에 출력',
        prerequisites: ['js.basics.statement'],
        misconceptions: ['js.mc.log-is-return'],
      },
    ],
    'misconceptions/js.yaml': [
      {
        id: 'js.mc.log-is-return',
        concept: 'js.basics.console-log',
        title: '출력을 반환으로 착각',
        statement: '출력하면 반환된다고 생각한다.',
        reality: '출력만 한다.',
        remediation: { exercises: [EXERCISE] },
      },
    ],
    'courses/js-basics/course.yaml': {
      id: 'js-basics',
      title: 'JavaScript 기초',
      summary: 'JS 기초',
      language: 'javascript',
      level: 'basic',
      objectives: ['프로그램을 쓴다'],
      modules: ['start'],
    },
    'courses/js-basics/modules/01-start/module.yaml': {
      id: 'js-basics.start',
      title: '시작하기',
      summary: '첫 프로그램',
      lessons: ['first-program'],
    },
    'courses/js-basics/modules/01-start/lessons/01-first-program/lesson.yaml': {
      id: LESSON,
      title: '첫 프로그램',
      summary: '콘솔에 출력합니다',
      importance: 'core',
      estimatedMinutes: { read: 10, practice: 15 },
      concepts: { primary: ['js.basics.statement', 'js.basics.console-log'] },
      objectives: ['console.log로 출력할 수 있다'],
      practice: { targetCount: 1 },
    },
    'courses/js-basics/modules/01-start/lessons/01-first-program/lesson.mdx': lessonMdx({
      pitfalls:
        '<Pitfall misconception="js.mc.log-is-return">\n<Wrong>a</Wrong>\n<Actual>b</Actual>\n<Right>c</Right>\n</Pitfall>',
      ...FIXTURE_BLOCKS,
    }),
    'courses/js-basics/modules/01-start/lessons/01-first-program/exercises/001-mcq.yaml': {
      id: EXERCISE,
      type: 'mcq_single',
      difficulty: 1,
      concepts: [{ id: 'js.basics.console-log', weight: 1 }],
      estimatedSeconds: 40,
      prompt: '`console.log`는 무엇을 하나요?',
      spec: { options: [] },
      hints: ['a', 'b', 'c'],
      explanation: '출력합니다.',
      review: { status: 'approved', draftedBy: 'ai:claude', reviewedBy: 'ai:reviewer' },
    },
    'courses/js-basics/modules/01-start/lessons/01-first-program/exercises/check-01-log.yaml': {
      id: CHECK,
      type: 'true_false',
      usage: 'check',
      difficulty: 1,
      concepts: [{ id: 'js.basics.console-log', weight: 1 }],
      estimatedSeconds: 30,
      prompt: '`console.log`는 값을 콘솔에 출력해요.',
      spec: { statement: '`console.log`는 값을 콘솔에 출력해요.', answer: true },
      hints: ['a', 'b', 'c'],
      explanation: '맞아요.',
      review: { status: 'approved', draftedBy: 'ai:claude', reviewedBy: 'ai:reviewer' },
    },
    'courses/js-basics/modules/01-start/lessons/01-first-program/exercises/try-01-hello.yaml': {
      id: TRY,
      type: 'implement_function',
      usage: 'try',
      difficulty: 1,
      concepts: [{ id: 'js.basics.console-log', weight: 1 }],
      estimatedSeconds: 180,
      prompt: '인사말을 출력해 보세요.',
      spec: {
        starter: { files: [{ path: 'main.js', content: '// 여기에 쓰세요.\n' }] },
        solution: { files: [{ path: 'main.js', content: 'console.log("안녕");\n' }] },
        checks: [
          {
            kind: 'console',
            id: 'output',
            description: '콘솔에 "안녕"이 출력되어야 합니다.',
            requirement: '인사 출력',
            expect: { lines: ['안녕'] },
          },
        ],
      },
      hints: ['a', 'b', 'c'],
      explanation: '출력합니다.',
      review: { status: 'approved', draftedBy: 'ai:claude', reviewedBy: 'ai:reviewer' },
    },
  };
  patch(files);
  const root = mkdtempSync(join(tmpdir(), 'proginone-content-'));
  for (const [path, value] of Object.entries(files)) {
    if (value === undefined) continue;
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof value === 'string' ? value : stringify(value));
  }
  return root;
}

export const LESSON_YAML =
  'courses/js-basics/modules/01-start/lessons/01-first-program/lesson.yaml';
export const LESSON_MDX = 'courses/js-basics/modules/01-start/lessons/01-first-program/lesson.mdx';
export const EXERCISE_YAML =
  'courses/js-basics/modules/01-start/lessons/01-first-program/exercises/001-mcq.yaml';
export const CHECK_YAML =
  'courses/js-basics/modules/01-start/lessons/01-first-program/exercises/check-01-log.yaml';
export const TRY_YAML =
  'courses/js-basics/modules/01-start/lessons/01-first-program/exercises/try-01-hello.yaml';

export const REVIEW = 'js-basics.start.start-review';
export const REVIEW_YAML = 'courses/js-basics/modules/01-start/lessons/02-start-review/lesson.yaml';
export const REVIEW_EXERCISE_YAML =
  'courses/js-basics/modules/01-start/lessons/02-start-review/exercises/001-mcq.yaml';
export const MODULE_YAML = 'courses/js-basics/modules/01-start/module.yaml';

/** Adds a declared unit assessment (`kind: assessment`) with one item to the fixture module. */
export function withAssessment(files: Record<string, unknown>): void {
  const mod = files[MODULE_YAML] as Record<string, unknown>;
  mod['lessons'] = ['first-program', 'start-review'];
  mod['assessment'] = 'start-review';
  files[REVIEW_YAML] = {
    id: REVIEW,
    title: '시작하기 단원 평가',
    summary: '모듈 1을 확인합니다',
    kind: 'assessment',
    estimatedMinutes: { read: 1, practice: 10 },
    concepts: { reviewed: ['js.basics.console-log'] },
    objectives: ['출력을 설명할 수 있다'],
    assessment: { passRatio: 0.7 },
  };
  files['courses/js-basics/modules/01-start/lessons/02-start-review/lesson.mdx'] = [
    'objectives',
    'practice',
    'summary',
    'next',
  ]
    .map((k) => `<Section kind="${k}">\n${k}.\n</Section>`)
    .join('\n\n');
  files[REVIEW_EXERCISE_YAML] = {
    id: `${REVIEW}.mcq-log`,
    type: 'mcq_single',
    difficulty: 3,
    concepts: [{ id: 'js.basics.console-log', weight: 1 }],
    estimatedSeconds: 40,
    usage: 'assessment',
    prompt: '`console.log("a")`는 무엇을 하나요?',
    spec: { options: [] },
    hints: ['a', 'b', 'c'],
    explanation: '출력합니다.',
    review: { status: 'approved', draftedBy: 'ai:claude', reviewedBy: 'ai:reviewer' },
  };
}

export const PROJECT = 'js-basics.start.mini-project';
export const PROJECT_YAML =
  'courses/js-basics/modules/01-start/lessons/02-mini-project/lesson.yaml';
export const PROJECT_EXERCISE_YAML =
  'courses/js-basics/modules/01-start/lessons/02-mini-project/exercises/001-project.yaml';

/** Adds a `kind: project` unit with one milestone `web_task` to the fixture module. */
export function withProject(files: Record<string, unknown>): void {
  const mod = files[MODULE_YAML] as Record<string, unknown>;
  mod['lessons'] = ['first-program', 'mini-project'];
  files[PROJECT_YAML] = {
    id: PROJECT,
    title: '미니 프로젝트',
    summary: '배운 내용으로 화면을 만듭니다',
    kind: 'project',
    estimatedMinutes: { read: 3, practice: 40 },
    concepts: { practiced: ['js.basics.console-log'], reviewed: ['js.basics.statement'] },
    objectives: ['출력을 조합해 화면을 만들 수 있다'],
  };
  files['courses/js-basics/modules/01-start/lessons/02-mini-project/lesson.mdx'] = [
    'objectives',
    'practice',
    'summary',
    'next',
  ]
    .map((k) => `<Section kind="${k}">\n${k}.\n</Section>`)
    .join('\n\n');
  const check = (id: string, selector: string) => ({
    kind: 'dom',
    id,
    selector,
    expect: { exists: true },
  });
  files[PROJECT_EXERCISE_YAML] = {
    id: `${PROJECT}.build`,
    type: 'web_task',
    difficulty: 4,
    concepts: [
      { id: 'js.basics.console-log', weight: 1 },
      { id: 'js.basics.statement', weight: 0.5 },
    ],
    estimatedSeconds: 2400,
    usage: 'project',
    prompt: '목록 화면을 단계별로 만드세요.',
    spec: {
      focus: 'project',
      starter: { files: [{ path: 'index.html', content: '<main></main>' }] },
      solution: {
        files: [{ path: 'index.html', content: '<main><h1></h1><ul></ul><p></p></main>' }],
      },
      checks: [check('has-title', 'h1'), check('has-list', 'ul'), check('has-note', 'p')],
      milestones: [
        { id: 'm1', title: '제목 만들기', checks: ['has-title'] },
        { id: 'm2', title: '목록 만들기', checks: ['has-list'] },
        { id: 'm3', title: '안내 문장 넣기', checks: ['has-note'] },
      ],
    },
    hints: ['a', 'b', 'c'],
    explanation: '단계별로 요소를 더합니다.',
    review: { status: 'approved', draftedBy: 'ai:claude', reviewedBy: 'ai:reviewer' },
  };
}
