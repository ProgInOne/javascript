import { z } from 'zod';
import {
  conceptRefSchema,
  FSRS_CARD_STATES,
  FSRS_RATINGS,
  LESSON_PROGRESS_STATUSES,
  masteryStageSchema,
  MISCONCEPTION_SOURCES,
  misconceptionStatusSchema,
} from './practice.ts';

// Goals, today's plan and the concept detail (docs/design/learning-engine.md#오늘의-학습과-목표,
// docs/design/ui-ux.md 대시보드·개념 상세). Times are epoch ms; dates are learner-local
// `YYYY-MM-DD` (the day starts at `day_start_hour`).

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const contentId = z.string().min(1).max(200);

// ── Goals and pace ───────────────────────────────────────────────────────────

export const PACE_STATUSES = ['on_track', 'tight', 'behind', 'overdue'] as const;

/** `PUT /goals` (FR-GOAL-01/02). Omit both target fields to drop the course target. */
export const goalRequestSchema = z
  .object({
    dailyMinutes: z.int().min(5).max(480),
    weeklyDays: z.int().min(1).max(7),
    /** Course to finish by `targetDate`; both or neither. */
    targetCourseId: contentId.nullable().optional(),
    targetDate: localDate.nullable().optional(),
  })
  .strict()
  .refine((g) => ((g.targetCourseId ?? null) === null) === ((g.targetDate ?? null) === null), {
    message: 'targetCourseId와 targetDate는 함께 정합니다.',
    path: ['targetDate'],
  });
export type GoalRequest = z.infer<typeof goalRequestSchema>;

export const goalSchema = z.object({
  dailyMinutes: z.int(),
  weeklyDays: z.int(),
  targetCourse: conceptRefSchema.nullable(),
  targetDate: localDate.nullable(),
  /** Since when this goal applies; null for the defaults (no goal set yet). */
  effectiveFrom: z.number().nullable(),
  isDefault: z.boolean(),
});
export type GoalView = z.infer<typeof goalSchema>;

/**
 * Goal pace (learning-engine.md#목표-페이스-계산-computepace). Display: `on_track` "이 페이스면
 * 목표일 전에 끝나요", `tight` "빠듯해요", `behind` "하루 목표를 X분으로 늘리거나, 목표일을
 * YYYY-MM-DD로 옮기면 맞출 수 있어요", `overdue` "목표일이 지났어요".
 */
export const paceSchema = z.object({
  status: z.enum(PACE_STATUSES),
  targetDate: localDate,
  remainingMinutes: z.number(),
  studyDaysLeft: z.int().min(0),
  requiredPerDay: z.number(),
  newLearningBudget: z.number(),
  suggestedDailyMinutes: z.int().nullable(),
  suggestedTargetDate: localDate,
  /** Actual/estimated ratio applied to lesson estimates (1 until enough lessons are timed). */
  calibration: z.number(),
});
export type PaceView = z.infer<typeof paceSchema>;

/** One week, Monday to Sunday (FR-GOAL-04). */
export const weekSummarySchema = z.object({
  weekStart: localDate,
  days: z.array(
    z.object({
      date: localDate,
      activeMinutes: z.int().min(0),
      /** ≥ 5 active minutes. */
      studied: z.boolean(),
      /** ≥ that day's daily goal. */
      goalMet: z.boolean(),
    }),
  ),
  studiedDays: z.int().min(0),
  goalDays: z.int().min(0),
  weeklyDays: z.int(),
  achieved: z.boolean(),
  activeMinutes: z.int().min(0),
});
export type WeekSummaryView = z.infer<typeof weekSummarySchema>;

/** `GET /goals` and `PUT /goals` response. */
export const goalStatusSchema = z.object({
  date: localDate,
  goal: goalSchema,
  /** Null without a course target. */
  pace: paceSchema.nullable(),
  week: weekSummarySchema,
  /** Consecutive achieved weeks (rest days never break it). */
  streakWeeks: z.int().min(0),
});
export type GoalStatus = z.infer<typeof goalStatusSchema>;

// ── Today's plan ─────────────────────────────────────────────────────────────

export const DAILY_BLOCK_KINDS = ['review', 'continue', 'new_lesson', 'weakness'] as const;

/**
 * Why a block is planned. `reviews_due` {count, overdueCount} · `reviews_over_budget` {count} ·
 * `continue_lesson` {remainingMinutes} · `new_lesson` {why: first_lesson | nothing_in_progress |
 * pace_behind | pace_tight} · `weak_concepts` {topEffective} · `over_budget`.
 */
export const dailyBlockReasonSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('reviews_due'), count: z.int(), overdueCount: z.int() }),
  z.object({ code: z.literal('reviews_over_budget'), count: z.int() }),
  z.object({ code: z.literal('continue_lesson'), remainingMinutes: z.int() }),
  z.object({
    code: z.literal('new_lesson'),
    why: z.enum(['first_lesson', 'nothing_in_progress', 'pace_behind', 'pace_tight']),
  }),
  z.object({ code: z.literal('weak_concepts'), topEffective: z.number() }),
  z.object({ code: z.literal('over_budget') }),
]);
export type DailyBlockReason = z.infer<typeof dailyBlockReasonSchema>;

