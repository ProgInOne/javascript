import {
  ATTEMPT_OUTCOMES,
  CONFIDENCES,
  EVIDENCE_KINDS,
  EXERCISE_ORIGINS,
  FSRS_CARD_STATES,
  FSRS_RATINGS,
  HINT_EVENT_KINDS,
  LESSON_PROGRESS_STATUSES,
  MASTERY_STAGES,
  MISCONCEPTION_SOURCES,
  MISCONCEPTION_STATUSES,
  REMEDIATION_KINDS,
  REMEDIATION_TRIGGERS,
  PENDING_RATING_OUTCOMES,
  PRACTICE_ITEM_STATUSES,
  PRACTICE_SET_KINDS,
  PRACTICE_SET_STATUSES,
  REPORT_REASONS,
  REPORT_STATUSES,
  TUTOR_MESSAGE_ROLES,
  TUTOR_MESSAGE_STATUSES,
  TUTOR_SCOPE_TYPES,
  TUTOR_THREAD_STATUSES,
} from '@proginone/shared';
import { AI_CALL_STATUSES } from '@proginone/ai';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

// user.db schema. Source of truth for columns: docs/design/data-model.md#userdb-설계.
// Times are epoch milliseconds (UTC); calendar dates are local YYYY-MM-DD text.

export const EXPERIENCE_LEVELS = ['none', 'some', 'basics'] as const;

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const learners = sqliteTable(
  'learners',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name'),
    timezone: text('timezone').notNull(),
    dayStartHour: integer('day_start_hour').notNull().default(4),
    experienceLevel: text('experience_level', { enum: EXPERIENCE_LEVELS })
      .notNull()
      .default('none'),
    onboardedAt: integer('onboarded_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    check('learners_day_start_hour', sql`${t.dayStartHour} BETWEEN 0 AND 23`),
    check('learners_experience_level', sql`${t.experienceLevel} IN ('none', 'some', 'basics')`),
  ],
);

export const settings = sqliteTable(
  'settings',
  {
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id),
    key: text('key').notNull(),
    valueJson: text('value_json', { mode: 'json' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.learnerId, t.key] }),
    check('settings_value_json', sql`json_valid(${t.valueJson})`),
  ],
);

// ── Learning records (M4, migration 0001) ────────────────────────────────────
// Columns follow docs/design/data-model.md; enums come from @proginone/shared so the zod schemas,
// Drizzle types and CHECK constraints share one list. `*_json` columns are validated with zod in
// the repositories on write and on read (./json.ts).

