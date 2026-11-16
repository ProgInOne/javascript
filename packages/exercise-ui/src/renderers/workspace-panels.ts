import { createContext, useContext, useState } from 'react';

/**
 * Layout of the code workspace (ui-ux.md 패널 리사이즈 규칙 "작업 패널 에디터/결과 분할"): the
 * editor height and whether the results area (tests / console) is collapsed to its header. The
 * page provides it to remember the layout (D-067); without a provider the workspace keeps it in
 * component state.
 */
export interface WorkspacePanels {
  /** Editor height in pixels, or null for its natural height. */
  editorHeight: number | null;
  setEditorHeight: (height: number | null) => void;
  resultsCollapsed: boolean;
  setResultsCollapsed: (collapsed: boolean) => void;
}

/** Editor height limits for the editor/results separator. */
export const EDITOR_MIN_HEIGHT = 240;
export const EDITOR_MAX_HEIGHT = 900;

export const WorkspacePanelsContext = createContext<WorkspacePanels | null>(null);

export function useWorkspacePanels(): WorkspacePanels {
  const provided = useContext(WorkspacePanelsContext);
  const [editorHeight, setEditorHeight] = useState<number | null>(null);
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  return provided ?? { editorHeight, setEditorHeight, resultsCollapsed, setResultsCollapsed };
}
