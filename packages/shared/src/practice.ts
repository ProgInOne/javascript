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
/** `misconception_observations.status` (learning-engine.md#오개념-상태-전이). */
export const MISCONCEPTION_STATUSES = ['suspected', 'confirmed', 'resolved', 'dismissed'] as const;
/** `distractor`: chosen wrong option · `pattern`: rule-based wrong answer · `ai`: AI proposal. */
export const MISCONCEPTION_SOURCES = ['distractor', 'pattern', 'ai'] as const;
/** Relearning steps (learning-engine.md#재학습-규칙). */
export const REMEDIATION_KINDS = [
  'prerequisite_check',
  'worked_example',
  'easier_with_hint',
  'reread_lesson',
] as const;
export const REMEDIATION_TRIGGERS = [
  'set_consecutive_failures',
  'recent_consecutive_failures',
] as const;

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
  /** Language of the exercise's course: labels `code` (null outside a course lesson). */
  codeLanguage: z.enum(['html', 'css', 'javascript']).nullable(),
  publicSpec: z.record(z.string(), z.unknown()),
  estimatedSeconds: z.int(),
  /** True when grading needs a sandbox `RunResult` (fetch a run plan first). */
  requiresRun: z.boolean(),
  /**
   * 작성형 (D-084): the learner writes the code from an empty starter (`implement_function`, or a
   * `web_task` whose focused part starts empty) instead of editing given code. The UI shows a
   * "직접 작성" badge.
   */
  writing: z.boolean(),
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
  /** mcq_multi: every correct option. */
  z.object({
    kind: z.literal('choices'),
    choices: z.array(z.object({ id: z.string(), text: z.string() })),
  }),
  /** A short answer in words (true_false verdict and reason, find_bug_line line and cause). */
  z.object({ kind: z.literal('text'), text: z.string() }),
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
  /** Today's review set from the review queue (one active review set at a time). */
  z.object({ kind: z.literal('review') }).strict(),
  /**
   * Weakness practice (learning-engine.md#약점-집중-세트). Without `conceptIds` the active weakness
   * set is returned, or a new one is built for the weakest 3–5 concepts. With `conceptIds` (the
   * learner's pick from `GET /weak-concepts`) a new set is built for exactly those concepts.
   */
  z
    .object({
      kind: z.literal('weakness'),
      conceptIds: z.array(contentId).min(1).max(5).optional(),
    })
    .strict(),
  /**
   * The unit assessment of a `kind: assessment` lesson (learning-engine.md#단원-평가-세트). The
   * active attempt is returned as-is; a finished one is not reused (asking again is a retake).
   */
  z.object({ kind: z.literal('assessment'), lessonId: contentId }).strict(),
  /**
   * "다시 풀기" from the mistake notes (ui-ux.md 오답 노트): exactly these exercises, in this
   * order. An active extra set with the same exercises is resumed. Assessment-only exercises,
   * reported ones and those of an assessment in progress are refused.
   */
  z
    .object({
      kind: z.literal('extra'),
      exerciseIds: z
        .array(contentId)
        .min(1)
        .max(10)
        .refine((ids) => new Set(ids).size === ids.length, '같은 문제를 두 번 넣을 수 없습니다.'),
    })
    .strict(),
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
  /** Always `null` while an assessment is in progress (results are withheld until it ends). */
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
  minConceptCredit: z.number(),
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
    /** Results before D-081: concepts whose long-term mastery score was under the bar. */
    minConceptScore: passCheckSchema.extend({ below: z.array(conceptRefSchema) }).optional(),
    /** D-081: each introduced concept's credited correctness within the set. */
    minConceptCredit: passCheckSchema
      .extend({
        below: z.array(conceptRefSchema),
        concepts: z.array(
          conceptRefSchema.extend({
            credit: z.number(),
            correct: z.int().min(0),
            total: z.int().min(0),
            met: z.boolean(),
          }),
        ),
      })
      .optional(),
    minDistinctTypes: passCheckSchema,
    minLevel3Correct: passCheckSchema,
  }),
});
export type PassResultView = z.infer<typeof passResultSchema>;

