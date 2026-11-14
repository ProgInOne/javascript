import { existsSync } from 'node:fs';
import { AppError } from '../../http/errors.ts';
import { ContentRepository } from '../../db/content/repository.ts';

/**
 * Holds the content.db repository. A missing content.db is not fatal (settings and backups still
 * work); curriculum endpoints then answer 503 CONTENT_UNAVAILABLE. An unsupported schema version
 * throws at startup (docs/design/data-model.md#content_meta).
 */
export class ContentAccess {
  readonly #repo: ContentRepository | null;
  readonly path: string;

  private constructor(path: string, repo: ContentRepository | null) {
    this.path = path;
    this.#repo = repo;
  }

  static open(path: string): ContentAccess {
    return new ContentAccess(path, existsSync(path) ? new ContentRepository(path) : null);
  }

  static unavailable(path = ''): ContentAccess {
    return new ContentAccess(path, null);
  }

  get available(): boolean {
    return this.#repo !== null;
  }

  get repo(): ContentRepository {
    if (!this.#repo) {
      throw new AppError(
        'CONTENT_UNAVAILABLE',
        503,
        '학습 콘텐츠가 아직 준비되지 않았습니다. `pnpm content:build`를 실행하세요.',
      );
    }
    return this.#repo;
  }

  close(): void {
    this.#repo?.close();
  }
}
