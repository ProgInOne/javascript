import { z } from 'zod';

// AI provider contract shared by packages/ai, the server and the web app
// (docs/design/ai-system.md). Task input/output schemas live with each task in packages/ai;
// what is here is what crosses the HTTP boundary or is needed on both sides.

export const AI_PROVIDER_IDS = ['codex', 'mock'] as const;
export const aiProviderIdSchema = z.enum(AI_PROVIDER_IDS);
export type AIProviderId = z.infer<typeof aiProviderIdSchema>;

/**
 * Connection state of the AI provider (docs/design/ai-system.md#프로세스-수명주기).
 * - `idle`: not started yet (Codex starts lazily on first use).
 * - `isolation_failed`: the tutor-only Codex home failed its feature-flag check (D-002); the
 *   tutor stays disabled until the problem is fixed.
 * - `error`: restarts were exhausted or startup failed; "다시 연결" restarts it.
 * Account details are limited to the plan type; the app never exposes the account email.
 */
export const aiStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('idle') }),
  z.object({ state: z.literal('starting') }),
  z.object({ state: z.literal('not_installed'), hint: z.string() }),
  z.object({
    state: z.literal('unsupported_version'),
    found: z.string(),
    required: z.string(),
  }),
  z.object({ state: z.literal('isolation_failed'), problems: z.array(z.string()) }),
  z.object({ state: z.literal('logged_out') }),
  z.object({ state: z.literal('ready'), planType: z.string().nullable() }),
  z.object({ state: z.literal('rate_limited'), resetsAt: z.string().nullable() }),
  z.object({ state: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type AIStatus = z.infer<typeof aiStatusSchema>;

/** One usage window as reported by the provider (`account/rateLimits/read`). */
export const aiUsageWindowSchema = z.object({
  id: z.enum(['primary', 'secondary']),
  usedPercent: z.number(),
  windowDurationMins: z.number().nullable(),
  /** ISO 8601. */
  resetsAt: z.string().nullable(),
});
export type AIUsageWindow = z.infer<typeof aiUsageWindowSchema>;

/** Provider-reported usage only; the app never estimates "questions left". */
export const aiUsageSchema = z.object({
  windows: z.array(aiUsageWindowSchema),
  /** Highest `usedPercent` across windows (the header shows this one). */
  highestUsedPercent: z.number().nullable(),
  updatedAt: z.number(),
});
export type AIUsage = z.infer<typeof aiUsageSchema>;

/** `GET /ai/status` and the `status` event of `GET /ai/events`. */
export const aiStatusResponseSchema = z.object({
  provider: aiProviderIdSchema,
  status: aiStatusSchema,
  usage: aiUsageSchema.nullable(),
  /** A ChatGPT login started with `POST /ai/login` that has not completed yet. */
  pendingLogin: z.object({ loginId: z.string(), startedAt: z.number() }).nullable(),
});
export type AIStatusResponse = z.infer<typeof aiStatusResponseSchema>;

/** `POST /ai/login`: open `authUrl` in a new tab; completion arrives on `GET /ai/events`. */
export const aiLoginResponseSchema = z.object({
  loginId: z.string(),
  authUrl: z.string(),
});
export type AILoginResponse = z.infer<typeof aiLoginResponseSchema>;

/** `login` event of `GET /ai/events`. */
export const aiLoginEventSchema = z.object({
  loginId: z.string().nullable(),
  success: z.boolean(),
  error: z.string().nullable(),
});
export type AILoginEvent = z.infer<typeof aiLoginEventSchema>;

export const aiModelSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
  supportedEfforts: z.array(z.string()),
});
export type AIModel = z.infer<typeof aiModelSchema>;

/** `GET /ai/models`: visible models only (`hidden: false`). */
export const aiModelsResponseSchema = z.object({ models: z.array(aiModelSchema) });
export type AIModelsResponse = z.infer<typeof aiModelsResponseSchema>;

// ── Tutor task inputs shared with the HTTP contract ─────────────────────────────

export const TUTOR_ENTRY_POINTS = [
  'free',
  'selection',
  'test_failure',
  'stuck_badge',
  'mistake_followup',
] as const;
export const tutorEntryPointSchema = z.enum(TUTOR_ENTRY_POINTS);
export type TutorEntryPoint = z.infer<typeof tutorEntryPointSchema>;

/** Learner files by path (`main.js` → content). Untrusted learner data. */
export const tutorCodeFilesSchema = z
  .record(z.string().min(1).max(120), z.string().max(20_000))
  .refine((files) => Object.keys(files).length <= 10, { message: '파일은 10개까지입니다.' });
export type TutorCodeFiles = z.infer<typeof tutorCodeFilesSchema>;

/**
 * What the web app tells the tutor about the learner's last run: a compact summary of the
 * sandbox `RunResult` (console tail, error, failed visible checks). Untrusted learner data.
 */
export const tutorRunSummarySchema = z
  .object({
    status: z.string().max(40),
    console: z.array(z.string().max(500)).max(50).default([]),
    error: z.string().max(2_000).nullable().default(null),
    failedChecks: z
      .array(z.object({ id: z.string().max(120), description: z.string().max(500) }))
      .max(20)
      .default([]),
  })
  .strict();
export type TutorRunSummary = z.infer<typeof tutorRunSummarySchema>;

export const tutorSelectionSchema = z
  .object({
    kind: z.enum(['lesson_text', 'code']),
    text: z.string().min(1).max(4_000),
    sectionId: z.string().max(200).optional(),
  })
  .strict();
export type TutorSelection = z.infer<typeof tutorSelectionSchema>;

/**
 * Metadata the tutor appends to a reply in a `<meta>` block (docs/design/ai-system.md#tutorreply).
 * Parse failures are ignored; unknown concept IDs are dropped by the server.
 */
export const tutorReplyMetaSchema = z.object({
  referencedConcepts: z.array(z.string().max(200)).max(5).default([]),
  suggestedFollowUp: z
    .enum(['none', 'try_exercise', 'review_prerequisite', 'read_section'])
    .default('none'),
  followUpTarget: z.string().max(200).optional(),
  possibleMisconception: z.object({ description: z.string().max(300) }).optional(),
});
export type TutorReplyMeta = z.infer<typeof tutorReplyMetaSchema>;
