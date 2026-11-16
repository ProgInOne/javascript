// Shared types and the exercise model (public spec + answer per type).
export {
  CONFIDENCE_LABELS,
  CONFIDENCE_LEVELS,
  type Confidence,
  type RendererBaseProps,
} from './types.ts';
export {
  RENDERABLE_TYPE_IDS,
  initialAnswer,
  isAnswerReady,
  isRenderableType,
  notReadyReason,
  parsePublicSpec,
  type AnswerByType,
  type PublicSpecByType,
  type RenderableExercise,
  type RenderableTypeId,
} from './exercise.ts';

// Practice widgets.
export { ConfidencePicker, type ConfidencePickerProps } from './widgets/ConfidencePicker.tsx';
export { HintLadder, HINT_STEP_LABELS, type HintLadderProps } from './widgets/HintLadder.tsx';
export {
  FeedbackBanner,
  MisconceptionNote,
  type FeedbackBannerProps,
  type FeedbackResult,
  type MisconceptionInfo,
  type MisconceptionNoteProps,
} from './widgets/FeedbackBanner.tsx';
export {
  CheckList,
  CHECK_FAIL_REASON_LABELS,
  type CheckListMilestone,
  type CheckListProps,
} from './widgets/CheckList.tsx';
export {
  CHECK_KIND_LABELS,
  checkSummary,
  checkTitle,
  formatJson,
} from './widgets/describe-check.ts';
export {
  ConsoleView,
  explainRunError,
  runStatusText,
  type ConsoleViewProps,
} from './widgets/ConsoleView.tsx';
export { CodeBlock, LANGUAGE_LABELS, type CodeBlockProps } from './widgets/CodeBlock.tsx';
export { Kbd } from './widgets/Kbd.tsx';
export {
  ariaShortcut,
  isApplePlatform,
  matchExerciseShortcut,
  modKeyLabel,
  useExerciseShortcuts,
  type ExerciseShortcut,
  type ExerciseShortcutHandlers,
} from './widgets/shortcuts.ts';
export { InlineText } from './text/InlineText.tsx';

// Exercise type renderers.
export { McqSingle, type McqSingleProps } from './renderers/McqSingle.tsx';
export { McqMulti, mcqMultiInstruction, type McqMultiProps } from './renderers/McqMulti.tsx';
export { TrueFalse, type TrueFalseDraft, type TrueFalseProps } from './renderers/TrueFalse.tsx';
export { FillBlank, parseBlankTemplate, type FillBlankProps } from './renderers/FillBlank.tsx';
export {
  FindBugLine,
  type FindBugLineDraft,
  type FindBugLineProps,
} from './renderers/FindBugLine.tsx';
export { Parsons, PARSONS_UI_MAX_INDENT, type ParsonsProps } from './renderers/Parsons.tsx';
export {
  OutputComparison,
  PredictOutput,
  PREDICT_ERROR_NAMES,
  type PredictOutputProps,
} from './renderers/PredictOutput.tsx';
export {
  FixBug,
  ImplementFunction,
  WebTask,
  type FixBugProps,
  type ImplementFunctionProps,
  type WebTaskProps,
} from './renderers/CodeRenderers.tsx';
export {
  errorLinesByFile,
  type CodeRendererProps,
  type CodeRunProps,
} from './renderers/CodeWorkspace.tsx';
export {
  EDITOR_MAX_HEIGHT,
  EDITOR_MIN_HEIGHT,
  WorkspacePanelsContext,
  type WorkspacePanels,
} from './renderers/workspace-panels.ts';
export { ExerciseRenderer, type ExerciseRendererProps } from './renderers/ExerciseRenderer.tsx';

// Code editor and preview container.
export { CodeEditor, type CodeEditorHandle, type CodeEditorProps } from './editor/CodeEditor.tsx';
export { EditorPane, type EditorPaneHandle, type EditorPaneProps } from './editor/EditorPane.tsx';
export { FormatError, formatCode, languageOfPath, type EditorLanguage } from './editor/format.ts';
export {
  PreviewFrame,
  type PreviewFrameProps,
  type PreviewStatus,
} from './preview/PreviewFrame.tsx';
