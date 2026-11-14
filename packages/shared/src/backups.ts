import { z } from 'zod';

export const BACKUP_KINDS = [
  'daily',
  'weekly',
  'pre-migration',
  'pre-restore',
  'pre-reset',
  'manual',
] as const;
export const backupKindSchema = z.enum(BACKUP_KINDS);
export type BackupKind = z.infer<typeof backupKindSchema>;

/** `<kind>:<stem>`; the stem is the file name without the `_user.db` suffix. */
export const backupIdSchema = z
  .string()
  .regex(/^(daily|weekly|pre-migration|pre-restore|pre-reset|manual):[0-9A-Za-z._-]{1,80}$/);

/** Sidecar `*_user.meta.json` (docs/design/data-model.md#백업-방법). */
export const backupMetaSchema = z.object({
  format: z.literal('proginone-backup'),
  formatVersion: z.literal(1),
  kind: backupKindSchema,
  createdAt: z.iso.datetime(),
  appVersion: z.string(),
  schemaMigration: z.string().nullable(),
  contentPackVersion: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  integrityCheck: z.literal('ok'),
});
export type BackupMeta = z.infer<typeof backupMetaSchema>;

export const backupSummarySchema = backupMetaSchema
  .pick({ kind: true, createdAt: true, appVersion: true, schemaMigration: true, sizeBytes: true })
  .extend({ id: backupIdSchema });
export type BackupSummary = z.infer<typeof backupSummarySchema>;

export const backupListSchema = z.object({ backups: z.array(backupSummarySchema) });
