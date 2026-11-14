import type { CheckResult, CodeAnswer, CodeFile, PublicCheck } from '@proginone/exercise-kit';
import type { RunResult } from '@proginone/shared';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, WORKBENCH_CLASS } from '@proginone/ui';
import { Play } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { EditorPane, type EditorPaneHandle } from '../editor/EditorPane.tsx';
import type { RendererBaseProps } from '../types.ts';
import { CheckList, type CheckListMilestone } from '../widgets/CheckList.tsx';
import { ConsoleView } from '../widgets/ConsoleView.tsx';
import { Kbd } from '../widgets/Kbd.tsx';
import { ariaShortcut, modKeyLabel } from '../widgets/shortcuts.ts';

/** Run/feedback props shared by the code-writing renderers. Execution is packages/runner's job. */
export interface CodeRunProps {
  /** Runs the code (실행, `⌘'`): the page builds a run plan and calls the runner. */
  onRun?: () => void;
  /** Stops the current run. */
  onStop?: () => void;
  running?: boolean;
  /** Latest run result, shown in the console tab and as editor error lines. */
  run?: RunResult | null;
  /** Per-check results (quick feedback from `gradeChecks` or `GradeResult.checkResults`). */
  checkResults?: readonly CheckResult[] | null;
  /** Auto-save status text, e.g. "저장됨 · 방금". */
  saveStatus?: ReactNode;
  /** Autocomplete setting (off by default). */
  autocomplete?: boolean;
  /** Time limit shown in the timeout message. */
  timeoutMs?: number;
}

export type CodeRendererProps<Spec> = RendererBaseProps<Spec, CodeAnswer> & CodeRunProps;

/** Error lines per file from the run's errors (syntax and runtime positions). */
export function errorLinesByFile(run: RunResult | null | undefined): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const error of run?.errors ?? []) {
    const position = error.position;
    if (!position || position.line < 1) continue;
    (out[position.file] ??= []).push(position.line);
  }
  return out;
}

export function cloneFiles(files: readonly { path: string; content: string }[]): CodeFile[] {
  return files.map(({ path, content }) => ({ path, content }));
}

interface WorkspaceProps extends Omit<CodeRendererProps<unknown>, 'spec'> {
  starterFiles: readonly CodeFile[];
  checks: readonly PublicCheck[];
  entry?: string | undefined;
  milestones?: readonly CheckListMilestone[] | undefined;
  /** Content above the editor (e.g. the bug symptom). */
  intro?: ReactNode;
  /** Replaces the default results area (web_task puts the preview next to the editor). */
  layout?: 'stacked' | 'web';
  preview?: ReactNode;
  /** Tab shown first in the results area. */
  defaultResultTab?: 'tests' | 'console';
  checksTitle?: string;
}

/** Editor + results (tests / console) used by implement_function, fix_bug and web_task. */
export function CodeWorkspace({
  value,
  onChange,
  disabled = false,
  labelledBy,
  starterFiles,
  checks,
  entry,
  milestones,
  intro,
  layout = 'stacked',
  preview,
  defaultResultTab = 'tests',
  checksTitle = '테스트 결과',
  onRun,
  onStop,
  running = false,
  run = null,
  checkResults = null,
  saveStatus,
  autocomplete = false,
  timeoutMs = 3000,
}: WorkspaceProps) {
  const paneRef = useRef<EditorPaneHandle>(null);
  const [tab, setTab] = useState<string>(defaultResultTab);

  const editor = (
    <EditorPane
      ref={paneRef}
      files={value.files}
      onChange={(files) => {
        onChange({ files });
      }}
      onReset={() => {
        onChange({ files: cloneFiles(starterFiles) });
      }}
      saveStatus={saveStatus}
      readOnly={disabled}
      autocomplete={autocomplete}
      errorLines={errorLinesByFile(run)}
    />
  );

  const results = (
    <Tabs value={tab} onValueChange={setTab} className="pi-ex-workspace__results">
      <div className="pi-ex-workspace__results-bar">
        <TabsList variant="pill" aria-label="결과">
          <TabsTrigger value="tests">{checksTitle}</TabsTrigger>
          <TabsTrigger value="console">콘솔</TabsTrigger>
        </TabsList>
        {onRun && (
          <Button
            size="sm"
            icon={<Play size={14} aria-hidden="true" />}
            loading={running}
            aria-keyshortcuts={ariaShortcut("'")}
            onClick={onRun}
          >
            실행
            <Kbd keys={[modKeyLabel(), "'"]} />
          </Button>
        )}
      </div>
      <TabsContent value="tests" className="pi-ex-workspace__panel">
        <CheckList
          checks={checks}
          results={checkResults}
          title={checksTitle}
          {...(entry === undefined ? {} : { entry })}
          {...(milestones === undefined ? {} : { milestones })}
        />
      </TabsContent>
      <TabsContent
        value="console"
        className="pi-ex-workspace__panel pi-ex-workspace__panel--console"
      >
        <ConsoleView
          result={run}
          running={running}
          timeoutMs={timeoutMs}
          {...(onStop === undefined ? {} : { onStop })}
          onNavigate={(position) => {
            paneRef.current?.goTo(position.file, position.line);
          }}
        />
      </TabsContent>
    </Tabs>
  );

  return (
    <div
      className={`pi-ex-workspace pi-ex-workspace--${layout} ${WORKBENCH_CLASS}`}
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : '코드 작업 영역'}
    >
      {intro}
      {layout === 'web' ? (
        <div className="pi-ex-workspace__split">
          <div className="pi-ex-workspace__editor">{editor}</div>
          <div className="pi-ex-workspace__side">{preview}</div>
        </div>
      ) : (
        <div className="pi-ex-workspace__editor">{editor}</div>
      )}
      {results}
    </div>
  );
}
