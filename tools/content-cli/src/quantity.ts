/**
 * FR-EX-09 quantity and type-mix checks (prd.md#문제-수량-기준,
 * content-and-exercises.md#문제-수-산정-방식). `measureQuantities` builds the per-unit numbers
 * that `content-cli report` prints; `checkQuantities` turns them into diagnostics.
 *
 * Counting (content-and-exercises.md#문제-수-산정-방식):
 * - Only approved exercises count (drafts do not ship). A parametric template will count as 1
 *   when templates join the pipeline (FR-EX-08).
 * - A unit's pool is its practice items (not `usage: assessment` / `project` /
 *   `worked_example` / `check` / `try`).
 * - A concept's count is the practice items whose primary concept (weight 1) it is, across all
 *   units. Secondary tags never count.
 */
import {
  ASSESSMENT_MAX_ITEMS,
  type ConceptSource,
  type ExerciseSource,
  type LessonSource,
} from '@proginone/content-schema';
import type { Diagnostics } from './diagnostics.ts';
import type { ContentSource, CourseNodeSource, LessonNodeSource } from './load.ts';

/** Type categories of the type-mix table (prd.md#문제-수량-기준). */
export const CATEGORIES = ['concept', 'code', 'debug', 'implement', 'apply'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  concept: '개념 확인',
  code: '코드 이해',
  debug: '디버깅',
  implement: '구현',
  apply: '응용',
};

/** Base category of each exercise type. P1 types are mapped to the closest MVP category. */
const BASE_CATEGORY: Readonly<Record<string, Exclude<Category, 'apply'>>> = {
  mcq_single: 'concept',
  mcq_multi: 'concept',
  true_false: 'concept',
  matching: 'concept',
  find_false_statement: 'concept',
  predict_output: 'code',
  fill_blank: 'code',
  parsons: 'code',
  find_bug_line: 'code',
  trace_variables: 'code',
  order_execution: 'code',
  fix_bug: 'debug',
  implement_function: 'implement',
  web_task: 'implement',
};

/** Difficulty from which implementation and debugging items count as 응용 (L4+). */
export const APPLY_MIN_DIFFICULTY = 4;

/**
 * A `web_task` whose starter is a buggy page to fix (`spec.debugging: true`) is a bug fix like
 * `fix_bug`. `find_bug_line` and `fix_bug` run without a DOM, so DOM debugging can only be a
 * `web_task` (D-069).
 */
const isWebDebugging = (ex: Pick<ExerciseSource, 'type'> & { spec?: ExerciseSource['spec'] }) =>
  ex.type === 'web_task' && ex.spec?.['debugging'] === true;

/** The category an exercise counts toward, or null for a type outside the table. */
export function categoryOf(
  ex: Pick<ExerciseSource, 'type' | 'difficulty'> & { spec?: ExerciseSource['spec'] },
): Category | null {
  const base = isWebDebugging(ex) ? 'debug' : BASE_CATEGORY[ex.type];
  if (base === undefined) return null;
  if ((base === 'debug' || base === 'implement') && ex.difficulty >= APPLY_MIN_DIFFICULTY)
    return 'apply';
  return base;
}

/** `js`: JavaScript courses; `markup`: HTML/CSS courses (one set of targets). */
export type Family = 'js' | 'markup';

export interface Range {
  min: number;
  max: number;
}

/** Practice items per unit (prd.md#문제-수량-기준). */
export const UNIT_RANGES = {
  js: { core: { min: 20, max: 30 }, standard: { min: 10, max: 20 }, minor: { min: 10, max: 20 } },
  markup: { core: { min: 6, max: 12 }, standard: { min: 6, max: 12 }, minor: { min: 6, max: 12 } },
} as const satisfies Record<Family, Record<LessonSource['importance'], Range>>;

/** Practice items per primary concept, by the concept's importance. */
export const CONCEPT_MINIMUMS = {
  js: { core: 6, standard: 4, minor: 3 },
  markup: { core: 2, standard: 2, minor: 2 },
} as const satisfies Record<Family, Record<ConceptSource['importance'], number>>;

