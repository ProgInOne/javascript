import { z } from 'zod';
import { attemptsSection, catalogSection, signalsSection } from '../context/evaluator-sections.ts';
import { misconceptionsSection } from '../context/memory-sections.ts';
import { clip, data, tag } from '../context/sections.ts';
import { learnerStateSection } from '../context/tutor-sections.ts';
import type { ValidationIssue } from '../record.ts';
import { defineTask } from './define.ts';
import { parseJsonOutput } from './json-output.ts';

// misconception.propose: misconception candidates with evidence from wrong attempts and
// conversation signals (docs/design/ai-system.md#misconceptionpropose). The AI only proposes;
// the server keeps proposals whose evidence it can verify and records them as `suspected`
// through the learning engine (FR-AI-09, D-010). Background, ephemeral, structured output.

export const misconceptionProposeInputSchema = z.object({
  conceptId: z.string().min(1),
  /** Wrong attempts the model may cite, newest first (service-selected). */
  attemptIds: z.array(z.string().min(1)).min(1).max(10),
  /** Signals from conversations: summary misconception signals, tutor `possibleMisconception`. */
  signals: z.array(z.string().max(300)).max(5).default([]),
});
export type MisconceptionProposeInput = z.infer<typeof misconceptionProposeInputSchema>;

export const PROPOSAL_CONFIDENCES = ['low', 'medium', 'high'] as const;

export const misconceptionProposalSchema = z.object({
  catalogId: z.string().max(200).nullable(),
  newDescription: z.string().trim().max(300).nullable(),
  conceptId: z.string().max(200),
  evidenceAttemptIds: z.array(z.string().max(64)).min(1).max(10),
  confidence: z.enum(PROPOSAL_CONFIDENCES),
  reasoning: z.string().max(400),
});
export type MisconceptionProposal = z.infer<typeof misconceptionProposalSchema>;

export const misconceptionProposeOutputSchema = z.object({
  proposals: z.array(misconceptionProposalSchema).max(3),
});
export type MisconceptionProposeOutput = z.infer<typeof misconceptionProposeOutputSchema>;

const INSTRUCTIONS = `[현재 작업: 학습 기록 분석 — 오개념 후보 제안]
- <attempts>의 오답들과 <signals>를 보고, 대상 개념(<learner_state>의 개념)에 대해 학습자가 가진 것으로 보이는
  오개념을 최대 3개 제안한다. 제안은 기록되기 전에 앱이 검증하며, 학습 상태를 바꾸지 않는다.
- 제공된 시도 기록에 있는 사실만 근거로 쓴다. evidenceAttemptIds에는 근거가 된 <attempt id="...">를 반드시 적는다.
  근거가 없으면 제안하지 않는다. 오답이 단순 실수(오타, 문제 잘못 읽기)로 보이면 제안하지 않는다.
- <misconception_catalog>에 맞는 항목이 있으면 그 id를 catalogId로 쓰고 newDescription은 null로 둔다.
  카탈로그에 맞는 것이 없을 때만 catalogId를 null로 두고 newDescription에 오해를 한 문장으로 쓴다.
- <active_misconceptions>에 이미 있는 오개념은 다시 제안하지 않는다.
- 추측이면 confidence를 "low"로 표시한다. reasoning에는 시도에서 관찰한 행동을 짧게 쓴다.
- 학습자를 평가하는 표현을 쓰지 않는다.
- 제안할 것이 없으면 proposals를 빈 배열로 둔다. 응답은 지정된 JSON 형식으로만 한다.`;

export const MISCONCEPTION_PROPOSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'catalogId',
          'newDescription',
          'conceptId',
          'evidenceAttemptIds',
          'confidence',
          'reasoning',
        ],
        properties: {
          catalogId: { type: ['string', 'null'] },
          newDescription: { type: ['string', 'null'], maxLength: 300 },
          conceptId: { type: 'string' },
          evidenceAttemptIds: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            items: { type: 'string' },
          },
          confidence: { type: 'string', enum: [...PROPOSAL_CONFIDENCES] },
          reasoning: { type: 'string', maxLength: 400 },
        },
      },
    },
  },
};

const clamp = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as { proposals?: unknown };
  if (!Array.isArray(v.proposals)) return value;
  return {
    proposals: v.proposals.slice(0, 3).map((p: unknown) => {
      if (!p || typeof p !== 'object') return p;
      const r = { ...(p as Record<string, unknown>) };
      if (typeof r['reasoning'] === 'string') r['reasoning'] = clip(r['reasoning'], 400);
      if (typeof r['newDescription'] === 'string')
        r['newDescription'] = clip(r['newDescription'], 300);
      if (Array.isArray(r['evidenceAttemptIds']))
        r['evidenceAttemptIds'] = r['evidenceAttemptIds'].slice(0, 10);
      return r;
    }),
  };
};

export const misconceptionPropose = defineTask<
  MisconceptionProposeInput,
  MisconceptionProposeOutput