/** `CHECK (col IN (...))` for an enum column. Values are code constants, never user input. */
function inList(column: SQLiteColumn, values: readonly string[]) {
  return sql`${column} IN (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;
}
const bool = (column: SQLiteColumn) => sql`${column} IN (0, 1)`;
const jsonValid = (column: SQLiteColumn) => sql`json_valid(${column})`;
const learnerId = () =>
  text('learner_id')
    .notNull()
    .references(() => learners.id);
const at = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const lessonProgress = sqliteTable(
  'lesson_progress',
  {
    learnerId: learnerId(),
    lessonId: text('lesson_id').notNull(),
    status: text('status', { enum: LESSON_PROGRESS_STATUSES }).notNull().default('not_started'),
    lastSectionId: text('last_section_id'),
    readProgress: real('read_progress').notNull().default(0),
    practiceSetId: text('practice_set_id'),
    startedAt: at('started_at'),
    completedAt: at('completed_at'),
    contentHashSeen: text('content_hash_seen'),
    /** Last read/practice activity; orders "이어서 학습" (added to the table sketch). */
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.learnerId, t.lessonId] }),
    index('lesson_progress_learner_status').on(t.learnerId, t.status),
    check('lesson_progress_status', inList(t.status, LESSON_PROGRESS_STATUSES)),
    check('lesson_progress_read_progress', sql`${t.readProgress} BETWEEN 0 AND 1`),
  ],
);

export const practiceSets = sqliteTable(
  'practice_sets',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    kind: text('kind', { enum: PRACTICE_SET_KINDS }).notNull(),
    scopeJson: text('scope_json', { mode: 'json' }).notNull(),
    status: text('status', { enum: PRACTICE_SET_STATUSES }).notNull().default('active'),
    passRuleJson: text('pass_rule_json', { mode: 'json' }),
    resultJson: text('result_json', { mode: 'json' }),
    engineVersion: text('engine_version').notNull(),
    createdAt: at('created_at').notNull(),
    completedAt: at('completed_at'),
  },
  (t) => [
    index('practice_sets_learner_kind_status').on(t.learnerId, t.kind, t.status),
    check('practice_sets_kind', inList(t.kind, PRACTICE_SET_KINDS)),
    check('practice_sets_status', inList(t.status, PRACTICE_SET_STATUSES)),
    check('practice_sets_scope_json', jsonValid(t.scopeJson)),
    check(
      'practice_sets_pass_rule_json',
      sql`${t.passRuleJson} IS NULL OR json_valid(${t.passRuleJson})`,
    ),
    check('practice_sets_result_json', sql`${t.resultJson} IS NULL OR json_valid(${t.resultJson})`),
  ],
);

export const practiceSetItems = sqliteTable(
  'practice_set_items',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    practiceSetId: text('practice_set_id')
      .notNull()
      .references(() => practiceSets.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    exerciseId: text('exercise_id').notNull(),
    exerciseOrigin: text('exercise_origin', { enum: EXERCISE_ORIGINS }).notNull(),
    reason: text('reason').notNull(),
    targetConceptId: text('target_concept_id'),
    status: text('status', { enum: PRACTICE_ITEM_STATUSES }).notNull().default('pending'),
    finalAttemptId: text('final_attempt_id'),
  },
  (t) => [
    uniqueIndex('practice_set_items_set_position').on(t.practiceSetId, t.position),
    index('practice_set_items_exercise').on(t.exerciseId),
    check('practice_set_items_origin', inList(t.exerciseOrigin, EXERCISE_ORIGINS)),
    check('practice_set_items_status', inList(t.status, PRACTICE_ITEM_STATUSES)),
  ],
);

export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    exerciseId: text('exercise_id').notNull(),
    exerciseOrigin: text('exercise_origin', { enum: EXERCISE_ORIGINS }).notNull(),
    variantGroupKey: text('variant_group_key').notNull(),
    exerciseVersionHash: text('exercise_version_hash').notNull(),
    practiceSetItemId: text('practice_set_item_id').references(() => practiceSetItems.id),
    studySessionId: text('study_session_id'),
    attemptNo: integer('attempt_no').notNull(),
    attemptInItem: integer('attempt_in_item').notNull(),
    outcome: text('outcome', { enum: ATTEMPT_OUTCOMES }).notNull(),
    score: real('score').notNull(),
    confidence: text('confidence', { enum: CONFIDENCES }),
    hintLevelMax: integer('hint_level_max').notNull().default(0),
    solutionViewed: integer('solution_viewed', { mode: 'boolean' }).notNull().default(false),
    tutorAssisted: integer('tutor_assisted', { mode: 'boolean' }).notNull().default(false),
    startedAt: at('started_at').notNull(),
    submittedAt: at('submitted_at').notNull(),
    activeMs: integer('active_ms').notNull(),
    misconceptionIdsJson: text('misconception_ids_json', { mode: 'json' }).notNull().default([]),
    gradingJson: text('grading_json', { mode: 'json' }).notNull(),
    isReview: integer('is_review', { mode: 'boolean' }).notNull().default(false),
    engineApplied: integer('engine_applied', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [
    index('attempts_learner_submitted').on(t.learnerId, t.submittedAt),
    index('attempts_learner_exercise_submitted').on(t.learnerId, t.exerciseId, t.submittedAt),
    index('attempts_item').on(t.practiceSetItemId),
    index('attempts_learner_outcome_submitted').on(t.learnerId, t.outcome, t.submittedAt),
    index('attempts_learner_group_submitted').on(t.learnerId, t.variantGroupKey, t.submittedAt),
    check('attempts_origin', inList(t.exerciseOrigin, EXERCISE_ORIGINS)),
    check('attempts_outcome', inList(t.outcome, ATTEMPT_OUTCOMES)),
    check(
      'attempts_confidence',
      sql`${t.confidence} IS NULL OR ${inList(t.confidence, CONFIDENCES)}`,
    ),
    check('attempts_score', sql`${t.score} BETWEEN 0 AND 1`),
    check('attempts_hint_level_max', sql`${t.hintLevelMax} BETWEEN 0 AND 3`),
    check('attempts_solution_viewed', bool(t.solutionViewed)),
    check('attempts_tutor_assisted', bool(t.tutorAssisted)),
    check('attempts_is_review', bool(t.isReview)),
    check('attempts_engine_applied', bool(t.engineApplied)),
    check('attempts_misconception_ids_json', jsonValid(t.misconceptionIdsJson)),
    check('attempts_grading_json', jsonValid(t.gradingJson)),
  ],
);

export const submissions = sqliteTable(
  'submissions',
  {
    attemptId: text('attempt_id')
      .primaryKey()
      .references(() => attempts.id),
    learnerId: learnerId(),
    answerJson: text('answer_json', { mode: 'json' }).notNull(),
    runResultJson: text('run_result_json', { mode: 'json' }),
    answerHash: text('answer_hash').notNull(),
  },
  (t) => [
    check('submissions_answer_json', jsonValid(t.answerJson)),
    check(
      'submissions_run_result_json',
      sql`${t.runResultJson} IS NULL OR json_valid(${t.runResultJson})`,
    ),
  ],
);

export const hintEvents = sqliteTable(
  'hint_events',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    exerciseId: text('exercise_id').notNull(),
    practiceSetItemId: text('practice_set_item_id').references(() => practiceSetItems.id),
    kind: text('kind', { enum: HINT_EVENT_KINDS }).notNull(),
    level: integer('level'),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    index('hint_events_learner_exercise_created').on(t.learnerId, t.exerciseId, t.createdAt),
    check('hint_events_kind', inList(t.kind, HINT_EVENT_KINDS)),
    check(
      'hint_events_level',
      sql`(${t.kind} = 'solution' AND ${t.level} IS NULL) OR (${t.kind} <> 'solution' AND ${t.level} BETWEEN 1 AND 3)`,
    ),
  ],
);

/** Exercise as shown when attempted (no learner_id: content cache keyed by content hash). */
export const exerciseSnapshots = sqliteTable(
  'exercise_snapshots',
  {
    contentHash: text('content_hash').primaryKey(),
    exerciseId: text('exercise_id').notNull(),
    publicSpecJson: text('public_spec_json', { mode: 'json' }).notNull(),
    revision: integer('revision'),
    createdAt: at('created_at').notNull(),
  },
  (t) => [check('exercise_snapshots_public_spec_json', jsonValid(t.publicSpecJson))],
);

export const conceptMastery = sqliteTable(
  'concept_mastery',
  {
    learnerId: learnerId(),
    conceptId: text('concept_id').notNull(),
    score: real('score').notNull().default(0),
    stage: text('stage', { enum: MASTERY_STAGES }).notNull().default('not_started'),
    evidenceWeightSum: real('evidence_weight_sum').notNull().default(0),
    distinctTypesCorrectJson: text('distinct_types_correct_json', { mode: 'json' })
      .notNull()
      .default([]),
    maxDifficultyCorrect: integer('max_difficulty_correct').notNull().default(0),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastAttemptAt: at('last_attempt_at'),
    stageChangedAt: at('stage_changed_at'),
    updatedAt: at('updated_at').notNull(),
    engineVersion: text('engine_version').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.learnerId, t.conceptId] }),
    index('concept_mastery_learner_stage').on(t.learnerId, t.stage),
    index('concept_mastery_learner_score').on(t.learnerId, t.score),
    check('concept_mastery_stage', inList(t.stage, MASTERY_STAGES)),
    check('concept_mastery_score', sql`${t.score} BETWEEN 0 AND 100`),
    check('concept_mastery_distinct_types_json', jsonValid(t.distinctTypesCorrectJson)),
  ],
);

export const masteryEvidence = sqliteTable(
  'mastery_evidence',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    conceptId: text('concept_id').notNull(),
    attemptId: text('attempt_id').references(() => attempts.id),
    kind: text('kind', { enum: EVIDENCE_KINDS }).notNull(),
    scoreBefore: real('score_before').notNull(),
    scoreAfter: real('score_after').notNull(),
    stageBefore: text('stage_before', { enum: MASTERY_STAGES }).notNull(),
    stageAfter: text('stage_after', { enum: MASTERY_STAGES }).notNull(),
    breakdownJson: text('breakdown_json', { mode: 'json' }).notNull(),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    index('mastery_evidence_learner_concept_created').on(t.learnerId, t.conceptId, t.createdAt),
    index('mastery_evidence_attempt').on(t.attemptId),
    check('mastery_evidence_kind', inList(t.kind, EVIDENCE_KINDS)),
    check('mastery_evidence_stage_before', inList(t.stageBefore, MASTERY_STAGES)),
    check('mastery_evidence_stage_after', inList(t.stageAfter, MASTERY_STAGES)),
    check('mastery_evidence_breakdown_json', jsonValid(t.breakdownJson)),
  ],
);

export const conceptMemory = sqliteTable(
  'concept_memory',
  {
    learnerId: learnerId(),
    conceptId: text('concept_id').notNull(),
    cardJson: text('card_json', { mode: 'json' }).notNull(),
    fsrsVersion: text('fsrs_version').notNull(),
    state: text('state', { enum: FSRS_CARD_STATES }).notNull(),
    dueAt: at('due_at').notNull(),
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    lastReviewAt: at('last_review_at'),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    suspended: integer('suspended', { mode: 'boolean' }).notNull().default(false),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.learnerId, t.conceptId] }),
    index('concept_memory_learner_suspended_due').on(t.learnerId, t.suspended, t.dueAt),
    check('concept_memory_state', inList(t.state, FSRS_CARD_STATES)),
    check('concept_memory_suspended', bool(t.suspended)),
    check('concept_memory_card_json', jsonValid(t.cardJson)),
  ],
);

export const reviewLogs = sqliteTable(
  'review_logs',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    conceptId: text('concept_id').notNull(),
    rating: text('rating', { enum: FSRS_RATINGS }).notNull(),
    sourceAttemptIdsJson: text('source_attempt_ids_json', { mode: 'json' }).notNull(),
    reviewedAt: at('reviewed_at').notNull(),
    elapsedDays: real('elapsed_days').notNull(),
    scheduledDays: real('scheduled_days').notNull(),
    stateBefore: text('state_before', { enum: FSRS_CARD_STATES }).notNull(),
    revlogJson: text('revlog_json', { mode: 'json' }).notNull(),
    retrievabilityBefore: real('retrievability_before'),
  },
  (t) => [
    index('review_logs_learner_concept_reviewed').on(t.learnerId, t.conceptId, t.reviewedAt),
    check('review_logs_rating', inList(t.rating, FSRS_RATINGS)),
    check('review_logs_state_before', inList(t.stateBefore, FSRS_CARD_STATES)),
    check('review_logs_source_attempt_ids_json', jsonValid(t.sourceAttemptIdsJson)),
    check('review_logs_revlog_json', jsonValid(t.revlogJson)),
  ],
);

/**
 * FSRS ratings waiting to be merged per concept ("one rating per concept per day",
 * learning-engine.md#평가-적용-단위). One row per primary-concept attempt in a set; `flushed_at`
 * and `flush_outcome` are set when `flushPendingRatings` applies (or skips) it. Rows are kept as
 * an audit trail. Added to the data model in M4 (data-model.md#pending_ratings).
 */
export const pendingRatings = sqliteTable(
  'pending_ratings',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    practiceSetId: text('practice_set_id')
      .notNull()
      .references(() => practiceSets.id, { onDelete: 'cascade' }),
    conceptId: text('concept_id').notNull(),
    rating: text('rating', { enum: FSRS_RATINGS }).notNull(),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attempts.id),
    variantGroupKey: text('variant_group_key').notNull(),
    ratedAt: at('rated_at').notNull(),
    flushedAt: at('flushed_at'),
    flushOutcome: text('flush_outcome', { enum: PENDING_RATING_OUTCOMES }),
  },
  (t) => [
    index('pending_ratings_set_flushed').on(t.practiceSetId, t.flushedAt),
    check('pending_ratings_rating', inList(t.rating, FSRS_RATINGS)),
    check(
      'pending_ratings_flush',
      sql`(${t.flushedAt} IS NULL AND ${t.flushOutcome} IS NULL) OR (${t.flushedAt} IS NOT NULL AND ${inList(t.flushOutcome, PENDING_RATING_OUTCOMES)})`,
    ),
  ],
);

export const exerciseReports = sqliteTable(
  'exercise_reports',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    exerciseId: text('exercise_id').notNull(),
    reason: text('reason', { enum: REPORT_REASONS }).notNull(),
    exerciseOrigin: text('exercise_origin', { enum: EXERCISE_ORIGINS }).notNull(),
    excluded: integer('excluded', { mode: 'boolean' }).notNull().default(true),
    note: text('note'),
    status: text('status', { enum: REPORT_STATUSES }).notNull().default('open'),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    index('exercise_reports_learner_exercise').on(t.learnerId, t.exerciseId),
    check('exercise_reports_reason', inList(t.reason, REPORT_REASONS)),
    check('exercise_reports_origin', inList(t.exerciseOrigin, EXERCISE_ORIGINS)),
    check('exercise_reports_excluded', bool(t.excluded)),
    check('exercise_reports_status', inList(t.status, REPORT_STATUSES)),
  ],
);

export const dailyActivity = sqliteTable(
  'daily_activity',
  {
    learnerId: learnerId(),
    /** Learner-local `YYYY-MM-DD` with the day starting at `day_start_hour`. */
    date: text('date').notNull(),
    activeMs: integer('active_ms').notNull().default(0),
    attemptsCount: integer('attempts_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    reviewsDone: integer('reviews_done').notNull().default(0),
    lessonsCompleted: integer('lessons_completed').notNull().default(0),
    goalMet: integer('goal_met', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.learnerId, t.date] }),
    check('daily_activity_date', sql`${t.date} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
    check('daily_activity_active_ms', sql`${t.activeMs} >= 0`),
    check('daily_activity_goal_met', bool(t.goalMet)),
  ],
);

