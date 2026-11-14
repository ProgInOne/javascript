import { z } from 'zod';
import {
  tutorCodeFilesSchema,
  tutorEntryPointSchema,
  tutorReplyMetaSchema,
  tutorRunSummarySchema,
  tutorSelectionSchema,
} from './ai.ts';
import { errorCodeSchema } from './errors.ts';

// Tutor API contract (docs/design/system-architecture.md#api-규약 "튜터", docs/design/ai-system.md
// #스트리밍과-취소) and the enums of the user.db tutor tables (docs/design/data-model.md
// #tutor_threads-tutor_messages-session_summaries).

export const TUTOR_SCOPE_TYPES = ['lesson', 'exercise', 'review', 'general'] as const;
export const TUTOR_THREAD_STATUSES = ['open', 'closed'] as const;
export const TUTOR_MESSAGE_ROLES = ['learner', 'tutor', 'system_event'] as const;
/**
 * `streaming` while a reply is being generated; `cancelled` the learner stopped it; `interrupted`
 * the app stopped abnormally (set at the next start); `failed` the AI call failed; `withheld` the
 * reply failed a policy check (answer leak) and was replaced.
 */
export const TUTOR_MESSAGE_STATUSES = [
  'streaming',
  'complete',
  'cancelled',
  'interrupted',
  'failed',
  'withheld',
] as const;

export const tutorScopeTypeSchema = z.enum(TUTOR_SCOPE_TYPES);
export type TutorScopeType = z.infer<typeof tutorScopeTypeSchema>;
export const tutorMessageStatusSchema = z.enum(TUTOR_MESSAGE_STATUSES);
export type TutorMessageStatus = z.infer<typeof tutorMessageStatusSchema>;

const contentId = z.string().min(1).max(200);

/**
 * `POST /tutor/threads`. Lesson and exercise threads need `scopeId`. An open thread of the same
 * scope is returned instead of creating another (one conversation per lesson or exercise).
 */
export const createTutorThreadRequestSchema = z
  .object({
    scopeType: tutorScopeTypeSchema,
    scopeId: contentId.optional(),
  })
  .strict()
  .refine((r) => (r.scopeType === 'lesson' || r.scopeType === 'exercise') === !!r.scopeId, {
    message: 'lesson·exercise 스레드에만 scopeId가 필요합니다.',
    path: ['scopeId'],
  });
export type CreateTutorThreadRequest = z.infer<typeof createTutorThreadRequestSchema>;

export const tutorThreadSchema = z.object({
  id: z.string(),
  scopeType: tutorScopeTypeSchema,
  scopeId: z.string().nullable(),
  /** From the first question; empty until then. */
  title: z.string(),
  status: z.enum(TUTOR_THREAD_STATUSES),
  messageCount: z.int().min(0),
  createdAt: z.number(),
  lastMessageAt: z.number(),
});
export type TutorThread = z.infer<typeof tutorThreadSchema>;

export const tutorMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  role: z.enum(TUTOR_MESSAGE_ROLES),
  /** Markdown (render with raw HTML disabled; AI output is untrusted). */
  content: z.string(),
  status: tutorMessageStatusSchema,
  taskName: z.string().nullable(),
  taskVersion: z.int().nullable(),
  meta: tutorReplyMetaSchema.nullable(),
  createdAt: z.number(),
});
export type TutorMessage = z.infer<typeof tutorMessageSchema>;

/** `GET /tutor/threads?scopeType=&scopeId=&cursor=&limit=`: most recent first. */
export const tutorThreadListQuerySchema = z
  .object({
    scopeType: tutorScopeTypeSchema.optional(),
    scopeId: contentId.optional(),
    cursor: z.string().max(64).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type TutorThreadListQuery = z.infer<typeof tutorThreadListQuerySchema>;

export const tutorThreadListSchema = z.object({
  threads: z.array(tutorThreadSchema),
  nextCursor: z.string().nullable(),
});
export type TutorThreadList = z.infer<typeof tutorThreadListSchema>;

/** `GET /tutor/threads/:id/messages`: the whole conversation (D-014), oldest first. */
export const tutorThreadDetailSchema = z.object({
  thread: tutorThreadSchema,
  messages: z.array(tutorMessageSchema),
});
export type TutorThreadDetail = z.infer<typeof tutorThreadDetailSchema>;

/**
 * `POST /tutor/threads/:id/messages` (answers with SSE). `lessonId`/`exerciseId` default to the
 * thread's scope. What the tutor may see about the exercise (hints, solution) is decided by the
 * server from the hint records of `practiceSetItemId` (D-010), never by the request.
 */
export const postTutorMessageRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(4_000),
    entryPoint: tutorEntryPointSchema.default('free'),
    selection: tutorSelectionSchema.optional(),
    lessonId: contentId.optional(),
    exerciseId: contentId.optional(),
    practiceSetItemId: z.string().min(1).max(64).optional(),
    currentCode: tutorCodeFilesSchema.optional(),
    lastRunResult: tutorRunSummarySchema.optional(),
  })
  .strict();
