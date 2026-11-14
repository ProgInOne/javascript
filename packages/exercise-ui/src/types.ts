/**
 * Learner confidence recorded with an attempt (data-model.md `attempts.confidence`).
 * `null` means the learner turned confidence input off (the engine treats it as neutral).
 */
export type Confidence = 'sure' | 'unsure' | 'guess';

export const CONFIDENCE_LEVELS: readonly Confidence[] = ['sure', 'unsure', 'guess'];

/** Button labels from docs/design/ui-ux.md#확신도-입력-타이밍. */
export const CONFIDENCE_LABELS: Readonly<Record<Confidence, string>> = {
  sure: '확실해요',
  unsure: '애매해요',
  guess: '찍었어요',
};

/**
 * Props every exercise renderer shares. Renderers are controlled: they show `value` and report
 * edits through `onChange`. They only ever receive the redacted public spec, never answer keys.
 */
export interface RendererBaseProps<PublicSpec, Answer> {
  /** Public spec, already validated (e.g. with `parsePublicSpec`). */
  spec: PublicSpec;
  value: Answer;
  onChange: (answer: Answer) => void;
  /** Read-only after submission or while grading. */
  disabled?: boolean;
  /** ID of the element holding the exercise prompt, used as the answer area's accessible name. */
  labelledBy?: string;
}