// ── AI tutor (M4, migration 0002) ────────────────────────────────────────────
// docs/design/data-model.md#tutor_threads-tutor_messages-session_summaries and #ai_calls.
// `session_summaries` comes with `session.summarize` (v0.2).

export const AI_CALL_SUBJECT_TYPES = [
  'tutor_message',
  'attempt',
  'generation_job',
  'tutor_thread',
  'content_draft',
  'hint_event',
] as const;

/** One AI call (prompts and responses are not stored; tutor_messages holds the conversation). */
export const aiCalls = sqliteTable(
  'ai_calls',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    taskName: text('task_name').notNull(),
    taskVersion: integer('task_version').notNull(),
    baseVersion: integer('base_version').notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    effort: text('effort'),
    providerThreadId: text('provider_thread_id'),
    providerTurnId: text('provider_turn_id'),
    subjectType: text('subject_type', { enum: AI_CALL_SUBJECT_TYPES }),
    subjectId: text('subject_id'),
    status: text('status', { enum: AI_CALL_STATUSES }).notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    retries: integer('retries').notNull().default(0),
    latencyFirstTokenMs: integer('latency_first_token_ms'),
    latencyTotalMs: integer('latency_total_ms'),
    inputTokens: integer('input_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    outputTokens: integer('output_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    contextTokensEstimated: integer('context_tokens_estimated'),
    contextManifestJson: text('context_manifest_json', { mode: 'json' }).notNull(),
    toolAttempts: integer('tool_attempts').notNull().default(0),
    validationIssuesJson: text('validation_issues_json', { mode: 'json' }).notNull().default([]),
    promptSnapshotPath: text('prompt_snapshot_path'),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    index('ai_calls_learner_created').on(t.learnerId, t.createdAt),
    index('ai_calls_task_status').on(t.taskName, t.status),
    index('ai_calls_subject').on(t.subjectType, t.subjectId),
    check('ai_calls_status', inList(t.status, AI_CALL_STATUSES)),
    check(
      'ai_calls_subject_type',
      sql`${t.subjectType} IS NULL OR ${inList(t.subjectType, AI_CALL_SUBJECT_TYPES)}`,
    ),
    check('ai_calls_tool_attempts', sql`${t.toolAttempts} >= 0`),
    check('ai_calls_context_manifest_json', jsonValid(t.contextManifestJson)),
    check('ai_calls_validation_issues_json', jsonValid(t.validationIssuesJson)),
  ],
);

