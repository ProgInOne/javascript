import type { CheckResult, CodeAnswer, CodeFile, PublicCheck } from '@proginone/exercise-kit';
import type { RunResult } from '@proginone/run-contract';
import {
  Button,
  IconButton,
  PanelSeparator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  WORKBENCH_CLASS,
} from '@proginone/ui';
import { ChevronDown, ChevronUp, Play } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ariaShortcut,
  type EditorPaneHandle,
  Kbd,
  modKeyLabel,
  type RendererBaseProps,
} from '@proginone/exercise-ui';
import { EditorPane } from '../editor/languages.tsx';
import { CheckList, type CheckListMilestone } from '../widgets/CheckList.tsx';
import { ConsoleView } from '../widgets/ConsoleView.tsx';
import { EDITOR_MAX_HEIGHT, EDITOR_MIN_HEIGHT, useWorkspacePanels } from './workspace-panels.ts';

/** Run/feedback props shared by the code-writing renderers. Execution is packages/runner's job. */
export interface CodeRunProps {
  /** Runs the code (실행, `⌘'`): the page builds a run plan and calls the runner. */
  onRun?: () => void;
  /** Stops the current run. */
  onStop?: () => void;
  running?: boolean;
  /** Latest run result, shown in the console tab and as editor error lines. A new result opens the console tab. */
  run?: RunResult | null;
  /**
   * Per-check results (quick feedback from `gradeChecks` or `GradeResult.checkResults`). A new
   * array opens the tests tab, so pass the same array while the results stay the same.
   */
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
  // The results area follows what just arrived: a new run's output is in the console, new check
  // results in the tests. A grading run sets both (run first, then checks), so the tests win.
  // Adjusted during render (not in an effect) so the tab never paints a step behind.
  const [seenRun, setSeenRun] = useState(run);
  const [seenChecks, setSeenChecks] = useState(checkResults);
  if (run !== seenRun) {
    setSeenRun(run);
    if (run) setTab('console');
  }
  if (checkResults !== seenChecks) {
    setSeenChecks(checkResults);
    if (checkResults) setTab('tests');
  }
  const panels = useWorkspacePanels();
  const collapsed = panels.resultsCollapsed;
  const resultsId = useId();
  const editorBox = useRef<HTMLDivElement>(null);
  const [naturalHeight, setNaturalHeight] = useState(EDITOR_MIN_HEIGHT);
  const stacked = layout === 'stacked';

  // The separator reports the editor's real height until the learner sets one.
  useLayoutEffect(() => {
    const box = editorBox.current;
    if (!box || !stacked) return;
    // The box stays while the editor inside is replaced per file; read the current one.
    const measure = () => {
      const host = box.querySelector<HTMLElement>('.pi-ex-editor__host');
      const h = host ? Math.round(host.getBoundingClientRect().height) : 0;
      if (h > 0) setNaturalHeight(h);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, [stacked]);

  // Running with the results folded away would hide the output it produces, whether the run
  // came from the button or the page's ⌘' shortcut.
  const { setResultsCollapsed } = panels;
  useEffect(() => {
    if (running && collapsed) setResultsCollapsed(false);
  }, [running, collapsed, setResultsCollapsed]);

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
        <div className="pi-ex-workspace__results-actions">
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
          <IconButton
            label={collapsed ? '결과 펼치기' : '결과 접기'}
            icon={collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            aria-expanded={!collapsed}
            aria-controls={resultsId}
            onClick={() => {
              panels.setResultsCollapsed(!collapsed);
            }}
          />
        </div>
      </div>
      <div id={resultsId} hidden={collapsed}>
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
              if (collapsed) panels.setResultsCollapsed(false);
              paneRef.current?.goTo(position.file, position.line);
            }}
          />
        </TabsContent>
      </div>
    </Tabs>
  );

  const editorHeight = stacked ? panels.editorHeight : null;

  return (
    <div
      className={[
        'pi-ex-workspace',
        `pi-ex-workspace--${layout}`,
        WORKBENCH_CLASS,
        editorHeight === null ? null : 'pi-ex-workspace--sized',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        editorHeight === null
          ? undefined
          : ({ '--pi-ex-editor-h': `${String(editorHeight)}px` } as CSSProperties)
      }
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
        <>
          <div className="pi-ex-workspace__editor" ref={editorBox}>
            {editor}
          </div>
          {!collapsed && (
            <PanelSeparator
              orientation="horizontal"
              label="에디터 높이"
              value={editorHeight ?? naturalHeight}
              min={EDITOR_MIN_HEIGHT}
              max={EDITOR_MAX_HEIGHT}
              onChange={panels.setEditorHeight}
              onReset={() => {
                panels.setEditorHeight(null);
              }}
              className="pi-ex-workspace__separator"
            />
          )}
        </>
      )}
      {results}
    </div>
  );
}
