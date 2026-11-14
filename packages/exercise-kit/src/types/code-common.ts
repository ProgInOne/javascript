import { runFileSchema, type RunFile, type RunPlan, type RunResult } from '@proginone/shared';
import { z } from 'zod';

import { leakSet } from '../common/normalize.ts';
import { gradeChecks, runFeedback, type Milestone } from '../checks/aggregate.ts';
import { compileChecks } from '../checks/compile.ts';
import { DOM_CHECK_KINDS, isRequired, type Check } from '../checks/schema.ts';
import { ExerciseKitError } from '../core/errors.ts';
import { buildResult } from '../core/result.ts';
import type {
  ExerciseTypeId,
  GradeResult,
  RunPlanOptions,
  ServerFindings,
  VerifyIssue,
} from '../core/types.ts';

/** Shared pieces of the code-writing types (implement_function, fix_bug, web_task, fill_blank code). */

export const FILE_MAX_BYTES = 200_000;
export const FILES_TOTAL_MAX = 1_000_000;

const pathSchema = runFileSchema.shape.path.refine(
  (p) => !p.split('/').some((part) => part === '..' || part === '.' || part === ''),
  'path must not contain empty, . or .. segments',
);

export const codeFileSchema = z.object({
  path: pathSchema,
  content: z.string().max(FILE_MAX_BYTES),
});
export type CodeFile = z.infer<typeof codeFileSchema>;