/** A tutor conversation per lesson or exercise. The provider thread is only a cache (D-014). */
export const tutorThreads = sqliteTable(
  'tutor_threads',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    scopeType: text('scope_type', { enum: TUTOR_SCOPE_TYPES }).notNull(),
    scopeId: text('scope_id'),
    title: text('title').notNull().default(''),
    provider: text('provider').notNull(),
    providerThreadId: text('provider_thread_id'),
    providerModel: text('provider_model'),
    providerInstructionsVersion: text('provider_instructions_version'),
    status: text('status', { enum: TUTOR_THREAD_STATUSES }).notNull().default('open'),
    /** `session_summaries.id` once summaries exist (v0.2). */
    summaryId: text('summary_id'),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: at('created_at').notNull(),
    lastMessageAt: at('last_message_at').notNull(),
    closedAt: at('closed_at'),
    archivedAt: at('archived_at'),
  },
  (t) => [
    index('tutor_threads_learner_scope_status').on(t.learnerId, t.scopeType, t.scopeId, t.status),
    index('tutor_threads_learner_last_message').on(t.learnerId, t.lastMessageAt),
    check('tutor_threads_scope_type', inList(t.scopeType, TUTOR_SCOPE_TYPES)),
    check('tutor_threads_status', inList(t.status, TUTOR_THREAD_STATUSES)),
    check('tutor_threads_message_count', sql`${t.messageCount} >= 0`),
  ],
);

