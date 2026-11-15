import {
  AIError,
  BASE_INSTRUCTIONS_VERSION,
  errorForStatus,
  instructionsVersion,
  isAIError,
  tutorHint,
  tutorReply,
  type AICallRecord,
  type TaskRunner,
  type TutorReplyInput,
} from '@proginone/ai';
import type {
  AIHintRequest,
  AIHintResponse,
  CancelTutorMessageResponse,
  CreateTutorThreadRequest,
  ErrorCode,
  PostTutorMessageRequest,
  TutorStreamEventName,
  TutorThread,
  TutorThreadDetail,
  TutorThreadList,
  TutorThreadListQuery,
  TutorReplyMeta,
} from '@proginone/shared';
import { TutorContextSource } from '../../ai/context-source.ts';
import { leakGuard } from '../../ai/leak-guard.ts';
import type { ContentExercise } from '../../db/content/repository.ts';
import type { UserDb } from '../../db/user/connection.ts';
import { findItem, insertHintEvent } from '../../db/user/exercise-records.ts';
import { ensureLearner, newId, type Learner } from '../../db/user/learners.ts';
import { getSet, inActiveAssessment } from '../../db/user/practice-sets.ts';
import { getLessonProgress } from '../../db/user/progress.ts';
import {
  findMessage,
  findOpenThread,
  findThread,
  finishTurn,
  insertAiCall,
  insertThread,
  insertTurn,
  listMessages,
  listThreads,
  toMessageView,
  toThreadView,
  type ThreadRow,
} from '../../db/user/tutor.ts';
import { aiAppError, AppError } from '../../http/errors.ts';
import type { Logger } from '../../observability/logger.ts';
import type { AiService } from '../ai/ai-service.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import type { MemoryService } from './memory-service.ts';

/** Shown instead of a reply that kept failing the answer-leak check (docs: 출력 검증). */
export const WITHHELD_REPLY =
  '이 답변은 학습 정책에 따라 숨겨졌습니다. 막혔다면 "힌트 보기"를 눌러 단계별 힌트를 확인해 보세요.';

export interface TutorDeps {
  userDb: UserDb;
  content: ContentAccess;
  runner: TaskRunner;
  ai: AiService;
  now: Clock;
  log: Logger;
  /** Rolling summaries before a long thread is rebuilt (v0.2 long-term memory). */
  memory?: MemoryService;
}

/**
 * A thread rebuilt with more unsummarized messages than the rebuild replays (12) is summarized
 * first, so older messages reach the new provider thread through the summary
 * (docs/design/ai-system.md#sessionsummarize 트리거 "재구성 직전(롤링 요약)").
 */
export const REHYDRATE_SUMMARY_THRESHOLD = 12;

/** Receives the SSE events of one turn. Writes after the client left are ignored by the route. */
export type TurnSink = (event: TutorStreamEventName, data: Record<string, unknown>) => void;

export interface PreparedTurn {
  learnerMessageId: string;
  messageId: string;
  /** Runs the AI turn to the end (also when the client disconnects) and stores the result. */
  run(sink: TurnSink): Promise<void>;
}

interface ExerciseTarget {
  exercise: ContentExercise;
  itemId: string | null;
}

const titleOf = (question: string) => {
  const flat = question.replace(/\s+/g, ' ').trim();
  return flat.length <= 60 ? flat : `${flat.slice(0, 59)}…`;
};

/**
 * Tutor conversations (docs/design/ai-system.md#tutorreply, #스트리밍과-취소) and AI hints
 * (#tutorhint). The service layer decides what the AI may see: the exercise access comes from
 * the hint records (D-010), the assessment lock is checked here, and replies are post-checked
 * against the exercise's leak fingerprints.
 */
export class TutorService {
  readonly #deps: TutorDeps;
  /** Running or queued replies by tutor message ID (cancel). */
  readonly #active = new Map<string, AbortController>();
  /** Per-thread chain: replies in one thread run one after another (docs: 동시성 제어). */
  readonly #chains = new Map<string, Promise<void>>();

  constructor(deps: TutorDeps) {
    this.#deps = deps;
  }

  get activeCount(): number {
    return this.#active.size;
  }

  #learner(): Learner {
    return ensureLearner(this.#deps.userDb);
  }

  #thread(learnerId: string, id: string): ThreadRow {
    const thread = findThread(this.#deps.userDb.orm, learnerId, id);
    if (!thread)
      throw new AppError('NOT_FOUND', 404, '대화를 찾을 수 없습니다.', { details: { id } });
    return thread;
  }

