import type { AICallRecord } from '@proginone/ai';
import {
  sessionSummaryContentSchema,
  type SessionSummary,
  type SessionSummaryContent,
} from '@proginone/shared';
import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Orm } from './connection.ts';
import { stringListJson } from './json.ts';
import { forWrite, fromRow } from './json-io.ts';
import { sessionSummaries, sessionSummaryConcepts, tutorMessages, tutorThreads } from './schema.ts';
import { insertAiCall } from './tutor.ts';

// session_summaries and session_summary_concepts (docs/design/data-model.md
// #tutor_threads-tutor_messages-session_summaries). Summaries are rolling per thread: the newest
// one covers the whole conversation so far and `tutor_threads.summary_id` points at it, so
// lookups for long-term memory only read the current summary of each thread.

export type SummaryRow = typeof sessionSummaries.$inferSelect;

export function toSummaryView(row: SummaryRow): SessionSummary {
  return {
    id: row.id,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    source: row.source,
    content: fromRow(sessionSummaryContentSchema, row.summaryJson, 'session_summaries', row.id),
    messageCount: row.messageCount,
    coveredUntil: row.coveredUntil.getTime(),
    createdAt: row.createdAt.getTime(),
  };
}

/** The thread's current summary (`tutor_threads.summary_id`). */
export function threadSummary(orm: Orm, learnerId: string, threadId: string): SummaryRow | null {
  const row = orm
    .select({ summary: sessionSummaries })
    .from(tutorThreads)
    .innerJoin(sessionSummaries, eq(sessionSummaries.id, tutorThreads.summaryId))
    .where(and(eq(tutorThreads.id, threadId), eq(tutorThreads.learnerId, learnerId)))
    .get();
  return row?.summary ?? null;
}

export interface NewSummary {
  id: string;
  learnerId: string;
  threadId: string;
  source: SummaryRow['source'];
  content: SessionSummaryContent;
  messageCount: number;
  coveredUntil: number;
  aiCall: { id: string; record: AICallRecord } | null;
  createdAt: number;
}

/** Stores a thread summary, its concepts and AI call, and points the thread at it. */
export function insertThreadSummary(orm: Orm, summary: NewSummary): SummaryRow {
  return orm.transaction(() => {
    if (summary.aiCall) {
      insertAiCall(orm, {
        id: summary.aiCall.id,
        learnerId: summary.learnerId,
        record: summary.aiCall.record,
        subjectType: 'tutor_thread',
        subjectId: summary.threadId,
      });
    }
    const conceptIds = [...new Set(summary.content.conceptIds)];
    const row = orm
      .insert(sessionSummaries)
      .values({
        id: summary.id,
        learnerId: summary.learnerId,
        scopeType: 'tutor_thread',
        scopeId: summary.threadId,
        source: summary.source,
        summaryJson: forWrite(
          sessionSummaryContentSchema,
          summary.content,
          'session_summaries.summary_json',
        ),
        conceptIdsJson: forWrite(stringListJson, conceptIds, 'session_summaries.concept_ids_json'),
        messageCount: summary.messageCount,
        coveredUntil: new Date(summary.coveredUntil),
        aiCallId: summary.aiCall?.id ?? null,
        createdAt: new Date(summary.createdAt),
      })
      .returning()
      .get();
    if (conceptIds.length > 0) {
      orm
        .insert(sessionSummaryConcepts)
        .values(conceptIds.map((conceptId) => ({ summaryId: summary.id, conceptId })))
        .run();
    }
    orm
      .update(tutorThreads)
      .set({ summaryId: summary.id })
      .where(eq(tutorThreads.id, summary.threadId))
      .run();
    return row;
  });
}

/**
 * Current summaries of other threads that share concepts, ranked as in
 * docs/design/ai-system.md#개념-id-기반-검색: shared concepts, then whether the learner struggled,
 * then the newest. Without concepts (general questions) the newest summaries are returned.
 */
