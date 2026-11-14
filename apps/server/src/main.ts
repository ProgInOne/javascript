import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { ConfigError, loadConfig } from './config/load.ts';
import { UserDb } from './db/user/connection.ts';
import { ensureLearner } from './db/user/learners.ts';
import { MigrationError, migrateUserDb } from './db/user/migrate.ts';
import { createApp } from './http/app.ts';
import { MaintenanceState } from './http/security.ts';
import { acquireInstanceLock } from './lifecycle/instance-lock.ts';
import { createLogger } from './observability/logger.ts';
import { BackupScheduler } from './services/backup/scheduler.ts';
import { BackupService } from './services/backup/service.ts';
import { APP_VERSION } from './version.ts';

// Startup order: docs/design/system-architecture.md#앱-시작-절차.
// content.db (M4) and browser opening (web app shell PR) are added later.

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

const maintenance = new MaintenanceState();
const userDb = new UserDb(join(config.dataDir, 'user.db')).open();
const backups = new BackupService({
  userDb,
  backupDir: config.backupDir,
  appVersion: APP_VERSION,
  log,
  maintenance,
  migrate: (backup) => migrateUserDb(userDb, { backup }),
});

try {
  const applied = await migrateUserDb(userDb, {
    backup: () => backups.create('pre-migration').then((b) => b.path),
  });
  if (applied.length > 0) log.info({ applied }, 'user.db migrated');
} catch (e) {
  log.error(
    { err: e, backup: e instanceof MigrationError ? e.backupPath : null },
    (e as Error).message,
  );
  if (userDb.isOpen) userDb.close();
  release();
  process.exit(1);
}

ensureLearner(userDb);
const scheduler = new BackupScheduler({
  userDb,
  backups,
  log,
  boundary: () => {
    const { timezone, dayStartHour } = ensureLearner(userDb);
    return { timezone, dayStartHour };
  },
});
scheduler.start();

const token = randomBytes(32).toString('base64url');
const app = createApp({ config, log, token, backups, maintenance, version: APP_VERSION });

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
  scheduler.stop();
  server.close(() => {
    userDb.close();
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