/** One item of a finished assessment, with what was withheld during it. */
export const assessmentResultItemSchema = z.object({
  itemId: z.string(),
  position: z.int().min(0),
  exerciseId: z.string(),
  type: z.string(),
  difficulty: z.int().min(1).max(5),
  /** Exercise prompt (Markdown) so the learner can recall the question. */
  prompt: z.string(),
  concept: conceptRefSchema.nullable(),
  status: z.enum(PRACTICE_ITEM_STATUSES),
  /** `null` when skipped. */
  outcome: z.enum(ATTEMPT_OUTCOMES).nullable(),
  correct: z.boolean(),
  /** Misconceptions the answer suggested. */
  misconceptions: z.array(z.object({ id: z.string(), title: z.string() })),
  explanation: z.string(),
  solution: solutionViewSchema,
});
export type AssessmentResultItem = z.infer<typeof assessmentResultItemSchema>;

/** Result of a finished assessment (learning-engine.md#단원-평가-세트). */
export const assessmentResultSchema = z.object({
  correct: z.int().min(0),
  total: z.int().min(0),
  ratio: z.number().min(0).max(1),
  passRatio: z.number().min(0).max(1),
  passed: z.boolean(),
  items: z.array(assessmentResultItemSchema),
  concepts: z.array(
    z.object({ concept: conceptRefSchema, total: z.int().min(0), correct: z.int().min(0) }),
  ),
  /** Concepts with a wrong or skipped item, in order of appearance. */
  missedConcepts: z.array(conceptRefSchema),
  /** Up to 5 missed concepts for "약점 집중" (`POST /practice-sets {kind:'weakness', conceptIds}`). */
  weaknessConceptIds: z.array(z.string()).max(5),
});
export type AssessmentResult = z.infer<typeof assessmentResultSchema>;

export const practiceSetResultSchema = z.object({
  total: z.int(),
  answered: z.int(),
  skipped: z.int(),
  /** Items whose last attempt was correct. */
  correct: z.int(),
  /** Lesson sets only. */
  pass: passResultSchema.nullable(),
  /** Assessment sets only: score, every item's answer and explanation, missed concepts. */
  assessment: assessmentResultSchema.optional(),
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

export const misconceptionStatusSchema = z.enum(MISCONCEPTION_STATUSES);
export type MisconceptionStatus = z.infer<typeof misconceptionStatusSchema>;

/**
 * A misconception observation changed by an attempt (learning-engine.md#오개념-상태-전이).
 * `transitions` are engine codes in order: `observed`, `evidence_added`, `confirmed`,
 * `reopened`, `relapsed`, `resolution_progress`, `resolved`, `dismissed_by_targets`,
 * `dismissed_expired`.
 */
export const misconceptionChangeSchema = z.object({
  misconceptionId: z.string(),
  title: z.string(),
  conceptId: z.string(),
  statusBefore: misconceptionStatusSchema.nullable(),
  statusAfter: misconceptionStatusSchema,
  transitions: z.array(z.string()),
  /** Progress towards `resolved` (confirmed) or `dismissed` (suspected); 0/0 otherwise. */
  resolution: z.object({ done: z.int().min(0), required: z.int().min(0) }),
});
export type MisconceptionChange = z.infer<typeof misconceptionChangeSchema>;

const masteryStageRef = z.object({
  conceptId: z.string(),
  title: z.string(),
  stage: masteryStageSchema,
  /** Effective mastery (score with forgetting) 0–100. */
  effective: z.number(),
});

/**
 * A relearning suggestion (learning-engine.md#재학습-규칙, ui-ux.md#재학습-유도). The learner may
 * decline it ("계속 풀기"); nothing is locked.
 * - `prerequisite_check`: check the weakest prerequisite with a short set (`check`).
 * - `worked_example`: worked example stages (0 full solution → 1 blanks → 2 solve).
 * - `easier_with_hint`: one easier item (`targetDifficulty`) with hint `autoHintLevel` opened.
 * - `reread_lesson`: reread the lesson that introduces the concept; `tutorBadge` shows the tutor
 *   badge (never opens the tutor by itself, D-010).
 */
export const remediationSchema = z.object({
  id: z.string(),
  concept: conceptRefSchema,
  trigger: z.enum(REMEDIATION_TRIGGERS),
  kind: z.enum(REMEDIATION_KINDS),
  prerequisite: masteryStageRef.nullable(),
  check: z
    .object({
      items: z.int(),
      minDifficulty: z.int(),
      maxDifficulty: z.int(),
      passCorrect: z.int(),
    })
    .nullable(),
  workedExampleStages: z.array(z.int().min(0).max(2)),
  targetDifficulty: z.int().nullable(),
  autoHintLevel: z.int().min(0).max(3),
  tutorBadge: z.boolean(),
  /** Lesson introducing the concept (for `reread_lesson` and "관련 레슨"). */
  lesson: conceptRefSchema.nullable(),
  /** Prerequisites inspected, shallowest first (the "왜" of the suggestion). */
  prerequisitesChecked: z.array(masteryStageRef.extend({ depth: z.int(), weak: z.boolean() })),
  /** Items appended to the current set for this suggestion (empty for `reread_lesson`). */
  itemIds: z.array(z.string()),
});
export type Remediation = z.infer<typeof remediationSchema>;

/**
 * A change the engine made to the set while it is in progress
 * (learning-engine.md#진행-중-적응-nextadaptivestep). `replace` swaps the exercise of a pending,
 * unseen item; `append` adds an item at the end. Reasons: `difficulty_step_up`,
 * `remedial_prereq`, `remedial_worked_example`, `remedial_easier` (open hint 1 automatically),
 * `solution_followup` ("비슷한 문제로 다시 나와요"), `skip_followup`.
 */
export const setAdaptationSchema = z.object({
  kind: z.enum(['replace', 'append']),
  itemId: z.string(),
  position: z.int().min(0),
  exerciseId: z.string(),
  reason: z.string(),
  targetConcept: conceptRefSchema.nullable(),
});
export type SetAdaptation = z.infer<typeof setAdaptationSchema>;

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
    /** Authored explanation, shown after grading ("해설 보기"). */
    explanation: z.string(),
  }),
  /** One entry per tagged concept: state before this attempt → after it (and any FSRS review). */
  masteryChanges: z.array(masteryChangeSchema),
  /** Misconception observations this attempt created or moved. */
  misconceptionChanges: z.array(misconceptionChangeSchema),
  /** Relearning suggestion after repeated failure, or null. */
  remediation: remediationSchema.nullable(),
  /** Items replaced or appended by this attempt (re-fetch the set to show them). */
  adaptations: z.array(setAdaptationSchema),
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

