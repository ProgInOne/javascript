import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { AILoginResponse, AIModel, AIStatus, AIUsage } from '@proginone/shared';
import { AIError } from '../../errors.ts';
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEvent,
  ProviderRequest,
  ProviderResponse,
  ProviderRunOptions,
  ProviderUsage,
} from '../types.ts';
import { denyServerRequest } from './deny.ts';
import { parseFeatureList, verifyFeatureFlags } from './features.ts';
import { prepareTutorDirs, type TutorDirs } from './home.ts';
import { execCodex, findExecutable, spawnAppServer, type AppServerProcess } from './process.ts';
import {
  MIN_CODEX_VERSION,
  NON_TOOL_ITEM_TYPES,
  OPT_OUT_NOTIFICATIONS,
  type GetAccountResponse,
  type InitializeParams,
  type InitializeResponse,
  type LoginChatgptResponse,
  type ModelInfo,
  type RateLimitSnapshot,
  type ThreadItem,
  type ThreadResumeParams,
  type ThreadStartParams,
  type ThreadStartResponse,
  type TokenUsageBreakdown,
  type Turn,
  type TurnError,
  type TurnStartParams,
  type TurnStartResponse,
} from './protocol.ts';
import { JsonRpcClient } from './rpc.ts';
import { busiestReset, mergeUsage } from './usage.ts';
import { compareVersions, parseCodexVersion } from './version.ts';

// Codex App Server adapter (docs/design/ai-system.md#codex-app-server-어댑터, D-002).
// Isolation layers, all mandatory:
//   1. tutor-only CODEX_HOME with the feature-flag bundle, verified by `codex features list`;
//   2. thread overrides: approvalPolicy untrusted, sandbox read-only, empty cwd, web_search
//      disabled, baseInstructions replacing the coding-agent prompt; effective values checked;
//   3. every server request auto-declined;
//   4. any tool-type item interrupts the turn and its response is discarded.

export type CodexLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface CodexAdapterOptions {
  /** Config `codexPath`: an executable path or a name looked up on `PATH`. */
  codexPath: string;
  /** `<dataDir>`: the tutor home and workspace live under it. */
  dataDir: string;
  /** Parent environment (default `process.env`); `CODEX_HOME` is always overridden. */
  env?: NodeJS.ProcessEnv;
  clientVersion: string;
  log?: (level: CodexLogLevel, event: string, fields?: Record<string, unknown>) => void;
  now?: () => number;
  /** Restart backoff (docs: 1, 2, 4, 8, 16s, max 30s, ±20%, 5 failures, reset after 60s). */
  backoff?: Partial<BackoffPolicy>;
  random?: () => number;
  /** Pending ChatGPT logins are cancelled after this long (default 5 min). */
  loginTimeoutMs?: number;
  /** `turn/interrupt` that gets no `turn/completed` is finished locally after this (default 3s). */
  interruptTimeoutMs?: number;
  /** Timeout of control requests (`initialize`, `thread/start`, `account/*`; default 15s). */
  requestTimeoutMs?: number;
}

export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
  jitter: number;
  maxFailures: number;
  healthyResetMs: number;
}

const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 1_000,
  maxMs: 30_000,
  jitter: 0.2,
  maxFailures: 5,
  healthyResetMs: 60_000,
};

const CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  structuredOutput: true,
  persistentThreads: true,
  rateLimitInfo: true,
  modelListing: true,
  interactiveLogin: true,
};

const INSTALL_HINT =
  'Codex CLI를 설치한 뒤 "다시 확인"을 누르세요. 설치 위치가 다르면 PROGINONE_CODEX_PATH로 지정합니다.';

interface ActiveTurn {
  threadId: string;
  turnId: string | null;
  model: string | null;
  onDelta: ((text: string) => void) | undefined;
  deltaText: string;
  finalTexts: string[];
  usage: TokenUsageBreakdown | null;
  error: TurnError | null;
  /** A tool item or tool request appeared: interrupt and discard. */
  toolAttempt: boolean;
  declined: number;
  cancelled: boolean;
  timedOut: boolean;
  interruptRequested: boolean;
  interruptSent: boolean;
  startedAt: number;
  firstDeltaMs: number | null;
  complete: (turn: Turn) => void;
  fail: (error: AIError) => void;
  /** Firing the first-delta timer is pointless after the first delta. */
  clearFirstDeltaTimer: () => void;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const samePath = (a: string, b: string) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};

