import type { TrueFalseAnswer, TrueFalsePublicSpec } from '@proginone/exercise-kit';
import { useId, useRef, type KeyboardEvent } from 'react';
import { InlineText } from '../text/InlineText.tsx';
import type { RendererBaseProps } from '../types.ts';

/** Answer while being edited: the verdict and the reason can be picked in any order. */
export type TrueFalseDraft = Partial<TrueFalseAnswer>;

export type TrueFalseProps = RendererBaseProps<TrueFalsePublicSpec, TrueFalseDraft>;

const VERDICTS = [
  { value: true, label: '참', key: '1' },
  { value: false, label: '거짓', key: '2' },
] as const;

/**
 * `true_false` (docs/design/content-and-exercises.md#true_false-참거짓): the statement in a card,
 * then a 참/거짓 radio group (arrow keys, or `1`/`2`) and, when the exercise asks for it, a reason
 * radio group with the same ChoiceOption cards as `mcq_single`.
 */
export function TrueFalse({ spec, value, onChange, disabled = false, labelledBy }: TrueFalseProps) {
  const name = useId();
  const statementId = useId();
  const reasonLabelId = useId();
  const verdictRef = useRef<HTMLDivElement>(null);

  const update = (patch: TrueFalseDraft) => {
    if (!disabled) onChange({ ...value, ...patch });
  };

  const onVerdictKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const verdict = VERDICTS.find((v) => v.key === event.key);
    if (!verdict || disabled) return;
    event.preventDefault();
    update({ value: verdict.value });
    verdictRef.current
      ?.querySelector<HTMLInputElement>(`input[value="${String(verdict.value)}"]`)
      ?.focus();
  };

  return (
    <div className="pi-ex-true-false">
      <blockquote id={statementId} className="pi-ex-true-false__statement">
        <InlineText text={spec.statement} />
      </blockquote>
      <div
        ref={verdictRef}
        role="radiogroup"
        aria-labelledby={labelledBy ? `${labelledBy} ${statementId}` : statementId}
        aria-disabled={disabled || undefined}
        className="pi-ex-true-false__verdicts"
        onKeyDown={onVerdictKey}
      >
        {VERDICTS.map((verdict) => {
          const checked = value.value === verdict.value;
          return (
            <label
              key={verdict.label}
              className="pi-ex-choice"
              data-checked={checked || undefined}
              data-disabled={disabled || undefined}
            >
              <input
                type="radio"
                className="pi-ex-choice__input"
                name={`${name}-verdict`}
                value={String(verdict.value)}
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  update({ value: verdict.value });
                }}
              />
              <span className="pi-ex-choice__key" aria-hidden="true">
                {verdict.key}
              </span>
              <span className="pi-ex-choice__text">{verdict.label}</span>
            </label>
          );
        })}
      </div>
      {spec.reasons && (
        <div className="pi-ex-true-false__reasons">
          <p id={reasonLabelId} className="pi-ex-field__label">
            왜 그런가요? 이유를 고르세요.
          </p>
          <div
            role="radiogroup"
            aria-labelledby={reasonLabelId}
            aria-disabled={disabled || undefined}
            className="pi-ex-choices"
          >
            {spec.reasons.map((reason) => {
              const checked = value.reasonId === reason.id;
              return (
                <label
                  key={reason.id}
                  className="pi-ex-choice"
                  data-checked={checked || undefined}
                  data-disabled={disabled || undefined}
                >
                  <input
                    type="radio"
                    className="pi-ex-choice__input"
                    name={`${name}-reason`}
                    value={reason.id}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => {
                      update({ reasonId: reason.id });
                    }}
                  />
                  <span className="pi-ex-choice__text">
                    <InlineText text={reason.text} />
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
