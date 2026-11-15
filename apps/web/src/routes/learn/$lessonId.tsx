import type { LessonDetail, PracticeSetView } from '@proginone/shared';
import { ErrorState, Skeleton } from '@proginone/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, type ReactNode } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import {
  createPracticeSet,
  lessonQuery,
  practiceSetQuery,
  recordLessonProgress,
} from '../../api/queries.ts';
import {
  AssessmentResultView,
  AssessmentStart,
  LockedTutorButton,
} from '../../features/assessment/Assessment.tsx';
import { PracticeSession } from '../../features/practice/PracticeSession.tsx';
import { AIStatusIndicator } from '../../features/ai/AIStatusIndicator.tsx';
import { SELECTABLE_ATTR } from '../../features/tutor/selection.ts';
import { TutorProvider, useTutorScope } from '../../features/tutor/TutorContext.tsx';
import { TutorButton, TutorLayout } from '../../features/tutor/TutorLayout.tsx';
import { QueryState } from '../../app/QueryState.tsx';
import { ConceptImportanceBadge, LessonBody } from '../../features/lesson-reader/LessonBody.tsx';
import { LessonPractice } from '../../features/practice/LessonPractice.tsx';
import { SECTION_LABELS } from '../../features/lesson-reader/sections.ts';
import { useActiveSection } from '../../features/lesson-reader/useActiveSection.ts';
import { useReadingProgress } from '../../features/lesson-reader/useReadingProgress.ts';
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
        search.mode === 'practice' && lesson.kind === 'assessment' ? (
          <AssessmentMode lesson={lesson} search={search} />
        ) : (
          <TutorProvider>
            <LessonTutorScope lesson={lesson} />
            {search.mode === 'practice' ? (
              <PracticeMode lesson={lesson} search={search} />
            ) : (
              <LessonReader lesson={lesson} />
            )}
          </TutorProvider>
        )
      }
    </QueryState>
  );
}

/**
 * Practice mode of a unit assessment (learning-engine.md#단원-평가-세트): the start screen with the
 * rules, the assessment in progress, and the end screen. While it runs there is no tutor at all
 * (no drawer, no ⌘J, no "ask about the selection"); the header shows the tutor button locked.
 */
function AssessmentMode({ lesson, search }: { lesson: LessonDetail; search: LearnSearch }) {
  const navigate = useNavigate();
  const client = useQueryClient();
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
  const setQuery = useQuery({ ...practiceSetQuery(search.set ?? ''), enabled: !!search.set });
  const set = search.set ? setQuery.data : undefined;
  const inProgress = set?.kind === 'assessment' && set.status === 'active';
  const openSet = (next: PracticeSetView, replace = false) => {
    const i = next.items.findIndex((it) => it.id === next.nextItemId);
    go({ set: next.id, ...(i >= 0 ? { i: i + 1 } : {}) }, replace);
  };

  let body: ReactNode;
  if (!search.set) {
    body = (
      <AssessmentStart
        lesson={lesson}
        onStarted={(next) => {
          openSet(next, true);
        }}
      />
    );
  } else if (setQuery.isPending) {
    body = <Skeleton variant="card" height={360} />;
  } else if (setQuery.isError || set?.kind !== 'assessment') {
    const e = setQuery.error instanceof ApiRequestError ? setQuery.error : null;
    body = (
      <ErrorState
        variant="page"
        headingLevel={1}
        title={
          e?.code === 'NOT_FOUND' || set ? '평가를 찾을 수 없어요' : '평가를 불러오지 못했어요'
        }
        description={e?.message ?? '처음 화면에서 다시 시작해 주세요.'}
        code={e?.code ?? 'NOT_FOUND'}
        action={
          <Link
            to="/learn/$lessonId"
            params={{ lessonId: lesson.id }}
            search={{ mode: 'practice' }}
          >
            평가 처음으로
          </Link>
        }
      />
    );
  } else if (inProgress) {
    const index =
      search.i !== undefined && search.i >= 1 && search.i <= set.items.length ? search.i - 1 : null;
    body = (
      <PracticeSession
        set={set}
        index={index}
        onIndexChange={(i) => {
          go({ set: set.id, ...(i === null ? {} : { i: i + 1 }) });
        }}
        heading={lesson.title}
        lessonTitle={lesson.title}
        summaryActions={() => null}
      />
    );
  } else {
    body = (
      <AssessmentResultView
        lesson={lesson}
        set={set}
        onRetake={async () => {
          const next = await createPracticeSet({ kind: 'assessment', lessonId: lesson.id });
          client.setQueryData(practiceSetQuery(next.id).queryKey, next);
          openSet(next);
        }}
      />
    );
  }

  if (inProgress) {
    return (
      <div className="min-h-screen bg-canvas">
        <LearnHeader lesson={lesson} mode="practice" tutor={<LockedTutorButton />} />
        <div className="practice-page" data-f6-region="">
          {body}
        </div>
      </div>
    );
  }
  return (
    <TutorProvider>
      <LessonTutorScope lesson={lesson} />
      <div className="min-h-screen bg-canvas">
        <LearnHeader lesson={lesson} mode="practice" />
        <TutorLayout top={48}>
          <div className="practice-page">{body}</div>
        </TutorLayout>
      </div>
    </TutorProvider>
  );
}

