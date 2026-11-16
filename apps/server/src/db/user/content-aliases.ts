/**
 * FR-CUR-06: carries learning records over to renamed, merged or split content slugs
 * (data-model.md#콘텐츠-참조와-고아-처리, D-057).
 *
 * content.db's `content_id_aliases` maps old slugs to current ones. On every start (and after a
 * backup restore) the server rewrites the user.db columns that still hold an old slug to the
 * current one, so every later read (attempts, mastery, memory, mistakes, progress, tutor scopes)
 * sees the current slug. The rewrite is idempotent: with no old slugs left it changes nothing.
 *
 * - `rename`/`merge`: old → new. `split`: old → the `is_primary` target (progress follows it).
 * - Rows keyed by the slug (one mastery/memory/progress row per learner and concept or lesson)
 *   move only when the new slug has no row yet (`UPDATE OR IGNORE`). Otherwise the old row stays
 *   as it is: an orphan that is kept, not deleted, and left out of current views. Recomputing a
 *   merged concept's state from its attempts is follow-up work (D-057).
 * - JSON columns that embed slugs (`attempts.misconception_ids_json`, practice set scopes, summary
 *   concept lists) are not rewritten; they are history snapshots.
 */
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export type AliasEntityKind =
  'course' | 'module' | 'lesson' | 'concept' | 'misconception' | 'exercise';

/** A `content_id_aliases` row as the content repository reads it. */
export interface ContentAlias {
  oldId: string;
  newId: string;
  aliasKind: 'rename' | 'merge' | 'split';
  isPrimary: boolean;
  entityKind: string;
}

/** user.db columns that hold content slugs, and the kinds of slug each can hold. */
export const CONTENT_REF_COLUMNS: readonly {
  table: string;
  column: string;
  kinds: readonly AliasEntityKind[] | 'any';
}[] = [
  { table: 'lesson_progress', column: 'lesson_id', kinds: ['lesson'] },
  { table: 'practice_set_items', column: 'exercise_id', kinds: ['exercise'] },
  { table: 'practice_set_items', column: 'target_concept_id', kinds: ['concept'] },
  { table: 'attempts', column: 'exercise_id', kinds: ['exercise'] },
  // An ungrouped exercise's variant group key is its own id (learning-engine exercise.ts).
  { table: 'attempts', column: 'variant_group_key', kinds: ['exercise'] },
  { table: 'hint_events', column: 'exercise_id', kinds: ['exercise'] },
  { table: 'exercise_snapshots', column: 'exercise_id', kinds: ['exercise'] },
  { table: 'exercise_reports', column: 'exercise_id', kinds: ['exercise'] },
  { table: 'concept_mastery', column: 'concept_id', kinds: ['concept'] },
  { table: 'mastery_evidence', column: 'concept_id', kinds: ['concept'] },
  { table: 'concept_memory', column: 'concept_id', kinds: ['concept'] },
  { table: 'review_logs', column: 'concept_id', kinds: ['concept'] },
  { table: 'pending_ratings', column: 'concept_id', kinds: ['concept'] },
  { table: 'session_summary_concepts', column: 'concept_id', kinds: ['concept'] },
  { table: 'misconception_observations', column: 'misconception_id', kinds: ['misconception'] },
  { table: 'misconception_observations', column: 'concept_id', kinds: ['concept'] },
  { table: 'remediation_suggestions', column: 'concept_id', kinds: ['concept'] },
  { table: 'remediation_suggestions', column: 'prerequisite_id', kinds: ['concept'] },
  { table: 'goals', column: 'target_course_id', kinds: ['course'] },
  // Scopes and AI call subjects hold a lesson, concept or exercise slug.
  { table: 'tutor_threads', column: 'scope_id', kinds: 'any' },
  { table: 'session_summaries', column: 'scope_id', kinds: 'any' },
  { table: 'ai_calls', column: 'subject_id', kinds: 'any' },
];

