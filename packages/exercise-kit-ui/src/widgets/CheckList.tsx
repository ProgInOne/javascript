import type { CheckFailReason, CheckResult, PublicCheck } from '@proginone/exercise-kit';
import { Badge } from '@proginone/ui';
import { Check, Circle, EyeOff, X } from 'lucide-react';
import { useId } from 'react';
import { InlineText } from '@proginone/exercise-ui';
import { checkSummary, checkTitle } from './describe-check.ts';

export interface CheckListMilestone {
  id: string;
  title: string;
  checks: readonly string[];
}

export interface CheckListProps {
  /** Public checks from the redacted spec (hidden checks carry only metadata). */
  checks: readonly PublicCheck[];
  /** Per-check results from `GradeResult.checkResults` or quick feedback (`gradeChecks`). */
  results?: readonly CheckResult[] | null;
  /** Function name `call` checks invoke, for the summary line. */
  entry?: string;
  /** Section title. Default "테스트". */
  title?: string;
  /** Groups checks into project milestones (`web_task`). */
  milestones?: readonly CheckListMilestone[];
  /** Heading level of the title. Default 3. */
  headingLevel?: 2 | 3 | 4;
}

/** Learner-facing failure reasons. Expected values of hidden checks are never shown. */
export const CHECK_FAIL_REASON_LABELS: Readonly<Record<CheckFailReason, string>> = {
  MISMATCH: '결과가 기대와 달라요.',
  MISSING_IDENTIFIER: '함수나 변수를 찾을 수 없어요.',
  NOT_CALLABLE: '함수가 아니라서 호출할 수 없어요.',
  THREW: '실행 중에 오류가 났어요.',
  DID_NOT_THROW: '오류가 나야 하는데 나지 않았어요.',
  MUTATED_ARGS: '전달받은 값을 바꿨어요.',
  SAME_REFERENCE: '새 값이 아니라 원래 값을 그대로 돌려줬어요.',
  CIRCULAR_VALUE: '순환 참조가 있는 값이라 비교할 수 없어요.',
  TRUNCATED_VALUE: '값이 너무 커서 비교할 수 없어요.',
  NOT_FOUND: '해당 요소를 찾을 수 없어요.',
  INVALID_SELECTOR: '선택자를 해석할 수 없어요.',
  NOT_OBSERVED: '결과를 확인하지 못했어요.',
  STEP_TIMEOUT: '시간 안에 끝나지 않았어요.',
  STEP_ERROR: '확인하는 중에 오류가 났어요.',
  VIOLATION: '규칙을 지키지 않았어요.',
  RUN_FAILED: '코드 실행이 실패해서 확인하지 못했어요.',
};

/** `reason` is an open string in @proginone/exercise-core; unknown codes show as is. */
export function checkFailReasonLabel(reason: string): string {
  const labels: Readonly<Record<string, string | undefined>> = CHECK_FAIL_REASON_LABELS;
  return labels[reason] ?? reason;
}

type RowStatus = 'pending' | 'passed' | 'failed';

/**
 * Requirement / test list (TestResultList in docs/design/ui-ux.md#학습-특화-컴포넌트). Before a run
 * every row is pending; with results, failures come first. Visible checks show their input and
 * expectation, hidden checks only their description. Status is icon + text, never color alone.
 */
