import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import { fileConfigSchema } from './schema.ts';

type FileConfig = z.infer<typeof fileConfigSchema>;

/**
 * Sets (or with `undefined` removes) one key of `<dataDir>/config.json`, keeping the others.
 * Validated with the same schema as startup and written atomically (temp file + rename), so a
 * crash never leaves a config the next start cannot read.
 */
export function writeConfigValue<K extends keyof FileConfig>(
  dataDir: string,
  key: K,
  value: FileConfig[K] | undefined,
): void {
  const path = join(dataDir, 'config.json');
  const current: Record<string, unknown> = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
    : {};
  const rest = Object.fromEntries(Object.entries(current).filter(([k]) => k !== key));
  const next = fileConfigSchema.parse(value === undefined ? rest : { ...rest, [key]: value });
  const tmp = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}