/** Target share of each category (0–1) and the allowed deviation (prd.md: ±10%p). */
export const CATEGORY_TARGETS: Record<Family, Record<Category, Range>> = {
  js: {
    concept: { min: 0.25, max: 0.25 },
    code: { min: 0.25, max: 0.25 },
    debug: { min: 0.2, max: 0.2 },
    implement: { min: 0.2, max: 0.2 },
    apply: { min: 0.1, max: 0.1 },
  },
  markup: {
    concept: { min: 0.35, max: 0.35 },
    code: { min: 0.25, max: 0.25 },
    debug: { min: 0.1, max: 0.1 },
    implement: { min: 0.3, max: 0.3 },
    apply: { min: 0, max: 0.05 },
  },
};
export const CATEGORY_TOLERANCE = 0.1;

/** Type diversity of a unit pool (content-and-exercises.md#난이도-분포-규칙의 유형 분포 규칙). */
export const DIVERSITY = { minTypes: 4, maxShare: 0.5 } as const;

/**
 * The quantity rules. Each has its own severity per family (`QUANTITY_LEVELS`) so a rule can be
 * an error for JavaScript once the content meets it, while the others still warn.
 */
export const QUANTITY_RULES = [
  'unit-count',
  'unit-count-over',
  'concept-min',
  'type-mix',
  'type-diversity',
  'assessment-coverage',
] as const;
export type QuantityRule = (typeof QUANTITY_RULES)[number];
export type Level = 'error' | 'warning';

/**
 * Severity of each rule. The PRD makes every JavaScript shortfall an error and every HTML/CSS
 * one a warning. A unit with more items than its range only warns (more practice never blocks a
 * build). JavaScript rules were warnings until the content met them (D-056); `type-mix` became
 * an error once the JS units met the type mix (D-069).
 */
export const QUANTITY_LEVELS: Record<Family, Record<QuantityRule, Level>> = {
  js: {
    'unit-count': 'error',
    'unit-count-over': 'warning',
    'concept-min': 'error',
    'type-mix': 'error',
    'type-diversity': 'error',
    'assessment-coverage': 'error',
  },
  markup: {
    'unit-count': 'warning',
    'unit-count-over': 'warning',
    'concept-min': 'warning',
    'type-mix': 'warning',
    'type-diversity': 'warning',
    'assessment-coverage': 'warning',
  },
};

export interface UnitQuantity {
  lessonId: string;
  file: string;
  courseId: string;
  family: Family;
  /** HTML/CSS `depth: core` courses are exempt from type diversity (D-028). */
  coreDepth: boolean;
  kind: LessonSource['kind'];
  importance: LessonSource['importance'];
  /** Approved practice items (assessment units: approved assessment items). */
  count: number;
  /** Unapproved items of the unit (not counted). */
  drafts: number;
  /**
   * null: no range for this kind of unit (project units). Assessment units: the range of the
   * items asked per sitting (`asked`), not of the pool.
   */
  range: Range | null;
  /** Assessment units: items one sitting asks (`assessmentAsked`); null for other units. */
  asked: number | null;
  byCategory: Record<Category, number>;
  /** Items whose type is outside the category table. */
  uncategorized: number;
  byType: Map<string, number>;
  /** Index 0 = difficulty 1. */
  byDifficulty: [number, number, number, number, number];
}

export interface ConceptQuantity {
  conceptId: string;
  importance: ConceptSource['importance'];
  family: Family;
  lessonId: string;
  file: string;
  count: number;
  min: number;
}

export interface QuantityReport {
  units: UnitQuantity[];
  concepts: ConceptQuantity[];
}

const familyOf = (course: CourseNodeSource): Family =>
  course.meta.data.language === 'javascript' ? 'js' : 'markup';

const primaryOf = (ex: ExerciseSource) => ex.concepts.find((c) => c.weight === 1)?.id;

/** Items that count toward a unit's practice pool. */
const isPracticePool = (ex: ExerciseSource) =>
  ex.usage !== 'assessment' &&
  ex.usage !== 'project' &&
  ex.usage !== 'worked_example' &&
  ex.usage !== 'check' &&
  ex.usage !== 'try';

const approved = (ex: ExerciseSource) => ex.review.status === 'approved';

