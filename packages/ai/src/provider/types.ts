import type {
  AILoginEvent,
  AILoginResponse,
  AIModel,
  AIProviderId,
  AIStatus,
  AIUsage,
} from '@proginone/shared';

// Provider adapter contract (docs/design/ai-system.md#provideradapter-인터페이스). Task
// definitions are provider-independent; an adapter absorbs the protocol differences.

export interface ProviderCapabilities {
  streaming: boolean;
  /** JSON Schema constrained output (`outputSchema`). */
  structuredOutput: boolean;
  /** Provider-side conversation sessions that can be resumed. */
  persistentThreads: boolean;
  rateLimitInfo: boolean;
  modelListing: boolean;
  interactiveLogin: boolean;
}

export type ReasoningEffort = 'low' | 'medium' | 'high';

/**
 * Which provider thread a request runs in. Persistent threads cache a tutor conversation; the
 * database stays the source of truth (D-014), so a lost thread is rebuilt, never fatal.
 */
export type ProviderThreadRequest =
  { kind: 'ephemeral' } | { kind: 'persistent'; resumeId: string | null };

export interface ProviderRequest {
  taskName: string;
  /** Replaces the provider's default agent instructions (persona, language, safety). */
  baseInstructions: string;
  /** Task role instructions. */
  developerInstructions: string;
  /** The user message: data blocks in tags plus the learner's question. */
  input: string;
  /** JSON Schema for structured output tasks. */
  outputSchema?: Record<string, unknown>;
  /** `undefined` uses the account default model. */
  model?: string;
  effort: ReasoningEffort;
  thread: ProviderThreadRequest;
  /** Whole-turn timeout. */
  timeoutMs: number;
  /** Time allowed until the first text delta (interactive tasks). */
  firstDeltaTimeoutMs?: number;
}

export interface ProviderUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface ProviderResponse {
  /** Final text (a JSON string for structured output). */
  text: string;
  model: string | null;
  providerThreadId: string | null;
  providerTurnId: string | null;
  usage: ProviderUsage | null;
  /** Server requests that were auto-declined during the turn. */
  toolAttempts: number;
  latencyFirstTokenMs: number | null;
}

export interface ProviderRunOptions {
  signal: AbortSignal;
  onDelta?: (text: string) => void;
}

export type ProviderEvent =
  | { type: 'status'; status: AIStatus }
  | { type: 'usage'; usage: AIUsage }
  | { type: 'login'; login: AILoginEvent };

export interface ProviderAdapter {
  readonly id: AIProviderId;
  readonly capabilities: ProviderCapabilities;
  /** Current state without side effects. */
  currentStatus(): AIStatus;
  /** Starts the provider if it is idle (lazy start) and returns the settled state. */
  connect(): Promise<AIStatus>;
  /** Restarts after `error`/`not_installed` ("다시 연결", "다시 확인"). */
  reconnect(): Promise<AIStatus>;
  /** Last known usage, refreshed from the provider when possible. */
  usage(): Promise<AIUsage | null>;
  onEvent(listener: (event: ProviderEvent) => void): () => void;
  listModels(): Promise<AIModel[]>;
  /** Starts the official ChatGPT browser login. Completion arrives as a `login` event. */
  login(): Promise<AILoginResponse>;
  cancelLogin(loginId: string): Promise<void>;
  logout(): Promise<void>;
  /**
   * Runs one turn. Rejects with `AIError`: `AI_CANCELLED` when `signal` aborts (with the text so
   * far), `toolAttempt` when the turn produced a tool item, `threadLost` when a persistent thread
   * could not be resumed.
   */
  run(req: ProviderRequest, opts: ProviderRunOptions): Promise<ProviderResponse>;
  dispose(): Promise<void>;
}
