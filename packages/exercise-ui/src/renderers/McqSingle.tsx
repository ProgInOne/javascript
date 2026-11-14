import type { McqSingleAnswer, McqSinglePublicSpec } from '@proginone/exercise-kit';
import { Check, X } from 'lucide-react';
import { useId, useRef, type KeyboardEvent } from 'react';
import { InlineText } from '../text/InlineText.tsx';
import type { RendererBaseProps } from '../types.ts';

export interface McqSingleProps extends Omit<
  RendererBaseProps<McqSinglePublicSpec, McqSingleAnswer | null>,
  'onChange'
> {
  onChange: (answer: McqSingleAnswer) => void;
  /**
   * After grading: the correct option, when the server reveals it. Marks "정답" and, if the learner
   * chose another option, "내가 고른 답" on theirs.
   */
  correctOptionId?: string | null;
}

/**
 * `mcq_single` (docs/design/content-and-exercises.md#mcq_single-단일-선택): option cards in a native
 * radio group (arrow keys move and select). Number keys `1`–`5` pick an option while focus is in the
 * group; Enter is left to the page's submit binding.
 */
export function McqSingle({
  spec,
  value,
  onChange,
  disabled = false,
  labelledBy,
  correctOptionId = null,
}: McqSingleProps) {
  const name = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const graded = correctOptionId !== null;

  const select = (optionId: string) => {
    if (!disabled) onChange({ optionId });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = Number.parseInt(event.key, 10);
    if (!Number.isInteger(index) || index < 1 || index > spec.options.length) return;
    const option = spec.options[index - 1];
    if (!option || disabled) return;
    event.preventDefault();
    select(option.id);
    groupRef.current
      ?.querySelector<HTMLInputElement>(`input[value="${CSS.escape(option.id)}"]`)
      ?.focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : '선택지'}
      aria-disabled={disabled || undefined}
      className="pi-ex-choices"
      onKeyDown={onKeyDown}
    >
      {spec.options.map((option, index) => {
        const checked = value?.optionId === option.id;
        const state = !graded
          ? undefined
          : option.id === correctOptionId
            ? 'correct'
            : checked
              ? 'incorrect'
              : undefined;
        return (
          <label
            key={option.id}
            className="pi-ex-choice"
            data-checked={checked || undefined}
            data-state={state}
            data-disabled={disabled || undefined}
          >
            <input
              type="radio"
              className="pi-ex-choice__input"
              name={name}
              value={option.id}
              checked={checked}
              disabled={disabled}
              onChange={() => {
                select(option.id);
              }}
            />
            <span className="pi-ex-choice__key" aria-hidden="true">
              {index + 1}
            </span>
            <span className="pi-ex-choice__text">
              {spec.codeOptions ? (
                <code className="pi-ex-choice__code">{option.text}</code>
              ) : (
                <InlineText text={option.text} />
              )}
            </span>
            {state === 'correct' && (
              <span className="pi-ex-choice__mark">
                <Check size={16} aria-hidden="true" />
                정답
              </span>
            )}
            {state === 'incorrect' && (
              <span className="pi-ex-choice__mark">
                <X size={16} aria-hidden="true" />
                내가 고른 답
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
