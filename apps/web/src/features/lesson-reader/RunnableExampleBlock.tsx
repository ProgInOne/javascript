import { formatConsoleArgs, type RunResult } from '@proginone/shared';
import { Button } from '@proginone/ui';
import { Play } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { consoleRunner, examplePlan, previewRunner, statusMessage } from '../runner/runner.ts';

const LANG_LABELS: Record<string, string> = {
  js: 'JavaScript',
  html: 'HTML',
  css: 'CSS',
  web: 'HTML·CSS·JS',
};

/**
 * Lesson code example with predict-then-run (docs/design/content-and-exercises.md#mdx-컴포넌트).
 * JS runs in the hidden sandbox and shows the console; HTML/web renders a sandboxed preview.
 * CSS-only snippets have no document to style, so they are shown without a run button.
 */
export function RunnableExampleBlock({
  id,
  lang,
  code,
  predict,
  allowSkip = true,
}: {
  id: string;
  lang: string;
  code: string;
  predict: boolean;
  /** "예측 건너뛰기" link; hidden when the learner set predict-first to required (ui-ux.md). */
  allowSkip?: boolean;
}) {
  const kind = lang === 'js' ? 'js' : lang === 'html' || lang === 'web' ? 'html' : null;
  const titleId = `example-${id}`;
  const predictionId = useId();
  const [prediction, setPrediction] = useState('');
  const [skipped, setSkipped] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewHost = useRef<ReturnType<typeof previewRunner> | null>(null);

  useEffect(
    () => () => {
      previewHost.current?.dispose();
    },
    [],
  );

  const canRun = kind !== null && (!predict || skipped || prediction.trim() !== '');

  const run = async () => {
    if (!kind) return;
    setRunning(true);
    setFailed(false);
    setNotice(null);
    try {
      let host = consoleRunner();
      if (kind === 'html') {
        if (!previewRef.current) return;
        previewHost.current?.dispose();
        previewHost.current = previewRunner(previewRef.current, setNotice);
        host = previewHost.current;
      }
      setResult(await host.run(examplePlan(kind, code)));
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  };

  const output = result?.console.map((entry) => ({
    seq: entry.seq,
    level: entry.level,
    text: formatConsoleArgs(entry.args),
  }));
  const status = result ? statusMessage(result) : null;

  return (
    <figure className="lesson-example" aria-labelledby={titleId}>
      <figcaption id={titleId} className="lesson-example__header">
        <span>예제 · {LANG_LABELS[lang] ?? lang}</span>
        {predict && kind && (
          <span className="font-normal text-fg-tertiary">실행 전에 결과를 예측해 보세요</span>
        )}
      </figcaption>
      <pre className="lesson-code m-0 rounded-none border-0">
        <code>{code}</code>
      </pre>

      {kind && (
        <div className="lesson-example__footer flex-col items-stretch gap-2">
          {predict && !result && (
            <div className="grid gap-1">
              <label htmlFor={predictionId} className="font-medium">
                예상한 출력
              </label>
              <textarea
                id={predictionId}
                rows={2}
                value={prediction}
                onChange={(e) => {
                  setPrediction(e.target.value);
                }}
                className="rounded-md border border-(--color-border-input) bg-surface px-3 py-2 font-mono text-fg"
              />
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            {predict && allowSkip && !result && !skipped && prediction.trim() === '' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSkipped(true);
                }}
              >
                예측 건너뛰기
              </Button>
            )}
            <Button
              size="sm"
              icon={<Play size={16} />}
              loading={running}
              disabled={!canRun}
              onClick={() => {
                void run();
              }}
            >
              {result ? '다시 실행' : '실행'}
            </Button>
          </div>
        </div>
      )}

      {kind === 'html' && (
        <div
          ref={previewRef}
          className="bg-white h-48 border-t border-line"
          aria-label="실행 결과 미리보기"
        />
      )}

      {(result ?? failed) && (
        <div className="border-t border-line px-4 py-3" role="status" aria-live="polite">
          {failed && (
            <p className="text-fg-secondary">
              실행 환경을 준비하지 못했어요. 잠시 후 다시 실행해 보세요.
            </p>
          )}
          {predict && result && prediction.trim() !== '' && (
            <p className="mb-2 text-fg-secondary type-small">
              내 예측: <span className="font-mono text-fg">{prediction.trim()}</span>
            </p>
          )}
          {kind === 'js' && output && (
            <>
              <p className="mb-1 font-semibold text-fg-secondary type-small">콘솔 출력</p>
              {output.length === 0 && result?.errors.length === 0 ? (
                <p className="text-fg-tertiary type-small">출력이 없어요.</p>
              ) : (
                <ol className="m-0 list-none p-0 font-mono text-[14px]" aria-label="콘솔 출력">
                  {output.map((line) => (
                    <li key={line.seq} data-level={line.level} className="whitespace-pre-wrap">
                      {line.text}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
          {result?.errors.map((e, i) => (
            <p key={i} className="mt-1 font-mono text-[14px] text-(--color-feedback-incorrect-fg)">
              {e.name}: {e.message}
              {e.position ? ` (${e.position.line}번째 줄)` : ''}
            </p>
          ))}
          {status && <p className="mt-1 text-fg-secondary">{status}</p>}
          {notice && <p className="mt-1 text-fg-secondary">{notice}</p>}
        </div>
      )}
    </figure>
  );
}
