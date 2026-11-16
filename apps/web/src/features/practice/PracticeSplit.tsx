import {
  EDITOR_MAX_HEIGHT,
  EDITOR_MIN_HEIGHT,
  WorkspacePanelsContext,
  type WorkspacePanels,
} from '@proginone/exercise-ui';
import { PanelSeparator } from '@proginone/ui';
import {
  useId,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import {
  PANEL_KEYS,
  parseBoolean,
  parseNumberIn,
  usePanelState,
  useMediaQuery,
  WIDE_QUERY,
} from '../../lib/panels.ts';

/** Problem panel limits (ui-ux.md 패널 리사이즈 규칙: 최소 320px, 기본 40%, 최대 55%). */
export const PROBLEM_MIN_PX = 320;
export const PROBLEM_MAX_PERCENT = 55;
/** The web_task three-way layout starts with a narrower problem column (문제 28%). */
export function defaultProblemShare(typeId: string): number {
  return typeId === 'web_task' || typeId === 'project' ? 28 : 40;
}

export interface PracticeSplitProps extends HTMLAttributes<HTMLDivElement> {
  /** Exercise type (or `project`): the share is remembered per type. */
  typeId: string;
  problem: ReactNode;
  work: ReactNode;
}

/**
 * Problem panel | work panel of the code exercises (ui-ux.md 학습 화면: 실습 모드). From 1280px the
 * two columns are split by a separator the learner can drag or move with the keyboard; the share
 * is kept per exercise type (D-067). Below 1280px the panels stack and there is nothing to resize.
 */
export function PracticeSplit({
  typeId,
  problem,
  work,
  className,
  style,
  ...rest
}: PracticeSplitProps) {
  const wide = useMediaQuery(WIDE_QUERY);
  const fallback = defaultProblemShare(typeId);
  const [share, setShare] = usePanelState(
    PANEL_KEYS.practiceSplit(typeId),
    fallback,
    parseNumberIn(10, PROBLEM_MAX_PERCENT),
  );
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const problemId = useId();
  const panels = useRememberedWorkspacePanels();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !wide) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setWidth(el.clientWidth);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [wide]);

  // 320px as a share of the current width; the CSS minmax() keeps 320px even if the window shrinks.
  const min =
    width > 0 ? Math.min(PROBLEM_MAX_PERCENT, Math.ceil((PROBLEM_MIN_PX / width) * 100)) : 25;
  const shown = Math.min(PROBLEM_MAX_PERCENT, Math.max(min, share));
  const pxPerPercent = width > 0 ? width / 100 : 12;

  return (
    <WorkspacePanelsContext.Provider value={panels}>
      <div
        ref={ref}
        {...rest}
        className={[className, wide && 'practice-layout--split'].filter(Boolean).join(' ')}
        style={{ ...style, '--problem-share': `${String(shown)}%` } as CSSProperties}
      >
        <div className="practice-layout__problem" id={problemId}>
          {problem}
        </div>
        {wide && (
          <PanelSeparator
            orientation="vertical"
            label="문제 패널 폭"
            value={shown}
            min={min}
            max={PROBLEM_MAX_PERCENT}
            step={Math.round((10 / pxPerPercent) * 10) / 10 || 1}
            pixelsPerUnit={pxPerPercent}
            valueText={`${String(Math.round(shown))}%`}
            controls={problemId}
            onChange={setShare}
            onReset={() => {
              setShare(null);
            }}
            className="practice-layout__separator"
          />
        )}
        <div className="practice-layout__work">{work}</div>
      </div>
    </WorkspacePanelsContext.Provider>
  );
}

/** Editor height and folded results of the code workspace, the same for every exercise. */
function useRememberedWorkspacePanels(): WorkspacePanels {
  const [editorHeight, setEditorHeight] = usePanelState<number | null>(
    PANEL_KEYS.editorHeight,
    null,
    parseNumberIn(EDITOR_MIN_HEIGHT, EDITOR_MAX_HEIGHT),
  );
  const [resultsCollapsed, setResultsCollapsed] = usePanelState(
    PANEL_KEYS.resultsCollapsed,
    false,
    parseBoolean,
  );
  return useMemo(
    () => ({ editorHeight, setEditorHeight, resultsCollapsed, setResultsCollapsed }),
    [editorHeight, setEditorHeight, resultsCollapsed, setResultsCollapsed],
  );
}
