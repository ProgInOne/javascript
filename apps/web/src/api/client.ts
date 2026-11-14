import { apiErrorSchema, type ErrorCode } from '@proginone/shared';
import type { z } from 'zod';
import { readSse, type SseEvent } from './sse.ts';

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

interface ClientConfig {
  baseUrl?: string;
  token?: () => string;
  fetchImpl?: typeof fetch;
}

const NETWORK_MESSAGE = '서버에 연결할 수 없어요. 앱이 실행 중인지 확인해 주세요.';
const BAD_RESPONSE_MESSAGE = '서버 응답을 이해하지 못했어요.';

/** Sends one request with the session token; network failures become `NETWORK` errors. */
async function send(
  {
    baseUrl = '/api/v1',
    token = readToken,
    fetchImpl = (...args: Parameters<typeof fetch>) => fetch(...args),
  }: ClientConfig,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal | undefined; accept?: string },
): Promise<Response> {
  try {
    return await fetchImpl(baseUrl + path, {
      method: options.method ?? 'GET',
      headers: {
        [TOKEN_HEADER]: token(),
        ...(options.accept ? { accept: options.accept } : {}),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiRequestError('NETWORK', NETWORK_MESSAGE, 0, true);
  }
}

/** The server's error body as an `ApiRequestError`. */
async function errorOf(res: Response): Promise<ApiRequestError> {
  const json: unknown = await res.json().catch(() => undefined);
  const parsed = apiErrorSchema.safeParse(json);
  if (parsed.success) {
    const { code, message, retryable, details } = parsed.data.error;
    return new ApiRequestError(code, message, res.status, retryable, details);
  }
  return new ApiRequestError('BAD_RESPONSE', BAD_RESPONSE_MESSAGE, res.status, false);
}

export function createApiClient(config: ClientConfig = {}) {
  return async function request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const res = await send(config, path, options);
    if (!res.ok) throw await errorOf(res);
    const json: unknown = await res.json().catch(() => undefined);
    const parsed = options.schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiRequestError('BAD_RESPONSE', BAD_RESPONSE_MESSAGE, res.status, false);
    }
    return parsed.data;
  };
}

export const api = createApiClient();

export interface StreamOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** Every complete event, in order. Payloads are untrusted: validate them per event name. */
  onEvent: (event: SseEvent) => void;
}

/**
 * Server-Sent Events over `fetch` (docs/design/ai-system.md#구현-메모-v01 "SSE와 오류").
 * `EventSource` cannot send the session token header, so the body is read as a stream instead.
 * Resolves when the server ends the stream. A non-2xx answer (checks that fail before streaming
 * starts) throws its API error; a broken connection throws `NETWORK`; aborting throws AbortError.
 */
export function createStreamClient(config: ClientConfig = {}) {
  return async function stream(path: string, options: StreamOptions): Promise<void> {
    const res = await send(config, path, { ...options, accept: 'text/event-stream' });
    if (!res.ok) throw await errorOf(res);
    if (!res.body) {
      throw new ApiRequestError('BAD_RESPONSE', BAD_RESPONSE_MESSAGE, res.status, false);
    }
    try {
      for await (const event of readSse(res.body)) options.onEvent(event);
    } catch (e) {
      if ((e as Error).name === 'AbortError' || options.signal?.aborted) throw e;
      throw new ApiRequestError('NETWORK', NETWORK_MESSAGE, 0, true);
    }
  };
}

export const stream = createStreamClient();

/**
 * Validates one SSE payload against the schema registered for its event name. Unknown events,
 * invalid JSON and payloads that fail their schema return null (AI-adjacent output is untrusted).
 */
export function parseStreamEvent<S extends Record<string, z.ZodType>>(
  schemas: S,
  event: SseEvent,
): { [K in keyof S & string]: { name: K; data: z.infer<S[K]> } }[keyof S & string] | null {
  const schema: z.ZodType | undefined = Object.hasOwn(schemas, event.event)
    ? schemas[event.event]
    : undefined;
  if (!schema) return null;
  let json: unknown;
  try {
    json = JSON.parse(event.data);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? ({ name: event.event, data: parsed.data } as {
        [K in keyof S & string]: { name: K; data: z.infer<S[K]> };
      }[keyof S & string])
    : null;
}
