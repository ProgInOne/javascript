import type { CodeDraft, LessonDetail, PracticeSetView } from '@proginone/shared';
import { ErrorState, IconButton, ProgressBar, Skeleton } from '@proginone/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  Keyboard,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import {
  createPracticeSet,
  exampleDraftsQuery,
  lessonPrerequisitesQuery,
  lessonQuery,
  practiceSetQuery,
  recordLessonProgress,
  useSettings,
} from '../../api/queries.ts';
import {
  AssessmentResultView,
  AssessmentStart,
  LockedTutorButton,
} from '../../features/assessment/Assessment.tsx';
import { PracticeSession } from '../../features/practice/PracticeSession.tsx';
import { ProjectScreen } from '../../features/project/Project.tsx';
import { AIStatusIndicator } from '../../features/ai/AIStatusIndicator.tsx';
import { openShortcutHelp } from '../../features/shortcuts/ShortcutHelp.tsx';
import { SELECTABLE_ATTR } from '../../features/tutor/selection.ts';
import { TutorProvider, useTutorScope } from '../../features/tutor/TutorContext.tsx';
import { TutorButton, TutorLayout } from '../../features/tutor/TutorLayout.tsx';
import { QueryState } from '../../app/QueryState.tsx';
import { ConceptImportanceBadge, LessonBody } from '../../features/lesson-reader/LessonBody.tsx';
import { LessonPractice } from '../../features/practice/LessonPractice.tsx';
import { PrerequisiteWarning } from '../../features/lesson-reader/PrerequisiteWarning.tsx';
import { SECTION_LABELS } from '../../features/lesson-reader/sections.ts';
import { groupSteps, stepIndexOf } from '../../features/lesson-reader/steps.ts';
import { useActiveSection } from '../../features/lesson-reader/useActiveSection.ts';
import { useLessonSteps } from '../../features/lesson-reader/useLessonSteps.ts';
import { useReadingProgress } from '../../features/lesson-reader/useReadingProgress.ts';
import { formatMinutes } from '../../lib/format.ts';
import { PANEL_KEYS, parseBoolean, usePanelState } from '../../lib/panels.ts';

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
            {search.mode === 'practice' && lesson.kind === 'project' && !search.set ? (
              <ProjectMode lesson={lesson} />
            ) : search.mode === 'practice' ? (
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

/**
 * Practice mode of a project unit (content-and-exercises.md#프로젝트-단원-kind-project): no
 * practice set; the workspace grades the milestone web_task directly. The tutor stays available.
 * With `?set=` the unit's preparation practice runs as a regular lesson set instead.
 */
function ProjectMode({ lesson }: { lesson: LessonDetail }) {
  return (
    <div className="min-h-screen bg-canvas">
      <LearnHeader lesson={lesson} mode="practice" />
      <TutorLayout top={48}>
        <div className="practice-page">
          <ProjectScreen lesson={lesson} />
        </div>
      </TutorLayout>
    </div>
  );
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
  step,
}: {
  lesson: LessonDetail;
  mode: 'read' | 'practice';
  /** Replaces the tutor button (the locked one during an assessment). */
  tutor?: ReactNode;
  /** Step view of reading mode (D-077): "단계 n / 전체" and its bar. */
  step?: { current: number; total: number } | undefined;
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
      {step && (
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          <p className="tnum whitespace-nowrap text-fg-secondary type-small">
            단계 {step.current + 1} / {step.total}
          </p>
          <ProgressBar
            value={step.current + 1}
            max={step.total}
            size={8}
            label="단계 진행"
            className="w-32 max-md:hidden"
          />
        </div>
      )}
      <nav
        aria-label="학습 모드"
        className={`${step ? '' : 'ml-auto'}flex shrink-0 gap-1 rounded-lg bg-muted p-1 type-small`}
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
          {lesson.kind === 'assessment' ? '평가' : lesson.kind === 'project' ? '프로젝트' : '실습'}
        </Link>
      </nav>
      <AIStatusIndicator />
      <IconButton
        label="단축키 도움말"
        shortcut="?"
        icon={<Keyboard size={18} />}
        aria-keyshortcuts="?"
        className="max-md:hidden"
        onClick={openShortcutHelp}
      />
      {tutor ?? <TutorButton />}
    </header>
  );
}

type LessonSection = LessonDetail['sections'][number];

const sectionTitle = (s: LessonSection) => s.title ?? SECTION_LABELS[s.kind] ?? s.kind;

/**
 * Reading mode (ui-ux.md 학습 화면: 읽기 모드, D-077): a green hero band, then the lesson as step
 * cards (regular lessons) or one plain card (assessments and projects), with the concepts and the
 * table of contents in a side column that folds (D-067).
 */
function LessonReader({ lesson }: { lesson: LessonDetail }) {
  const active = useActiveSection(lesson.sections.map((s) => s.id));
  const steps = useMemo(
    () => (lesson.kind === 'lesson' ? groupSteps(lesson.body) : []),
    [lesson.kind, lesson.body],
  );
  // `useReadingProgress` needs the section to save before it can return the saved one, so the
  // saved position reaches the step hook through state.
  const [lastSectionId, setLastSectionId] = useState<string | null>(null);
  const { current, goTo } = useLessonSteps(steps, lastSectionId);
  // The saved position follows the current step: after "다음 단계" near the end of the page the
  // section on screen may still belong to the step before.
  const tracked =
    steps.length > 0 && stepIndexOf(steps, active) !== current
      ? (steps[current]?.sectionIds[0] ?? active)
      : active;
  const progress = useReadingProgress(lesson.id, tracked, recordLessonProgress);
  const saved = progress?.lastSectionId ?? null;
  if (saved !== lastSectionId) setLastSectionId(saved);
  const resume =
    saved && saved !== lesson.sections[0]?.id
      ? lesson.sections.find((s) => s.id === saved)
      : undefined;
  const resumeStep = stepIndexOf(steps, resume?.id);
  const own = lesson.concepts.filter((c) => c.role !== 'linked');
  const asideId = useId();
  const [asideCollapsed, setAsideCollapsed] = usePanelState(
    PANEL_KEYS.lessonAside,
    false,
    parseBoolean,
  );
  const predictFirst = useSettings().data?.['lesson.predictFirst'] ?? 'recommended';
  // Learner state: a failure only hides the mastery and the warning, never the lesson.
  const prerequisites = useQuery(lessonPrerequisitesQuery(lesson.id)).data;
  // Edited examples (D-063). A failure restores only the browser drafts.
  const drafts = useQuery(exampleDraftsQuery(lesson.id));
  const exampleDrafts = useMemo(
    () =>
      drafts.data
        ? new Map(drafts.data.drafts.map((d) => [d.id, d]))
        : drafts.isError
          ? new Map<string, CodeDraft>()
          : undefined,
    [drafts.data, drafts.isError],
  );
  const stepView = useMemo(
    () => ({
      list: steps,
      current,
      onGoTo: (i: number) => {
        goTo(i, { focus: true });
      },
    }),
    [steps, current, goTo],
  );
  const sectionsById = new Map(lesson.sections.map((s) => [s.id, s]));
  const tocItem = (s: LessonSection) => (
    <li key={s.id}>
      <a
        href={`#${s.id}`}
        aria-current={active === s.id ? 'location' : undefined}
        className="-ml-px block border-l-2 border-transparent py-0.5 pl-3 text-fg-secondary no-underline hover:text-fg aria-[current=location]:border-action aria-[current=location]:font-semibold aria-[current=location]:text-heading"
      >
        {sectionTitle(s)}
      </a>
    </li>
  );
  return (
    <div className="min-h-screen bg-canvas">
      <LearnHeader
        lesson={lesson}
        mode="read"
        step={steps.length > 0 ? { current, total: steps.length } : undefined}
      />
      <TutorLayout top={48}>
        <div className="lesson-hero">
          <div className="lesson-hero__inner">
            <div className="lesson-hero__text">
              <p className="lesson-hero__eyebrow">
                {lesson.course.title} · {lesson.module.title}
              </p>
              <h1 id="lesson-title" className="lesson-hero__title">
                {lesson.title}
              </h1>
              {lesson.summary && <p className="lesson-hero__summary">{lesson.summary}</p>}
            </div>
            <dl className="lesson-hero__tiles">
              <div className="lesson-hero__tile">
                <dt>읽기</dt>
                <dd>{formatMinutes(lesson.readMinutes)}</dd>
              </div>
              <div className="lesson-hero__tile">
                <dt>전체</dt>
                <dd>{formatMinutes(lesson.estimatedMinutes)}</dd>
              </div>
              {lesson.practiceCount !== undefined && lesson.practiceCount > 0 && (
                <div className="lesson-hero__tile">
                  <dt>연습</dt>
                  <dd>{lesson.practiceCount}문제</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
        <div
          className={
            asideCollapsed
              ? 'lesson-layout lg:grid-cols-[minmax(0,800px)_32px]'
              : 'lesson-layout lg:grid-cols-[minmax(0,800px)_240px]'
          }
        >
          <article
            aria-labelledby="lesson-title"
            className="lesson-article"
            {...{ [SELECTABLE_ATTR]: '' }}
          >
            {prerequisites && <PrerequisiteWarning data={prerequisites} />}
            {resume && (
              <p className="lesson-resume" role="note">
                지난번에{' '}
                {resumeStep >= 0
                  ? `${String(resumeStep + 1)}단계 ‘${steps[resumeStep]?.label ?? ''}’의 `
                  : ''}
                ‘{sectionTitle(resume)}’까지 읽었어요.{' '}
                {resumeStep >= 0 ? (
                  <button
                    type="button"
                    className="pi-button pi-button--link"
                    onClick={() => {
                      goTo(resumeStep, { focus: true });
                    }}
                  >
                    이어서 읽기
                  </button>
                ) : (
                  <a href={`#${resume.id}`} className="lesson-link">
                    이어서 읽기
                  </a>
                )}
              </p>
            )}
            <LessonBody
              lessonId={lesson.id}
              kind={lesson.kind}
              body={lesson.body}
              concepts={lesson.concepts}
              predictFirst={predictFirst}
              prerequisites={prerequisites?.prerequisites}
              exampleDrafts={exampleDrafts}
              steps={stepView}
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

          <aside className="hidden pt-12 lg:block" aria-label="단원 정보" id={asideId}>
            {asideCollapsed ? (
              <div className="sticky top-[calc(48px+var(--space-6))]">
                <IconButton
                  label="단원 정보 펼치기"
                  icon={<PanelRightOpen size={18} />}
                  aria-expanded={false}
                  aria-controls={asideId}
                  tooltipSide="left"
                  onClick={() => {
                    setAsideCollapsed(false);
                  }}
                />
              </div>
            ) : (
              <div className="sticky top-[calc(48px+var(--space-6))] grid gap-6">
                <div className="-mt-1 -mb-4 flex justify-end">
                  <IconButton
                    label="단원 정보 접기"
                    icon={<PanelRightClose size={18} />}
                    aria-expanded
                    aria-controls={asideId}
                    tooltipSide="left"
                    onClick={() => {
                      setAsideCollapsed(true);
                    }}
                  />
                </div>
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
                  {steps.length > 0 ? (
                    <ol className="m-0 grid list-none gap-3 p-0 type-small">
                      {steps.map((step, i) => (
                        <li key={step.id} className="grid gap-1">
                          <span
                            className="lesson-toc-step"
                            data-state={
                              i < current ? 'done' : i === current ? 'current' : 'upcoming'
                            }
                          >
                            <span className="lesson-toc-step__num" aria-hidden="true">
                              {i + 1}
                            </span>
                            <span className="sr-only">{`${String(i + 1)}단계: `}</span>
                            {step.label}
                          </span>
                          <ol className="m-0 ml-2.5 grid list-none gap-1 border-l border-line p-0">
                            {step.sectionIds.flatMap((id) => {
                              const s = sectionsById.get(id);
                              return s ? [tocItem(s)] : [];
                            })}
                          </ol>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <ol className="m-0 grid list-none gap-1 border-l border-line p-0 type-small">
                      {lesson.sections.map(tocItem)}
                    </ol>
                  )}
                </nav>
              </div>
            )}
          </aside>
        </div>
      </TutorLayout>
    </div>
  );
}