/** Every question and answer, verbatim (D-014). */
export const tutorMessages = sqliteTable(
  'tutor_messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => tutorThreads.id, { onDelete: 'cascade' }),
    role: text('role', { enum: TUTOR_MESSAGE_ROLES }).notNull(),
    content: text('content').notNull(),
    attachmentsJson: text('attachments_json', { mode: 'json' }).notNull().default([]),
    /** Parsed `<meta>` block of a tutor reply (added to the table sketch; see data-model.md). */
    metaJson: text('meta_json', { mode: 'json' }),
    status: text('status', { enum: TUTOR_MESSAGE_STATUSES }).notNull().default('complete'),
    aiCallId: text('ai_call_id').references(() => aiCalls.id),
    taskName: text('task_name'),
    taskVersion: integer('task_version'),
    baseVersion: integer('base_version'),
    model: text('model'),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    index('tutor_messages_thread_created').on(t.threadId, t.createdAt),
    index('tutor_messages_status').on(t.status),
    check('tutor_messages_role', inList(t.role, TUTOR_MESSAGE_ROLES)),
    check('tutor_messages_status', inList(t.status, TUTOR_MESSAGE_STATUSES)),
    check('tutor_messages_attachments_json', jsonValid(t.attachmentsJson)),
    check('tutor_messages_meta_json', sql`${t.metaJson} IS NULL OR json_valid(${t.metaJson})`),
  ],
);

