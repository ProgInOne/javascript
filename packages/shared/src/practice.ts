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

// ── Practice sets and attempts ───────────────────────────────────────────────

const rowId = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const contentId = z.string().min(1).max(200);

/** `POST /practice-sets`. A lesson set is returned as-is while it is active (idempotent). */
export const createPracticeSetRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lesson'), lessonId: contentId }).strict(),
]);
export type CreatePracticeSetRequest = z.infer<typeof createPracticeSetRequestSchema>;

export const conceptRefSchema = z.object({ id: z.string(), title: z.string() });
export type ConceptRef = z.infer<typeof conceptRefSchema>;

export const practiceItemViewSchema = z.object({
  id: z.string(),
  position: z.int().min(0),
  exerciseId: z.string(),
  type: z.string(),
  difficulty: z.int().min(1).max(5),
  status: z.enum(PRACTICE_ITEM_STATUSES),
  /** Engine reason code (`lesson_practice`, `production_required`, `review_due`, …). */
  reason: z.string(),
  targetConcept: conceptRefSchema.nullable(),
  /** Attempts recorded for the item (sandbox failures excluded). */
  attempts: z.int().min(0),
  lastOutcome: z.enum(ATTEMPT_OUTCOMES).nullable(),
});
export type PracticeItemView = z.infer<typeof practiceItemViewSchema>;

export const practiceProgressSchema = z.object({
  total: z.int().min(0),
  answered: z.int().min(0),
  skipped: z.int().min(0),
  pending: z.int().min(0),
});
export type PracticeProgress = z.infer<typeof practiceProgressSchema>;

export const passRuleSchema = z.object({
  minCorrect: z.number(),
  minConceptScore: z.number(),
  minDistinctTypes: z.int(),
  minLevel3Correct: z.int(),
});
export type PassRuleView = z.infer<typeof passRuleSchema>;

const passCheckSchema = z.object({ met: z.boolean(), required: z.number(), actual: z.number() });

/** Lesson pass rule evaluation (learning-engine.md#단원-연습-세트). */
export const passResultSchema = z.object({
  passed: z.boolean(),
  checks: z.object({
    allAnswered: z.boolean(),
    minCorrect: passCheckSchema,
    minConceptScore: passCheckSchema.extend({ below: z.array(conceptRefSchema) }),
    minDistinctTypes: passCheckSchema,
    minLevel3Correct: passCheckSchema,
  }),
});
export type PassResultView = z.infer<typeof passResultSchema>;

export const practiceSetResultSchema = z.object({
  total: z.int(),
  answered: z.int(),
  skipped: z.int(),
  /** Items whose last attempt was correct. */
  correct: z.int(),
  /** Lesson sets only. */
  pass: passResultSchema.nullable(),
});
export type PracticeSetResult = z.infer<typeof practiceSetResultSchema>;

export const practiceSetViewSchema = z.object({
  id: z.string(),
  kind: z.enum(PRACTICE_SET_KINDS),
  status: z.enum(PRACTICE_SET_STATUSES),
  lessonId: z.string().nullable(),
  items: z.array(practiceItemViewSchema),
  progress: practiceProgressSchema,
  /** First pending item, `null` when every item is done. */
  nextItemId: z.string().nullable(),
  passRule: passRuleSchema.nullable(),
  result: practiceSetResultSchema.nullable(),
  createdAt: z.number(),
  completedAt: z.number().nullable(),
});
export type PracticeSetView = z.infer<typeof practiceSetViewSchema>;

/**
 * `POST /attempts`. `answer` and `runResult` are validated by exercise-kit (`parseAnswer`,
 * `parseRunResult`); run-based types need `runResult` from the sandbox.
 */
export const attemptRequestSchema = z
  .object({
    practiceSetItemId: rowId,
    exerciseId: contentId,
    answer: z.unknown(),
    runResult: z.unknown().optional(),
    /** `null`/absent when the learner was not asked. */
    confidence: confidenceSchema.nullable().optional(),
    /** When the learner first saw the exercise (epoch ms). Clamped to the server clock. */
    startedAt: z.number().int().min(0),
    /** Active solving time without idle gaps. */
    activeMs: z.number().int().min(0).max(86_400_000),
    tutorAssisted: z.boolean().optional(),
  })
  .strict();
export type AttemptRequest = z.infer<typeof attemptRequestSchema>;

export const masteryChangeSchema = z.object({
  conceptId: z.string(),
  title: z.string(),
  scoreBefore: z.number(),
  scoreAfter: z.number(),
  stageBefore: masteryStageSchema,
  stageAfter: masteryStageSchema,
});
export type MasteryChange = z.infer<typeof masteryChangeSchema>;

const feedbackItemSchema = z.object({
  level: z.enum(['success', 'error', 'warning', 'info']),
  code: z.string(),
  message: z.string(),
  target: z.string().optional(),
  requirement: z.string().optional(),
});

/** exercise-kit `CheckResult` (expected/actual detail only for visible checks). */
const checkResultSchema = z.object({
  id: z.string(),
  kind: z.string(),
  passed: z.boolean(),
  required: z.boolean(),
  weight: z.number(),
  visible: z.boolean(),
  description: z.string().optional(),
  requirement: z.string().optional(),
  reason: z.string().optional(),
  detail: z
    .object({
      path: z.string().optional(),
      expected: z.string().optional(),
      actual: z.string().optional(),
    })
    .optional(),
});

export const attemptResponseSchema = z.object({
  attempt: z.object({
    id: z.string(),
    outcome: z.enum(ATTEMPT_OUTCOMES),
    score: z.number(),
    correct: z.boolean(),
    /** False for sandbox failures (`crashed`/`aborted`): recorded, not counted. */
    engineApplied: z.boolean(),
    attemptNo: z.int(),
    attemptInItem: z.int(),
  }),
  grade: z.object({
    feedback: z.array(feedbackItemSchema),
    checkResults: z.array(checkResultSchema).optional(),
    failedRequirements: z.array(z.string()).optional(),
    milestones: z
      .array(z.object({ id: z.string(), title: z.string(), passed: z.boolean() }))
      .optional(),
    /** Misconceptions suggested by the answer, with content.db titles. */
    misconceptions: z.array(z.object({ id: z.string(), title: z.string() })),
  }),
  /** One entry per tagged concept: state before this attempt → after it (and any FSRS review). */
  masteryChanges: z.array(masteryChangeSchema),
  item: z.object({ id: z.string(), status: z.enum(PRACTICE_ITEM_STATUSES), attempts: z.int() }),
  set: z.object({
    id: z.string(),
    status: z.enum(PRACTICE_SET_STATUSES),
    progress: practiceProgressSchema,
    nextItemId: z.string().nullable(),
    /** Present when this attempt completed the set. */
    result: practiceSetResultSchema.nullable(),
  }),
});
export type AttemptResponse = z.infer<typeof attemptResponseSchema>;
