import { sessionSummaryContentSchema, type SessionSummaryContent } from '@proginone/shared';
import { z } from 'zod';
import type { LoadedSection } from '../context/builder.ts';
import { clip, data, tag } from '../context/sections.ts';
import type { TutorMessageContext } from '../context/source.ts';
import { attemptHistorySection, learnerStateSection } from '../context/tutor-sections.ts';
import type { ValidationIssue } from '../record.ts';
import { defineTask } from './define.ts';
import { parseJsonOutput } from './json-output.ts';

// session.summarize: a structured summary of a tutor conversation, the core of long-term memory
// (docs/design/ai-system.md#sessionsummarize). Background, ephemeral, structured output. Rolling:
// the previous summary is passed in and merged, so the newest summary covers the whole thread.
// The model's evidence and concept IDs are untrusted; `sanitizeSummary` keeps only IDs the
// server knows, and nothing here changes learner state.

export const sessionSummarizeInputSchema = z.object({
  threadId: z.string().min(1),
  /** Concepts of the thread's scope and of the replies' metadata (service). */
  conceptIds: z.array(z.string()).max(20).default([]),
  /** Exercise of an exercise thread: its attempts are summarized with the talk. */
  exerciseId: z.string().min(1).optional(),
  previousSummary: sessionSummaryContentSchema.nullable().default(null),
  /** `created_at` the previous summary covers; only later messages are read. */
  after: z.number().default(0),
  /** Messages to leave out (a question still being answered when summarizing before a rebuild). */
  excludeMessageIds: z.array(z.string()).default([]),
});
export type SessionSummarizeInput = z.infer<typeof sessionSummarizeInputSchema>;

const MESSAGE_LIMIT = 60;

const INSTRUCTIONS = `[현재 작업: 학습 기록 분석 — 대화 요약]
- <messages>의 튜터 대화를 장기 학습 기억용으로 요약한다. <previous_summary>가 있으면 그 내용과 합쳐
  대화 전체를 덮는 하나의 요약을 만든다.
- 제공된 메시지와 시도 기록에 있는 사실만 근거로 쓴다. struggles와 misconceptionSignals에는 근거가 된
  메시지의 id(<message id="...">)를 evidenceMessageIds에 반드시 적는다. 근거가 없으면 항목을 만들지 않는다.
- conceptIds와 conceptId에는 <learner_state>나 메시지에 나온 개념 ID만 쓴다. 지어내지 않는다.
- learnerQuestions에는 학습자가 실제로 물은 것을 짧게 옮긴다.
- 학습자를 평가하는 표현(예: "이해력이 부족함")을 쓰지 않는다. 관찰된 행동을 쓴다.
- preferenceSignals에는 학습자가 직접 드러낸 학습 방식 선호만 쓴다(예: "예제를 먼저 보여 주길 원함").
- shortSummary는 500자 이내의 한국어 문단이다.
- 응답은 지정된 JSON 형식으로만 한다.`;

const stringArray = (maxItems: number, maxLength: number) => ({
  type: 'array',
  maxItems,
  items: { type: 'string', maxLength },
});
const evidence = { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' } };

/** JSON Schema for Codex `outputSchema` (OpenAI strict: every property required). */
export const SESSION_SUMMARY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'conceptIds',
    'topicsDiscussed',
    'learnerQuestions',
    'understoodWell',
    'struggles',
    'misconceptionSignals',
    'openQuestions',
    'preferenceSignals',
    'shortSummary',
  ],
  properties: {
    conceptIds: stringArray(10, 200),
    topicsDiscussed: stringArray(8, 120),
    learnerQuestions: stringArray(8, 200),
    understoodWell: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['conceptId', 'note'],
        properties: { conceptId: { type: 'string' }, note: { type: 'string', maxLength: 200 } },
      },
    },
    struggles: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['conceptId', 'note', 'evidenceMessageIds'],
        properties: {
          conceptId: { type: 'string' },
          note: { type: 'string', maxLength: 200 },
          evidenceMessageIds: evidence,
        },
      },
    },
    misconceptionSignals: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'evidenceMessageIds'],
        properties: {
          description: { type: 'string', maxLength: 300 },
          evidenceMessageIds: evidence,
        },
      },
    },
    openQuestions: stringArray(3, 200),
    preferenceSignals: stringArray(3, 150),
    shortSummary: { type: 'string', maxLength: 500 },
  },
};

