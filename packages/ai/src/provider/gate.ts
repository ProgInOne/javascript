import { AIError } from '../errors.ts';

export type TaskPriority = 'interactive' | 'background';

interface Waiter {
  priority: TaskPriority;
  grant: () => void;
  onPosition: ((position: number) => void) | undefined;
}

/**
 * Global concurrent-turn limit with a priority queue (docs/design/ai-system.md#동시성-제어):
 * interactive tasks overtake background ones, FIFO within a priority. `acquire` resolves with a
 * release function; an aborted waiter leaves the queue with `AI_CANCELLED`.
 */
export class TurnGate {
  readonly #limit: number;
  #running = 0;
  readonly #queue: Waiter[] = [];

  constructor(limit = 2) {
    this.#limit = Math.max(1, limit);
  }

  get running(): number {
    return this.#running;
  }

  get queued(): number {
    return this.#queue.length;
  }

  acquire(
    priority: TaskPriority,
    signal?: AbortSignal,
    onPosition?: (position: number) => void,
  ): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new AIError('AI_CANCELLED'));
    if (this.#running < this.#limit && this.#queue.length === 0) {
      this.#running++;
      return Promise.resolve(this.#releaser());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        priority,
        onPosition,
        grant: () => {
          signal?.removeEventListener('abort', onAbort);
          this.#running++;
          resolve(this.#releaser());
        },
      };
      const onAbort = () => {
        const i = this.#queue.indexOf(waiter);
        if (i >= 0) this.#queue.splice(i, 1);
        this.#announce();
        reject(new AIError('AI_CANCELLED'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      // Interactive waiters go before the first background waiter.
      const at =
        priority === 'interactive' ? this.#queue.findIndex((w) => w.priority === 'background') : -1;
      if (at < 0) this.#queue.push(waiter);
      else this.#queue.splice(at, 0, waiter);
      this.#announce();
    });
  }

  #releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#running--;
      this.#pump();
    };
  }

  #pump(): void {
    while (this.#running < this.#limit && this.#queue.length > 0) {
      this.#queue.shift()?.grant();
    }
    this.#announce();
  }

  #announce(): void {
    this.#queue.forEach((w, i) => w.onPosition?.(i + 1));
  }
}
