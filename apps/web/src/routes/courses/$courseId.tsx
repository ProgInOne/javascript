import type {
  CoursePrerequisiteWarnings,
  CourseProgressDetail,
  LessonSummary,
} from '@proginone/shared';
import { Badge, EmptyState, ProgressRing, Tooltip } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BookOpen, Check, ChevronDown, CircleAlert } from 'lucide-react';
import {
  courseProgressQuery,
  courseQuery,
  coursePrerequisiteWarningsQuery,
} from '../../api/queries.ts';
import { cardClass, pageClass, pageTitleClass } from '../../app/layout.ts';
import { QueryState } from '../../app/QueryState.tsx';
import {
  completedPercent,
  completedText,
  CourseStateBadge,
  LessonStatusIcon,
  lessonStatusLabel,
  MiniBar,
} from '../../features/course-progress/progress.tsx';
import { formatMinutes } from '../../lib/format.ts';

export const Route = createFileRoute('/courses/$courseId')({
  component: CourseDetail,
});

type WarnedConcepts = CoursePrerequisiteWarnings['lessons'][number]['concepts'];
type LessonProgressEntry = CourseProgressDetail['lessonStatuses'][number];

/** Course detail with the curriculum accordion (docs/design/ui-ux.md#과정-목록과-과정-상세). */
function CourseDetail() {
  const { courseId } = Route.useParams();
  const query = useQuery(courseQuery(courseId));
  // Supplementary: while loading or when it fails the rows simply have no `!` (D-073).
  const warnings = useQuery(coursePrerequisiteWarningsQuery(courseId));
  const warned = new Map(warnings.data?.lessons.map((l) => [l.lessonId, l.concepts]));
  // Supplementary too (D-083): without it the page looks as it did before progress existed.
  const progress = useQuery(courseProgressQuery(courseId)).data;
  const statuses = new Map(progress?.lessonStatuses.map((l) => [l.lessonId, l]));
  const moduleCounts = new Map(progress?.modules.map((m) => [m.moduleId, m.lessons]));
  const current = progress?.state === 'in_progress' ? (progress.next?.id ?? null) : null;
  return (
    <div className={pageClass}>
      <QueryState query={query} notFoundTitle="과정을 찾을 수 없어요">
        {(course) => {
          const lessons = course.modules.flatMap((m) => m.lessons);
          const exercises = lessons.reduce((n, l) => n + l.exerciseCount, 0);
          return (
            <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-w-0">
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
                  {course.modules.map((mod, mi) => {
                    const counts = mod.lessons.length > 0 ? moduleCounts.get(mod.id) : undefined;
                    const done = counts !== undefined && counts.completed === counts.total;
                    const minutes = formatMinutes(
                      mod.lessons.reduce((n, l) => n + l.estimatedMinutes, 0),
                    );
                    return (
                      <details
                        key={mod.id}
                        // The first module, and the one with the lesson to do now, start open.
                        open={mi === 0 || mod.lessons.some((l) => l.id === current)}
                        className={`${cardClass} group p-0`}
                        data-module-id={mod.id}
                      >
                        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-(--card-pad) py-4 [&::-webkit-details-marker]:hidden">
                          <ChevronDown
                            size={18}
                            aria-hidden="true"
                            className="text-fg-tertiary transition-transform group-not-open:-rotate-90"
                          />
                          <span className="min-w-0 font-semibold text-heading">
                            {mi + 1}. {mod.title}
                          </span>
                          {done && (
                            <Badge variant="success" icon={<Check size={14} />}>
                              완료
                            </Badge>
                          )}
                          {counts ? (
                            <span className="ml-auto flex items-center gap-2 tabular-nums type-small">
                              <MiniBar percent={completedPercent(counts)} className="w-16" />
                              <span className="text-fg-secondary">
                                {counts.completed}/{counts.total}단원 완료
                              </span>
                              <span className="text-fg-tertiary">· {minutes}</span>
                            </span>
                          ) : (
                            <span className="ml-auto text-fg-tertiary type-small">
                              {mod.lessons.length}단원 · {minutes}
                            </span>
                          )}
                        </summary>
                        {mod.lessons.length === 0 && (
                          <p className="m-0 border-t border-line px-(--card-pad) py-3 text-fg-secondary type-small">
                            이 모듈에는 아직 단원이 없어요.
                          </p>
                        )}
                        <ol className="m-0 list-none border-t border-line p-0">
                          {mod.lessons.map((lesson, li) => (
                            <LessonRow
                              key={lesson.id}
                              lesson={lesson}
                              number={`${String(mi + 1)}.${String(li + 1)}`}
                              progress={statuses.get(lesson.id)}
                              current={lesson.id === current}
                              weak={warned.get(lesson.id)}
                            />
                          ))}
                        </ol>
                      </details>
                    );
                  })}
                </div>
              </div>

              <aside
                className={`${cardClass} lg:sticky lg:top-[calc(var(--header-h)+var(--space-6))]`}
                aria-label="학습 요약"
              >
                {progress && lessons.length > 0 && (
                  <div className="mb-5 flex items-center gap-4">
                    <ProgressRing
                      value={completedPercent(progress.lessons)}
                      label="과정 진행률"
                      size={64}
                    />
                    <div className="grid justify-items-start gap-1">
                      <CourseStateBadge state={progress.state} />
                      <span className="text-fg-secondary tabular-nums type-small">
                        {completedText(progress.lessons)}
                      </span>
                    </div>
                  </div>
                )}
                <h2 className="mb-2 font-semibold text-heading type-ui">학습 목표</h2>
                <ul className="mb-4 list-disc pl-5 text-fg-secondary type-small">
                  {course.objectives.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
                <CourseAction progress={progress} first={lessons[0]} />
              </aside>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}

const actionClass = 'pi-button pi-button--primary pi-button--md w-full justify-center no-underline';

/**
 * The summary card's button (D-083): "학습 시작" before the course is started (or without
 * progress), "이어서 학습: …" to the lesson to do now, "복습하기" once every lesson is completed.
 */
function CourseAction({
  progress,
  first,
}: {
  progress: CourseProgressDetail | undefined;
  first: LessonSummary | undefined;
}) {
  if (progress?.state === 'completed') {
    return (
      <Link to="/review" className={actionClass}>
        복습하기
      </Link>
    );
  }
  if (progress?.state === 'in_progress' && progress.next) {
    return (
      <Link
        to="/learn/$lessonId"
        params={{ lessonId: progress.next.id }}
        className={`${actionClass} h-auto min-h-10 py-2 text-center whitespace-normal`}
      >
        이어서 학습: {progress.next.title}
      </Link>
    );
  }
  const start = progress?.next ?? first;
  if (!start) return null;
  return (
    <Link to="/learn/$lessonId" params={{ lessonId: start.id }} className={actionClass}>
      학습 시작
    </Link>
  );
}

/**
 * A curriculum row (D-083): status mark, number, title and badges, the status in words, time and
 * size. The lesson to do now is tinted, marked `aria-current="step"` and labelled "지금 할 단원".
 * The `!` (D-073) sits beside the row link.
 */
function LessonRow({
  lesson,
  number,
  progress,
  current,
  weak,
}: {
  lesson: LessonSummary;
  number: string;
  progress: LessonProgressEntry | undefined;
  current: boolean;
  weak: WarnedConcepts | undefined;
}) {
  const status = progress?.status ?? 'not_started';
  const label = lessonStatusLabel(status, progress?.readProgress);
  return (
    <li
      className={`flex items-center border-b border-line last:border-b-0 ${current ? 'bg-selected shadow-[inset_3px_0_0_var(--color-action-primary)]' : 'hover:bg-hover'}`}
      data-lesson-status={progress ? status : undefined}
    >
      <Link
        to="/learn/$lessonId"
        params={{ lessonId: lesson.id }}
        aria-current={current ? 'step' : undefined}
        className={`flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-pad) text-fg no-underline ${weak ? 'pr-1' : 'pr-(--card-pad)'}`}
      >
        {progress && <LessonStatusIcon status={status} readProgress={progress.readProgress} />}
        <span className="w-8 shrink-0 text-fg-tertiary tabular-nums md:w-10">{number}</span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span>{lesson.title}</span>
          {lesson.importance === 'core' && <Badge variant="brand">핵심</Badge>}
          {lesson.kind === 'assessment' && <Badge variant="neutral">단원 평가</Badge>}
          {lesson.kind === 'project' && <Badge variant="neutral">응용 프로젝트</Badge>}
          {progress &&
            (current ? (
              <span className="w-full font-semibold text-brand type-small">
                지금 할 단원 · {label}
              </span>
            ) : status === 'not_started' ? (
              <span className="sr-only">{label}</span>
            ) : (
              <span className="w-full text-fg-secondary type-small">{label}</span>
            ))}
        </span>
        <span className="ml-auto shrink-0 text-right text-fg-tertiary tabular-nums type-small">
          {formatMinutes(lesson.estimatedMinutes)}
          <span className="max-[480px]:hidden">
            {' · '}
            {lesson.kind === 'project' ? '프로젝트' : `${String(lesson.exerciseCount)}문제`}
          </span>
        </span>
      </Link>
      {weak && <PrerequisiteMark concepts={weak} />}
    </li>
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
