import { runResultSchema } from '@proginone/shared';
import { z } from 'zod';

/**
 * zod schemas of the user.db `*_json` columns (docs/design/data-model.md#json-컬럼-원칙).
 * Repositories parse with these before every write and `safeParse` after every read; a row that
 * fails on read is logged as corrupt and only the feature that needs it fails.
 *
 * These are storage formats owned by the server, so they live here rather than in
 * `packages/shared` (which holds the HTTP contract). Objects carry `v` for later upgrades.
 */

const jsonRecord = z.record(z.string(), z.unknown());
const id = z.string().min(1).max(200);

export const stringListJson = z.array(z.string().max(200)).max(1_000);

/** `practice_sets.scope_json`. */
export const practiceScopeJson = z.object({
  v: z.literal(1),
  lessonId: id.nullable(),
  conceptIds: z.array(id).max(500),
  /** Engine rationale (sizes, quotas, shortages); shown as "why these exercises". */
  rationale: jsonRecord.optional(),
  /** Assessment sets: the pass ratio when the set was built (content may change later). */
  passRatio: z.number().min(0).max(1).optional(),
});
export type PracticeScopeJson = z.infer<typeof practiceScopeJson>;

/** `practice_sets.pass_rule_json`: the engine's `PassRule` plus `v`. */
export const passRuleJson = z.object({
  v: z.literal(1),
  minCorrect: z.number().min(0).max(1),
  /** Sets built before D-081 (engine < 1.3.0); ignored. */
  minConceptScore: z.number().min(0).max(100).optional(),
  /** Per-concept credit within the set (D-081); older sets use the engine default. */
  minConceptCredit: z.number().min(0).max(1).optional(),
  minDistinctTypes: z.int().min(0),
  minLevel3Correct: z.int().min(0),
});
export type PassRuleJson = z.infer<typeof passRuleJson>;

const passCheck = z.object({ met: z.boolean(), required: z.number(), actual: z.number() });

/** The engine's `PassResult`. */
export const passResultJson = z.object({
  passed: z.boolean(),
  checks: z.object({
    allAnswered: z.boolean(),
    minCorrect: passCheck,
    /** Results before D-081: the long-term mastery score of each introduced concept. */
    minConceptScore: passCheck.extend({ below: z.array(id) }).optional(),
    /** Engine 1.3.0+ (D-081): each introduced concept's credited correctness in the set. */
    minConceptCredit: passCheck
      .extend({
        below: z.array(id),
        concepts: z.array(
          z.object({
            conceptId: id,
            credit: z.number(),
            correct: z.int().min(0),
            total: z.int().min(0),
            met: z.boolean(),
          }),
        ),
      })
      .optional(),
    minDistinctTypes: passCheck,
    minLevel3Correct: passCheck,
  }),
});

/** `practice_sets.result_json` written when a set completes. */
export const practiceResultJson = z.object({
  v: z.literal(1),
  total: z.int().min(0),
  answered: z.int().min(0),
  skipped: z.int().min(0),
  correct: z.int().min(0),
  /** Lesson sets only. */
  pass: passResultJson.nullable(),
  /** Concepts whose pending ratings were applied to FSRS when the set ended. */
  reviewedConceptIds: z.array(id),
  /** Assessment sets only: the engine's `evaluateAssessment` result. */
  assessment: z
    .object({
      correct: z.int().min(0),
      total: z.int().min(0),
      ratio: z.number().min(0).max(1),
      passRatio: z.number().min(0).max(1),
      passed: z.boolean(),
      concepts: z.array(
        z.object({ conceptId: id, total: z.int().min(0), correct: z.int().min(0) }),
      ),
      missedConceptIds: z.array(id),
    })
    .optional(),
});
export type PracticeResultJson = z.infer<typeof practiceResultJson>;

const feedbackItem = z.object({
  level: z.enum(['success', 'error', 'warning', 'info']),
  code: z.string(),
  message: z.string(),
  target: z.string().optional(),
  requirement: z.string().optional(),
});

/** One exercise-kit `CheckResult` (visible checks carry an expected/actual summary). */
export const checkResultJson = z.object({
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
  misconceptionId: z.string().optional(),
});

/** `attempts.grading_json`: exercise-kit `GradeResult` minus the columns stored separately. */
export const gradingJson = z.object({
  v: z.literal(1),
  graderVersion: z.string(),
  correct: z.boolean(),
  engineApplicable: z.boolean(),
  /** Sandbox status for run-based types. */
  runStatus: z.string().nullable(),
  feedback: z.array(feedbackItem),
  checkResults: z.array(checkResultJson).optional(),
  failedRequirements: z.array(z.string()).optional(),
  milestones: z
    .array(z.object({ id: z.string(), title: z.string(), passed: z.boolean() }))
    .optional(),
});
export type GradingJson = z.infer<typeof gradingJson>;

/** `submissions.answer_json`: the answer as validated by exercise-kit `parseAnswer`. */
export const answerJson = jsonRecord;

/** Console entries kept per run (data-model.md#attempts-submissions-hint_events). */
export const RUN_CONSOLE_KEEP = 200;
/** Upper bound of a stored run result; larger results drop observations and console. */
export const RUN_RESULT_MAX_BYTES = 64 * 1024;

/** `submissions.run_result_json`: a trimmed `RunResult` plus whether it was cut. */
export const runResultJson = z.object({
  v: z.literal(1),
  truncated: z.boolean(),
  result: runResultSchema,
});
export type RunResultJson = z.infer<typeof runResultJson>;

/** The engine's `EvidenceFact` (fed back as `ConceptState.history`). */
export const evidenceFactJson = z.object({
  attemptId: id,
  at: z.number(),
  exerciseId: id,
  exerciseType: z.string(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  variantGroupKey: z.string(),
  isPrimary: z.boolean(),
  correct: z.boolean(),
  credit: z.number(),
  unassisted: z.boolean(),
  setKind: z
    .enum([
      'lesson',
      'review',
      'weakness',
      'assessment',
      'remedial',
      'extra',
      'custom',
      'diagnostic',
    ])
    .nullable(),
  weight: z.number(),
});

/**
 * `mastery_evidence.breakdown_json`: the engine's `AttemptBreakdown` or `StageGateBreakdown`.
 * Only the envelope and `fact` are checked strictly; the rest is explanation data for the UI.
 */
export const breakdownJson = z
  .object({
    v: z.literal(1),
    engineVersion: z.string(),
    fact: evidenceFactJson.optional(),
  })
  .loose();

/**
 * `remediation_suggestions.detail_json`: the engine's `RemediationSuggestion`. The envelope is
 * checked; the rest is explanation data for the UI.
 */
export const remediationDetailJson = z
  .object({
    conceptId: id,
    trigger: z.string(),
    kind: z.string(),
  })
  .loose();

/** `concept_memory.card_json` (ts-fsrs card, dates as epoch ms). `fsrs.fromRaw` checks the rest. */
export const cardJson = jsonRecord;
/** `review_logs.revlog_json`. */
export const revlogJson = jsonRecord;
/** `exercise_snapshots.public_spec_json`. */
export const publicSpecJson = jsonRecord;
