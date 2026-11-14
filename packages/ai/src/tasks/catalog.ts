import { explainMistake } from './evaluator-explain-mistake.ts';
import { misconceptionPropose } from './misconception-propose.ts';
import { sessionSummarize } from './session-summarize.ts';
import { tutorHint } from './tutor-hint.ts';
import { tutorReply } from './tutor-reply.ts';

/** Registered tasks (docs/design/ai-system.md#작업-목록-요약). */
export const TASKS = {
  'tutor.reply': tutorReply,
  'tutor.hint': tutorHint,
  'session.summarize': sessionSummarize,
  'evaluator.explainMistake': explainMistake,
  'misconception.propose': misconceptionPropose,
} as const;

export type TaskName = keyof typeof TASKS;
