// Section rendering in XML-style tags (docs/design/ai-system.md#프롬프트-인젝션-대응). Learner input,
// content text and earlier AI output are data: they go inside tags, and any text that could
// open or close one of our tags is neutralized so data cannot break out of its block.

/** Tag names the prompts use. Data containing `<name` or `</name` for these is escaped. */
export const RESERVED_TAGS = [
  'learner_state',
  'concept',
  'prerequisite',
  'active_misconceptions',
  'misconception',
  'misconception_catalog',
  'past_summaries',
  'summary',
  'thread_summary',
  'previous_summary',
  'messages',
  'grading_result',
  'check',
  'attempt_detail',
  'exercise',
  'prompt',
  'code',
  'public_spec',
  'opened_hints',
  'hint',
  'solution',
  'explanation',
  'learner_code',
  'run_result',
  'console',
  'error',
  'failed_check',
  'attempt_history',
  'attempt',
  'lesson',
  'lesson_section',
  'conversation_so_far',
  'message',
  'selection',
  'learner_question',
  'learner_input',
  'learner_answer',
  'meta',
  'context',
  'instructions',
  'system',
] as const;

const RESERVED_PATTERN = new RegExp(`<(/?)\\s*(${RESERVED_TAGS.join('|')})\\b`, 'gi');

/** Escapes `<` where it would start one of our tags; everything else stays verbatim (code). */
export function neutralize(text: string): string {
  return text.replace(RESERVED_PATTERN, (_m, slash: string, name: string) => `&lt;${slash}${name}`);
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n]+/g, ' ');
}

export type Attrs = Record<string, string | number | boolean | null | undefined>;

function renderAttrs(attrs: Attrs): string {
  return Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('');
}

/** `<name a="1">body</name>`; `body` must already be rendered (use {@link data} for raw text). */
export function tag(name: string, attrs: Attrs, body: string | null): string {
  if (body === null) return `<${name}${renderAttrs(attrs)}/>`;
  return `<${name}${renderAttrs(attrs)}>\n${body}\n</${name}>`;
}

/** Untrusted text as a tag body. */
export function data(text: string): string {
  return neutralize(text.replace(/\r\n?/g, '\n'));
}

/** Clips a string to `max` characters with an ellipsis (summaries of long values). */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}
