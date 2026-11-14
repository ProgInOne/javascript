import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { practiceSetQuery } from '../../../api/queries.ts';
import { QueryState } from '../../../app/QueryState.tsx';
import { PracticeSession } from '../../../features/practice/PracticeSession.tsx';
import { TutorProvider } from '../../../features/tutor/TutorContext.tsx';
import { TutorButton, TutorLayout } from '../../../features/tutor/TutorLayout.tsx';

interface SessionSearch {
  /** 1-based item. */
  i?: number;
}

export const Route = createFileRoute('/review/session/$setId')({
  validateSearch: (search: Record<string, unknown>): SessionSearch => {
    const i = Number(search['i']);
    return Number.isInteger(i) && i >= 1 && i <= 500 ? { i } : {};
  },
  component: ReviewSession,
});

/** Title of a set opened here: review sets and weakness sets (from the dashboard). */
const HEADINGS: Partial<Record<string, string>> = { review: '오늘의 복습', weakness: '약점 집중' };

/** 복습·약점 집중 세트 진행: the practice layout (ui-ux.md 복습 화면, 약점 집중). */
function ReviewSession() {
  const { setId } = Route.useParams();
  const { i } = Route.useSearch();
  const navigate = useNavigate();
  const query = useQuery(practiceSetQuery(setId));
  return (
    <TutorProvider>
      <TutorLayout top={56}>
        <div className="practice-page">
          <QueryState query={query} notFoundTitle="연습 세트를 찾을 수 없어요">
            {(set) => (
              <PracticeSession
                set={set}
                index={i !== undefined && i <= set.items.length ? i - 1 : null}
                onIndexChange={(next) => {
                  void navigate({
                    to: '/review/session/$setId',
                    params: { setId },
                    search: next === null ? {} : { i: next + 1 },
                  });
                }}
                heading={HEADINGS[set.kind] ?? '연습'}
                barActions={<TutorButton />}
                lessonTitle={null}
                summaryActions={() => (
                  <>
                    <Link
                      to="/review"
                      className="pi-button pi-button--secondary pi-button--md no-underline"
                    >
                      복습 화면으로
                    </Link>
                    <Link
                      to="/"
                      className="pi-button pi-button--primary pi-button--md no-underline"
                    >
                      대시보드로
                    </Link>
                  </>
                )}
              />
            )}
          </QueryState>
        </div>
      </TutorLayout>
    </TutorProvider>
  );
}
