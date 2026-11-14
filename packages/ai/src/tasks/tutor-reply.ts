import {
  tutorCodeFilesSchema,
  tutorEntryPointSchema,
  tutorReplyMetaSchema,
  tutorRunSummarySchema,
  tutorSelectionSchema,
  type TutorReplyMeta,
} from '@proginone/shared';
import { z } from 'zod';
import { data, tag } from '../context/sections.ts';
import {
  attemptHistorySection,
  conceptIdsFor,
  conversationSection,
  exerciseSection,
  learnerCodeSection,
  learnerStateSection,
  lessonSection,
  runResultSection,
} from '../context/tutor-sections.ts';
import { metaStart } from '../output/stream.ts';
import { exerciseAccessSchema } from './access.ts';
import { defineTask } from './define.ts';

// tutor.reply: free questions in the tutor drawer, "선택해서 질문하기", "왜 실패했나요?"
// (docs/design/ai-system.md#tutorreply). Streamed markdown plus a hidden `<meta>` block.

export const tutorReplyInputSchema = z
  .object({
    threadId: z.string().min(1),
    question: z.string().trim().min(1).max(4_000),
    entryPoint: tutorEntryPointSchema,
    selection: tutorSelectionSchema.optional(),
    lessonId: z.string().min(1).optional(),
    exerciseId: z.string().min(1).optional(),
    /** Required with `exerciseId`: what the learner has unlocked (service layer, D-010). */
    access: exerciseAccessSchema.optional(),
    currentCode: tutorCodeFilesSchema.optional(),
    lastRunResult: tutorRunSummarySchema.optional(),
    /** Messages of the turn being answered (already stored, not "history"). */
    excludeMessageIds: z.array(z.string()).default([]),
  })
  .refine((i) => i.exerciseId === undefined || i.access !== undefined, {
    message: 'exerciseId에는 access가 필요합니다.',
    path: ['access'],
  });
export type TutorReplyInput = z.infer<typeof tutorReplyInputSchema>;

export interface TutorReplyOutput {
  markdown: string;
  /** `null` when the block is missing or invalid (ignored, docs: 메타데이터 파싱 실패는 무시). */
  meta: TutorReplyMeta | null;
}

const META_FORMAT = `{"referencedConcepts": ["개념 ID", …최대 5개], "suggestedFollowUp": "none" | "try_exercise" | "review_prerequisite" | "read_section", "followUpTarget": "개념 또는 섹션 ID(선택)", "possibleMisconception": {"description": "학습자가 가진 것 같은 오개념(선택, 300자 이내)"}}`;

const INSTRUCTIONS = `[현재 작업: 튜터 답변]
- 학습자의 질문(<learner_question>)에 답한다. 질문이 현재 레슨(<lesson>)이나 문제(<exercise>)와 관련 있으면 그 맥락에서 답한다.
- 학습자가 문제를 푸는 중이고 정답을 아직 열람하지 않았다면(<exercise state="solving">),
  정답 코드, 정답 선택지, 기대 출력값을 직접 말하지 않는다. 대신 학습자 코드에서 살펴볼 지점과
  관련 개념을 짚는다. 학습자가 정답을 요구하면 화면의 "힌트 보기"나 "정답 보기"를 쓰도록 안내한다.
- <exercise state="solution_viewed">이면 정답과 해설을 바탕으로 왜 그렇게 되는지 설명해도 된다.
- 학습자가 같은 지점에서 여러 번 막혔다면(<conversation_so_far>, <attempt_history>) 질문을 줄이고 직접 설명으로 전환한다.
- 질문이 ProgInOne 학습 범위(HTML/CSS/JavaScript, 웹 기초)를 벗어나면 짧게 답하고 학습으로 돌아오게 돕는다.
- 답변 마지막 줄에 <meta>{...}</meta> 형식으로 메타데이터 JSON을 붙인다. 이 블록은 학습자에게 보이지 않는다.
  형식: ${META_FORMAT}
  referencedConcepts에는 메시지에 나온 개념 ID만 쓴다.`;

