import {
  ConfidencePicker,
  ExerciseRenderer,
  FeedbackBanner,
  initialAnswer,
  isAnswerReady,
  matchExerciseShortcut,
  notReadyReason,
  parsePublicSpec,
  type AnswerByType,
  type Confidence,
  type RenderableExercise,
  type RenderableTypeId,
} from '@proginone/exercise-ui';
import type { ExerciseView, InlineAttemptResponse } from '@proginone/shared';
import { Button, Skeleton } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { ListChecks, RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { exerciseQuery, submitInlineAttempt } from '../../api/queries.ts';
import { useActiveTime } from '../practice/hooks.ts';
import { Markdown } from '../practice/Markdown.tsx';
import { feedbackResultOf, MasteryChangeList } from '../practice/parts.tsx';

/** Short types answered in the body (ui-ux.md 읽기 모드: 객관식·빈칸 등 짧은 유형만). */
const INLINE_TYPES = new Set([
  'mcq_single',
  'mcq_multi',
  'true_false',
  'fill_blank',
  'predict_output',
]);

/**
 * Inline check exercise (`<InlineExercise ref>`): answered while reading, graded at once by
 * `POST /exercises/:id/inline-attempts` (counts as mastery evidence, no practice set). Exercises
 * that need a code run are left to practice mode.
 */
export function InlineExerciseSlot({ exerciseId }: { exerciseId: string }) {
  const query = useQuery(exerciseQuery(exerciseId, null));
  if (query.isPending) return <Skeleton variant="block" height={160} />;
  const view = query.data;
  const exercise = view ? parsePublicSpec(view.type, view.publicSpec) : null;
  if (!view || !exercise || view.requiresRun || !INLINE_TYPES.has(view.type)) {
    return (
      <div className="lesson-inline-exercise" data-exercise-id={exerciseId}>
        <ListChecks size={18} aria-hidden="true" />
        <span>이 확인 문제는 실습 모드에서 풀 수 있어요.</span>
      </div>
    );
  }
  return <InlineCheck view={view} exercise={exercise} />;
}

type Answer = AnswerByType[RenderableTypeId];

function InlineCheck({ view, exercise }: { view: ExerciseView; exercise: RenderableExercise }) {
  const promptId = useId();
  const [answer, setAnswer] = useState<Answer>(() => initialAnswer(exercise));
  const [result, setResult] = useState<InlineAttemptResponse | null>(null);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timing = useActiveTime();
  const ready = isAnswerReady(exercise, answer);

  const submit = async (choice: Confidence | null) => {
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitInlineAttempt(view.id, {
        answer,
        confidence: choice,
        startedAt: timing.startedAt,
        activeMs: timing.readActiveMs(),
      });
      setResult(res);
      setConfidence(choice);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '채점하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="lesson-inline-check"
      aria-labelledby={promptId}
      data-exercise-id={view.id}
      // ⌘Enter submits while focus is inside this check (several checks share the page).
      onKeyDown={(e) => {
        if (result === null && matchExerciseShortcut(e) === 'onSubmit') {
          e.preventDefault();
          void submit('sure');
        }
      }}
    >
      <div id={promptId}>
        <p className="lesson-inline-check__label">확인 문제</p>
        <Markdown text={view.prompt} />
      </div>
      {view.code !== null && exercise.typeId !== 'predict_output' && (
        <Markdown text={'```\n' + view.code.replace(/\n$/, '') + '\n```'} />
      )}
      <ExerciseRenderer
        exercise={exercise}
        value={answer}
        onChange={setAnswer}
        disabled={result !== null || submitting}
        labelledBy={promptId}
        {...(result ? { feedback: feedbackResultOf(result).feedback } : {})}
      />
      {!result && (
        <ConfidencePicker
          onSubmit={(c) => void submit(c)}
          disabledReason={ready ? null : notReadyReason(exercise)}
          submitting={submitting}
        />
      )}
      {error && (
        <p role="alert" className="practice-error">
          {error}
        </p>
      )}
      <FeedbackBanner
        result={result ? feedbackResultOf(result) : null}
        confidence={confidence}
        misconceptions={(result?.grade.misconceptions ?? []).map((m) => ({
          id: m.id,
          name: m.title,
        }))}
        {...(result ? { explanation: <Markdown text={result.grade.explanation} /> } : {})}
        actions={
          result &&
          result.attempt.outcome !== 'correct' && (
            <Button
              icon={<RotateCcw size={16} aria-hidden="true" />}
              onClick={() => {
                setResult(null);
                setConfidence(null);
              }}
            >
              다시 풀기
            </Button>
          )
        }
      />
      {result && <MasteryChangeList changes={result.masteryChanges} />}
    </section>
  );
}
