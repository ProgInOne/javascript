import { hasProtoKey, parseRunResult, withinDepth, type RunPlan } from '@proginone/shared';
import type { z } from 'zod';

import { fillBlank } from '../types/fill-blank.ts';
import { fixBug } from '../types/fix-bug.ts';
import { implementFunction } from '../types/implement-function.ts';
import { mcqSingle } from '../types/mcq-single.ts';
import { predictOutput } from '../types/predict-output.ts';
import { webTask } from '../types/web-task.ts';
import { ExerciseKitError } from './errors.ts';
import type {
  ExerciseCategory,
  ExerciseTypeDef,
  ExerciseTypeId,
  GradeResult,
  RedactOptions,
  RunPlanOptions,
  ServerFindings,
  VerifyIssue,
} from './types.ts';

/**
 * Type-erased view of a registered type. Callers outside this package (server, web,
 * content-cli) go through the functions below, which validate every untrusted input with the
 * type's schemas before calling the typed implementation.
 */
export interface RegisteredExerciseType {
  id: ExerciseTypeId;
  version: number;
  category: ExerciseCategory;
  weightOverride?: number;
  specSchema: z.ZodType;
  publicSpecSchema: z.ZodType;
  answerSchema: z.ZodType;
  supportsRunPlan: boolean;
  requiresRun(spec: unknown): boolean;
  redact(spec: unknown, options?: RedactOptions): unknown;
  buildRunPlan(spec: unknown, answer: unknown, options: RunPlanOptions): RunPlan;
  grade(input: {
    spec: unknown;
    answer: unknown;
    run?: unknown;
    serverFindings?: ServerFindings;
  }): GradeResult;
  verify(spec: unknown): VerifyIssue[];
  leakFingerprints(spec: unknown): string[];
}

function register<S, P, A>(def: ExerciseTypeDef<S, P, A>): RegisteredExerciseType {
  const registered: RegisteredExerciseType = {
    id: def.id,
    version: def.version,
    category: def.category,
    specSchema: def.specSchema,
    publicSpecSchema: def.publicSpecSchema,
    answerSchema: def.answerSchema,
    supportsRunPlan: def.buildRunPlan !== undefined,
    requiresRun: (spec) => def.requiresRun(spec as S),
    redact: (spec, options) => def.redact(spec as S, options),
    buildRunPlan: (spec, answer, options) => {
      if (!def.buildRunPlan)
        throw new ExerciseKitError('RUN_REQUIRED', `${def.id} does not execute code`);
      return def.buildRunPlan(spec as S, answer as A, options);
    },
    grade: ({ spec, answer, run, serverFindings }) => {
      const input: Parameters<typeof def.grade>[0] = { spec: spec as S, answer: answer as A };
      if (run !== undefined) input.run = run as NonNullable<typeof input.run>;
      if (serverFindings !== undefined) input.serverFindings = serverFindings;
      return def.grade(input);
    },
    verify: (spec) => def.verify(spec as S),
    leakFingerprints: (spec) => def.leakFingerprints(spec as S),
  };
  if (def.weightOverride !== undefined) registered.weightOverride = def.weightOverride;
  return registered;
}

const REGISTRY = new Map<ExerciseTypeId, RegisteredExerciseType>(
  [
    register(mcqSingle),
    register(fillBlank),
    register(predictOutput),
    register(implementFunction),
    register(fixBug),
    register(webTask),
  ].map((def) => [def.id, def]),
);

/** Type IDs with an implementation in this version. */
export function implementedExerciseTypes(): ExerciseTypeId[] {
  return [...REGISTRY.keys()];
}

export function getExerciseType(typeId: string): RegisteredExerciseType | undefined {
  return REGISTRY.get(typeId as ExerciseTypeId);
}

function requireType(typeId: string): RegisteredExerciseType {
  const def = getExerciseType(typeId);
  if (!def)
    throw new ExerciseKitError('UNKNOWN_TYPE', `exercise type ${typeId} is not implemented`);
  return def;
}

