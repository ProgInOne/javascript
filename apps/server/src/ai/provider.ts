import { CodexAdapter, MockProvider, type ProviderAdapter } from '@proginone/ai';
import type { Config } from '../config/schema.ts';
import type { Logger } from '../observability/logger.ts';

/**
 * The AI provider for this process (config `aiProvider`, D-002). `mock` gives deterministic
 * replies for E2E and development; `codex` runs the isolated Codex App Server, started lazily.
 */
export function createProvider(
  config: Pick<Config, 'aiProvider' | 'codexPath' | 'dataDir'>,
  log: Logger,
  appVersion: string,
): ProviderAdapter {
  if (config.aiProvider === 'mock') return new MockProvider({ deltaDelayMs: 15 });
  return new CodexAdapter({
    codexPath: config.codexPath,
    dataDir: config.dataDir,
    clientVersion: appVersion,
    log: (level, event, fields) => {
      log[level]({ ...fields }, event);
    },
  });
}