export class CodexAdapter implements ProviderAdapter {
  readonly id = 'codex' as const;
  readonly capabilities = CAPABILITIES;
  readonly #opts: CodexAdapterOptions;
  readonly #dirs: TutorDirs;
  readonly #backoff: BackoffPolicy;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #listeners = new Set<(e: ProviderEvent) => void>();
  readonly #turns = new Map<string, ActiveTurn>();
  #status: AIStatus = { state: 'idle' };
  #starting: Promise<AIStatus> | null = null;
  #proc: AppServerProcess | null = null;
  #rpc: JsonRpcClient | null = null;
  #failures = 0;
  #readyAt: number | null = null;
  #restartTimer: NodeJS.Timeout | null = null;
  #usage: AIUsage | null = null;
  #pendingLogin: { loginId: string; startedAt: number; timer: NodeJS.Timeout } | null = null;
  #disposed = false;
  /** Bumped per process; exit handlers of older processes are ignored. */
  #generation = 0;

  constructor(opts: CodexAdapterOptions) {
    this.#opts = opts;
    this.#dirs = {
      home: join(opts.dataDir, 'codex-home'),
      workspace: join(opts.dataDir, 'codex-workspace'),
    };
    this.#backoff = { ...DEFAULT_BACKOFF, ...opts.backoff };
    this.#now = opts.now ?? Date.now;
    this.#random = opts.random ?? Math.random;
  }

  get dirs(): TutorDirs {
    return this.#dirs;
  }

  // ── Status, events ──────────────────────────────────────────────────────────

  currentStatus(): AIStatus {
    return this.#status;
  }

  onEvent(listener: (event: ProviderEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #emit(event: ProviderEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (e) {
        this.#log('warn', 'codex.listener.error', { err: String(e) });
      }
    }
  }

  #setStatus(status: AIStatus): AIStatus {
    const changed = JSON.stringify(status) !== JSON.stringify(this.#status);
    this.#status = status;
    if (changed) {
      this.#log('info', 'codex.status', { state: status.state });
      this.#emit({ type: 'status', status });
    }
    return status;
  }

  #log(level: CodexLogLevel, event: string, fields?: Record<string, unknown>): void {
    this.#opts.log?.(level, event, fields);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  connect(): Promise<AIStatus> {
    if (this.#disposed) return Promise.resolve(this.#status);
    if (this.#starting) return this.#starting;
    if (this.#status.state === 'idle') return this.#start();
    return Promise.resolve(this.#status);
  }

  async reconnect(): Promise<AIStatus> {
    if (this.#disposed) return this.#status;
    if (this.#starting) await this.#starting.catch(() => undefined);
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
    this.#failures = 0;
    await this.#stopProcess();
    return this.#start();
  }

  #start(): Promise<AIStatus> {
    if (this.#starting) return this.#starting;
    this.#setStatus({ state: 'starting' });
    this.#starting = this.#doStart().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #doStart(): Promise<AIStatus> {
    const env = this.#opts.env ?? process.env;
    const executable = findExecutable(this.#opts.codexPath, env['PATH']);
    if (!executable) return this.#setStatus({ state: 'not_installed', hint: INSTALL_HINT });

    const codexEnv: NodeJS.ProcessEnv = { ...env, CODEX_HOME: this.#dirs.home };
    try {
      const prepared = prepareTutorDirs(this.#dirs);
      if (prepared.configRewritten) this.#log('info', 'codex.home.config_written', {});
    } catch (e) {
      return this.#setStatus({
        state: 'error',
        code: 'AI_UNAVAILABLE',
        message: `튜터 전용 Codex 폴더를 만들지 못했습니다: ${(e as Error).message}`,
      });
    }

    let version: string | null;
    try {
      const out = await execCodex(executable, ['--version'], {
        env: codexEnv,
        cwd: this.#dirs.workspace,
      });
      version = parseCodexVersion(out.stdout);
    } catch (e) {
      this.#log('warn', 'codex.version.failed', { err: String(e) });
      return this.#setStatus({ state: 'not_installed', hint: INSTALL_HINT });
    }
    if (!version || compareVersions(version, MIN_CODEX_VERSION) < 0) {
      return this.#setStatus({
        state: 'unsupported_version',
        found: version ?? 'unknown',
        required: MIN_CODEX_VERSION,
      });
    }

    let problems: string[];
    try {
      const out = await execCodex(executable, ['features', 'list'], {
        env: codexEnv,
        cwd: this.#dirs.workspace,
      });
      problems = verifyFeatureFlags(parseFeatureList(out.stdout));
    } catch (e) {
      problems = [`codex features list 실행에 실패했습니다: ${(e as Error).message}`];
    }
    if (problems.length > 0) {
      this.#log('error', 'codex.isolation.failed', { problems });
      return this.#setStatus({ state: 'isolation_failed', problems });
    }

    return this.#spawn(executable, codexEnv);
  }

  async #spawn(executable: string, env: NodeJS.ProcessEnv): Promise<AIStatus> {
    const generation = ++this.#generation;
    const rpc = new JsonRpcClient({
      send: (line) => {
        proc.send(line);
      },
      onServerRequest: (method, params) => this.#onServerRequest(method, params),
      onNotification: (method, params) => {
        this.#onNotification(method, params);
      },
      log: (event, fields) => {
        this.#log('warn', event, fields);
      },
    });
    const proc = spawnAppServer({
      executable,
      env,
      cwd: this.#dirs.workspace,
      onLine: (line) => {
        rpc.handleLine(line);
      },
      onStderr: (line) => {
        this.#log('debug', 'codex.stderr', { line: line.slice(0, 500) });
      },
    });
    this.#proc = proc;
    this.#rpc = rpc;
    this.#log('info', 'codex.process.spawn', { pid: proc.pid });
    void proc.exited.then((exit) => {
      this.#onExit(generation, exit);
    });

    try {
      const params: InitializeParams = {
        clientInfo: { name: 'proginone', title: 'ProgInOne', version: this.#opts.clientVersion },
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
          optOutNotificationMethods: OPT_OUT_NOTIFICATIONS,
        },
      };
      const init = await rpc.requestWithRetry<InitializeResponse>('initialize', params, {
        timeoutMs: this.#requestTimeout,
      });
      rpc.notify('initialized');
      if (typeof init.codexHome === 'string' && !samePath(init.codexHome, this.#dirs.home)) {
        await this.#stopProcess();
        return this.#setStatus({
          state: 'isolation_failed',
          problems: ['Codex가 튜터 전용 폴더가 아닌 곳을 쓰고 있습니다.'],
        });
      }
      this.#readyAt = this.#now();
      return await this.#refreshAccount();
    } catch (e) {
      if (generation !== this.#generation) return this.#status;
      this.#log('warn', 'codex.process.init_failed', { err: String(e) });
      await this.#stopProcess();
      return this.#scheduleRestart();
    }
  }

  get #requestTimeout(): number {
    return this.#opts.requestTimeoutMs ?? 15_000;
  }

  #onExit(
    generation: number,
    exit: { code: number | null; signal: NodeJS.Signals | null; error?: Error },
  ): void {
    if (generation !== this.#generation) return;
    this.#log('warn', 'codex.process.exit', {
      code: exit.code,
      signal: exit.signal,
      err: exit.error ? String(exit.error) : undefined,
    });
    const error = new AIError('AI_PROVIDER_ERROR', {
      message: '연결이 끊겼습니다. 다시 시도하세요.',
    });
    this.#rpc?.close(error);
    this.#rpc = null;
    this.#proc = null;
    for (const turn of [...this.#turns.values()]) turn.fail(error);
    if (this.#disposed) return;
    if (this.#starting) return; // #spawn's catch schedules the restart
    this.#scheduleRestart();
  }

  #scheduleRestart(): AIStatus {
    if (this.#readyAt !== null && this.#now() - this.#readyAt >= this.#backoff.healthyResetMs) {
      this.#failures = 0;
    }
    this.#readyAt = null;
    this.#failures++;
    if (this.#failures >= this.#backoff.maxFailures) {
      return this.#setStatus({
        state: 'error',
        code: 'AI_UNAVAILABLE',
        message: 'Codex가 계속 종료됩니다. "다시 연결"을 눌러 주세요.',
      });
    }
    const base = Math.min(this.#backoff.maxMs, this.#backoff.baseMs * 2 ** (this.#failures - 1));
    const delay = Math.round(base * (1 + this.#backoff.jitter * (2 * this.#random() - 1)));
    this.#log('info', 'codex.process.restart_scheduled', { attempt: this.#failures, delay });
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      if (!this.#disposed) void this.#start();
    }, delay);
    this.#restartTimer.unref();
    return this.#setStatus({ state: 'starting' });
  }

  async #stopProcess(): Promise<void> {
    const proc = this.#proc;
    const rpc = this.#rpc;
    if (!proc) return;
    this.#generation++; // the exit is intentional
    this.#proc = null;
    this.#rpc = null;
    rpc?.close(new AIError('AI_PROVIDER_ERROR', { message: '연결을 닫았습니다.' }));
    for (const turn of [...this.#turns.values()]) {
      turn.fail(new AIError('AI_PROVIDER_ERROR', { message: '연결을 닫았습니다.' }));
    }
    proc.closeStdin();
    const wait = (ms: number) =>
      Promise.race([
        proc.exited.then(() => true),
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            resolve(false);
          }, ms).unref();
        }),
      ]);
    if (await wait(5_000)) return;
    proc.kill('SIGTERM');
    if (await wait(3_000)) return;
    proc.kill('SIGKILL');
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    if (this.#pendingLogin) clearTimeout(this.#pendingLogin.timer);
    this.#pendingLogin = null;
    // Interrupt running turns (max 2s) before closing (docs: 종료).
    const running = [...this.#turns.values()];
    for (const turn of running) {
      turn.cancelled = true;
      this.#interrupt(turn);
    }
    if (running.length > 0) {
      await Promise.race([
        new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (this.#turns.size === 0) {
              clearInterval(check);
              resolve();
            }
          }, 50);
          check.unref();
        }),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 2_000).unref();
        }),
      ]);
    }
    await this.#stopProcess();
    this.#listeners.clear();
  }

  // ── Account, usage, models ──────────────────────────────────────────────────

  async #refreshAccount(): Promise<AIStatus> {
    const rpc = this.#rpc;
    if (!rpc) return this.#status;
    const res = await rpc.request<GetAccountResponse>(
      'account/read',
      { refreshToken: false },
      this.#requestTimeout,
    );
    if (!res.account) return this.#setStatus({ state: 'logged_out' });
    void this.usage();
    if (this.#status.state === 'rate_limited' && (this.#usage?.highestUsedPercent ?? 0) >= 100) {
      return this.#status;
    }
    return this.#setStatus({ state: 'ready', planType: res.account.planType ?? null });
  }

  async usage(): Promise<AIUsage | null> {
    const rpc = this.#rpc;
    if (!rpc || this.#status.state === 'logged_out') return this.#usage;
    try {
      const res = await rpc.request<{ rateLimits?: RateLimitSnapshot }>(
        'account/rateLimits/read',
        undefined,
        this.#requestTimeout,
      );
      this.#applyUsage(res.rateLimits ?? null);
    } catch (e) {
      this.#log('debug', 'codex.usage.failed', { err: String(e) });
    }
    return this.#usage;
  }

  #applyUsage(snapshot: RateLimitSnapshot | null): void {
    this.#usage = mergeUsage(this.#usage, snapshot, this.#now());
    this.#emit({ type: 'usage', usage: this.#usage });
    if (this.#status.state === 'rate_limited' && (this.#usage.highestUsedPercent ?? 0) < 100) {
      void this.#refreshAccount().catch(() => undefined);
    }
  }

  async listModels(): Promise<AIModel[]> {
    const rpc = await this.#readyRpc();
    const out: AIModel[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res: { data: ModelInfo[]; nextCursor: string | null } = await rpc.request(
        'model/list',
        cursor ? { cursor } : {},
        this.#requestTimeout,
      );
      for (const m of res.data) {
        if (m.hidden) continue;
        out.push({
          id: m.id,
          displayName: m.displayName,
          description: m.description,
          isDefault: m.isDefault,
          supportedEfforts: m.supportedReasoningEfforts.map((e) =>
            typeof e === 'string' ? e : e.reasoningEffort,
          ),
        });
      }
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    return out;
  }

  async login(): Promise<AILoginResponse> {
    const status = await this.connect();
    const rpc = this.#rpc;
    if (!rpc || (status.state !== 'logged_out' && status.state !== 'ready')) {
      throw this.#statusError(status);
    }
    if (this.#pendingLogin) await this.cancelLogin(this.#pendingLogin.loginId);
    const res = await rpc.request<LoginChatgptResponse>(
      'account/login/start',
      { type: 'chatgpt' },
      this.#requestTimeout,
    );
    const timer = setTimeout(
      () => {
        if (this.#pendingLogin?.loginId === res.loginId) void this.cancelLogin(res.loginId);
      },
      this.#opts.loginTimeoutMs ?? 5 * 60_000,
    );
    timer.unref();
    this.#pendingLogin = { loginId: res.loginId, startedAt: this.#now(), timer };
    this.#emit({ type: 'status', status: this.#status });
    return { loginId: res.loginId, authUrl: res.authUrl };
  }

  async cancelLogin(loginId: string): Promise<void> {
    if (this.#pendingLogin?.loginId !== loginId) return;
    clearTimeout(this.#pendingLogin.timer);
    this.#pendingLogin = null;
    this.#emit({ type: 'status', status: this.#status });
    await this.#rpc
      ?.request('account/login/cancel', { loginId }, this.#requestTimeout)
      .catch((e: unknown) => {
        this.#log('debug', 'codex.login.cancel_failed', { err: String(e) });
      });
  }

  pendingLogin(): { loginId: string; startedAt: number } | null {
    return this.#pendingLogin
      ? { loginId: this.#pendingLogin.loginId, startedAt: this.#pendingLogin.startedAt }
      : null;
  }

  async logout(): Promise<void> {
    const rpc = await this.#readyRpc(true);
    await rpc.request('account/logout', undefined, this.#requestTimeout);
    this.#setStatus({ state: 'logged_out' });
  }

  async #readyRpc(allowLoggedOut = false): Promise<JsonRpcClient> {
    const status = await this.connect();
    const ok =
      status.state === 'ready' ||
      status.state === 'rate_limited' ||
      (allowLoggedOut && status.state === 'logged_out');
    if (!this.#rpc || !ok) throw this.#statusError(status);
    return this.#rpc;
  }

  #statusError(status: AIStatus): AIError {
    switch (status.state) {
      case 'logged_out':
        return new AIError('AI_NOT_CONNECTED');
      case 'rate_limited':
        return new AIError('AI_RATE_LIMITED', { details: { resetsAt: status.resetsAt } });
      case 'starting':
      case 'idle':
        return new AIError('AI_PROVIDER_ERROR', {
          message: 'AI 튜터에 다시 연결하는 중입니다. 잠시 후 다시 시도하세요.',
          details: { reason: 'starting' },
        });
      case 'not_installed':
        return new AIError('AI_UNAVAILABLE', { details: { reason: 'not_installed' } });
      case 'unsupported_version':
        return new AIError('AI_UNAVAILABLE', {
          message: `Codex ${status.required} 이상이 필요합니다(현재 ${status.found}).`,
          details: { reason: 'unsupported_version' },
        });
      case 'isolation_failed':
        return new AIError('AI_UNAVAILABLE', {
          message: '튜터 격리 설정을 확인하지 못해 AI 튜터를 껐습니다.',
          details: { reason: 'isolation_failed', problems: status.problems },
        });
      case 'error':
        return new AIError('AI_UNAVAILABLE', {
          message: status.message,
          details: { reason: 'error' },
        });
      case 'ready':
        return new AIError('AI_PROVIDER_ERROR');
    }
  }

  // ── Server requests and notifications ───────────────────────────────────────

  #onServerRequest(method: string, params: unknown) {
    const { reply, toolRequest } = denyServerRequest(method);
    const threadId =
      isObject(params) && typeof params['threadId'] === 'string' ? params['threadId'] : null;
    this.#log('warn', 'codex.approval.declined', { method, known: toolRequest, threadId });
    const turn = threadId ? this.#turns.get(threadId) : undefined;
    if (turn && toolRequest) {
      turn.declined++;
      turn.toolAttempt = true;
      this.#interrupt(turn);
    }
    return reply;
  }

  #onNotification(method: string, params: unknown): void {
    if (!isObject(params)) params = {};
    const p = params as Record<string, unknown>;
    switch (method) {
      case 'account/login/completed': {
        const loginId = typeof p['loginId'] === 'string' ? p['loginId'] : null;
        if (this.#pendingLogin && (loginId === null || loginId === this.#pendingLogin.loginId)) {
          clearTimeout(this.#pendingLogin.timer);
          this.#pendingLogin = null;
        }
        this.#emit({
          type: 'login',
          login: {
            loginId,
            success: p['success'] === true,
            error: typeof p['error'] === 'string' ? p['error'] : null,
          },
        });
        void this.#refreshAccount().catch(() => undefined);
        return;
      }
      case 'account/updated':
        void this.#refreshAccount().catch(() => undefined);
        return;
      case 'account/rateLimits/updated':
        this.#applyUsage((p['rateLimits'] as RateLimitSnapshot | undefined) ?? null);
        return;
    }

    const threadId = typeof p['threadId'] === 'string' ? p['threadId'] : null;
    const turn = threadId ? this.#turns.get(threadId) : undefined;
    if (!turn) return;
    const turnObj = isObject(p['turn']) ? p['turn'] : null;
    const turnId =
      typeof p['turnId'] === 'string'
        ? p['turnId']
        : typeof turnObj?.['id'] === 'string'
          ? turnObj['id']
          : null;
    if (turn.turnId && turnId && turnId !== turn.turnId) return; // a stale, discarded turn
    if (!turn.turnId && turnId) {
      turn.turnId = turnId;
      if (turn.interruptRequested) this.#interrupt(turn);
    }

    switch (method) {
      case 'item/agentMessage/delta': {
        const delta = typeof p['delta'] === 'string' ? p['delta'] : '';
        if (turn.toolAttempt || turn.cancelled || turn.timedOut || delta === '') return;
        if (turn.firstDeltaMs === null) {
          turn.firstDeltaMs = Math.round(performance.now() - turn.startedAt);
          turn.clearFirstDeltaTimer();
        }
        turn.deltaText += delta;
        turn.onDelta?.(delta);
        return;
      }
      case 'item/started':
      case 'item/completed': {
        const item = p['item'] as ThreadItem | undefined;
        if (!item || typeof item.type !== 'string') return;
        if (!NON_TOOL_ITEM_TYPES.has(item.type)) {
          this.#log('warn', 'codex.tool_item', { type: item.type, phase: method });
          turn.toolAttempt = true;
          this.#interrupt(turn);
          return;
        }
        if (
          method === 'item/completed' &&
          item.type === 'agentMessage' &&
          typeof item.text === 'string'
        ) {
          turn.finalTexts.push(item.text);
        }
        return;
      }
      case 'thread/tokenUsage/updated': {
        const usage = isObject(p['tokenUsage']) ? p['tokenUsage'] : null;
        if (usage && isObject(usage['last']))
          turn.usage = usage['last'] as unknown as TokenUsageBreakdown;
        return;
      }
      case 'error':
        if (p['willRetry'] !== true && isObject(p['error'])) {
          turn.error = p['error'] as unknown as TurnError;
        }
        return;
      case 'turn/completed':
        if (turnObj) turn.complete(turnObj as unknown as Turn);
        return;
    }
  }

  #interrupt(turn: ActiveTurn): void {
    turn.interruptRequested = true;
    if (!turn.turnId || turn.interruptSent || !this.#rpc) return;
    turn.interruptSent = true;
    const { threadId, turnId } = turn;
    void this.#rpc
      .request('turn/interrupt', { threadId, turnId }, this.#requestTimeout)
      .catch((e: unknown) => {
        this.#log('debug', 'codex.interrupt.failed', { err: String(e) });
      });
    // No `turn/completed` in time: finish locally; later notifications of the turn are dropped.
    setTimeout(() => {
      if (this.#turns.get(threadId) === turn) {
        turn.complete({ id: turnId, status: 'interrupted', error: null });
      }
    }, this.#opts.interruptTimeoutMs ?? 3_000).unref();
  }

  // ── Turns ───────────────────────────────────────────────────────────────────

  async run(req: ProviderRequest, opts: ProviderRunOptions): Promise<ProviderResponse> {
    if (opts.signal.aborted) throw new AIError('AI_CANCELLED');
    const status = await this.connect();
    if (status.state === 'rate_limited') {
      const resetsAt = status.resetsAt ? Date.parse(status.resetsAt) : NaN;
      if (!(resetsAt <= this.#now())) throw this.#statusError(status);
    } else if (status.state !== 'ready') {
      throw this.#statusError(status);
    }
    const rpc = this.#rpc;
    if (!rpc) throw this.#statusError(this.#status);

    const overrides = {
      cwd: this.#dirs.workspace,
      approvalPolicy: 'untrusted' as const,
      sandbox: 'read-only' as const,
      config: { web_search: 'disabled' },
      baseInstructions: req.baseInstructions,
      developerInstructions: req.developerInstructions,
      ...(req.model ? { model: req.model } : {}),
    };
    let thread: ThreadStartResponse;
    if (req.thread.kind === 'persistent' && req.thread.resumeId) {
      const params: ThreadResumeParams = {
        threadId: req.thread.resumeId,
        ...overrides,
        excludeTurns: true,
      };
      try {
        thread = await rpc.requestWithRetry<ThreadStartResponse>('thread/resume', params, {
          timeoutMs: this.#requestTimeout,
        });
      } catch (e) {
        throw new AIError('AI_PROVIDER_ERROR', { threadLost: true, cause: e });
      }
    } else {
      const params: ThreadStartParams = {
        ...overrides,
        serviceName: 'proginone',
        ephemeral: req.thread.kind === 'ephemeral',
      };
      thread = await rpc.requestWithRetry<ThreadStartResponse>('thread/start', params, {
        timeoutMs: this.#requestTimeout,
      });
    }
    this.#verifyThread(thread);
    return this.#runTurn(rpc, thread, req, opts);
  }

  /** The effective thread settings must be the isolation overrides (docs: 실효 값으로 검증). */
  #verifyThread(thread: ThreadStartResponse): void {
    const problems: string[] = [];
    if (thread.approvalPolicy !== 'untrusted') problems.push('승인 정책이 untrusted가 아닙니다.');
    if (!isObject(thread.sandbox) || thread.sandbox.type !== 'readOnly') {
      problems.push('샌드박스가 읽기 전용이 아닙니다.');
    } else if (thread.sandbox.networkAccess) {
      problems.push('샌드박스에 네트워크 접근이 열려 있습니다.');
    }
    if (typeof thread.cwd === 'string' && !samePath(thread.cwd, this.#dirs.workspace)) {
      problems.push('작업 폴더가 빈 튜터 폴더가 아닙니다.');
    }
    if (problems.length > 0) {
      this.#log('error', 'codex.isolation.thread_failed', { problems });
      this.#setStatus({ state: 'isolation_failed', problems });
      throw this.#statusError(this.#status);
    }
  }

  #runTurn(
    rpc: JsonRpcClient,
    thread: ThreadStartResponse,
    req: ProviderRequest,
    opts: ProviderRunOptions,
  ): Promise<ProviderResponse> {
    const threadId = thread.thread.id;
    if (this.#turns.has(threadId)) {
      return Promise.reject(
        new AIError('AI_PROVIDER_ERROR', { message: '같은 대화에서 이전 답변이 진행 중입니다.' }),
      );
    }
    return new Promise<ProviderResponse>((resolve, reject) => {
      const timers: NodeJS.Timeout[] = [];
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        for (const t of timers) clearTimeout(t);
        opts.signal.removeEventListener('abort', onAbort);
        if (this.#turns.get(threadId) === turn) this.#turns.delete(threadId);
        fn();
      };
      let firstDeltaTimer: NodeJS.Timeout | null = null;
      const turn: ActiveTurn = {
        threadId,
        turnId: null,
        model: thread.model,
        onDelta: opts.onDelta,
        deltaText: '',
        finalTexts: [],
        usage: null,
        error: null,
        toolAttempt: false,
        declined: 0,
        cancelled: false,
        timedOut: false,
        interruptRequested: false,
        interruptSent: false,
        startedAt: performance.now(),
        firstDeltaMs: null,
        clearFirstDeltaTimer: () => {
          if (firstDeltaTimer) clearTimeout(firstDeltaTimer);
        },
        fail: (error) => {
          error.partialText ||= turn.deltaText;
          finish(() => {
            reject(error);
          });
        },
        complete: (result) => {
          const partialText = turn.deltaText;
          if (turn.toolAttempt) {
            turn.fail(
              new AIError('AI_BAD_OUTPUT', {
                toolAttempt: true,
                partialText,
                details: { declinedRequests: turn.declined },
              }),
            );
          } else if (turn.cancelled) {
            turn.fail(new AIError('AI_CANCELLED', { partialText }));
          } else if (turn.timedOut) {
            turn.fail(new AIError('AI_TIMEOUT', { partialText }));
          } else if (result.status === 'failed' || turn.error || result.error) {
            turn.fail(this.#turnError(result.error ?? turn.error));
          } else if (result.status === 'interrupted') {
            turn.fail(new AIError('AI_CANCELLED', { partialText }));
          } else {
            const usage: ProviderUsage | null = turn.usage
              ? {
                  inputTokens: turn.usage.inputTokens,
                  cachedInputTokens: turn.usage.cachedInputTokens,
                  outputTokens: turn.usage.outputTokens,
                  reasoningTokens: turn.usage.reasoningOutputTokens,
                }
              : null;
            finish(() => {
              resolve({
                text: turn.finalTexts.length > 0 ? turn.finalTexts.join('\n\n') : turn.deltaText,
                model: turn.model,
                providerThreadId: threadId,
                providerTurnId: turn.turnId ?? result.id,
                usage,
                toolAttempts: turn.declined,
                latencyFirstTokenMs: turn.firstDeltaMs,
              });
            });
          }
        },
      };
      const onAbort = () => {
        turn.cancelled = true;
        this.#interrupt(turn);
      };
      opts.signal.addEventListener('abort', onAbort, { once: true });
      this.#turns.set(threadId, turn);

      const total = setTimeout(() => {
        turn.timedOut = true;
        this.#interrupt(turn);
      }, req.timeoutMs);
      total.unref();
      timers.push(total);
      if (req.firstDeltaTimeoutMs) {
        firstDeltaTimer = setTimeout(() => {
          if (turn.firstDeltaMs === null) {
            turn.timedOut = true;
            this.#interrupt(turn);
          }
        }, req.firstDeltaTimeoutMs);
        firstDeltaTimer.unref();
        timers.push(firstDeltaTimer);
      }

      const params: TurnStartParams = {
        threadId,
        input: [{ type: 'text', text: req.input, text_elements: [] }],
        effort: req.effort,
        ...(req.outputSchema ? { outputSchema: req.outputSchema } : {}),
      };
      rpc
        .requestWithRetry<TurnStartResponse>('turn/start', params, {
          timeoutMs: this.#requestTimeout,
        })
        .then((res) => {
          if (!turn.turnId) {
            turn.turnId = res.turn.id;
            if (turn.interruptRequested) this.#interrupt(turn);
          }
        })
        .catch((e: unknown) => {
          turn.fail(e instanceof AIError ? e : new AIError('AI_PROVIDER_ERROR', { cause: e }));
        });
    });
  }

  /** Maps `codexErrorInfo` to AI error codes and updates the status for auth/limit errors. */
  #turnError(error: TurnError | null): AIError {
    const info = error?.codexErrorInfo ?? null;
    const kind =
      typeof info === 'string' ? info : info ? (Object.keys(info)[0] ?? 'other') : 'other';
    this.#log('warn', 'codex.turn.failed', { kind });
    switch (kind) {
      case 'usageLimitExceeded':
      case 'rateLimitExceeded':
      case 'sessionBudgetExceeded': {
        const resetsAt = busiestReset(this.#usage);
        this.#setStatus({ state: 'rate_limited', resetsAt });
        void this.usage();
        return new AIError('AI_RATE_LIMITED', { details: { resetsAt } });
      }
      case 'contextWindowExceeded':
        return new AIError('AI_CONTEXT_TOO_LARGE');
      case 'unauthorized':
        this.#setStatus({ state: 'logged_out' });
        return new AIError('AI_UNAUTHORIZED');
      case 'serverOverloaded':
        return new AIError('AI_OVERLOADED');
      default:
        return new AIError('AI_PROVIDER_ERROR', { details: { kind } });
    }
  }
}
