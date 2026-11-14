import { z } from 'zod';
import { importance } from './catalog.ts';
import { conceptId, courseId, lessonId, moduleId, segment } from './slug.ts';

const localSlug = z.string().regex(segment, { message: '소문자·숫자·하이픈만 쓸 수 있습니다' });

/** courses/<course>/course.yaml */
export const courseSchema = z.strictObject({
  id: courseId,
  title: z.string().min(1),
  summary: z.string().min(1),
  /** Default runner/editor language. */
  language: z.enum(['html', 'css', 'javascript']),
  level: z.enum(['intro', 'basic', 'advanced']),
  /** D-003: JavaScript is `full`, HTML/CSS `core`. */
  depth: z.enum(['full', 'core']).default('full'),
  status: z.enum(['published', 'preview', 'hidden']).default('published'),
  recommendedAfter: z.array(courseId).default([]),
  objectives: z.array(z.string().min(1)).min(1),
  /** Module slugs without the course prefix, in order. */
  modules: z.array(localSlug).min(1),
});
export type CourseSource = z.infer<typeof courseSchema>;

/** courses/<course>/modules/<nn-module>/module.yaml */
export const moduleSchema = z.strictObject({
  id: moduleId,
  title: z.string().min(1),
  summary: z.string().min(1),
  /** Lesson slugs without the module prefix, in order. */
  lessons: z.array(localSlug).min(1),
  assessment: localSlug.optional(),
});
export type ModuleSource = z.infer<typeof moduleSchema>;

/** Overrides of the engine's default pass rule (docs/design/learning-engine.md). */
export const passRuleSchema = z.strictObject({
  minCorrect: z.number().min(0).max(1).optional(),
  minDistinctTypes: z.number().int().min(1).optional(),
  minLevel3Correct: z.number().int().min(0).optional(),
});

/** .../lessons/<nn-lesson>/lesson.yaml */
export const lessonSchema = z.strictObject({
  id: lessonId,
  title: z.string().min(1),
  summary: z.string().min(1),
  kind: z.enum(['lesson', 'assessment', 'project']).default('lesson'),
  importance: importance.default('standard'),
  estimatedMinutes: z.strictObject({
    read: z.number().int().min(0),
    practice: z.number().int().min(0),
  }),
  concepts: z.strictObject({
    primary: z.array(conceptId).default([]),
    practiced: z.array(conceptId).default([]),
    reviewed: z.array(conceptId).default([]),
  }),
  objectives: z.array(z.string().min(1)).min(1),
  practice: z
    .strictObject({
      targetCount: z.number().int().min(1),
      passRule: passRuleSchema.optional(),
    })
    .optional(),
});
export type LessonSource = z.infer<typeof lessonSchema>;
