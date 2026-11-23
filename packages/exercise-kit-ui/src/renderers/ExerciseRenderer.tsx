import type {
  CodeAnswer,
  FeedbackItem,
  FillBlankAnswer,
  ParsonsAnswer,
} from '@proginone/exercise-kit';
import type { RunResult } from '@proginone/run-contract';
import type { AnswerByType, RenderableExercise, RenderableTypeId } from '../exercise.ts';
import type { PreviewFrameProps } from '../preview/PreviewFrame.tsx';
import { FixBug, ImplementFunction, WebTask } from './CodeRenderers.tsx';
import type { CodeRunProps } from './CodeWorkspace.tsx';
import { FillBlank } from './FillBlank.tsx';
import { FindBugLine, type FindBugLineDraft } from './FindBugLine.tsx';
import { ChoiceRenderer, type ChoiceAnswerByType, type ChoiceTypeId } from '@proginone/exercise-ui';
import { Parsons } from './Parsons.tsx';
import { PredictOutput } from './PredictOutput.tsx';

export interface ExerciseRendererProps extends CodeRunProps {
  exercise: RenderableExercise;
  /** Answer for `exercise.typeId` (start from `initialAnswer(exercise)`). */
  value: AnswerByType[RenderableTypeId];
  onChange: (answer: NonNullable<AnswerByType[RenderableTypeId]>) => void;
  disabled?: boolean;
  labelledBy?: string;
  /** Grader feedback (fill_blank marks blanks, parsons and find_bug_line mark lines from it). */
  feedback?: readonly FeedbackItem[];
  /** mcq_single: correct option revealed after grading. */
  correctOptionId?: string | null;
  /** predict_output: "실제로 실행" after submission, and its result. */
  onRunActual?: () => void;
  actual?: RunResult | null;
  /** web_task: preview container props (runner mount point, status, refresh). */
  preview?: Omit<PreviewFrameProps, 'label'>;
}

/**
 * Picks the renderer for `exercise.typeId`. Convenience for the practice page; each renderer is
 * also exported for direct use.
 */
export function ExerciseRenderer(props: ExerciseRendererProps) {
  const { exercise, value, onChange, feedback, correctOptionId, onRunActual, actual, preview } =
    props;
  const base = {
    disabled: props.disabled ?? false,
    ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
  };
  const run: CodeRunProps = {
    ...(props.onRun === undefined ? {} : { onRun: props.onRun }),
    ...(props.onStop === undefined ? {} : { onStop: props.onStop }),
    ...(props.running === undefined ? {} : { running: props.running }),
    ...(props.run === undefined ? {} : { run: props.run }),
    ...(props.checkResults === undefined ? {} : { checkResults: props.checkResults }),
    ...(props.saveStatus === undefined ? {} : { saveStatus: props.saveStatus }),
    ...(props.autocomplete === undefined ? {} : { autocomplete: props.autocomplete }),
    ...(props.timeoutMs === undefined ? {} : { timeoutMs: props.timeoutMs }),
  };

  switch (exercise.typeId) {
    case 'mcq_single':
    case 'mcq_multi':
    case 'true_false':
      return (
        <ChoiceRenderer
          {...base}
          exercise={exercise}
          value={value as ChoiceAnswerByType[ChoiceTypeId]}
          onChange={onChange}
          correctOptionId={correctOptionId ?? null}
        />
      );
    case 'fill_blank':
      return (
        <FillBlank
          {...base}
          spec={exercise.spec}
          value={value as FillBlankAnswer}
          onChange={onChange}
          {...(feedback === undefined ? {} : { feedback })}
          checkResults={props.checkResults ?? null}
        />
      );
    case 'predict_output':
      return (
        <PredictOutput
          {...base}
          spec={exercise.spec}
          value={value as AnswerByType['predict_output']}
          onChange={onChange}
          {...(onRunActual === undefined ? {} : { onRunActual })}
          actual={actual ?? null}
          running={props.running ?? false}
        />
      );
    case 'parsons':
      return (
        <Parsons
          {...base}
          spec={exercise.spec}
          value={value as ParsonsAnswer}
          onChange={onChange}
          {...(feedback === undefined ? {} : { feedback })}
          checkResults={props.checkResults ?? null}
        />
      );
    case 'find_bug_line':
      return (
        <FindBugLine
          {...base}
          spec={exercise.spec}
          value={value as FindBugLineDraft}
          onChange={onChange}
          {...(feedback === undefined ? {} : { feedback })}
        />
      );
    case 'implement_function':
      return (
        <ImplementFunction
          {...base}
          {...run}
          spec={exercise.spec}
          value={value as CodeAnswer}
          onChange={onChange}
        />
      );
    case 'fix_bug':
      return (
        <FixBug
          {...base}
          {...run}
          spec={exercise.spec}
          value={value as CodeAnswer}
          onChange={onChange}
        />
      );
    case 'web_task':
      return (
        <WebTask
          {...base}
          {...run}
          spec={exercise.spec}
          value={value as CodeAnswer}
          onChange={onChange}
          {...(preview === undefined ? {} : { preview })}
        />
      );
  }
}
