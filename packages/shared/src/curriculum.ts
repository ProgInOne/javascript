import { z } from 'zod';

// Curriculum API responses (GET /courses, /courses/:id, /lessons/:id).

export const IMPORTANCES = ['core', 'standard', 'minor'] as const;
export const importanceSchema = z.enum(IMPORTANCES);

export const courseSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  language: z.enum(['html', 'css', 'javascript']),
  level: z.enum(['intro', 'basic', 'advanced']),
  estimatedMinutes: z.number().int(),
  lessonCount: z.number().int(),
});
export type CourseSummary = z.infer<typeof courseSummarySchema>;

export const courseListSchema = z.object({
  packVersion: z.string(),
  tracks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      courses: z.array(courseSummarySchema),
    }),
  ),
});
export type CourseList = z.infer<typeof courseListSchema>;

export const lessonSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  kind: z.enum(['lesson', 'assessment', 'project']),
  importance: importanceSchema,
  estimatedMinutes: z.number().int(),
  exerciseCount: z.number().int(),
});
export type LessonSummary = z.infer<typeof lessonSummarySchema>;

export const courseDetailSchema = courseSummarySchema.extend({
  objectives: z.array(z.string()),
  modules: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      lessons: z.array(lessonSummarySchema),
    }),
  ),
});
export type CourseDetail = z.infer<typeof courseDetailSchema>;

export const lessonConceptSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  importance: importanceSchema,
  role: z.enum(['introduces', 'practices', 'reviews', 'linked']),
});
export type LessonConcept = z.infer<typeof lessonConceptSchema>;

const lessonRefSchema = z.object({ id: z.string(), title: z.string() }).nullable();

export const lessonDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  kind: z.enum(['lesson', 'assessment', 'project']),
  importance: importanceSchema,
  course: z.object({
    id: z.string(),
    title: z.string(),
    language: z.enum(['html', 'css', 'javascript']),
  }),
  module: z.object({ id: z.string(), title: z.string() }),
  objectives: z.array(z.string()),
  estimatedMinutes: z.number().int(),
  readMinutes: z.number().int(),
  sections: z.array(z.object({ id: z.string(), kind: z.string(), title: z.string().nullable() })),
  /** Validated MDX tree; rendered by the web app's lesson renderer. Untrusted shape: renderer re-checks. */
  body: z.array(z.unknown()),
  /** Concepts of this lesson plus any linked from the body (titles for ConceptLink). */
  concepts: z.array(lessonConceptSchema),
  previous: lessonRefSchema,
  next: lessonRefSchema,
  contentHash: z.string(),
  /**
   * `kind: assessment` only: what the start screen announces (learning-engine.md#단원-평가-세트).
   * `itemCount` is the number of items a new attempt asks.
   */
  assessment: z
    .object({
      itemCount: z.number().int().min(0),
      passRatio: z.number().min(0).max(1),
      conceptCount: z.number().int().min(0),
      estimatedMinutes: z.number().int().min(0),
    })
    .nullable()
    .optional(),
});
export type LessonDetail = z.infer<typeof lessonDetailSchema>;
