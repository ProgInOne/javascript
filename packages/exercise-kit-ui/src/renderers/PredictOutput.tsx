import {
  compareOutput,
  type PredictOutputAnswer,
  type PredictOutputPublicSpec,
} from '@proginone/exercise-kit';
import { consoleEntriesToLines, type RunResult } from '@proginone/run-contract';
import { Button } from '@proginone/ui';
import { Check, Play, X } from 'lucide-react';
import { useId } from 'react';
import { CodeBlock, McqSingle, type RendererBaseProps } from '@proginone/exercise-ui';
import { ConsoleView } from '../widgets/ConsoleView.tsx';

type PredictBaseProps = Omit<
  RendererBaseProps<PredictOutputPublicSpec, PredictOutputAnswer | null>,
  'onChange'
> & { onChange: (answer: PredictOutputAnswer) => void };

export interface PredictOutputProps extends PredictBaseProps {
  /**
   * "실제로 실행" after submission (predict, then run). Omit before submission. The page runs the
   * code through packages/runner and passes the result as `actual`.
   */
  onRunActual?: () => void;
  /** Result of the actual run, compared line by line with the prediction. */
  actual?: RunResult | null;
  /** The actual run is in progress. */
  running?: boolean;
}

/** Error names offered for `answerKind: error` (the grader compares the name only). */
export const PREDICT_ERROR_NAMES = ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'];

/**
 * `predict_output` (docs/design/content-and-exercises.md#predict_output-실행-결과-예측): read-only code
 * plus an answer input that depends on `answerKind`. After submission, "실제로 실행" shows the real
 * output next to the prediction.
 */
export function PredictOutput({
  spec,
  value,
  onChange,
  disabled = false,
  labelledBy,
  onRunActual,
  actual = null,
  running = false,
}: PredictOutputProps) {
  return (
    <div className="pi-ex-predict">
      <CodeBlock code={spec.code} language={spec.lang} />
      <PredictAnswer
        spec={spec}
        value={value}
        onChange={onChange}
        disabled={disabled}
        {...(labelledBy === undefined ? {} : { labelledBy })}
      />
      {onRunActual && (
        <div className="pi-ex-predict__run">
          <Button
            icon={<Play size={16} aria-hidden="true" />}
            loading={running}
            onClick={onRunActual}
          >
            실제로 실행
          </Button>
        </div>
      )}
      {actual &&
        (spec.answerKind === 'console' && value !== null && 'console' in value ? (
          <OutputComparison predicted={value.console} actual={actual} />
        ) : (
          <ConsoleView result={actual} running={running} label="실제 실행 결과" />
        ))}
    </div>
  );
}

function PredictAnswer({ spec, value, onChange, disabled, labelledBy }: PredictBaseProps) {
  const inputId = useId();
  const hintId = useId();

  switch (spec.answerKind) {
    case 'console': {
      const text = value !== null && 'console' in value ? value.console : '';
      return (
        <div className="pi-ex-field">
          <label htmlFor={inputId} className="pi-ex-field__label">
            예상 출력
          </label>
          <textarea
            id={inputId}
            className="pi-ex-textarea pi-ex-code-input"
            aria-describedby={hintId}
            rows={Math.max(3, text.split('\n').length + 1)}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            disabled={disabled}
            value={text}
            onChange={(event) => {
              onChange({ console: event.target.value });
            }}
          />
          <p id={hintId} className="pi-ex-field__hint">
            출력 한 줄을 한 줄씩 적어 주세요. 문자열은 콘솔처럼 따옴표 없이 적어요.
          </p>
        </div>
      );
    }
    case 'value': {
      const text = value !== null && 'value' in value ? value.value : '';
      const target = spec.expression ?? '결과';
      return (
        <div className="pi-ex-field">
          <label htmlFor={inputId} className="pi-ex-field__label">
            실행이 끝난 뒤 <code className="pi-ex-inline-code">{target}</code>의 값
          </label>
          <input
            id={inputId}
            type="text"
            className="pi-ex-input pi-ex-code-input"
            aria-describedby={hintId}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            disabled={disabled}
            value={text}
            onChange={(event) => {
              onChange({ value: event.target.value });
            }}
          />
          <p id={hintId} className="pi-ex-field__hint">
            JavaScript 값으로 적어 주세요. 문자열은 따옴표로 감싸요(예: <code>"5"</code>와{' '}
            <code>5</code>는 달라요).
          </p>
        </div>
      );
    }
    case 'error':
      return (
        <ErrorAnswer
          value={value !== null && 'error' in value ? value.error : null}
          disabled={disabled ?? false}
          onChange={(error) => {
            onChange({ error });
          }}
        />
      );
    case 'choice':
      return (
        <McqSingle
          spec={{ options: spec.choices ?? [], codeOptions: true }}
          value={value !== null && 'choiceId' in value ? { optionId: value.choiceId } : null}
          onChange={(answer) => {
            onChange({ choiceId: answer.optionId });
          }}
          disabled={disabled ?? false}
          {...(labelledBy === undefined ? {} : { labelledBy })}
        />
      );
  }
}

