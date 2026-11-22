import {
  exerciseSourceSchema,
  lessonSchema,
  moduleSchema,
  type ExerciseSource,
} from '@proginone/content-schema';
import { describe, expect, it } from 'vitest';
import { Diagnostics } from './diagnostics.ts';
import { jsConceptSchema, jsCourseSchema } from './schema.ts';
import type { ContentSource, LessonNodeSource } from './load.ts';
import {
  categoryOf,
  checkQuantities,
  findQuantityViolations,
  measureQuantities,
  QUANTITY_LEVELS,
} from './quantity.ts';
import { renderReport } from './report.ts';

type Mix = Partial<Record<string, number>>;

/** `n` approved exercises of `type` for `concept` in `lesson` (difficulty 2 unless given). */
function exercises(
  lesson: string,
  concept: string,
  mix: Mix,
  extra: Partial<ExerciseSource> = {},
): ExerciseSource[] {
  return Object.entries(mix).flatMap(([type, n = 0]) =>
    Array.from({ length: n }, (_, i) =>
      exerciseSourceSchema.parse({
        id: `${lesson}.${type.replaceAll('_', '-')}-${concept.split('.').at(-1)}-${extra.usage ?? 'p'}-${i}`,
        type,
        difficulty: extra.difficulty ?? 2,
        concepts: [{ id: concept, weight: 1 }],
        estimatedSeconds: 60,
        usage: extra.usage ?? 'practice',
        prompt: 'p',
        spec: {},
        hints: ['a', 'b', 'c'],
        explanation: 'e',
        review: extra.review ?? {
          status: 'approved',
          draftedBy: 'ai:x',
          reviewedBy: 'ai:reviewer',
        },
      }),
    ),
  );
}

interface LessonSpec {
  slug: string;
  kind?: 'lesson' | 'assessment' | 'project';
  importance?: 'core' | 'standard' | 'minor';
  primary?: string[];
  reviewed?: string[];
  /** Assessment units: `assessment.itemCount`. */
  itemCount?: number;
  exercises: ExerciseSource[];
}

function source(
  language: 'javascript' | 'html',
  concepts: { id: string; importance: 'core' | 'standard' | 'minor' }[],
  lessons: LessonSpec[],
): ContentSource {
  const course = language === 'javascript' ? 'js-basics' : 'html';
  const mod = `${course}.m`;
  const nodes: LessonNodeSource[] = lessons.map((l) => ({
    dir: `/c/${l.slug}`,
    localSlug: l.slug,
    meta: {
      file: `/c/${l.slug}/lesson.yaml`,
      data: lessonSchema.parse({
        id: `${mod}.${l.slug}`,
        title: 't',
        summary: 's',
        kind: l.kind ?? 'lesson',
        importance: l.importance ?? 'standard',
        estimatedMinutes: { read: 1, practice: 1 },
        concepts: { primary: l.primary ?? [], reviewed: l.reviewed ?? [] },
        objectives: ['o'],
        ...(l.itemCount !== undefined ? { assessment: { itemCount: l.itemCount } } : {}),
      }),
    },
    mdxFile: `/c/${l.slug}/lesson.mdx`,
    mdx: '',
    exercises: l.exercises.map((data) => ({ file: `/c/${data.id}.yaml`, data })),
    templates: [],
  }));
  return {
    root: '/c',
    pack: null,
    misconceptions: [],
    concepts: concepts.map((c) => ({
      file: '/c/concepts.yaml',
      data: jsConceptSchema.parse({ ...c, title: c.id, summary: 's' }),
    })),
    courses: [
      {
        dir: '/c',
        meta: {
          file: '/c/course.yaml',
          data: jsCourseSchema.parse({
            id: course,
            title: course,
            summary: 's',
            language,
            level: 'basic',
            depth: language === 'javascript' ? 'full' : 'core',
            objectives: ['o'],
            modules: ['m'],
          }),
        },
        modules: [
          {
            dir: '/c/m',
            localSlug: 'm',
            meta: {
              file: '/c/m/module.yaml',
              data: moduleSchema.parse({
                id: mod,
                title: 'm',
                summary: 's',
                lessons: lessons.map((l) => l.slug),
              }),
            },
            lessons: nodes,
          },
        ],
      },
    ],
  };
}

const L = 'js-basics.m.a';
/** 20 items in the exact JS target mix: 5 concept, 5 code, 4 debug, 4 implement, 2 apply. */
const balancedJs = (lesson = L, concept = 'js.x.a') =>
  [
    ...exercises(lesson, concept, { mcq_single: 3, true_false: 2, predict_output: 3, parsons: 2 }),
    ...exercises(lesson, concept, { fix_bug: 4, implement_function: 4 }),
    ...exercises(lesson, concept, { implement_function: 2 }, { difficulty: 4 }),
  ].map((ex, i) => ({ ...ex, id: `${ex.id}-${i}` }));