export interface AliasResolution {
  /** Rows rewritten, per `table.column`. */
  updated: Record<string, number>;
  /** Rows that kept an old slug because the new slug already had a row, per `table.column`. */
  kept: Record<string, number>;
}

/** old slug → the slug its records move to (split: the primary target). */
export function aliasTargetMap(aliases: readonly ContentAlias[]): Map<string, ContentAlias> {
  const map = new Map<string, ContentAlias>();
  for (const a of aliases) if (a.isPrimary && !map.has(a.oldId)) map.set(a.oldId, a);
  return map;
}

const existingColumns = (sqlite: Database.Database) => {
  const tables = new Set(
    (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name),
  );
  return CONTENT_REF_COLUMNS.filter((c) => tables.has(c.table));
};

const applies = (kinds: readonly AliasEntityKind[] | 'any', kind: string) =>
  kinds === 'any' || (kinds as readonly string[]).includes(kind);

/** How many rows still hold an old slug (0 = nothing to do). */
export function countAliasedRows(
  sqlite: Database.Database,
  aliases: readonly ContentAlias[],
): number {
  const targets = aliasTargetMap(aliases);
  if (targets.size === 0) return 0;
  let total = 0;
  for (const { table, column, kinds } of existingColumns(sqlite)) {
    const stmt = sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`);
    for (const a of targets.values()) {
      if (!applies(kinds, a.entityKind)) continue;
      total += (stmt.get(a.oldId) as { n: number }).n;
    }
  }
  return total;
}

/** Rewrites old slugs to current ones in one transaction (see the module comment). */
export function resolveAliases(
  sqlite: Database.Database,
  aliases: readonly ContentAlias[],
): AliasResolution {
  const result: AliasResolution = { updated: {}, kept: {} };
  const targets = aliasTargetMap(aliases);
  if (targets.size === 0) return result;
  const columns = existingColumns(sqlite);
  sqlite.transaction(() => {
    for (const { table, column, kinds } of columns) {
      const key = `${table}.${column}`;
      const update = sqlite.prepare(
        `UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`,
      );
      const left = sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`);
      for (const a of targets.values()) {
        if (!applies(kinds, a.entityKind)) continue;
        const changed = update.run(a.newId, a.oldId).changes;
        if (changed > 0) result.updated[key] = (result.updated[key] ?? 0) + changed;
        const n = (left.get(a.oldId) as { n: number }).n;
        if (n > 0) result.kept[key] = (result.kept[key] ?? 0) + n;
      }
    }
  })();
  return result;
}

/** app_meta key holding the fingerprint of the alias set last applied to this user.db. */
export const ALIASES_APPLIED_KEY = 'content_aliases_applied';

/** Order-independent fingerprint of an alias set. */
export function aliasFingerprint(aliases: readonly ContentAlias[]): string {
  const rows = [...aliasTargetMap(aliases).values()]
    .map((a) => `${a.entityKind}:${a.oldId}>${a.newId}`)
    .sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

/**
 * Startup/restore entry point. Skips when this user.db already had this alias set applied (a
 * restored older backup has an older or no fingerprint, so it is resolved again). Backs up
 * user.db first when there is something to rewrite. Returns null when nothing was rewritten.
 */
export async function resolveContentAliases(
  sqlite: () => Database.Database,
  aliases: readonly ContentAlias[],
  backup: () => Promise<string>,
): Promise<(AliasResolution & { backupPath: string }) | null> {
  const fingerprint = aliasFingerprint(aliases);
  const applied = sqlite()
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get(ALIASES_APPLIED_KEY) as { value: string } | undefined;
  if (applied?.value === fingerprint) return null;
  let result: (AliasResolution & { backupPath: string }) | null = null;
  if (countAliasedRows(sqlite(), aliases) > 0) {
    const backupPath = await backup();
    result = { ...resolveAliases(sqlite(), aliases), backupPath };
  }
  sqlite()
    .prepare(
      'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    )
    .run(ALIASES_APPLIED_KEY, fingerprint);
  return result;
}
