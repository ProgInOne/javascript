import { z } from 'zod';
import {
  tutorCodeFilesSchema,
  tutorEntryPointSchema,
  tutorReplyMetaSchema,
  tutorRunSummarySchema,
  tutorSelectionSchema,
} from './ai.ts';
import { errorCodeSchema } from './errors.ts';
import { misconceptionStatusSchema } from './practice.ts';

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

// ── Session summaries (session.summarize, long-term memory) ─────────────────────
// docs/design/ai-system.md#sessionsummarize, #장기-학습-기억; docs/design/data-model.md
// #tutor_threads-tutor_messages-session_summaries.

export const SESSION_SUMMARY_SCOPE_TYPES = ['tutor_thread', 'study_session'] as const;
/** `ai`: made by `session.summarize`; `fallback`: deterministic summary when AI could not. */
export const SESSION_SUMMARY_SOURCES = ['ai', 'fallback'] as const;

const evidenceIds = z.array(z.string().max(64)).min(1).max(10);

/**
 * Structured summary of a tutor conversation. AI output is untrusted: the server keeps only
 * evidence message IDs that were in the conversation and concept IDs the content pack has.
 * A summary never changes mastery or misconceptions by itself (D-010).
 */
export const sessionSummaryContentSchema = z.object({
  conceptIds: z.array(z.string().max(200)).max(10),
  topicsDiscussed: z.array(z.string().max(120)).max(8),
  /** What the learner actually asked. */
  learnerQuestions: z.array(z.string().max(200)).max(8),
  understoodWell: z
    .array(z.object({ conceptId: z.string().max(200), note: z.string().max(200) }))
    .max(5),
  struggles: z
    .array(
      z.object({
        conceptId: z.string().max(200),
        note: z.string().max(200),
        evidenceMessageIds: evidenceIds,
      }),
    )
    .max(5),
  misconceptionSignals: z
    .array(z.object({ description: z.string().max(300), evidenceMessageIds: evidenceIds }))
    .max(3),
  /** Questions left open at the end. */
  openQuestions: z.array(z.string().max(200)).max(3),
  /** Preference candidates ("예제를 먼저 보여 주길 선호"); never applied automatically. */
  preferenceSignals: z.array(z.string().max(150)).max(3),
  shortSummary: z.string().max(500),
});
export type SessionSummaryContent = z.infer<typeof sessionSummaryContentSchema>;

export const sessionSummarySchema = z.object({
  id: z.string(),
  scopeType: z.enum(SESSION_SUMMARY_SCOPE_TYPES),
  scopeId: z.string(),
  source: z.enum(SESSION_SUMMARY_SOURCES),
  content: sessionSummaryContentSchema,
  /** Conversation messages the summary covers (rolling: the whole thread so far). */
  messageCount: z.int().min(0),
  /** `created_at` of the last covered message (epoch ms). */
  coveredUntil: z.number(),
  createdAt: z.number(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

/** `GET /tutor/threads/:id/summary`: the thread's latest (rolling) summary. */
export const tutorThreadSummaryResponseSchema = z.object({
  summary: sessionSummarySchema.nullable(),
});
export type TutorThreadSummaryResponse = z.infer<typeof tutorThreadSummaryResponseSchema>;

/**
 * `POST /tutor/threads/:id/summary`: summarizes the messages since the last summary now (the
 * server also does this after 30 minutes without messages). `created: false` when there was
 * nothing new; `summary` stays null when AI is unavailable and nothing could be written yet.
 */
export const summarizeTutorThreadResponseSchema = z.object({
  summary: sessionSummarySchema.nullable(),
  created: z.boolean(),
});
export type SummarizeTutorThreadResponse = z.infer<typeof summarizeTutorThreadResponseSchema>;

// ── Mistake explanation (evaluator.explainMistake) ──────────────────────────────
// docs/design/ai-system.md#evaluatorexplainmistake.

export const MISTAKE_KINDS = [
  'concept',
  'syntax',
  'logic',
  'edge_case',
  'reading',
  'unknown',
] as const;
export const MISTAKE_NEXT_STEPS = ['retry', 'open_hint', 'review_concept', 'read_section'] as const;
export const mistakeKindSchema = z.enum(MISTAKE_KINDS);
export const mistakeNextStepSchema = z.enum(MISTAKE_NEXT_STEPS);

/**
 * `POST /attempts/:id/explanation` (empty body): why a graded wrong attempt went wrong. Grading
 * already happened and is never changed. The AI sees the exercise only as far as the hint records
 * allow (D-010), and the explanation is checked for answer leaks. When AI cannot help, `source` is
 * `authored` with the misconception descriptions of the chosen wrong option (if any) and the
 * reason in `fallbackCode`. A misconception the AI recognized is recorded only as `suspected`
 * (never confirmed by AI) and returned in `misconception`. Repeated requests for the same attempt
 * return the same explanation while the app runs.
 */
export const mistakeExplanationSchema = z.object({
  attemptId: z.string(),
  source: z.enum(['ai', 'authored']),
  fallbackCode: errorCodeSchema.nullable(),
  /** One-sentence diagnosis (empty for `authored` without a misconception). */
  summary: z.string(),
  /** Markdown (render with raw HTML disabled; AI output is untrusted). */
  explanationMarkdown: z.string(),
  mistakeKind: mistakeKindSchema.nullable(),
  nextStep: mistakeNextStepSchema.nullable(),
  relatedConcepts: z.array(z.object({ id: z.string(), title: z.string() })),
  misconception: z
    .object({
      id: z.string(),
      title: z.string(),
      status: misconceptionStatusSchema,
      origin: z.enum(['catalog', 'ai']),
    })
    .nullable(),
});
export type MistakeExplanation = z.infer<typeof mistakeExplanationSchema>;