// ── Learning engine v0.2 (M5, migration 0003) ────────────────────────────────
// docs/design/data-model.md#misconception_observations and #remediation_suggestions.

/**
 * The learner's view of one misconception (learning-engine.md#오개념-상태-전이). One row per
 * misconception and learner in practice: a resolved/dismissed row is reopened in place.
 * `resolution_attempt_ids_json` (added to the table sketch) holds the targeted first-try correct
 * answers since the last evidence — the progress towards `resolved`.
 */
export const misconceptionObservations = sqliteTable(
  'misconception_observations',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    misconceptionId: text('misconception_id').notNull(),
    conceptId: text('concept_id').notNull(),
    status: text('status', { enum: MISCONCEPTION_STATUSES }).notNull().default('suspected'),
    source: text('source', { enum: MISCONCEPTION_SOURCES }).notNull(),
    aiDescription: text('ai_description'),
    evidenceAttemptIdsJson: text('evidence_attempt_ids_json', { mode: 'json' }).notNull(),
    resolutionAttemptIdsJson: text('resolution_attempt_ids_json', { mode: 'json' })
      .notNull()
      .default([]),
    confirmCount: integer('confirm_count').notNull().default(0),
    firstSeenAt: at('first_seen_at').notNull(),
    lastSeenAt: at('last_seen_at').notNull(),
    resolvedAt: at('resolved_at'),
  },
  (t) => [
    uniqueIndex('misconception_observations_active')
      .on(t.learnerId, t.misconceptionId)
      .where(sql`${t.status} IN ('suspected', 'confirmed')`),
    index('misconception_observations_learner_concept_status').on(
      t.learnerId,
      t.conceptId,
      t.status,
    ),
    check('misconception_observations_status', inList(t.status, MISCONCEPTION_STATUSES)),
    check('misconception_observations_source', inList(t.source, MISCONCEPTION_SOURCES)),
    // FR-AI-09: never without evidence attempts.
    check(
      'misconception_observations_evidence',
      sql`json_valid(${t.evidenceAttemptIdsJson}) AND json_array_length(${t.evidenceAttemptIdsJson}) > 0`,
    ),
    check('misconception_observations_resolution', jsonValid(t.resolutionAttemptIdsJson)),
    check(
      'misconception_observations_ai',
      sql`${t.misconceptionId} NOT LIKE 'ai.%' OR (${t.source} = 'ai' AND ${t.aiDescription} IS NOT NULL)`,
    ),
  ],
);

