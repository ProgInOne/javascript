import { Hono } from 'hono';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import type { Config } from '../config/schema.ts';
import type { Logger } from '../observability/logger.ts';
import { AppError, errorResponse, handleError } from './errors.ts';
import { maintenance, MaintenanceState, security } from './security.ts';

export interface AppDeps {
  config: Pick<Config, 'port' | 'mode'>;
  log: Logger;
  token: string;
  maintenance?: MaintenanceState;
  version?: string;
}

export interface AppEnv {
  Variables: RequestIdVariables;
}

/** Vite dev server origins allowed to call the API in development (it proxies /api). */
const DEV_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];

export function createApp({
  config,
  log,
  token,
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

  const api = new Hono<AppEnv>().get('/health', (c) => c.json({ status: 'ok' as const, version }));
  const routes = app.route('/api/v1', api);

  app.notFound((c) =>
    errorResponse(c, new AppError('NOT_FOUND', 404, `찾을 수 없습니다: ${c.req.path}`)),
  );
  app.onError((err, c) => handleError(err, c, log));

  return routes;
}

/** Hono RPC type for the web client. */
export type AppType = ReturnType<typeof createApp>;