/**
 * `POST /attempts` for an item of an assessment in progress: the answer is recorded and counted,
 * but the outcome, feedback, explanation and mastery changes are withheld until the assessment
 * ends (learning-engine.md#단원-평가-세트). The submission that finishes the set carries the full
 * result in `set.result.assessment`. `engineApplied: false` (sandbox failure) means "submit
 * again": the item stays pending.
 */
export const assessmentAttemptResponseSchema = z.object({
  withheld: z.literal(true),
  attempt: attemptResponseSchema.shape.attempt.pick({
    id: true,
    engineApplied: true,
    attemptNo: true,
    attemptInItem: true,
  }),
  item: attemptResponseSchema.shape.item,
  set: attemptResponseSchema.shape.set,
});
export type AssessmentAttemptResponse = z.infer<typeof assessmentAttemptResponseSchema>;

/** Either response of `POST /attempts` (assessments answer with the withheld shape). */
export const submitAttemptResponseSchema = z.union([
  assessmentAttemptResponseSchema,
  attemptResponseSchema,
]);
export type SubmitAttemptResponse = z.infer<typeof submitAttemptResponseSchema>;

export function isWithheldAttempt(
  response: SubmitAttemptResponse,
): response is AssessmentAttemptResponse {
  return 'withheld' in response;
}

/**
 * `POST /practice-sets/:id/items/:itemId/skip`: the learner skips a pending item. A follow-up of
 * the same concept and difficulty (another type) is appended, except for follow-up and
 * relearning items. Skipping the last pending item completes the set.
 */
export const skipItemResponseSchema = attemptResponseSchema.pick({
  item: true,
  set: true,
  adaptations: true,
  masteryChanges: true,
});
export type SkipItemResponse = z.infer<typeof skipItemResponseSchema>;