export const dailyPlanBlockSchema = z.object({
  kind: z.enum(DAILY_BLOCK_KINDS),
  minutes: z.int().min(1),
  reason: dailyBlockReasonSchema,
  /** `review` (priority order) and `weakness` (targets). */
  concepts: z.array(conceptRefSchema),
  /** `continue` and `new_lesson`. */
  lesson: z
    .object({
      id: z.string(),
      title: z.string(),
      status: z.enum(LESSON_PROGRESS_STATUSES),
      practiceSetId: z.string().nullable(),
      /** `project`: continue on the project screen (no practice set). Absent from older servers. */
      kind: z.enum(['lesson', 'assessment', 'project']).optional(),
    })
    .nullable(),
  /** Only part of the lesson fits today's budget. */
  partial: z.boolean(),
});
export type DailyPlanBlockView = z.infer<typeof dailyPlanBlockSchema>;

/**
 * `GET /daily-plan` (FR-GOAL-03): review → continue → new lesson → weakness within today's
 * budget `max(dailyMinutes − activeMinutesToday, 10)`. `later` is "시간이 남으면". After the goal
 * is met, `mode: 'extra'` offers the same composition as extra study.
 */
export const dailyPlanSchema = z.object({
  date: localDate,
  goal: goalSchema,
  activeMinutesToday: z.int().min(0),
  budgetMinutes: z.int(),
  goalMet: z.boolean(),
  mode: z.enum(['plan', 'extra']),
  blocks: z.array(dailyPlanBlockSchema),
  later: z.array(dailyPlanBlockSchema),
  totalMinutes: z.int().min(0),
  pace: paceSchema.nullable(),
});
export type DailyPlanView = z.infer<typeof dailyPlanSchema>;

// ── Concept detail ───────────────────────────────────────────────────────────

/** A gate condition still missing (engine `GateShortfall`). */
export const gateShortfallSchema = z.object({
  /**
   * `evidence_weight_sum` · `effective` · `distinct_types` · `distinct_variant_groups` ·
   * `level3_correct` · `spaced_reviews` · `independent_application` · `recent_again`.
   */
  gate: z.string(),
  required: z.number(),
  actual: z.number(),
});

/** One weight factor of an attempt (`why` codes: `primary`, `L3`, `attempt 2`, `sure`, …). */
const factorSchema = z.object({ value: z.number(), why: z.string() });

/** One `mastery_evidence` row: what moved the score and why ("숙련도가 이렇게 계산됐어요"). */
export const masteryEvidenceSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  kind: z.enum(['attempt', 'stage_gate', 'diagnostic_seed', 'recompute']),
  attemptId: z.string().nullable(),
  scoreBefore: z.number(),
  scoreAfter: z.number(),
  stageBefore: masteryStageSchema,
  stageAfter: masteryStageSchema,
  /** `attempt` rows: the exercise answered (null when the content pack no longer has it). */
  exercise: z.object({ id: z.string(), type: z.string(), difficulty: z.int() }).nullable(),
  observation: z
    .object({ outcome: z.enum(['correct', 'partial', 'incorrect', 'error']), o: z.number() })
    .nullable(),
  weight: z.number().nullable(),
  /** `attempt` rows: `concept`, `type`, `difficulty`, `try`, `hint`, `confidence`, `time`, … */
  factors: z.record(z.string(), factorSchema).nullable(),
  /** `stage_gate` rows: `promoted`, `demoted_effective`, `demoted_again`, `introduced_by_reading`. */
  reason: z.string().nullable(),
});
export type MasteryEvidenceView = z.infer<typeof masteryEvidenceSchema>;