const rules = (s: ContentSource) => findQuantityViolations(s).map((v) => `${v.rule} ${v.unit}`);

describe('categoryOf', () => {
  it('maps types to the PRD categories and L4+ implementation/debugging to 응용', () => {
    expect(categoryOf({ type: 'mcq_multi', difficulty: 5 })).toBe('concept');
    expect(categoryOf({ type: 'find_bug_line', difficulty: 4 })).toBe('code');
    expect(categoryOf({ type: 'fix_bug', difficulty: 3 })).toBe('debug');
    expect(categoryOf({ type: 'fix_bug', difficulty: 4 })).toBe('apply');
    expect(categoryOf({ type: 'web_task', difficulty: 2 })).toBe('implement');
    expect(categoryOf({ type: 'web_task', difficulty: 5 })).toBe('apply');
    expect(categoryOf({ type: 'explain_code', difficulty: 2 })).toBeNull();
  });

  it('counts a web_task with a buggy starter page as 디버깅 (D-069)', () => {
    const web = (spec: Record<string, unknown>, difficulty = 3) => ({
      type: 'web_task',
      difficulty,
      spec,
    });
    expect(categoryOf(web({ focus: 'dom', debugging: true }))).toBe('debug');
    expect(categoryOf(web({ focus: 'dom', debugging: true }, 4))).toBe('apply');
    expect(categoryOf(web({ focus: 'dom', debugging: false }))).toBe('implement');
    expect(categoryOf(web({ focus: 'dom' }))).toBe('implement');
    // Only web_task: other types keep their category whatever the spec says.
    expect(
      categoryOf({ type: 'implement_function', difficulty: 2, spec: { debugging: true } }),
    ).toBe('implement');
  });
});

describe('quantity levels', () => {
  it('makes every JS shortfall an error and HTML/CSS rules warnings (D-056, D-069)', () => {
    expect(QUANTITY_LEVELS.js).toEqual({
      'unit-count': 'error',
      'unit-count-over': 'warning',
      'concept-min': 'error',
      'type-mix': 'error',
      'type-diversity': 'error',
      'assessment-coverage': 'error',
    });
    expect(new Set(Object.values(QUANTITY_LEVELS.markup))).toEqual(new Set(['warning']));
  });
});