function measureUnit(course: CourseNodeSource, lesson: LessonNodeSource): UnitQuantity {
  const family = familyOf(course);
  const { data, file } = lesson.meta;
  const counted = lesson.exercises
    .map((e) => e.data)
    .filter(
      (ex) =>
        approved(ex) &&
        (data.kind === 'assessment' ? ex.usage === 'assessment' : isPracticePool(ex)),
    );
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const byType = new Map<string, number>();
  const byDifficulty: UnitQuantity['byDifficulty'] = [0, 0, 0, 0, 0];
  let uncategorized = 0;
  for (const ex of counted) {
    const category = categoryOf(ex);
    if (category === null) uncategorized++;
    else byCategory[category]++;
    byType.set(ex.type, (byType.get(ex.type) ?? 0) + 1);
    byDifficulty[ex.difficulty - 1] = (byDifficulty[ex.difficulty - 1] ?? 0) + 1;
  }
  return {
    lessonId: data.id,
    file,
    courseId: course.meta.data.id,
    family,
    coreDepth: family === 'markup' && course.meta.data.depth === 'core',
    kind: data.kind,
    importance: data.importance,
    count: counted.length,
    drafts: lesson.exercises.filter((e) => !approved(e.data)).length,
    range:
      data.kind === 'lesson'
        ? UNIT_RANGES[family][data.importance]
        : data.kind === 'assessment' && family === 'js'
          ? ASSESSMENT_ITEM_RANGE
          : null,
    asked:
      data.kind === 'assessment'
        ? assessmentAsked(counted.length, data.assessment?.itemCount)
        : null,
    byCategory,
    uncategorized,
    byType,
    byDifficulty,
  };
}

/** Item count range of one unit assessment sitting (content-and-exercises.md#문제-수-산정-방식). */
export const ASSESSMENT_ITEM_RANGE = { min: 10, max: 20 } as const satisfies Range;

/**
 * Items one sitting of an assessment asks: `itemCount` items of the approved pool (the pool may
 * hold more so that retakes see other items), or without it the whole pool up to the engine's
 * cap. The 10~20 advice is about this number, not the pool size (D-070).
 */
export function assessmentAsked(pool: number, itemCount: number | undefined): number {
  return Math.min(pool, itemCount ?? ASSESSMENT_MAX_ITEMS);
}

/** Per-unit and per-concept numbers of the whole content tree. */
export function measureQuantities(source: ContentSource): QuantityReport {
  const concepts = new Map(source.concepts.map((c) => [c.data.id, c.data]));
  const units: UnitQuantity[] = [];
  const conceptCounts = new Map<string, number>();
  const homes: { conceptId: string; family: Family; lesson: LessonNodeSource }[] = [];
  for (const course of source.courses) {
    for (const lesson of course.modules.flatMap((m) => m.lessons)) {
      units.push(measureUnit(course, lesson));
      for (const c of lesson.meta.data.concepts.primary)
        homes.push({ conceptId: c, family: familyOf(course), lesson });
      for (const { data: ex } of lesson.exercises) {
        const primary = primaryOf(ex);
        if (primary !== undefined && approved(ex) && isPracticePool(ex))
          conceptCounts.set(primary, (conceptCounts.get(primary) ?? 0) + 1);
      }
    }
  }
  const conceptRows = homes.flatMap(({ conceptId, family, lesson }) => {
    const concept = concepts.get(conceptId);
    if (!concept) return []; // reported by checkContent
    return [
      {
        conceptId,
        importance: concept.importance,
        family,
        lessonId: lesson.meta.data.id,
        file: lesson.meta.file,
        count: conceptCounts.get(conceptId) ?? 0,
        min: CONCEPT_MINIMUMS[family][concept.importance],
      },
    ];
  });
  return { units, concepts: conceptRows };
}

