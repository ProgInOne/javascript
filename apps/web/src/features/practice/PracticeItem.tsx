import {
  ConfidencePicker,
  ExerciseRenderer,
  FeedbackBanner,
  HintLadder,
  initialAnswer,
  isAnswerReady,
  notReadyReason,
  parsePublicSpec,
  useExerciseShortcuts,
  type AnswerByType,
  type Confidence,
  type RenderableExercise,
  type RenderableTypeId,
} from '@proginone/exercise-ui';
import type {
  AttemptResponse,
  ExerciseView,
  OpenedHint,
  PracticeItemView,
  PracticeSetView,
  RunResult,
  SolutionResponse,
} from '@proginone/shared';
import { Badge, Button, ErrorState, Skeleton } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, RotateCcw, SkipForward } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import {
  exerciseQuery,
  fetchRunPlan,
  openHint,
  submitAttempt,
  viewSolution,
} from '../../api/queries.ts';
import { examplePlan, statusMessage } from '../runner/runner.ts';
import { clearDraft, loadDraft, saveDraft, useActiveTime, useExerciseRunner } from './hooks.ts';
import { Markdown } from './Markdown.tsx';
import { CODE_TYPES, TYPE_LABELS } from './model.ts';
import { feedbackResultOf, MasteryChangeList, ReportButton, SolutionContent } from './parts.tsx';

type Answer = AnswerByType[RenderableTypeId];

export interface PracticeItemProps {
  set: PracticeSetView;
  item: PracticeItemView;
  /** 0-based position in the set. */
  index: number;
  /** Review sets hide the concept until the answer is graded (interleaving, ui-ux.md 복습 화면). */
  hideConceptUntilGraded: boolean;
  /** Move focus to the prompt heading on mount (problem change, ui-ux.md 포커스 관리). */
  autoFocus?: boolean;
  /** Ask for confidence on submission (setting, default on). */
  askConfidence?: boolean;
  onAnswered: (res: AttemptResponse) => void;
  onNavigate: (index: number) => void;
  /** Next pending item after this one, or null when every other item is answered. */
  nextPending: number | null;
  onShowSummary: () => void;
}

/** One practice set item: the exercise, submission, feedback and hints (ui-ux.md 실습 모드). */
export function PracticeItem(props: PracticeItemProps) {
  const query = useQuery(exerciseQuery(props.item.exerciseId, props.item.id));
  if (query.isPending) return <Skeleton variant="card" height={360} />;
  if (query.isError) {
    const e = query.error instanceof ApiRequestError ? query.error : null;
    return (
      <ErrorState
        variant="panel"
        title="문제를 불러오지 못했어요"
        description={e?.message ?? '잠시 후 다시 시도해 주세요.'}
        code={e?.code ?? 'INTERNAL'}
        action={<Button onClick={() => void query.refetch()}>다시 시도</Button>}
      />
    );
  }
  const exercise = parsePublicSpec(query.data.type, query.data.publicSpec);
  if (!exercise) {
    return (
      <ErrorState
        variant="panel"
        title="이 문제를 표시할 수 없어요"
        description="이 버전에서 지원하지 않는 문제 형식이에요. 건너뛰고 다음 문제를 풀어 주세요."
        code="EXERCISE_UNSUPPORTED"
      />
    );
  }
  return <ItemWorkspace {...props} view={query.data} exercise={exercise} />;
}

function errorText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return '실행 환경을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