describe('quantity rules', () => {
  it('accepts a JS unit in range with the target mix', () => {
    const s = source(
      'javascript',
      [{ id: 'js.x.a', importance: 'standard' }],
      [{ slug: 'a', primary: ['js.x.a'], exercises: balancedJs() }],
    );
    expect(rules(s)).toEqual([]);
    const [unit] = measureQuantities(s).units;
    expect(unit?.byCategory).toEqual({ concept: 5, code: 5, debug: 4, implement: 4, apply: 2 });
    expect(unit?.byDifficulty).toEqual([0, 18, 0, 2, 0]);
  });

  it('uses the core range for a core JS unit and the HTML/CSS range for markup', () => {
    const js = source(
      'javascript',
      [{ id: 'js.x.a', importance: 'standard' }],
      [{ slug: 'a', importance: 'core', primary: ['js.x.a'], exercises: balancedJs() }],
    );
    expect(rules(js)).toEqual([]); // 20 = core minimum
    const short = source(
      'javascript',
      [{ id: 'js.x.a', importance: 'standard' }],
      [{ slug: 'a', importance: 'core', primary: ['js.x.a'], exercises: balancedJs().slice(1) }],
    );
    expect(rules(short)).toContain(`unit-count ${L}`);
    const html = source(
      'html',
      [{ id: 'html.x.a', importance: 'core' }],
      [
        {
          slug: 'a',
          primary: ['html.x.a'],
          exercises: exercises('html.m.a', 'html.x.a', {
            mcq_single: 2,
            fill_blank: 2,
            web_task: 1,
          }),
        },
      ],
    );
    expect(findQuantityViolations(html)[0]?.message).toContain(
      '승인된 연습 문제 5개 / 기준 6~12개',
    );
  });

  it('reports more items than the range as unit-count-over (always a warning)', () => {
    const extra = exercises(L, 'js.x.a', { mcq_single: 1 }).map((e) => ({ ...e, id: `${e.id}-x` }));
    const s = source(
      'javascript',
      [{ id: 'js.x.a', importance: 'standard' }],
      [{ slug: 'a', primary: ['js.x.a'], exercises: [...balancedJs(), ...extra] }],
    );
    expect(rules(s)).toContain(`unit-count-over ${L}`);
    expect(QUANTITY_LEVELS.js['unit-count-over']).toBe('warning');
  });

  it('counts only approved practice items', () => {
    const drafts = exercises(
      L,
      'js.x.a',
      { mcq_single: 5 },
      {
        review: { status: 'draft', draftedBy: 'ai:x' },
      },
    ).map((e) => ({ ...e, id: `${e.id}-d` }));
    const s = source(
      'javascript',
      [{ id: 'js.x.a', importance: 'standard' }],
      [{ slug: 'a', primary: ['js.x.a'], exercises: [...balancedJs(), ...drafts] }],
    );
    const [unit] = measureQuantities(s).units;
    expect(unit).toMatchObject({ count: 20, drafts: 5 });
    expect(rules(s)).toEqual([]);
  });

  it('reports a category outside ±10%p with actual and target shares', () => {
    const s = source(
      'javascript',
      [{ id: 'js.x.a', importance: 'standard' }],
      [
        {
          slug: 'a',
          primary: ['js.x.a'],
          exercises: exercises(L, 'js.x.a', {
            mcq_single: 4,
            predict_output: 3,
            parsons: 2,
            fill_blank: 1,
          }),
        },
      ],
    );
    const mix = findQuantityViolations(s).find((v) => v.rule === 'type-mix');
    expect(mix?.message).toContain('디버깅 0개 0% (목표 20%)');
    expect(mix?.message).toContain('개념 확인 4개 40% (목표 25%)'); // 40% > 25% + 10%p
    expect(mix?.message).toContain('코드 이해 6개 60% (목표 25%)');
    expect(mix?.message).not.toContain('응용'); // 0% is within 10% ± 10%p
  });

  it('enforces type diversity for JS but not for HTML/CSS core courses (D-028)', () => {
    const mono = (lesson: string, concept: string) =>
      exercises(lesson, concept, { mcq_single: 6, web_task: 4 });
    const js = source(
      'javascript',
      [{ id: 'js.x.a', importance: 'standard' }],
      [{ slug: 'a', primary: ['js.x.a'], exercises: mono(L, 'js.x.a') }],
    );
    expect(findQuantityViolations(js).find((v) => v.rule === 'type-diversity')?.message).toBe(
      '[type-diversity] 유형 2종 (최소 4종), mcq_single 60% (최대 50%)',
    );
    const html = source(
      'html',
      [{ id: 'html.x.a', importance: 'core' }],
      [{ slug: 'a', primary: ['html.x.a'], exercises: mono('html.m.a', 'html.x.a') }],
    );
    expect(rules(html).filter((r) => r.startsWith('type-diversity'))).toEqual([]);
  });

  it('checks per-primary-concept minimums by importance, counting only primary tags', () => {
    const s = source(
      'javascript',
      [
        { id: 'js.x.a', importance: 'standard' },
        { id: 'js.x.core', importance: 'core' },
        { id: 'js.x.minor', importance: 'minor' },
      ],
      [
        {
          slug: 'a',
          primary: ['js.x.a', 'js.x.core', 'js.x.minor'],
          exercises: [
            ...balancedJs(),
            ...exercises(L, 'js.x.core', { mcq_single: 5 }),
            ...exercises(L, 'js.x.minor', { true_false: 3 }),
          ],
        },
      ],
    );
    const concept = findQuantityViolations(s).filter((v) => v.rule === 'concept-min');
    expect(concept.map((v) => v.message)).toEqual([
      '[concept-min] 주 개념 js.x.core(core) 문제 5개 / 최소 6개',
    ]);
  });

  it('uses the HTML/CSS concept minimum of 2', () => {
    const s = source(
      'html',
      [
        { id: 'html.x.a', importance: 'core' },
        { id: 'html.x.b', importance: 'core' },
      ],
      [
        {
          slug: 'a',
          primary: ['html.x.a', 'html.x.b'],
          exercises: [
            ...exercises('html.m.a', 'html.x.a', { mcq_single: 3, fill_blank: 2, web_task: 2 }),
            ...exercises('html.m.a', 'html.x.b', { web_task: 1 }),
          ],
        },
      ],
    );
    expect(
      findQuantityViolations(s)
        .filter((v) => v.rule === 'concept-min')
        .map((v) => v.message),
    ).toEqual(['[concept-min] 주 개념 html.x.b(core) 문제 1개 / 최소 2개']);
  });

  it('requires an approved assessment item for every concept the module introduces', () => {
    const s = source(
      'javascript',
      [
        { id: 'js.x.a', importance: 'standard' },
        { id: 'js.x.b', importance: 'standard' },
      ],
      [
        { slug: 'a', primary: ['js.x.a'], exercises: balancedJs() },
        {
          slug: 'b',
          primary: ['js.x.b'],
          exercises: balancedJs('js-basics.m.b', 'js.x.b'),
        },
        {
          slug: 'review',
          kind: 'assessment',
          reviewed: ['js.x.a', 'js.x.b'],
          exercises: exercises(
            'js-basics.m.review',
            'js.x.a',
            { mcq_single: 10 },
            { usage: 'assessment' },
          ),
        },
      ],
    );
    expect(findQuantityViolations(s).map((v) => v.message)).toEqual([
      '[assessment-coverage] 승인된 평가 문항이 없는 모듈 주 개념 1개: js.x.b',
    ]);
  });

  it('exempts project units and does not count assessment items toward concepts', () => {
    const s = source(
      'javascript',
      [{ id: 'js.x.a', importance: 'standard' }],
      [
        {
          slug: 'a',
          primary: ['js.x.a'],
          exercises: exercises(L, 'js.x.a', { mcq_single: 1 }),
        },
        {
          slug: 'p',
          kind: 'project',
          reviewed: ['js.x.a'],
          exercises: exercises('js-basics.m.p', 'js.x.a', { web_task: 1 }, { usage: 'project' }),
        },
      ],
    );
    const units = rules(s);
    expect(units.some((r) => r.endsWith('.p'))).toBe(false);
    expect(units).toContain(`concept-min ${L}`);
  });
});

