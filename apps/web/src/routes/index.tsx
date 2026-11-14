import type { Dashboard } from '@proginone/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { ArrowRight, BookOpen, History } from 'lucide-react';
import { dashboardQuery, learnerQuery } from '../api/queries.ts';
import { cardClass, pageClass, pageTitleClass } from '../app/layout.ts';
import { QueryState } from '../app/QueryState.tsx';

export const Route = createFileRoute('/')({
  // First run: the onboarding comes first (ui-ux.md#온보딩과-목표-설정). If the profile cannot be
  // loaded the dashboard opens anyway and shows its own error state.
  beforeLoad: async ({ context }) => {
    const learner = await context.queryClient
      .query({ ...learnerQuery, staleTime: 'static' })
      .catch(() => null);
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
    if (learner?.needsOnboarding) throw redirect({ to: '/onboarding' });
  },
  component: DashboardPage,
});

const button = 'pi-button pi-button--md no-underline';

/** Minimal v0.1 dashboard (ui-ux.md 대시보드): 오늘의 복습, 이어서 학습, today's minutes. */
function DashboardPage() {
  const query = useQuery(dashboardQuery);
  return (
    <div className={pageClass}>
      <h1 className={pageTitleClass}>대시보드</h1>
      <QueryState query={query} notFoundTitle="대시보드를 찾을 수 없어요">
        {(data) => <DashboardBody data={data} />}
      </QueryState>
    </div>
  );
}

const STATUS_TEXT = {
  not_started: '아직 시작 전',
  reading: '읽는 중',
  practicing: '연습 중',
  completed: '완료',
} as const;

function DashboardBody({ data }: { data: Dashboard }) {
  const reviewFirst = data.reviewDueCount > 0;
  const lesson = data.continueLesson;
  return (
    <div className="grid gap-6">
      <p className="text-fg-secondary type-body">
        {data.activeMinutesToday > 0
          ? `오늘 ${data.activeMinutesToday}분 공부했어요.`
          : '오늘의 학습을 시작해 볼까요?'}
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <section className={cardClass} aria-labelledby="review-card-title">
          <h2 id="review-card-title" className="mb-2 flex items-center gap-2 type-h3 text-heading">
            <History size={20} aria-hidden="true" />
            오늘의 복습
          </h2>
          {reviewFirst ? (
            <>
              <p className="mb-4 text-fg-secondary">
                오늘 복습할 개념이 {data.reviewDueCount}개 있어요. 잊을 즈음 다시 떠올리면 더 오래
                기억해요.
              </p>
              <Link to="/review" className={`${button} pi-button--primary`}>
                복습 시작
              </Link>
            </>
          ) : (
            <p className="text-fg-secondary">오늘 복습할 개념이 없어요.</p>
          )}
        </section>

        <section className={cardClass} aria-labelledby="continue-card-title">
          <h2
            id="continue-card-title"
            className="mb-2 flex items-center gap-2 type-h3 text-heading"
          >
            <BookOpen size={20} aria-hidden="true" />
            이어서 학습
          </h2>
          {lesson ? (
            <>
              <p className="font-semibold text-fg">{lesson.title}</p>
              <p className="mb-4 text-fg-secondary type-small">
                {STATUS_TEXT[lesson.status]}
                {lesson.status === 'reading' &&
                  ` · 본문 ${Math.round(lesson.readProgress * 100)}% 읽음`}
              </p>
              <Link
                to="/learn/$lessonId"
                params={{ lessonId: lesson.id }}
                search={
                  lesson.status === 'practicing' && lesson.practiceSetId
                    ? { mode: 'practice', set: lesson.practiceSetId }
                    : {}
                }
                className={`${button} ${reviewFirst ? 'pi-button--secondary' : 'pi-button--primary'}`}
              >
                이어서 학습
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </>
          ) : (
            <>
              <p className="mb-4 text-fg-secondary">과정을 고르고 첫 단원부터 읽어 보세요.</p>
              <Link
                to="/courses"
                className={`${button} ${reviewFirst ? 'pi-button--secondary' : 'pi-button--primary'}`}
              >
                첫 단원 시작하기
              </Link>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
