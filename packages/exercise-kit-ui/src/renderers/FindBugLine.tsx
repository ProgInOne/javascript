import type {
  FeedbackItem,
  FindBugLineAnswer,
  FindBugLinePublicSpec,
} from '@proginone/exercise-kit';
import { Bug, Check, X } from 'lucide-react';
import { useId } from 'react';
import { InlineText, type RendererBaseProps } from '@proginone/exercise-ui';

/** Answer while being edited: the line and the cause can be picked in any order. */
export type FindBugLineDraft = Partial<FindBugLineAnswer>;

export interface FindBugLineProps extends RendererBaseProps<
  FindBugLinePublicSpec,
  FindBugLineDraft
> {
  /** Grader feedback: an item whose `target` is a line number marks that line. */
  feedback?: readonly FeedbackItem[];
}

/**
 * `find_bug_line` (docs/design/content-and-exercises.md#find_bug_line-오류-줄-찾기): the symptom,
 * then the read-only code where every line is an option of one radio group (arrow keys move
 * between lines, `Space` picks), then the cause options when the exercise has them.
 */
export function FindBugLine({
  spec,
  value,
  onChange,
  disabled = false,
  labelledBy,
  feedback = [],
}: FindBugLineProps) {
  const name = useId();
  const linesLabelId = useId();
  const causeLabelId = useId();
  const lines = spec.code.split('\n');
  const marks = new Map<number, FeedbackItem>();
  for (const item of feedback) {
    if (item.target !== undefined && /^\d+$/.test(item.target)) {
      marks.set(Number(item.target), item);
    }
  }

  const update = (patch: FindBugLineDraft) => {
    if (!disabled) onChange({ ...value, ...patch });
  };

  return (
    <div
      className="pi-ex-find-bug"
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : '오류 줄 찾기'}
    >
      <div className="pi-ex-symptom">
        <Bug size={16} aria-hidden="true" />
        <div>
          <p className="pi-ex-symptom__title">증상</p>
          <p>
            <InlineText text={spec.symptom} />
          </p>
        </div>
      </div>
      <p id={linesLabelId} className="pi-ex-field__label">
        증상의 원인이 되는 줄을 고르세요.
      </p>
      <div
        role="radiogroup"
        aria-labelledby={linesLabelId}
        aria-disabled={disabled || undefined}
        className="pi-ex-find-bug__code"
      >
        {lines.map((code, index) => {
          const line = index + 1;
          const checked = value.line === line;
          const mark = marks.get(line);
          return (
            <label
              key={line}
              className="pi-ex-find-bug__line"
              data-checked={checked || undefined}
              data-state={mark?.level}
              data-disabled={disabled || undefined}
            >
              <input
                type="radio"
                className="pi-ex-choice__input"
                name={`${name}-line`}
                value={line}
                checked={checked}
                disabled={disabled}
                aria-label={`${line}번 줄: ${code.trim() === '' ? '빈 줄' : code.trim()}`}
                onChange={() => {
                  update({ line });
                }}
              />
              <span className="pi-ex-find-bug__number" aria-hidden="true">
                {line}
              </span>
              <code className="pi-ex-find-bug__text" aria-hidden="true">
                {code === '' ? ' ' : code}
              </code>
              {mark && (
                <span className="pi-ex-find-bug__mark">
                  {mark.level === 'success' ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <X size={14} aria-hidden="true" />
                  )}
                  <span className="sr-only">{mark.message}</span>
                </span>
              )}
            </label>
          );
        })}
      </div>
      {spec.causeOptions && (
        <div className="pi-ex-find-bug__causes">
          <p id={causeLabelId} className="pi-ex-field__label">
            그 줄이 문제인 이유를 고르세요.
          </p>
          <div
            role="radiogroup"
            aria-labelledby={causeLabelId}
            aria-disabled={disabled || undefined}
            className="pi-ex-choices"
          >
            {spec.causeOptions.map((cause) => {
              const checked = value.causeId === cause.id;
              return (
                <label
                  key={cause.id}
                  className="pi-ex-choice"
                  data-checked={checked || undefined}
                  data-disabled={disabled || undefined}
                >
                  <input
                    type="radio"
                    className="pi-ex-choice__input"
                    name={`${name}-cause`}
                    value={cause.id}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => {
                      update({ causeId: cause.id });
                    }}
                  />
                  <span className="pi-ex-choice__text">
                    <InlineText text={cause.text} />
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
