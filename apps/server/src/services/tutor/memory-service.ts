import {
  errorForStatus,
  fallbackSummary,
  isAIError,
  sanitizeSummary,
  sessionSummarize,
  type AICallRecord,
  type TaskRunner,
} from '@proginone/ai';
import {
  tutorReplyMetaSchema,
  type SessionSummaryContent,
  type SummarizeTutorThreadResponse,
  type TutorThreadSummaryResponse,
} from '@proginone/shared';
import { TutorContextSource } from '../../ai/context-source.ts';
import type { UserDb } from '../../db/user/connection.ts';
import { ensureLearner, newId, type Learner } from '../../db/user/learners.ts';
import {
  insertThreadSummary,
  messagesSince,
  threadSummary,
  threadsNeedingSummary,
  toSummaryView,
  type SummaryRow,
} from '../../db/user/summaries.ts';
import { findThread, insertAiCall, listMessages, type ThreadRow } from '../../db/user/tutor.ts';
import { aiAppError, AppError } from '../../http/errors.ts';
import type { Logger } from '../../observability/logger.ts';
import type { AiService } from '../ai/ai-service.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';

// Long-term memory (docs/design/ai-system.md#장기-학습-기억, #sessionsummarize): rolling summaries
// of tutor threads in `session_summaries`. Summaries are written after 30 minutes without
// messages (background sweep), on request, and before a long thread is rebuilt. They feed the
// tutor's context only; they never change mastery or misconceptions (D-010).

/** A thread is summarized after this long without messages (docs: 튜터 스레드 비활성 30분). */
export const SUMMARY_IDLE_MS = 30 * 60_000;
/** Background summaries deferred this long are replaced by the deterministic one (docs: 7일). */
export const SUMMARY_FALLBACK_AFTER_MS = 7 * 86_400_000;
/** Background AI work pauses from this usage (docs: 사용량 표시와 한도 처리, 80~95%). */
export const BACKGROUND_USAGE_LIMIT = 80;
/** AI summaries per sweep; the rest wait for the next sweep. */
const SUMMARIES_PER_SWEEP = 2;
const SWEEP_INTERVAL_MS = 5 * 60_000;

export interface MemoryDeps {
  userDb: UserDb;
  content: ContentAccess;
  runner: TaskRunner;
  ai: AiService;
  now: Clock;
  log: Logger;
  /** True while an interactive AI turn runs; background work waits (docs: 동시성 제어). */
  interactiveBusy?: () => boolean;
}

export type SummaryReason = 'manual' | 'idle' | 'rehydrate';

export interface SweepResult {
  summarized: number;
  fallbacks: number;
  /** AI work was skipped (not connected, usage ≥ 80%, or an interactive turn was running). */
  deferred: boolean;
}

export class MemoryService {
  readonly #deps: MemoryDeps;
  readonly #inFlight = new Map<string, Promise<SummarizeTutorThreadResponse>>();
  #timers: NodeJS.Timeout[] = [];
  #sweeping = false;

  constructor(deps: MemoryDeps) {
    this.#deps = deps;
  }

  #learner(): Learner {
    return ensureLearner(this.#deps.userDb);
  }

  #thread(learnerId: string, id: string): ThreadRow {
    const thread = findThread(this.#deps.userDb.orm, learnerId, id);
    if (!thread) {
      throw new AppError('NOT_FOUND', 404, '대화를 찾을 수 없습니다.', { details: { id } });
    }
    return thread;
  }

