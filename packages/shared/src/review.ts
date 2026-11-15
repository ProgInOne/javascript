import { z } from 'zod';
import {
  CONFIDENCES,
  conceptRefSchema,
  masteryStageSchema,
  PRACTICE_SET_KINDS,
  solutionViewSchema,
} from './practice.ts';

// Review screen: mistake notes and mastery changes (docs/design/ui-ux.md 복습 화면·오답 노트,
// FR-DASH-04). Times are epoch ms; dates are learner-local `YYYY-MM-DD`.

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const contentId = z.string().min(1).max(200);

// ── Mistake notes ────────────────────────────────────────────────────────────

/**
 * - `open`: no correct attempt since the latest wrong one ("아직 못 맞힌 것").
 * - `resolved`: answered correctly, without viewing the solution, after the latest wrong attempt.
 *   A later wrong attempt opens the note again.
 */
export const MISTAKE_STATUSES = ['open', 'resolved'] as const;
export const mistakeStatusSchema = z.enum(MISTAKE_STATUSES);
export type MistakeStatus = z.infer<typeof mistakeStatusSchema>;

export const MISTAKE_SORTS = ['recent', 'confident'] as const;

/** Wrong outcomes collected in the notes (data-model.md: `incorrect`, `partial`). */
export const MISTAKE_OUTCOMES = ['incorrect', 'partial'] as const;

/** Where an attempt was made: a practice set kind, or `inline` (a check in the lesson body). */
export const attemptContextSchema = z.enum([...PRACTICE_SET_KINDS, 'inline']);
export type AttemptContext = z.infer<typeof attemptContextSchema>;