>({
  name: 'misconception.propose',
  version: 1,
  role: 'analyst',
  priority: 'background',
  inputSchema: misconceptionProposeInputSchema,
  streaming: false,
  stripMeta: false,
  effort: 'low',
  timeoutMs: 90_000,
  retry: { onBadOutput: 1, onTransient: 1, onPolicy: 0 },
  thread: 'ephemeral',
  context: {
    totalBudgetTokens: 6_000,
    sections: [
      {
        kind: 'attempts',
        required: true,
        priority: 9,
        maxTokens: 3_000,
        load: async (src, input) => attemptsSection(await src.attemptDetails(input.attemptIds)),
      },
      {
        kind: 'misconception_catalog',
        required: false,
        priority: 8,
        maxTokens: 1_200,
        load: async (src, input) => {
          const attempts = await src.attemptDetails(input.attemptIds);
          const observed = [...new Set(attempts.flatMap((a) => a.misconceptionIds))];
          return catalogSection(
            await src.misconceptionCatalog({ conceptIds: [input.conceptId] }),
            observed,
          );
        },
      },
      {
        kind: 'active_misconceptions',
        required: false,
        priority: 7,
        maxTokens: 500,
        load: async (src, input) =>
          misconceptionsSection(await src.misconceptions([input.conceptId])),
      },
      {
        kind: 'signals',
        required: false,
        priority: 6,
        maxTokens: 600,
        load: (_src, input) => Promise.resolve(signalsSection(input.signals)),
      },
      {
        kind: 'learner_state',
        required: false,
        priority: 5,
        maxTokens: 300,
        load: async (src, input) => learnerStateSection(await src.conceptStates([input.conceptId])),
      },
    ],
  },
  instructions: () => INSTRUCTIONS,
  userMessage: (input, context) =>
    [
      ...context.blocks,
      tag(
        'learner_question',
        { entry_point: 'analysis', concept: input.conceptId },
        data('이 개념에서 보이는 오개념 후보를 근거와 함께 제안해 주세요.'),
      ),
    ].join('\n\n'),
  outputSchema: () => MISCONCEPTION_PROPOSE_JSON_SCHEMA,
  parse: (text) => parseJsonOutput(text, misconceptionProposeOutputSchema, clamp),
  visibleText: (output) =>
    output.proposals.map((p) => p.newDescription ?? p.catalogId ?? '').join('\n'),
});

export interface VerifiedProposal {
  /** A catalog id, or `null` for an unclassified (`ai.<ULID>`) candidate. */
  catalogId: string | null;
  description: string | null;
  conceptId: string;
  evidenceAttemptIds: string[];
  confidence: MisconceptionProposal['confidence'];
}

/**
 * The app's acceptance rules for proposals (docs: 반영 규칙 1–3, FR-AI-09): evidence must be wrong
 * attempts that were in the input, a catalog id must exist for the concept, an unclassified
 * candidate needs a description, and low-confidence guesses are not recorded (D-036). Everything
 * dropped is reported for `ai_calls.validation_issues_json`.
 */
export function verifyProposals(
  output: MisconceptionProposeOutput,
  known: {
    conceptId: string;
    /** Input attempts that are graded wrong. */
    wrongAttemptIds: ReadonlySet<string>;
    /** Catalog misconception id → its concept. */
    catalog: ReadonlyMap<string, string>;
  },
): { proposals: VerifiedProposal[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const proposals: VerifiedProposal[] = [];
  const seen = new Set<string>();
  for (const p of output.proposals) {
    const evidence = [...new Set(p.evidenceAttemptIds)].filter((id) =>
      known.wrongAttemptIds.has(id),
    );
    if (evidence.length === 0) {
      issues.push({
        rule: 'evidence',
        message: '입력에 없던 시도나 맞힌 시도만 근거로 든 제안을 뺐습니다.',
      });
      continue;
    }
    if (p.confidence === 'low') {
      issues.push({ rule: 'low_confidence', message: '확신도가 낮은 제안은 기록하지 않습니다.' });
      continue;
    }
    if (p.catalogId !== null) {
      const concept = known.catalog.get(p.catalogId);
      if (concept === undefined) {
        issues.push({ rule: 'catalog', message: '카탈로그에 없는 오개념 ID를 뺐습니다.' });
        continue;
      }
      if (concept !== known.conceptId) {
        issues.push({ rule: 'concept', message: '대상 개념이 아닌 오개념 제안을 뺐습니다.' });
        continue;
      }
      if (seen.has(p.catalogId)) continue;
      seen.add(p.catalogId);
      proposals.push({
        catalogId: p.catalogId,
        description: null,
        conceptId: concept,
        evidenceAttemptIds: evidence,
        confidence: p.confidence,
      });
      continue;
    }
    const description = p.newDescription?.trim() ?? '';
    if (description === '' || p.conceptId !== known.conceptId) {
      issues.push({
        rule: 'description',
        message: '설명이 없거나 대상 개념이 아닌 미분류 제안을 뺐습니다.',
      });
      continue;
    }
    proposals.push({
      catalogId: null,
      description: clip(description, 300),
      conceptId: known.conceptId,
      evidenceAttemptIds: evidence,
      confidence: p.confidence,
    });
  }
  return { proposals, issues };
}
