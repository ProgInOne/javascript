import {
  ExerciseRenderer,
  FeedbackBanner,
  HintLadder,
  initialAnswer,
  parsePublicSpec,
  useExerciseShortcuts,
  type AnswerByType,
  type RenderableExercise,
} from '@proginone/exercise-ui';
import type {
  CodeDraft,
  ExerciseView,
  LessonDetail,
  OpenedHint,
  ProjectAttemptResponse,
  ProjectView,
  RunResult,
  SolutionResponse,
} from '@proginone/shared';
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '@proginone/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  BookOpen,
  Check,
  Circle,
  CornerLeftUp,
  Dumbbell,
  Hammer,
  Minus,
  PartyPopper,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import {
  createPracticeSet,
  exerciseQuery,
  fetchRunPlan,
  LEARNING_STATE_KEYS,
  openHint,
  practiceSetQuery,
  projectQuery,
  submitProjectAttempt,
  viewSolution,
} from '../../api/queries.ts';
import { formatMinutes } from '../../lib/format.ts';
import { statusMessage } from '../runner/runner.ts';
import { AiHint } from '../tutor/AiHint.tsx';
import { codeFilesOf, runSummaryOf } from '../tutor/context.ts';
import { PracticeSplit } from '../practice/PracticeSplit.tsx';
import { SELECTABLE_ATTR } from '../tutor/selection.ts';
import { useTutorScope } from '../tutor/TutorContext.tsx';
import {
  loadLegacyDraft,
  loadLocalDraft,
  pickDraft,
  sameFiles,
  useDraftSaver,
  useServerExerciseDraft,
} from '../drafts/drafts.ts';
import { useActiveTime, useExerciseRunner } from '../practice/hooks.ts';
import { Markdown } from '../practice/Markdown.tsx';
import {
  feedbackResultOf,
  MasteryChangeList,
  ReportButton,
  SolutionContent,
} from '../practice/parts.tsx';

// Project units (content-and-exercises.md#프로젝트-단원-kind-project, D-048, D-049): one
// milestone web_task built step by step. Each grading run shows which milestones pass; the run
// that passes all of them completes the unit. Hints, the solution and the tutor are allowed.

type WebAnswer = AnswerByType['web_task'];

/** v0.3 browser draft key of a project's code (read once; drafts now live per exercise). */
export const projectDraftKey = (lessonId: string) => `project:${lessonId}`;

/** Practice mode of a project unit: the brief, milestone progress and the workspace. */
export function ProjectScreen({ lesson }: { lesson: LessonDetail }) {
  const project = useQuery(projectQuery(lesson.id));
  const exerciseId = lesson.project?.exerciseId ?? null;
  const exercise = useQuery({ ...exerciseQuery(exerciseId ?? '', null), enabled: !!exerciseId });
  const serverDraft = useServerExerciseDraft(exerciseId ?? '', !!exerciseId);

  if (
    !exerciseId ||
    (project.error instanceof ApiRequestError && project.error.code === 'PRACTICE_NO_EXERCISES')
  ) {
    return (
      <EmptyState
        icon={BookOpen}
        headingLevel={1}
        title="이 프로젝트는 아직 준비 중이에요"
        description="과제가 준비되면 여기서 프로젝트를 만들 수 있어요."
        action={
          <Link to="/learn/$lessonId" params={{ lessonId: lesson.id }} search={{}}>
            본문 보기
          </Link>
        }
      />
    );
  }
  if (project.isPending || exercise.isPending || !serverDraft.ready)
    return <Skeleton variant="card" height={480} />;
  if (project.isError || exercise.isError) {
    const e = [project.error, exercise.error].find(
      (x): x is ApiRequestError => x instanceof ApiRequestError,
    );
    return (
      <ErrorState
        variant="page"
        headingLevel={1}
        title="프로젝트를 불러오지 못했어요"
        description={e?.message ?? '잠시 후 다시 시도해 주세요.'}
        code={e?.code ?? 'INTERNAL'}
        action={
          <Button
            onClick={() => {
              void project.refetch();
              void exercise.refetch();
            }}
          >
            다시 시도
          </Button>
        }
      />
    );
  }
  const renderable = parsePublicSpec(exercise.data.type, exercise.data.publicSpec);
  if (renderable?.typeId !== 'web_task') {
    return (
      <ErrorState
        variant="page"
        headingLevel={1}
        title="이 프로젝트를 표시할 수 없어요"
        description="이 버전에서 지원하지 않는 과제 형식이에요."
        code="EXERCISE_UNSUPPORTED"
      />
    );
  }
  return (
    <ProjectWorkspace
      lesson={lesson}
      project={project.data}
      view={exercise.data}
      exercise={renderable}
      serverDraft={serverDraft.draft}
    />
  );
}

