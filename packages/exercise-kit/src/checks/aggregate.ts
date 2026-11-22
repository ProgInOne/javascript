import type { RunResult } from '@proginone/run-contract';

import type {
  CheckFailReason,
  CheckResult,
  FeedbackItem,
  MilestoneResult,
  ServerFindings,
} from '../core/types.ts';
import { evaluateChecks } from './evaluate.ts';
import type { Check } from './schema.ts';

/**
 * Check-weighted partial score (docs/design/content-and-exercises.md#implement_function-함수-구현):
 * `score = Σ weight(passed) / Σ weight(all)`, `correct` = every required check passed (and every
 * milestone, when present). Feedback groups failures by `requirement`.
 */

export interface Milestone {
  id: string;
  title: string;
  checks: string[];
}

export interface CheckGrade {
  correct: boolean;
  score: number;
  checkResults: CheckResult[];
  failedRequirements: string[];
  feedback: FeedbackItem[];
  misconceptionIds: string[];
  milestones?: MilestoneResult[];
}

export interface GradeChecksInput {
  checks: readonly Check[];
  run: RunResult;
  serverFindings?: ServerFindings;
  milestones?: readonly Milestone[];
  /** Function name for "함수를 찾을 수 없습니다" feedback. */
  entry?: string;
}

export function gradeChecks(input: GradeChecksInput): CheckGrade {
  const checkResults = evaluateChecks(input.checks, {
    run: input.run,
    ...(input.serverFindings === undefined ? {} : { serverFindings: input.serverFindings }),
  });
  const totalWeight = checkResults.reduce((sum, r) => sum + r.weight, 0);
  const passedWeight = checkResults.reduce((sum, r) => sum + (r.passed ? r.weight : 0), 0);
  const score = totalWeight === 0 ? 0 : passedWeight / totalWeight;
  const failed = checkResults.filter((r) => !r.passed);

  const failedRequirements = [
    ...new Set(failed.flatMap((r) => (r.requirement === undefined ? [] : [r.requirement]))),
  ];

  let milestones: MilestoneResult[] | undefined;
  if (input.milestones) {
    const byId = new Map(checkResults.map((r) => [r.id, r]));
    milestones = input.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      passed: m.checks.every(
        (id) => byId.get(id)?.passed === true || byId.get(id)?.required === false,
      ),
    }));
  }
  const correct =
    checkResults.every((r) => r.passed || !r.required) &&
    (milestones?.every((m) => m.passed) ?? true);

  return {
    correct,
    score,
    checkResults,
    failedRequirements,
    feedback: buildFeedback(checkResults, failedRequirements, milestones, input.entry),
    misconceptionIds: failed.flatMap((r) =>
      r.misconceptionId === undefined ? [] : [r.misconceptionId],
    ),
    ...(milestones === undefined ? {} : { milestones }),
  };
}

const REASON_MESSAGES: Partial<Record<CheckFailReason, string>> = {
  NOT_CALLABLE: '함수가 아닌 값입니다.',
  DID_NOT_THROW: '오류가 발생해야 하는데 발생하지 않았습니다.',
  MUTATED_ARGS: '입력으로 받은 값을 바꾸면 안 됩니다.',
  SAME_REFERENCE: '입력과 다른 새 값을 반환해야 합니다.',
  CIRCULAR_VALUE: '반환값에 순환 참조가 있어 비교할 수 없습니다.',
  TRUNCATED_VALUE: '값이 너무 커서 비교할 수 없습니다.',
  NOT_FOUND: '대상 요소를 찾을 수 없습니다.',
  NOT_OBSERVED: '실행 결과에서 이 항목을 확인하지 못했습니다.',
  STEP_TIMEOUT: '이 항목을 확인하다가 시간이 초과되었습니다.',
  STEP_ERROR: '이 항목을 확인하는 중 오류가 발생했습니다.',
};

function checkMessage(result: CheckResult, entry: string | undefined): string {
  if (result.reason === 'MISSING_IDENTIFIER') {
    return entry === undefined
      ? '필요한 이름을 찾을 수 없습니다.'
      : `함수 \`${entry}\`를 찾을 수 없습니다.`;
  }
  if (result.reason === 'THREW') return '실행 중 오류가 발생했습니다.';
  const base = result.description ?? '체크를 통과하지 못했습니다.';
  const hint = result.reason === undefined ? undefined : REASON_MESSAGES[result.reason];
  return hint && result.description !== undefined ? `${base} ${hint}` : (hint ?? base);
}

function buildFeedback(
  results: readonly CheckResult[],
  failedRequirements: readonly string[],
  milestones: readonly MilestoneResult[] | undefined,
  entry: string | undefined,
): FeedbackItem[] {
  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) {
    return [{ level: 'success', code: 'ALL_CHECKS_PASSED', message: '모든 체크를 통과했습니다.' }];
  }
  const items: FeedbackItem[] = failedRequirements.map((requirement) => ({
    level: 'error',
    code: 'REQUIREMENT_FAILED',
    message: `요구사항 "${requirement}"을(를) 아직 만족하지 못했습니다.`,
    requirement,
  }));
  for (const result of failed) {
    const item: FeedbackItem = {
      level: result.required ? 'error' : 'info',
      code: result.required ? 'CHECK_FAILED' : 'OPTIONAL_CHECK_FAILED',
      message: checkMessage(result, entry),
      target: result.id,
    };
    if (result.requirement !== undefined) item.requirement = result.requirement;
    items.push(item);
  }
  for (const m of milestones ?? []) {
    items.push({
      level: m.passed ? 'success' : 'info',
      code: m.passed ? 'MILESTONE_PASSED' : 'MILESTONE_PENDING',
      message: m.passed ? `"${m.title}" 단계를 완료했습니다.` : `"${m.title}" 단계가 남았습니다.`,
      target: m.id,
    });
  }
  return items;
}

/** Feedback for a run that did not complete normally. Learner-code messages only (no expected values). */
export function runFeedback(run: RunResult): FeedbackItem[] {
  const syntax = run.errors.find((e) => e.phase === 'syntax');
  const at = (e: { position?: { file: string; line: number } | undefined }) =>
    e.position ? ` (${e.position.file} ${e.position.line}번째 줄)` : '';
  switch (run.status) {
    case 'completed':
      return [];
    case 'error':
      if (syntax) {
        return [
          {
            level: 'error',
            code: 'RUN_SYNTAX_ERROR',
            message: `문법 오류: ${syntax.message}${at(syntax)}`,
          },
        ];
      }
      return run.errors.slice(0, 1).map((e) => ({
        level: 'error',
        code: 'RUN_RUNTIME_ERROR',
        message: `${e.name}: ${e.message}${at(e)}`,
      }));
    case 'timeout':
      return [
        {
          level: 'error',
          code: 'RUN_TIMEOUT',
          message: '실행 시간이 너무 깁니다. 끝나지 않는 반복이나 대기가 있는지 확인해 보세요.',
        },
      ];
    case 'loop_limit': {
      const loop = run.errors.find((e) => e.phase === 'loop_limit');
      return [
        {
          level: 'error',
          code: 'RUN_LOOP_LIMIT',
          message: `반복문이 너무 오래 실행되어 멈췄습니다${loop ? at(loop) : ''}.`,
        },
      ];
    }
    case 'crashed':
    case 'aborted':
      return [
        {
          level: 'warning',
          code: 'RUN_SANDBOX_FAILED',
          message: '실행 환경 문제로 채점하지 못했습니다. 학습 기록에는 반영하지 않습니다.',
        },
      ];
  }
}
