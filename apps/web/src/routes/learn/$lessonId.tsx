import type { LessonDetail } from '@proginone/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, ChevronLeft } from 'lucide-react';
import { lessonQuery } from '../../api/queries.ts';
import { QueryState } from '../../app/QueryState.tsx';
import { ConceptImportanceBadge, LessonBody } from '../../features/lesson-reader/LessonBody.tsx';
import { SECTION_LABELS } from '../../features/lesson-reader/sections.ts';
import { useActiveSection } from '../../features/lesson-reader/useActiveSection.ts';
import { formatMinutes } from '../../lib/format.ts';

export const Route = createFileRoute('/learn/$lessonId')({
  component: LearnPage,
});

/** Learning screen, reading mode (docs/design/ui-ux.md#학습-화면-읽기-모드). */
function LearnPage() {
  const { lessonId } = Route.useParams();
  const query = useQuery(lessonQuery(lessonId));
  return (
    <QueryState query={query} notFoundTitle="단원을 찾을 수 없어요">
      {(lesson) => <LessonReader lesson={lesson} />}
    </QueryState>
  );
}

const segment =
  'inline-flex h-8 items-center rounded-md px-3 font-medium text-fg-secondary aria-[current=page]:bg-surface aria-[current=page]:text-heading aria-[current=page]:shadow-1';

function LearnHeader({ lesson }: { lesson: LessonDetail }) {
  return (
    <header className="sticky top-0 z-header flex h-12 items-center gap-3 border-b border-line bg-surface px-4">
      <Link
        to="/courses/$courseId"
        params={{ courseId: lesson.course.id }}
        className="inline-flex size-8 items-center justify-center rounded-md text-fg-secondary hover:bg-hover"
        aria-label={`${lesson.course.title} 과정으로 돌아가기`}
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </Link>
      <nav aria-label="현재 위치" className="min-w-0 truncate text-fg-secondary type-small">
        <ol className="m-0 flex list-none items-center gap-1 p-0">
          <li>{lesson.course.title}</li>
          <li aria-hidden="true">›</li>
          <li>{lesson.module.title}</li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="truncate font-semibold text-heading">
            {lesson.title}
          </li>
        </ol>
      </nav>
      <div
        role="group"
        aria-label="학습 모드"
        className="ml-auto flex gap-1 rounded-lg bg-muted p-1 type-small"
      >
        <span className={segment} aria-current="page">
          읽기
        </span>
        <span
          className={`${segment} opacity-60`}
          aria-disabled="true"
          title="실습 모드는 준비 중이에요"
        >
          실습
        </span>
      </div>
    </header>
  );
}

function LessonReader({ lesson }: { lesson: LessonDetail }) {
  const active = useActiveSection(lesson.sections.map((s) => s.id));
  const own = lesson.concepts.filter((c) => c.role !== 'linked');
  return (
    <div className="min-h-screen bg-canvas">
      <LearnHeader lesson={lesson} />
      <div className="mx-auto grid max-w-[1120px] gap-10 px-5 py-10 lg:grid-cols-[minmax(0,680px)_240px] lg:justify-center">
        <article aria-labelledby="lesson-title">
          <p className="text-fg-tertiary type-small">{lesson.module.title}</p>
          <h1 id="lesson-title" className="mt-1 type-h1 text-heading">
            {lesson.title}
          </h1>
          <p className="mt-2 mb-10 text-fg-tertiary type-small">
            읽기 약 {formatMinutes(lesson.readMinutes)} · 전체 약{' '}
            {formatMinutes(lesson.estimatedMinutes)}
          </p>
          <LessonBody lessonId={lesson.id} body={lesson.body} concepts={lesson.concepts} />

          {(lesson.previous ?? lesson.next) && (
            <nav
              aria-label="단원 이동"
              className="mt-12 flex justify-between gap-4 border-t border-line pt-6"
            >
              {lesson.previous ? (
                <Link
                  to="/learn/$lessonId"
                  params={{ lessonId: lesson.previous.id }}
                  className="lesson-link inline-flex items-center gap-1"
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  이전: {lesson.previous.title}
                </Link>
              ) : (
                <span />
              )}
              {lesson.next && (
                <Link
                  to="/learn/$lessonId"
                  params={{ lessonId: lesson.next.id }}
                  className="lesson-link inline-flex items-center gap-1"
                >
                  다음: {lesson.next.title}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              )}
            </nav>
          )}
        </article>

        <aside className="hidden lg:block" aria-label="단원 정보">
          <div className="sticky top-[calc(48px+var(--space-6))] grid gap-6">
            {own.length > 0 && (
              <section aria-labelledby="concepts-title">
                <h2 id="concepts-title" className="mb-2 font-semibold text-fg-secondary type-small">
                  이 단원의 개념
                </h2>
                <ul className="m-0 grid list-none gap-1.5 p-0 type-small">
                  {own.map((c) => (
                    <li key={c.id} className="flex items-center gap-2" title={c.summary}>
                      <span className="text-fg">{c.title}</span>
                      <ConceptImportanceBadge importance={c.importance} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <nav aria-labelledby="toc-title">
              <h2 id="toc-title" className="mb-2 font-semibold text-fg-secondary type-small">
                목차
              </h2>
              <ol className="m-0 grid list-none gap-1 border-l border-line p-0 type-small">
                {lesson.sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      aria-current={active === s.id ? 'location' : undefined}
                      className="-ml-px block border-l-2 border-transparent py-0.5 pl-3 text-fg-secondary no-underline hover:text-fg aria-[current=location]:border-action aria-[current=location]:font-semibold aria-[current=location]:text-heading"
                    >
                      {s.title ?? SECTION_LABELS[s.kind] ?? s.kind}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </aside>
      </div>
    </div>
  );
}
