import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { TaskRunner } from '@proginone/ai';
import { createProvider } from './ai/provider.ts';
import { ConfigError, loadConfig } from './config/load.ts';
import { UserDb } from './db/user/connection.ts';
import { ensureLearner } from './db/user/learners.ts';
import { appMeta } from './db/user/schema.ts';
import { markInterruptedMessages } from './db/user/tutor.ts';
import { MigrationError, migrateUserDb } from './db/user/migrate.ts';
import { createApp } from './http/app.ts';
import { MaintenanceState } from './http/security.ts';
import { writeDevSession } from './lifecycle/dev-session.ts';
import { acquireInstanceLock } from './lifecycle/instance-lock.ts';
import { openBrowser } from './lifecycle/open-browser.ts';
import { createLogger } from './observability/logger.ts';
import { BackupScheduler } from './services/backup/scheduler.ts';
import { BackupService } from './services/backup/service.ts';
import { AiService } from './services/ai/ai-service.ts';
import { systemClock } from './services/clock.ts';
import { offsetFileClock } from './services/test-clock.ts';
import { ContentAccess } from './services/curriculum/content-access.ts';
import { createEngine } from './services/practice/engine.ts';
import { createPracticeServices } from './services/practice/index.ts';
import { SettingsService } from './services/settings/service.ts';
import { EvaluatorService } from './services/tutor/evaluator-service.ts';
import { MemoryService } from './services/tutor/memory-service.ts';
import { TutorService } from './services/tutor/tutor-service.ts';
import { APP_VERSION } from './version.ts';

// Startup order: docs/design/system-architecture.md#앱-시작-절차.

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
const open = (target: string) => {
  openBrowser(target, (err) => {
    log.warn({ err }, `브라우저를 열지 못했습니다. ${target} 을(를) 직접 여세요.`);
  });
};
if (!lock.acquired) {
  log.info({ url: lock.running.url, pid: lock.running.pid }, 'ProgInOne이 이미 실행 중입니다.');
  if (config.openBrowser) open(lock.running.url);
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

let content: ContentAccess;
try {
  content = ContentAccess.open(config.contentDbPath);
} catch (e) {
  log.error({ err: e, path: config.contentDbPath }, (e as Error).message);
  userDb.close();
  release();
  process.exit(1);
}
if (content.available) {
  const packVersion = content.repo.packVersion;
  userDb.orm
    .insert(appMeta)
    .values({ key: 'last_content_pack_version', value: packVersion })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: packVersion } })
    .run();
  log.info({ packVersion }, 'content.db loaded');
} else {
  log.warn(
    { path: config.contentDbPath },
    '학습 콘텐츠(content.db)가 없습니다. `pnpm content:build`를 실행하세요.',
  );
}
// Replies left `streaming` by an abnormal exit (docs/design/system-architecture.md#앱-시작-절차).
const interrupted = markInterruptedMessages(userDb.orm);
if (interrupted > 0) log.info({ interrupted }, 'tutor messages marked interrupted');

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

const engine = await createEngine();
// E2E only (e2e/playwright.config.ts): learning services read a shifted clock so tests can reach
// "tomorrow". Never set in normal runs.
const testClockFile = process.env['PROGINONE_TEST_CLOCK_FILE'];
const learningClock = testClockFile ? offsetFileClock(testClockFile) : systemClock;
if (testClockFile) log.warn({ testClockFile }, '테스트용 시계를 사용합니다 (E2E 전용).');
// Codex starts lazily on the first AI request (docs/design/ai-system.md#프로세스-수명주기).
const provider = createProvider(config, log, APP_VERSION);
const ai = new AiService({ provider, log });
// One runner, so every AI task shares the turn limit (interactive before background).
const runner = new TaskRunner({ provider, now: systemClock });
let tutorRef: TutorService | null = null;
const evaluator = new EvaluatorService({ userDb, content, runner, ai, now: systemClock, log });
const memory = new MemoryService({
  userDb,
  content,
  runner,
  ai,
  now: systemClock,
  log,
  interactiveBusy: () => (tutorRef?.activeCount ?? 0) > 0,
  proposals: evaluator,
});
const tutor = new TutorService({ userDb, content, runner, ai, now: systemClock, log, memory });
tutorRef = tutor;
// Rolling summaries of idle tutor threads (docs/design/ai-system.md#sessionsummarize).
memory.start();
const token = randomBytes(32).toString('base64url');
const webDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));
const app = createApp({
  config,
  log,
  token,
  backups,
  settings: new SettingsService({ userDb, log }),
  content,
  practice: createPracticeServices({ userDb, content, engine, now: learningClock }),
  ai: { ai, tutor, memory, evaluator },
  maintenance,
  version: APP_VERSION,
  ...(config.mode === 'production' ? { webDistDir } : {}),
});
if (config.mode === 'production' && !existsSync(join(webDistDir, 'index.html'))) {
  log.warn('웹 앱 빌드가 없습니다. `pnpm build`를 먼저 실행하세요.');
}
const removeDevSession =
  config.mode === 'development'
    ? writeDevSession(config.dataDir, { token, port: config.port })
    : () => undefined;

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, () => {
  log.info({ url, dataDir: config.dataDir, mode: config.mode }, 'ProgInOne 서버가 시작되었습니다.');
  if (config.openBrowser) open(url);
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
  removeDevSession();
  release();
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, '종료합니다.');
  scheduler.stop();
  memory.stop();
  // Stop running AI turns and the Codex child process (turn/interrupt → stdin close → signals).
  tutor.cancelAll();
  const providerClosed = provider.dispose().catch((err: unknown) => {
    log.warn({ err }, 'AI provider did not close cleanly');
  });
  server.close(() => {
    void providerClosed.finally(() => {
      userDb.close();
      content.close();
      removeDevSession();
      release();
      process.exit(0);
    });
  });
  setTimeout(() => {
    removeDevSession();
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
