import { describe, expect, it } from 'vitest';
import { checkContent } from './check.ts';
import {
  EXERCISE_YAML,
  LESSON_MDX,
  LESSON_YAML,
  lessonMdx,
  MODULE_YAML,
  REVIEW_EXERCISE_YAML,
  REVIEW_YAML,
  withAssessment,
  writeContent,
} from './test/fixture.ts';

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

  it('reports misconception IDs in a spec that are not in the catalog', () => {
    const { diagnostics } = checkContent(writeContent(), {
      validateSpec: () => ({ ok: true, misconceptions: ['js.mc.log-is-return', 'js.mc.nope'] }),
    });
    const errors = diagnostics.items.filter((d) => d.level === 'error').map((d) => d.message);
    expect(errors).toEqual(['spec: 없는 오개념입니다: js.mc.nope']);
  });
});

describe('checkContent: unit assessments', () => {
  const errorsOf = (patch: (f: Files) => void) =>
    checkContent(
      writeContent((f) => {
        withAssessment(f);
        patch(f);
      }),
    ).diagnostics.items.filter((d) => d.level === 'error');

  it('accepts a declared assessment unit (only the item-count advice)', () => {
    const { diagnostics } = checkContent(writeContent(withAssessment));
    expect(diagnostics.items.map((d) => `${d.level} ${d.message}`)).toEqual([
      'warning 단원 평가 문항은 10~20개를 권장합니다(지금 1개)',
    ]);
  });

  it.each<[string, (f: Files) => void, string]>([
    [
      'introduced concepts',
      (f) => {
        obj(f, REVIEW_YAML)['concepts'] = {
          primary: ['js.basics.statement'],
          reviewed: ['js.basics.console-log'],
        };
        obj(f, LESSON_YAML)['concepts'] = { primary: ['js.basics.console-log'] };
      },
      '새 개념을 소개하지 않습니다',
    ],
    [
      'no assessed concepts',
      (f) => {
        obj(f, REVIEW_YAML)['concepts'] = {};
        obj(f, REVIEW_EXERCISE_YAML)['concepts'] = [{ id: 'js.basics.console-log', weight: 0.5 }];
      },
      '평가할 개념(concepts.reviewed)',
    ],
    [
      'a pass rule',
      (f) => {
        obj(f, REVIEW_YAML)['practice'] = { targetCount: 1, passRule: { minCorrect: 0.5 } };
      },
      'assessment.passRatio',
    ],
    [
      'a practice item in the unit',
      (f) => {
        obj(f, REVIEW_EXERCISE_YAML)['usage'] = 'practice';
      },
      'usage: assessment여야 합니다',
    ],
    [
      'an item outside the assessed concepts',
      (f) => {
        obj(f, REVIEW_EXERCISE_YAML)['concepts'] = [{ id: 'js.basics.statement', weight: 1 }];
      },
      'concepts.reviewed에 없습니다',
    ],
    [
      'an assessment item in a regular lesson',
      (f) => {
        obj(f, EXERCISE_YAML)['usage'] = 'assessment';
      },
      '단원 평가(kind: assessment) 단원에만',
    ],
    [
      'assessment settings on a regular lesson',
      (f) => {
        obj(f, LESSON_YAML)['assessment'] = { itemCount: 5 };
      },
      'kind: assessment 단원에만',
    ],
    [
      'a module assessment that is not an assessment unit',
      (f) => {
        obj(f, MODULE_YAML)['assessment'] = 'first-program';
      },
      'kind: assessment 단원이 아닙니다',
    ],
    [
      'a module assessment outside the module',
      (f) => {
        obj(f, MODULE_YAML)['assessment'] = 'missing-review';
      },
      'lessons에 없는 단원',
    ],
  ])('reports %s', (_, patch, expected) => {
    expect(
      errorsOf(patch)
        .map((d) => d.message)
        .join('\n'),
    ).toContain(expected);
  });

  it('warns about an undeclared unit, uncovered concepts and an impossible item count', () => {
    const warnings = checkContent(
      writeContent((f) => {
        withAssessment(f);
        delete obj(f, MODULE_YAML)['assessment'];
        obj(f, REVIEW_YAML)['concepts'] = {
          reviewed: ['js.basics.console-log', 'js.basics.statement'],
        };
        obj(f, REVIEW_YAML)['assessment'] = { itemCount: 1 };
      }),
    )
      .diagnostics.items.filter((d) => d.level === 'warning')
      .map((d) => d.message);
    expect(warnings).toEqual(
      expect.arrayContaining([
        '평가 문항이 없는 개념입니다: js.basics.statement',
        'assessment.itemCount 1로는 평가할 개념 2개를 모두 다룰 수 없습니다',
        '단원 평가 단원을 assessment: start-review로 선언하세요(지금은 자동으로 연결합니다)',
      ]),
    );
  });
});
