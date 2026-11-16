import { codeDraftFilesSchema, type CodeDraftFile } from '@proginone/shared';
import { z } from 'zod';

// Browser copies of code drafts (localStorage), saved on every edit (NFR-04). See drafts.ts.

export type DraftTarget =
  | { readonly kind: 'exercise'; readonly exerciseId: string }
  | { readonly kind: 'example'; readonly lessonId: string; readonly exampleId: string };

export interface DraftSnapshot {
  readonly files: CodeDraftFile[];
  /** Edit time in this browser (epoch ms). */
  readonly updatedAt: number;
  readonly practiceSetItemId: string | null;
}

const PREFIX = 'proginone:draft:';

const localKey = (t: DraftTarget) =>
  PREFIX +
  (t.kind === 'exercise' ? `exercise:${t.exerciseId}` : `example:${t.lessonId}#${t.exampleId}`);

const localSchema = z.object({
  v: z.literal(2),
  files: codeDraftFilesSchema,
  updatedAt: z.number(),
  practiceSetItemId: z.string().nullable(),
});

/** Browser draft of a target. Storage can be unavailable (private mode) or hold junk: null. */
export function loadLocalDraft(target: DraftTarget): DraftSnapshot | null {
  try {
    const raw = localStorage.getItem(localKey(target));
    if (raw === null) return null;
    const parsed = localSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const { files, updatedAt, practiceSetItemId } = parsed.data;
    return { files, updatedAt, practiceSetItemId };
  } catch {
    return null;
  }
}

export function saveLocalDraft(target: DraftTarget, draft: DraftSnapshot): boolean {
  try {
    localStorage.setItem(localKey(target), JSON.stringify({ v: 2, ...draft }));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalDraft(target: DraftTarget): void {
  try {
    localStorage.removeItem(localKey(target));
  } catch {
    // ignore
  }
}

/**
 * Removes every browser draft (after a learning data reset or a backup restore: the server's
 * drafts changed, and browser drafts are newer, so they would otherwise win).
 */
export function clearAllLocalDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * A v0.3 browser draft (a raw `{ files }` answer under `set:item` or `project:<lessonId>`),
 * read once so an update does not lose work in progress. It counts as the oldest draft.
 */
export function loadLegacyDraft(
  key: string,
  practiceSetItemId: string | null,
): DraftSnapshot | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return null;
    const parsed = z.object({ files: codeDraftFilesSchema }).safeParse(JSON.parse(raw));
    return parsed.success ? { files: parsed.data.files, updatedAt: 0, practiceSetItemId } : null;
  } catch {
    return null;
  }
}

export function clearLegacyDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
