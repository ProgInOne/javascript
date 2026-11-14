import { Button } from '@proginone/ui';
import { useId, useState } from 'react';
import { CONFIDENCE_LABELS, CONFIDENCE_LEVELS, type Confidence } from '../types.ts';
import { Kbd } from './Kbd.tsx';
import { ariaShortcut, modKeyLabel } from './shortcuts.ts';

export interface ConfidencePickerProps {
  /**
   * Called with the chosen confidence, or `null` when confidence input is off.
   * Bind `⌘Enter` to `onSubmit('sure')` with `useExerciseShortcuts` (the page owns shortcuts).
   */
  onSubmit: (confidence: Confidence | null) => void;
  /**
   * Ask for confidence (default). `false` (setting off, or a repeated submission of a test-graded
   * exercise) shows a single "제출" button and records no confidence.
   */
  askConfidence?: boolean;
  /**
   * Why submitting is not possible yet (e.g. "답을 먼저 골라 주세요"). The buttons stay focusable
   * (`aria-disabled`) and the reason is announced as their description.
   */
  disabledReason?: string | null;
  /** Grading in progress: the pressed button shows a spinner and further presses are ignored. */
  submitting?: boolean;
  /** Label of the single button when confidence is off. Default "제출". */
  submitLabel?: string;
}

/**
 * Submit buttons split by confidence (docs/design/ui-ux.md#확신도-입력-타이밍): the learner commits
 * to an answer and states confidence in one step, before seeing the result.
 */
export function ConfidencePicker({
  onSubmit,
  askConfidence = true,
  disabledReason = null,
  submitting = false,
  submitLabel = '제출',
}: ConfidencePickerProps) {
  const questionId = useId();
  const reasonId = useId();
  const [pressed, setPressed] = useState<Confidence | 'single' | null>(null);
  const blocked = disabledReason !== null || submitting;
  const mod = modKeyLabel();

  const press = (choice: Confidence | null) => {
    if (blocked) return;
    setPressed(choice ?? 'single');
    onSubmit(choice);
  };

  const reason = disabledReason !== null && (
    <p id={reasonId} className="pi-ex-confidence__reason">
      {disabledReason}
    </p>
  );
  const describedBy = disabledReason !== null ? reasonId : undefined;

  if (!askConfidence) {
    return (
      <div className="pi-ex-confidence">
        <div className="pi-ex-confidence__buttons">
          <Button
            variant="primary"
            aria-disabled={blocked || undefined}
            aria-describedby={describedBy}
            aria-keyshortcuts={ariaShortcut('Enter')}
            loading={submitting && pressed === 'single'}
            onClick={() => {
              press(null);
            }}
          >
            {submitLabel}
            <Kbd keys={[mod, 'Enter']} />
          </Button>
        </div>
        {reason}
      </div>
    );
  }

  return (
    <div className="pi-ex-confidence" role="group" aria-labelledby={questionId}>
      <p id={questionId} className="pi-ex-confidence__question">
        답을 골랐다면, 얼마나 확신하나요?
      </p>
      <div className="pi-ex-confidence__buttons">
        {CONFIDENCE_LEVELS.map((level) => (
          <Button
            key={level}
            variant={level === 'sure' ? 'primary' : 'secondary'}
            aria-disabled={blocked || undefined}
            aria-describedby={describedBy}
            aria-keyshortcuts={level === 'sure' ? ariaShortcut('Enter') : undefined}
            loading={submitting && pressed === level}
            onClick={() => {
              press(level);
            }}
          >
            {CONFIDENCE_LABELS[level]}
            {level === 'sure' && <Kbd keys={[mod, 'Enter']} />}
          </Button>
        ))}
      </div>
      {reason}
    </div>
  );
}
