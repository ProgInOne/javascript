import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { AppError, errorResponse } from './errors.ts';

export const TOKEN_HEADER = 'x-proginone-token';

/** Runner shells are served from `<shellId>.localhost:<port>` (D-018). */
const SHELL_HOST = /^[a-z0-9]{1,32}\.localhost$/;
const RUNNER_PREFIX = '/sandbox/';

export interface SecurityOptions {
  port: number;
  token: string;
  /** Extra allowed origins, e.g. the Vite dev server in development. */
  extraOrigins?: readonly string[];
}

function splitHost(host: string | undefined): { name: string; port: string } | null {
  if (!host) return null;
  const [, name, port] = /^([^:]+):(\d+)$/.exec(host.toLowerCase()) ?? [];
  return name && port ? { name, port } : null;
}

const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * DNS-rebinding / CSRF guard for the local server (docs/design/system-architecture.md#보안-경계-요약).
 * - Host must be 127.0.0.1 or localhost on our port; shell subdomains may only reach /sandbox/*.
 * - /api requests must not come from a foreign or opaque (`null`) Origin.
 * - /api requests (GET included) must carry the per-process session token.
 */
export function security({ port, token, extraOrigins = [] }: SecurityOptions): MiddlewareHandler {
  const allowedOrigins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    ...extraOrigins,
  ]);
  return async (c, next) => {
    const host = splitHost(c.req.header('host'));
    const path = c.req.path;
    const isApi = path.startsWith('/api/') || path === '/api';

    if (host?.port !== String(port)) {
      return errorResponse(c, new AppError('FORBIDDEN_HOST', 403, '허용되지 않은 호스트입니다.'));
    }
    if (SHELL_HOST.test(host.name)) {
      if (!path.startsWith(RUNNER_PREFIX)) {
        return errorResponse(c, new AppError('FORBIDDEN_HOST', 403, '허용되지 않은 호스트입니다.'));
      }
    } else if (host.name !== '127.0.0.1' && host.name !== 'localhost') {
      return errorResponse(c, new AppError('FORBIDDEN_HOST', 403, '허용되지 않은 호스트입니다.'));
    }

    if (isApi) {
      const origin = c.req.header('origin');
      if (origin !== undefined && !allowedOrigins.has(origin)) {
        return errorResponse(c, new AppError('FORBIDDEN_ORIGIN', 403, '허용되지 않은 출처입니다.'));
      }
      const given = c.req.header(TOKEN_HEADER);
      if (!given || !sameToken(given, token)) {
        return errorResponse(
          c,
          new AppError('UNAUTHORIZED', 401, '세션이 만료되었습니다. 페이지를 새로고침하세요.'),
        );
      }
    }
    return next();
  };
}

/** Shared flag flipped by restore/recompute jobs. While on, /api answers 503 MAINTENANCE. */
export class MaintenanceState {
  #reason: string | null = null;

  get active(): boolean {
    return this.#reason !== null;
  }

  get reason(): string | null {
    return this.#reason;
  }

  enter(reason: string): void {
    this.#reason = reason;
  }

  exit(): void {
    this.#reason = null;
  }
}

export function maintenance(state: MaintenanceState): MiddlewareHandler {
  return async (c, next) => {
    if (state.active && c.req.path.startsWith('/api/')) {
      return errorResponse(
        c,
        new AppError('MAINTENANCE', 503, '데이터를 정리하는 중입니다. 잠시 후 다시 시도하세요.', {
          retryable: true,
          details: { reason: state.reason },
        }),
      );
    }
    return next();
  };
}
