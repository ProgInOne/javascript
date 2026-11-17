export * from './types.ts';
export * from './config.ts';
export { resolveVariantGroupKey } from './exercise.ts';
export type { DayBoundary } from './util/time.ts';
export { localDateOf, startOfLocalDay, endOfLocalDay, addDays, daysBetween } from './util/time.ts';

export type { Evidence, Factor, FactorKey } from './mastery/evidence.ts';
export { computeEvidence, isUnassisted, observationOf } from './mastery/evidence.ts';
export { updateScore } from './mastery/update.ts';
export type { EffectiveMastery } from './mastery/effective.ts';
export { effectiveMastery } from './mastery/effective.ts';
export type { ConceptReport } from './mastery/report.ts';
export { conceptReport } from './mastery/report.ts';
export type {
  GateCode,
  GateInput,
  GateReport,
  GateResult,
  GateShortfall,
  StageChangeReason,
} from './mastery/stage.ts';
export { decideStage, evaluateGates } from './mastery/stage.ts';
export type {
  ApplyAttemptInput,
  AttemptBreakdown,
  AttemptEffects,
  MasteryEvidenceRecord,
  MasteryUpdate,
  StageGateBreakdown,
} from './mastery/apply.ts';
export {
  applyAttempt,
  applyLessonRead,
  initialConceptState,
  initialMasteryState,
  reevaluateStage,
} from './mastery/apply.ts';

export type { PendingRating } from './memory/rating.ts';
export { aggregateRatings, ratingForAttempt } from './memory/rating.ts';
export type { FlushInput, FlushResult, ReviewLogRecord, SkippedRating } from './memory/flush.ts';
export { conceptsReadyToFlush, flushPendingRatings } from './memory/flush.ts';
export { createTsFsrsPort } from './memory/fsrs-adapter.ts';
export type { ReviewQueue, ReviewQueueConcept, ReviewQueueEntry } from './memory/review-queue.ts';
export { buildReviewQueue } from './memory/review-queue.ts';

export type { BandName, PassRule, PracticeBand } from './config.ts';
export type {
  ExerciseCandidate,
  PlannedItem,
  PracticeItemReason,
  SelectFactors,
  SelectionContext,
} from './practice/candidates.ts';
export { freshnessOf, REMEDIAL_REASONS, scoreCandidate } from './practice/candidates.ts';
export type {
  AdaptiveAction,
  AdaptiveRequest,
  ItemOutcome,
  SetItemSnapshot,
} from './practice/adaptive.ts';
export { nextAdaptiveStep } from './practice/adaptive.ts';
export type {
  WeakConceptEntry,
  WeakConceptInput,
  WeaknessSet,
  WeaknessSetRequest,
} from './practice/weakness-set.ts';
export {
  buildWeaknessSet,
  rankWeakConcepts,
  selectWeaknessTargets,
} from './practice/weakness-set.ts';
export type {
  InsufficientCandidates,
  LessonSet,
  LessonSetConcept,
  LessonSetRequest,
  SetRationale,
} from './practice/lesson-set.ts';
export { buildLessonPracticeSet } from './practice/lesson-set.ts';
export type {
  ConceptCredit,
  ConceptCreditCheck,
  PassCheck,
  PassResult,
  PassRuleItem,
} from './practice/pass-rule.ts';
export { evaluatePassRule, lessonPassRule, conceptCredits } from './practice/pass-rule.ts';
export type {
  AssessmentResult,
  AssessmentResultItem,
  AssessmentSet,
  AssessmentSetConcept,
  AssessmentSetRationale,
  AssessmentSetRequest,
} from './practice/assessment-set.ts';
export { buildAssessmentSet, evaluateAssessment } from './practice/assessment-set.ts';
export type { ReviewSet, ReviewSetConcept, ReviewSetRequest } from './practice/review-set.ts';
export { buildReviewSet } from './practice/review-set.ts';
export type { Rng } from './util/rng.ts';
export { createRng } from './util/rng.ts';

export type {
  MisconceptionAttempt,
  MisconceptionEvidence,
  MisconceptionSource,
  MisconceptionState,
  MisconceptionStatus,
  MisconceptionTransition,
  MisconceptionUpdate,
  ResolutionStep,
} from './misconception/transitions.ts';
export {
  AI_MISCONCEPTION_PREFIX,
  isActiveMisconception,
  isAiMisconception,
  MISCONCEPTION_SOURCES,
  MISCONCEPTION_STATUSES,
  misconceptionStatusAt,
  proposeMisconception,
  resolutionTarget,
  updateMisconceptions,
} from './misconception/transitions.ts';
export type {
  ConceptGraph,
  ConceptPrerequisite,
  PrerequisiteCheck,
  RemediationContext,
  RemediationHistoryEntry,
  RemediationKind,
  RemediationSuggestion,
  RemediationTrigger,
  SetItemOutcome,
  WorkedExample,
} from './remediation/detect.ts';
export {
  assessPrerequisite,
  detectRemediation,
  inspectPrerequisites,
  remediationTrigger,
} from './remediation/detect.ts';

export type { ActiveTimeDelta, Heartbeat } from './time/active-time.ts';
export { accumulateActiveTime, splitByLocalDay } from './time/active-time.ts';
export type {
  Goal,
  LessonEstimate,
  LessonStatus,
  LessonTiming,
  PaceResult,
  PaceStatus,
} from './planning/pace.ts';
export { computePace, paceCalibration, remainingLessonMinutes } from './planning/pace.ts';
export type {
  DailyBlockKind,
  DailyBlockReason,
  DailyPlan,
  DailyPlanBlock,
  DailyPlanInput,
} from './planning/daily-plan.ts';
export { buildDailyPlan, dailyReviewMinutes, reviewShareFor } from './planning/daily-plan.ts';
export type { DayActivity, GoalOnDate, WeekDay, WeekSummary } from './planning/week.ts';
export { summarizeWeek, weekStartOf, weeklyStreak } from './planning/week.ts';
