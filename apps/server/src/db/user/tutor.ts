import type { AICallRecord } from '@proginone/ai';
import {
  tutorReplyMetaSchema,
  type AICall,
  type TutorMessage,
  type TutorReplyMeta,
  type TutorScopeType,
  type TutorThread,
} from '@proginone/shared';
import { and, asc, desc, eq, gt, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Orm } from './connection.ts';
import { forWrite } from './json-io.ts';
import { aiCalls, tutorMessages, tutorThreads, type AI_CALL_SUBJECT_TYPES } from './schema.ts';

// Tutor conversations and AI call records (docs/design/data-model.md#트랜잭션-경계 "튜터 메시지
// 완료": tutor_messages, tutor_threads and ai_calls in one transaction).

export type ThreadRow = typeof tutorThreads.$inferSelect;
export type MessageRow = typeof tutorMessages.$inferSelect;
export type AICallSubjectType = (typeof AI_CALL_SUBJECT_TYPES)[number];

const manifestJson = z
  .array(
    z.object({
      kind: z.string().max(60),
      ref: z.string().max(200).nullable(),
      estimatedTokens: z.int().min(0),
      truncated: z.boolean(),
      included: z.boolean(),
    }),
  )
  .max(50);
const issuesJson = z
  .array(z.object({ rule: z.string().max(60), message: z.string().max(500) }))
  .max(50);
const metaJson = tutorReplyMetaSchema;

export function toThreadView(row: ThreadRow): TutorThread {
  return {
    id: row.id,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    title: row.title,
    status: row.status,
    messageCount: row.messageCount,
    createdAt: row.createdAt.getTime(),
    lastMessageAt: row.lastMessageAt.getTime(),
  };
}

export function toMessageView(row: MessageRow): TutorMessage {
  const meta = row.metaJson === null ? null : metaJson.safeParse(row.metaJson);
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    status: row.status,
    taskName: row.taskName,
    taskVersion: row.taskVersion,
    // A corrupt meta block is dropped, not fatal: it never affects the answer text.
    meta: meta?.success ? meta.data : null,
    createdAt: row.createdAt.getTime(),
  };
}

export function insertThread(orm: Orm, row: typeof tutorThreads.$inferInsert): ThreadRow {
  return orm.insert(tutorThreads).values(row).returning().get();
}

export function findThread(orm: Orm, learnerId: string, id: string): ThreadRow | null {
  return (
    orm
      .select()
      .from(tutorThreads)
      .where(
        and(
          eq(tutorThreads.id, id),
          eq(tutorThreads.learnerId, learnerId),
          isNull(tutorThreads.archivedAt),
        ),
      )
      .get() ?? null
  );
}

/** The most recent open thread of a scope. */
export function findOpenThread(
  orm: Orm,
  learnerId: string,
  scopeType: TutorScopeType,
  scopeId: string | null,
): ThreadRow | null {
  return (
    orm
      .select()
      .from(tutorThreads)
      .where(
        and(
          eq(tutorThreads.learnerId, learnerId),
          eq(tutorThreads.scopeType, scopeType),
          scopeId === null ? isNull(tutorThreads.scopeId) : eq(tutorThreads.scopeId, scopeId),
          eq(tutorThreads.status, 'open'),
          isNull(tutorThreads.archivedAt),
        ),
      )
      .orderBy(desc(tutorThreads.lastMessageAt), desc(tutorThreads.id))
      .get() ?? null
  );
}

