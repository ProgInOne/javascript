/**
 * Runner transport protocol (host ↔ shell ↔ harness) and limits. The sandbox contract shared
 * with the grader (`RunPlan`, `ObservationStep`, `Observation`, `RunResult`, `SerializedValue`)
 * is in `@proginone/shared`. No DOM or Node dependencies.
 */
export * from './limits.ts';
export * from './messages.ts';
