import type { McqMultiAnswer, McqMultiPublicSpec } from '@proginone/exercise-kit';
import { useId, useRef, type KeyboardEvent } from 'react';
import { InlineText } from '../text/InlineText.tsx';
import type { RendererBaseProps } from '../types.ts';

export type McqMultiProps = RendererBaseProps<McqMultiPublicSpec, McqMultiAnswer>;

/** Instruction above the options. The number of correct options is never shown. */
export function mcqMultiInstruction(minSelect: number): string {
  return minSelect > 1
    ? `해당하는 것을 모두 고르세요(${minSelect}개 이상). 정답이 여러 개일 수 있어요.`
    : '해당하는 것을 모두 고르세요. 정답이 여러 개일 수 있어요.';
}

/**
 * `mcq_multi` (docs/design/content-and-exercises.md#mcq_multi-복수-선택): option cards with native
 * checkboxes in a labelled group (`Tab` moves, `Space` toggles). Number keys `1`–`6` toggle an
 * option while focus is in the group; Enter is left to the page's submit binding.
 */
export function McqMulti({ spec, value, onChange, disabled = false, labelledBy }: McqMultiProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const chosen = new Set(value.optionIds);

  const toggle = (optionId: string) => {
    if (disabled) return;
    const next = new Set(chosen);
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
    // Keep the public option order so the answer is stable whatever the click order.
    onChange({ optionIds: spec.options.map((o) => o.id).filter((id) => next.has(id)) });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = Number.parseInt(event.key, 10);
    if (!Number.isInteger(index) || index < 1 || index > spec.options.length) return;
    const option = spec.options[index - 1];
    if (!option || disabled) return;
    event.preventDefault();
    toggle(option.id);
    groupRef.current
      ?.querySelector<HTMLInputElement>(`input[value="${CSS.escape(option.id)}"]`)
      ?.focus();
  };

  return (
    <div className="pi-ex-choice-set">
      <p id={noteId} className="pi-ex-choice-set__note">
        {mcqMultiInstruction(spec.minSelect)}
      </p>
      <div
        ref={groupRef}
        role="group"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : '선택지'}
        aria-describedby={noteId}
        aria-disabled={disabled || undefined}
        className="pi-ex-choices"
        onKeyDown={onKeyDown}
      >
        {spec.options.map((option, index) => {
          const checked = chosen.has(option.id);
          return (
            <label
              key={option.id}
              className="pi-ex-choice"
              data-multi=""
              data-checked={checked || undefined}
              data-disabled={disabled || undefined}
            >
              <input
                type="checkbox"
                className="pi-ex-choice__input"
                value={option.id}
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  toggle(option.id);
                }}
              />
              <span className="pi-ex-choice__key pi-ex-choice__key--box" aria-hidden="true">
                {index + 1}
              </span>
              <span className="pi-ex-choice__text">
                {spec.codeOptions ? (
                  <code className="pi-ex-choice__code">{option.text}</code>
                ) : (
                  <InlineText text={option.text} />
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
