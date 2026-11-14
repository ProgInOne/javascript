import { Play } from 'lucide-react';

const LANG_LABELS: Record<string, string> = {
  js: 'JavaScript',
  html: 'HTML',
  css: 'CSS',
  web: 'HTML·CSS·JS',
};

/**
 * Lesson code example. Running it (and the predict-then-run flow) needs the sandbox runner,
 * which lands with packages/runner; until then the code is shown read-only.
 */
export function RunnableExampleBlock({
  id,
  lang,
  code,
  predict,
}: {
  id: string;
  lang: string;
  code: string;
  predict: boolean;
}) {
  return (
    <figure className="lesson-example" aria-labelledby={`example-${id}`}>
      <figcaption id={`example-${id}`} className="lesson-example__header">
        <span>예제 · {LANG_LABELS[lang] ?? lang}</span>
        {predict && <span className="text-fg-tertiary">실행 전에 결과를 예측해 보세요</span>}
      </figcaption>
      <pre className="lesson-code m-0 rounded-none border-0">
        <code>{code}</code>
      </pre>
      <div className="lesson-example__footer">
        <button
          type="button"
          className="pi-button pi-button--secondary pi-button--sm"
          disabled
          aria-disabled="true"
        >
          <Play size={16} aria-hidden="true" />
          실행 (준비 중)
        </button>
      </div>
    </figure>
  );
}