export function CheckList({
  checks,
  results,
  entry,
  title = '테스트',
  milestones,
  headingLevel = 3,
}: CheckListProps) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  const byId = new Map((results ?? []).map((r) => [r.id, r]));
  const hasResults = results !== undefined && results !== null && results.length > 0;
  const passed = checks.filter((c) => byId.get(c.id)?.passed === true).length;

  const renderRows = (subset: readonly PublicCheck[]) => {
    const ordered = hasResults
      ? [...subset].sort((a, b) => rank(byId.get(a.id)) - rank(byId.get(b.id)))
      : subset;
    return (
      <ul className="pi-ex-checks__list">
        {ordered.map((check) => (
          <CheckRow key={check.id} check={check} result={byId.get(check.id)} entry={entry} />
        ))}
      </ul>
    );
  };

  const grouped = milestones && milestones.length > 0;
  const inMilestone = new Set(milestones?.flatMap((m) => m.checks) ?? []);

  return (
    <section className="pi-ex-checks" aria-labelledby={headingId}>
      <div className="pi-ex-checks__header">
        <Heading id={headingId} className="pi-ex-checks__title">
          {title}
        </Heading>
        <p className="pi-ex-checks__summary" role="status">
          {hasResults ? `${checks.length}개 중 ${passed}개 통과` : `${checks.length}개`}
        </p>
      </div>
      {grouped ? (
        <>
          {milestones.map((milestone, index) => {
            const subset = checks.filter((c) => milestone.checks.includes(c.id));
            const done = hasResults && subset.every((c) => byId.get(c.id)?.passed === true);
            return (
              <div key={milestone.id} className="pi-ex-checks__milestone">
                <p className="pi-ex-checks__milestone-title">
                  {index + 1}단계 · {milestone.title}
                  {done && (
                    <Badge variant="success" icon={<Check size={14} />}>
                      완료
                    </Badge>
                  )}
                </p>
                {renderRows(subset)}
              </div>
            );
          })}
          {checks.some((c) => !inMilestone.has(c.id)) &&
            renderRows(checks.filter((c) => !inMilestone.has(c.id)))}
        </>
      ) : (
        renderRows(checks)
      )}
    </section>
  );
}

function rank(result: CheckResult | undefined): number {
  if (!result) return 1;
  return result.passed ? 2 : 0;
}

function CheckRow({
  check,
  result,
  entry,
}: {
  check: PublicCheck;
  result: CheckResult | undefined;
  entry: string | undefined;
}) {
  const status: RowStatus = result ? (result.passed ? 'passed' : 'failed') : 'pending';
  const summary = checkSummary(check, entry);
  const detail = result && !result.passed && check.visible ? result.detail : undefined;
  const reason = result && !result.passed && result.reason ? result.reason : undefined;

  return (
    <li className="pi-ex-checks__row" data-status={status}>
      <StatusIcon status={status} />
      <div className="pi-ex-checks__body">
        <p className="pi-ex-checks__name">
          <span>
            <InlineText text={checkTitle(check)} />
          </span>
          {!check.visible && (
            <Badge icon={<EyeOff size={14} />} title="입력과 기대값은 채점 후에도 공개하지 않아요">
              숨김
            </Badge>
          )}
          {!check.required && <Badge variant="brand">추가 도전</Badge>}
        </p>
        {summary !== null && (
          <pre className="pi-ex-checks__summary-code">
            <code>{summary}</code>
          </pre>
        )}
        {reason && <p className="pi-ex-checks__reason">{checkFailReasonLabel(reason)}</p>}
        {detail && (detail.expected !== undefined || detail.actual !== undefined) && (
          <details className="pi-ex-checks__detail">
            <summary>기대값과 실제값 보기</summary>
            <dl>
              {detail.path !== undefined && detail.path !== '' && (
                <>
                  <dt>위치</dt>
                  <dd>
                    <code>{detail.path}</code>
                  </dd>
                </>
              )}
              {detail.expected !== undefined && (
                <>
                  <dt>기대</dt>
                  <dd>
                    <code>{detail.expected}</code>
                  </dd>
                </>
              )}
              {detail.actual !== undefined && (
                <>
                  <dt>실제</dt>
                  <dd>
                    <code>{detail.actual}</code>
                  </dd>
                </>
              )}
            </dl>
          </details>
        )}
      </div>
    </li>
  );
}

const STATUS_TEXT: Readonly<Record<RowStatus, string>> = {
  pending: '실행 전',
  passed: '통과',
  failed: '실패',
};

function StatusIcon({ status }: { status: RowStatus }) {
  const Icon = status === 'passed' ? Check : status === 'failed' ? X : Circle;
  return (
    <span className="pi-ex-checks__status">
      <Icon size={16} aria-hidden="true" />
      <span className="sr-only">{STATUS_TEXT[status]}: </span>
    </span>
  );
}