describe('checkQuantities severity', () => {
  const shortJs = () =>
    source(
      'javascript',
      [{ id: 'js.x.a', importance: 'standard' }],
      [{ slug: 'a', primary: ['js.x.a'], exercises: balancedJs().slice(0, 9) }],
    );

  it('reports JS rules with their configured level and HTML/CSS as warnings', () => {
    const diag = new Diagnostics('/c');
    checkQuantities(shortJs(), diag);
    const unit = diag.items.find((d) => d.message.startsWith('[unit-count]'));
    expect(unit?.level).toBe('error');
    const mix = diag.items.find((d) => d.message.startsWith('[type-mix]'));
    expect(mix?.level).toBe(QUANTITY_LEVELS.js['type-mix']);

    const html = new Diagnostics('/c');
    checkQuantities(
      source(
        'html',
        [{ id: 'html.x.a', importance: 'core' }],
        [
          {
            slug: 'a',
            primary: ['html.x.a'],
            exercises: exercises('html.m.a', 'html.x.a', { mcq_single: 1 }),
          },
        ],
      ),
      html,
    );
    expect(html.errorCount).toBe(0);
    expect(html.warningCount).toBeGreaterThan(0);
  });

  it('honors level overrides', () => {
    const diag = new Diagnostics('/c');
    const allWarn = {
      js: { ...QUANTITY_LEVELS.js, 'unit-count': 'warning' as const },
      markup: QUANTITY_LEVELS.markup,
    };
    checkQuantities(shortJs(), diag, allWarn);
    expect(diag.items.find((d) => d.message.startsWith('[unit-count]'))?.level).toBe('warning');
  });
});

describe('renderReport', () => {
  it('prints a per-unit row and the violation list', () => {
    const s = source(
      'javascript',
      [{ id: 'js.x.a', importance: 'standard' }],
      [{ slug: 'a', primary: ['js.x.a'], exercises: balancedJs().slice(0, 9) }],
    );
    const text = renderReport(s);
    expect(text).toContain(L);
    expect(text).toContain('10~20');
    expect(text).toMatch(/기준 위반 \d+건/);
    const md = renderReport(s, 'markdown');
    expect(md).toContain(`| ${L} | 단원 | standard | 9 | 10~20 |`);
    expect(md).toContain('| unit-count | 오류 |');
  });

  it('judges an assessment by the items one sitting asks, not the pool size (D-070)', () => {
    const assessment = (itemCount: number | undefined, pool: number) =>
      renderReport(
        source(
          'javascript',
          [{ id: 'js.x.a', importance: 'standard' }],
          [
            { slug: 'a', primary: ['js.x.a'], exercises: balancedJs() },
            {
              slug: 'r',
              kind: 'assessment',
              reviewed: ['js.x.a'],
              ...(itemCount !== undefined ? { itemCount } : {}),
              exercises: exercises(
                'js-basics.m.r',
                'js.x.a',
                { mcq_single: pool },
                { usage: 'assessment' },
              ).map((ex, i) => ({ ...ex, id: `${ex.id}-${i}` })),
            },
          ],
        ),
        'markdown',
      );
    // A pool of 25 asking 18 per sitting is in range: retakes draw other items.
    expect(assessment(18, 25)).toContain('| js-basics.m.r | 평가 | - | 25 | 출제 18 / 10~20 |');
    expect(assessment(18, 25)).toMatch(/\| js-basics\.m\.r \|.*\| ✓ \|$/m);
    // Without itemCount the engine asks at most 20.
    expect(assessment(undefined, 25)).toContain('| 25 | 출제 20 / 10~20 |');
    // Too few per sitting.
    expect(assessment(5, 12)).toMatch(/\| js-basics\.m\.r \|.*출제 5 \/ 10~20.*\| ✗ \|$/m);
  });
});
