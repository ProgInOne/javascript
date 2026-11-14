import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { ConfigError, loadConfig } from './config/load.ts';
import { createApp } from './http/app.ts';
import { MaintenanceState } from './http/security.ts';
import { acquireInstanceLock } from './lifecycle/instance-lock.ts';
import { createLogger } from './observability/logger.ts';

// Startup order: docs/design/system-architecture.md#앱-시작-절차.
// DB migration, backups, content.db and browser opening are added by later M3 PRs.

let config;
try {
  config = loadConfig({ repoRoot: new URL('../../..', import.meta.url).pathname });
} catch (e) {
  if (e instanceof ConfigError) {
    process.stderr.write(`${e.message}\n${e.issues.map((i) => `  - ${i}`).join('\n')}\n`);
    process.exit(1);
  }
  throw e;
}

const log = createLogger(config);
mkdirSync(config.dataDir, { recursive: true });

const url = `http://127.0.0.1:${config.port}`;
const lock = acquireInstanceLock(config.dataDir, { url });
if (!lock.acquired) {
  log.info({ url: lock.running.url, pid: lock.running.pid }, 'ProgInOne이 이미 실행 중입니다.');
  process.exit(0);
}
const { release } = lock;

const token = randomBytes(32).toString('base64url');
const maintenance = new MaintenanceState();
const app = createApp({ config, log, token, maintenance });

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, () => {
  log.info({ url, dataDir: config.dataDir, mode: config.mode }, 'ProgInOne 서버가 시작되었습니다.');
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log.error(
      { port: config.port },
      `포트 ${config.port}을(를) 이미 다른 프로그램이 쓰고 있습니다. PROGINONE_PORT로 다른 포트를 지정하세요.`,
    );
  } else {
    log.error({ err }, '서버를 시작하지 못했습니다.');
  }
  release();
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, '종료합니다.');
  server.close(() => {
    release();
    process.exit(0);
  });
  setTimeout(() => {
    release();
    process.exit(0);
  }, 5000).unref();
}
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