/** One rule violation, before it becomes a diagnostic (also listed by `report`). */
export interface QuantityViolation {
  rule: QuantityRule;
  family: Family;
  /** Lesson id the violation belongs to. */
  unit: string;
  file: string;
  message: string;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const rangeText = (r: Range) => (r.min === r.max ? `${r.min}` : `${r.min}~${r.max}`);

/** Every quantity rule violation of the content tree. */
export function findQuantityViolations(
  source: ContentSource,
  report: QuantityReport = measureQuantities(source),
): QuantityViolation[] {
  const out: QuantityViolation[] = [];
  const push = (
    rule: QuantityRule,
    u: { family: Family; lessonId: string; file: string },
    message: string,
  ) => out.push({ rule, family: u.family, unit: u.lessonId, file: u.file, message });

  for (const u of report.units) {
    if (u.kind !== 'lesson') continue; // assessment counts: check.ts (D-054); projects: exempt
    const range = u.range;
    if (range && (u.count < range.min || u.count > range.max)) {
      const rule = u.count < range.min ? 'unit-count' : 'unit-count-over';
      push(
        rule,
        u,
        `[${rule}] 승인된 연습 문제 ${u.count}개 / 기준 ${rangeText(range)}개 (${u.family === 'js' ? 'JavaScript' : 'HTML/CSS'} ${u.importance} 단원)`,
      );
    }
    if (u.count === 0) continue;
    const shares = CATEGORIES.map((c) => {
      const share = u.byCategory[c] / u.count;
      const target = CATEGORY_TARGETS[u.family][c];
      return { c, share, target };
    });
    const off = shares.filter(
      ({ share, target }) =>
        share < target.min - CATEGORY_TOLERANCE - 1e-9 ||
        share > target.max + CATEGORY_TOLERANCE + 1e-9,
    );
    if (off.length > 0) {
      const detail = off
        .map(
          ({ c, share, target }) =>
            `${CATEGORY_LABELS[c]} ${u.byCategory[c]}개 ${pct(share)} (목표 ${target.min === target.max ? pct(target.min) : `${pct(target.min)}~${pct(target.max)}`})`,
        )
        .join(', ');
      push('type-mix', u, `[type-mix] 유형 구성비가 ±10%p를 벗어났습니다: ${detail}`);
    }
    if (!u.coreDepth) {
      const top = [...u.byType.entries()].sort((a, b) => b[1] - a[1])[0];
      const problems: string[] = [];
      if (u.byType.size < DIVERSITY.minTypes)
        problems.push(`유형 ${u.byType.size}종 (최소 ${DIVERSITY.minTypes}종)`);
      if (top && top[1] / u.count > DIVERSITY.maxShare)
        problems.push(`${top[0]} ${pct(top[1] / u.count)} (최대 ${pct(DIVERSITY.maxShare)})`);
      if (problems.length > 0) push('type-diversity', u, `[type-diversity] ${problems.join(', ')}`);
    }
  }

  for (const c of report.concepts) {
    if (c.count < c.min)
      push(
        'concept-min',
        { family: c.family, lessonId: c.lessonId, file: c.file },
        `[concept-min] 주 개념 ${c.conceptId}(${c.importance}) 문제 ${c.count}개 / 최소 ${c.min}개`,
      );
  }

  // A module's assessment covers every concept the module introduces (prd.md: 주 개념마다 1).
  for (const course of source.courses) {
    for (const mod of course.modules) {
      const assessment = mod.lessons.find((l) => l.meta.data.kind === 'assessment');
      if (!assessment) continue;
      const covered = new Set(
        assessment.exercises
          .filter((e) => approved(e.data) && e.data.usage === 'assessment')
          .map((e) => primaryOf(e.data))
          .filter((id): id is string => id !== undefined),
      );
      const missing = mod.lessons
        .flatMap((l) => l.meta.data.concepts.primary)
        .filter((c) => !covered.has(c));
      if (missing.length > 0)
        push(
          'assessment-coverage',
          {
            family: familyOf(course),
            lessonId: assessment.meta.data.id,
            file: assessment.meta.file,
          },
          `[assessment-coverage] 승인된 평가 문항이 없는 모듈 주 개념 ${missing.length}개: ${missing.join(', ')}`,
        );
    }
  }
  return out;
}

/** Reports the quantity rules as diagnostics with the severity of `QUANTITY_LEVELS`. */
export function checkQuantities(
  source: ContentSource,
  diag: Diagnostics,
  levels: Record<Family, Record<QuantityRule, Level>> = QUANTITY_LEVELS,
): void {
  for (const v of findQuantityViolations(source)) {
    if (levels[v.family][v.rule] === 'error') diag.error(v.file, v.message);
    else diag.warn(v.file, v.message);
  }
}
