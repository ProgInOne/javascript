import type { CoursePrerequisiteWarnings } from '@proginone/shared';
import { Badge, EmptyState, Tooltip } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BookOpen, ChevronDown, CircleAlert } from 'lucide-react';
import { courseQuery, coursePrerequisiteWarningsQuery } from '../../api/queries.ts';
import { cardClass, pageClass, pageTitleClass } from '../../app/layout.ts';
import { QueryState } from '../../app/QueryState.tsx';
import { formatMinutes } from '../../lib/format.ts';

export const Route = createFileRoute('/courses/$courseId')({
  component: CourseDetail,
});

type WarnedConcepts = CoursePrerequisiteWarnings['lessons'][number]['concepts'];

/** Course detail with the curriculum accordion (docs/design/ui-ux.md#과정-목록과-과정-상세). */
function CourseDetail() {
  const { courseId } = Route.useParams();
  const query = useQuery(courseQuery(courseId));
  // Supplementary: while loading or when it fails the rows simply have no `!` (D-073).
  const warnings = useQuery(coursePrerequisiteWarningsQuery(courseId));
  const warned = new Map(warnings.data?.lessons.map((l) => [l.lessonId, l.concepts]));
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
                {lessons.length === 0 && (
                  // FR-UI-03 빈 상태: a pack can ship a course before its lessons.
                  <EmptyState
                    icon={BookOpen}
                    headingLevel={3}
                    title="이 과정에는 아직 단원이 없어요"
                    description="콘텐츠 팩이 갱신되면 여기에 단원이 생겨요. 그동안 다른 과정을 학습해 보세요."
                    action={<Link to="/courses">과정 목록 보기</Link>}
                  />
                )}
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
                      {mod.lessons.length === 0 && (
                        <p className="m-0 border-t border-line px-(--card-pad) py-3 text-fg-secondary type-small">
                          이 모듈에는 아직 단원이 없어요.
                        </p>
                      )}
                      <ol className="m-0 list-none border-t border-line p-0">
                        {mod.lessons.map((lesson, li) => {
                          const weak = warned.get(lesson.id);
                          return (
                            <li
                              key={lesson.id}
                              className="flex items-center border-b border-line last:border-b-0 hover:bg-hover"
                            >
                              <Link
                                to="/learn/$lessonId"
                                params={{ lessonId: lesson.id }}
                                className={`flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-pad) text-fg no-underline ${weak ? 'pr-1' : 'pr-(--card-pad)'}`}
                              >
                                <span className="w-10 text-fg-tertiary tabular-nums">
                                  {mi + 1}.{li + 1}
                                </span>
                                <span>{lesson.title}</span>
                                {lesson.importance === 'core' && (
                                  <Badge variant="brand">핵심</Badge>
                                )}
                                {lesson.kind === 'assessment' && (
                                  <Badge variant="neutral">단원 평가</Badge>
                                )}
                                {lesson.kind === 'project' && (
                                  <Badge variant="neutral">응용 프로젝트</Badge>
                                )}
                                <span className="ml-auto text-fg-tertiary tabular-nums type-small">
                                  {formatMinutes(lesson.estimatedMinutes)} ·{' '}
                                  {lesson.kind === 'project'
                                    ? '프로젝트'
                                    : `${String(lesson.exerciseCount)}문제`}
                                </span>
                              </Link>
                              {weak && <PrerequisiteMark concepts={weak} />}
                            </li>
                          );
                        })}
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

/** Names spelled out in the hint; the rest are counted ("외 n개"), as in the lesson warning. */
const NAMED = 2;

/** "먼저 ‘형 변환’부터 확인하면 더 쉬워요" (ui-ux.md 과정 상세; the lesson warning's wording). */
function prerequisiteHint(concepts: WarnedConcepts): string {
  const named = concepts
    .slice(0, NAMED)
    .map((c) => `‘${c.title}’`)
    .join(', ');
  const rest = concepts.length > NAMED ? ` 외 ${String(concepts.length - NAMED)}개` : '';
  return `먼저 ${named}${rest}부터 확인하면 더 쉬워요`;
}

const markClass =
  'mr-(--card-pad) inline-flex size-9 shrink-0 items-center justify-center rounded-md text-(--color-warning-fg) hover:bg-muted';

/**
 * The `!` at the end of a lesson row (FR-CUR-05, D-073). Nothing is locked: it links to where the
 * first weak prerequisite is taught (its lesson, else the concept detail), and carries the hint as
 * its accessible name and as a hover/focus tooltip. It sits beside the row link, never inside it
 * (no nested interactive elements).
 */
function PrerequisiteMark({ concepts }: { concepts: WarnedConcepts }) {
  const first = concepts[0];
  if (!first) return null;
  const hint = prerequisiteHint(concepts);
  const icon = <CircleAlert size={18} aria-hidden="true" />;
  return (
    <Tooltip content={hint}>
      {first.lesson ? (
        <Link
          to="/learn/$lessonId"
          params={{ lessonId: first.lesson.id }}
          className={markClass}
          aria-label={`선수 개념 안내: ${hint}. ‘${first.lesson.title}’ 단원 보기`}
        >
          {icon}
        </Link>
      ) : (
        <Link
          to="/concepts/$conceptId"
          params={{ conceptId: first.id }}
          className={markClass}
          aria-label={`선수 개념 안내: ${hint}. ‘${first.title}’ 개념 보기`}
        >
          {icon}
        </Link>
      )}
    </Tooltip>
  );
}
