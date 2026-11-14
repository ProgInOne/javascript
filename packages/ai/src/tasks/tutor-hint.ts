import { tutorCodeFilesSchema, tutorRunSummarySchema } from '@proginone/shared';
import { z } from 'zod';
import { data, tag } from '../context/sections.ts';
import {
  attemptHistorySection,
  conceptIdsFor,
  exerciseSection,
  learnerCodeSection,
  learnerStateSection,
  runResultSection,
} from '../context/tutor-sections.ts';
import { countCodeLines } from '../output/validate.ts';
import type { ValidationIssue } from '../record.ts';
import { defineTask } from './define.ts';

// tutor.hint: a hint at the learner's current authored hint level, adapted to their code
// (docs/design/ai-system.md#tutorhint). Not streamed: the whole hint is checked for answer leaks
// before it is shown. What the model may see per level is decided by the service and the
// ContextSource (D-010), not by this prompt.

export const hintLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type HintLevel = z.infer<typeof hintLevelSchema>;

export const tutorHintInputSchema = z
  .object({
    exerciseId: z.string().min(1),
    level: hintLevelSchema,
    /** Must not exceed what the learner unlocked; `hintLevel` equals `level` (service layer). */
    access: z.object({
      hintLevel: hintLevelSchema,
      solutionViewed: z.boolean(),
    }),
    currentCode: tutorCodeFilesSchema.optional(),
    /** The learner's last answer for non-code exercises, summarized (untrusted). */
    lastAnswer: z.string().max(2_000).optional(),
    lastRunResult: tutorRunSummarySchema.optional(),
  })
  .refine((i) => i.access.hintLevel === i.level, {
    message: 'access.hintLevel은 level과 같아야 합니다.',
    path: ['access', 'hintLevel'],
  });
export type TutorHintInput = z.infer<typeof tutorHintInputSchema>;

export const tutorHintOutputSchema = z.object({
  level: hintLevelSchema,
  hintMarkdown: z.string().trim().min(1).max(1_200),
  focusLine: z.int().positive().nullable().default(null),
  checkQuestion: z.string().trim().max(200).nullable().default(null),
});
export type TutorHintOutput = z.infer<typeof tutorHintOutputSchema>;

/** Code lines allowed in a hint per level (1: none, 2: partial, 3: guided outline). */
export const HINT_CODE_LINE_LIMITS: Record<HintLevel, number> = { 1: 0, 2: 3, 3: 8 };

const instructions = (level: HintLevel) => `[현재 작업: 힌트 ${level}단계]
- 1단계: 어떤 방향으로 생각해야 하는지만 알려준다. 코드는 쓰지 않는다.
- 2단계: 필요한 핵심 개념과, 학습자 코드에서 고쳐야 할 위치를 알려준다. 코드는 3줄 이내의 일부만.
- 3단계: 해결 단계를 순서대로 안내한다. 코드는 8줄 이내이며, 핵심 부분은 빈칸(___)으로 남긴다.
- 지금은 ${level}단계다. 이 단계를 넘는 정보를 주지 않는다.
- 어떤 단계에서도 완성된 정답 코드, 정답 선택지, 기대 출력값을 쓰지 않는다.
- 학습자 코드가 이미 맞는 부분은 그렇다고 알려준다.
- 응답은 지정된 JSON 형식으로만 한다. hintMarkdown은 1200자 이내의 마크다운, focusLine은 학습자 코드에서
  주목할 줄 번호(없으면 null), checkQuestion은 학습자가 스스로 생각해 볼 짧은 질문(없으면 null)이다.`;

export const tutorHint = defineTask<TutorHintInput, TutorHintOutput>({
  name: 'tutor.hint',
  version: 1,
  role: 'tutor',
  priority: 'interactive',
  inputSchema: tutorHintInputSchema,
  streaming: false,
  stripMeta: false,
  effort: 'low',
  timeoutMs: 45_000,
  retry: { onBadOutput: 1, onTransient: 1, onPolicy: 1 },
  thread: 'ephemeral',
  context: {
    totalBudgetTokens: 7_000,
    sections: [
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
        kind: 'learner_code',
        required: false,
        priority: 9,
        maxTokens: 2_500,
        load: (_src, input) => Promise.resolve(learnerCodeSection(input.currentCode)),
      },
      {
        kind: 'run_result',
        required: false,
        priority: 9,
        maxTokens: 500,
        // Failed check names and descriptions only from level 2 (docs: 힌트 단계별 정보).
        load: (_src, input) =>
          Promise.resolve(
            runResultSection(
              input.lastRunResult && input.level < 2
                ? { ...input.lastRunResult, failedChecks: [] }
                : input.lastRunResult,
            ),
          ),
      },
      {
        kind: 'learner_state',
        required: false,
        priority: 8,
        maxTokens: 600,
        load: async (src, input) => {
          const ids = await conceptIdsFor(src, input, input.access);
          return learnerStateSection(await src.conceptStates(ids));
        },
      },
      {
        kind: 'attempt_history',
        required: false,
        priority: 7,
        maxTokens: 600,
        load: async (src, input) =>
          attemptHistorySection(await src.attempts(input.exerciseId, { limit: 3 })),
      },
    ],
  },
  instructions: (input) => instructions(input.level),
  userMessage: (input, context) => {
    const parts = [...context.blocks];
    if (input.lastAnswer) parts.push(tag('learner_answer', {}, data(input.lastAnswer)));
    parts.push(
      tag(
        'learner_question',
        { entry_point: 'hint' },
        data(`힌트 ${input.level}단계를 제 상황에 맞게 주세요.`),
      ),
    );
    return parts.join('\n\n');
  },
  outputSchema: (input) => ({
    type: 'object',
    additionalProperties: false,
    required: ['level', 'hintMarkdown', 'focusLine', 'checkQuestion'],
    properties: {
      level: { type: 'integer', enum: [input.level] },
      hintMarkdown: { type: 'string', minLength: 1, maxLength: 1200 },
      focusLine: { type: ['integer', 'null'] },
      checkQuestion: { type: ['string', 'null'], maxLength: 200 },
    },
  }),
  parse: (text) => {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { output: null, issues: [{ rule: 'syntax', message: 'JSON이 아닙니다.' }] };
    }
    const parsed = tutorHintOutputSchema.safeParse(json);
    return parsed.success
      ? { output: parsed.data, issues: [] }
      : {
          output: null,
          issues: parsed.error.issues.slice(0, 5).map((i) => ({
            rule: 'schema',
            message: `${i.path.join('.') || '(root)'}: ${i.message}`,
          })),
        };
  },
  visibleText: (output) =>
    output.checkQuestion
      ? `${output.hintMarkdown}\n\n${output.checkQuestion}`
      : output.hintMarkdown,
  postValidate: (output, input) => {
    const issues: ValidationIssue[] = [];
    if (output.level !== input.level) {
      issues.push({ rule: 'level', message: `요청한 ${input.level}단계가 아닙니다.` });
    }
    const limit = HINT_CODE_LINE_LIMITS[input.level];
    const lines = countCodeLines(output.hintMarkdown);
    if (lines > limit) {
      issues.push({ rule: 'code_lines', message: `코드 ${lines}줄(허용 ${limit}줄)` });
    }
    return issues;
  },
});
