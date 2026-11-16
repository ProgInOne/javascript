import { join } from 'node:path';
import {
  containsRawHtml,
  MIN_TEMPLATE_POOL,
  type ExerciseSource,
  type TemplateSource,
} from '@proginone/content-schema';
import {
  ExerciseKitError,
  instantiateTemplate,
  paramSpaceSize,
  parseTemplate,
  sampleSeeds,
  type ExerciseTemplate,
  type TemplateInstance,
} from '@proginone/exercise-kit';
import type { Diagnostics } from './diagnostics.ts';
import {
  predictInputHash,
  TEMPLATE_EXPECTATIONS_FILE,
  type ExpectationStore,
} from './expectations.ts';
import { canonical, sha256 } from './hash.ts';
import type { ContentSource, Located } from './load.ts';

/**
 * Parametric template checks (docs/design/content-and-exercises.md#파라메트릭-템플릿, D-056).
 *
 * A template is checked by instantiating its build-time sample seeds (`sampleSeeds(id, n)`):
 * every sample must render a valid spec of its type, distinct samples form the variant pool, and
 * `check --run` executes each pooled variant in the real runner (verify like an authored exercise)
 * and records the execution-derived answer keys in `.generated/template-expected.json`. The build
 * stores the template and its verified pool; the server only serves pooled seeds, so every
 * served variant's answer comes from a real run, never from an author or the expression language.
 */

/** Exercise types a template may produce. Project milestones stay authored. */
export const TEMPLATE_TYPES: ReadonlySet<string> = new Set([
  'mcq_single',
  'mcq_multi',
  'true_false',
  'fill_blank',
  'predict_output',
  'parsons',
  'find_bug_line',
  'implement_function',
  'fix_bug',
]);

/** Share of the pool with the same answer above which a template only warns (content doc). */
export const SKEWED_ANSWER_RATIO = 0.8;

export interface TemplateVariant {
  variantId: string;
  /** Lowercase hex seed (the part after `@`). */
  seed: string;
  /** Index of the sample seed (`sampleSeeds(id, n)[i]`). */
  sampleIndex: number;
  instance: TemplateInstance;
  /** Rendered spec, with the execution-derived `expected` filled in when one is recorded. */
  spec: Record<string, unknown>;
  /**
   * Whether the last `check --run` verified this exact variant (a fresh entry in
   * `template-expected.json`); predict_output variants then also have `spec.expected`.
   */
  verified: boolean;
}

export interface CheckedTemplate {
  file: string;
  lessonId: string;
  source: TemplateSource;
  /** Distinct sample variants in sample order (the pool before answer-key filtering). */
  variants: TemplateVariant[];
  /** Upper bound of the parameter space before constraints. */
  spaceSize: number;
}

/** Same shape as check.ts `SpecValidator` (not imported: check.ts imports this module). */
type SpecValidator = (
  type: string,
  spec: unknown,
) => { ok: true; warnings?: string[]; misconceptions?: string[] } | { ok: false; errors: string[] };

export interface TemplateCheckInput {
  source: ContentSource;
  diag: Diagnostics;
  concepts: ReadonlySet<string>;
  misconceptions: ReadonlySet<string>;
  /** Registers an ID for the content-wide uniqueness check. */
  unique: (id: string, file: string) => void;
  validateSpec?: SpecValidator;
  store: ExpectationStore;
  skipExpectations: boolean;
}

/** The exercise-kit engine's view of a template source. */
export function engineTemplateOf(source: TemplateSource): Record<string, unknown> {
  return {
    id: source.id,
    type: source.type,
    params: source.params,
    constraints: source.constraints,
    render: source.render,
    spec: source.spec,
    hints: source.hints,
    explanation: source.explanation,
    variantPolicy: {
      ...(source.variantPolicy.maxVariants === undefined
        ? {}
        : { maxVariants: source.variantPolicy.maxVariants }),
      minDistinctFromRecent: source.variantPolicy.minDistinctFromRecent,
    },
  };
}

/** Neither undefined nor null. */
export const hasValue = (value: unknown) => value !== undefined && value !== null;

const kitMessage = (error: unknown) =>
  error instanceof ExerciseKitError
    ? [error.message, ...error.details].join(': ')
    : error instanceof Error
      ? error.message
      : String(error);

/** Everything a learner sees of a variant (dedupe key; prompt, code, spec, hints, explanation). */
const renderedKey = (i: TemplateInstance) =>
  canonical({
    render: i.render,
    spec: i.spec,
    hints: i.hints ?? null,
    explanation: i.explanation ?? null,
  });