  #source(learner: Learner, itemId: string | null) {
    return new TutorContextSource(this.#deps.userDb, this.#deps.content, {
      learnerId: learner.id,
      timezone: learner.timezone,
      dayStartHour: learner.dayStartHour,
      practiceSetItemId: itemId,
    });
  }

  /**
   * Validates the exercise and practice item; refuses assessments in progress (D-023), by the
   * item or by the exercise itself so a request without the item cannot get around the lock.
   * After the assessment ends its items may be discussed.
   */
  #exerciseTarget(learnerId: string, exerciseId: string, itemId: string | null): ExerciseTarget {
    const exercise = this.#deps.content.repo.getExercise(exerciseId);
    if (!exercise) {
      throw new AppError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.', {
        details: { id: exerciseId },
      });
    }
    if (itemId !== null) {
      const found = findItem(this.#deps.userDb.orm, learnerId, itemId);
      if (found?.item.exerciseId !== exerciseId) {
        throw new AppError('NOT_FOUND', 404, '연습 항목을 찾을 수 없습니다.', {
          details: { practiceSetItemId: itemId },
        });
      }
      if (found.setKind === 'assessment' && found.setStatus === 'active') {
        throw aiAppError(new AIError('AI_LOCKED_IN_ASSESSMENT'));
      }
    }
    if (inActiveAssessment(this.#deps.userDb.orm, learnerId, exerciseId)) {
      throw aiAppError(new AIError('AI_LOCKED_IN_ASSESSMENT'));
    }
    return { exercise, itemId };
  }

  /** Whether the lesson is an assessment unit whose current attempt is still in progress. */
  #assessmentInProgress(learnerId: string, lessonId: string): boolean {
    const orm = this.#deps.userDb.orm;
    const setId = getLessonProgress(orm, learnerId, lessonId)?.practiceSetId ?? null;
    const set = setId === null ? null : getSet(orm, learnerId, setId);
    return set?.row.kind === 'assessment' && set.row.status === 'active';
  }

  // ── Threads ─────────────────────────────────────────────────────────────────

  /** Returns the open thread of the scope, creating it when there is none. */
  createThread(request: CreateTutorThreadRequest): { thread: TutorThread; created: boolean } {
    const learner = this.#learner();
    const scopeId = request.scopeId ?? null;
    if (
      request.scopeType === 'exercise' &&
      scopeId &&
      !this.#deps.content.repo.getExercise(scopeId)
    ) {
      throw new AppError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.', {
        details: { id: scopeId },
      });
    }
    if (request.scopeType === 'lesson' && scopeId && !this.#deps.content.repo.getLesson(scopeId)) {
      throw new AppError('NOT_FOUND', 404, '단원을 찾을 수 없습니다.', {
        details: { id: scopeId },
      });
    }
    const orm = this.#deps.userDb.orm;
    const existing = findOpenThread(orm, learner.id, request.scopeType, scopeId);
    if (existing) return { thread: toThreadView(existing), created: false };
    const now = new Date(this.#deps.now());
    const row = insertThread(orm, {
      id: newId(),
      learnerId: learner.id,
      scopeType: request.scopeType,
      scopeId,
      provider: this.#deps.runner.provider.id,
      createdAt: now,
      lastMessageAt: now,
    });
    return { thread: toThreadView(row), created: true };
  }

  listThreads(query: TutorThreadListQuery): TutorThreadList {
    const learner = this.#learner();
    const { rows, nextCursor } = listThreads(this.#deps.userDb.orm, learner.id, query);
    return { threads: rows.map(toThreadView), nextCursor };
  }

  detail(threadId: string): TutorThreadDetail {
    const learner = this.#learner();
    const thread = this.#thread(learner.id, threadId);
    return {
      thread: toThreadView(thread),
      messages: listMessages(this.#deps.userDb.orm, thread.id).map(toMessageView),
    };
  }

  // ── tutor.reply ─────────────────────────────────────────────────────────────

  /**
   * Validates a question and stores it with a `streaming` reply placeholder. Errors here are
   * plain HTTP errors (nothing is stored); after this the turn reports through SSE.
   */
  async prepareMessage(threadId: string, request: PostTutorMessageRequest): Promise<PreparedTurn> {
    const learner = this.#learner();
    const thread = this.#thread(learner.id, threadId);
    const exerciseId =
      request.exerciseId ?? (thread.scopeType === 'exercise' ? thread.scopeId : null);
    const target = exerciseId
      ? this.#exerciseTarget(learner.id, exerciseId, request.practiceSetItemId ?? null)
      : null;
    const lessonId =
      request.lessonId ??
      (thread.scopeType === 'lesson' ? thread.scopeId : null) ??
      target?.exercise.lessonId ??
      null;
    if (lessonId && !this.#deps.content.repo.getLesson(lessonId)) {
      throw new AppError('NOT_FOUND', 404, '단원을 찾을 수 없습니다.', {
        details: { id: lessonId },
      });
    }
    if (lessonId && this.#assessmentInProgress(learner.id, lessonId)) {
      throw aiAppError(new AIError('AI_LOCKED_IN_ASSESSMENT'));
    }
    await this.#deps.ai.ensureReady();

    const source = this.#source(learner, target?.itemId ?? null);
    const access = target ? source.recordedAccess(target.exercise.id) : null;
    const now = new Date(this.#deps.now());
    const learnerMessageId = newId();
    const messageId = newId();
    insertTurn(this.#deps.userDb.orm, {
      thread,
      title: titleOf(request.question),
      now,
      learnerMessage: {
        id: learnerMessageId,
        threadId: thread.id,
        role: 'learner',
        content: request.question,
        attachmentsJson: request.selection ? [{ type: 'selection', ...request.selection }] : [],
        status: 'complete',
        createdAt: now,
      },
      tutorMessage: {
        id: messageId,
        threadId: thread.id,
        role: 'tutor',
        content: '',
        status: 'streaming',
        taskName: tutorReply.name,
        taskVersion: tutorReply.version,
        createdAt: new Date(now.getTime() + 1),
      },
    });

    const input: TutorReplyInput = {
      threadId: thread.id,
      question: request.question,
      entryPoint: request.entryPoint,
      excludeMessageIds: [learnerMessageId, messageId],
      ...(request.selection ? { selection: request.selection } : {}),
      ...(lessonId ? { lessonId } : {}),
      ...(target && access ? { exerciseId: target.exercise.id, access } : {}),
      ...(request.currentCode ? { currentCode: request.currentCode } : {}),
      ...(request.lastRunResult ? { lastRunResult: request.lastRunResult } : {}),
    };
    const guard =
      target && access && !access.solutionViewed
        ? leakGuard(target.exercise.leakFingerprints)
        : null;
    const controller = new AbortController();
    this.#active.set(messageId, controller);

    return {
      learnerMessageId,
      messageId,
      run: (sink) =>
        this.#runTurn({
          learner,
          thread,
          messageId,
          learnerMessageId,
          input,
          source,
          guard,
          controller,
          sink,
        }),
    };
  }

  async #runTurn(turn: {
    learner: Learner;
    thread: ThreadRow;
    messageId: string;
    learnerMessageId: string;
    input: TutorReplyInput;
    source: TutorContextSource;
    guard: ReturnType<typeof leakGuard>;
    controller: AbortController;
    sink: TurnSink;
  }): Promise<void> {
    const { thread, messageId, sink } = turn;
    const send: TurnSink = (event, data) => {
      try {
        sink(event, data);
      } catch {
        // The client left; the turn still completes and is stored.
      }
    };
    send('message.created', {
      learnerMessageId: turn.learnerMessageId,
      messageId,
      role: 'tutor',
      taskName: tutorReply.name,
      taskVersion: tutorReply.version,
    });

    // Serialize replies within a thread.
    const previous = this.#chains.get(thread.id);
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = (previous ?? Promise.resolve()).then(() => mine);
    this.#chains.set(thread.id, chained);
    try {
      if (previous) {
        send('status', { messageId, state: 'queued', position: null });
        await previous;
      }
      // Re-read the thread: a previous turn may have cached a provider thread.
      const fresh = findThread(this.#deps.userDb.orm, turn.learner.id, thread.id) ?? thread;
      await this.#reply({ ...turn, thread: fresh, send });
    } finally {
      this.#active.delete(messageId);
      release();
      if (this.#chains.get(thread.id) === chained) this.#chains.delete(thread.id);
    }
  }

  async #reply(turn: {
    learner: Learner;
    thread: ThreadRow;
    messageId: string;
    input: TutorReplyInput;
    source: TutorContextSource;
    guard: ReturnType<typeof leakGuard>;
    controller: AbortController;
    send: TurnSink;
  }): Promise<void> {
    const { learner, thread, messageId, send, controller } = turn;
    const orm = this.#deps.userDb.orm;
    const runner = this.#deps.runner;
    const finish = (opts: {
      status: 'complete' | 'withheld' | 'cancelled' | 'failed';
      content: string;
      meta: TutorReplyMeta | null;
      record: AICallRecord | null;
      providerThread?: { id: string; model: string | null; instructionsVersion: string } | null;
    }) => {
      finishTurn(orm, {
        learnerId: learner.id,
        threadId: thread.id,
        messageId,
        status: opts.status,
        content: opts.content,
        meta: opts.meta,
        aiCall: opts.record ? { id: newId(), record: opts.record } : null,
        ...(opts.providerThread !== undefined
          ? { providerThread: opts.providerThread, provider: runner.provider.id }
          : {}),
        now: new Date(this.#deps.now()),
      });
    };

    if (controller.signal.aborted) {
      finish({ status: 'cancelled', content: '', meta: null, record: null });
      send('done', { messageId, status: 'cancelled', content: '', meta: null, usage: null });
      return;
    }
    const cached =
      thread.providerThreadId &&
      thread.provider === runner.provider.id &&
      thread.providerInstructionsVersion
        ? {
            id: thread.providerThreadId,
            model: thread.providerModel,
            instructionsVersion: thread.providerInstructionsVersion,
          }
        : null;
    const iv = instructionsVersion(tutorReply, BASE_INSTRUCTIONS_VERSION);
    const memory = this.#deps.memory;
    if (
      memory &&
      cached?.instructionsVersion !== iv &&
      memory.unsummarizedCount(learner.id, thread.id) > REHYDRATE_SUMMARY_THRESHOLD + 2
    ) {
      await memory
        .summarizeThread(thread.id, 'rehydrate', {
          excludeMessageIds: turn.input.excludeMessageIds,
        })
        .catch((err: unknown) => {
          this.#deps.log.warn(
            { err, threadId: thread.id },
            'rolling summary before rebuild failed',
          );
        });
    }
    try {
      const result = await runner.run(tutorReply, turn.input, {
        source: turn.source,
        signal: controller.signal,
        providerThread: cached,
        ...(turn.guard ? { guard: turn.guard } : {}),
        onQueued: (position) => {
          send('status', { messageId, state: 'queued', position });
        },
        onStarted: () => {
          send('status', { messageId, state: 'running', position: null });
        },
        onDelta: (text) => {
          send('delta', { messageId, text });
        },
        onReset: () => {
          send('reset', { messageId });
        },
      });
      const usage =
        result.record.inputTokens !== null && result.record.outputTokens !== null
          ? { inputTokens: result.record.inputTokens, outputTokens: result.record.outputTokens }
          : null;
      if (result.status === 'withheld' || !result.output) {
        this.#deps.log.warn({ messageId }, 'tutor.reply withheld by output checks');
        finish({
          status: 'withheld',
          content: WITHHELD_REPLY,
          meta: null,
          record: result.record,
          providerThread: result.providerThread,
        });
        send('done', { messageId, status: 'withheld', content: WITHHELD_REPLY, meta: null, usage });
        return;
      }
      const meta = this.#filterMeta(result.output.meta);
      finish({
        status: 'complete',
        content: result.text,
        meta,
        record: result.record,
        providerThread: result.providerThread,
      });
      send('done', { messageId, status: 'complete', content: result.text, meta, usage });
    } catch (e) {
      if (isAIError(e) && e.code === 'AI_CANCELLED') {
        finish({
          status: 'cancelled',
          content: e.partialText,
          meta: null,
          record: e.record ?? null,
        });
        send('done', {
          messageId,
          status: 'cancelled',
          content: e.partialText,
          meta: null,
          usage: null,
        });
        return;
      }
      const appError = isAIError(e)
        ? aiAppError(e)
        : new AppError('INTERNAL', 500, '예기치 않은 오류가 발생했습니다.');
      if (!isAIError(e)) this.#deps.log.error({ err: e, messageId }, 'tutor.reply failed');
      else this.#deps.log.warn({ code: e.code, messageId }, 'tutor.reply failed');
      try {
        finish({
          status: 'failed',
          content: isAIError(e) ? e.partialText : '',
          meta: null,
          record: isAIError(e) ? (e.record ?? null) : null,
          // A lost or broken provider thread is rebuilt next time.
          ...(isAIError(e) && e.threadLost ? { providerThread: null } : {}),
        });
      } catch (storeError) {
        this.#deps.log.error({ err: storeError, messageId }, 'tutor.reply could not be stored');
      }
      send('error', {
        messageId,
        code: appError.code,
        message: appError.message,
        retryable: appError.retryable,
        ...(appError.details ? { details: appError.details } : {}),
      });
    }
  }

  /** Drops concept IDs the content pack does not have (docs: 후처리 검증). */
  #filterMeta(meta: TutorReplyMeta | null): TutorReplyMeta | null {
    if (!meta) return null;
    const known = this.#deps.content.repo.getConcepts(meta.referencedConcepts);
    return { ...meta, referencedConcepts: meta.referencedConcepts.filter((id) => known.has(id)) };
  }

  cancel(threadId: string, messageId: string): CancelTutorMessageResponse {
    const learner = this.#learner();
    const thread = this.#thread(learner.id, threadId);
    const message = findMessage(this.#deps.userDb.orm, thread.id, messageId);
    if (message?.role !== 'tutor') {
      throw new AppError('NOT_FOUND', 404, '메시지를 찾을 수 없습니다.', {
        details: { messageId },
      });
    }
    const controller = this.#active.get(messageId);
    if (!controller || controller.signal.aborted) return { messageId, cancelled: false };
    controller.abort();
    return { messageId, cancelled: true };
  }

  /** Cancels every running reply (shutdown). */
  cancelAll(): void {
    for (const controller of this.#active.values()) controller.abort();
  }

  // ── tutor.hint ──────────────────────────────────────────────────────────────

  /**
   * A personalized version of the hint level already opened. Falls back to the authored hint
   * whenever AI is unavailable or its hint fails validation, so it never blocks learning.
   */
  async aiHint(exerciseId: string, request: AIHintRequest): Promise<AIHintResponse> {
    const learner = this.#learner();
    const target = this.#exerciseTarget(learner.id, exerciseId, request.practiceSetItemId ?? null);
    const source = this.#source(learner, target.itemId);
    const access = source.recordedAccess(exerciseId);
    if (access.hintLevel === 0) {
      throw new AppError(
        'EXERCISE_HINT_REQUIRED',
        409,
        '먼저 힌트를 연 뒤에 AI에게 맞춤 힌트를 받을 수 있습니다.',
      );
    }
    const level = access.hintLevel;
    const authored = target.exercise.hints.levels[level - 1] ?? '';
    const fallback = (code: ErrorCode): AIHintResponse => ({
      level,
      hintMarkdown: authored,
      focusLine: null,
      checkQuestion: null,
      source: 'authored',
      fallbackCode: code,
    });

    const statusError = errorForStatus(await this.#deps.ai.provider.connect());
    if (statusError) return fallback(statusError.code);

    const orm = this.#deps.userDb.orm;
    const store = (record: AICallRecord, hintEventId: string | null) => {
      orm.transaction(() => {
        if (hintEventId) {
          insertHintEvent(orm, {
            id: hintEventId,
            learnerId: learner.id,
            exerciseId,
            practiceSetItemId: target.itemId,
            kind: 'ai_hint',
            level,
            createdAt: new Date(this.#deps.now()),
          });
        }
        insertAiCall(orm, {
          id: newId(),
          learnerId: learner.id,
          record,
          subjectType: hintEventId ? 'hint_event' : null,
          subjectId: hintEventId ?? exerciseId,
        });
      });
    };
    const guard = access.solutionViewed ? null : leakGuard(target.exercise.leakFingerprints);
    try {
      const result = await this.#deps.runner.run(
        tutorHint,
        {
          exerciseId,
          level,
          access: { hintLevel: level, solutionViewed: access.solutionViewed },
          ...(request.currentCode ? { currentCode: request.currentCode } : {}),
          ...(request.lastAnswer ? { lastAnswer: request.lastAnswer } : {}),
          ...(request.lastRunResult ? { lastRunResult: request.lastRunResult } : {}),
        },
        { source, ...(guard ? { guard } : {}) },
      );
      if (result.status !== 'ok' || !result.output) {
        store({ ...result.record, status: 'fallback' }, null);
        return fallback('AI_BAD_OUTPUT');
      }
      store(result.record, newId());
      return {
        level,
        hintMarkdown: result.output.hintMarkdown,
        focusLine: result.output.focusLine,
        checkQuestion: result.output.checkQuestion,
        source: 'ai',
        fallbackCode: null,
      };
    } catch (e) {
      if (!isAIError(e)) throw e;
      if (e.record)
        store(
          { ...e.record, status: e.code === 'AI_BAD_OUTPUT' ? 'fallback' : e.record.status },
          null,
        );
      this.#deps.log.warn(
        { code: e.code, exerciseId },
        'tutor.hint fell back to the authored hint',
      );
      return fallback(e.code);
    }
  }
}
