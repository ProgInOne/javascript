import type { RunPlan, RunResult } from '@proginone/shared';
import type { z } from 'zod';

/** All type IDs from docs/design/content-and-exercises.md#유형-목록과-우선순위. */
export const EXERCISE_TYPE_IDS = [
  'mcq_single',
  'mcq_multi',
  'true_false',
  'fill_blank',
  'predict_output',
  'parsons',
  'find_bug_line',
  'implement_function',
  'fix_bug',
  'web_task',
  'matching',
  'trace_variables',
  'find_false_statement',
  'order_execution',
  'explain_code',
  'refactor',
] as const;
export type ExerciseTypeId = (typeof EXERCISE_TYPE_IDS)[number];

/** Evidence category (glossary `ExerciseCategory`, learning-engine.md W_type). */
export const EXERCISE_CATEGORIES = ['recognition', 'recall', 'production'] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

/** Attempt outcome stored in `attempts.outcome` (data-model.md). */
export type GradeOutcome = 'correct' | 'partial' | 'incorrect' | 'error';

export interface FeedbackItem {
  level: 'success' | 'error' | 'warning' | 'info';
  /** Stable machine code (e.g. `MCQ_WRONG_OPTION`). UIs may branch on it. */
  code: string;
  /** Korean display text. Never contains hidden expected values. */
  message: string;
  /** What the item refers to: blank ID, output line (1-based), check ID, milestone ID. */
  target?: string;
  /** Requirement name when the item comes from a check with `requirement`. */
  requirement?: string;
}

/** Why a check failed (`CheckResult.reason`). */
export type CheckFailReason =
  | 'MISMATCH'
  | 'MISSING_IDENTIFIER'
  | 'NOT_CALLABLE'
  | 'THREW'
  | 'DID_NOT_THROW'
  | 'MUTATED_ARGS'
  | 'SAME_REFERENCE'
  | 'CIRCULAR_VALUE'
  | 'TRUNCATED_VALUE'
  | 'NOT_FOUND'
  | 'INVALID_SELECTOR'
  | 'NOT_OBSERVED'
  | 'STEP_TIMEOUT'
  | 'STEP_ERROR'
  | 'VIOLATION'
  | 'RUN_FAILED';

export interface CheckResult {
  id: string;
  kind: string;
  passed: boolean;
  required: boolean;
  weight: number;
  visible: boolean;
  description?: string;
  requirement?: string;
  reason?: CheckFailReason;
  /** Expected/actual summary. Present only for visible checks (hidden expectations stay server-side). */
  detail?: { path?: string; expected?: string; actual?: string };
  misconceptionId?: string;
}

export interface MilestoneResult {
  id: string;
  title: string;
  passed: boolean;
}

/**
 * Grader output. Extends the doc's `GradeResult` with the fields the server stores in
 * `attempts` (`outcome`, `engineApplicable`, grader version) and the learning engine reads.
 */
export interface GradeResult {
  /** Binary verdict that counts as "correct" for mastery. */
  correct: boolean;
  outcome: GradeOutcome;
  /** 0..1 partial score (feedback and statistics). */
  score: number;
  feedback: FeedbackItem[];
  /** Misconceptions suggested by this answer, deduplicated, in discovery order. */
  misconceptionIds: string[];
  checkResults?: CheckResult[];
  /** Requirement names with at least one failed check, in check order. */
  failedRequirements?: string[];
  milestones?: MilestoneResult[];
  /** False when the sandbox itself failed (`crashed`/`aborted`): record, but do not feed the engine. */
  engineApplicable: boolean;
  /** `<typeId>@<version>`, stored in `attempts.grading_json`. */
  graderVersion: string;
}

/** Findings the server computes outside the sandbox (acorn `static`, html-validate `html-valid`). */
export type ServerFindings = Readonly<
  Record<string, { passed: boolean; messages?: readonly string[] }>
>;

export interface GradeInput<Spec, Answer> {
  spec: Spec;
  answer: Answer;
  /** Sandbox result, already validated with `parseRunResult`. Required by run-based types. */
  run?: RunResult;
  serverFindings?: ServerFindings;
}

export interface RedactOptions {
  /** Seed for deterministic option shuffling (the attempt or practice-set item ID). */
  shuffleSeed?: string;
}

export interface RunPlanOptions {
  /** `interactive` (실행 button) includes visible checks only. */
  purpose: 'interactive' | 'grading' | 'verification';
}

export interface VerifyIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
}

/**
 * One exercise type plugin (docs/design/content-and-exercises.md#문제-유형-레지스트리).
 * Pure: no I/O, deterministic.
 */
export interface ExerciseTypeDef<Spec, PublicSpec, Answer> {
  id: ExerciseTypeId;
  /** Spec schema version. */
  version: number;
  category: ExerciseCategory;
  weightOverride?: number;
  specSchema: z.ZodType<Spec>;
  publicSpecSchema: z.ZodType<PublicSpec>;
  answerSchema: z.ZodType<Answer>;
  /** Whether grading this spec needs a sandbox `RunResult`. */
  requiresRun(spec: Spec): boolean;
  /** Removes answer keys. The result is safe to send to the web app. */
  redact(spec: Spec, options?: RedactOptions): PublicSpec;
  /** Run plan for the sandbox (types that execute learner code). */
  buildRunPlan?(spec: Spec, answer: Answer, options: RunPlanOptions): RunPlan;
  grade(input: GradeInput<Spec, Answer>): GradeResult;
  /** Static content checks (build and AI-generation validation). Execution checks live in content-cli. */
  verify(spec: Spec): VerifyIssue[];
  /**
   * Answer-leak fingerprints (correct option text, accepted answers, expected output, key lines of
   * the reference solution), normalized with `normalizeLeakText`. Server only; stored in
   * `exercises.leak_fingerprints_json` for the AI hint post-check (ai-system.md).
   */
  leakFingerprints(spec: Spec): string[];
}
