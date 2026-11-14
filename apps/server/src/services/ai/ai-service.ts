import { errorForStatus, type ProviderAdapter } from '@proginone/ai';
import type {
  AILoginEvent,
  AILoginResponse,
  AIModel,
  AIStatusResponse,
  AIUsage,
} from '@proginone/shared';
import type { Logger } from '../../observability/logger.ts';

export type AIEvent =
  { name: 'status'; data: AIStatusResponse } | { name: 'login'; data: AILoginEvent };

/**
 * AI connection state for the settings screen and the tutor (docs/design/ai-system.md#인증-ux-흐름):
 * status snapshots, the ChatGPT login, models, and change events for `GET /ai/events`.
 */
export class AiService {
  readonly #provider: ProviderAdapter;
  readonly #log: Logger;
  readonly #listeners = new Set<(event: AIEvent) => void>();
  #usage: AIUsage | null = null;

  constructor(deps: { provider: ProviderAdapter; log: Logger }) {
    this.#provider = deps.provider;
    this.#log = deps.log;
    this.#provider.onEvent((event) => {
      if (event.type === 'usage') this.#usage = event.usage;
      if (event.type === 'login') {
        this.#log.info({ success: event.login.success }, 'ai.login.completed');
        this.#broadcast({ name: 'login', data: event.login });
      }
      this.#broadcast({ name: 'status', data: this.snapshot() });
    });
  }

  get provider(): ProviderAdapter {
    return this.#provider;
  }

  /** Current state without starting anything. */
  snapshot(): AIStatusResponse {
    return {
      provider: this.#provider.id,
      status: this.#provider.currentStatus(),
      usage: this.#usage,
      pendingLogin: this.#provider.pendingLogin(),
    };
  }

  /** Starts the provider if needed (opening the AI settings is a lazy-start trigger). */
  async status(): Promise<AIStatusResponse> {
    const status = await this.#provider.connect();
    if (status.state === 'ready' || status.state === 'rate_limited') {
      this.#usage = await this.#provider.usage();
    }
    return this.snapshot();
  }

  /** Throws the `AIError` of the current state unless requests can run. */
  async ensureReady(): Promise<void> {
    const status = await this.#provider.connect();
    if (
      status.state === 'rate_limited' &&
      status.resetsAt &&
      Date.parse(status.resetsAt) <= Date.now()
    ) {
      return;
    }
    const error = errorForStatus(status);
    if (error) throw error;
  }

  login(): Promise<AILoginResponse> {
    return this.#provider.login();
  }

  cancelLogin(loginId: string): Promise<void> {
    return this.#provider.cancelLogin(loginId);
  }

  async logout(): Promise<AIStatusResponse> {
    await this.#provider.logout();
    return this.snapshot();
  }

  async reconnect(): Promise<AIStatusResponse> {
    await this.#provider.reconnect();
    return this.status();
  }

  async models(): Promise<AIModel[]> {
    await this.ensureReady();
    return this.#provider.listModels();
  }

  subscribe(listener: (event: AIEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #broadcast(event: AIEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (err) {
        this.#log.warn({ err }, 'ai event listener failed');
      }
    }
  }
}