/**
 * What a `template-expected.json` entry is valid for: the fields that determine a predict answer
 * key (`predictInputHash`), or the whole rendered spec for other types.
 */
export function variantInputHash(type: string, spec: Readonly<Record<string, unknown>>): string {
  return type === 'predict_output'
    ? predictInputHash(spec)
    : sha256(canonical({ v: 1, type, spec }));
}

/** Hash of the template source (`exercise_templates.template_hash`). */
export const templateHash = (source: TemplateSource) => sha256(canonical(source));

/** Content hash of a served variant (`template_variants.content_hash`, attempt snapshots). */
export function variantContentHash(source: TemplateSource, variant: TemplateVariant): string {
  return sha256(
    canonical({
      template: templateHash(source),
      variantId: variant.variantId,
      render: variant.instance.render,
      spec: variant.spec,
      hints: variant.instance.hints ?? null,
      explanation: variant.instance.explanation ?? null,
    }),
  );
}

/** Canonical answer of a variant, for "different from the last N answers" (server selection). */
export function variantAnswerKey(source: TemplateSource, variant: TemplateVariant): string {
  const expected = variant.spec['expected'];
  return hasValue(expected) ? canonical(expected) : variantContentHash(source, variant);
}

/**
 * Checks every template: metadata against the catalog, then the build-time samples. Returns the
 * templates that instantiate (with their variant pools) for `check --run` and `build`.
 */
export function checkTemplates(input: TemplateCheckInput): CheckedTemplate[] {
  const { source, diag } = input;
  const out: CheckedTemplate[] = [];
  const variantIds = new Set<string>();
  for (const course of source.courses) {
    for (const lesson of course.modules.flatMap((m) => m.lessons)) {
      const lessonId = lesson.meta.data.id;
      for (const located of lesson.templates) {
        input.unique(located.data.id, located.file);
        const checked = checkTemplate(located, lessonId, course.meta.data.language, input);
        if (!checked) continue;
        out.push(checked);
        for (const v of checked.variants) variantIds.add(v.variantId);
      }
    }
  }
  if (!input.skipExpectations) {
    for (const id of Object.keys(input.store.entries)) {
      if (!variantIds.has(id)) {
        diag.warn(
          join(source.root, TEMPLATE_EXPECTATIONS_FILE),
          `없는 템플릿 변형의 기대값입니다: ${id} (pnpm content:check:run이 정리합니다)`,
        );
      }
    }
  }
  return out;
}

