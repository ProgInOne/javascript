import {
  mistakeKindSchema,
  mistakeNextStepSchema,
  MISTAKE_KINDS,
  MISTAKE_NEXT_STEPS,
} from '@proginone/shared';
import { z } from 'zod';
import { catalogSection, gradingResultSection } from '../context/evaluator-sections.ts';
import { clip, data, tag } from '../context/sections.ts';
import {
  attemptHistorySection,
  exerciseSection,
  learnerStateSection,
} from '../context/tutor-sections.ts';
import { countCodeLines } from '../output/validate.ts';
import type { ValidationIssue } from '../record.ts';
import { exerciseAccessSchema } from './access.ts';
import { defineTask } from './define.ts';
import { parseJsonOutput } from './json-output.ts';

// evaluator.explainMistake: why a graded wrong attempt went wrong
// (docs/design/ai-system.md#evaluatorexplainmistake). Grading is deterministic and final; the
// model explains, it never re-grades. The exercise reaches the prompt only as far as the
// learner's hint records allow (D-010, service + ContextSource), and the output is checked for
// answer leaks before anyone sees it, so it is not streamed.

export const explainMistakeInputSchema = z.object({
  attemptId: z.string().min(1),
  exerciseId: z.string().min(1),
  /** What the learner unlocked in the attempt's scope (service layer, D-010). */
  access: exerciseAccessSchema,
});
export type ExplainMistakeInput = z.infer<typeof explainMistakeInputSchema>;

export const explainMistakeOutputSchema = z.object({
  summary: z.string().trim().min(1).max(200),
  explanationMarkdown: z.string().trim().min(1).max(2_500),
  mistakeKind: mistakeKindSchema,
  relatedConceptIds: z.array(z.string().max(200)).max(3),
  misconceptionCandidate: z
    .object({
      catalogId: z.string().max(200).nullable(),
      description: z.string().trim().min(1).max(300),
    })
    .nullable(),
  nextStep: mistakeNextStepSchema,
});
export type ExplainMistakeOutput = z.infer<typeof explainMistakeOutputSchema>;

/** Code lines allowed before the solution is viewed (same cap as hint level 3). */
export const EXPLAIN_CODE_LINE_LIMIT = 8;

const INSTRUCTIONS = `[현재 작업: 오답 분석]
- 채점은 이미 끝났다. <grading_result>는 사실이며, 판정을 다시 하거나 반박하지 않는다.
- 학습자의 답(<learner_answer>)에서 생각이 어긋난 지점을 찾아 summary에 한 문장으로 진단하고,
  explanationMarkdown에 그 이유를 설명한다(2500자 이내, 보통 400~900자).
- 실패한 체크의 기대값과 실제값은 학습자가 이미 본 정보이므로 써도 된다.
- 오답 선택지나 패턴에 연결된 오개념(<misconception observed="true">)이 있으면 그 오개념을 중심으로 설명한다.
- 정답 전체(정답 코드, 정답 선택지, 기대 출력 전체)를 보여주지 않는다. <exercise state="solution_viewed">일 때만
  정답을 근거로 설명해도 된다. 코드 예시는 8줄 이내이며 문제의 정답을 그대로 담지 않는다.
- 학습자가 다시 시도할 수 있도록 nextStep으로 다음 행동을 고른다: retry(다시 풀기), open_hint(힌트 보기),
  review_concept(개념 복습), read_section(레슨 다시 읽기).
- relatedConceptIds에는 <exercise>와 <learner_state>에 나온 개념 ID만 쓴다(최대 3개).
- misconceptionCandidate: 답에서 특정 오개념이 보이면 <misconception_catalog>의 id를 catalogId로 쓰고,
  카탈로그에 맞는 것이 없을 때만 catalogId를 null로 두고 description에 관찰한 오해를 쓴다. 보이지 않으면 null.
- 학습자를 평가하는 표현을 쓰지 않는다. 관찰된 답과 결과를 근거로 쓴다.
- 응답은 지정된 JSON 형식으로만 한다.`;

