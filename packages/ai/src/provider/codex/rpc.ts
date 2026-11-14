import { AIError } from '../../errors.ts';
import {
  RPC_METHOD_NOT_FOUND,
  RPC_OVERLOADED,
  type JsonRpcErrorBody,
  type RequestId,
} from './protocol.ts';

// JSON-RPC over stdio JSONL without the `"jsonrpc":"2.0"` header
// (docs/design/ai-system.md#json-rpc-클라이언트). One message per line; unparsable lines are
// logged and ignored.

export type ServerRequestReply = { result: unknown } | { error: JsonRpcErrorBody };

export interface JsonRpcClientOptions {
  send: (line: string) => void;
  /** Server → client requests (approvals, tool calls). Must answer synchronously. */
  onServerRequest: (method: string, params: unknown) => ServerRequestReply;
  onNotification: (method: string, params: unknown) => void;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

/** A JSON-RPC error response, kept for code-based handling (overload, not found). */
export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(method: string, body: JsonRpcErrorBody) {
    super(`${method}: ${body.message}`);
    this.name = 'RpcError';
    this.code = body.code;
    this.data = body.data;
  }
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export class JsonRpcClient {
  readonly #opts: JsonRpcClientOptions;
  readonly #pending = new Map<RequestId, Pending>();
  #nextId = 1;
  #closed = false;

  constructor(opts: JsonRpcClientOptions) {
    this.#opts = opts;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  /** Feeds one stdout line. */
  handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      this.#opts.log?.('codex.rpc.bad_line', { line: trimmed.slice(0, 200) });
      return;
    }
    if (!isObject(msg)) return;
    const id = msg['id'];
    const method = msg['method'];
    const hasId = typeof id === 'string' || typeof id === 'number';
    if (hasId && typeof method === 'string') {
      let reply: ServerRequestReply;
      try {
        reply = this.#opts.onServerRequest(method, msg['params']);
      } catch {
        reply = { error: { code: RPC_METHOD_NOT_FOUND, message: 'Method not found' } };
      }
      this.#write({ id, ...reply });
      return;
    }
    if (hasId) {
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      const error = msg['error'];
      if (isObject(error)) {
        pending.reject(
          new RpcError(pending.method, {
            code: typeof error['code'] === 'number' ? error['code'] : -32603,
            message: typeof error['message'] === 'string' ? error['message'] : 'error',
            data: error['data'],
          }),
        );
      } else {
        pending.resolve(msg['result']);
      }
      return;
    }
    if (typeof method === 'string') this.#opts.onNotification(method, msg['params']);
  }

  request<T>(method: string, params: unknown, timeoutMs = 15_000): Promise<T> {
    if (this.#closed) {
      return Promise.reject(
        new AIError('AI_PROVIDER_ERROR', { message: 'Codex 연결이 닫혔습니다.' }),
      );
    }
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new AIError('AI_TIMEOUT', { message: `Codex 요청 시간이 초과되었습니다: ${method}` }),
        );
      }, timeoutMs);
      timer.unref();
      this.#pending.set(id, {
        method,
        resolve: (v) => {
          resolve(v as T);
        },
        reject,
        timer,
      });
      this.#write(params === undefined ? { id, method } : { id, method, params });
    });
  }

  /**
   * `request` with the overload policy: `-32001` is retried with exponential backoff from 0.5s,
   * at most `retries` times.
   */
  async requestWithRetry<T>(
    method: string,
    params: unknown,
    opts: { timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<void> } = {},
  ): Promise<T> {
    const retries = opts.retries ?? 3;
    const sleep =
      opts.sleep ??
      ((ms: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms).unref();
        }));
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request<T>(method, params, opts.timeoutMs);
      } catch (e) {
        if (!(e instanceof RpcError) || e.code !== RPC_OVERLOADED || attempt >= retries) throw e;
        await sleep(500 * 2 ** attempt);
      }
    }
  }

  notify(method: string, params?: unknown): void {
    if (this.#closed) return;
    this.#write(params === undefined ? { method } : { method, params });
  }

  /** The process went away: reject everything that is waiting. */
  close(error: Error): void {
    this.#closed = true;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pending.delete(id);
    }
  }

  #write(message: Record<string, unknown>): void {
    if (this.#closed) return;
    this.#opts.send(`${JSON.stringify(message)}\n`);
  }
}