function parseWith(
  schema: z.ZodType,
  input: unknown,
  code: 'INVALID_SPEC' | 'INVALID_ANSWER',
  label: string,
): unknown {
  if (!withinDepth(input)) throw new ExerciseKitError(code, `${label} nests too deeply`);
  if (hasProtoKey(input)) throw new ExerciseKitError(code, `${label} contains a __proto__ key`);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ExerciseKitError(
      code,
      `invalid ${label}`,
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return parsed.data;
}

/** Validates a raw spec (YAML, content.db JSON, AI output) and applies defaults. Throws `INVALID_SPEC`. */
export function parseSpec(typeId: string, rawSpec: unknown): unknown {
  return parseWith(requireType(typeId).specSchema, rawSpec, 'INVALID_SPEC', `${typeId} spec`);
}

/** Validates a learner answer. Throws `INVALID_ANSWER`. */
export function parseAnswer(typeId: string, rawAnswer: unknown): unknown {
  return parseWith(
    requireType(typeId).answerSchema,
    rawAnswer,
    'INVALID_ANSWER',
    `${typeId} answer`,
  );
}

/** Validates a raw spec and returns the client-safe public spec (answer keys removed). */
export function redactSpec(typeId: string, rawSpec: unknown, options?: RedactOptions): unknown {
  const def = requireType(typeId);
  return def.redact(parseSpec(typeId, rawSpec), options);
}

/** Validates spec and answer, then builds the sandbox run plan. */
export function buildRunPlan(input: {
  typeId: string;
  spec: unknown;
  answer: unknown;
  purpose: RunPlanOptions['purpose'];
}): RunPlan {
  const def = requireType(input.typeId);
  return def.buildRunPlan(
    parseSpec(input.typeId, input.spec),
    parseAnswer(input.typeId, input.answer),
    {
      purpose: input.purpose,
    },
  );
}

/**
 * Grades a submission. Validates the spec, the answer and (when present) the sandbox run result
 * before calling the pure grader. Throws {@link ExerciseKitError} for invalid input; a wrong
 * answer is a normal result.
 */
export function gradeSubmission(input: {
  typeId: string;
  spec: unknown;
  answer: unknown;
  run?: unknown;
  serverFindings?: ServerFindings;
}): GradeResult {
  const def = requireType(input.typeId);
  const spec = parseSpec(input.typeId, input.spec);
  const answer = parseAnswer(input.typeId, input.answer);
  let run: unknown;
  if (input.run !== undefined) {
    const parsed = parseRunResult(input.run);
    if (!parsed.success) throw new ExerciseKitError('INVALID_RUN_RESULT', parsed.error);
    run = parsed.data;
  }
  if (run === undefined && def.requiresRun(spec)) {
    throw new ExerciseKitError('RUN_REQUIRED', `${input.typeId} needs a sandbox run result`);
  }
  return def.grade({
    spec,
    answer,
    ...(run === undefined ? {} : { run }),
    ...(input.serverFindings === undefined ? {} : { serverFindings: input.serverFindings }),
  });
}

/** Validates a raw spec and returns its answer-leak fingerprints (server only). */
export function leakFingerprints(typeId: string, rawSpec: unknown): string[] {
  return requireType(typeId).leakFingerprints(parseSpec(typeId, rawSpec));
}

/**
 * Schema validation plus static verification in one call, shaped for `content-cli check`:
 * errors are `path: message` strings; verification warnings are returned separately.
 */
export function checkSpec(
  typeId: string,
  rawSpec: unknown,
): { ok: true; warnings: string[] } | { ok: false; errors: string[] } {
  try {
    const issues = verifySpec(typeId, rawSpec);
    const format = (i: VerifyIssue) => `${i.path ? `${i.path}: ` : ''}${i.message} (${i.code})`;
    const errors = issues.filter((i) => i.severity === 'error').map(format);
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, warnings: issues.filter((i) => i.severity === 'warning').map(format) };
  } catch (error) {
    if (error instanceof ExerciseKitError) {
      return { ok: false, errors: error.details.length > 0 ? [...error.details] : [error.message] };
    }
    throw error;
  }
}

/** Validates a spec and runs the type's static content checks. */
export function verifySpec(typeId: string, rawSpec: unknown): VerifyIssue[] {
  return requireType(typeId).verify(parseSpec(typeId, rawSpec));
}