/** `GET /concepts/:id` (FR-DASH-02 개념 상세: 숙련도 근거, 관련 문제, 다음 복습일). */
export const conceptDetailSchema = z.object({
  concept: z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    importance: z.enum(['core', 'standard', 'minor']),
    course: conceptRefSchema,
    mdnUrl: z.string().nullable(),
  }),
  mastery: z.object({
    stage: masteryStageSchema,
    score: z.number(),
    /** Score with forgetting (`score × decay`), computed now. */
    effective: z.number(),
    decay: z.number(),
    retrievability: z.number().nullable(),
    /** `R < 0.8`: "복습 필요". */
    needsReview: z.boolean(),
    evidenceWeightSum: z.number(),
    consecutiveFailures: z.int(),
    lastAttemptAt: z.number().nullable(),
    stageChangedAt: z.number().nullable(),
  }),
  /** The next stage and what is still missing ("숙련까지: …"); null at `mastered`. */
  nextStage: z
    .object({
      stage: masteryStageSchema,
      met: z.boolean(),
      missing: z.array(gateShortfallSchema),
    })
    .nullable(),
  /** FSRS memory; null before the first review. */
  memory: z
    .object({
      dueAt: z.number(),
      /** Learner-local due date. */
      dueDate: localDate,
      dueToday: z.boolean(),
      lastReviewAt: z.number().nullable(),
      state: z.enum(FSRS_CARD_STATES),
      reps: z.int(),
      lapses: z.int(),
      suspended: z.boolean(),
    })
    .nullable(),
  /** Newest first (at most `evidenceLimit`). */
  evidence: z.array(masteryEvidenceSchema),
  evidenceTotal: z.int().min(0),
  /** Recent FSRS reviews, newest first. */
  reviews: z.array(z.object({ reviewedAt: z.number(), rating: z.enum(FSRS_RATINGS) })),
  prerequisites: z.array(
    z.object({
      concept: conceptRefSchema,
      strength: z.enum(['required', 'helpful']),
      stage: masteryStageSchema,
      effective: z.number(),
    }),
  ),
  misconceptions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: misconceptionStatusSchema,
      source: z.enum(MISCONCEPTION_SOURCES),
      firstSeenAt: z.number(),
      lastSeenAt: z.number(),
      confirmCount: z.int(),
      resolution: z.object({ done: z.int(), required: z.int() }),
    }),
  ),
  /** Lessons that introduce, practise or review the concept ("관련 레슨"). */
  lessons: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      role: z.enum(['introduces', 'practices', 'reviews']),
    }),
  ),
});
export type ConceptDetail = z.infer<typeof conceptDetailSchema>;

/** `GET /concepts/:id?evidenceLimit=`. */
export const conceptDetailQuerySchema = z
  .object({ evidenceLimit: z.coerce.number().int().min(1).max(200).optional() })
  .strict();

// ── Learner profile and onboarding ───────────────────────────────────────────

/** `learners.experience_level` (ui-ux.md#온보딩과-목표-설정: 처음이에요 / 조금 해봤어요 / 기초는 알아요). */
export const EXPERIENCE_LEVELS = ['none', 'some', 'basics'] as const;
export const experienceLevelSchema = z.enum(EXPERIENCE_LEVELS);
export type ExperienceLevel = z.infer<typeof experienceLevelSchema>;

/** `GET /learner` and `PATCH /learner` response. */
export const learnerProfileSchema = z.object({
  experienceLevel: experienceLevelSchema,
  /** When onboarding was completed or skipped; null before that. */
  onboardedAt: z.number().nullable(),
  /**
   * Show the onboarding (first run only). False once `onboardedAt` is set, and for learners who
   * already have learning records from before onboarding existed (v0.1 data).
   */
  needsOnboarding: z.boolean(),
});
export type LearnerProfile = z.infer<typeof learnerProfileSchema>;

/** `PATCH /learner`. `onboarded: true` finishes (or skips) the onboarding; it never resets. */
export const learnerPatchSchema = z
  .object({
    experienceLevel: experienceLevelSchema.optional(),
    onboarded: z.literal(true).optional(),
  })
  .strict();
export type LearnerPatch = z.infer<typeof learnerPatchSchema>;

// ── Mastery overview (concept map and course progress) ──────────────────────

/** One concept tile of the concept map (ui-ux.md ConceptTile, FR-DASH-02). */
export const conceptTileSchema = z.object({
  id: z.string(),
  title: z.string(),
  importance: z.enum(['core', 'standard', 'minor']),
  stage: masteryStageSchema,
  /** Effective mastery now (score with forgetting), 0–100. */
  effective: z.number(),
  /**
   * "복습 예정" marker: the FSRS review is due by the end of today, or retrievability fell below
   * 0.8. The stage itself never drops with time (learning-engine.md).
   */
  reviewDue: z.boolean(),
  /** Learner-local date of the next review; null before the first review or when suspended. */
  nextReviewDate: localDate.nullable(),
  /** Active misconceptions; a confirmed one shows the "약점" marker. */
  misconceptions: z.array(
    z.object({ id: z.string(), title: z.string(), status: misconceptionStatusSchema }),
  ),
});
export type ConceptTileView = z.infer<typeof conceptTileSchema>;

const lessonCountSchema = z.object({ total: z.int().min(0), completed: z.int().min(0) });

/** Number of concepts per stage. */
export const stageCountsSchema = z.object({
  not_started: z.int().min(0),
  introduced: z.int().min(0),
  practicing: z.int().min(0),
  proficient: z.int().min(0),
  mastered: z.int().min(0),
});
export type StageCounts = z.infer<typeof stageCountsSchema>;

/**
 * `GET /mastery`: every course with its progress (completed lessons, kept apart from the mastery
 * distribution, ui-ux.md 과정 진도) and its concepts by module (concept map).
 */
export const masteryOverviewSchema = z.object({
  date: localDate,
  courses: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      language: z.enum(['html', 'css', 'javascript']),
      lessons: lessonCountSchema,
      stageCounts: stageCountsSchema,
      modules: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          lessons: lessonCountSchema,
          concepts: z.array(conceptTileSchema),
        }),
      ),
    }),
  ),
});
export type MasteryOverview = z.infer<typeof masteryOverviewSchema>;
