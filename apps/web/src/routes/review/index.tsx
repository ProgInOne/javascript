import type { ReviewQueue } from '@proginone/shared';
import { Button, EmptyState } from '@proginone/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { CalendarCheck } from 'lucide-react';
import { useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { createPracticeSet, practiceSetQuery, reviewQueueQuery } from '../../api/queries.ts';
import { cardClass, pageClass, pageTitleClass } from '../../app/layout.ts';
import { QueryState } from '../../app/QueryState.tsx';
import { formatMinutes } from '../../lib/format.ts';

export const Route = createFileRoute('/review/')({
  component: ReviewPage,
});

/** 복습 허브, 오늘의 복습 (ui-ux.md 복습 화면). */
function ReviewPage() {
  const query = useQuery(reviewQueueQuery);
  return (
    <div className={pageClass}>
      <h1 className={pageTitleClass}>복습</h1>
      <QueryState query={query} notFoundTitle="복습을 찾을 수 없어요">
        {(queue) => <TodayReview queue={queue} />}
      </QueryState>
    </div>
  );
}

function NothingDue() {
  return (
    <EmptyState
      icon={CalendarCheck}
      title="오늘 복습할 개념이 없어요"
      description="연습한 개념은 잊을 즈음 다시 여기에 나와요. 새 단원을 학습해 보세요."
      action={
        <Link to="/courses" className="pi-button pi-button--secondary pi-button--md no-underline">
          과정 보기
        </Link>
      }
    />
  );
}

function TodayReview({ queue }: { queue: ReviewQueue }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  if (queue.due.length === 0 || error?.code === 'PRACTICE_NOTHING_DUE') return <NothingDue />;

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const set = await createPracticeSet({ kind: 'review' });
      client.setQueryData(practiceSetQuery(set.id).queryKey, set);
      const next = set.items.findIndex((i) => i.id === set.nextItemId);
      await navigate({
        to: '/review/session/$setId',
        params: { setId: set.id },
        search: { i: next >= 0 ? next + 1 : 1 },
      });
    } catch (e) {
      setError(
        e instanceof ApiRequestError
          ? e
          : new ApiRequestError('INTERNAL', '복습을 준비하지 못했어요.', 0, true),
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className={cardClass} aria-labelledby="today-review-title">
        <h2 id="today-review-title" className="mb-1 type-h3 text-heading">
          오늘 복습할 개념 {queue.due.length}개 · 약{' '}
          {formatMinutes(Math.ceil(queue.estimatedMinutes))}
        </h2>
        {queue.deferred.length > 0 && (
          <p className="mb-2 text-fg-secondary type-small">
            오늘은 {queue.due.length}개만 할게요. 나머지 {queue.deferred.length}개는 내일로
            나눠둘게요.
          </p>
        )}
        <ul className="my-4 grid list-none gap-2 p-0">
          {queue.due.map((entry) => (
            <li key={entry.conceptId} className="flex items-center justify-between gap-3">
              <span className="text-fg">{entry.title}</span>
              <span className="text-fg-tertiary type-small">
                {entry.overdue ? `${entry.overdueDays}일 지남` : '오늘'}
              </span>
            </li>
          ))}
        </ul>
        <p className="mb-4 text-fg-secondary type-small">
          섞여 나와서 조금 어렵게 느껴질 수 있어요. 그게 효과가 있다는 신호예요.
        </p>
        {error && (
          <p role="alert" className="practice-error mb-4">
            {error.message}
          </p>
        )}
        <Button variant="primary" loading={starting} onClick={() => void start()}>
          복습 시작
        </Button>
      </section>
      <aside className={cardClass} aria-labelledby="why-review-title">
        <h2 id="why-review-title" className="mb-2 font-semibold text-heading type-body">
          복습이 효과적인 이유
        </h2>
        <p className="text-fg-secondary type-small">
          잊을 즈음 다시 떠올리면 더 오래 기억해요. 여러 개념이 섞여 나와 어렵게 느껴지는 게
          정상이에요.
        </p>
      </aside>
    </div>
  );
}