/** The lesson thread of the tutor (an open practice item replaces it with its exercise). */
function LessonTutorScope({ lesson }: { lesson: LessonDetail }) {
  useTutorScope({
    scopeType: 'lesson',
    scopeId: lesson.id,
    title: lesson.title,
    lessonId: lesson.id,
  });
  return null;
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
      <TutorLayout top={48}>
        <div className="practice-page">
          <LessonPractice lesson={lesson} setId={search.set} item={search.i} navigate={go} />
        </div>
      </TutorLayout>
    </div>
  );
}

const segment =
  'inline-flex h-8 items-center whitespace-nowrap rounded-md px-3 font-medium text-fg-secondary aria-[current=page]:bg-surface aria-[current=page]:text-heading aria-[current=page]:shadow-1';

function LearnHeader({
  lesson,
  mode,
  tutor,
}: {
  lesson: LessonDetail;
  mode: 'read' | 'practice';
  /** Replaces the tutor button (the locked one during an assessment). */
  tutor?: ReactNode;
}) {
  useModeShortcuts(lesson.id);
  return (
    <header
      data-f6-region=""
      className="sticky top-0 z-header flex h-12 items-center gap-3 border-b border-line bg-surface px-4"
    >
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
      <nav
        aria-label="학습 모드"
        className="ml-auto flex shrink-0 gap-1 rounded-lg bg-muted p-1 type-small"
      >
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
          {lesson.kind === 'assessment' ? '평가' : '실습'}
        </Link>
      </nav>
      <AIStatusIndicator />
      {tutor ?? <TutorButton />}
    </header>
  );
}

function LessonReader({ lesson }: { lesson: LessonDetail }) {
  const active = useActiveSection(lesson.sections.map((s) => s.id));
  const progress = useReadingProgress(lesson.id, active, recordLessonProgress);
  const resume =
    progress?.lastSectionId && progress.lastSectionId !== lesson.sections[0]?.id
      ? lesson.sections.find((s) => s.id === progress.lastSectionId)
      : undefined;
  const own = lesson.concepts.filter((c) => c.role !== 'linked');
  return (
    <div className="min-h-screen bg-canvas">
      <LearnHeader lesson={lesson} mode="read" />
      <TutorLayout top={48}>
        <div className="mx-auto grid max-w-[1120px] grid-cols-[minmax(0,1fr)] gap-10 px-5 py-10 lg:grid-cols-[minmax(0,680px)_240px] lg:justify-center">
          <article aria-labelledby="lesson-title" {...{ [SELECTABLE_ATTR]: '' }}>
            <p className="text-fg-tertiary type-small">{lesson.module.title}</p>
            <h1 id="lesson-title" className="mt-1 type-h1 text-heading">
              {lesson.title}
            </h1>
            <p className="mt-2 mb-10 text-fg-tertiary type-small">
              읽기 약 {formatMinutes(lesson.readMinutes)} · 전체 약{' '}
              {formatMinutes(lesson.estimatedMinutes)}
            </p>
            {resume && (
              <p className="lesson-resume" role="note">
                지난번에 ‘{resume.title ?? SECTION_LABELS[resume.kind] ?? resume.kind}’까지
                읽었어요.{' '}
                <a href={`#${resume.id}`} className="lesson-link">
                  이어서 읽기
                </a>
              </p>
            )}
            <LessonBody
              lessonId={lesson.id}
              kind={lesson.kind}
              body={lesson.body}
              concepts={lesson.concepts}
            />

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
                  <h2
                    id="concepts-title"
                    className="mb-2 font-semibold text-fg-secondary type-small"
                  >
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
      </TutorLayout>
    </div>
  );
}