/** Splits the reply into visible markdown and the parsed `<meta>` block. */
export function parseTutorReply(text: string): TutorReplyOutput {
  const at = metaStart(text);
  if (at < 0) return { markdown: text.trim(), meta: null };
  const markdown = text.slice(0, at).trim();
  const rest = text.slice(at + '<meta>'.length);
  const close = rest.toLowerCase().indexOf('</meta>');
  const json = (close >= 0 ? rest.slice(0, close) : rest).trim();
  let meta: TutorReplyMeta | null = null;
  try {
    const parsed = tutorReplyMetaSchema.safeParse(JSON.parse(json));
    if (parsed.success) meta = parsed.data;
  } catch {
    meta = null;
  }
  return { markdown, meta };
}

export const tutorReply = defineTask<TutorReplyInput, TutorReplyOutput>({
  name: 'tutor.reply',
  version: 1,
  role: 'tutor',
  priority: 'interactive',
  inputSchema: tutorReplyInputSchema,
  streaming: true,
  stripMeta: true,
  effort: 'low',
  timeoutMs: 90_000,
  firstDeltaTimeoutMs: 20_000,
  retry: { onBadOutput: 1, onTransient: 1, onPolicy: 1 },
  thread: 'tutor-thread',
  context: {
    totalBudgetTokens: 12_000,
    sections: [
      {
        kind: 'learner_state',
        required: true,
        priority: 10,
        maxTokens: 800,
        load: async (src, input) => {
          const ids = await conceptIdsFor(src, input, input.access);
          return learnerStateSection(await src.conceptStates(ids));
        },
      },
      {
        kind: 'exercise',
        required: (input) => input.exerciseId !== undefined,
        priority: 9,
        maxTokens: 1_500,
        load: async (src, input) => {
          if (!input.exerciseId || !input.access) return null;
          const ex = await src.exercise(input.exerciseId, input.access);
          return ex ? exerciseSection(ex) : null;
        },
      },
      {
        kind: 'learner_code',
        required: (input) => input.currentCode !== undefined,
        priority: 9,
        maxTokens: 2_500,
        load: (_src, input) => Promise.resolve(learnerCodeSection(input.currentCode)),
      },
      {
        kind: 'run_result',
        required: false,
        priority: 9,
        maxTokens: 500,
        load: (_src, input) => Promise.resolve(runResultSection(input.lastRunResult)),
      },
      {
        kind: 'attempt_history',
        required: false,
        priority: 7,
        maxTokens: 800,
        load: async (src, input) =>
          input.exerciseId
            ? attemptHistorySection(await src.attempts(input.exerciseId, { limit: 5 }))
            : null,
      },
      {
        kind: 'lesson',
        required: false,
        priority: 6,
        maxTokens: 2_000,
        load: async (src, input) => {
          if (!input.lessonId) return null;
          const lesson = await src.lesson(input.lessonId, {
            sectionId: input.selection?.sectionId ?? null,
          });
          return lesson ? lessonSection(lesson) : null;
        },
      },
      {
        kind: 'conversation_so_far',
        required: false,
        priority: 5,
        maxTokens: 2_500,
        load: async (src, input, env) =>
          env.rehydrate
            ? conversationSection(
                await src.threadMessages(input.threadId, {
                  limit: 12,
                  excludeMessageIds: input.excludeMessageIds,
                }),
              )
            : null,
      },
    ],
  },
  instructions: () => INSTRUCTIONS,
  userMessage: (input, context) => {
    const parts = [...context.blocks];
    if (input.selection) {
      parts.push(
        tag(
          'selection',
          { kind: input.selection.kind, section: input.selection.sectionId },
          data(input.selection.text),
        ),
      );
    }
    parts.push(tag('learner_question', { entry_point: input.entryPoint }, data(input.question)));
    return parts.join('\n\n');
  },
  parse: (text) => {
    const output = parseTutorReply(text);
    return output.markdown === ''
      ? { output: null, issues: [{ rule: 'syntax', message: '빈 답변입니다.' }] }
      : { output, issues: [] };
  },
  visibleText: (output) => output.markdown,
});
