import { z } from 'zod';
import { SLUG_MAX } from './slug.ts';

// content/aliases.yaml (docs/design/content-and-exercises.md#slug-변경과-alias, FR-CUR-06).

const SEG = '[a-z0-9]+(?:-[a-z0-9]+)*';
/** Any content slug (course, module, lesson, concept, misconception, exercise). */
export const anyContentId = z
  .string()
  .max(SLUG_MAX)
  .regex(new RegExp(`^${SEG}(?:\\.${SEG}){0,4}$`), { message: 'slug 형식이 아닙니다' });

export const ALIAS_KINDS = ['rename', 'merge', 'split'] as const;
export type AliasKind = (typeof ALIAS_KINDS)[number];

/**
 * One entry of `content/aliases.yaml`: an old, no longer published slug and what replaced it.
 * - `rename`: one new slug.
 * - `merge`: one new slug that several old slugs (one entry each) were merged into.
 * - `split`: two or more new slugs; `primary` inherits progress
 *   (data-model.md#콘텐츠-참조와-고아-처리).
 * `since` is the first pack version with the change (default: the pack version being built).
 */
export const aliasEntrySchema = z
  .strictObject({
    from: anyContentId,
    to: z.union([anyContentId, z.array(anyContentId).min(1)]),
    kind: z.enum(ALIAS_KINDS),
    since: z
      .string()
      .regex(/^\d{4}\.\d{2}\.\d{2}\.\d+$/, { message: 'YYYY.MM.DD.N 형식이어야 합니다' })
      .optional(),
    primary: anyContentId.optional(),
  })
  .superRefine((a, ctx) => {
    const targets = aliasTargets(a);
    if (a.kind === 'split') {
      if (targets.length < 2)
        ctx.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'split은 새 slug가 2개 이상이어야 합니다',
        });
      if (a.primary === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['primary'],
          message: 'split에는 진도를 이어받을 primary가 필요합니다',
        });
      else if (!targets.includes(a.primary))
        ctx.addIssue({
          code: 'custom',
          path: ['primary'],
          message: 'primary는 to 중 하나여야 합니다',
        });
    } else {
      if (targets.length !== 1)
        ctx.addIssue({
          code: 'custom',
          path: ['to'],
          message: `${a.kind}는 새 slug가 하나여야 합니다`,
        });
      if (a.primary !== undefined)
        ctx.addIssue({ code: 'custom', path: ['primary'], message: 'primary는 split에만 씁니다' });
    }
    if (targets.includes(a.from))
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'from과 to가 같습니다' });
    if (new Set(targets).size !== targets.length)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to에 같은 slug가 여러 번 있습니다' });
  });
export type AliasEntry = z.infer<typeof aliasEntrySchema>;
export const aliasesFileSchema = z.array(aliasEntrySchema);

/** The new slugs of an alias entry. */
export function aliasTargets(a: Pick<AliasEntry, 'to'>): string[] {
  return typeof a.to === 'string' ? [a.to] : a.to;
}

/** What an alias (and a published slug) can point at. */
export const CONTENT_ENTITY_KINDS = [
  'course',
  'module',
  'lesson',
  'concept',
  'misconception',
  'exercise',
] as const;
export type ContentEntityKind = (typeof CONTENT_ENTITY_KINDS)[number];
