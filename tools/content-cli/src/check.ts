import { join } from 'node:path';
import {
  containsRawHtml,
  type ConceptSource,
  type ExerciseSource,
} from '@proginone/content-schema';
import { Diagnostics } from './diagnostics.ts';
import {
  EXPECTATIONS_FILE,
  predictInputHash,
  readExpectations,
  type ExpectationStore,
} from './expectations.ts';
import { loadContent, type ContentSource, type LessonNodeSource } from './load.ts';
import { compileLessonMdx, type CompiledLesson } from './mdx.ts';

/** Validates a type-specific exercise spec. Supplied by exercise-kit's registry. */
export type SpecValidator = (
  type: string,
  spec: unknown,
) => { ok: true; warnings?: string[] } | { ok: false; errors: string[] };

export interface CheckOptions {
  validateSpec?: SpecValidator;
  /**
   * Execution-derived `predict_output` answer keys. Default: read from
   * `<root>/.generated/predict-expected.json` (see expectations.ts).
   */
  expectations?: ExpectationStore;
  /** Leave `spec.expected` empty and report nothing about it (first pass of `check --run`). */
  skipExpectations?: boolean;
}

export interface CheckResult {
  source: ContentSource;
  diagnostics: Diagnostics;
  /** Compiled lesson bodies keyed by lesson id (reused by `build`). */
  lessons: Map<string, CompiledLesson>;
}

/**
 * Exercise types a CSS course may use (D-028). CSS is foundations-only (`depth: core`) in this
 * product; production/recall types for CSS come with a dedicated CSS course later.
 */
export const CSS_EXERCISE_TYPES: ReadonlySet<string> = new Set([
  'mcq_single',
  'fill_blank',
  'web_task',
]);

const prereqId = (p: ConceptSource['prerequisites'][number]) => (typeof p === 'string' ? p : p.id);