/**
 * Relearning suggestions (learning-engine.md#재학습-규칙), added to the data model in M5. The
 * engine reads recent rows to escalate (no repeated prerequisite checks, next worked example
 * stage); `item_ids_json` lists the items appended to the set for the suggestion.
 */
export const remediationSuggestions = sqliteTable(
  'remediation_suggestions',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    conceptId: text('concept_id').notNull(),
    practiceSetId: text('practice_set_id').references(() => practiceSets.id, {
      onDelete: 'cascade',
    }),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attempts.id),
    trigger: text('trigger', { enum: REMEDIATION_TRIGGERS }).notNull(),
    kind: text('kind', { enum: REMEDIATION_KINDS }).notNull(),
    prerequisiteId: text('prerequisite_id'),
    workedExampleStage: integer('worked_example_stage'),
    /** The engine's `RemediationSuggestion` (explanation for the UI). */
    detailJson: text('detail_json', { mode: 'json' }).notNull(),
    itemIdsJson: text('item_ids_json', { mode: 'json' }).notNull().default([]),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    index('remediation_suggestions_learner_concept_created').on(
      t.learnerId,
      t.conceptId,
      t.createdAt,
    ),
    index('remediation_suggestions_set').on(t.practiceSetId),
    check('remediation_suggestions_trigger', inList(t.trigger, REMEDIATION_TRIGGERS)),
    check('remediation_suggestions_kind', inList(t.kind, REMEDIATION_KINDS)),
    check('remediation_suggestions_detail_json', jsonValid(t.detailJson)),
    check('remediation_suggestions_item_ids_json', jsonValid(t.itemIdsJson)),
  ],
);

// ── Goals (M5, migration 0004) ───────────────────────────────────────────────
// docs/design/data-model.md#goals-daily_activity.

/**
 * Learning goals with history: changing the goal closes the current row (`effective_to`) and
 * adds a new one, so past weeks are judged against the goal of their time (FR-GOAL-01).
 */
export const goals = sqliteTable(
  'goals',
  {
    id: text('id').primaryKey(),
    learnerId: learnerId(),
    dailyMinutes: integer('daily_minutes').notNull().default(30),
    weeklyDays: integer('weekly_days').notNull().default(5),
    targetCourseId: text('target_course_id'),
    targetDate: text('target_date'),
    effectiveFrom: at('effective_from').notNull(),
    effectiveTo: at('effective_to'),
  },
  (t) => [
    uniqueIndex('goals_current')
      .on(t.learnerId)
      .where(sql`${t.effectiveTo} IS NULL`),
    index('goals_learner_from').on(t.learnerId, t.effectiveFrom),
    check('goals_daily_minutes', sql`${t.dailyMinutes} BETWEEN 5 AND 480`),
    check('goals_weekly_days', sql`${t.weeklyDays} BETWEEN 1 AND 7`),
    check(
      'goals_target_date',
      sql`${t.targetDate} IS NULL OR ${t.targetDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);
