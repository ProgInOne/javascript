import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { SECTION_KINDS } from '../mdx.ts';

export const LESSON = 'js-basics.start.first-program';
export const EXERCISE = `${LESSON}.mcq-what-is-console`;

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
      check: `<InlineExercise ref="${EXERCISE}" />`,
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
