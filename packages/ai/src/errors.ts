import type { AIErrorCode } from '@proginone/shared';
import type { AICallRecord } from './record.ts';

export type { AIErrorCode } from '@proginone/shared';

/** Default learner-facing messages (Korean). Callers may pass a more specific one. */
export const AI_ERROR_MESSAGES: Record<AIErrorCode, string> = {
  AI_NOT_CONNECTED: 'AI 튜터가 연결되어 있지 않습니다. 설정에서 ChatGPT로 로그인하세요.',
  AI_UNAUTHORIZED: 'AI 로그인이 만료되었습니다. 다시 로그인하세요.',
  AI_RATE_LIMITED: 'AI 사용량 한도에 도달했습니다. 초기화된 뒤 다시 시도하세요.',
  AI_CONTEXT_TOO_LARGE: '질문에 담긴 내용이 너무 깁니다. 코드나 질문을 줄여 다시 시도하세요.',
  AI_TIMEOUT: 'AI 응답이 너무 오래 걸립니다. 잠시 후 다시 시도하세요.',
  AI_CANCELLED: '답변을 중단했습니다.',
  AI_BAD_OUTPUT: 'AI 응답을 처리하지 못했습니다. 다시 시도하세요.',
  AI_PROVIDER_ERROR: 'AI 튜터와 연결이 끊겼습니다. 다시 시도하세요.',
  AI_OVERLOADED: 'AI 서버가 바쁩니다. 잠시 후 다시 시도하세요.',
  AI_UNAVAILABLE: '이 컴퓨터에서는 지금 AI 튜터를 쓸 수 없습니다.',
  AI_LOCKED_IN_ASSESSMENT: '평가 중에는 AI 튜터를 쓸 수 없습니다.',
};

const RETRYABLE: ReadonlySet<AIErrorCode> = new Set([
  'AI_RATE_LIMITED',
  'AI_TIMEOUT',
  'AI_BAD_OUTPUT',
  'AI_PROVIDER_ERROR',
  'AI_OVERLOADED',
]);

export interface AIErrorOptions {
  message?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
  /** Visible text produced before the failure (cancel, timeout). */
  partialText?: string;
  /** The turn produced a tool item; it was interrupted and its text discarded. */
  toolAttempt?: boolean;
  /** A persistent provider thread could not be resumed; rebuild it from the database. */
  threadLost?: boolean;
}

/** A provider or task failure normalized to the `AI_*` codes of the HTTP API. */
export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;
  readonly toolAttempt: boolean;
  readonly threadLost: boolean;
  partialText: string;
  /** Set by the task runner: the call record to store in `ai_calls`. */
  record: AICallRecord | undefined;

  constructor(code: AIErrorCode, options: AIErrorOptions = {}) {
    super(options.message ?? AI_ERROR_MESSAGES[code], { cause: options.cause });
    this.name = 'AIError';
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
    this.details = options.details;
    this.partialText = options.partialText ?? '';
    this.toolAttempt = options.toolAttempt ?? false;
    this.threadLost = options.threadLost ?? false;
    this.record = undefined;
  }
}

export function isAIError(e: unknown): e is AIError {
  return e instanceof AIError;
}
