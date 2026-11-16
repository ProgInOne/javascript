import { codeDraftFilesSchema, type CodeDraftFile, type CodeDraftKind } from '@proginone/shared';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Orm } from './connection.ts';
import { forWrite, fromRow } from './json-io.ts';
import { codeDrafts } from './schema.ts';

// code_drafts (data-model.md#code_drafts): one row per exercise or lesson example, overwritten.

const filesJsonSchema = z.object({ v: z.literal(1), files: codeDraftFilesSchema });

export interface CodeDraftRow {
  kind: CodeDraftKind;
  refId: string;
  files: CodeDraftFile[];
  practiceSetItemId: string | null;
  updatedAt: number;
}

function toRow(r: typeof codeDrafts.$inferSelect): CodeDraftRow {
  const { files } = fromRow(filesJsonSchema, r.filesJson, 'code_drafts', `${r.kind}:${r.refId}`);
  return {
    kind: r.kind,
    refId: r.refId,
    files,
    practiceSetItemId: r.practiceSetItemId,
    updatedAt: r.updatedAt.getTime(),
  };
}

export function getCodeDraft(
  orm: Orm,
  learnerId: string,
  kind: CodeDraftKind,
  refId: string,
): CodeDraftRow | null {
  const row = orm
    .select()
    .from(codeDrafts)
    .where(
      and(
        eq(codeDrafts.learnerId, learnerId),
        eq(codeDrafts.kind, kind),
        eq(codeDrafts.refId, refId),
      ),
    )
    .get();
  return row ? toRow(row) : null;
}

/**
 * Saves a draft unless the stored one is newer (`updated_at` is the browser edit time, so a late
 * request or another tab's older edit does not overwrite a newer one). Returns whether it was
 * written.
 */
export function saveCodeDraft(orm: Orm, learnerId: string, draft: CodeDraftRow): boolean {
  const filesJson = forWrite(
    filesJsonSchema,
    { v: 1, files: draft.files },
    'code_drafts.files_json',
  );
  const res = orm
    .insert(codeDrafts)
    .values({
      learnerId,
      kind: draft.kind,
      refId: draft.refId,
      filesJson,
      practiceSetItemId: draft.practiceSetItemId,
      updatedAt: new Date(draft.updatedAt),
    })
    .onConflictDoUpdate({
      target: [codeDrafts.learnerId, codeDrafts.kind, codeDrafts.refId],
      set: {
        filesJson: sql`excluded.files_json`,
        practiceSetItemId: sql`excluded.practice_set_item_id`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`excluded.updated_at >= ${codeDrafts.updatedAt}`,
    })
    .run();
  return res.changes > 0;
}

export function deleteCodeDraft(
  orm: Orm,
  learnerId: string,
  kind: CodeDraftKind,
  refId: string,
): void {
  orm
    .delete(codeDrafts)
    .where(
      and(
        eq(codeDrafts.learnerId, learnerId),
        eq(codeDrafts.kind, kind),
        eq(codeDrafts.refId, refId),
      ),
    )
    .run();
}

/** Drafts whose `ref_id` starts with `prefix` (a lesson's examples: `<lessonId>#`). */
export function listCodeDraftsByPrefix(
  orm: Orm,
  learnerId: string,
  kind: CodeDraftKind,
  prefix: string,
): CodeDraftRow[] {
  // Range scan on the primary key: every string starting with the prefix sorts in
  // [prefix, prefix + U+FFFF).
  return orm
    .select()
    .from(codeDrafts)
    .where(
      and(
        eq(codeDrafts.learnerId, learnerId),
        eq(codeDrafts.kind, kind),
        gte(codeDrafts.refId, prefix),
        lt(codeDrafts.refId, `${prefix}￿`),
      ),
    )
    .all()
    .map(toRow);
}