/** Clips lists and strings to the schema's limits (models overshoot `maxItems`/`maxLength`). */
function clampSummary(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  const strings = (x: unknown, n: number, len: number) =>
    Array.isArray(x)
      ? x
          .filter((s): s is string => typeof s === 'string')
          .slice(0, n)
          .map((s) => clip(s, len))
      : x;
  const objects = (x: unknown, n: number) =>
    Array.isArray(x)
      ? x.slice(0, n).map((o: unknown) => {
          if (!o || typeof o !== 'object') return o;
          const r = { ...(o as Record<string, unknown>) };
          if (typeof r['note'] === 'string') r['note'] = clip(r['note'], 200);
          if (typeof r['description'] === 'string') r['description'] = clip(r['description'], 300);
          if (Array.isArray(r['evidenceMessageIds']))
            r['evidenceMessageIds'] = r['evidenceMessageIds'].slice(0, 10);
          return r;
        })
      : x;
  return {
    ...v,
    conceptIds: strings(v['conceptIds'], 10, 200),
    topicsDiscussed: strings(v['topicsDiscussed'], 8, 120),
    learnerQuestions: strings(v['learnerQuestions'], 8, 200),
    understoodWell: objects(v['understoodWell'], 5),
    struggles: objects(v['struggles'], 5),
    misconceptionSignals: objects(v['misconceptionSignals'], 3),
    openQuestions: strings(v['openQuestions'], 3, 200),
    preferenceSignals: strings(v['preferenceSignals'], 3, 150),
    shortSummary:
      typeof v['shortSummary'] === 'string' ? clip(v['shortSummary'], 500) : v['shortSummary'],
  };
}

function messagesSection(messages: TutorMessageContext[]): LoadedSection | null {
  if (messages.length === 0) return null;
  const render = (n: number, chars: number) =>
    tag(
      'messages',
      { total: messages.length },
      messages
        .slice(messages.length - Math.min(n, messages.length))
        .map((m) => tag('message', { id: m.id, role: m.role }, data(clip(m.content, chars))))
        .join('\n'),
    );
  return {
    kind: 'messages',
    ref: null,
    variants: [render(MESSAGE_LIMIT, 1_500), render(30, 800), render(15, 400)],
  };
}

function previousSummarySection(prev: SessionSummaryContent | null): LoadedSection | null {
  if (!prev) return null;
  return {
    kind: 'previous_summary',
    ref: null,
    variants: [tag('previous_summary', {}, data(JSON.stringify(prev)))],
  };
}

export const sessionSummarize = defineTask<SessionSummarizeInput, SessionSummaryContent>({
  name: 'session.summarize',
  version: 1,
  role: 'analyst',
  priority: 'background',
  inputSchema: sessionSummarizeInputSchema,
  streaming: false,
  stripMeta: false,
  effort: 'low',
  timeoutMs: 120_000,
  retry: { onBadOutput: 1, onTransient: 1, onPolicy: 0 },
  thread: 'ephemeral',
  context: {
    totalBudgetTokens: 10_000,
    sections: [
      {
        kind: 'messages',
        required: true,
        priority: 9,
        maxTokens: 7_000,
        load: async (src, input) =>
          messagesSection(
            await src.threadMessages(input.threadId, {
              limit: MESSAGE_LIMIT,
              excludeMessageIds: input.excludeMessageIds,
              after: input.after,
            }),
          ),
      },
      {
        kind: 'previous_summary',
        required: false,
        priority: 8,
        maxTokens: 1_500,
        load: (_src, input) => Promise.resolve(previousSummarySection(input.previousSummary)),
      },
      {
        kind: 'learner_state',
        required: false,
        priority: 6,
        maxTokens: 600,
        load: async (src, input) => learnerStateSection(await src.conceptStates(input.conceptIds)),
      },
      {
        kind: 'attempt_history',
        required: false,
        priority: 5,
        maxTokens: 600,
        load: async (src, input) =>
          input.exerciseId
            ? attemptHistorySection(await src.attempts(input.exerciseId, { limit: 5 }))
            : null,
      },
    ],
  },
  instructions: () => INSTRUCTIONS,
  userMessage: (_input, context) =>
    [
      ...context.blocks,
      tag('learner_question', { entry_point: 'summary' }, data('위 대화를 요약해 주세요.')),
    ].join('\n\n'),
  outputSchema: () => SESSION_SUMMARY_JSON_SCHEMA,
  parse: (text) => parseJsonOutput(text, sessionSummaryContentSchema, clampSummary),
  visibleText: (output) => output.shortSummary,
});

