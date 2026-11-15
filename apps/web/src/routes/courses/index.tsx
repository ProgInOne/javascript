import { EmptyState } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BookOpen } from 'lucide-react';
import { coursesQuery } from '../../api/queries.ts';
import { cardClass, pageClass, pageTitleClass } from '../../app/layout.ts';
import { QueryState } from '../../app/QueryState.tsx';
import { formatMinutes } from '../../lib/format.ts';

export const Route = createFileRoute('/courses/')({
  component: CourseList,
});

const LANGUAGE_LABELS = { html: 'HTML', css: 'CSS', javascript: 'JavaScript' } as const;

/** Course cards grouped by track (docs/design/ui-ux.md#과정-목록과-과정-상세). */
function CourseList() {
  const query = useQuery(coursesQuery);
  return (
    <div className={pageClass}>
      <h1 className={pageTitleClass}>과정</h1>
      <QueryState query={query} notFoundTitle="과정을 찾을 수 없어요">
        {(data) =>
          data.tracks.length === 0 ? (
            // A content pack without courses (FR-UI-03 빈 상태): nothing to start yet.
            <EmptyState
              icon={BookOpen}
              headingLevel={2}
              title="아직 과정이 없어요"
              description="콘텐츠 팩에 과정이 들어 있지 않아요. 콘텐츠를 빌드한 뒤 앱을 다시 시작해 주세요."
            />
          ) : (
            data.tracks.map((track) => (
              <section
                key={track.id}
                aria-labelledby={`track-${track.id}`}
                className="mb-(--section-gap)"
              >
                <h2 id={`track-${track.id}`} className="type-h3 text-heading">
                  {track.title}
                </h2>
                <p className="mb-4 text-fg-secondary">{track.summary}</p>
                <ul className="m-0 grid list-none gap-(--grid-gap) p-0 md:grid-cols-2 lg:grid-cols-3">
                  {track.courses.map((course) => (
                    <li key={course.id}>
                      <Link
                        to="/courses/$courseId"
                        params={{ courseId: course.id }}
                        className={`${cardClass} block h-full text-fg no-underline transition-shadow hover:shadow-2`}
                      >
                        <span className="type-caption text-brand">
                          {LANGUAGE_LABELS[course.language]}
                        </span>
                        <span className="mt-1 block type-h3 text-heading">{course.title}</span>
                        <span className="mt-2 block text-fg-secondary">{course.summary}</span>
                        <span className="mt-4 block text-fg-tertiary type-small">
                          {course.lessonCount}개 단원 · 약 {formatMinutes(course.estimatedMinutes)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )
        }
      </QueryState>
    </div>
  );
}
