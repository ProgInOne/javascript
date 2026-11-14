import { tutorHint } from './tutor-hint.ts';
import { tutorReply } from './tutor-reply.ts';

/** Registered tasks (v0.1: the two tutor tasks). */
export const TASKS = {
  'tutor.reply': tutorReply,
  'tutor.hint': tutorHint,
} as const;

export type TaskName = keyof typeof TASKS;