function uniquePaths(files: readonly CodeFile[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  files.forEach((f, i) => {
    if (seen.has(f.path))
      ctx.addIssue({ code: 'custom', message: `duplicate path ${f.path}`, path: [i, 'path'] });
    seen.add(f.path);
  });
  const total = files.reduce((sum, f) => sum + f.content.length, 0);
  if (total > FILES_TOTAL_MAX)
    ctx.addIssue({ code: 'custom', message: 'files are too large in total' });
}

export const fileListSchema = z.array(codeFileSchema).min(1).max(20).superRefine(uniquePaths);
/** `{ files: [...] }` as used by starter/buggy/solution. */
export const fileSetSchema = z.object({ files: fileListSchema });

/** Learner answer for code types: `{ files: { path, content }[] }`. */
export const codeAnswerSchema = z.object({ files: fileListSchema });
export type CodeAnswer = z.infer<typeof codeAnswerSchema>;

export function languageOf(path: string): RunFile['language'] | null {
  if (/\.m?js$/i.test(path)) return 'js';
  if (/\.html?$/i.test(path)) return 'html';
  if (/\.css$/i.test(path)) return 'css';
  return null;
}

/** Answer files ordered like the reference files (starter order first, extras after). */
export function orderFiles(
  answer: readonly CodeFile[],
  reference: readonly CodeFile[],
): CodeFile[] {
  const rank = new Map(reference.map((f, i) => [f.path, i]));
  return answer
    .map((f, i) => ({ f, key: rank.get(f.path) ?? reference.length + i }))
    .sort((x, y) => x.key - y.key)
    .map(({ f }) => f);
}

export function toRunFiles(
  files: readonly CodeFile[],
  allowed: readonly RunFile['language'][],
): RunFile[] {
  return files.map((f) => {
    const language = languageOf(f.path);
    if (language === null || !allowed.includes(language)) {
      throw new ExerciseKitError('INVALID_ANSWER', `file type not allowed: ${f.path}`);
    }
    return { path: f.path, language, content: f.content };
  });
}

export interface PlanInput {
  mode: 'js-console' | 'dom';
  files: RunFile[];
  entry: string;
  checks: readonly Check[];
  options: RunPlanOptions;
  functionName?: string;
  viewports?: readonly number[];
  timers?: 'real' | 'virtual';
  checkTimeoutMs?: number;
}

const GRADING_DURATION_MS = 10_000;
const INTERACTIVE_DURATION_MS = 3_000;
const VIEWPORT_HEIGHT = 800;

export function buildCheckRunPlan(input: PlanInput): RunPlan {
  const timers = input.timers ?? 'real';
  const defaultViewport = input.viewports?.[0];
  const compiled = compileChecks(input.checks, {
    timers,
    purpose: input.options.purpose,
    viewportHeight: VIEWPORT_HEIGHT,
    ...(input.functionName === undefined ? {} : { entry: input.functionName }),
    ...(defaultViewport === undefined ? {} : { defaultViewport }),
  });
  const plan: RunPlan = {
    v: 1,
    mode: input.mode,
    purpose: input.options.purpose,
    files: input.files,
    entry: input.entry,
    timers,
    limits: {
      maxDurationMs:
        input.options.purpose === 'interactive' ? INTERACTIVE_DURATION_MS : GRADING_DURATION_MS,
      ...(input.checkTimeoutMs === undefined ? {} : { checkTimeoutMs: input.checkTimeoutMs }),
    },
    checks: compiled.bundle,
  };
  if (input.mode === 'dom' && defaultViewport !== undefined) {
    plan.viewport = { width: defaultViewport, height: VIEWPORT_HEIGHT };
  }
  if (compiled.stdin !== undefined) plan.stdin = compiled.stdin;
  return plan;
}

export interface CheckGradeInput {
  typeId: ExerciseTypeId;
  version: number;
  checks: readonly Check[];
  run: RunResult | undefined;
  serverFindings?: ServerFindings | undefined;
  milestones?: readonly Milestone[] | undefined;
  functionName?: string | undefined;
  extraMisconceptions?: readonly (string | undefined)[];
  /** Post-processing of score and feedback (fix_bug edit-distance rule). */
  adjust?: (grade: { score: number; feedback: GradeResult['feedback'] }) => void;
}

/** Grades a run-based submission: checks → partial score → GradeResult (with run status). */
export function gradeWithChecks(input: CheckGradeInput): GradeResult {
  if (!input.run)
    throw new ExerciseKitError('RUN_REQUIRED', `${input.typeId} needs a sandbox run result`);
  const grade = gradeChecks({
    checks: input.checks,
    run: input.run,
    ...(input.serverFindings === undefined ? {} : { serverFindings: input.serverFindings }),
    ...(input.milestones === undefined ? {} : { milestones: input.milestones }),
    ...(input.functionName === undefined ? {} : { entry: input.functionName }),
  });
  const feedback = [...runFeedback(input.run), ...grade.feedback];
  const adjusted = { score: grade.score, feedback };
  input.adjust?.(adjusted);
  return buildResult({
    typeId: input.typeId,
    version: input.version,
    correct: grade.correct,
    score: adjusted.score,
    feedback: adjusted.feedback,
    misconceptionIds: [
      ...grade.misconceptionIds,
      ...(grade.correct ? [] : (input.extraMisconceptions ?? [])),
    ],
    checkResults: grade.checkResults,
    failedRequirements: grade.failedRequirements,
    runStatus: input.run.status,
    ...(grade.milestones === undefined ? {} : { milestones: grade.milestones }),
  });
}

/** Static verification shared by check-based types. */
export function verifyChecks(
  checks: readonly Check[],
  options: { allowDom: boolean; hasEntry: boolean },
): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const decisive = checks.filter(
    (c) => isRequired(c) && c.kind !== 'static' && c.kind !== 'html-valid',
  );
  if (decisive.length === 0) {
    issues.push({
      severity: 'error',
      code: 'CHECKS_NOT_DECISIVE',
      message: '동작을 확인하는 필수 체크가 최소 1개 있어야 합니다(정적 규칙만으로 판정하지 않음).',
    });
  }
  checks.forEach((check, i) => {
    if (!options.allowDom && DOM_CHECK_KINDS.has(check.kind)) {
      issues.push({
        severity: 'error',
        code: 'CHECK_NEEDS_DOM',
        message: `${check.kind} 체크는 이 유형에서 쓸 수 없습니다.`,
        path: `checks.${i}`,
      });
    }
    if (check.kind === 'call' && !options.hasEntry) {
      issues.push({
        severity: 'error',
        code: 'CHECK_NEEDS_ENTRY',
        message: 'call 체크에는 entry가 필요합니다.',
        path: `checks.${i}`,
      });
    }
    if (check.visible === false && check.description === undefined) {
      issues.push({
        severity: 'warning',
        code: 'HIDDEN_CHECK_WITHOUT_DESCRIPTION',
        message: '숨김 체크에는 학습자가 볼 설명이 필요합니다.',
        path: `checks.${i}`,
      });
    }
  });
  return issues;
}

/** Lines of the solution that the starter does not contain (normalized), at least 8 characters. */
export function solutionKeyLines(
  solution: readonly CodeFile[],
  starter: readonly CodeFile[],
): string[] {
  const starterLines = new Set(leakSet(starter.flatMap((f) => f.content.split('\n'))));
  return leakSet(solution.flatMap((f) => f.content.split('\n'))).filter(
    (line) => line.length >= 8 && !starterLines.has(line) && !/^(\/\/|\/\*|\*|<!--)/.test(line),
  );
}
