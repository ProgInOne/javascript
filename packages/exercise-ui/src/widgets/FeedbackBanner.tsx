import type { CheckResult, FeedbackItem, GradeResult } from '@proginone/exercise-kit';
import { AlertTriangle, BookOpen, CheckCircle2, CircleDot, XCircle } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { Confidence } from '../types.ts';
import { checkFailReasonLabel } from './CheckList.tsx';
import { CHECK_KIND_LABELS, isCheckKind } from './describe-check.ts';

/** Misconception suggested by the answer, resolved to display text by the caller. */
export interface MisconceptionInfo {
  id: string;
  /** Short name, e.g. "출력과 반환값 혼동". */
  name: string;
  description?: string;
  /** Link or button to the related lesson section ("관련 레슨 보기"). */
  action?: ReactNode;
}

export type FeedbackResult = Pick<
  GradeResult,
  'outcome' | 'score' | 'feedback' | 'checkResults' | 'failedRequirements' | 'milestones'
>;

export interface FeedbackBannerProps {
  /**
   * Grading result. Keep the banner mounted with `null` before the first submission so the live
   * region exists before its content changes (screen readers then announce the result).
   */
  result: FeedbackResult | null;
  /** Confidence the learner chose when submitting; tailors the message (ui-ux.md table). */
  confidence?: Confidence | null;
  /** Misconceptions for `result.misconceptionIds`, with names resolved from content. */
  misconceptions?: readonly MisconceptionInfo[];
  /** Explanation shown after grading (collapsible; opened by default when confidence was a guess). */
  explanation?: ReactNode;
  /** Next actions (다시 풀기, 다음 문제). Placed so they are one Tab away from the submit button. */
  actions?: ReactNode;
  /** Heading level of the title. Default 3. */
  headingLevel?: 2 | 3 | 4;
}

type Outcome = GradeResult['outcome'];

const OUTCOME_TITLES: Readonly<Record<Outcome, string>> = {
  correct: '정답이에요.',
  partial: '부분 정답이에요.',
  incorrect: '정답이 아니에요.',
  error: '코드를 끝까지 실행하지 못했어요.',
};

/** Confidence-specific follow-up (docs/design/ui-ux.md#확신도-입력-타이밍). */
function confidenceMessage(outcome: Outcome, confidence: Confidence | null): string | null {
  if (outcome === 'correct') {
    if (confidence === 'unsure') return '근거를 한 번 더 확인해볼까요?';
    if (confidence === 'guess') return '맞혔지만 찍었다고 했죠. 해설을 꼭 확인해보세요.';
    return null;
  }
  if (outcome === 'error') return '오류 내용을 확인하고 고친 뒤 다시 실행해 보세요.';
  if (confidence === 'sure') return '확신했는데 아니었네요. 이런 순간이 가장 잘 기억에 남아요.';
  if (confidence === 'guess') return '괜찮아요. 해설부터 보고 다시 풀어봐요.';
  if (confidence === 'unsure') return '아쉬워요. 힌트를 보거나 다시 풀어볼 수 있어요.';
  return '힌트를 보거나 다시 풀어볼 수 있어요.';
}

function partialMessage(result: FeedbackResult): string {
  const checks = result.checkResults;
  if (checks && checks.length > 0) {
    const passed = checks.filter((c) => c.passed).length;
    return `테스트 ${checks.length}개 중 ${passed}개를 통과했어요. 실패한 테스트를 확인해 보세요.`;
  }
  return '일부만 맞았어요. 표시된 부분을 확인해 보세요.';
}

/**
 * Feedback items to list in the banner. Items that target a blank or a check are shown next to
 * that blank or check by the renderer / CheckList, so only general and line-level items stay.
 */