/** Threads by recency; the cursor is the last thread ID of the previous page. */
export function listThreads(
  orm: Orm,
  learnerId: string,
  query: {
    scopeType?: TutorScopeType | undefined;
    scopeId?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
): { rows: ThreadRow[]; nextCursor: string | null } {
  const after = query.cursor ? findThread(orm, learnerId, query.cursor) : null;
  const rows = orm
    .select()
    .from(tutorThreads)
    .where(
      and(
        eq(tutorThreads.learnerId, learnerId),
        isNull(tutorThreads.archivedAt),
        query.scopeType ? eq(tutorThreads.scopeType, query.scopeType) : undefined,
        query.scopeId ? eq(tutorThreads.scopeId, query.scopeId) : undefined,
        after
          ? or(
              lt(tutorThreads.lastMessageAt, after.lastMessageAt),
              and(
                eq(tutorThreads.lastMessageAt, after.lastMessageAt),
                lt(tutorThreads.id, after.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(tutorThreads.lastMessageAt), desc(tutorThreads.id))
    .limit(query.limit + 1)
    .all();
  const page = rows.slice(0, query.limit);
  return { rows: page, nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null };
}

export function listMessages(orm: Orm, threadId: string): MessageRow[] {
  return orm
    .select()
    .from(tutorMessages)
    .where(eq(tutorMessages.threadId, threadId))
    .orderBy(asc(tutorMessages.createdAt), asc(tutorMessages.id))
    .all();
}

/**
 * The last `limit` messages with content worth replaying when a provider thread is rebuilt
 * (complete and cancelled replies; failed and withheld ones are skipped), oldest first.
 */
export function recentMessages(
  orm: Orm,
  threadId: string,
  limit: number,
  excludeIds: readonly string[],
  /** Only messages created after this (epoch ms): the part a summary does not cover yet. */
  after?: number,
): MessageRow[] {
  return orm
    .select()
    .from(tutorMessages)
    .where(
      and(
        eq(tutorMessages.threadId, threadId),
        inArray(tutorMessages.status, ['complete', 'cancelled']),
        excludeIds.length > 0 ? notInArray(tutorMessages.id, [...excludeIds]) : undefined,
        after !== undefined ? gt(tutorMessages.createdAt, new Date(after)) : undefined,
      ),
    )
    .orderBy(desc(tutorMessages.createdAt), desc(tutorMessages.id))
    .limit(limit)
    .all()
    .reverse();
}

export function findMessage(orm: Orm, threadId: string, id: string): MessageRow | null {
  return (
    orm
      .select()
      .from(tutorMessages)
      .where(and(eq(tutorMessages.id, id), eq(tutorMessages.threadId, threadId)))
      .get() ?? null
  );
}

export interface NewTurn {
  thread: ThreadRow;
  learnerMessage: typeof tutorMessages.$inferInsert;
  tutorMessage: typeof tutorMessages.$inferInsert;
  title: string;
  now: Date;
}

/** Stores the question and the `streaming` reply placeholder (one transaction). */
export function insertTurn(orm: Orm, turn: NewTurn): void {
  orm.transaction(() => {
    orm.insert(tutorMessages).values(turn.learnerMessage).run();
    orm.insert(tutorMessages).values(turn.tutorMessage).run();
    orm
      .update(tutorThreads)
      .set({
        messageCount: sql`${tutorThreads.messageCount} + 2`,
        lastMessageAt: turn.now,
        ...(turn.thread.title === '' ? { title: turn.title } : {}),
      })
      .where(eq(tutorThreads.id, turn.thread.id))
      .run();
  });
}

export function insertAiCall(
  orm: Orm,
  row: {
    id: string;
    learnerId: string;
    record: AICallRecord;
    subjectType: AICallSubjectType | null;
    subjectId: string | null;
  },
): void {
  const r = row.record;
  orm
    .insert(aiCalls)
    .values({
      id: row.id,
      learnerId: row.learnerId,
      taskName: r.taskName,
      taskVersion: r.taskVersion,
      baseVersion: r.baseVersion,
      provider: r.provider,
      model: r.model,
      effort: r.effort,
      providerThreadId: r.providerThreadId,
      providerTurnId: r.providerTurnId,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      status: r.status,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      retries: r.retries,
      latencyFirstTokenMs: r.latencyFirstTokenMs,
      latencyTotalMs: r.latencyTotalMs,
      inputTokens: r.inputTokens,
      cachedInputTokens: r.cachedInputTokens,
      outputTokens: r.outputTokens,
      reasoningTokens: r.reasoningTokens,
      contextTokensEstimated: r.contextTokensEstimated,
      contextManifestJson: forWrite(
        manifestJson,
        r.contextManifest,
        'ai_calls.context_manifest_json',
      ),
      toolAttempts: r.toolAttempts,
      validationIssuesJson: forWrite(
        issuesJson,
        r.validationIssues,
        'ai_calls.validation_issues_json',
      ),
      createdAt: new Date(r.createdAt),
    })
    .run();
}

export interface FinishTurn {
  learnerId: string;
  threadId: string;
  messageId: string;
  status: MessageRow['status'];
  content: string;
  meta: TutorReplyMeta | null;
  aiCall: { id: string; record: AICallRecord } | null;
  /** Provider thread to cache, `undefined` to keep the current one. */
  providerThread?: { id: string; model: string | null; instructionsVersion: string } | null;
  /** Provider that owns `providerThread`. */
  provider?: string;
  now: Date;
}

/** "튜터 메시지 완료": the reply, its AI call and the thread in one transaction. */
export function finishTurn(orm: Orm, turn: FinishTurn): void {
  orm.transaction(() => {
    if (turn.aiCall) {
      insertAiCall(orm, {
        id: turn.aiCall.id,
        learnerId: turn.learnerId,
        record: turn.aiCall.record,
        subjectType: 'tutor_message',
        subjectId: turn.messageId,
      });
    }
    orm
      .update(tutorMessages)
      .set({
        status: turn.status,
        content: turn.content,
        metaJson:
          turn.meta === null ? null : forWrite(metaJson, turn.meta, 'tutor_messages.meta_json'),
        aiCallId: turn.aiCall?.id ?? null,
        model: turn.aiCall?.record.model ?? null,
      })
      .where(eq(tutorMessages.id, turn.messageId))
      .run();
    orm
      .update(tutorThreads)
      .set({
        lastMessageAt: turn.now,
        ...(turn.providerThread !== undefined
          ? {
              providerThreadId: turn.providerThread?.id ?? null,
              providerModel: turn.providerThread?.model ?? null,
              providerInstructionsVersion: turn.providerThread?.instructionsVersion ?? null,
              ...(turn.provider ? { provider: turn.provider } : {}),
            }
          : {}),
      })
      .where(eq(tutorThreads.id, turn.threadId))
      .run();
  });
}

/**
 * Startup cleanup (docs/design/system-architecture.md#앱-시작-절차): replies left `streaming` by an
 * abnormal exit become `interrupted`. Returns how many were changed.
 */
export function markInterruptedMessages(orm: Orm): number {
  return orm
    .update(tutorMessages)
    .set({ status: 'interrupted' })
    .where(eq(tutorMessages.status, 'streaming'))
    .run().changes;
}

/** Recent `ai_calls` rows, newest first (`GET /ai/calls`). Corrupt JSON columns read as empty. */
export function listAiCalls(
  orm: Orm,
  learnerId: string,
  query: { limit: number; taskName?: string | undefined },
): AICall[] {
  return orm
    .select()
    .from(aiCalls)
    .where(
      and(
        eq(aiCalls.learnerId, learnerId),
        query.taskName ? eq(aiCalls.taskName, query.taskName) : undefined,
      ),
    )
    .orderBy(desc(aiCalls.createdAt), desc(aiCalls.id))
    .limit(query.limit)
    .all()
    .map((r) => {
      const issues = issuesJson.safeParse(r.validationIssuesJson);
      return {
        id: r.id,
        createdAt: r.createdAt.getTime(),
        taskName: r.taskName,
        taskVersion: r.taskVersion,
        baseVersion: r.baseVersion,
        provider: r.provider,
        model: r.model,
        effort: r.effort,
        status: r.status,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        retries: r.retries,
        latencyFirstTokenMs: r.latencyFirstTokenMs,
        latencyTotalMs: r.latencyTotalMs,
        inputTokens: r.inputTokens,
        cachedInputTokens: r.cachedInputTokens,
        outputTokens: r.outputTokens,
        reasoningTokens: r.reasoningTokens,
        contextTokensEstimated: r.contextTokensEstimated,
        toolAttempts: r.toolAttempts,
        validationIssues: issues.success ? issues.data : [],
        subjectType: r.subjectType,
        subjectId: r.subjectId,
      };
    });
}