/**
 * Where the editor starts: the newest draft (this browser or the server, D-063), else the last
 * submission, else the starter. A draft equal to the last submission counts as the submission.
 */
function startingAnswer(
  lessonId: string,
  project: ProjectView,
  exerciseId: string,
  exercise: RenderableExercise,
  serverDraft: CodeDraft | null,
): { answer: WebAnswer; from: 'draft' | 'saved' | 'starter' } {
  const draft = pickDraft(
    [
      loadLocalDraft({ kind: 'exercise', exerciseId }),
      serverDraft,
      loadLegacyDraft(projectDraftKey(lessonId), null),
    ],
    null,
  );
  const saved = project.savedAnswer;
  if (draft && !(saved && sameFiles(draft.files, saved.files)))
    return { answer: { files: draft.files }, from: 'draft' };
  if (saved) return { answer: saved, from: 'saved' };
  return { answer: initialAnswer(exercise) as WebAnswer, from: 'starter' };
}

function errorText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return '실행 환경을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

export function ProjectWorkspace({
  lesson,
  project: initialProject,
  view,
  exercise,
  serverDraft = null,
}: {
  lesson: LessonDetail;
  project: ProjectView;
  view: ExerciseView;
  exercise: RenderableExercise;
  serverDraft?: CodeDraft | null;
}) {
  const client = useQueryClient();
  const promptId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [start] = useState(() =>
    startingAnswer(lesson.id, initialProject, view.id, exercise, serverDraft),
  );
  const [answer, setAnswer] = useState<WebAnswer>(start.answer);
  const [project, setProject] = useState(initialProject);
  const [result, setResult] = useState<ProjectAttemptResponse | null>(null);
  const drafts = useDraftSaver({ kind: 'exercise', exerciseId: view.id }, null);
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunResult | null>(null);
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [hints, setHints] = useState<OpenedHint[]>(view.openedHints);
  const [hintPending, setHintPending] = useState(false);
  const [solution, setSolution] = useState<SolutionResponse | null>(null);
  const runner = useExerciseRunner();
  const timing = useActiveTime();
  const completed = project.status === 'completed';

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // What the tutor sees: the project's exercise thread with the current code and last run.
  const work = useRef({ answer, run, result });
  useEffect(() => {
    work.current = { answer, run, result };
  });
  useTutorScope({
    scopeType: 'exercise',
    scopeId: view.id,
    title: `${lesson.title} · 프로젝트`,
    lessonId: lesson.id,
    exerciseId: view.id,
    getCode: () => codeFilesOf(work.current.answer),
    getRun: () =>
      runSummaryOf(
        work.current.run,
        work.current.result ? feedbackResultOf(work.current.result).checkResults : null,
      ),
    hasCode: true,
    hasRun: run !== null,
    lastIncorrect: result !== null && result.attempt.graded && !result.attempt.correct,
  });

  const changeAnswer = (next: WebAnswer) => {
    setAnswer(next);
    drafts.save(next.files);
  };

  const runPreview = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setPreviewStatus('loading');
    try {
      const plan = await fetchRunPlan(view.id, { answer, purpose: 'interactive' });
      const res = await runner.preview(plan);
      setRun(res);
      setPreviewStatus(res.status === 'crashed' ? 'error' : 'ready');
    } catch (e) {
      setError(errorText(e));
      setPreviewStatus('error');
    } finally {
      setRunning(false);
    }
  };

  const grade = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const plan = await fetchRunPlan(view.id, { answer, purpose: 'grading' });
      const runResult = await runner.hidden(plan);
      setRun(runResult);
      const res = await submitProjectAttempt(lesson.id, {
        exerciseId: view.id,
        answer,
        runResult,
        startedAt: timing.startedAt,
        activeMs: timing.readActiveMs(),
      });
      setResult(res);
      setProject(res.project);
      client.setQueryData(projectQuery(lesson.id).queryKey, res.project);
      for (const key of LEARNING_STATE_KEYS) void client.invalidateQueries({ queryKey: key });
      if (!res.attempt.graded) {
        setError('실행 환경 문제로 이번 채점은 결과를 내지 못했어요. 다시 채점해 주세요.');
        return;
      }
      void runPreview();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSubmitting(false);
    }
  };

  const revealHint = async () => {
    if (hintPending || hints.length >= view.hintCount) return;
    setHintPending(true);
    try {
      const res = await openHint(view.id, null);
      setHints((h) => [...h, { level: res.level, text: res.text }]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setHintPending(false);
    }
  };

  const revealSolution = async () => {
    try {
      setSolution(await viewSolution(view.id, null));
    } catch (e) {
      setError(errorText(e));
    }
  };

  useExerciseShortcuts({
    onSubmit: () => void grade(),
    onRun: () => void runPreview(),
    onNextHint: () => void revealHint(),
  });

  const graded = result?.attempt.graded ? result : null;
  const newly = graded
    ? project.milestones.filter((m) => graded.newlyPassed.includes(m.id)).map((m) => m.title)
    : [];
  const runNote = run && !graded && statusMessage(run);
  const total = project.milestones.length;

  return (
    <PracticeSplit
      {...{ [SELECTABLE_ATTR]: '' }}
      typeId="project"
      className="practice-layout practice-layout--code practice-layout--web project-workspace"
      data-type="web_task"
      data-exercise-id={view.id}
      problem={
        <>
          <section className="practice-problem" aria-labelledby={promptId}>
            <header className="practice-problem__meta">
              <h1
                ref={headingRef}
                tabIndex={-1}
                id={promptId}
                className="practice-problem__title project-title"
              >
                <Hammer size={20} aria-hidden="true" />
                {lesson.title}
              </h1>
              <Badge variant="brand">응용 프로젝트</Badge>
              {completed && <Badge variant="success">완성</Badge>}
            </header>
            <p className="m-0 text-fg-tertiary type-small">
              마일스톤 {total}개
              {lesson.project && ` · 약 ${formatMinutes(lesson.project.estimatedMinutes)}`}
              {project.runCount > 0 && ` · 채점 ${project.runCount}번`}
            </p>
            <div className="practice-problem__prompt">
              <Markdown text={view.prompt} />
            </div>
            {start.from !== 'starter' &&
              project.runCount + (start.from === 'draft' ? 1 : 0) > 0 && (
                <p className="project-resume m-0" role="note">
                  {start.from === 'draft'
                    ? '저장해 둔 작성 중인 코드에서 이어서 해요.'
                    : '마지막으로 채점한 코드에서 이어서 해요.'}
                </p>
              )}
          </section>

          <MilestoneList project={project} />
          {(lesson.project?.practiceCount ?? 0) > 0 && (
            <PreparationCard lesson={lesson} count={lesson.project?.practiceCount ?? 0} />
          )}

          <p className="sr-only" aria-live="polite">
            {result?.completedNow
              ? '모든 마일스톤을 통과해 프로젝트를 완성했어요.'
              : newly.length > 0
                ? `새로 통과한 마일스톤: ${newly.join(', ')}`
                : ''}
          </p>
          {completed && <CompletionCard lesson={lesson} result={result} />}

          <div className="practice-response">
            <div className="project-actions">
              <Button
                variant="primary"
                loading={submitting}
                onClick={() => void grade()}
                aria-keyshortcuts="Meta+Enter Control+Enter"
              >
                채점하기
              </Button>
              <span className="text-fg-secondary type-small">
                채점하면 마일스톤마다 통과했는지 알려 줘요. 몇 번이든 다시 채점할 수 있어요.
              </span>
            </div>
            {error && (
              <p role="alert" className="practice-error">
                {error}
              </p>
            )}
            {runNote && <p className="text-fg-secondary type-small">{runNote}</p>}
            {newly.length > 0 && !result?.completedNow && (
              <p className="project-newly m-0">
                <Check size={16} aria-hidden="true" />
                새로 통과: {newly.join(', ')}
              </p>
            )}
            <FeedbackBanner
              result={graded ? feedbackResultOf(graded) : null}
              misconceptions={(graded?.grade.misconceptions ?? []).map((m) => ({
                id: m.id,
                name: m.title,
              }))}
              {...(graded && graded.grade.explanation !== ''
                ? { explanation: <Markdown text={graded.grade.explanation} /> }
                : {})}
            />
            {graded && <MasteryChangeList changes={graded.masteryChanges} />}
            {view.hintCount > 0 && (
              <HintLadder
                hints={Array.from({ length: view.hintCount }, (_, i) => hints[i]?.text ?? '')}
                revealed={hints.length}
                onReveal={() => void revealHint()}
                onRevealAnswer={() => void revealSolution()}
                answerRevealed={solution !== null}
                answer={
                  solution && (
                    <>
                      <SolutionContent solution={solution.solution} />
                      <Markdown text={solution.explanation} />
                    </>
                  )
                }
                pending={hintPending}
                afterHints={
                  <AiHint
                    exerciseId={view.id}
                    level={hints.length}
                    request={() => {
                      const code = codeFilesOf(work.current.answer);
                      const lastRun = runSummaryOf(
                        work.current.run,
                        work.current.result
                          ? feedbackResultOf(work.current.result).checkResults
                          : null,
                      );
                      return {
                        ...(code ? { currentCode: code } : {}),
                        ...(lastRun ? { lastRunResult: lastRun } : {}),
                      };
                    }}
                  />
                }
              />
            )}
            <footer className="practice-item-footer">
              <ReportButton exerciseId={view.id} />
            </footer>
          </div>
        </>
      }
      work={
        <ExerciseRenderer
          exercise={exercise}
          value={answer}
          onChange={(next) => {
            changeAnswer(next as WebAnswer);
          }}
          disabled={submitting}
          labelledBy={promptId}
          {...(graded ? { feedback: feedbackResultOf(graded).feedback } : {})}
          checkResults={(graded ? feedbackResultOf(graded).checkResults : undefined) ?? null}
          onRun={() => void runPreview()}
          onStop={runner.abort}
          running={running || submitting}
          run={run}
          {...(drafts.statusText === undefined ? {} : { saveStatus: drafts.statusText })}
          preview={{
            mountRef: runner.previewMount,
            status: previewStatus,
            onRefresh: () => void runPreview(),
            ...(runner.previewNotice === null ? {} : { notice: runner.previewNotice }),
          }}
        />
      }
    />
  );
}

