import type { ProviderAdapter, ResolvedModel } from '@proginone/ai';
import { pickModel, type AIModel } from '@proginone/shared';
import type { Logger } from '../../observability/logger.ts';

/** How long a model list is reused before a task run asks the provider again. */
export const MODEL_LIST_TTL_MS = 10 * 60_000;

/**
 * Which model AI tasks run on (FR-SET-01, docs/design/ai-system.md#모델-선택, D-060).
 *
 * The learner's choice is `settings.ai.model` (null = the provider's default). Every run checks it
 * against the provider's `model/list`: a saved model the provider no longer lists falls back to the
 * `isDefault` model, so a task never fails because a model was retired. The saved value is kept,
 * so the choice comes back if the model is listed again; the settings screen tells the learner
 * about the fallback. The list is cached for {@link MODEL_LIST_TTL_MS} and refreshed whenever the
 * settings screen asks for it (`GET /ai/models`).
 */
export class ModelSelection {
  readonly #provider: ProviderAdapter;
  readonly #saved: () => string | null;
  readonly #log: Logger;
  readonly #now: () => number;
  #cache: { models: AIModel[]; at: number } | null = null;
  #pending: Promise<AIModel[]> | null = null;

  constructor(deps: {
    provider: ProviderAdapter;
    /** `settings.ai.model`, read on every run. */
    saved: () => string | null;
    log: Logger;
    now?: () => number;
  }) {
    this.#provider = deps.provider;
    this.#saved = deps.saved;
    this.#log = deps.log;
    this.#now = deps.now ?? Date.now;
  }

  /** A fresh list from the provider (the settings screen); also refreshes the cache. */
  async list(): Promise<AIModel[]> {
    this.#pending ??= this.#provider
      .listModels()
      .then((models) => {
        this.#cache = { models, at: this.#now() };
        return models;
      })
      .finally(() => {
        this.#pending = null;
      });
    return this.#pending;
  }

  /**
   * The model for the next run, or null to let the provider choose (no list available, or a list
   * without a default and without the saved model).
   */
  async resolve(): Promise<ResolvedModel | null> {
    let models: AIModel[];
    try {
      models =
        this.#cache && this.#now() - this.#cache.at < MODEL_LIST_TTL_MS
          ? this.#cache.models
          : await this.list();
    } catch (err) {
      this.#log.debug({ err }, 'ai.models.unavailable; provider default model');
      return null;
    }
    const picked = pickModel(models, this.#saved());
    if (picked.fallback) {
      this.#log.debug(
        { saved: this.#saved(), using: picked.model?.id ?? null },
        'ai.model.fallback',
      );
    }
    return picked.model
      ? { id: picked.model.id, supportedEfforts: picked.model.supportedEfforts }
      : null;
  }

  /** Drops the cached list (logout, reconnect: the account and its models may change). */
  invalidate(): void {
    this.#cache = null;
  }
}
