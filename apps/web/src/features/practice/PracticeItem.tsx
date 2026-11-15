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
import {
  isWithheldAttempt,
  type AssessmentAttemptResponse,
  type AttemptResponse,
  type ExerciseView,
  type OpenedHint,
  type PracticeItemView,
  type PracticeSetView,
  type Remediation,
  type RunResult,
  type SolutionResponse,
  type SubmitAttemptResponse,
} from '@proginone/shared';
import { Badge, Button, ErrorState, Skeleton } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Lock, RotateCcw, SkipForward } from 'lucide-react';
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
import {
  ExerciseCode,
  feedbackResultOf,
  MasteryChangeList,
  ReportButton,
  SolutionContent,
} from './parts.tsx';
import {
  adaptationNote,
  addedItemLabel,
  MisconceptionProgress,
  RemediationCard,
  remediationWhy,
} from './Relearning.tsx';
import { AiHint } from '../tutor/AiHint.tsx';
import { AiMistakeExplanation } from '../tutor/AiMistakeExplanation.tsx';
import { codeFilesOf, runSummaryOf } from '../tutor/context.ts';
import { SELECTABLE_ATTR } from '../tutor/selection.ts';
import { useTutorScope } from '../tutor/TutorContext.tsx';

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
  /** Assessment items answer with the withheld shape (no outcome until the set ends). */
  onAnswered: (res: SubmitAttemptResponse) => void;
  onNavigate: (index: number) => void;
  /** Next pending item after this one, or null when every other item is answered. */
  nextPending: number | null;
  onShowSummary: () => void;
  /** Session heading for the tutor drawer header, e.g. "첫 프로그램 연습". */
  contextTitle?: string;
  /** Relearning suggestion to show above the problem (ui-ux.md 재학습 유도). */
  remediation?: Remediation | null;
  onFollowRemediation?: () => void;
  onDismissRemediation?: () => void;
  /** Records a skip (`POST …/skip`); without it "건너뛰기" only moves on. */
  onSkip?: () => Promise<void>;
  /** Worked example stage of an appended item ("풀이 예제 1/3"). */
  workedExample?: { stage: number; of: number } | null;
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

