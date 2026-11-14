import type { CodeFile } from '@proginone/exercise-kit';
import { Button, Dialog } from '@proginone/ui';
import { RotateCcw, WandSparkles } from 'lucide-react';
import { useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor.tsx';
import { FormatError, languageOfPath } from './format.ts';

export interface EditorPaneHandle {
  focus(): void;
  /** Opens `file` (when it exists) and moves to `line` — for console error links. */
  goTo(file: string, line: number): void;
}

export interface EditorPaneProps {
  /** Learner files (`CodeAnswer.files`). */
  files: readonly CodeFile[];
  onChange: (files: CodeFile[]) => void;
  /** Restores the starting code. Shows "초기화" with a confirmation dialog when given. */
  onReset?: () => void;
  /** Auto-save state text, e.g. "저장됨 · 방금" (rendered as a status message). */
  saveStatus?: ReactNode;
  readOnly?: boolean;
  /** Autocomplete and auto-closing brackets (setting; off by default). */
  autocomplete?: boolean;
  /** Error lines per file path (1-based), e.g. from `RunResult.errors[].position`. */
  errorLines?: Readonly<Record<string, readonly number[]>>;
  ref?: Ref<EditorPaneHandle>;
}

/**
 * EditorPane (ui-ux.md): file switcher (several files are P1; one file shows its name), 포맷,
 * 초기화 (confirmed), auto-save status, and the CodeMirror editor.
 */
export function EditorPane({
  files,
  onChange,
  onReset,
  saveStatus,
  readOnly = false,
  autocomplete = false,
  errorLines = {},
  ref,
}: EditorPaneProps) {
  const [activePath, setActivePath] = useState(files[0]?.path ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingLine, setPendingLine] = useState<number | null>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  const messageId = useId();
  const active = files.find((f) => f.path === activePath) ?? files[0];

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editorRef.current?.focus();
      },
      goTo: (file, line) => {
        if (file !== active?.path && files.some((f) => f.path === file)) {
          setActivePath(file);
          setPendingLine(line);
          return;
        }
        editorRef.current?.goToLine(line);
      },
    }),
    [active?.path, files],
  );

  if (!active) return null;
  const language = languageOfPath(active.path) ?? 'js';

  const format = () => {
    setMessage(null);
    editorRef.current?.format().catch((error: unknown) => {
      setMessage(error instanceof FormatError ? error.message : '코드를 정리하지 못했어요.');
    });
  };

  return (
    <div className="pi-ex-pane">
      <div className="pi-ex-pane__toolbar">
        {files.length > 1 ? (
          <div className="pi-ex-pane__files" role="group" aria-label="파일">
            {files.map((file) => (
              <button
                key={file.path}
                type="button"
                className="pi-ex-pane__file"
                aria-pressed={file.path === active.path}
                onClick={() => {
                  setActivePath(file.path);
                }}
              >
                {file.path}
              </button>
            ))}
          </div>
        ) : (
          <span className="pi-ex-pane__file pi-ex-pane__file--single">{active.path}</span>
        )}
        <span className="pi-ex-pane__save" role="status">
          {saveStatus}
        </span>
        {!readOnly && (
          <span className="pi-ex-pane__actions">
            <Button
              size="sm"
              variant="ghost"
              icon={<WandSparkles size={14} aria-hidden="true" />}
              aria-keyshortcuts="Shift+Alt+F"
              onClick={format}
            >
              포맷
            </Button>
            {onReset && (
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw size={14} aria-hidden="true" />}
                onClick={() => {
                  setConfirmReset(true);
                }}
              >
                초기화
              </Button>
            )}
          </span>
        )}
      </div>
      <CodeEditor
        // A fresh editor per file keeps undo history per file.
        key={active.path}
        ref={(handle) => {
          editorRef.current = handle;
          if (handle && pendingLine !== null) {
            handle.goToLine(pendingLine);
            setPendingLine(null);
          }
        }}
        value={active.content}
        language={language}
        label={`${active.path} 편집기`}
        readOnly={readOnly}
        autocomplete={autocomplete}
        errorLines={errorLines[active.path] ?? []}
        describedBy={messageId}
        onFormatError={(error) => {
          setMessage(error.message);
        }}
        onChange={(content) => {
          setMessage(null);
          onChange(files.map((f) => (f.path === active.path ? { ...f, content } : f)));
        }}
      />
      <p id={messageId} className="pi-ex-pane__message" role="status">
        {message}
      </p>
      {onReset && (
        <Dialog
          open={confirmReset}
          onOpenChange={setConfirmReset}
          title="처음 코드로 되돌릴까요?"
          description="지금까지 작성한 코드가 사라지고 시작 코드로 바뀌어요."
          footer={
            <>
              <Button
                onClick={() => {
                  setConfirmReset(false);
                }}
              >
                취소
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmReset(false);
                  onReset();
                }}
              >
                초기화
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
