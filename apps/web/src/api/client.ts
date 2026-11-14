import { apiErrorSchema, type ErrorCode } from '@proginone/shared';
import type { z } from 'zod';

/** A failed API call with the server's stable error code (docs/design/system-architecture.md#api-규약). */
export class ApiRequestError extends Error {
  readonly code: ErrorCode | 'NETWORK' | 'BAD_RESPONSE';
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ApiRequestError['code'],
    message: string,
    status: number,
    retryable: boolean,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export const TOKEN_HEADER = 'x-proginone-token';

/** Session token the server put into index.html. */
export function readToken(doc: Document = document): string {
  return doc.querySelector<HTMLMetaElement>('meta[name="proginone-token"]')?.content ?? '';
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Response schema. Server output is validated like any other untrusted input. */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

export function createApiClient({
  baseUrl = '/api/v1',
  token = readToken,
  fetchImpl = (...args: Parameters<typeof fetch>) => fetch(...args),
}: { baseUrl?: string; token?: () => string; fetchImpl?: typeof fetch } = {}) {
  return async function request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(baseUrl + path, {
        method: options.method ?? 'GET',
        headers: {
          [TOKEN_HEADER]: token(),
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ApiRequestError(
        'NETWORK',
        '서버에 연결할 수 없어요. 앱이 실행 중인지 확인해 주세요.',
        0,
        true,
      );
    }

    const json: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const parsed = apiErrorSchema.safeParse(json);
      if (parsed.success) {
        const { code, message, retryable, details } = parsed.data.error;
        throw new ApiRequestError(code, message, res.status, retryable, details);
      }
      throw new ApiRequestError(
        'BAD_RESPONSE',
        '서버 응답을 이해하지 못했어요.',
        res.status,
        false,
      );
    }
    const parsed = options.schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiRequestError(
        'BAD_RESPONSE',
        '서버 응답을 이해하지 못했어요.',
        res.status,
        false,
      );
    }
    return parsed.data;
  };
}

export const api = createApiClient();