const STATE_ICONS = { passed: Check, pending: Circle, blocked: CornerLeftUp, unknown: Minus };
/** `blocked`: event checks after an earlier failed step may never have been reached. */
const STATE_LABELS = {
  passed: '통과',
  pending: '아직',
  blocked: '앞 단계 먼저',
  unknown: '채점 전',
};

/** Milestones with the result of the latest graded run (ui-ux.md 프로젝트 화면). */
export function MilestoneList({ project }: { project: ProjectView }) {
  const titleId = useId();
  const total = project.milestones.length;
  const next = project.milestones.find((m) => m.passed !== true);
  return (
    <section className="project-milestones" aria-labelledby={titleId}>
      <div className="project-milestones__head">
        <h2 id={titleId} className="project-milestones__title">
          마일스톤
        </h2>
        <span className="text-fg-secondary tabular-nums type-small">
          {total}개 중 {project.passedCount}개 통과
        </span>
      </div>
      <div
        className="project-milestones__bar"
        role="progressbar"
        aria-labelledby={titleId}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={project.passedCount}
        aria-valuetext={`${String(total)}개 중 ${String(project.passedCount)}개 통과`}
      >
        <span style={{ width: `${total === 0 ? 0 : (project.passedCount / total) * 100}%` }} />
      </div>
      <ol className="project-milestones__list">
        {project.milestones.map((m, i) => {
          const state =
            m.passed === true
              ? 'passed'
              : m.blocked
                ? 'blocked'
                : m.passed === false
                  ? 'pending'
                  : 'unknown';
          const Icon = STATE_ICONS[state];
          return (
            <li
              key={m.id}
              className="project-milestone"
              data-state={state}
              aria-current={
                next?.id === m.id && project.status !== 'completed' ? 'step' : undefined
              }
            >
              <Icon size={16} aria-hidden="true" className="project-milestone__icon" />
              <span className="project-milestone__title">
                {i + 1}단계 · {m.title}
              </span>
              <span className="project-milestone__state">{STATE_LABELS[state]}</span>
            </li>
          );
        })}
      </ol>
      {project.lastRun === null && (
        <p className="m-0 text-fg-tertiary type-small">
          아직 채점하지 않았어요. 첫 단계부터 만들고 채점해 보세요.
        </p>
      )}
    </section>
  );
}

