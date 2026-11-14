import { buildContext, type BuiltContext } from './context/builder.ts';
import type { ContextSource } from './context/source.ts';
import { AIError, isAIError } from './errors.ts';
import { StreamGate } from './output/stream.ts';
import { leakIssues, type OutputGuard } from './output/validate.ts';
import { BASE_INSTRUCTIONS_VERSION, baseInstructions } from './prompts/base.ts';
import { NO_TOOLS_REMINDER, POLICY_REMINDER } from './prompts/safety.ts';
import { TurnGate } from './provider/gate.ts';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from './provider/types.ts';
import {
  statusForError,
  type AICallRecord,
  type AICallStatus,
  type ValidationIssue,
} from './record.ts';
import { instructionsVersion, type AITaskDefinition } from './tasks/define.ts';

/** The provider thread cached for a tutor conversation (`tutor_threads.provider_*`). */
export interface ProviderThreadRef {
  id: string;
  model: string | null;
  instructionsVersion: string;
}

export interface RunOptions {
  /** Reads learning context; request-scoped so it can enforce the learner's access (D-010). */
  source: ContextSource;
  signal?: AbortSignal;
  /** Visible text as it streams (streaming tasks only). */
  onDelta?: (text: string) => void;
  /** Text streamed so far was discarded (retry after a tool attempt or policy violation). */
  onReset?: () => void;
  /** Waiting for a free turn slot; 1 = next. */
  onQueued?: (position: number) => void;
  /** A turn slot was acquired. */
  onStarted?: () => void;
  /** Cached provider thread for tasks with `thread: 'tutor-thread'`. */
  providerThread?: ProviderThreadRef | null;
  /** Answer-leak check (server: content fingerprints). */
  guard?: OutputGuard;
  /** `undefined` uses the provider's default model. */
  model?: string;
}

export interface TaskResult<O> {
  /** `withheld`: the output kept violating a policy after the retry; show a fallback. */
  status: 'ok' | 'withheld';
  output: O | null;
  /** What the learner sees (empty when withheld). */
  text: string;
  record: AICallRecord;
  /** Thread to cache for the next turn (persistent tasks), else `null`. */
  providerThread: ProviderThreadRef | null;
}

