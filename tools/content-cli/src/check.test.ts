import { describe, expect, it } from 'vitest';
import { checkContent } from './check.ts';
import {
  EXERCISE_YAML,
  LESSON_MDX,
  LESSON_YAML,
  lessonMdx,
  MODULE_YAML,
  PROJECT,
  PROJECT_EXERCISE_YAML,
  PROJECT_YAML,
  REVIEW_EXERCISE_YAML,
  REVIEW_YAML,
  withAssessment,
  withProject,
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

describe('checkContent: diagrams', () => {
  const withDiagram = (source: string) => (f: Files) => {
    f[LESSON_MDX] = lessonMdx({
      principle: `원리 본문\n\n<Diagram alt="흐름">\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n</Diagram>`,
    });
  };

  it('accepts a Mermaid diagram that parses', () => {
    const out = messages(withDiagram('flowchart TD\n  A[시작] --> B{조건}\n  B -->|예| C[끝]'));
    expect(out).not.toMatch(/^error/m);
    expect(out).not.toContain('Diagram');
  });

  it('reports a Mermaid syntax error with the line', () => {
    expect(messages(withDiagram('flowchart TD\n  A -->'))).toMatch(
      /error .*lesson\.mdx \d+행: <Diagram> Mermaid 구문 오류: Parse error/,
    );
  });

  it('reports an unknown diagram type', () => {
    expect(messages(withDiagram('graphh TD\n  A --> B'))).toContain('<Diagram> Mermaid 구문 오류');
  });

  it('rejects configuration directives and interactions', () => {
    const out = messages(
      withDiagram(
        '%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\n  A --> B\n  click A "https://example.com"',
      ),
    );
    expect(out).toContain('지시문은 쓸 수 없습니다');
    expect(out).toContain('click·link 상호작용은 쓸 수 없습니다');
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
      'warning 단원 평가 한 번에 내는 문항은 10~20개를 권장합니다(지금 1개)',
    ]);
  });

  /** `n` assessment items in the unit (copies of the fixture item). */
  const withPool = (f: Files, n: number) => {
    const item = obj(f, REVIEW_EXERCISE_YAML);
    for (let i = 1; i < n; i++) {
      f[REVIEW_EXERCISE_YAML.replace(/\.yaml$/, `-${String(i)}.yaml`)] = {
        ...item,
        id: `${String(item['id'])}-${String(i)}`,
      };
    }
  };
  const countAdvice = (patch: (f: Files) => void) =>
    checkContent(
      writeContent((f) => {
        withAssessment(f);
        patch(f);
      }),
    )
      .diagnostics.items.map((d) => d.message)
      .filter((m) => m.startsWith('단원 평가 한 번에 내는 문항'));

  it.each<[string, number, number | undefined, string[]]>([
    ['a pool in range without itemCount', 12, undefined, []],
    [
      'a pool larger than one sitting, itemCount in range',
      25,
      15,
      [], // retakes draw other items from the pool
    ],
    [
      'a large pool with a small itemCount',
      12,
      5,
      ['단원 평가 한 번에 내는 문항은 10~20개를 권장합니다(지금 5개)'],
    ],
    [
      'a small pool without itemCount',
      4,
      undefined,
      ['단원 평가 한 번에 내는 문항은 10~20개를 권장합니다(지금 4개)'],
    ],
    ['a pool over 20 without itemCount (the engine asks 20)', 24, undefined, []],
  ])('advises on the items asked per sitting: %s', (_, pool, itemCount, expected) => {
    expect(
      countAdvice((f) => {
        withPool(f, pool);
        if (itemCount !== undefined) obj(f, REVIEW_YAML)['assessment'] = { itemCount };
      }),
    ).toEqual(expected);
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

describe('checkContent: project units', () => {
  const errorsOf = (patch: (f: Files) => void) =>
    checkContent(
      writeContent((f) => {
        withProject(f);
        patch(f);
      }),
    )
      .diagnostics.items.filter((d) => d.level === 'error')
      .map((d) => d.message)
      .join('\n');
  const spec = (f: Files) => obj(obj(f, PROJECT_EXERCISE_YAML), 'spec');
  const PREP_YAML = PROJECT_EXERCISE_YAML.replace('001-project', '002-prep');
  const prep = () => ({
    id: `${PROJECT}.mcq-prep`,
    type: 'mcq_single',
    difficulty: 2,
    concepts: [{ id: 'js.basics.console-log', weight: 1 }],
    estimatedSeconds: 40,
    prompt: '무엇을 출력하나요?',
    spec: { options: [] },
    hints: ['a', 'b', 'c'],
    explanation: '출력합니다.',
    review: { status: 'approved', draftedBy: 'ai:claude', reviewedBy: 'ai:reviewer' },
  });

  it('accepts a project unit with one milestone web_task and preparation practice', () => {
    const { diagnostics } = checkContent(
      writeContent((f) => {
        withProject(f);
        f[PREP_YAML] = prep();
      }),
    );
    expect(diagnostics.items).toEqual([]);
  });

  it('takes the only milestone web_task as the project exercise when it is not marked', () => {
    const { diagnostics } = checkContent(
      writeContent((f) => {
        withProject(f);
        delete obj(f, PROJECT_EXERCISE_YAML)['usage'];
        f[PREP_YAML] = prep();
      }),
    );
    expect(diagnostics.items.map((d) => `${d.level} ${d.message}`)).toEqual([
      `warning 마일스톤 웹 실습 ${PROJECT}.build을(를) 프로젝트 문제로 씁니다. usage: project로 표시하세요`,
    ]);
  });

  it.each<[string, (f: Files) => void, string]>([
    [
      'introduced concepts',
      (f) => {
        obj(f, PROJECT_YAML)['concepts'] = { primary: ['js.basics.statement'] };
        obj(f, LESSON_YAML)['concepts'] = { primary: ['js.basics.console-log'] };
      },
      '프로젝트는 새 개념을 소개하지 않습니다',
    ],
    [
      'no applied concepts',
      (f) => {
        obj(f, PROJECT_YAML)['concepts'] = {};
      },
      '적용할 개념(concepts.practiced 또는 reviewed)',
    ],
    [
      'a pass rule',
      (f) => {
        obj(f, PROJECT_YAML)['practice'] = { targetCount: 1, passRule: { minCorrect: 0.5 } };
      },
      'practice.passRule을 쓰지 않습니다',
    ],
    [
      'two project exercises',
      (f) => {
        f[PREP_YAML] = { ...obj(f, PROJECT_EXERCISE_YAML), id: `${PROJECT}.build-2` };
      },
      'usage: project 문제는 하나만',
    ],
    [
      'two unmarked milestone web_tasks',
      (f) => {
        obj(f, PROJECT_EXERCISE_YAML)['usage'] = 'practice';
        f[PREP_YAML] = { ...obj(f, PROJECT_EXERCISE_YAML), id: `${PROJECT}.build-2` };
      },
      '프로젝트 문제가 없습니다',
    ],
    [
      'a preparation item of another usage',
      (f) => {
        f[PREP_YAML] = { ...prep(), usage: 'remedial' };
      },
      '준비 연습 문제는 usage: practice여야 합니다',
    ],
    [
      'a preparation item outside the applied concepts',
      (f) => {
        obj(f, PROJECT_YAML)['concepts'] = { practiced: ['js.basics.console-log'] };
        obj(f, PROJECT_EXERCISE_YAML)['concepts'] = [{ id: 'js.basics.console-log', weight: 1 }];
        f[PREP_YAML] = { ...prep(), concepts: [{ id: 'js.basics.statement', weight: 1 }] };
      },
      '주 개념 js.basics.statement이(가) 이 프로젝트의 concepts.practiced·reviewed에 없습니다',
    ],
    [
      'another type',
      (f) => {
        obj(f, PROJECT_EXERCISE_YAML)['type'] = 'implement_function';
      },
      '프로젝트 문제는 web_task여야 합니다',
    ],
    [
      'no milestones',
      (f) => {
        delete spec(f)['milestones'];
      },
      'spec.milestones(마일스톤)가 있어야 합니다',
    ],
    [
      'a concept outside the unit',
      (f) => {
        obj(f, PROJECT_YAML)['concepts'] = { practiced: ['js.basics.console-log'] };
      },
      '개념 js.basics.statement이(가) 이 프로젝트의 concepts.practiced·reviewed에 없습니다',
    ],
    [
      'a project item in a regular lesson',
      (f) => {
        obj(f, EXERCISE_YAML)['usage'] = 'project';
      },
      '프로젝트(kind: project) 단원에만',
    ],
    [
      'two projects in a module',
      (f) => {
        obj(f, LESSON_YAML)['kind'] = 'project';
      },
      '프로젝트 단원은 모듈에 하나만',
    ],
  ])('reports %s', (_, patch, expected) => {
    expect(errorsOf(patch)).toContain(expected);
  });

  it('warns about the milestone count, the focus and checks outside milestones', () => {
    const warnings = checkContent(
      writeContent((f) => {
        withProject(f);
        const s = spec(f);
        s['focus'] = 'html';
        s['milestones'] = [{ id: 'm1', title: '제목', checks: ['has-title'] }];
      }),
    )
      .diagnostics.items.filter((d) => d.level === 'warning')
      .map((d) => d.message);
    expect(warnings).toEqual([
      '마일스톤은 3~10개를 권장합니다(지금 1개)',
      'spec.focus는 project를 권장합니다(프로젝트 화면의 체크 기본값)',
      '마일스톤에 속하지 않은 체크가 있습니다: has-list, has-note (완료 조건에는 들어가지만 진행 표시에 보이지 않습니다)',
    ]);
  });
});
