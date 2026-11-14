import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import envPaths from 'env-paths';
import type { z } from 'zod';
import { configSchema, ENV_KEYS, fileConfigSchema, type Config } from './schema.ts';

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.issues = issues;
    this.name = 'ConfigError';
  }
}

interface LoadOptions {
  env?: NodeJS.ProcessEnv;
  /** Repository root, used for the development data directory (`<repo>/.data`). */
  repoRoot?: string;
}

const formatIssues = (error: z.ZodError, source: string) =>
  error.issues.map((i) => `${source}: ${i.path.join('.') || '(root)'} — ${i.message}`);

function parseEnv(env: NodeJS.ProcessEnv): Partial<Record<keyof typeof ENV_KEYS, unknown>> {
  const out: Partial<Record<keyof typeof ENV_KEYS, unknown>> = {};
  for (const [key, name] of Object.entries(ENV_KEYS) as [keyof typeof ENV_KEYS, string][]) {
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    if (key === 'port') out[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
    else if (key === 'openBrowser')
      out[key] = raw === 'true' ? true : raw === 'false' ? false : raw;
    else out[key] = raw;
  }
  return out;
}

/**
 * Loads configuration with precedence: environment variables > `<dataDir>/config.json` > defaults.
 * Throws {@link ConfigError} listing every invalid value; the caller prints it and exits.
 */
export function loadConfig({
  env = process.env,
  repoRoot = process.cwd(),
}: LoadOptions = {}): Config {
  const mode: Config['mode'] =
    env['NODE_ENV'] === 'production'
      ? 'production'
      : env['NODE_ENV'] === 'test'
        ? 'test'
        : 'development';
  const fromEnv = parseEnv(env);

  const dataDir = resolve(
    typeof fromEnv.dataDir === 'string'
      ? fromEnv.dataDir
      : mode === 'production'
        ? envPaths('ProgInOne', { suffix: '' }).data
        : join(repoRoot, '.data'),
  );

  let fromFile: z.infer<typeof fileConfigSchema> = {};
  const configPath = join(dataDir, 'config.json');
  if (existsSync(configPath)) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (e) {
      throw new ConfigError('설정 파일을 읽을 수 없습니다.', [
        `${configPath}: ${(e as Error).message}`,
      ]);
    }
    const parsed = fileConfigSchema.safeParse(json);
    if (!parsed.success) {
      throw new ConfigError(
        '설정 파일에 잘못된 값이 있습니다.',
        formatIssues(parsed.error, configPath),
      );
    }
    fromFile = parsed.data;
  }

  const defaults = {
    port: 4310,
    backupDir: join(dataDir, 'backups'),
    codexPath: 'codex',
    logLevel: 'info',
    openBrowser: mode === 'production',
    aiProvider: 'codex',
  };
  const merged = { ...defaults, ...fromFile, ...fromEnv, dataDir, mode };
  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ConfigError(
      '설정 값이 올바르지 않습니다.',
      formatIssues(parsed.error, '환경 변수 또는 설정'),
    );
  }
  return { ...parsed.data, backupDir: resolve(parsed.data.backupDir) };
}