  /** `GET /tutor/threads/:id/summary`. */
  summary(threadId: string): TutorThreadSummaryResponse {
    const learner = this.#learner();
    const thread = this.#thread(learner.id, threadId);
    const row = threadSummary(this.#deps.userDb.orm, learner.id, thread.id);
    return { summary: row ? toSummaryView(row) : null };
  }

  /**
   * Summarizes the messages since the thread's last summary. `manual` reports AI errors to the
   * caller; background reasons defer instead, and fall back to the deterministic summary once a
   * thread has waited seven days. One summary per thread at a time.
   */
  summarizeThread(
    threadId: string,
    reason: SummaryReason,
    opts: { excludeMessageIds?: readonly string[] } = {},
  ): Promise<SummarizeTutorThreadResponse> {
    const running = this.#inFlight.get(threadId);
    if (running) return running;
    const task = this.#summarize(threadId, reason, opts.excludeMessageIds ?? []).finally(() => {
      this.#inFlight.delete(threadId);
    });
    this.#inFlight.set(threadId, task);
    return task;
  }

  /** Unsummarized complete replies of a thread (rehydration decides on a rolling summary). */
  unsummarizedCount(learnerId: string, threadId: string): number {
    const orm = this.#deps.userDb.orm;
    const current = threadSummary(orm, learnerId, threadId);
    return messagesSince(orm, threadId, current?.coveredUntil.getTime() ?? 0).length;
  }

  async #summarize(
    threadId: string,
    reason: SummaryReason,
    excludeMessageIds: readonly string[],
  ): Promise<SummarizeTutorThreadResponse> {
    const { userDb, content, runner, log } = this.#deps;
    const orm = userDb.orm;
    const learner = this.#learner();
    const thread = this.#thread(learner.id, threadId);
    const current = threadSummary(orm, learner.id, thread.id);
    const after = current?.coveredUntil.getTime() ?? 0;
    const fresh = messagesSince(orm, thread.id, after).filter(
      (m) => !excludeMessageIds.includes(m.id),
    );
    const view = current ? toSummaryView(current) : null;
    if (!fresh.some((m) => m.role === 'tutor' && m.status === 'complete')) {
      return { summary: view, created: false };
    }
    const previous = view?.content ?? null;
    const conceptIds = this.#threadConcepts(thread, fresh, previous);
    const coveredUntil = Math.max(...fresh.map((m) => m.createdAt.getTime()));
    const messageCount = (current?.messageCount ?? 0) + fresh.length;
    const write = (
      source: SummaryRow['source'],
      summary: SessionSummaryContent,
      record: AICallRecord | null,
    ) =>
      toSummaryView(
        insertThreadSummary(orm, {
          id: newId(),
          learnerId: learner.id,
          threadId: thread.id,
          source,
          content: summary,
          messageCount,
          coveredUntil,
          aiCall: record ? { id: newId(), record } : null,
          createdAt: this.#deps.now(),
        }),
      );
    const fallback = (record: AICallRecord | null) =>
      write(
        'fallback',
        fallbackSummary({ messages: fresh, conceptIds, previous }),
        record ? { ...record, status: 'fallback' } : null,
      );
    const overdue = this.#deps.now() - thread.lastMessageAt.getTime() >= SUMMARY_FALLBACK_AFTER_MS;

    // Background work never starts the provider (Codex starts lazily on learner requests).
    const provider = this.#deps.ai.provider;
    const statusError = errorForStatus(
      reason === 'idle' ? provider.currentStatus() : await provider.connect(),
    );
    if (statusError) {
      if (reason === 'manual') throw aiAppError(statusError);
      return overdue
        ? { summary: fallback(null), created: true }
        : { summary: view, created: false };
    }

    const source = new TutorContextSource(userDb, content, {
      learnerId: learner.id,
      timezone: learner.timezone,
      dayStartHour: learner.dayStartHour,
      practiceSetItemId: null,
      now: this.#deps.now,
    });
    try {
      const result = await runner.run(
        sessionSummarize,
        {
          threadId: thread.id,
          conceptIds,
          previousSummary: previous,
          after,
          excludeMessageIds: [...excludeMessageIds],
          ...(thread.scopeType === 'exercise' && thread.scopeId
            ? { exerciseId: thread.scopeId }
            : {}),
        },
        { source },
      );
      if (!result.output) return { summary: fallback(result.record), created: true };
      const known = {
        messageIds: new Set(listMessages(orm, thread.id).map((m) => m.id)),
        conceptIds: new Set(
          content.available
            ? content.repo
                .getConcepts([
                  ...result.output.conceptIds,
                  ...result.output.understoodWell.map((u) => u.conceptId),
                  ...result.output.struggles.map((s) => s.conceptId),
                ])
                .keys()
            : [],
        ),
      };
      const { summary, issues } = sanitizeSummary(result.output, known);
      const record = {
        ...result.record,
        validationIssues: [...result.record.validationIssues, ...issues].slice(0, 20),
      };
      log.info({ threadId: thread.id, reason, dropped: issues.length }, 'session.summarize stored');
      return { summary: write('ai', summary, record), created: true };
    } catch (e) {
      if (!isAIError(e)) throw e;
      log.warn({ code: e.code, threadId: thread.id, reason }, 'session.summarize failed');
      if (e.code === 'AI_BAD_OUTPUT') {
        return { summary: fallback(e.record ?? null), created: true };
      }
      if (e.record) {
        insertAiCall(orm, {
          id: newId(),
          learnerId: learner.id,
          record: e.record,
          subjectType: 'tutor_thread',
          subjectId: thread.id,
        });
      }
      if (reason === 'manual') throw aiAppError(e);
      return overdue
        ? { summary: fallback(null), created: true }
        : { summary: view, created: false };
    }
  }

  /** The thread's scope concepts, concepts its replies referenced, and the previous summary's. */
  #threadConcepts(
    thread: ThreadRow,
    messages: readonly { metaJson: unknown }[],
    previous: SessionSummaryContent | null,
  ): string[] {
    const repo = this.#deps.content.available ? this.#deps.content.repo : null;
    const ids: string[] = [...(previous?.conceptIds ?? [])];
    if (repo && thread.scopeId && thread.scopeType === 'lesson') {
      ids.push(...(repo.getLesson(thread.scopeId)?.concepts.map((c) => c.id) ?? []));
    }
    if (repo && thread.scopeId && thread.scopeType === 'exercise') {
      ids.push(...(repo.getExercise(thread.scopeId)?.concepts.map((c) => c.conceptId) ?? []));
    }
    for (const m of messages) {
      const meta = m.metaJson === null ? null : tutorReplyMetaSchema.safeParse(m.metaJson);
      if (meta?.success) ids.push(...meta.data.referencedConcepts);
    }
    const unique = [...new Set(ids)];
    const known = repo ? repo.getConcepts(unique) : new Map<string, unknown>();
    return unique.filter((id) => known.has(id)).slice(0, 20);
  }

  /**
   * Background pass: summarizes threads idle for 30 minutes. AI work runs only when the provider
   * is already connected (it is never started for background work), usage is under 80% and no
   * interactive turn is running; otherwise it is deferred, and threads that waited seven days
   * get the deterministic summary.
   */
  async sweep(): Promise<SweepResult> {
    const result: SweepResult = { summarized: 0, fallbacks: 0, deferred: false };
    if (this.#sweeping) return { ...result, deferred: true };
    this.#sweeping = true;
    try {
      const now = this.#deps.now();
      const learner = this.#learner();
      const due = threadsNeedingSummary(this.#deps.userDb.orm, learner.id, {
        idleBefore: now - SUMMARY_IDLE_MS,
        limit: 20,
      });
      if (due.length === 0) return result;
      const snapshot = this.#deps.ai.snapshot();
      const aiReady =
        snapshot.status.state === 'ready' &&
        (snapshot.usage?.highestUsedPercent ?? 0) < BACKGROUND_USAGE_LIMIT &&
        !(this.#deps.interactiveBusy?.() ?? false);
      for (const thread of due) {
        const overdue = now - thread.lastMessageAt >= SUMMARY_FALLBACK_AFTER_MS;
        if (aiReady && result.summarized < SUMMARIES_PER_SWEEP) {
          try {
            const out = await this.summarizeThread(thread.id, 'idle');
            if (out.created) {
              if (out.summary?.source === 'fallback') result.fallbacks++;
              else result.summarized++;
            }
          } catch (err) {
            this.#deps.log.warn({ err, threadId: thread.id }, 'background summary failed');
          }
          continue;
        }
        result.deferred = true;
        if (overdue) {
          const out = await this.summarizeThread(thread.id, 'idle');
          if (out.created) result.fallbacks++;
        }
      }
      return result;
    } finally {
      this.#sweeping = false;
    }
  }

  /** Starts the background sweep (first pass after a minute, then every five minutes). */
  start(intervalMs = SWEEP_INTERVAL_MS): void {
    if (this.#timers.length > 0) return;
    const tick = () => {
      void this.sweep().catch((err: unknown) => {
        this.#deps.log.warn({ err }, 'memory sweep failed');
      });
    };
    this.#timers = [setTimeout(tick, Math.min(60_000, intervalMs)), setInterval(tick, intervalMs)];
    for (const timer of this.#timers) timer.unref();
  }

  stop(): void {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers = [];
  }
}
