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

/** Why a backup cannot be restored (`GET /backups/:id/check`, `RESTORE_FAILED.details.reason`). */
export const BACKUP_PROBLEMS = ['checksum', 'integrity', 'newer-schema'] as const;
export type BackupProblem = (typeof BACKUP_PROBLEMS)[number];

/** Result of checking a backup before the restore dialog (data-model.md#복원-절차 step 1). */
export const backupCheckSchema = z.object({
  id: backupIdSchema,
  ok: z.boolean(),
  problem: z.enum(BACKUP_PROBLEMS).nullable(),
  /** The backup has an older schema; restoring runs the pending migrations afterwards. */
  migrationNeeded: z.boolean(),
});
export type BackupCheck = z.infer<typeof backupCheckSchema>;

/** Where `backupDir` came from: the default, `<dataDir>/config.json`, or an environment variable. */
export const BACKUP_LOCATION_SOURCES = ['default', 'config', 'env'] as const;

export const backupLocationSchema = z.object({
  path: z.string(),
  defaultPath: z.string(),
  source: z.enum(BACKUP_LOCATION_SOURCES),
  /** False when `PROGINONE_BACKUP_DIR` fixes the folder. */
  editable: z.boolean(),
  /** The folder looks like a cloud-synced folder (backups contain tutor conversations). */
  cloudSynced: z.boolean(),
});
export type BackupLocation = z.infer<typeof backupLocationSchema>;

/** Upper bound for a folder path from the client; real paths are far shorter. */
export const BACKUP_PATH_MAX = 1024;

export const backupLocationRequestSchema = z
  .object({ path: z.string().trim().min(1).max(BACKUP_PATH_MAX) })
  .strict();
export type BackupLocationRequest = z.infer<typeof backupLocationRequestSchema>;

export const backupLocationChangeSchema = z.object({
  location: backupLocationSchema,
  /** The old folder. Its backups stay where they are (data-model.md#백업-위치-변경). */
  previousPath: z.string(),
  /** The `manual` backup written to the new folder to prove it is writable. */
  backup: backupSummarySchema,
});
export type BackupLocationChange = z.infer<typeof backupLocationChangeSchema>;

/**
 * Folder names of common sync clients (iCloud Drive, Dropbox, OneDrive, Google Drive, Box,
 * macOS File Provider). A hint for the privacy notice only, never a security decision.
 */
const CLOUD_SEGMENTS = [
  /[/\\]Library[/\\]Mobile Documents([/\\]|$)/i,
  /[/\\]Library[/\\]CloudStorage([/\\]|$)/i,
  /[/\\]iCloud ?Drive([/\\]|$)/i,
  /[/\\]Dropbox( \([^)]*\))?([/\\]|$)/i,
  /[/\\]OneDrive( - [^/\\]*)?([/\\]|$)/i,
  /[/\\](Google Drive|My Drive|GoogleDrive)([/\\]|$)/i,
  /[/\\]Box( Sync)?([/\\]|$)/i,
];

export const isCloudSyncedPath = (path: string) => CLOUD_SEGMENTS.some((re) => re.test(path));