/** `GET /mistakes` query. */
export const mistakeListQuerySchema = z
  .object({
    courseId: contentId.optional(),
    moduleId: contentId.optional(),
    conceptId: contentId.optional(),
    status: z.enum([...MISTAKE_STATUSES, 'all']).default('all'),
    /** `confident`: confident wrong answers first (ui-ux.md: 과잉 교정 기회), then recent. */
    sort: z.enum(MISTAKE_SORTS).default('recent'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();
export type MistakeListQuery = z.input<typeof mistakeListQuerySchema>;

const misconceptionRefSchema = z.object({ id: z.string(), title: z.string() });

/** Why "다시 풀기" is not offered for a note. */
export const RETRY_BLOCKS = ['archived', 'assessment_only', 'reported', 'unsupported'] as const;

/** One note: an exercise the learner answered wrongly, with its latest wrong attempt. */
export const mistakeNoteSchema = z.object({
  exerciseId: z.string(),
  /** Exercise type (`unknown` when the exercise left the content pack). */
  type: z.string(),
  difficulty: z.int().min(1).max(5),
  /** Markdown prompt as shown when it was answered (empty when archived). */
  prompt: z.string(),
  concept: conceptRefSchema.nullable(),
  module: conceptRefSchema.nullable(),
  course: conceptRefSchema.nullable(),
  /** Latest wrong attempt. */
  lastWrongAt: z.number(),
  lastWrongOutcome: z.enum(MISTAKE_OUTCOMES),
  lastWrongContext: attemptContextSchema,
  /** Wrong attempts recorded on the exercise. */
  wrongCount: z.int().min(1),
  /** The latest wrong attempt was submitted with "확실해요" ("확실했어요 ⚠"). */
  confidentWrong: z.boolean(),
  /** Misconceptions of the latest wrong attempt (titles only: what the feedback showed). */
  misconceptions: z.array(misconceptionRefSchema),
  status: mistakeStatusSchema,
  /** The correct attempt that resolved the note. */
  resolvedAt: z.number().nullable(),
  archived: z.boolean(),
  /** "다시 풀기" availability (the same exercise in an `extra` set). */
  retry: z.object({ available: z.boolean(), blockedBy: z.enum(RETRY_BLOCKS).nullable() }),
});
export type MistakeNote = z.infer<typeof mistakeNoteSchema>;

/** `GET /mistakes`: notes after filters, the counts per status and the filter choices. */
export const mistakeListSchema = z.object({
  items: z.array(mistakeNoteSchema),
  /** Notes matching every filter (paging). */
  total: z.int().min(0),
  /** Counts under the course/module/concept filters, before the status filter. */
  counts: z.object({ all: z.int(), open: z.int(), resolved: z.int() }),
  /** Filter choices: every course, module and concept that has notes, in catalog order. */
  facets: z.object({
    courses: z.array(conceptRefSchema),
    modules: z.array(conceptRefSchema.extend({ courseId: z.string() })),
    concepts: z.array(conceptRefSchema.extend({ moduleId: z.string().nullable() })),
  }),
});
export type MistakeList = z.infer<typeof mistakeListSchema>;

/** One wrong attempt in the note detail. */
export const mistakeAttemptSchema = z.object({
  id: z.string(),
  submittedAt: z.number(),
  outcome: z.enum(MISTAKE_OUTCOMES),
  confidence: z.enum(CONFIDENCES).nullable(),
  context: attemptContextSchema,
  /** The learner's own answer in the reference answer's shape (`none` if it cannot be shown). */
  answer: solutionViewSchema,
  misconceptions: z.array(misconceptionRefSchema),
  /**
   * Grader feedback messages as shown after the attempt. Empty for assessment attempts: their
   * per-item feedback was never shown.
   */
  feedback: z.array(z.string()),
  hintLevelMax: z.int().min(0).max(3),
  solutionViewed: z.boolean(),
});
export type MistakeAttempt = z.infer<typeof mistakeAttemptSchema>;

/**
 * `GET /mistakes/:exerciseId`. Only what the learner has already seen: the explanation (shown
 * after every graded attempt, or at the end of an assessment), and the reference answer only
 * when they opened it ("정답 보기") or a finished assessment revealed it.
 */
export const mistakeDetailSchema = z.object({
  note: mistakeNoteSchema,
  /** Code shown with the prompt (the exercise's code or its public spec's code). */
  code: z.string().nullable(),
  codeLanguage: z.enum(['html', 'css', 'javascript']).nullable(),
  /** Wrong attempts, newest first (at most 10). */
  attempts: z.array(mistakeAttemptSchema),
  explanation: z.string(),
  /** Null while the learner has not seen the reference answer. */
  solution: solutionViewSchema.nullable(),
  /** How the reference answer was seen, or null. */
  solutionSource: z.enum(['viewed', 'assessment']).nullable(),
});
export type MistakeDetail = z.infer<typeof mistakeDetailSchema>;

// ── Mastery changes ──────────────────────────────────────────────────────────

/** `GET /mastery-changes` query. */
export const masteryChangesQuerySchema = z
  .object({
    weeks: z.coerce.number().int().min(1).max(26).default(8),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

/** One stage change from the evidence log (`mastery_evidence.stage_before ≠ stage_after`). */
export const masteryStageChangeSchema = z.object({
  id: z.string(),
  at: z.number(),
  date: localDate,
  concept: conceptRefSchema,
  stageBefore: masteryStageSchema,
  stageAfter: masteryStageSchema,
  direction: z.enum(['up', 'down']),
  scoreBefore: z.number(),
  scoreAfter: z.number(),
});
export type MasteryStageChange = z.infer<typeof masteryStageChangeSchema>;

/** `GET /mastery-changes` (FR-DASH-04 숙련도 변화). */
export const masteryChangesSchema = z.object({
  /** Today (learner-local). */
  date: localDate,
  /** Monday-start weeks, oldest first, the current week last (empty weeks included). */
  weeks: z.array(
    z.object({
      weekStart: localDate,
      promotions: z.int().min(0),
      demotions: z.int().min(0),
      /** Distinct concepts that changed stage that week. */
      concepts: z.int().min(0),
    }),
  ),
  /** Newest changes first. */
  recent: z.array(masteryStageChangeSchema),
  /** Changes inside the `weeks` window. */
  totals: z.object({ promotions: z.int().min(0), demotions: z.int().min(0) }),
});
export type MasteryChanges = z.infer<typeof masteryChangesSchema>;