export const EXPLAIN_MISTAKE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'explanationMarkdown',
    'mistakeKind',
    'relatedConceptIds',
    'misconceptionCandidate',
    'nextStep',
  ],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 200 },
    explanationMarkdown: { type: 'string', minLength: 1, maxLength: 2500 },
    mistakeKind: { type: 'string', enum: [...MISTAKE_KINDS] },
    relatedConceptIds: { type: 'array', maxItems: 3, items: { type: 'string' } },
    misconceptionCandidate: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['catalogId', 'description'],
      properties: {
        catalogId: { type: ['string', 'null'] },
        description: { type: 'string', maxLength: 300 },
      },
    },
    nextStep: { type: 'string', enum: [...MISTAKE_NEXT_STEPS] },
  },
};

const clamp = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = { ...(value as Record<string, unknown>) };
  if (typeof v['summary'] === 'string') v['summary'] = clip(v['summary'], 200);
  if (Array.isArray(v['relatedConceptIds']))
    v['relatedConceptIds'] = v['relatedConceptIds'].slice(0, 3);
  const mc = v['misconceptionCandidate'];
  if (
    mc &&
    typeof mc === 'object' &&
    typeof (mc as { description?: unknown }).description === 'string'
  ) {
    v['misconceptionCandidate'] = {
      ...(mc as Record<string, unknown>),
      description: clip((mc as { description: string }).description, 300),
    };
  }
  return v;
};

export const explainMistake = defineTask<ExplainMistakeInput, ExplainMistakeOutput>({
  name: 'evaluator.explainMistake',
  version: 1,
  role: 'evaluator',
  priority: 'interactive',
  inputSchema: explainMistakeInputSchema,
  streaming: false,
  stripMeta: false,
  effort: 'medium',
  timeoutMs: 60_000,
  retry: { onBadOutput: 1, onTransient: 1, onPolicy: 1 },
  thread: 'ephemeral',
  context: {
    totalBudgetTokens: 8_000,
    sections: [
      {
        kind: 'grading_result',
        required: true,
        priority: 10,
        maxTokens: 2_000,
        load: async (src, input) => {
          const [attempt] = await src.attemptDetails([input.attemptId]);
          return attempt ? gradingResultSection(attempt) : null;
        },
      },
      {
        kind: 'exercise',
        required: true,
        priority: 9,
        maxTokens: 1_500,
        load: async (src, input) => {
          const ex = await src.exercise(input.exerciseId, input.access);
          return ex ? exerciseSection(ex) : null;
        },
      },
      {
        kind: 'misconception_catalog',
        required: false,
        priority: 8,
        maxTokens: 900,
        load: async (src, input) => {
          const [attempt] = await src.attemptDetails([input.attemptId]);
          const ex = await src.exercise(input.exerciseId, input.access);
          const observed = attempt?.misconceptionIds ?? [];
          return catalogSection(
            await src.misconceptionCatalog({ ids: observed, conceptIds: ex?.conceptIds ?? [] }),
            observed,
          );
        },
      },
      {
        kind: 'learner_state',
        required: false,
        priority: 7,
        maxTokens: 500,
        load: async (src, input) => {
          const ex = await src.exercise(input.exerciseId, input.access);
          return learnerStateSection(await src.conceptStates(ex?.conceptIds ?? []));
        },
      },
      {
        kind: 'attempt_history',
        required: false,
        priority: 6,
        maxTokens: 600,
        // The two attempts before this one (docs: 이 문제의 이전 시도 2개).
        load: async (src, input) => {
          const previous = (await src.attempts(input.exerciseId, { limit: 3 })).filter(
            (a) => a.id !== input.attemptId,
          );
          return attemptHistorySection(previous.slice(0, 2));
        },
      },
    ],
  },
  instructions: () => INSTRUCTIONS,
  userMessage: (_input, context) =>
    [
      ...context.blocks,
      tag('learner_question', { entry_point: 'mistake_followup' }, data('제 답이 왜 틀렸나요?')),
    ].join('\n\n'),
  outputSchema: () => EXPLAIN_MISTAKE_JSON_SCHEMA,
  parse: (text) => parseJsonOutput(text, explainMistakeOutputSchema, clamp),
  visibleText: (output) => `${output.summary}\n\n${output.explanationMarkdown}`,
  postValidate: (output, input) => {
    const issues: ValidationIssue[] = [];
    const lines = countCodeLines(output.explanationMarkdown);
    if (!input.access.solutionViewed && lines > EXPLAIN_CODE_LINE_LIMIT) {
      issues.push({
        rule: 'code_lines',
        message: `코드 ${lines}줄(허용 ${EXPLAIN_CODE_LINE_LIMIT}줄)`,
      });
    }
    return issues;
  },
});