export interface TaskRunnerDeps {
  provider: ProviderAdapter;
  /** Epoch ms (`ai_calls.created_at`). */
  now?: () => number;
  gate?: TurnGate;
  /** Waits between transient retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

const TRANSIENT: ReadonlySet<string> = new Set(['AI_OVERLOADED', 'AI_PROVIDER_ERROR']);

const toAIError = (e: unknown): AIError =>
  isAIError(e) ? e : new AIError('AI_PROVIDER_ERROR', { cause: e });

/**
 * Runs AI tasks (docs/design/ai-system.md#설계-개요): validates input, builds the context within
 * budget, calls the provider, streams visible text through the output gate, validates output and
 * applies the task's retry policy. Every run ends with an {@link AICallRecord}, returned with the
 * result or attached to the thrown {@link AIError}.
 */
export class TaskRunner {
  readonly #provider: ProviderAdapter;
  readonly #now: () => number;
  readonly #gate: TurnGate;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(deps: TaskRunnerDeps) {
    this.#provider = deps.provider;
    this.#now = deps.now ?? Date.now;
    this.#gate = deps.gate ?? new TurnGate(2);
    this.#sleep =
      deps.sleep ??
      ((ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }));
  }

  get provider(): ProviderAdapter {
    return this.#provider;
  }

  async run<I, O>(
    task: AITaskDefinition<I, O>,
    rawInput: unknown,
    opts: RunOptions,
  ): Promise<TaskResult<O>> {
    const input = task.inputSchema.parse(rawInput);
    const createdAt = this.#now();
    const t0 = performance.now();
    const iv = instructionsVersion(task, BASE_INSTRUCTIONS_VERSION);
    const issues: ValidationIssue[] = [];
    let retries = 0;
    let toolAttempts = 0;
    let firstTokenMs: number | null = null;
    let context: BuiltContext = { blocks: [], manifest: [], estimatedTokens: 0 };
    let last: ProviderResponse | null = null;

    const record = (status: AICallStatus, error: AIError | null): AICallRecord => ({
      taskName: task.name,
      taskVersion: task.version,
      baseVersion: BASE_INSTRUCTIONS_VERSION,
      provider: this.#provider.id,
      model: last?.model ?? opts.model ?? null,
      effort: task.effort,
      providerThreadId: last?.providerThreadId ?? null,
      providerTurnId: last?.providerTurnId ?? null,
      status,
      errorCode: error?.code ?? null,
      errorMessage: error ? error.message.slice(0, 500) : null,
      retries,
      latencyFirstTokenMs: firstTokenMs ?? last?.latencyFirstTokenMs ?? null,
      latencyTotalMs: Math.round(performance.now() - t0),
      inputTokens: last?.usage?.inputTokens ?? null,
      cachedInputTokens: last?.usage?.cachedInputTokens ?? null,
      outputTokens: last?.usage?.outputTokens ?? null,
      reasoningTokens: last?.usage?.reasoningTokens ?? null,
      contextTokensEstimated: context.estimatedTokens,
      contextManifest: context.manifest,
      toolAttempts,
      validationIssues: issues.slice(0, 20),
      createdAt,
    });
    const fail = (error: AIError, status: AICallStatus = statusForError(error.code)): AIError => {
      error.record = record(status, error);
      return error;
    };

    let release: (() => void) | null = null;
    try {
      release = await this.#gate.acquire(task.priority, opts.signal, opts.onQueued);
      opts.onStarted?.();
      const cached = opts.providerThread ?? null;
      let resumeId =
        task.thread === 'tutor-thread' &&
        cached !== null &&
        cached.instructionsVersion === iv &&
        (opts.model === undefined || cached.model === opts.model)
          ? cached.id
          : null;
      context = await buildContext(task.context, opts.source, input, {
        rehydrate: resumeId === null,
      });

      const reminders = new Set<string>();
      let badOutputLeft: number = task.retry.onBadOutput;
      let transientLeft: number = task.retry.onTransient;
      let policyLeft: number = task.retry.onPolicy;

      for (;;) {
        if (opts.signal?.aborted) throw fail(new AIError('AI_CANCELLED'));
        const controller = new AbortController();
        const onAbort = () => {
          controller.abort();
        };
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        const guardState: { violations: string[] | null } = { violations: null };
        const gate = new StreamGate({
          stripMeta: task.stripMeta,
          guard: task.streaming ? opts.guard : undefined,
          emit: (text) => {
            if (task.streaming) opts.onDelta?.(text);
          },
          onViolation: (v) => {
            guardState.violations = v;
            controller.abort();
          },
        });
        const retry = (reminder: string | null) => {
          retries++;
          if (reminder) reminders.add(reminder);
          if (task.streaming && gate.emittedText !== '') opts.onReset?.();
        };
        const request: ProviderRequest = {
          taskName: task.name,
          baseInstructions: baseInstructions(),
          developerInstructions: [task.instructions(input), ...reminders].join('\n\n'),
          input: task.userMessage(input, context),
          effort: task.effort,
          thread:
            task.thread === 'tutor-thread'
              ? { kind: 'persistent', resumeId }
              : { kind: 'ephemeral' },
          timeoutMs: task.timeoutMs,
          ...(task.firstDeltaTimeoutMs ? { firstDeltaTimeoutMs: task.firstDeltaTimeoutMs } : {}),
          ...(task.outputSchema ? { outputSchema: task.outputSchema(input) } : {}),
          ...(opts.model ? { model: opts.model } : {}),
        };

        let response: ProviderResponse | null = null;
        let error: AIError | null = null;
        try {
          response = await this.#provider.run(request, {
            signal: controller.signal,
            onDelta: (delta) => {
              firstTokenMs ??= Math.round(performance.now() - t0);
              gate.push(delta);
            },
          });
          last = response;
          toolAttempts += response.toolAttempts;
        } catch (e) {
          error = toAIError(e);
        } finally {
          opts.signal?.removeEventListener('abort', onAbort);
        }

        // The output guard stopped the stream: treat as a policy violation below.
        if (error && guardState.violations === null) {
          // A lost thread, or one whose history no longer fits the context window, is rebuilt
          // from the database (docs: 스레드 매핑 전략, 컨텍스트 창 초과).
          if ((error.threadLost || error.code === 'AI_CONTEXT_TOO_LARGE') && resumeId !== null) {
            resumeId = null;
            context = await buildContext(task.context, opts.source, input, { rehydrate: true });
            continue;
          }
          if (error.toolAttempt) {
            toolAttempts++;
            issues.push({ rule: 'tool_attempt', message: '도구 항목이 나타나 턴을 중단했습니다.' });
            if (policyLeft-- > 0) {
              retry(NO_TOOLS_REMINDER);
              continue;
            }
            throw fail(new AIError('AI_BAD_OUTPUT', { toolAttempt: true }));
          }
          if (error.code === 'AI_CANCELLED') {
            error.partialText = gate.emittedText;
            throw fail(error);
          }
          if (TRANSIENT.has(error.code) && error.retryable && transientLeft-- > 0) {
            await this.#sleep(500 * 2 ** (task.retry.onTransient - transientLeft - 1));
            retry(null);
            continue;
          }
          throw fail(error);
        }

        const policy: ValidationIssue[] = [];
        let output: O | null = null;
        if (response && guardState.violations === null) gate.finish();
        if (guardState.violations !== null) {
          policy.push(...leakIssues(guardState.violations));
        } else if (response) {
          const parsed = task.parse(response.text, input);
          if (!parsed.output) {
            issues.push(...parsed.issues);
            if (badOutputLeft-- > 0) {
              retry(null);
              continue;
            }
            throw fail(new AIError('AI_BAD_OUTPUT'));
          }
          output = parsed.output;
          policy.push(...(task.postValidate?.(output, input) ?? []));
          if (opts.guard) {
            policy.push(...leakIssues(opts.guard.findViolations(task.visibleText(output))));
          }
        }

        if (policy.length > 0 || output === null) {
          issues.push(...policy);
          if (policyLeft-- > 0) {
            retry(POLICY_REMINDER);
            continue;
          }
          if (task.streaming && gate.emittedText !== '') opts.onReset?.();
          return {
            status: 'withheld',
            output: null,
            text: '',
            record: record('bad_output', null),
            providerThread: this.#threadRef(task, last, opts, iv),
          };
        }

        return {
          status: 'ok',
          output,
          text: task.visibleText(output),
          record: record('ok', null),
          providerThread: this.#threadRef(task, last, opts, iv),
        };
      }
    } catch (e) {
      if (isAIError(e)) {
        if (!e.record) fail(e);
        throw e;
      }
      throw e;
    } finally {
      release?.();
    }
  }

  #threadRef<I, O>(
    task: AITaskDefinition<I, O>,
    response: ProviderResponse | null,
    opts: RunOptions,
    iv: string,
  ): ProviderThreadRef | null {
    if (task.thread !== 'tutor-thread' || !response?.providerThreadId) return null;
    return {
      id: response.providerThreadId,
      model: response.model ?? opts.model ?? null,
      instructionsVersion: iv,
    };
  }
}
