import type { AICallStatus, AIErrorCode, AIProviderId } from '@proginone/shared';

// One AI call as stored in `ai_calls` (docs/design/data-model.md#ai_calls). The runner builds it;
// the server writes it in the same transaction as the result (tutor message, hint event).

export { AI_CALL_STATUSES, type AICallStatus } from '@proginone/shared';

export interface ContextManifestEntry {
  kind: string;
  /** Content or row ID the section was built from, when there is one. */
  ref: string | null;
  estimatedTokens: number;
  truncated: boolean;
  included: boolean;
}

export interface ValidationIssue {
  /** `schema`, `syntax` or a semantic rule such as `answer_leak`, `code_lines`, `level`. */
  rule: string;
  message: string;
}

export interface AICallRecord {
  taskName: string;
  taskVersion: number;
  baseVersion: number;
  provider: AIProviderId;
  model: string | null;
  effort: string | null;
  providerThreadId: string | null;
  providerTurnId: string | null;
  status: AICallStatus;
  errorCode: AIErrorCode | null;
  errorMessage: string | null;
  retries: number;
  latencyFirstTokenMs: number | null;
  latencyTotalMs: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  contextTokensEstimated: number;
  contextManifest: ContextManifestEntry[];
  toolAttempts: number;
  validationIssues: ValidationIssue[];
  /** Epoch ms when the call started. */
  createdAt: number;
}

/** Maps an error code to the `ai_calls.status` it is recorded with. */
export function statusForError(code: AIErrorCode): AICallStatus {
  switch (code) {
    case 'AI_CANCELLED':
      return 'cancelled';
    case 'AI_TIMEOUT':
      return 'timeout';
    case 'AI_RATE_LIMITED':
      return 'rate_limited';
    case 'AI_UNAUTHORIZED':
      return 'unauthorized';
    case 'AI_BAD_OUTPUT':
      return 'bad_output';
    default:
      return 'provider_error';
  }
}
