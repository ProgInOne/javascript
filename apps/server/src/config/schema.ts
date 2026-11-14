import { z } from 'zod';

/** Process-level settings. UI settings (theme, learning mode) live in user.db, not here. */
export const configSchema = z.object({
  port: z.number().int().min(1024).max(65535),
  dataDir: z.string().min(1),
  backupDir: z.string().min(1),
  /** Built content pack (`content-cli build`). */
  contentDbPath: z.string().min(1),
  codexPath: z.string().min(1),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  openBrowser: z.boolean(),
  aiProvider: z.enum(['codex', 'mock']),
  mode: z.enum(['development', 'production', 'test']),
});
export type Config = z.infer<typeof configSchema>;

/** Keys that may appear in `<dataDir>/config.json`. `dataDir` itself and `mode` cannot. */
export const fileConfigSchema = configSchema.omit({ dataDir: true, mode: true }).partial().strict();

export const ENV_KEYS = {
  port: 'PROGINONE_PORT',
  dataDir: 'PROGINONE_DATA_DIR',
  backupDir: 'PROGINONE_BACKUP_DIR',
  contentDbPath: 'PROGINONE_CONTENT_DB',
  codexPath: 'PROGINONE_CODEX_PATH',
  logLevel: 'PROGINONE_LOG_LEVEL',
  openBrowser: 'PROGINONE_OPEN_BROWSER',
  aiProvider: 'PROGINONE_AI_PROVIDER',
} as const;
