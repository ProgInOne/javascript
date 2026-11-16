import { z } from 'zod';
import {
  conceptRefSchema,
  exerciseStatsSchema,
  PRACTICE_SET_KINDS,
  PRACTICE_SET_STATUSES,
} from './practice.ts';

// Read models derived from the learning records: the dashboard's "최근 활동" (FR-DASH-01) and the
// concept detail's "관련 문제" (FR-DASH-02, FR-EX-10). Nothing here is stored separately (D-061).

const lessonRefSchema = z.object({ id: z.string(), title: z.string() });

/**
 * One practice set the learner answered at least one item of. Results of an assessment still in
 * progress are withheld: `correct`, `stageUps` and `assessment` are null until it ends.
 */
export const recentPracticeActivitySchema = z.object({
  type: z.literal('practice'),
  /** The practice set ID. */
  id: z.string(),
  /** Last activity: the set's completion, else its latest attempt (epoch ms). */
  at: z.number().int(),
  /** Learner-local date of `at` (`YYYY-MM-DD`, with the learner's day start). */
  date: z.string(),
  setKind: z.enum(PRACTICE_SET_KINDS),
  status: z.enum(PRACTICE_SET_STATUSES),
  /** The lesson of lesson, assessment and extra sets (null for review and weakness sets). */
  lesson: lessonRefSchema.nullable(),
  /** Target concepts of review and weakness sets (first three) and how many there are. */
  concepts: z.array(conceptRefSchema).max(3),
  conceptCount: z.int().min(0),
  total: z.int().min(0),
  answered: z.int().min(0),
  /** Items whose last attempt was correct; null while an assessment is in progress. */
  correct: z.int().min(0).nullable(),
  /** Concepts whose stage went up from this set's attempts; null while withheld. */
  stageUps: z.int().min(0).nullable(),
  /** The set completed its lesson (a passed lesson set). */
  lessonCompleted: z.boolean(),
  /** Finished assessments only. */
  assessment: z.object({ passed: z.boolean(), ratio: z.number().min(0).max(1) }).nullable(),
});

/** A lesson completed without a practice set row to show it on (project units). */
export const recentLessonActivitySchema = z.object({
  type: z.literal('lesson'),
  /** The lesson ID. */
  id: z.string(),
  at: z.number().int(),
  date: z.string(),
  lesson: lessonRefSchema,
});

export const recentActivitySchema = z.discriminatedUnion('type', [
  recentPracticeActivitySchema,
  recentLessonActivitySchema,
]);
export type RecentActivity = z.infer<typeof recentActivitySchema>;

export const recentActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

/** `GET /activity/recent`: newest first, with the learner-local today for relative dates. */
export const recentActivityListSchema = z.object({
  date: z.string(),
  items: z.array(recentActivitySchema),
});
export type RecentActivityList = z.infer<typeof recentActivityListSchema>;

/** One exercise of a concept with the learner's statistics. */
export const relatedExerciseSchema = z.object({
  id: z.string(),
  type: z.string(),
  difficulty: z.int().min(1).max(5),
  /** The exercise prompt (Markdown); the list shows its first line. */
  prompt: z.string(),
  lesson: lessonRefSchema.nullable(),
  stats: exerciseStatsSchema,
});
export type RelatedExercise = z.infer<typeof relatedExerciseSchema>;

/**
 * `GET /concepts/:id/exercises` (FR-DASH-02 관련 문제, FR-EX-10): the practice exercises whose
 * primary concept is this one, easiest first, each with its statistics. Assessment, diagnostic
 * and project exercises are never listed, nor are exercises of an assessment in progress.
 */
export const relatedExercisesSchema = z.object({
  conceptId: z.string(),
  exercises: z.array(relatedExerciseSchema),
});
export type RelatedExercises = z.infer<typeof relatedExercisesSchema>;