function bannerItems(items: readonly FeedbackItem[]): FeedbackItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.level === 'success') return false;
    if (item.target !== undefined && !/^\d+$/.test(item.target)) return false;
    const key = `${item.target ?? ''}|${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Grading result banner (FeedbackBanner in ui-ux.md): icon + title + why + what next.
 * `role="status"`, not `alert`, so wrong answers are not announced aggressively.
 */
export function FeedbackBanner({
  result,
  confidence = null,
  misconceptions = [],
  explanation,
  actions,
  headingLevel = 3,
}: FeedbackBannerProps) {
  const titleId = useId();
  if (!result) return <div role="status" className="pi-ex-feedback-region" />;

  const { outcome } = result;
  const Heading = `h${headingLevel}` as const;
  const Icon =
    outcome === 'correct'
      ? CheckCircle2
      : outcome === 'partial'
        ? CircleDot
        : outcome === 'error'
          ? AlertTriangle
          : XCircle;
  const lead = outcome === 'partial' ? partialMessage(result) : null;
  // The partial lead already says what to do next; only add a confidence-specific line.
  const follow =
    outcome === 'partial' && confidence === null ? null : confidenceMessage(outcome, confidence);
  const items = bannerItems(result.feedback);
  const failedChecks = (result.checkResults ?? []).filter((c) => !c.passed);
  const milestones = result.milestones ?? [];
  const wrong = outcome !== 'correct';
  const explanationOpen =
    confidence === 'guess' || (outcome === 'correct' && confidence === 'unsure');

  return (
    <div role="status" className="pi-ex-feedback-region">
      <section className="pi-ex-feedback" data-outcome={outcome} aria-labelledby={titleId}>
        <div className="pi-ex-feedback__head">
          <Icon className="pi-ex-feedback__icon" size={20} aria-hidden="true" />
          <div className="pi-ex-feedback__text">
            <Heading id={titleId} className="pi-ex-feedback__title">
              {OUTCOME_TITLES[outcome]}
            </Heading>
            {lead && <p className="pi-ex-feedback__message">{lead}</p>}
            {follow && <p className="pi-ex-feedback__message">{follow}</p>}
          </div>
        </div>

        {items.length > 0 && (
          <ul className="pi-ex-feedback__items">
            {items.map((item) => (
              <li key={`${item.code}|${item.target ?? ''}|${item.message}`} data-level={item.level}>
                {item.target !== undefined && (
                  <span className="pi-ex-feedback__target">{item.target}번째 줄: </span>
                )}
                {item.message}
              </li>
            ))}
          </ul>
        )}

        {result.failedRequirements && result.failedRequirements.length > 0 && (
          <p className="pi-ex-feedback__message">
            다시 확인할 요구사항: {result.failedRequirements.join(', ')}
          </p>
        )}

        {failedChecks.length > 0 && <FailedChecks checks={failedChecks} />}

        {milestones.length > 0 && (
          <p className="pi-ex-feedback__message">
            단계 {milestones.length}개 중 {milestones.filter((m) => m.passed).length}개 완료
            {milestones.some((m) => !m.passed) &&
              ` · 다음 단계: ${milestones.find((m) => !m.passed)?.title ?? ''}`}
          </p>
        )}

        {wrong && misconceptions.length > 0 && (
          <div className="pi-ex-feedback__misconceptions">
            {misconceptions.map((m) => (
              <MisconceptionNote key={m.id} info={m} defaultOpen={confidence === 'sure'} />
            ))}
          </div>
        )}

        {explanation !== undefined && (
          <details className="pi-ex-feedback__explanation" open={explanationOpen || undefined}>
            <summary>해설 보기</summary>
            {/* A boxed panel so the explanation does not read as more toggle text (D-080). */}
            <div role="group" aria-label="해설" className="pi-ex-feedback__explanation-body">
              <p className="pi-ex-feedback__explanation-label" aria-hidden="true">
                <BookOpen size={14} />
                해설
              </p>
              {explanation}
            </div>
          </details>
        )}

        {actions && <div className="pi-ex-feedback__actions">{actions}</div>}
      </section>
    </div>
  );
}

function FailedChecks({ checks }: { checks: readonly CheckResult[] }) {
  return (
    <div className="pi-ex-feedback__checks">
      <p className="pi-ex-feedback__checks-title">실패한 테스트</p>
      <ul>
        {checks.map((check) => (
          <li key={check.id}>
            <XCircle size={14} aria-hidden="true" />
            <span>
              {check.description ??
                (isCheckKind(check.kind) ? CHECK_KIND_LABELS[check.kind] : check.kind)}
              {check.reason && (
                <span className="pi-ex-feedback__reason">
                  {' '}
                  — {checkFailReasonLabel(check.reason)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface MisconceptionNoteProps {
  info: MisconceptionInfo;
  /** Expanded initially (when the learner was sure but wrong). */
  defaultOpen?: boolean;
}

/** Misconception explanation linked to the chosen wrong answer (MisconceptionNote in ui-ux.md). */
export function MisconceptionNote({ info, defaultOpen = false }: MisconceptionNoteProps) {
  return (
    <details className="pi-ex-misconception" open={defaultOpen || undefined}>
      <summary>
        <span className="pi-ex-misconception__label">흔한 오해</span> {info.name}
      </summary>
      {info.description && <p className="pi-ex-misconception__body">{info.description}</p>}
      {info.action && <div className="pi-ex-misconception__action">{info.action}</div>}
    </details>
  );
}