/**
 * Keeps only what the server can back (docs: 후처리 검증 "근거 없는 항목은 제거"): evidence message
 * IDs that are in the conversation, concept IDs the content pack has. Dropped items are reported
 * as validation issues for `ai_calls`.
 */
export function sanitizeSummary(
  summary: SessionSummaryContent,
  known: { messageIds: ReadonlySet<string>; conceptIds: ReadonlySet<string> },
): { summary: SessionSummaryContent; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const drop = (rule: string, message: string) => {
    issues.push({ rule, message });
  };
  const concept = (id: string) => known.conceptIds.has(id);
  const evidence = (ids: string[]) => ids.filter((id) => known.messageIds.has(id));
  const conceptIds = summary.conceptIds.filter(concept);
  if (conceptIds.length < summary.conceptIds.length) {
    drop(
      'concept',
      `알 수 없는 개념 ID ${summary.conceptIds.length - conceptIds.length}개를 뺐습니다.`,
    );
  }
  const understoodWell = summary.understoodWell.filter((u) => concept(u.conceptId));
  if (understoodWell.length < summary.understoodWell.length) {
    drop('concept', '알 수 없는 개념의 understoodWell 항목을 뺐습니다.');
  }
  const struggles = summary.struggles.flatMap((s) => {
    const ids = evidence(s.evidenceMessageIds);
    return concept(s.conceptId) && ids.length > 0 ? [{ ...s, evidenceMessageIds: ids }] : [];
  });
  if (struggles.length < summary.struggles.length) {
    drop(
      'evidence',
      `근거가 없는 struggles 항목 ${summary.struggles.length - struggles.length}개를 뺐습니다.`,
    );
  }
  const misconceptionSignals = summary.misconceptionSignals.flatMap((m) => {
    const ids = evidence(m.evidenceMessageIds);
    return ids.length > 0 ? [{ ...m, evidenceMessageIds: ids }] : [];
  });
  if (misconceptionSignals.length < summary.misconceptionSignals.length) {
    drop('evidence', '근거가 없는 misconceptionSignals 항목을 뺐습니다.');
  }
  return {
    summary: {
      ...summary,
      conceptIds: [
        ...new Set([
          ...conceptIds,
          ...understoodWell.map((u) => u.conceptId),
          ...struggles.map((s) => s.conceptId),
        ]),
      ].slice(0, 10),
      understoodWell,
      struggles,
      misconceptionSignals,
    },
    issues,
  };
}

/**
 * Deterministic summary when AI cannot summarize (docs: 폴백 — 개념 ID, 메시지 수, 학습자 질문 처음 3개의
 * 앞부분). Builds on the previous summary so a rolling summary never loses what it had.
 */
export function fallbackSummary(input: {
  messages: readonly { role: string; content: string }[];
  conceptIds: readonly string[];
  previous: SessionSummaryContent | null;
}): SessionSummaryContent {
  const questions = input.messages
    .filter((m) => m.role === 'learner')
    .map((m) => clip(m.content.replace(/\s+/g, ' ').trim(), 200))
    .filter((q) => q !== '');
  const prev = input.previous;
  const learnerQuestions = [...(prev?.learnerQuestions ?? []), ...questions.slice(0, 3)].slice(-8);
  const first = questions[0];
  const shortSummary = clip(
    [
      prev?.shortSummary,
      `튜터와 메시지 ${input.messages.length}개를 주고받았습니다.${first ? ` 첫 질문: "${clip(first, 120)}"` : ''}`,
    ]
      .filter(Boolean)
      .join(' '),
    500,
  );
  return {
    conceptIds: [...new Set([...(prev?.conceptIds ?? []), ...input.conceptIds])].slice(0, 10),
    topicsDiscussed: prev?.topicsDiscussed ?? [],
    learnerQuestions,
    understoodWell: prev?.understoodWell ?? [],
    struggles: prev?.struggles ?? [],
    misconceptionSignals: prev?.misconceptionSignals ?? [],
    openQuestions: prev?.openQuestions ?? [],
    preferenceSignals: prev?.preferenceSignals ?? [],
    shortSummary,
  };
}
