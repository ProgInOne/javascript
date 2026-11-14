import type { AILoginResponse, AIModel, AIStatus, AIUsage } from '@proginone/shared';
import { AIError, type AIErrorCode } from '../../errors.ts';
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEvent,
  ProviderRequest,
  ProviderResponse,
  ProviderRunOptions,
} from '../types.ts';
import { sampleFromSchema } from './sample.ts';

/**
 * One scripted turn. Without a script the mock answers deterministically from the request
 * (E2E with `PROGINONE_AI_PROVIDER=mock`).
 */
export interface MockStep {
  /** Streamed in this order; the final text is their concatenation unless `text` is given. */
  deltas?: string[];
  text?: string;
  /** Fail with this error after streaming `deltas`. */
  error?: AIErrorCode | AIError;
  /** Stream `deltas`, then report a tool item (the adapter would interrupt the turn). */
  toolAttempt?: boolean;
  /** Stream `deltas`, then wait until the turn is aborted (cancel tests). */
  hang?: boolean;
  /** Auto-declined server requests to report. */
  declinedRequests?: number;
}

export interface MockProviderOptions {
  /** Delay between deltas in ms (default 5). */
  deltaDelayMs?: number;
  status?: AIStatus;
  model?: string;
}

const CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  structuredOutput: true,
  persistentThreads: true,
  rateLimitInfo: true,
  modelListing: true,
  interactiveLogin: true,
};

const MOCK_MODEL = 'mock-tutor';

/** Reads `aborted` through a call so narrowing does not assume it is unchanged after an await. */
const isAborted = (signal: AbortSignal) => signal.aborted;

/** Splits text into small deterministic chunks (about 12 characters). */
export function chunk(text: string, size = 12): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function defaultReply(req: ProviderRequest): string {
  const question = /<learner_question[^>]*>\n([\s\S]*?)\n<\/learner_question>/.exec(req.input)?.[1];
  const topic = question ? question.trim().slice(0, 40) : '질문';
  return [
    `(모의 튜터) "${topic}"에 대해 함께 생각해 볼게요.`,
    '',
    '먼저 문제에서 무엇을 요구하는지 한 문장으로 정리해 보세요. 그다음 지금 코드가 그 요구와 어디서 달라지는지 찾아보면 좋아요.',
    '',
    '<meta>{"referencedConcepts":[],"suggestedFollowUp":"none"}</meta>',
  ].join('\n');
}

/**
 * Deterministic provider for tests and E2E (docs/design/ai-system.md#mockprovider). Tests script
 * turns with {@link MockProvider.enqueue} (errors, tool attempts, leaking answers, hangs) and
 * read the requests the runner sent in {@link MockProvider.requests}.
 */
export class MockProvider implements ProviderAdapter {
  readonly id = 'mock' as const;
  readonly capabilities = CAPABILITIES;
  readonly requests: ProviderRequest[] = [];
  readonly #steps: MockStep[] = [];
  readonly #listeners = new Set<(e: ProviderEvent) => void>();
  readonly #threads = new Set<string>();
  readonly #deltaDelayMs: number;
  readonly #model: string;
  #status: AIStatus;
  #usage: AIUsage;
  #threadSeq = 0;
  #turnSeq = 0;
  #loginSeq = 0;
  #pendingLogin: { loginId: string; startedAt: number } | null = null;

