import {
  formatConsoleArgs,
  type ConsoleEntry,
  type RunError,
  type RunResult,
  type RunStatus,
  type SourcePosition,
} from '@proginone/run-contract';
import { Button } from '@proginone/ui';
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  CircleHelp,
  Info,
  Square,
  TextCursorInput,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useId, type ComponentType } from 'react';
import { modKeyLabel } from './shortcuts.ts';

export interface ConsoleViewProps {
  /** Latest sandbox result (from packages/runner). `null` before the first run. */
  result: RunResult | null;
  /** A run is in progress (shows "실행 중" and the stop button). */
  running?: boolean;
  /** Time limit used for the timeout message. Default 3000ms. */
  timeoutMs?: number;
  /** Stops the current run. The button shows only while running. */
  onStop?: () => void;
  /** Clears the output. */
  onClear?: () => void;
  /** Moves the editor to a learner-code position (error and log locations become buttons). */
  onNavigate?: (position: SourcePosition) => void;
  /** Accessible name of the panel. Default "콘솔". */
  label?: string;
}

type LevelIcon = ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>;

const LEVEL_ICONS: Partial<Record<ConsoleEntry['level'], { icon: LevelIcon; label: string }>> = {
  info: { icon: Info, label: '정보' },
  warn: { icon: AlertTriangle, label: '경고' },
  error: { icon: XCircle, label: '오류' },
  alert: { icon: Bell, label: 'alert' },
  confirm: { icon: CircleHelp, label: 'confirm' },
  prompt: { icon: TextCursorInput, label: 'prompt' },
};

/** Status line text, 1:1 with `RunResult.status` (docs/design/ui-ux.md#콘솔-패널). */
export function runStatusText(result: RunResult, timeoutMs = 3000): string {
  const status: RunStatus = result.status;
  switch (status) {
    case 'completed':
      return `완료 · ${Math.round(result.durationMs)}ms`;
    case 'error':
      return `오류로 멈췄어요 · ${Math.round(result.durationMs)}ms`;
    case 'timeout':
      return `중단됨 — 시간 제한 ${formatSeconds(timeoutMs)}`;
    case 'loop_limit': {
      const line = result.errors.find((e) => e.phase === 'loop_limit')?.position?.line;
      return `반복이 너무 오래 실행되어 멈췄어요${line === undefined ? '' : ` (${line}번째 줄)`}`;
    }
    case 'crashed':
      return '실행 환경 오류 — 다시 실행해 주세요';
    case 'aborted':
      return '실행을 중지했어요';
  }
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}초`;
}

/**
 * Engine wordings of the errors explained below (D-074). The original message is shown as the
 * engine wrote it (D-030); only the explanation underneath is matched, so Chrome (V8), Firefox
 * (SpiderMonkey) and Safari (JavaScriptCore) learners get the same explanation.
 */
const ENGINE_MESSAGES = {
  /** V8 and SpiderMonkey `x is not defined`, JSC `Can't find variable: x`, SpiderMonkey strict
   * `assignment to undeclared variable x`. */
  undefinedName: [
    /^(\S+) is not defined/,
    /^Can't find variable: (\S+)/,
    /^assignment to undeclared variable (\S+)/,
  ],
  /** V8 `Cannot access 'x' before initialization`, SpiderMonkey `can't access lexical declaration
   * 'x' before initialization`, JSC `Cannot access uninitialized variable.` */
  beforeInit: /before initialization|uninitialized variable/i,
  /** V8 `Cannot read properties of undefined`, SpiderMonkey `x is undefined` / `can't access
   * property "y", x is null`, JSC `undefined is not an object (evaluating 'x.y')`. */
  nullish:
    /Cannot (read|set) properties of (undefined|null)|^(undefined|null) is not an object|(^|, )\S+ is (undefined|null)$|can't access property .*, \S+ is (undefined|null)/,
  /** V8 `Assignment to constant variable.`, SpiderMonkey `invalid assignment to const 'x'`, JSC
   * `Attempted to assign to readonly property.` */
  constAssign:
    /Assignment to constant variable|invalid assignment to const|Attempted to assign to readonly property/,
  /** V8 and JSC `Maximum call stack size exceeded` (RangeError), SpiderMonkey `too much recursion`
   * (InternalError). */
  recursion: /Maximum call stack size exceeded|too much recursion/i,
} as const;

/**
 * Learner-language explanation shown under the original error (마이크로카피 원칙 4). The original
 * message stays visible so learners learn to read real errors.
 */
export function explainRunError(
  error: Pick<RunError, 'name' | 'message' | 'phase'>,
): string | null {
  if (error.phase === 'syntax' || error.name === 'SyntaxError')
    return '코드를 읽을 수 없어요(문법 오류). 표시된 줄 근처를 확인해 보세요.';
  if (error.phase === 'loop_limit')
    return '끝나지 않는 반복문이 있는지 확인해 보세요. 반복 조건이 언젠가 거짓이 되어야 해요.';
  if (ENGINE_MESSAGES.recursion.test(error.message))
    return '함수가 자기 자신을 끝없이 부르고 있어요. 재귀가 멈추는 조건이 있는지 확인해 보세요.';
  if (error.name === 'ReferenceError') {
    if (ENGINE_MESSAGES.beforeInit.test(error.message))
      return '`let`이나 `const`로 선언하기 전에 그 이름을 썼어요. 선언을 사용하는 곳보다 위로 옮겨 보세요.';
    const name = ENGINE_MESSAGES.undefinedName
      .map((re) => re.exec(error.message)?.[1])
      .find((n) => n !== undefined);
    if (name)
      return `\`${name}\`라는 이름을 찾을 수 없어요. 선언하기 전에 썼거나 철자가 다를 수 있어요.`;
    return '아직 쓸 수 없는 이름을 썼어요. 선언 위치와 철자를 확인해 보세요.';
  }
  if (error.name === 'TypeError') {
    if (error.message.includes('is not a function'))
      return '함수가 아닌 값을 호출했어요. 이름과 값의 종류를 확인해 보세요.';
    if (ENGINE_MESSAGES.nullish.test(error.message))
      return '`undefined`나 `null`에서 속성을 읽으려고 했어요. 값이 있는지 먼저 확인해 보세요.';
    if (ENGINE_MESSAGES.constAssign.test(error.message))
      return '`const`로 선언한 변수에는 다시 값을 넣을 수 없어요. 바뀌는 값이면 `let`을 쓰세요.';
    return '값의 종류가 이 동작에 맞지 않아요. 어떤 값이 들어 있는지 확인해 보세요.';
  }
  if (error.name === 'RangeError') return '값이 허용되는 범위를 벗어났어요.';
  return null;
}

