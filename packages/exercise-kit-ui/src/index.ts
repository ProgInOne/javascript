// This repository's exercise UI: the common widgets, choice renderers and code editor from
// @proginone/exercise-ui (D-096), plus the renderers, check list, console and preview of the
// JavaScript exercise types. Apps import everything from here.

// Common parts, re-exported unchanged.
export {
  CONFIDENCE_LABELS,
  CONFIDENCE_LEVELS,
  ConfidencePicker,
  HintLadder,
  HINT_STEP_LABELS,
  MisconceptionNote,
  CodeBlock,
  LANGUAGE_LABELS,
  Kbd,
  ariaShortcut,
  isApplePlatform,
  matchExerciseShortcut,
  modKeyLabel,
  useExerciseShortcuts,
  InlineText,
  McqSingle,
  McqMulti,
  mcqMultiInstruction,
  TrueFalse,
  FormatError,
  type CheckLabels,
  type CodeBlockProps,
  type CodeEditorHandle,
  type CodeFile,
  type Confidence,
  type ConfidencePickerProps,
  type EditorPaneHandle,
  type ExerciseShortcut,
  type ExerciseShortcutHandlers,
  type FeedbackBannerProps,
  type FeedbackResult,
  type HintLadderProps,
  type McqMultiProps,
  type McqSingleProps,
  type MisconceptionInfo,
  type MisconceptionNoteProps,
  type RendererBaseProps,
  type TrueFalseDraft,
  type TrueFalseProps,
} from '@proginone/exercise-ui';

// The exercise model of this repository's types (public spec + answer per type).
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

// Widgets bound to this repository's check language and runner.
export { FeedbackBanner, JS_CHECK_LABELS } from './widgets/FeedbackBanner.tsx';
export {
  CheckList,
  CHECK_FAIL_REASON_LABELS,
  checkFailReasonLabel,
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

// Renderers of the JavaScript exercise types.
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

// Code editor in this repository's languages, and the preview container.
export {
  CodeEditor,
  EditorPane,
  EDITOR_LANGUAGES,
  type CodeEditorProps,
  type EditorPaneProps,
} from './editor/languages.tsx';
export { formatCode, languageOfPath, type EditorLanguage } from './editor/format.ts';
export {
  PreviewFrame,
  type PreviewFrameProps,
  type PreviewStatus,
} from './preview/PreviewFrame.tsx';
export { PreviewTabBar, type PreviewTabBarProps } from './preview/PreviewTabBar.tsx';