/**
 * `POST /practice-sets/:id/finish`: ends an open set whose items are all done. A wrong answer to
 * the last pending item keeps the set open for another try; "결과 보기" ends it here.
 * `409 PRACTICE_SET_UNFINISHED` while items are pending, `409 PRACTICE_SET_CLOSED` once ended.
 */
export const finishSetResponseSchema = attemptResponseSchema.pick({
  set: true,
  masteryChanges: true,
});
export type FinishSetResponse = z.infer<typeof finishSetResponseSchema>;

/**
 * `POST /exercises/:id/inline-attempts`: a lesson's inline check (`<InlineExercise>`), answered
 * while reading, outside any practice set. Only `usage: check` items (D-091), which are graded
 * without a sandbox run.
 * Mastery is updated like any attempt; FSRS scheduling is left to practice and review sets.
 */
export const inlineAttemptRequestSchema = attemptRequestSchema
  .omit({ practiceSetItemId: true, exerciseId: true, runResult: true })
  .strict();
export type InlineAttemptRequest = z.infer<typeof inlineAttemptRequestSchema>;

export const inlineAttemptResponseSchema = attemptResponseSchema.pick({
  attempt: true,
  grade: true,
  masteryChanges: true,
  misconceptionChanges: true,
});
export type InlineAttemptResponse = z.infer<typeof inlineAttemptResponseSchema>;

/**
 * `POST /exercises/:id/try-attempts`: a lesson's "직접 써 보기" task (`<TryIt>`, D-091). The
 * sandbox run is graded for feedback only: nothing is recorded (no attempt, mastery, FSRS or
 * mistake note), so the learner can check as often as they like.
 */
export const tryAttemptRequestSchema = z
  .object({ answer: z.unknown(), runResult: z.unknown() })
  .strict();
export type TryAttemptRequest = z.infer<typeof tryAttemptRequestSchema>;

export const tryAttemptResponseSchema = z.object({
  attempt: attemptResponseSchema.shape.attempt.pick({ outcome: true, score: true, correct: true }),
  grade: attemptResponseSchema.shape.grade,
});
export type TryAttemptResponse = z.infer<typeof tryAttemptResponseSchema>;

// ── Reading progress, review queue, activity, dashboard ──────────────────────

/** `POST /lessons/:id/progress`: reading position. The first call starts the lesson. */
export const lessonProgressRequestSchema = z
  .object({
    /** 0–1 scroll progress of the body; stored as the maximum seen. */
    readProgress: z.number().min(0).max(1),
    /** Section to restore the reading position to. */
    lastSectionId: z
      .string()
      .max(120)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
      .nullable()
      .optional(),
  })
  .strict();
export type LessonProgressRequest = z.infer<typeof lessonProgressRequestSchema>;

export const lessonProgressSchema = z.object({
  lessonId: z.string(),
  status: z.enum(LESSON_PROGRESS_STATUSES),
  readProgress: z.number(),
  lastSectionId: z.string().nullable(),
  practiceSetId: z.string().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  /** Concepts this call moved from `not_started` to `introduced` (first visit only). */
  introducedConcepts: z.array(conceptRefSchema),
});
export type LessonProgress = z.infer<typeof lessonProgressSchema>;

export const reviewQueueEntrySchema = z.object({
  conceptId: z.string(),
  title: z.string(),
  dueAt: z.number(),
  /** Due before today (learner-local): "예정일이 지났어요". */
  overdue: z.boolean(),
  overdueDays: z.int().min(0),
  itemCount: z.int().min(1).max(2),
  estimatedSeconds: z.number(),
  priority: z.number(),
});
export type ReviewQueueEntryView = z.infer<typeof reviewQueueEntrySchema>;

/** `GET /review-queue?budgetMinutes=`. */
export const reviewQueueQuerySchema = z
  .object({ budgetMinutes: z.coerce.number().int().min(1).max(240).optional() })
  .strict();

export const reviewQueueSchema = z.object({
  /** Learner-local date (day starts at `day_start_hour`). */
  date: z.string(),
  budgetMinutes: z.int(),
  /** Today's reviews, highest priority first. */
  due: z.array(reviewQueueEntrySchema),
  /** Due but over today's budget ("밀림"). */
  deferred: z.array(reviewQueueEntrySchema),
  estimatedMinutes: z.number(),
});
export type ReviewQueue = z.infer<typeof reviewQueueSchema>;

