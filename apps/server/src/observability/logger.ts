import { pino, type Logger } from 'pino';
import type { Config } from '../config/schema.ts';

export type { Logger };

/** Structured JSON logs; pretty output in development. File rotation arrives with the logs/ dir work. */
export function createLogger(config: Pick<Config, 'logLevel' | 'mode'>): Logger {
  return pino({
    level: config.mode === 'test' ? 'silent' : config.logLevel,
    base: { app: 'proginone' },
    redact: { paths: ['req.headers["x-proginone-token"]', 'token'], censor: '[redacted]' },
    ...(config.mode === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } } }
      : {}),
  });
}
