import type { CourseProgressSummary, CourseSummary } from '@proginone/shared';
import { EmptyState, ProgressBar } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, BookOpen } from 'lucide-react';
import { courseProgressListQuery, coursesQuery } from '../../api/queries.ts';
import { cardClass, pageClass, pageTitleClass } from '../../app/layout.ts';
import { QueryState } from '../../app/QueryState.tsx';
import {
  completedPercent,
  completedText,
  CourseStateBadge,
} from '../../features/course-progress/progress.tsx';
import { formatMinutes } from '../../lib/format.ts';

export const Route = createFileRoute('/courses/')({
  component: CourseList,
});

const LANGUAGE_LABELS = { html: 'HTML', css: 'CSS', javascript: 'JavaScript' } as const;

/** Course cards grouped by track (docs/design/ui-ux.md#과정-목록과-과정-상세). */
function CourseList() {
  const query = useQuery(coursesQuery);
  // Supplementary (D-083): while loading or when it fails the cards show no progress.
  const progressQuery = useQuery(courseProgressListQuery);
  const progress = new Map(progressQuery.data?.courses.map((c) => [c.courseId, c]));
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
                      <CourseCard course={course} progress={progress.get(course.id)} />
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

/**
 * One course card. The title link covers the whole card (a stretched `::after`), so "이어서 학습"
 * can be a second link on the card without nesting links.
 */
function CourseCard({
  course,
  progress,
}: {
  course: CourseSummary;
  progress: CourseProgressSummary | undefined;
}) {
  return (
    <div
      className={`${cardClass} relative flex h-full flex-col transition-shadow hover:shadow-2`}
      data-course-card={course.id}
    >
      <span className="type-caption text-brand">{LANGUAGE_LABELS[course.language]}</span>
      <Link
        to="/courses/$courseId"
        params={{ courseId: course.id }}
        className="mt-1 block type-h3 text-heading no-underline after:absolute after:inset-0 after:rounded-xl after:content-['']"
      >
        {course.title}
      </Link>
      <span className="mt-2 block text-fg-secondary">{course.summary}</span>
      {progress && (
        <div className="mt-4 grid gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CourseStateBadge state={progress.state} />
            <span className="text-fg-secondary tabular-nums type-small">
              {completedText(progress.lessons)}
            </span>
          </div>
          <ProgressBar
            value={completedPercent(progress.lessons)}
            label={`${course.title} 진행률`}
          />
        </div>
      )}
      <span className="mt-4 block text-fg-tertiary type-small">
        {course.lessonCount}개 단원 · 약 {formatMinutes(course.estimatedMinutes)}
      </span>
      {progress?.state === 'in_progress' && progress.next && (
        <Link
          to="/learn/$lessonId"
          params={{ lessonId: progress.next.id }}
          className="relative z-10 mt-3 inline-flex max-w-full items-center gap-1 self-start font-semibold text-link type-small"
        >
          <span className="truncate">이어서 학습: {progress.next.title}</span>
          <ArrowRight size={16} aria-hidden="true" className="shrink-0" />
        </Link>
      )}
    </div>
  );
}
