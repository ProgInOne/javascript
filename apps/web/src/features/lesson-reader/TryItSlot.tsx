import {
  ExerciseRenderer,
  FeedbackBanner,
  HintLadder,
  initialAnswer,
  parsePublicSpec,
  type AnswerByType,
  type RenderableExercise,
  type RenderableTypeId,
} from '@proginone/exercise-ui';
import {
  SETTINGS_DEFAULTS,
  type CodeDraft,
  type ExerciseView,
  type OpenedHint,
  type RunResult,
  type SolutionResponse,
  type TryAttemptResponse,
} from '@proginone/shared';
import { Button, Skeleton } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, PenLine } from 'lucide-react';
import { useId, useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import {
  exerciseQuery,
  fetchRunPlan,
  openHint,
  submitTryAttempt,
  useSettings,
  viewSolution,
} from '../../api/queries.ts';
import {
  loadLocalDraft,
  pickDraft,
  useDraftSaver,
  useServerExerciseDraft,
} from '../drafts/drafts.ts';
import { useExerciseRunner } from '../practice/hooks.ts';
import { Markdown } from '../practice/Markdown.tsx';
import { CODE_TYPES } from '../practice/model.ts';
import { ExerciseCode, feedbackResultOf, SolutionContent } from '../practice/parts.tsx';
import { statusMessage } from '../runner/runner.ts';

type Answer = AnswerByType[RenderableTypeId];

function errorText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return '실행 환경을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

/**
 * "직접 써 보기" (`<TryIt ref>`, D-091): a small code task right after the example it builds on.
 * The learner writes the code in the lesson, runs it, and "확인" checks it against the task's
 * tests (`POST /exercises/:id/try-attempts`). Feedback only: nothing is recorded as an attempt
 * or mastery evidence, so it can be checked as often as needed. The code is kept as a draft.
 */
export function TryItSlot({ exerciseId }: { exerciseId: string }) {
  const query = useQuery(exerciseQuery(exerciseId, null));
  const isCode = query.data !== undefined && CODE_TYPES.has(query.data.type);
  const serverDraft = useServerExerciseDraft(exerciseId, isCode);
  if (query.isPending || !serverDraft.ready) return <Skeleton variant="block" height={320} />;
  const view = query.data;
  const exercise = view && isCode ? parsePublicSpec(view.type, view.publicSpec) : null;
  if (!view || !exercise) {
    return (
      <div className="lesson-inline-exercise" data-exercise-id={exerciseId}>
        <PenLine size={18} aria-hidden="true" />
        <span>이 직접 써 보기 과제를 불러오지 못했어요.</span>
      </div>
    );
  }
  return <TryItWorkspace view={view} exercise={exercise} serverDraft={serverDraft.draft} />;
}

function TryItWorkspace({
  view,
  exercise,
  serverDraft,
}: {
  view: ExerciseView;
  exercise: RenderableExercise;
  serverDraft: CodeDraft | null;
}) {
  const promptId = useId();
  const draftTarget = { kind: 'exercise', exerciseId: view.id } as const;
  const [answer, setAnswer] = useState<Answer>(() => {
    const draft = pickDraft([loadLocalDraft(draftTarget), serverDraft], null);
    return draft ? { files: draft.files } : initialAnswer(exercise);
  });
  const drafts = useDraftSaver(draftTarget, null);
  const runner = useExerciseRunner();
  const settings = useSettings().data ?? SETTINGS_DEFAULTS;
  const isWeb = exercise.typeId === 'web_task';

  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunResult | null>(null);
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<TryAttemptResponse | null>(null);
  /** Checked at least once: "먼저 풀어 보기" opens the hints after that (kept in the lesson). */
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hints, setHints] = useState<OpenedHint[]>(view.openedHints);
  const [hintPending, setHintPending] = useState(false);
  const [solution, setSolution] = useState<SolutionResponse | null>(null);
  const hintsWaitForTry =
    settings['hints.policy'] === 'after-attempt' && !tried && hints.length === 0;

  const changeAnswer = (next: Answer) => {
    setAnswer(next);
    // The feedback was about the code before this edit.
    setResult(null);
    const files = codeFilesOf(next);
    if (files) drafts.save(files);
  };

  const runInteractive = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    if (isWeb) setPreviewStatus('loading');
    try {
      const plan = await fetchRunPlan(view.id, { answer, purpose: 'interactive' });
      const res = isWeb ? await runner.preview(plan) : await runner.hidden(plan);
      setRun(res);
      if (isWeb) setPreviewStatus(res.status === 'crashed' ? 'error' : 'ready');
    } catch (e) {
      setError(errorText(e));
      if (isWeb) setPreviewStatus('error');
    } finally {
      setRunning(false);
    }
  };

  const check = async () => {
    if (checking || running) return;
    setChecking(true);
    setError(null);
    try {
      const plan = await fetchRunPlan(view.id, { answer, purpose: 'grading' });
      const runResult = await runner.hidden(plan);
      setRun(runResult);
      setResult(await submitTryAttempt(view.id, { answer, runResult }));
      setTried(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setChecking(false);
    }
    // The grading run is hidden; show the page as it is now.
    if (isWeb) void runInteractive();
  };

  const revealHint = async () => {
    if (hintsWaitForTry || hintPending || hints.length >= view.hintCount) return;
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

  const feedback = result ? feedbackResultOf(result) : null;
  const runNote = run && !result ? statusMessage(run) : null;

  return (
    <section className="lesson-try" aria-labelledby={promptId} data-exercise-id={view.id}>
      <div id={promptId} className="lesson-try__head">
        <p className="lesson-try__label">
          <PenLine size={16} aria-hidden="true" />
          직접 써 보기
        </p>
        <Markdown text={view.prompt} />
      </div>
      <ExerciseCode view={view} />
      <ExerciseRenderer
        exercise={exercise}
        value={answer}
        onChange={changeAnswer}
        disabled={checking}
        labelledBy={promptId}
        autocomplete={settings['editor.autocomplete']}
        checkResults={feedback?.checkResults ?? null}
        onRun={() => void runInteractive()}
        onStop={runner.abort}
        running={running || checking}
        run={run}
        {...(drafts.statusText === undefined ? {} : { saveStatus: drafts.statusText })}
        {...(isWeb
          ? {
              preview: {
                mountRef: runner.previewMount,
                status: previewStatus,
                onRefresh: () => void runInteractive(),
                ...(runner.previewNotice === null ? {} : { notice: runner.previewNotice }),
                documentTitle: runner.previewTitle,
              },
            }
          : {})}
      />
      <div className="lesson-try__actions">
        <Button
          variant="primary"
          icon={<CircleCheck size={16} aria-hidden="true" />}
          loading={checking}
          onClick={() => void check()}
        >
          확인
        </Button>
        <span className="text-fg-secondary type-small">
          {result?.attempt.correct
            ? '잘했어요. 코드를 바꿔 가며 더 실험해 봐도 좋아요.'
            : '써 본 코드를 테스트로 확인해요. 기록에는 남지 않으니 몇 번이든 확인해 보세요.'}
        </span>
      </div>
      {error && (
        <p role="alert" className="practice-error">
          {error}
        </p>
      )}
      {runNote && <p className="text-fg-secondary type-small">{runNote}</p>}
      <FeedbackBanner
        result={feedback}
        confidence={null}
        misconceptions={(result?.grade.misconceptions ?? []).map((m) => ({
          id: m.id,
          name: m.title,
        }))}
        {...(result ? { explanation: <Markdown text={result.grade.explanation} /> } : {})}
      />
      {view.hintCount > 0 && (
        <HintLadder
          locked={hintsWaitForTry}
          {...(hintsWaitForTry ? { lockedReason: '한 번 확인해 본 뒤에 열려요' } : {})}
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
          note="직접 써 보기는 숙련도에 반영되지 않아요. 막히면 편하게 열어 보세요."
        />
      )}
    </section>
  );
}

/** Editor files of a code answer (`{ files }`), or null for other answer shapes. */
function codeFilesOf(answer: unknown): { path: string; content: string }[] | null {
  if (!answer || typeof answer !== 'object' || !('files' in answer)) return null;
  const files = answer.files;
  if (!Array.isArray(files)) return null;
  return files.flatMap((f: unknown) => {
    if (!f || typeof f !== 'object') return [];
    const { path, content } = f as { path?: unknown; content?: unknown };
    return typeof path === 'string' && typeof content === 'string' ? [{ path, content }] : [];
  });
}
