import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { Config } from '../config/schema.ts';
import type { Logger } from '../observability/logger.ts';
import type { BackupService } from '../services/backup/service.ts';
import type { ContentAccess } from '../services/curriculum/content-access.ts';
import type { AiService } from '../services/ai/ai-service.ts';
import type { PracticeServices } from '../services/practice/index.ts';
import type { SettingsService } from '../services/settings/service.ts';
import type { TutorService } from '../services/tutor/tutor-service.ts';
import type { AppEnv } from './env.ts';
import { AppError, errorResponse, handleError } from './errors.ts';
import { aiRoutes } from './routes/ai.ts';
import { backupRoutes } from './routes/backups.ts';
import { curriculumRoutes } from './routes/curriculum.ts';
import { exerciseRoutes } from './routes/exercises.ts';
import { learningRoutes } from './routes/learning.ts';
import { attemptRoutes, practiceSetRoutes } from './routes/practice.ts';
import { settingsRoutes } from './routes/settings.ts';
import { aiHintRoutes, tutorRoutes } from './routes/tutor.ts';
import { runnerRoutes } from './runner.ts';
import { maintenance, MaintenanceState, security } from './security.ts';
import { webRoutes } from './web.ts';

export interface AppDeps {
  config: Pick<Config, 'port' | 'mode'>;
  log: Logger;
  token: string;
  backups: BackupService;
  settings: SettingsService;
  content: ContentAccess;
  practice: PracticeServices;
  /** AI status/login and the tutor. Omitted in tests that do not exercise AI. */
  ai?: { ai: AiService; tutor: TutorService; keepAliveMs?: number };
  /** Built web app to serve (production). Omitted in development, where Vite serves it. */
  webDistDir?: string;
  maintenance?: MaintenanceState;
  version?: string;
}

export type { AppEnv } from './env.ts';

/** Vite dev server origins allowed to call the API in development (it proxies /api). */
const DEV_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];

export function createApp({
  config,
  log,
  token,
  backups,
  settings,
  content,
  practice,
  ai,
  webDistDir,
  maintenance: state = new MaintenanceState(),
  version = '0.0.0',
}: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(async (c, next) => {
    const start = performance.now();
    await next();
    log.debug(
      {
        requestId: c.var.requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - start),
      },
      'request',
    );
  });
  app.use(
    security({
      port: config.port,
      token,
      extraOrigins: config.mode === 'production' ? [] : DEV_ORIGINS,
    }),
  );
  app.use(maintenance(state));

  const api = new Hono<AppEnv>()
    .get('/health', (c) => c.json({ status: 'ok' as const, version }))
    .route('/backups', backupRoutes(backups))
    .route('/settings', settingsRoutes(settings))
    .route('/', curriculumRoutes(content))
    .route('/exercises', exerciseRoutes(practice.exercises, practice.attempts))
    .route('/practice-sets', practiceSetRoutes(practice.sets))
    .route('/attempts', attemptRoutes(practice.attempts))
    .route('/', learningRoutes(practice));
  if (ai) {
    const opts = ai.keepAliveMs ? { keepAliveMs: ai.keepAliveMs } : {};
    api
      .route('/ai', aiRoutes(ai.ai, opts))
      .route('/tutor', tutorRoutes(ai.tutor, opts))
      .route('/exercises', aiHintRoutes(ai.tutor));
  }
  const routes = app.route('/api/v1', api);
  app.route('/sandbox', runnerRoutes());
  if (webDistDir) app.route('/', webRoutes({ distDir: webDistDir, token, port: config.port }));

  app.notFound((c) =>
    errorResponse(c, new AppError('NOT_FOUND', 404, `찾을 수 없습니다: ${c.req.path}`)),
  );
  app.onError((err, c) => handleError(err, c, log));

  return routes;
}

/** Hono RPC type for the web client. */
export type AppType = ReturnType<typeof createApp>;
