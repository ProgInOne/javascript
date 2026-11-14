import type { RunStatus } from '@proginone/shared';

import type {
  CheckResult,
  ExerciseTypeId,
  FeedbackItem,
  GradeOutcome,
  GradeResult,
  MilestoneResult,
} from './types.ts';

export interface ResultParts {
  typeId: ExerciseTypeId;
  version: number;
  correct: boolean;
  score: number;
  feedback?: FeedbackItem[];
  misconceptionIds?: readonly (string | null | undefined)[];
  checkResults?: CheckResult[];
  failedRequirements?: string[];
  milestones?: MilestoneResult[];
  /** Sandbox status when the type executed code. */
  runStatus?: RunStatus;
}

const LEARNER_RUN_FAILURES: ReadonlySet<RunStatus> = new Set(['error', 'timeout', 'loop_limit']);
const SANDBOX_FAILURES: ReadonlySet<RunStatus> = new Set(['crashed', 'aborted']);

/**
 * Assembles a {@link GradeResult}: clamps the score, derives `outcome`, deduplicates
 * misconceptions and marks sandbox failures as not engine-applicable (learning-engine.md#관측값).
 */
export function buildResult(parts: ResultParts): GradeResult {
  const score = clamp01(parts.score);
  const runStatus = parts.runStatus;
  const runFailed =
    runStatus !== undefined &&
    (LEARNER_RUN_FAILURES.has(runStatus) || SANDBOX_FAILURES.has(runStatus));
  const correct = parts.correct && !runFailed;
  let outcome: GradeOutcome;
  if (runFailed) outcome = 'error';
  else if (correct) outcome = 'correct';
  else outcome = score > 0 ? 'partial' : 'incorrect';

  const result: GradeResult = {
    correct,
    outcome,
    score,
    feedback: parts.feedback ?? [],
    misconceptionIds: dedupe(parts.misconceptionIds ?? []),
    engineApplicable: runStatus === undefined || !SANDBOX_FAILURES.has(runStatus),
    graderVersion: `${parts.typeId}@${parts.version}`,
  };
  if (parts.checkResults) result.checkResults = parts.checkResults;
  if (parts.failedRequirements) result.failedRequirements = parts.failedRequirements;
  if (parts.milestones) result.milestones = parts.milestones;
  return result;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function dedupe(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) if (value) seen.add(value);
  return [...seen];
}