type ErrorValue = Extract<PredictOutputAnswer, { error: unknown }>['error'];

function ErrorAnswer({
  value,
  disabled,
  onChange,
}: {
  value: ErrorValue | null;
  disabled: boolean;
  onChange: (value: ErrorValue) => void;
}) {
  const name = useId();
  const nameGroup = useId();
  const thrownLabelId = useId();
  const nameLabelId = useId();
  const thrown = value?.thrown;
  return (
    <div className="pi-ex-predict__error">
      <div role="radiogroup" aria-labelledby={thrownLabelId} className="pi-ex-radio-row">
        <p id={thrownLabelId} className="pi-ex-field__label">
          실행하면 어떻게 되나요?
        </p>
        {[
          { thrown: false, label: '오류 없이 끝나요' },
          { thrown: true, label: '오류가 발생해요' },
        ].map((option) => (
          <label key={String(option.thrown)} className="pi-ex-radio">
            <input
              type="radio"
              name={name}
              checked={thrown === option.thrown}
              disabled={disabled}
              onChange={() => {
                onChange({ thrown: option.thrown });
              }}
            />
            {option.label}
          </label>
        ))}
      </div>
      {thrown === true && (
        <div role="radiogroup" aria-labelledby={nameLabelId} className="pi-ex-radio-row">
          <p id={nameLabelId} className="pi-ex-field__label">
            어떤 오류인가요? (선택)
          </p>
          {[...PREDICT_ERROR_NAMES, null].map((errorName) => (
            <label key={errorName ?? 'unknown'} className="pi-ex-radio">
              <input
                type="radio"
                name={nameGroup}
                checked={(value.name ?? null) === errorName}
                disabled={disabled}
                onChange={() => {
                  onChange(
                    errorName === null ? { thrown: true } : { thrown: true, name: errorName },
                  );
                }}
              />
              {errorName === null ? '잘 모르겠어요' : <code>{errorName}</code>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Line-by-line "내 예측 / 실제" comparison (docs/design/ui-ux.md#예측-후-실행). */
export function OutputComparison({ predicted, actual }: { predicted: string; actual: RunResult }) {
  const comparison = compareOutput(consoleEntriesToLines(actual.console), predicted);
  const captionId = useId();
  return (
    <div className="pi-ex-compare">
      <table className="pi-ex-compare__table" aria-labelledby={captionId}>
        <caption id={captionId} className="pi-ex-compare__caption">
          예측과 실제 출력 비교 · {comparison.total}줄 중 {comparison.matched}줄 일치
        </caption>
        <thead>
          <tr>
            <th scope="col">줄</th>
            <th scope="col">내 예측</th>
            <th scope="col">실제</th>
            <th scope="col">결과</th>
          </tr>
        </thead>
        <tbody>
          {comparison.matches.map((match, index) => (
            // Rows are line positions.
            <tr key={index} data-match={match}>
              <th scope="row">{index + 1}</th>
              <td>
                <code>{comparison.actual[index] ?? ''}</code>
              </td>
              <td>
                <code>{comparison.expected[index] ?? ''}</code>
              </td>
              <td>
                {match ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <X size={14} aria-hidden="true" />
                )}
                {match ? '일치' : '다름'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {actual.errors.length > 0 && (
        <p className="pi-ex-compare__note">
          실행 중 오류:{' '}
          <code>{actual.errors.map((e) => `${e.name}: ${e.message}`).join(', ')}</code>
        </p>
      )}
    </div>
  );
}