export function pastSummaries(
  orm: Orm,
  learnerId: string,
  conceptIds: readonly string[],
  opts: { limit: number; excludeThreadId: string | null },
): SummaryRow[] {
  const current = and(
    eq(tutorThreads.learnerId, learnerId),
    isNull(tutorThreads.archivedAt),
    opts.excludeThreadId ? ne(tutorThreads.id, opts.excludeThreadId) : undefined,
  );
  if (conceptIds.length === 0) {
    return orm
      .select({ summary: sessionSummaries })
      .from(tutorThreads)
      .innerJoin(sessionSummaries, eq(sessionSummaries.id, tutorThreads.summaryId))
      .where(current)
      .orderBy(desc(sessionSummaries.createdAt), desc(sessionSummaries.id))
      .limit(opts.limit)
      .all()
      .map((r) => r.summary);
  }
  const overlap = sql<number>`count(${sessionSummaryConcepts.conceptId})`;
  const ranked = orm
    .select({ summary: sessionSummaries, overlap })
    .from(tutorThreads)
    .innerJoin(sessionSummaries, eq(sessionSummaries.id, tutorThreads.summaryId))
    .innerJoin(sessionSummaryConcepts, eq(sessionSummaryConcepts.summaryId, sessionSummaries.id))
    .where(and(current, inArray(sessionSummaryConcepts.conceptId, [...new Set(conceptIds)])))
    .groupBy(sessionSummaries.id)
    .all();
  const struggled = (row: SummaryRow) => {
    const parsed = sessionSummaryContentSchema.safeParse(row.summaryJson);
    return parsed.success && parsed.data.struggles.length > 0 ? 1 : 0;
  };
  return ranked
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        struggled(b.summary) - struggled(a.summary) ||
        b.summary.createdAt.getTime() - a.summary.createdAt.getTime() ||
        (a.summary.id < b.summary.id ? 1 : -1),
    )
    .slice(0, opts.limit)
    .map((r) => r.summary);
}

/**
 * Threads with replies newer than their current summary and no message since `idleBefore`
 * (docs: 튜터 스레드 비활성 30분), oldest activity first.
 */
export function threadsNeedingSummary(
  orm: Orm,
  learnerId: string,
  opts: { idleBefore: number; limit: number },
): { id: string; lastMessageAt: number }[] {
  const covered = sql`coalesce(${sessionSummaries.coveredUntil}, 0)`;
  return orm
    .select({ id: tutorThreads.id, lastMessageAt: tutorThreads.lastMessageAt })
    .from(tutorThreads)
    .leftJoin(sessionSummaries, eq(sessionSummaries.id, tutorThreads.summaryId))
    .where(
      and(
        eq(tutorThreads.learnerId, learnerId),
        isNull(tutorThreads.archivedAt),
        lt(tutorThreads.lastMessageAt, new Date(opts.idleBefore)),
        sql`exists (select 1 from ${tutorMessages} where ${tutorMessages.threadId} = ${tutorThreads.id} and ${tutorMessages.role} = 'tutor' and ${tutorMessages.status} = 'complete' and ${tutorMessages.createdAt} > ${covered})`,
      ),
    )
    .orderBy(tutorThreads.lastMessageAt)
    .limit(opts.limit)
    .all()
    .map((r) => ({ id: r.id, lastMessageAt: r.lastMessageAt.getTime() }));
}

/** Conversation messages after `after` worth summarizing (complete or cancelled), oldest first. */
export function messagesSince(
  orm: Orm,
  threadId: string,
  after: number,
): (typeof tutorMessages.$inferSelect)[] {
  return orm
    .select()
    .from(tutorMessages)
    .where(
      and(
        eq(tutorMessages.threadId, threadId),
        inArray(tutorMessages.status, ['complete', 'cancelled']),
        gt(tutorMessages.createdAt, new Date(after)),
      ),
    )
    .orderBy(tutorMessages.createdAt, tutorMessages.id)
    .all();
}
