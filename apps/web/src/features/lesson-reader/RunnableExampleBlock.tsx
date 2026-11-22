import {
  ariaShortcut,
  CodeEditor,
  Kbd,
  matchExerciseShortcut,
  modKeyLabel,
  PreviewTabBar,
} from '@proginone/exercise-ui';
import { type CodeDraft } from '@proginone/shared';
import { formatConsoleArgs, type RunResult } from '@proginone/run-contract';
import { Button } from '@proginone/ui';
import { Pencil, Play, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { deleteExampleDraft } from '../../api/queries.ts';
import { clearLocalDraft, loadLocalDraft, pickDraft, useDraftSaver } from '../drafts/drafts.ts';
import {
  consoleRunner,
  examplePlan,
  previewRunner,
  statusMessage,
  warmRunner,
} from '../runner/runner.ts';

const LANG_LABELS: Record<string, string> = {
  js: 'JavaScript',
  html: 'HTML',
  css: 'CSS',
  web: 'HTML·CSS·JS',
};

/** The one file an example's code is saved as (runner entry). */
const draftPath = (kind: 'js' | 'html') => (kind === 'js' ? 'main.js' : 'index.html');

/**
 * Lesson code example with predict-then-run (docs/design/content-and-exercises.md#mdx-컴포넌트).
 * JS runs in the hidden sandbox and shows the console; HTML/web renders a sandboxed preview.
 * CSS-only snippets have no document to style, so they are shown without a run button.
 *
 * Editable examples (`editable`, default on in content) open an editor on "코드 수정". With a
 * `lessonId` the edited code is a draft (D-063): saved in this browser and on the server,
 * restored on reopen (the newer of the two), and "원래 코드로" deletes it.
 */
export function RunnableExampleBlock({
  id,
  lang,
  code: original,
  predict,
  allowSkip = true,
  editable = false,
  lessonId,
  serverDraft,
}: {
  id: string;
  lang: string;
  code: string;
  predict: boolean;
  /** "예측 건너뛰기" link; hidden when the learner set predict-first to required (ui-ux.md). */
  allowSkip?: boolean;
  /** The learner may change the code and run it again. */
  editable?: boolean;
  /** Lesson of the example: edits are kept as drafts. */
  lessonId?: string;
  /** The server draft (undefined while loading or without drafts). */
  serverDraft?: CodeDraft | null | undefined;
}) {
  const kind = lang === 'js' ? 'js' : lang === 'html' || lang === 'web' ? 'html' : null;
  const canEdit = editable && kind !== null;
  const target = { kind: 'example', lessonId: lessonId ?? '', exampleId: id } as const;
  const keepsDrafts = canEdit && lessonId !== undefined;
  const restoredCode = (server: CodeDraft | null | undefined) => {
    if (!keepsDrafts) return null;
    const draft = pickDraft([loadLocalDraft(target), server], null);
    return draft?.files[0]?.content ?? null;
  };
  const [code, setCode] = useState(() => restoredCode(serverDraft) ?? original);
  const [editing, setEditing] = useState(() => code !== original);
  const [touched, setTouched] = useState(false);
  const drafts = useDraftSaver(target, null);
  const editorLabel = `예제 코드 편집 (${LANG_LABELS[lang] ?? lang})`;

  // The server draft arrives after the first render: use it unless the learner already typed
  // (adjusting state while rendering, not in an effect).
  const [seenServerDraft, setSeenServerDraft] = useState(serverDraft);
  if (serverDraft !== seenServerDraft) {
    setSeenServerDraft(serverDraft);
    const restored = touched ? null : restoredCode(serverDraft);
    if (restored !== null && restored !== code) {
      setCode(restored);
      setEditing(true);
    }
  }

  const changeCode = (next: string) => {
    setTouched(true);
    setCode(next);
    if (keepsDrafts) drafts.save([{ path: draftPath(kind), content: next }]);
  };

  const resetCode = () => {
    setTouched(true);
    setCode(original);
    setEditing(false);
    if (!keepsDrafts) return;
    drafts.discard();
    clearLocalDraft(target);
    deleteExampleDraft(lessonId, id).catch(() => undefined);
  };
  const titleId = `example-${id}`;
  const predictionId = useId();
  const [prediction, setPrediction] = useState('');
  const [skipped, setSkipped] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The preview document's title for the tab bar (D-082). */
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewHost = useRef<ReturnType<typeof previewRunner> | null>(null);

  useEffect(
    () => () => {
      previewHost.current?.dispose();
    },
    [],
  );
  useEffect(() => warmRunner(), []);

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
        previewHost.current = previewRunner(previewRef.current, {
          onNotice: setNotice,
          onTitle: setPreviewTitle,
        });
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
    <figure
      className="lesson-example"
      aria-labelledby={titleId}
      // ⌘Enter (Ctrl+Enter) runs the example while focus is anywhere inside it: the editor, the
      // prediction field or a button (FR-UI-02 "실행(⌘Enter)", D-067).
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || matchExerciseShortcut(e) !== 'onSubmit') return;
        e.preventDefault();
        if (canRun && !running) void run();
      }}
    >
      <figcaption id={titleId} className="lesson-example__header">
        <span>예제 · {LANG_LABELS[lang] ?? lang}</span>
        {predict && kind && (
          <span className="font-normal text-fg-tertiary">실행 전에 결과를 예측해 보세요</span>
        )}
      </figcaption>
      {editing && kind ? (
        <div className="lesson-example__editor">
          <CodeEditor
            value={code}
            onChange={changeCode}
            language={kind === 'js' ? 'js' : 'html'}
            label={editorLabel}
          />
        </div>
      ) : (
        <pre className="lesson-code m-0 rounded-none border-0">
          <code>{code}</code>
        </pre>
      )}

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
          <div className="flex flex-wrap items-center justify-end gap-2">
            {editing && (
              <span className="mr-auto text-fg-tertiary type-small" role="status">
                {code === original ? '원래 코드' : (drafts.statusText ?? '수정한 코드')}
              </span>
            )}
            {canEdit && !editing && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Pencil size={16} />}
                onClick={() => {
                  setEditing(true);
                }}
              >
                코드 수정
              </Button>
            )}
            {editing && (
              <Button variant="ghost" size="sm" icon={<RotateCcw size={16} />} onClick={resetCode}>
                원래 코드로
              </Button>
            )}
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
              aria-keyshortcuts={ariaShortcut('Enter')}
              onClick={() => {
                void run();
              }}
            >
              {result ? '다시 실행' : '실행'}
              <Kbd keys={[modKeyLabel(), 'Enter']} />
            </Button>
          </div>
        </div>
      )}

      {kind === 'html' && (
        <>
          <PreviewTabBar title={previewTitle} className="border-t border-line" />
          <div ref={previewRef} className="bg-white h-48" aria-label="실행 결과 미리보기" />
        </>
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
