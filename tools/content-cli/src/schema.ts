import { conceptSchema, courseSchema } from '@proginone/content-schema';
import { z } from 'zod';

/**
 * This repository's language kit on top of the common content schemas (D-092). The common
 * schemas leave language-specific values open; here they are narrowed or added. Always extend the
 * common schema; never redefine it.
 */

/** Course languages this repository serves. */
export const COURSE_LANGUAGES = ['html', 'css', 'javascript'] as const;
export type CourseLanguage = (typeof COURSE_LANGUAGES)[number];

/** courses/<course>/course.yaml */
export const jsCourseSchema = courseSchema.extend({ language: z.enum(COURSE_LANGUAGES) });
export type JsCourseSource = z.infer<typeof jsCourseSchema>;

/** One entry of content/concepts/<lang>.yaml, with the MDN reference path. */
export const jsConceptSchema = conceptSchema.extend({
  /** MDN path, e.g. `Web/JavaScript/Reference/Statements/return`; built into `concepts.doc_url`. */
  mdn: z
    .string()
    .regex(/^Web\/[\w./-]+$/)
    .optional(),
});
export type JsConceptSource = z.infer<typeof jsConceptSchema>;
export const jsConceptsFileSchema = z.array(jsConceptSchema);

/** The reference document URL stored in content.db `concepts.doc_url`. */
export const docUrlOf = (concept: JsConceptSource): string | null =>
  concept.mdn ? `https://developer.mozilla.org/ko/docs/${concept.mdn}` : null;