  constructor(options: MockProviderOptions = {}) {
    this.#deltaDelayMs = options.deltaDelayMs ?? 5;
    this.#model = options.model ?? MOCK_MODEL;
    this.#status = options.status ?? { state: 'ready', planType: 'mock' };
    this.#usage = {
      windows: [{ id: 'primary', usedPercent: 0, windowDurationMins: 300, resetsAt: null }],
      highestUsedPercent: 0,
      updatedAt: 0,
    };
  }

  enqueue(...steps: MockStep[]): this {
    this.#steps.push(...steps);
    return this;
  }

  /** Scripted steps not consumed yet. */
  get pending(): number {
    return this.#steps.length;
  }

  setStatus(status: AIStatus): void {
    this.#status = status;
    this.#emit({ type: 'status', status });
  }

  setUsage(usage: AIUsage): void {
    this.#usage = usage;
    this.#emit({ type: 'usage', usage });
  }

  /** Simulates a lost provider-side thread store (rehydration tests). */
  forgetThreads(): void {
    this.#threads.clear();
  }

  currentStatus(): AIStatus {
    return this.#status;
  }

  connect(): Promise<AIStatus> {
    return Promise.resolve(this.#status);
  }

  reconnect(): Promise<AIStatus> {
    return Promise.resolve(this.#status);
  }

  usage(): Promise<AIUsage | null> {
    return Promise.resolve(this.#usage);
  }

  onEvent(listener: (event: ProviderEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  listModels(): Promise<AIModel[]> {
    return Promise.resolve([
      {
        id: this.#model,
        displayName: '모의 튜터',
        description: '테스트용 결정론적 응답',
        isDefault: true,
        supportedEfforts: ['low', 'medium', 'high'],
      },
    ]);
  }

  login(): Promise<AILoginResponse> {
    const loginId = `mock-login-${++this.#loginSeq}`;
    this.#pendingLogin = { loginId, startedAt: Date.now() };
    setTimeout(() => {
      this.#pendingLogin = null;
      this.#emit({ type: 'login', login: { loginId, success: true, error: null } });
      this.setStatus({ state: 'ready', planType: 'mock' });
    }, 10);
    return Promise.resolve({ loginId, authUrl: 'http://127.0.0.1/mock-login' });
  }

  cancelLogin(): Promise<void> {
    this.#pendingLogin = null;
    return Promise.resolve();
  }

  pendingLogin(): { loginId: string; startedAt: number } | null {
    return this.#pendingLogin;
  }

  logout(): Promise<void> {
    this.setStatus({ state: 'logged_out' });
    return Promise.resolve();
  }

  async run(req: ProviderRequest, opts: ProviderRunOptions): Promise<ProviderResponse> {
    this.requests.push(req);
    if (this.#status.state !== 'ready') {
      throw new AIError(
        this.#status.state === 'rate_limited' ? 'AI_RATE_LIMITED' : 'AI_NOT_CONNECTED',
      );
    }
    let threadId: string | null = null;
    if (req.thread.kind === 'persistent') {
      if (req.thread.resumeId !== null) {
        if (!this.#threads.has(req.thread.resumeId)) {
          throw new AIError('AI_PROVIDER_ERROR', { threadLost: true });
        }
        threadId = req.thread.resumeId;
      } else {
        threadId = `mock-thread-${++this.#threadSeq}`;
        this.#threads.add(threadId);
      }
    }
    const turnId = `mock-turn-${++this.#turnSeq}`;
    const step = this.#steps.shift();
    const text =
      step?.text ??
      step?.deltas?.join('') ??
      (req.outputSchema ? JSON.stringify(sampleFromSchema(req.outputSchema)) : defaultReply(req));
    const deltas = step?.deltas ?? chunk(text);

    let streamed = '';
    for (const delta of deltas) {
      await this.#tick(opts.signal, streamed);
      streamed += delta;
      opts.onDelta?.(delta);
    }
    if (step?.hang) {
      await new Promise<void>((resolve) => {
        if (opts.signal.aborted) resolve();
        opts.signal.addEventListener(
          'abort',
          () => {
            resolve();
          },
          { once: true },
        );
      });
    }
    await this.#tick(opts.signal, streamed);
    if (step?.toolAttempt) {
      throw new AIError('AI_BAD_OUTPUT', { toolAttempt: true, partialText: streamed });
    }
    if (step?.error) {
      throw typeof step.error === 'string'
        ? new AIError(step.error, { partialText: streamed })
        : step.error;
    }
    return {
      text,
      model: req.model ?? this.#model,
      providerThreadId: threadId,
      providerTurnId: turnId,
      usage: {
        inputTokens: Math.ceil(req.input.length / 4),
        cachedInputTokens: 0,
        outputTokens: Math.ceil(text.length / 4),
        reasoningTokens: 0,
      },
      toolAttempts: step?.declinedRequests ?? 0,
      latencyFirstTokenMs: deltas.length > 0 ? this.#deltaDelayMs : null,
    };
  }

  dispose(): Promise<void> {
    this.#listeners.clear();
    return Promise.resolve();
  }

  async #tick(signal: AbortSignal, partialText: string): Promise<void> {
    if (signal.aborted) throw new AIError('AI_CANCELLED', { partialText });
    await new Promise((resolve) => setTimeout(resolve, this.#deltaDelayMs));
    if (isAborted(signal)) throw new AIError('AI_CANCELLED', { partialText });
  }

  #emit(event: ProviderEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