export type PostTutorMessageRequest = z.infer<typeof postTutorMessageRequestSchema>;

// ── SSE events of POST /tutor/threads/:id/messages ─────────────────────────────

/** First event: both messages are stored (`tutor` starts as `streaming`). */
export const tutorMessageCreatedEventSchema = z.object({
  learnerMessageId: z.string(),
  messageId: z.string(),
  role: z.literal('tutor'),
  taskName: z.string(),
  taskVersion: z.int(),
});

/** Waiting: `queued` behind a previous reply or another AI turn, then `running`. */
export const tutorStatusEventSchema = z.object({
  messageId: z.string(),
  state: z.enum(['queued', 'running']),
  position: z.int().nullable(),
});

export const tutorDeltaEventSchema = z.object({ messageId: z.string(), text: z.string() });

/** Discard the text streamed so far (the reply is being regenerated). */
export const tutorResetEventSchema = z.object({ messageId: z.string() });

/**
 * Last event on success or cancel. `content` is the stored text: the full reply, the text
 * before cancelling, or the replacement notice when `withheld`.
 */
export const tutorDoneEventSchema = z.object({
  messageId: z.string(),
  status: z.enum(['complete', 'withheld', 'cancelled']),
  content: z.string(),
  meta: tutorReplyMetaSchema.nullable(),
  usage: z.object({ inputTokens: z.int(), outputTokens: z.int() }).nullable(),
});

/** Last event on failure (the message is stored as `failed`). */
export const tutorErrorEventSchema = z.object({
  messageId: z.string(),
  code: errorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/** SSE event names → payload schemas. */
export const tutorStreamEventSchemas = {
  'message.created': tutorMessageCreatedEventSchema,
  status: tutorStatusEventSchema,
  delta: tutorDeltaEventSchema,
  reset: tutorResetEventSchema,
  done: tutorDoneEventSchema,
  error: tutorErrorEventSchema,
} as const;
export type TutorStreamEventName = keyof typeof tutorStreamEventSchemas;

/** `POST /tutor/threads/:id/messages/:messageId/cancel`. */
export const cancelTutorMessageResponseSchema = z.object({
  messageId: z.string(),
  /** False when the reply had already finished. */
  cancelled: z.boolean(),
});
export type CancelTutorMessageResponse = z.infer<typeof cancelTutorMessageResponseSchema>;

// ── AI hint (tutor.hint) ───────────────────────────────────────────────────────

/**
 * `POST /exercises/:id/ai-hint`: a personalized version of the hint level already opened
 * (`POST /exercises/:id/hints`). It never opens a new level.
 */
export const aiHintRequestSchema = z
  .object({
    practiceSetItemId: z.string().min(1).max(64).optional(),
    currentCode: tutorCodeFilesSchema.optional(),
    lastAnswer: z.string().max(2_000).optional(),
    lastRunResult: tutorRunSummarySchema.optional(),
  })
  .strict();
export type AIHintRequest = z.infer<typeof aiHintRequestSchema>;

export const aiHintResponseSchema = z.object({
  level: z.int().min(1).max(3),
  hintMarkdown: z.string(),
  focusLine: z.int().nullable(),
  checkQuestion: z.string().nullable(),
  /** `authored`: AI was unavailable or its hint failed checks; the authored hint is shown. */
  source: z.enum(['ai', 'authored']),
  /** Why the authored hint is shown (`AI_*`), or null. */
  fallbackCode: errorCodeSchema.nullable(),
});
export type AIHintResponse = z.infer<typeof aiHintResponseSchema>;
