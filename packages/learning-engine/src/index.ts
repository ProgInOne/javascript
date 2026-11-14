export * from './types.ts';
export * from './config.ts';
export { resolveVariantGroupKey } from './exercise.ts';
export type { DayBoundary } from './util/time.ts';
export { localDateOf, startOfLocalDay, endOfLocalDay, addDays, daysBetween } from './util/time.ts';

export type { Evidence, Factor, FactorKey } from './mastery/evidence.ts';
export { computeEvidence, observationOf } from './mastery/evidence.ts';
export { updateScore } from './mastery/update.ts';
export type { EffectiveMastery } from './mastery/effective.ts';
export { effectiveMastery } from './mastery/effective.ts';
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