function checkTemplate(
  { file, data: tpl }: Located<TemplateSource>,
  lessonId: string,
  language: string,
  input: TemplateCheckInput,
): CheckedTemplate | null {
  const { diag } = input;
  if (!tpl.id.startsWith(`${lessonId}.t.`)) {
    diag.error(file, `템플릿 ID는 "${lessonId}.t."로 시작해야 합니다`);
  }
  if (language !== 'javascript') {
    diag.error(file, '템플릿은 JavaScript 과정에서만 쓸 수 있습니다');
  }
  if (!TEMPLATE_TYPES.has(tpl.type)) {
    diag.error(
      file,
      `템플릿으로 만들 수 없는 유형입니다: ${tpl.type} (가능: ${[...TEMPLATE_TYPES].join(', ')})`,
    );
    return null;
  }
  for (const c of tpl.concepts)
    if (!input.concepts.has(c.id)) diag.error(file, `없는 개념입니다: ${c.id}`);
  for (const m of tpl.misconceptions)
    if (!input.misconceptions.has(m)) diag.error(file, `없는 오개념입니다: ${m}`);

  let engine: ExerciseTemplate;
  try {
    engine = parseTemplate(engineTemplateOf(tpl));
  } catch (error) {
    diag.error(file, `템플릿 형식: ${kitMessage(error)}`);
    return null;
  }

  // ── Samples: each must instantiate; distinct ones form the pool ──
  const seeds = sampleSeeds(tpl.id, tpl.variantPolicy.sampleSize);
  const variants: TemplateVariant[] = [];
  const seen = new Set<string>();
  const failures: string[] = [];
  seeds.forEach((seed, sampleIndex) => {
    let instance: TemplateInstance;
    try {
      instance = instantiateTemplate(engine, seed);
    } catch (error) {
      failures.push(`표본 ${sampleIndex}(시드 ${seed.toString(16)}): ${kitMessage(error)}`);
      return;
    }
    const key = renderedKey(instance);
    if (seen.has(key)) return;
    seen.add(key);
    variants.push({
      variantId: instance.variantId,
      seed: instance.variantId.slice(instance.variantId.lastIndexOf('@') + 1),
      sampleIndex,
      instance,
      spec: { ...(instance.spec as Record<string, unknown>) },
      verified: false,
    });
  });
  if (failures.length > 0) {
    diag.error(file, `표본 시드 ${failures.length}개를 만들 수 없습니다`);
    for (const f of failures.slice(0, 5)) diag.error(file, `  ${f}`);
    return null;
  }
  if (variants.length < MIN_TEMPLATE_POOL) {
    diag.error(
      file,
      `서로 다른 변형이 ${variants.length}개뿐입니다(최소 ${MIN_TEMPLATE_POOL}개). 매개변수 범위를 넓히거나 제약을 줄이세요`,
    );
  }

  // ── Rendered text and specs ──
  const reported = new Set<string>();
  const once = (level: 'error' | 'warn', message: string) => {
    if (reported.has(message)) return;
    reported.add(message);
    diag[level](file, message);
  };
  let stale = 0;
  let missing = 0;
  for (const v of variants) {
    const i = v.instance;
    const fields = {
      prompt: i.render['prompt'] ?? '',
      explanation: i.explanation ?? '',
      hints: (i.hints ?? []).join('\n'),
    };
    for (const [field, text] of Object.entries(fields)) {
      if (containsRawHtml(text))
        once('error', `${field}에 원시 HTML이 렌더링됩니다(${v.variantId})`);
    }
    if (!input.skipExpectations) {
      if (tpl.type === 'predict_output' && hasValue(v.spec['expected'])) {
        once(
          'error',
          'spec.expected는 직접 쓰지 않습니다. pnpm content:check:run이 실행해서 계산합니다',
        );
        continue;
      }
      const entry = input.store.entries[v.variantId];
      if (entry?.inputHash === variantInputHash(tpl.type, v.spec)) {
        if (tpl.type === 'predict_output') v.spec['expected'] = entry.expected;
        v.verified = true;
      } else if (entry) stale++;
      else missing++;
    }
    if (input.validateSpec) {
      const r = input.validateSpec(tpl.type, v.spec);
      if (!r.ok) for (const e of r.errors) once('error', `spec(${v.variantId}): ${e}`);
      else {
        for (const m of r.misconceptions ?? []) {
          if (!input.misconceptions.has(m)) once('error', `spec: 없는 오개념입니다: ${m}`);
        }
        for (const w of r.warnings ?? []) {
          if (!w.endsWith('(PREDICT_EXPECTED_MISSING)')) once('warn', `spec: ${w}`);
        }
      }
    }
  }
  if (stale + missing > 0) {
    const message =
      stale > 0
        ? `변형 ${stale + missing}개의 실행 검증 기록이 없거나 낡았습니다. pnpm content:check:run으로 다시 검증하세요`
        : `변형 ${missing}개가 아직 실행 검증되지 않았습니다. pnpm content:check:run으로 검증하세요`;
    if (tpl.review.status === 'approved') diag.error(file, message);
    else diag.warn(file, message);
  }

  // ── Answer distribution (only meaningful with answer keys) ──
  const keyed = variants.filter((v) => v.verified && hasValue(v.spec['expected']));
  if (keyed.length >= MIN_TEMPLATE_POOL) {
    const counts = new Map<string, number>();
    for (const v of keyed) {
      const k = variantAnswerKey(tpl, v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const top = Math.max(...counts.values());
    if (top / keyed.length >= SKEWED_ANSWER_RATIO) {
      diag.warn(
        file,
        `변형 ${keyed.length}개 중 ${top}개의 정답이 같습니다. 매개변수가 정답을 거의 바꾸지 않습니다`,
      );
    }
  }

  return { file, lessonId, source: tpl, variants, spaceSize: paramSpaceSize(engine.params) };
}

/**
 * The exercise-shaped view of a variant for the execution verifier (`verifyExercise` reads only
 * `type` and `spec`; the rest are the template's own values).
 */
export function variantAsExercise(tpl: TemplateSource, v: TemplateVariant): ExerciseSource {
  return {
    id: v.variantId,
    type: tpl.type,
    difficulty: tpl.difficulty,
    concepts: tpl.concepts,
    tags: tpl.tags,
    estimatedSeconds: tpl.estimatedSeconds,
    usage: tpl.usage,
    workedExampleStage: null,
    variantGroup: tpl.variantGroup,
    prompt: v.instance.render['prompt'] ?? '',
    ...(v.instance.render['code'] === undefined ? {} : { code: v.instance.render['code'] }),
    spec: v.spec,
    hints: (v.instance.hints ?? ['', '', '']) as [string, string, string],
    explanation: v.instance.explanation ?? '',
    misconceptions: tpl.misconceptions,
    origin: 'authored',
    review: tpl.review,
  };
}
