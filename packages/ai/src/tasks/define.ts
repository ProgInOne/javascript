import type { z } from 'zod';
import type { BuiltContext, ContextSpec } from '../context/builder.ts';
import type { TaskPriority } from '../provider/gate.ts';
import type { ReasoningEffort } from '../provider/types.ts';
import type { ValidationIssue } from '../record.ts';

// AI task definition (docs/design/ai-system.md#aitask-정의-형식): one file per task holds its
// prompt, schemas, context spec, validation and retry policy so it can be reviewed in one place.

export interface ParsedOutput<O> {
  output: O | null;
  /** Syntax/schema problems (`rule: 'syntax' | 'schema'`). */
  issues: ValidationIssue[];
}

export interface AITaskDefinition<I, O> {
  name: string;
  /** Bump when instructions, output schema or context spec change. */
  version: number;
  role: 'tutor' | 'evaluator' | 'generator' | 'analyst' | 'author';
  priority: TaskPriority;
  inputSchema: z.ZodType<I>;
  /** Stream visible markdown to the caller while the turn runs. */
  streaming: boolean;
  /** The reply ends with a `<meta>` block that is hidden from the learner. */
  stripMeta: boolean;
  context: ContextSpec<I>;
  /** Role instructions (`developerInstructions`). */
  instructions(input: I): string;
  /** The user message: context blocks plus the learner's request. */
  userMessage(input: I, context: BuiltContext): string;
  /** JSON Schema for structured output, when the task has one. */
  outputSchema?(input: I): Record<string, unknown>;
  parse(text: string, input: I): ParsedOutput<O>;
  /** Text checked by the output guard after the turn (and stored/shown). */
  visibleText(output: O): string;
  /** Task-specific semantic rules (code line limits, level match, …). */
  postValidate?(output: O, input: I): ValidationIssue[];
  effort: ReasoningEffort;
  timeoutMs: number;
  firstDeltaTimeoutMs?: number;
  retry: {
    /** Retries after a syntax/schema failure. */
    onBadOutput: 0 | 1;
    /** Retries after an overload or transient provider error. */
    onTransient: 0 | 1 | 2;
    /** Retries after a policy violation (answer leak, tool attempt). */
    onPolicy: 0 | 1;
  };
  /** `tutor-thread` reuses a persistent provider thread per tutor thread. */
  thread: 'tutor-thread' | 'ephemeral';
}

export function defineTask<I, O>(task: AITaskDefinition<I, O>): AITaskDefinition<I, O> {
  return task;
}

/** `{taskName}@{version}` plus the base version: changes force a provider-thread rebuild. */
export function instructionsVersion(
  task: Pick<AITaskDefinition<unknown, unknown>, 'name' | 'version'>,
  baseVersion: number,
): string {
  return `${baseVersion}:${task.name}@${task.version}`;
}
