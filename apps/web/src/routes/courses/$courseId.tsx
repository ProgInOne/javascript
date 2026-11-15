import { Badge } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { courseQuery } from '../../api/queries.ts';
import { cardClass, pageClass, pageTitleClass } from '../../app/layout.ts';
import { QueryState } from '../../app/QueryState.tsx';
import { formatMinutes } from '../../lib/format.ts';

export const Route = createFileRoute('/courses/$courseId')({
  component: CourseDetail,
});

/** Course detail with the curriculum accordion (docs/design/ui-ux.md#과정-목록과-과정-상세). */
function CourseDetail() {
  const { courseId } = Route.useParams();
  const query = useQuery(courseQuery(courseId));
  return (
    <div className={pageClass}>
      <QueryState query={query} notFoundTitle="과정을 찾을 수 없어요">
        {(course) => {
          const lessons = course.modules.flatMap((m) => m.lessons);
          const first = lessons[0];
          const exercises = lessons.reduce((n, l) => n + l.exerciseCount, 0);
          return (
            <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                <h1 className={`${pageTitleClass} mb-2`}>{course.title}</h1>
                <p className="mb-2 text-fg-secondary">{course.summary}</p>
                <p className="mb-(--section-gap) text-fg-tertiary type-small">
                  {course.modules.length}개 모듈 · {lessons.length}개 단원 · 약{' '}
                  {formatMinutes(course.estimatedMinutes)} · 문제 {exercises}개
                </p>

                <h2 className="mb-3 type-h3 text-heading">커리큘럼</h2>
                <div className="grid gap-3">
                  {course.modules.map((mod, mi) => (
                    <details key={mod.id} open={mi === 0} className={`${cardClass} group p-0`}>
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-(--card-pad) py-4 [&::-webkit-details-marker]:hidden">
                        <ChevronDown
                          size={18}
                          aria-hidden="true"
                          className="text-fg-tertiary transition-transform group-not-open:-rotate-90"
                        />
                        <span className="font-semibold text-heading">
                          {mi + 1}. {mod.title}
                        </span>
                        <span className="ml-auto text-fg-tertiary type-small">
                          {mod.lessons.length}단원 ·{' '}
                          {formatMinutes(mod.lessons.reduce((n, l) => n + l.estimatedMinutes, 0))}
                        </span>
                      </summary>
                      <ol className="m-0 list-none border-t border-line p-0">
                        {mod.lessons.map((lesson, li) => (
                          <li key={lesson.id} className="border-b border-line last:border-b-0">
                            <Link
                              to="/learn/$lessonId"
                              params={{ lessonId: lesson.id }}
                              className="flex items-center gap-3 px-(--card-pad) py-3 text-fg no-underline hover:bg-hover"
                            >
                              <span className="w-10 text-fg-tertiary tabular-nums">
                                {mi + 1}.{li + 1}
                              </span>
                              <span>{lesson.title}</span>
                              {lesson.importance === 'core' && <Badge variant="brand">핵심</Badge>}
                              {lesson.kind === 'assessment' && (
                                <Badge variant="neutral">단원 평가</Badge>
                              )}
                              <span className="ml-auto text-fg-tertiary tabular-nums type-small">
                                {formatMinutes(lesson.estimatedMinutes)} · {lesson.exerciseCount}
                                문제
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ))}
                </div>
              </div>

              <aside
                className={`${cardClass} lg:sticky lg:top-[calc(var(--header-h)+var(--space-6))]`}
                aria-label="학습 요약"
              >
                <h2 className="mb-2 font-semibold text-heading type-ui">학습 목표</h2>
                <ul className="mb-4 list-disc pl-5 text-fg-secondary type-small">
                  {course.objectives.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
                {first && (
                  <Link
                    to="/learn/$lessonId"
                    params={{ lessonId: first.id }}
                    className="pi-button pi-button--primary pi-button--md w-full justify-center no-underline"
                  >
                    학습 시작
                  </Link>
                )}
              </aside>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
