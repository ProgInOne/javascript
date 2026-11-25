import { CONFIDENCE_LABELS } from '@proginone/exercise-kit-ui';
import type { PracticeReviewItem, PracticeSetView } from '@proginone/shared';
import { Badge, Button } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { Check, Lock, Minus, X } from 'lucide-react';
import { practiceSetReviewQuery } from '../../api/queries.ts';
import { useStartSet } from '../dashboard/useStartSet.ts';
import { RetryButtons } from '../review/MistakeNotes.tsx';
import { Markdown } from './Markdown.tsx';
import { TYPE_LABELS } from './model.ts';
import { ExerciseCode, SolutionContent } from './parts.tsx';

const OUTCOME = {
  correct: { label: '정답', Icon: Check, variant: 'success' },
  partial: { label: '부분 정답', Icon: X, variant: 'warning' },
  wrong: { label: '오답', Icon: X, variant: 'error' },
  skipped: { label: '건너뜀', Icon: Minus, variant: 'neutral' },
} as const;

type OutcomeKey = keyof typeof OUTCOME;

function outcomeOf(item: PracticeReviewItem): OutcomeKey {
  if (!item.last) return 'skipped';
  if (item.last.outcome === 'correct') return 'correct';
  return item.last.outcome === 'partial' ? 'partial' : 'wrong';
}

/** "2번째에 정답", "시도 3번" — how the item went, beside the badge. */
function attemptsNote(item: PracticeReviewItem, outcome: OutcomeKey): string | null {
  // Answered, then skipped: the badge shows the last answer, so say it was skipped after all.
  const skippedAfter = item.status === 'skipped' && item.last !== null;
  const count =
    item.attempts <= 1
      ? null
      : outcome === 'correct'
        ? `${item.attempts}번째에 정답`
        : `시도 ${item.attempts}번`;
  const parts = [count, skippedAfter ? '건너뜀' : null].filter((p) => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * "푼 문제 돌아보기" (D-098) under a finished set's summary: every item with the learner's last
 * answer, the feedback and explanation they saw, and the reference answer only if they opened it
 * (D-044). Items not answered correctly start open, as on the assessment result.
 */
export function SetReview({ set }: { set: PracticeSetView }) {
  const enabled = set.status === 'completed' && set.kind !== 'assessment' && set.items.length > 0;
  const query = useQuery({ ...practiceSetReviewQuery(set.id), enabled });
  const start = useStartSet();
  if (!enabled) return null;

  return (
    <div className="set-summary__block set-review">
      <h3 className="set-summary__subtitle" id="set-review-title">
        푼 문제 돌아보기
      </h3>
      {query.isPending ? (
        <p className="m-0 text-fg-secondary type-small" role="status">
          푼 문제를 불러오는 중이에요…
        </p>
      ) : query.isError ? (
        <div className="set-review__error" role="alert">
          <p className="m-0 text-fg-secondary type-small">푼 문제를 불러오지 못했어요.</p>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            다시 시도
          </Button>
        </div>
      ) : (
        <>
          {start.error && (
            <p role="alert" className="practice-error">
              {start.error.message}
            </p>
          )}
          <ol className="assessment-result__items" aria-labelledby="set-review-title">
            {query.data.items.map((item, i) => (
              <ReviewItem key={item.itemId} item={item} number={i + 1} start={start} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function ReviewItem({
  item,
  number,
  start,
}: {
  item: PracticeReviewItem;
  number: number;
  start: ReturnType<typeof useStartSet>;
}) {
  const outcome = outcomeOf(item);
  const state = OUTCOME[outcome];
  const note = attemptsNote(item, outcome);
  const missed = outcome === 'wrong' || outcome === 'partial';
  const last = item.last;
  const titleId = `set-review-item-${item.itemId}`;
  return (
    <li>
      <details open={missed} className="assessment-item">
        <summary id={titleId}>
          <span className="assessment-item__number">문제 {number}</span>
          <Badge variant={state.variant} icon={<state.Icon size={12} />}>
            {state.label}
          </Badge>
          <span className="text-fg-secondary type-small">
            {TYPE_LABELS[item.type] ?? '보관된 문제'}
            {item.concept && ` · ${item.concept.title}`}
            {note && ` · ${note}`}
          </span>
        </summary>
        <div className="assessment-item__body">
          {item.prompt ? (
            <Markdown text={item.prompt} />
          ) : (
            <p className="text-fg-secondary">이 문제는 지금 콘텐츠에서 빠졌어요.</p>
          )}
          <ExerciseCode view={{ code: item.code, codeLanguage: item.codeLanguage }} />

          <h4 className="assessment-item__label">내 답</h4>
          {last ? (
            <>
              {last.answer.kind === 'none' ? (
                <p className="m-0 text-fg-secondary">이 답은 지금 화면에서 보여 줄 수 없어요.</p>
              ) : (
                <div className="mistake-detail__answer set-review__answer" data-outcome={outcome}>
                  <SolutionContent solution={last.answer} />
                </div>
              )}
              {last.confidence && (
                <p className="m-0 text-fg-tertiary type-small">
                  확신도: {CONFIDENCE_LABELS[last.confidence]}
                  {last.solutionViewed && ' · 정답을 본 뒤 제출'}
                </p>
              )}
              {last.misconceptions.length > 0 && (
                <p className="mistake-item__misconception">
                  고른 답이 가리키는 오개념: {last.misconceptions.map((m) => m.title).join(', ')}
                </p>
              )}
              {last.feedback.length > 0 && (
                <ul className="mistake-detail__feedback" aria-label="채점 피드백">
                  {last.feedback.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="m-0 text-fg-secondary">답하지 않고 건너뛴 문제예요.</p>
          )}

          {item.explanation !== null && (
            <>
              <h4 className="assessment-item__label">해설</h4>
              {item.explanation ? (
                <Markdown text={item.explanation} />
              ) : (
                <p className="m-0 text-fg-secondary">해설이 없어요.</p>
              )}
            </>
          )}

          {(missed || item.solution !== null || !last) && (
            <>
              <h4 className="assessment-item__label">정답</h4>
              {item.solution ? (
                <SolutionContent solution={item.solution} />
              ) : (
                <p className="mistake-detail__locked">
                  <Lock size={16} aria-hidden="true" />
                  정답은 다시 풀면서 확인해요. 힌트를 끝까지 열면 정답을 볼 수 있어요.
                </p>
              )}
            </>
          )}

          {outcome !== 'correct' && (
            <div className="set-review__actions">
              <RetryButtons note={item} start={start} describedBy={titleId} />
            </div>
          )}
        </div>
      </details>
    </li>
  );
}
