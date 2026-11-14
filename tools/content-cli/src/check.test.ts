import { describe, expect, it } from 'vitest';
import { checkContent } from './check.ts';
import { EXERCISE_YAML, LESSON_MDX, LESSON_YAML, lessonMdx, writeContent } from './test/fixture.ts';

type Files = Record<string, unknown>;
const messages = (patch: (f: Files) => void) =>
  checkContent(writeContent(patch))
    .diagnostics.items.map((d) => `${d.level} ${d.file} ${d.message}`)
    .join('\n');
const obj = (files: Files, key: string) => files[key] as Record<string, unknown>;
const first = (files: Files, key: string) => {
  const item = (files[key] as Record<string, unknown>[])[0];
  if (!item) throw new Error(`empty ${key}`);
  return item;
};

describe('checkContent', () => {
  it('passes a valid content tree', () => {
    const { diagnostics, lessons } = checkContent(writeContent());
    expect(diagnostics.items).toEqual([]);
    expect(lessons.get('js-basics.start.first-program')?.sections).toHaveLength(12);
  });

  it.each<[string, (f: Files) => void, string]>([
    [
      'unknown prerequisite',
      (f) => {
        first(f, 'concepts/js.yaml')['prerequisites'] = ['js.nope.x'];
      },
      '없는 선수 개념',
    ],
    [
      'prerequisite cycle',
      (f) => {
        first(f, 'concepts/js.yaml')['prerequisites'] = ['js.basics.console-log'];
      },
      '순환',
    ],
    [
      'lesson id mismatch',
      (f) => {
        obj(f, LESSON_YAML)['id'] = 'js-basics.start.other';
      },
      'id는 "js-basics.start.first-program"',
    ],
    [
      'lesson not listed',
      (f) => {
        obj(f, 'courses/js-basics/modules/01-start/module.yaml')['lessons'] = ['missing'];
      },
      '목록에 없는 단원',
    ],
    [
      'exercise prefix',
      (f) => {
        obj(f, EXERCISE_YAML)['id'] = 'js-basics.start.other.mcq-x';
      },
      '단원 ID',
    ],
    [
      'raw html in prompt',
      (f) => {
        obj(f, EXERCISE_YAML)['prompt'] = '<b>굵게</b>';
      },
      '원시 HTML',
    ],
    [
      'unknown concept in exercise',
      (f) => {
        obj(f, EXERCISE_YAML)['concepts'] = [{ id: 'js.x.y', weight: 1 }];
      },
      '없는 개념입니다: js.x.y',
    ],
    [
      'inline exercise from elsewhere',
      (f) => {
        f[LESSON_MDX] = lessonMdx({ check: '<InlineExercise ref="a.b.c.d" />' });
      },
      '이 단원에 없는 문제',
    ],
    [
      'missing pitfall coverage',
      (f) => {
        f[LESSON_MDX] = lessonMdx();
      },
      'warning',
    ],
    [
      'concept never introduced',
      (f) => {
        obj(f, LESSON_YAML)['concepts'] = { primary: ['js.basics.console-log'] };
      },
      '소개(primary)하지 않습니다',
    ],
    [
      'misconception concept mismatch',
      (f) => {
        first(f, 'misconceptions/js.yaml')['concept'] = 'js.basics.statement';
      },
      '에 속합니다',
    ],
    [
      'target count',
      (f) => {
        obj(f, LESSON_YAML)['practice'] = { targetCount: 5 };
      },
      '목표 5개',
    ],
    [
      'type outside the CSS allowlist',
      (f) => {
        obj(f, 'courses/js-basics/course.yaml')['language'] = 'css';
        obj(f, EXERCISE_YAML)['type'] = 'predict_output';
      },
      'CSS 과정에서는 mcq_single, fill_blank, web_task 유형만',
    ],
    [
      'yaml syntax',
      (f) => {
        f['pack.yaml'] = 'id: [oops';
      },
      'YAML을 해석할 수 없습니다',
    ],
  ])('reports %s', (_, patch, expected) => {
    expect(messages(patch)).toContain(expected);
  });

  it('runs the type-specific spec validator', () => {
    const { diagnostics } = checkContent(writeContent(), {
      validateSpec: (type) =>
        type === 'mcq_single' ? { ok: false, errors: ['options: 2개 이상'] } : { ok: true },
    });
    expect(diagnostics.items.map((d) => d.message)).toContain('spec: options: 2개 이상');
  });
});
