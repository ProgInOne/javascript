import { z } from 'zod';

// Practice API contract (exercises, hints, solutions, reports) and the enums of the user.db
// learning-record tables (docs/design/data-model.md#userdb-설계). Drizzle `text({ enum })` and
// the CHECK constraints are generated from the same arrays.

export const EXERCISE_ORIGINS = ['authored', 'template', 'generated'] as const;
export const PRACTICE_SET_KINDS = [
  'lesson',
  'review',
  'weakness',
  'assessment',
  'remedial',
  'extra',
  'custom',
  'diagnostic',
] as const;
export const PRACTICE_SET_STATUSES = ['active', 'completed', 'abandoned'] as const;
export const PRACTICE_ITEM_STATUSES = ['pending', 'answered', 'skipped'] as const;
export const ATTEMPT_OUTCOMES = ['correct', 'partial', 'incorrect', 'error'] as const;
export const CONFIDENCES = ['sure', 'unsure', 'guess'] as const;
export const HINT_EVENT_KINDS = ['hint', 'solution', 'ai_hint'] as const;
export const LESSON_PROGRESS_STATUSES = [
  'not_started',
  'reading',
  'practicing',
  'completed',
] as const;
export const MASTERY_STAGES = [
  'not_started',
  'introduced',
  'practicing',
  'proficient',
  'mastered',
] as const;
export const EVIDENCE_KINDS = ['attempt', 'stage_gate', 'diagnostic_seed', 'recompute'] as const;
export const FSRS_RATINGS = ['again', 'hard', 'good', 'easy'] as const;
export const FSRS_CARD_STATES = ['new', 'learning', 'review', 'relearning'] as const;
export const PENDING_RATING_OUTCOMES = ['applied', 'skipped'] as const;
export const REPORT_REASONS = [
  'wrong_answer',
  'unclear',
  'wrong_hint_or_explanation',
  'difficulty_mismatch',
  'other',
] as const;
export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;

export const confidenceSchema = z.enum(CONFIDENCES);
export type Confidence = z.infer<typeof confidenceSchema>;
export const masteryStageSchema = z.enum(MASTERY_STAGES);
export type MasteryStage = z.infer<typeof masteryStageSchema>;

/** Hints per exercise (D-010: three levels, then an explicit "정답 보기"). */
export const HINT_LEVELS = 3;

/**
 * Optional practice context of a hint/solution/exercise request. Hints and solution views are
 * counted per practice set item; without one they belong to the exercise outside any set.
 */
export const practiceContextSchema = z
  .object({ practiceSetItemId: z.string().min(1).max(64).optional() })
  .strict();
export type PracticeContext = z.infer<typeof practiceContextSchema>;

export const openedHintSchema = z.object({
  level: z.int().min(1).max(HINT_LEVELS),
  text: z.string(),
});
export type OpenedHint = z.infer<typeof openedHintSchema>;

/**
 * `GET /exercises/:id`: the client-safe view. `publicSpec` is exercise-kit's `redactSpec` output
 * (answer keys, hidden checks' expectations and reference solutions removed); its shape depends
 * on `type` and is validated by the exercise UI with exercise-kit's public spec schemas.
 */
export const exerciseViewSchema = z.object({
  id: z.string(),
  type: z.string(),
  category: z.enum(['recognition', 'recall', 'production']),
  difficulty: z.int().min(1).max(5),
  lessonId: z.string().nullable(),
  prompt: z.string(),
  code: z.string().nullable(),
  publicSpec: z.record(z.string(), z.unknown()),
  estimatedSeconds: z.int(),
  /** True when grading needs a sandbox `RunResult` (fetch a run plan first). */
  requiresRun: z.boolean(),
  hintCount: z.int(),
  /** Hints already opened in this context, in order (restores the hint ladder). */
  openedHints: z.array(openedHintSchema),
  solutionViewed: z.boolean(),
});
export type ExerciseView = z.infer<typeof exerciseViewSchema>;

/** `POST /exercises/:id/run-plan` body. `verification` is reserved for the build. */
export const runPlanRequestSchema = z
  .object({
    answer: z.unknown(),
    purpose: z.enum(['interactive', 'grading']),
  })
  .strict();
export type RunPlanRequest = z.infer<typeof runPlanRequestSchema>;

/** `POST /exercises/:id/hints` response: the newly opened level. */
export const hintResponseSchema = z.object({
  level: z.int().min(1).max(HINT_LEVELS),
  text: z.string(),
  hintCount: z.int(),
  remaining: z.int().min(0),
});
export type HintResponse = z.infer<typeof hintResponseSchema>;

/** What "정답 보기" shows, per exercise kind. Never includes hidden checks. */
export const solutionViewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), choiceId: z.string(), text: z.string() }),
  z.object({
    kind: z.literal('blanks'),
    blanks: z.array(z.object({ id: z.string(), answer: z.string().nullable() })),
  }),
  z.object({ kind: z.literal('console'), lines: z.array(z.string()) }),
  z.object({ kind: z.literal('value'), text: z.string() }),
  z.object({
    kind: z.literal('error'),
    thrown: z.boolean(),
    name: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('files'),
    files: z.array(z.object({ path: z.string(), content: z.string() })),
  }),
  z.object({ kind: z.literal('none') }),
]);
export type SolutionView = z.infer<typeof solutionViewSchema>;

/** `POST /exercises/:id/solution` response. */
export const solutionResponseSchema = z.object({
  explanation: z.string(),
  solution: solutionViewSchema,
});
export type SolutionResponse = z.infer<typeof solutionResponseSchema>;

export const reportRequestSchema = z
  .object({
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(1_000).optional(),
  })
  .strict();
export type ReportRequest = z.infer<typeof reportRequestSchema>;

export const reportResponseSchema = z.object({
  id: z.string(),
  excluded: z.boolean(),
});
export type ReportResponse = z.infer<typeof reportResponseSchema>;