/**
 * The unit's preparation practice: its own practice items as a lesson set (no pass rule), opened
 * in practice mode with `?set=` (D-048).
 */
function PreparationCard({ lesson, count }: { lesson: LessonDetail; count: number }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setPending(true);
    setError(null);
    try {
      const set = await createPracticeSet({ kind: 'lesson', lessonId: lesson.id });
      client.setQueryData(practiceSetQuery(set.id).queryKey, set);
      const next = set.items.findIndex((i) => i.id === set.nextItemId);
      await navigate({
        to: '/learn/$lessonId',
        params: { lessonId: lesson.id },
        search: { mode: 'practice', set: set.id, ...(next >= 0 ? { i: next + 1 } : {}) },
      });
    } catch (e) {
      setError(errorText(e));
      setPending(false);
    }
  };
  return (
    <section className="project-prep" aria-labelledby="project-prep-title">
      <div>
        <h2 id="project-prep-title" className="project-milestones__title">
          <Dumbbell size={16} aria-hidden="true" /> 준비 연습
        </h2>
        <p className="m-0 text-fg-secondary type-small">
          프로젝트에 쓰는 개념을 {count}문제로 먼저 연습해요. 프로젝트 완성과는 따로 셉니다.
        </p>
        {error && (
          <p role="alert" className="practice-error">
            {error}
          </p>
        )}
      </div>
      <Button size="sm" loading={pending} onClick={() => void start()}>
        준비 연습 하기
      </Button>
    </section>
  );
}

function CompletionCard({
  lesson,
  result,
}: {
  lesson: LessonDetail;
  result: ProjectAttemptResponse | null;
}) {
  return (
    <section className="project-complete" aria-label="프로젝트 완성">
      <p className="project-complete__title">
        <PartyPopper size={20} aria-hidden="true" />
        {result?.completedNow ? '모든 마일스톤을 통과했어요!' : '이 프로젝트를 완성했어요.'}
      </p>
      <p className="m-0 text-fg-secondary">
        프로젝트를 완성해 단원을 마쳤어요. 계속 다듬어서 다시 채점해도 완료는 그대로예요.
      </p>
      {lesson.next && (
        <Link
          to="/learn/$lessonId"
          params={{ lessonId: lesson.next.id }}
          search={{}}
          className="pi-button pi-button--primary pi-button--md justify-self-start no-underline"
        >
          다음: {lesson.next.title}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}