/** Types whose renderer already shows the exercise code (from the spec). */
const CODE_IN_SPEC = new Set(['predict_output', 'find_bug_line']);

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
  contextTitle,
  remediation = null,
  onFollowRemediation,
  onDismissRemediation,
  onSkip,
  workedExample = null,
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
  // An assessment in progress: hints, the solution and the tutor are locked, each item takes one
  // submission and its result is withheld until the end (learning-engine.md#단원-평가-세트).
  const assessment = set.kind === 'assessment' && set.status === 'active';
  const [submitted, setSubmitted] = useState<AssessmentAttemptResponse | null>(null);
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

  // What the tutor sees about this item: read when a question or AI hint is sent.
  const work = useRef({ answer, run, result });
  useEffect(() => {
    work.current = { answer, run, result };
  });
  const tutorCode = () => (isCode ? codeFilesOf(work.current.answer) : null);
  const tutorRun = () =>
    runSummaryOf(
      work.current.run,
      work.current.result ? feedbackResultOf(work.current.result).checkResults : null,
    );
  useTutorScope(
    assessment
      ? null
      : {
          scopeType: 'exercise',
          scopeId: view.id,
          title: `${contextTitle ?? '연습'} · 문제 ${index + 1}`,
          lessonId: view.lessonId ?? undefined,
          exerciseId: view.id,
          practiceSetItemId: item.id,
          getCode: tutorCode,
          getRun: tutorRun,
          hasCode: isCode,
          hasRun: run !== null,
          lastIncorrect: result !== null && result.attempt.outcome !== 'correct',
        },
  );

  // Problem change: focus the prompt heading (ui-ux.md 포커스 관리).
  useEffect(() => {
    if (autoFocus) headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
  }, []);
  const [skipping, setSkipping] = useState(false);
  const added = addedItemLabel(item.reason);

  const graded = result !== null || submitted !== null;
  const setOpen = (result?.set.status ?? submitted?.set.status ?? set.status) === 'active';
  /** Revisiting an assessment item answered earlier: nothing to show or resubmit. */
  const alreadySubmitted = assessment && submitted === null && item.status !== 'pending';
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
      setAttemptsHere(res.item.attempts);
      if (res.attempt.engineApplied) clearDraft(draftKey);
      if (isWithheldAttempt(res)) {
        if (res.attempt.engineApplied) setSubmitted(res);
        else setError('실행 환경 문제로 이번 제출은 기록하지 않았어요. 다시 제출해 주세요.');
        onAnswered(res);
        return;
      }
      setResult(res);
      setConfidence(choice);
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
    if (assessment || hintPending || hints.length >= view.hintCount) return;
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

  // An easier relearning item opens hint 1 by itself (learning-engine.md 재학습 규칙).
  const autoHint = useRef(
    item.reason === 'remedial_easier' && item.status === 'pending' && view.openedHints.length === 0,
  );
  useEffect(() => {
    if (!autoHint.current) return;
    autoHint.current = false;
    void revealHint();
  });

  const revealSolution = async () => {
    if (assessment) return;
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
    ...(graded || alreadySubmitted ? {} : { onSubmit: () => void submit(ask ? 'sure' : null) }),
    ...(view.requiresRun && isCode ? { onRun: () => void runInteractive() } : {}),
    ...(assessment ? {} : { onNextHint: () => void revealHint() }),
  });

  // An assessment does not name the concept of an item until the end (it would be a hint).
  const conceptShown = !assessment && (!hideConceptUntilGraded || result !== null);
  const goNext = () => {
    if (nextPending === null) onShowSummary();
    else onNavigate(nextPending);
  };
  const setDone = !setOpen;

  const actions: ReactNode = result !== null && (
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
      {/* Announced without moving focus; the card itself is not a live region. */}
      <p className="sr-only" aria-live="polite">
        {remediation ? `잠깐 쉬어가요. ${remediationWhy(remediation)}` : ''}
      </p>
      {remediation && (
        <RemediationCard
          remediation={remediation}
          onGo={() => onFollowRemediation?.()}
          onDismiss={() => onDismissRemediation?.()}
        />
      )}
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
        {added && (
          <Badge variant="brand">
            {workedExample
              ? `단계적 풀이 예제 ${String(workedExample.stage)}/${String(workedExample.of)}`
              : added}
          </Badge>
        )}
      </header>
      <div className="practice-problem__prompt">
        <Markdown text={view.prompt} />
      </div>
      {!CODE_IN_SPEC.has(exercise.typeId) && <ExerciseCode view={view} />}
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
              ...(runner.previewNotice === null ? {} : { notice: runner.previewNotice }),
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
      {submitted && (
        <div className="assessment-submitted" role="status">
          <p className="m-0">제출했어요. 정답과 해설은 평가가 끝나면 한꺼번에 보여 줘요.</p>
          {setOpen && nextPending !== null ? (
            <Button
              variant="primary"
              icon={<ArrowRight size={16} aria-hidden="true" />}
              onClick={goNext}
            >
              다음 문제
            </Button>
          ) : (
            <Button variant="primary" onClick={onShowSummary}>
              평가 결과 보기
            </Button>
          )}
        </div>
      )}
      {alreadySubmitted && (
        <p className="assessment-submitted m-0" role="note">
          <Lock size={14} aria-hidden="true" />
          이미 제출한 문항이에요. 답과 결과는 평가가 끝나면 볼 수 있어요.
        </p>
      )}
      {!graded && !alreadySubmitted && set.status === 'active' && (
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
      {result && !result.attempt.correct && result.attempt.engineApplied && (
        <AiMistakeExplanation key={result.attempt.id} attemptId={result.attempt.id} />
      )}
      {result && <MasteryChangeList changes={result.masteryChanges} />}
      {result && <MisconceptionProgress changes={result.misconceptionChanges} />}
      {result && adaptationNote(result.adaptations) && (
        <p className="text-fg-secondary type-small">{adaptationNote(result.adaptations)}</p>
      )}
      {result && !result.attempt.engineApplied && (
        <p className="text-fg-secondary type-small">
          실행 환경 문제로 이번 제출은 기록에 반영하지 않았어요. 다시 제출해 주세요.
        </p>
      )}
      {view.hintCount > 0 && !alreadySubmitted && (
        <HintLadder
          locked={assessment}
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
            !assessment && (
              <AiHint
                exerciseId={view.id}
                level={hints.length}
                request={() => {
                  const code = tutorCode();
                  const lastRun = tutorRun();
                  return {
                    practiceSetItemId: item.id,
                    ...(code ? { currentCode: code } : {}),
                    ...(lastRun ? { lastRunResult: lastRun } : {}),
                    ...(!isCode && work.current.answer !== null
                      ? { lastAnswer: JSON.stringify(work.current.answer).slice(0, 2_000) }
                      : {}),
                  };
                }}
              />
            )
          }
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
          {!graded &&
            item.status === 'pending' &&
            setOpen &&
            (onSkip !== undefined || nextPending !== null) && (
              <Button
                variant="ghost"
                size="sm"
                loading={skipping}
                icon={<SkipForward size={14} aria-hidden="true" />}
                onClick={() => {
                  if (!onSkip) {
                    if (nextPending !== null) onNavigate(nextPending);
                    return;
                  }
                  setSkipping(true);
                  void onSkip().finally(() => {
                    setSkipping(false);
                  });
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

  if (alreadySubmitted) {
    return (
      <div className="practice-layout practice-layout--single" data-exercise-id={view.id}>
        {problem}
        {response}
      </div>
    );
  }

  if (isCode) {
    return (
      <div
        {...{ [SELECTABLE_ATTR]: '' }}
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
      {...{ [SELECTABLE_ATTR]: '' }}
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