/** `POST /activity/heartbeat`, every 30 s while the app is open (learning-engine.md#학습-시간-측정). */
export const heartbeatRequestSchema = z
  .object({
    /** Last keyboard/pointer/scroll/editor input (epoch ms). Clamped to the server clock. */
    lastInputAt: z.number().int().min(0),
    visible: z.boolean(),
    focused: z.boolean(),
    /**
     * Lesson on screen (reading or practising it): the counted time is added to that lesson's
     * actual time while it is in progress (FR-GOAL-02 pace calibration).
     */
    lessonId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;

export const heartbeatResponseSchema = z.object({
  date: z.string(),
  /** Active time counted from the previous heartbeat to this one. */
  countedMs: z.int().min(0),
  activeMsToday: z.int().min(0),
});
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;

/** `GET /dashboard`: the minimal v0.1 dashboard. */
export const dashboardSchema = z.object({
  date: z.string(),
  activeMinutesToday: z.int().min(0),
  reviewDueCount: z.int().min(0),
  /** Most recently active lesson that is being read or practiced. */
  continueLesson: z
    .object({
      id: z.string(),
      title: z.string(),
      status: z.enum(LESSON_PROGRESS_STATUSES),
      readProgress: z.number(),
      practiceSetId: z.string().nullable(),
    })
    .nullable(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

// ── Weakness practice ────────────────────────────────────────────────────────

/** One weak concept with the reasons behind it ("왜 약점인가요?"). */
export const weakConceptSchema = z.object({
  concept: conceptRefSchema,
  /** Engine weakness score (higher = weaker). */
  weakness: z.number(),
  effective: z.number(),
  stage: masteryStageSchema,
  consecutiveFailures: z.int().min(0),
  factors: z.object({
    gap: z.number(),
    importanceFactor: z.number(),
    misconceptionFactor: z.number(),
    failureFactor: z.number(),
  }),
  /** Active misconceptions of the concept. */
  misconceptions: z.array(
    z.object({ id: z.string(), title: z.string(), status: misconceptionStatusSchema }),
  ),
  /** Required prerequisites with their state (weak = effective < 60 or below practicing). */
  prerequisites: z.array(
    z.object({
      concept: conceptRefSchema,
      stage: masteryStageSchema,
      effective: z.number(),
      weak: z.boolean(),
    }),
  ),
});
export type WeakConcept = z.infer<typeof weakConceptSchema>;

/** `GET /weak-concepts`: up to 10 weakest concepts; `suggested` are the automatic set's targets. */
export const weakConceptsSchema = z.object({
  concepts: z.array(weakConceptSchema),
  suggested: z.array(z.string()),
});
export type WeakConcepts = z.infer<typeof weakConceptsSchema>;

// ── Exercise statistics (FR-EX-10) ───────────────────────────────────────────

/**
 * `GET /exercises/:id/stats`: the learner's statistics for one exercise, derived from recorded
 * attempts (D-051). Attempts of an assessment still in progress are left out (results withheld).
 * Rates are null until there is something to divide by.
 */
export const exerciseStatsSchema = z.object({
  exerciseId: z.string(),
  /** Graded attempts (sandbox failures that were not applied are not counted). */
  attempts: z.number().int().nonnegative(),
  /** Times the exercise was put in a practice set. */
  timesServed: z.number().int().nonnegative(),
  /** First attempts within one serving (or outside any set), and how many were correct. */
  firstTries: z.number().int().nonnegative(),
  firstTryCorrect: z.number().int().nonnegative(),
  firstTryCorrectRate: z.number().min(0).max(1).nullable(),
  /** Average active time per attempt, in milliseconds. */
  averageActiveMs: z.number().nonnegative().nullable(),
  /** Attempts submitted with at least one hint open, and their share of all attempts. */
  hintUsedAttempts: z.number().int().nonnegative(),
  hintUsageRate: z.number().min(0).max(1).nullable(),
  solutionViewedAttempts: z.number().int().nonnegative(),
  lastAttemptAt: z.number().int().nullable(),
});
export type ExerciseStats = z.infer<typeof exerciseStatsSchema>;