/** Schema + cross-reference checks (content-cli check --schema). */
export function checkContent(root: string, options: CheckOptions = {}): CheckResult {
  const diag = new Diagnostics(root);
  const source = loadContent(root, diag);
  const lessons = new Map<string, CompiledLesson>();
  const expectations = options.expectations ?? readExpectations(root, diag);
  const predictIds = new Set<string>();

  // ── Uniqueness ──
  const seen = new Map<string, string>();
  const unique = (id: string, file: string) => {
    const prev = seen.get(id);
    if (prev) diag.error(file, `ID가 중복됩니다: ${id} (${prev})`);
    else seen.set(id, file);
  };

  const concepts = new Map(source.concepts.map((c) => [c.data.id, c]));
  const misconceptions = new Map(source.misconceptions.map((m) => [m.data.id, m]));
  source.concepts.forEach((c) => {
    unique(c.data.id, c.file);
  });
  source.misconceptions.forEach((m) => {
    unique(m.data.id, m.file);
  });

  const allLessons: LessonNodeSource[] = source.courses.flatMap((c) =>
    c.modules.flatMap((m) => m.lessons),
  );
  const courseOfLesson = new Map(
    source.courses.flatMap((c) =>
      c.modules.flatMap((m) => m.lessons.map((l) => [l.meta.data.id, c.meta.data] as const)),
    ),
  );
  const exerciseIds = new Set(allLessons.flatMap((l) => l.exercises.map((e) => e.data.id)));

  // ── Concepts ──
  for (const { file, data } of source.concepts) {
    for (const p of data.prerequisites) {
      if (!concepts.has(prereqId(p)))
        diag.error(file, `${data.id}: 없는 선수 개념입니다: ${prereqId(p)}`);
      if (prereqId(p) === data.id)
        diag.error(file, `${data.id}: 자기 자신을 선수 개념으로 둘 수 없습니다`);
    }
    for (const m of data.misconceptions) {
      const mc = misconceptions.get(m);
      if (!mc) diag.error(file, `${data.id}: 없는 오개념입니다: ${m}`);
      else if (mc.data.concept !== data.id)
        diag.error(file, `${data.id}: 오개념 ${m}은 ${mc.data.concept}에 속합니다`);
    }
  }
  for (const cycle of findCycles(source.concepts.map((c) => c.data))) {
    diag.error(
      concepts.get(cycle[0] ?? '')?.file ?? root,
      `선수 관계에 순환이 있습니다: ${cycle.join(' → ')}`,
    );
  }

  // ── Misconceptions ──
  for (const { file, data } of source.misconceptions) {
    if (!concepts.has(data.concept))
      diag.error(file, `${data.id}: 없는 개념입니다: ${data.concept}`);
    for (const ex of data.remediation?.exercises ?? []) {
      if (!exerciseIds.has(ex)) diag.error(file, `${data.id}: 없는 문제입니다: ${ex}`);
    }
    const anchor = data.remediation?.lessonSection;
    if (anchor && !allLessons.some((l) => l.meta.data.id === anchor.split('#')[0])) {
      diag.error(file, `${data.id}: 없는 단원입니다: ${anchor}`);
    }
  }

  // ── Lessons and exercises ──
  const introducedAt = new Map<string, number>();
  allLessons.forEach((lesson, index) => {
    const { file, data } = lesson.meta;
    unique(data.id, file);
    const lessonConcepts = [
      ...data.concepts.primary,
      ...data.concepts.practiced,
      ...data.concepts.reviewed,
    ];
    for (const c of lessonConcepts) if (!concepts.has(c)) diag.error(file, `없는 개념입니다: ${c}`);
    for (const c of data.concepts.primary) {
      if (introducedAt.has(c))
        diag.error(file, `개념 ${c}을(를) 이미 앞 단원에서 소개했습니다(primary는 한 단원만)`);
      else introducedAt.set(c, index);
    }

    if (lesson.mdx !== null) {
      const compiled = compileLessonMdx(lesson.mdx, { lessonKind: data.kind });
      lessons.set(data.id, compiled);
      for (const e of compiled.errors) diag.error(lesson.mdxFile, e);
      for (const ref of compiled.refs.exercises) {
        if (!lesson.exercises.some((x) => x.data.id === ref))
          diag.error(lesson.mdxFile, `이 단원에 없는 문제입니다: ${ref}`);
      }
      for (const ref of compiled.refs.concepts)
        if (!concepts.has(ref)) diag.error(lesson.mdxFile, `없는 개념입니다: ${ref}`);
      for (const ref of compiled.refs.misconceptions) {
        if (!misconceptions.has(ref)) diag.error(lesson.mdxFile, `없는 오개념입니다: ${ref}`);
      }
      // Every misconception of a primary concept should be covered in pitfalls.
      for (const c of data.concepts.primary) {
        for (const m of concepts.get(c)?.data.misconceptions ?? []) {
          if (!compiled.refs.misconceptions.includes(m))
            diag.warn(lesson.mdxFile, `흔한 실수에 오개념 ${m}이(가) 없습니다`);
        }
      }
    }

    let approved = 0;
    const course = courseOfLesson.get(data.id);
    for (const { file: exFile, data: ex } of lesson.exercises) {
      unique(ex.id, exFile);
      if (course?.language === 'css' && !CSS_EXERCISE_TYPES.has(ex.type)) {
        diag.error(
          exFile,
          `CSS 과정에서는 ${[...CSS_EXERCISE_TYPES].join(', ')} 유형만 쓸 수 있습니다: ${ex.type}`,
        );
      }
      if (!ex.id.startsWith(`${data.id}.`))
        diag.error(exFile, `문제 ID는 단원 ID(${data.id})로 시작해야 합니다`);
      for (const c of ex.concepts)
        if (!concepts.has(c.id)) diag.error(exFile, `없는 개념입니다: ${c.id}`);
      for (const m of ex.misconceptions)
        if (!misconceptions.has(m)) diag.error(exFile, `없는 오개념입니다: ${m}`);
      const fields = { prompt: ex.prompt, explanation: ex.explanation, hints: ex.hints.join('\n') };
      for (const [field, text] of Object.entries(fields)) {
        if (containsRawHtml(text)) diag.error(exFile, `${field}에 원시 HTML이 있습니다`);
      }
      if (ex.type === 'predict_output') {
        predictIds.add(ex.id);
        if (!options.skipExpectations) applyExpectation(ex, exFile, expectations, diag);
      }
      if (options.validateSpec) {
        const r = options.validateSpec(ex.type, ex.spec);
        if (!r.ok) for (const e of r.errors) diag.error(exFile, `spec: ${e}`);
        else {
          for (const w of r.warnings ?? []) {
            // Reported above with the command that fixes it.
            if (!w.endsWith('(PREDICT_EXPECTED_MISSING)')) diag.warn(exFile, `spec: ${w}`);
          }
        }
      }
      if (ex.review.status === 'approved') approved++;
    }
    const drafts = lesson.exercises.length - approved;
    if (drafts > 0) diag.warn(file, `검토되지 않은 문제 ${drafts}개는 빌드에서 제외됩니다`);
    const target = data.practice?.targetCount;
    if (target !== undefined && approved !== target)
      diag.warn(file, `승인된 문제 ${approved}개 / 목표 ${target}개`);
  });

  // Concepts must belong to a lesson; prerequisites should be introduced earlier.
  for (const { file, data } of source.concepts) {
    const at = introducedAt.get(data.id);
    if (at === undefined) {
      diag.error(file, `${data.id}: 어느 단원에서도 소개(primary)하지 않습니다`);
      continue;
    }
    for (const p of data.prerequisites) {
      const pAt = introducedAt.get(prereqId(p));
      if (pAt !== undefined && pAt > at)
        diag.warn(file, `${data.id}: 선수 개념 ${prereqId(p)}이(가) 뒤 단원에서 소개됩니다`);
    }
  }

  for (const id of Object.keys(expectations.entries)) {
    if (!predictIds.has(id) && !options.skipExpectations)
      diag.warn(
        join(root, EXPECTATIONS_FILE),
        `없는 predict_output 문제의 기대값입니다: ${id} (pnpm content:check:run이 정리합니다)`,
      );
  }

  return { source, diagnostics: diag, lessons };
}

