import { z } from 'zod';
import {
  ATTEMPT_OUTCOMES,
  attemptRequestSchema,
  attemptResponseSchema,
  LESSON_PROGRESS_STATUSES,
} from './practice.ts';

// Project units (`kind: project`, content-and-exercises.md#프로젝트-단원-kind-project): one
// milestone `web_task` worked on outside practice sets. Every grading run is recorded; the run
// that first passes every milestone completes the unit and is the project's mastery evidence.

export const projectMilestoneViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  checkCount: z.int().min(0),
  /** Result of the latest graded run; `null` before the first one. */
  passed: z.boolean().nullable(),
  /**
   * Not passed while an earlier milestone also failed, and it has `event` checks: those run in
   * order on the same page after the earlier steps, so the failure may only reflect the earlier
   * step ("not reached" rather than failed).
   */
  blocked: z.boolean(),
});
export type ProjectMilestoneView = z.infer<typeof projectMilestoneViewSchema>;

const savedFileSchema = z.object({ path: z.string(), content: z.string() });

/** `GET /lessons/:id/project`: the project's progress and where to resume. */
export const projectViewSchema = z.object({
  lessonId: z.string(),
  exerciseId: z.string(),
  /** `lesson_progress.status` of the unit (`completed` once every milestone passed). */
  status: z.enum(LESSON_PROGRESS_STATUSES),
  completedAt: z.number().nullable(),
  milestones: z.array(projectMilestoneViewSchema),
  /** Milestones passed by the latest graded run. */
  passedCount: z.int().min(0),
  /** Graded runs so far (sandbox failures not included). */
  runCount: z.int().min(0),
  lastRun: z
    .object({
      attemptId: z.string(),
      at: z.number(),
      outcome: z.enum(ATTEMPT_OUTCOMES),
      score: z.number(),
    })
    .nullable(),
  /**
   * Files of the latest submission, to resume from (`null` before the first). The browser draft,
   * when newer, takes precedence on the client.
   */
  savedAnswer: z.object({ files: z.array(savedFileSchema) }).nullable(),
  savedAt: z.number().nullable(),
});
export type ProjectView = z.infer<typeof projectViewSchema>;

/** `POST /lessons/:id/project/attempts`: a grading run of the project (no practice set). */
export const projectAttemptRequestSchema = attemptRequestSchema
  .omit({ practiceSetItemId: true, confidence: true })
  .strict();
export type ProjectAttemptRequest = z.infer<typeof projectAttemptRequestSchema>;

export const projectAttemptResponseSchema = z.object({
  attempt: z.object({
    id: z.string(),
    outcome: z.enum(ATTEMPT_OUTCOMES),
    score: z.number(),
    /** Every milestone (and required check) passed. */
    correct: z.boolean(),
    /** False for sandbox failures (`crashed`/`aborted`): recorded, nothing judged. */
    graded: z.boolean(),
    /** This run updated mastery: the first run that completed the project. */
    counted: z.boolean(),
    attemptNo: z.int(),
  }),
  /** `explanation` is empty until the project is complete. */
  grade: attemptResponseSchema.shape.grade,
  masteryChanges: attemptResponseSchema.shape.masteryChanges,
  misconceptionChanges: attemptResponseSchema.shape.misconceptionChanges,
  /** Milestones this run passed that the previous graded run had not. */
  newlyPassed: z.array(z.string()),
  /** This run completed the unit. */
  completedNow: z.boolean(),
  project: projectViewSchema,
});
export type ProjectAttemptResponse = z.infer<typeof projectAttemptResponseSchema>;