function ItemWorkspace({
  set,
  item,
  index,
  hideConceptUntilGraded,
  autoFocus = false,
  askConfidence = true,
  onAnswered,
  onNavigate,
  nextPending,
  onShowSummary,
  view,
  exercise,
}: PracticeItemProps & { view: ExerciseView; exercise: RenderableExercise }) {
  const promptId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isCode = CODE_TYPES.has(exercise.typeId);
  const draftKey = `${set.id}:${item.id}`;
  const [answer, setAnswer] = useState<Answer>(() => {
    const draft = isCode ? loadDraft(draftKey) : undefined;
    return (draft as Answer | undefined) ?? initialAnswer(exercise);
  });
  const [saved, setSaved] = useState<number | null>(null);
  const [result, setResult] = useState<AttemptResponse | null>(null);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunResult | null>(null);
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [actual, setActual] = useState<RunResult | null>(null);
  const [hints, setHints] = useState<OpenedHint[]>(view.openedHints);
  const [hintPending, setHintPending] = useState(false);
  const [solution, setSolution] = useState<SolutionResponse | null>(null);
  const [attemptsHere, setAttemptsHere] = useState(item.attempts);
  const runner = useExerciseRunner();
  const timing = useActiveTime();

  // Problem change: focus the prompt heading (ui-ux.md 포커스 관리).
  useEffect(() => {
    if (autoFocus) headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
  }, []);

  const graded = result !== null;
  const setOpen = (result?.set.status ?? set.status) === 'active';
  const ready = isAnswerReady(exercise, answer);
  // Test-graded exercises ask for confidence on the first submission only.
  const ask = askConfidence && !(isCode && attemptsHere > 0);

  const changeAnswer = (next: Answer) => {
    setAnswer(next);
    if (isCode && saveDraft(draftKey, next)) setSaved(Date.now());
  };

  const runInteractive = async () => {
    if (!view.requiresRun || running) return;
    setRunning(true);
    setError(null);
    if (exercise.typeId === 'web_task') setPreviewStatus('loading');
    try {
      const plan = await fetchRunPlan(view.id, { answer, purpose: 'interactive' });
      const res =
        exercise.typeId === 'web_task' ? await runner.preview(plan) : await runner.hidden(plan);
      setRun(res);
      if (exercise.typeId === 'web_task')
        setPreviewStatus(res.status === 'crashed' ? 'error' : 'ready');
    } catch (e) {
      setError(errorText(e));
      if (exercise.typeId === 'web_task') setPreviewStatus('error');
    } finally {
      setRunning(false);
    }
  };

  const submit = async (choice: Confidence | null) => {
    if (graded || submitting || set.status !== 'active') return;
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    try {
      let runResult: RunResult | undefined;
      if (view.requiresRun) {
        const plan = await fetchRunPlan(view.id, { answer, purpose: 'grading' });
        runResult = await runner.hidden(plan);
        setRun(runResult);
      }
      const res = await submitAttempt({
        practiceSetItemId: item.id,
        exerciseId: view.id,
        answer,
        ...(runResult === undefined ? {} : { runResult }),
        confidence: choice,
        startedAt: timing.startedAt,
        activeMs: timing.readActiveMs(),
      });
      setResult(res);
      setConfidence(choice);
      setAttemptsHere(res.item.attempts);
      if (res.attempt.engineApplied) clearDraft(draftKey);
      onAnswered(res);
      if (exercise.typeId === 'web_task') void runInteractive();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSubmitting(false);
    }
  };

  const retry = () => {
    setResult(null);
    setConfidence(null);
    setActual(null);
    headingRef.current?.focus();
  };

  const revealHint = async () => {
    if (hintPending || hints.length >= view.hintCount) return;
    setHintPending(true);
    try {
      const res = await openHint(view.id, item.id);
      setHints((h) => [...h, { level: res.level, text: res.text }]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setHintPending(false);
    }
  };

  const revealSolution = async () => {
    try {
      setSolution(await viewSolution(view.id, item.id));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const runActual =
    exercise.typeId === 'predict_output' && exercise.spec.lang === 'js'
      ? async () => {
          setRunning(true);
          try {
            setActual(await runner.hidden(examplePlan('js', exercise.spec.code)));
          } catch (e) {
            setError(errorText(e));
          } finally {
            setRunning(false);
          }
        }
      : undefined;

  useExerciseShortcuts({
    ...(graded ? {} : { onSubmit: () => void submit(ask ? 'sure' : null) }),
    ...(view.requiresRun && isCode ? { onRun: () => void runInteractive() } : {}),
    onNextHint: () => void revealHint(),
  });

  const conceptShown = !hideConceptUntilGraded || graded;
  const goNext = () => {
    if (nextPending === null) onShowSummary();
    else onNavigate(nextPending);
  };
  const setDone = !setOpen;

  const actions: ReactNode = graded && (
    <>
      {result.attempt.outcome !== 'correct' && setOpen && (
        <Button icon={<RotateCcw size={16} aria-hidden="true" />} onClick={retry}>
          다시 풀기
        </Button>
      )}
      {setDone ? (
        <Button variant="primary" onClick={onShowSummary}>
          결과 보기
        </Button>
      ) : (
        <Button
          variant={result.attempt.outcome === 'correct' ? 'primary' : 'secondary'}
          icon={<ArrowRight size={16} aria-hidden="true" />}
          onClick={goNext}
        >
          {nextPending === null ? '결과 보기' : '다음 문제'}
        </Button>
      )}
    </>
  );

  const problem = (
    <div className="practice-problem">
      <header className="practice-problem__meta">
        <h2 ref={headingRef} tabIndex={-1} className="practice-problem__title" id={promptId}>
          문제 {index + 1}
          <span className="sr-only"> / {set.items.length}</span>
        </h2>
        <span className="text-fg-secondary type-small">
          {TYPE_LABELS[exercise.typeId] ?? exercise.typeId}
        </span>
        <span className="text-fg-tertiary type-small" title={`난이도 L${view.difficulty}`}>
          L{view.difficulty}
        </span>
        {conceptShown && item.targetConcept && (
          <Badge variant="neutral">개념: {item.targetConcept.title}</Badge>
        )}
      </header>
      <div className="practice-problem__prompt">
        <Markdown text={view.prompt} />
      </div>
      {view.code !== null && exercise.typeId !== 'predict_output' && (
        <Markdown text={'```\n' + view.code.replace(/\n$/, '') + '\n```'} />
      )}
    </div>
  );

  const renderer = (
    <ExerciseRenderer
      exercise={exercise}
      value={answer}
      onChange={changeAnswer}
      disabled={graded || submitting}
      labelledBy={promptId}
      {...(result ? { feedback: feedbackResultOf(result).feedback } : {})}
      checkResults={(result ? feedbackResultOf(result).checkResults : undefined) ?? null}
      {...(view.requiresRun && isCode
        ? {
            onRun: () => void runInteractive(),
            onStop: runner.abort,
            running: running || submitting,
            run,
          }
        : {})}
      {...(graded && runActual ? { onRunActual: () => void runActual(), actual } : {})}
      {...(saved !== null ? { saveStatus: '저장됨 · 이 브라우저' } : {})}
      {...(exercise.typeId === 'web_task'
        ? {
            preview: {
              mountRef: runner.previewMount,
              status: previewStatus,
              onRefresh: () => void runInteractive(),
            },
          }
        : {})}
    />
  );

  const runNote = run && statusMessage(run);

  const response = (
    <div className="practice-response">
      {!graded && set.status !== 'active' && (
        <div className="practice-closed">
          <p>이 연습 세트는 이미 끝났어요.</p>
          <Button variant="primary" onClick={onShowSummary}>
            결과 보기
          </Button>
        </div>
      )}
      {!graded && set.status === 'active' && (
        <ConfidencePicker
          onSubmit={(c) => void submit(c)}
          askConfidence={ask}
          disabledReason={ready ? null : notReadyReason(exercise)}
          submitting={submitting}
        />
      )}
      {error && (
        <p role="alert" className="practice-error">
          {error}
        </p>
      )}
      {runNote && !graded && isCode && <p className="text-fg-secondary type-small">{runNote}</p>}
      <FeedbackBanner
        result={result ? feedbackResultOf(result) : null}
        confidence={confidence}
        misconceptions={(result?.grade.misconceptions ?? []).map((m) => ({
          id: m.id,
          name: m.title,
        }))}
        {...(result ? { explanation: <Markdown text={result.grade.explanation} /> } : {})}
        actions={actions}
      />
      {result && <MasteryChangeList changes={result.masteryChanges} />}
      {result && !result.attempt.engineApplied && (
        <p className="text-fg-secondary type-small">
          실행 환경 문제로 이번 제출은 기록에 반영하지 않았어요. 다시 제출해 주세요.
        </p>
      )}
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
        />
      )}
      <footer className="practice-item-footer">
        <ReportButton exerciseId={view.id} />
        <div className="flex gap-2">
          {index > 0 && (
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft size={14} aria-hidden="true" />}
              onClick={() => {
                onNavigate(index - 1);
              }}
            >
              이전 문제
            </Button>
          )}
          {!graded && item.status === 'pending' && nextPending !== null && (
            <Button
              variant="ghost"
              size="sm"
              icon={<SkipForward size={14} aria-hidden="true" />}
              onClick={() => {
                onNavigate(nextPending);
              }}
            >
              건너뛰기
            </Button>
          )}
          {!graded && item.status !== 'pending' && index < set.items.length - 1 && (
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowRight size={14} aria-hidden="true" />}
              onClick={() => {
                onNavigate(index + 1);
              }}
            >
              다음 문제
            </Button>
          )}
        </div>
      </footer>
    </div>
  );

  if (isCode) {
    return (
      <div
        className={`practice-layout practice-layout--code${exercise.typeId === 'web_task' ? 'practice-layout--web' : ''}`}
        data-type={exercise.typeId}
        data-exercise-id={view.id}
      >
        <div className="practice-layout__problem">
          {problem}
          {response}
        </div>
        <div className="practice-layout__work">{renderer}</div>
      </div>
    );
  }
  return (
    <div
      className="practice-layout practice-layout--single"
      data-type={exercise.typeId}
      data-exercise-id={view.id}
    >
      {problem}
      {renderer}
      {response}
    </div>
  );
}