/**
 * Fills `spec.expected` of a predict_output exercise from the expectation store when the code
 * has not changed since the last `check --run`. Approved exercises must have a fresh key (they
 * ship and are graded against it); drafts only warn.
 */
function applyExpectation(
  ex: ExerciseSource,
  file: string,
  store: ExpectationStore,
  diag: Diagnostics,
): void {
  if (ex.spec['expected'] !== undefined && ex.spec['expected'] !== null) {
    diag.error(
      file,
      'spec.expected는 직접 쓰지 않습니다. pnpm content:check:run이 실행해서 계산합니다',
    );
    return;
  }
  const entry = store.entries[ex.id];
  if (entry?.inputHash === predictInputHash(ex.spec)) {
    ex.spec['expected'] = entry.expected;
    return;
  }
  const message = entry
    ? '코드가 바뀌어 실행 기대값이 낡았습니다. pnpm content:check:run으로 다시 계산하세요'
    : '실행 기대값이 아직 없습니다. pnpm content:check:run으로 계산하세요';
  if (ex.review.status === 'approved') diag.error(file, message);
  else diag.warn(file, message);
}

/** Returns each prerequisite cycle once (as a closed path). */
export function findCycles(concepts: readonly ConceptSource[]): string[][] {
  const graph = new Map(concepts.map((c) => [c.id, c.prerequisites.map(prereqId)]));
  const state = new Map<string, 'visiting' | 'done'>();
  const cycles: string[][] = [];
  const stack: string[] = [];
  const visit = (id: string) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      cycles.push([...stack.slice(stack.indexOf(id)), id]);
      return;
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const next of graph.get(id) ?? []) visit(next);
    stack.pop();
    state.set(id, 'done');
  };
  for (const id of graph.keys()) visit(id);
  return cycles;
}
