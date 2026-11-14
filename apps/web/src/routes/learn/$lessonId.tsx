import type { LessonDetail } from '@proginone/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, ChevronLeft } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { lessonQuery } from '../../api/queries.ts';
import { QueryState } from '../../app/QueryState.tsx';
import { ConceptImportanceBadge, LessonBody } from '../../features/lesson-reader/LessonBody.tsx';
import { LessonPractice } from '../../features/practice/LessonPractice.tsx';
import { SECTION_LABELS } from '../../features/lesson-reader/sections.ts';
import { useActiveSection } from '../../features/lesson-reader/useActiveSection.ts';
import { formatMinutes } from '../../lib/format.ts';

/** URL state of the learning screen (ui-ux.md 사이트맵): `?mode=practice&set=:id&i=n`. */
export interface LearnSearch {
  mode?: 'practice';
  set?: string;
  /** 1-based item of the practice set. */
  i?: number;
}

export const Route = createFileRoute('/learn/$lessonId')({
  validateSearch: (search: Record<string, unknown>): LearnSearch => {
    const i = Number(search['i']);
    return {
      ...(search['mode'] === 'practice' ? { mode: 'practice' as const } : {}),
      ...(typeof search['set'] === 'string' && /^[0-9A-Z]{26}$/.test(search['set'])
        ? { set: search['set'] }
        : {}),
      ...(Number.isInteger(i) && i >= 1 && i <= 500 ? { i } : {}),
    };
  },
  component: LearnPage,
});

/** Learning screen: reading mode and practice mode (docs/design/ui-ux.md#학습-화면-공통-구조). */
function LearnPage() {
  const { lessonId } = Route.useParams();
  const search = Route.useSearch();
  const query = useQuery(lessonQuery(lessonId));
  return (
    <QueryState query={query} notFoundTitle="단원을 찾을 수 없어요">
      {(lesson) =>
        search.mode === 'practice' ? (
          <PracticeMode lesson={lesson} search={search} />
        ) : (
          <LessonReader lesson={lesson} />
        )
      }
    </QueryState>
  );
}

/** `⌘1` / `⌘2` (Ctrl elsewhere): reading / practice mode (ui-ux.md 단축키). */
function useModeShortcuts(lessonId: string) {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const apple = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
      const mod = apple ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.altKey || e.shiftKey || (e.key !== '1' && e.key !== '2')) return;
      e.preventDefault();
      void navigate({
        to: '/learn/$lessonId',
        params: { lessonId },
        search: e.key === '2' ? { mode: 'practice' } : {},
      });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [lessonId, navigate]);
}

function PracticeMode({ lesson, search }: { lesson: LessonDetail; search: LearnSearch }) {
  const navigate = useNavigate();
  const go = useCallback(
    (next: { set: string; i?: number }, replace = false) => {
      void navigate({
        to: '/learn/$lessonId',
        params: { lessonId: lesson.id },
        search: { mode: 'practice', ...next },
        replace,
      });
    },
    [lesson.id, navigate],
  );
  return (
    <div className="min-h-screen bg-canvas">
      <LearnHeader lesson={lesson} mode="practice" />
      <div className="practice-page">
        <LessonPractice lesson={lesson} setId={search.set} item={search.i} navigate={go} />
      </div>
    </div>
  );
}

const segment =
  'inline-flex h-8 items-center rounded-md px-3 font-medium text-fg-secondary aria-[current=page]:bg-surface aria-[current=page]:text-heading aria-[current=page]:shadow-1';

function LearnHeader({ lesson, mode }: { lesson: LessonDetail; mode: 'read' | 'practice' }) {
  useModeShortcuts(lesson.id);
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
      <nav aria-label="학습 모드" className="ml-auto flex gap-1 rounded-lg bg-muted p-1 type-small">
        <Link
          to="/learn/$lessonId"
          params={{ lessonId: lesson.id }}
          search={{}}
          activeOptions={{ exact: true, includeSearch: true }}
          className={`${segment} no-underline`}
          aria-current={mode === 'read' ? 'page' : undefined}
          aria-keyshortcuts="Meta+1 Control+1"
        >
          읽기
        </Link>
        <Link
          to="/learn/$lessonId"
          params={{ lessonId: lesson.id }}
          search={{ mode: 'practice' }}
          activeOptions={{ exact: true, includeSearch: true }}
          className={`${segment} no-underline`}
          aria-current={mode === 'practice' ? 'page' : undefined}
          aria-keyshortcuts="Meta+2 Control+2"
        >
          실습
        </Link>
      </nav>
    </header>
  );
}

function LessonReader({ lesson }: { lesson: LessonDetail }) {
  const active = useActiveSection(lesson.sections.map((s) => s.id));
  const own = lesson.concepts.filter((c) => c.role !== 'linked');
  return (
    <div className="min-h-screen bg-canvas">
      <LearnHeader lesson={lesson} mode="read" />
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
                  search={{}}
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
                  search={{}}
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