/**
 * Console panel (ConsoleView in ui-ux.md): run status, output entries in the ProgInOne console
 * format, truncation notice and errors with learner-language explanations. Displays a
 * `RunResult` only; running code is packages/runner's job.
 */
export function ConsoleView({
  result,
  running = false,
  timeoutMs = 3000,
  onStop,
  onClear,
  onNavigate,
  label = '콘솔',
}: ConsoleViewProps) {
  const labelId = useId();
  const entries = result?.console ?? [];
  const errors = result?.errors ?? [];
  const status = running ? '실행 중' : result ? runStatusText(result, timeoutMs) : '실행 전';
  const announcement = running
    ? '실행 중'
    : result
      ? `${status}. 출력 ${entries.length}개${errors.length > 0 ? `, 오류 ${errors.length}개` : ''}`
      : '';

  return (
    <section className="pi-ex-console" aria-labelledby={labelId}>
      <header className="pi-ex-console__header">
        <h3 id={labelId} className="pi-ex-console__title">
          {label}
        </h3>
        <span className="pi-ex-console__status" data-status={running ? 'running' : result?.status}>
          {status}
        </span>
        <span className="pi-ex-console__tools">
          {running && onStop && (
            <Button size="sm" icon={<Square size={14} aria-hidden="true" />} onClick={onStop}>
              중지
            </Button>
          )}
          {onClear && !running && result && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={14} aria-hidden="true" />}
              onClick={onClear}
            >
              지우기
            </Button>
          )}
        </span>
      </header>
      <p className="sr-only" role="status">
        {announcement}
      </p>

      <div className="pi-ex-console__body">
        {!result && !running && (
          <p className="pi-ex-console__empty">
            실행 결과가 여기에 나와요. 실행({modKeyLabel()} ')을 눌러 보세요.
          </p>
        )}
        {result && entries.length === 0 && errors.length === 0 && (
          <p className="pi-ex-console__empty">출력이 없어요.</p>
        )}
        {entries.length > 0 && (
          <ol className="pi-ex-console__entries" aria-label="출력">
            {entries.map((entry) => (
              <ConsoleRow key={entry.seq} entry={entry} onNavigate={onNavigate} />
            ))}
          </ol>
        )}
        {result && (result.consoleTruncated || result.droppedConsoleEntries > 0) && (
          <p className="pi-ex-console__notice">
            출력이 너무 많아 {entries.length.toLocaleString('ko-KR')}개만 표시합니다 (
            {result.droppedConsoleEntries.toLocaleString('ko-KR')}개 생략)
          </p>
        )}
        {errors.length > 0 && (
          <ul className="pi-ex-console__errors" aria-label="오류">
            {errors.map((error, index) => (
              <ErrorRow
                // Errors are a fixed list per result.
                key={index}
                error={error}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ConsoleRow({
  entry,
  onNavigate,
}: {
  entry: ConsoleEntry;
  onNavigate: ((position: SourcePosition) => void) | undefined;
}) {
  const level = LEVEL_ICONS[entry.level];
  const Icon = level?.icon ?? ChevronRight;
  return (
    <li className="pi-ex-console__entry" data-level={entry.level}>
      <span className="pi-ex-console__level">
        <Icon size={14} aria-hidden="true" />
        {level && <span className="sr-only">{level.label}: </span>}
      </span>
      <span className="pi-ex-console__text">{formatConsoleArgs(entry.args)}</span>
      {entry.source && <PositionLink position={entry.source} onNavigate={onNavigate} />}
    </li>
  );
}

function ErrorRow({
  error,
  onNavigate,
}: {
  error: RunError;
  onNavigate: ((position: SourcePosition) => void) | undefined;
}) {
  const explanation = explainRunError(error);
  return (
    <li className="pi-ex-console__error">
      <XCircle size={16} aria-hidden="true" />
      <div>
        <p className="pi-ex-console__error-message">
          <code>
            {error.name}: {error.message}
          </code>
          {error.position && <PositionLink position={error.position} onNavigate={onNavigate} />}
        </p>
        {explanation && <p className="pi-ex-console__error-help">{explanation}</p>}
      </div>
    </li>
  );
}

function PositionLink({
  position,
  onNavigate,
}: {
  position: SourcePosition;
  onNavigate: ((position: SourcePosition) => void) | undefined;
}) {
  const text = `${position.file}:${position.line}`;
  if (!onNavigate) return <span className="pi-ex-console__position">{text}</span>;
  return (
    <button
      type="button"
      className="pi-ex-console__position pi-ex-console__position--link"
      aria-label={`${position.file} ${position.line}번째 줄로 이동`}
      onClick={() => {
        onNavigate(position);
      }}
    >
      {text}
    </button>
  );
}
