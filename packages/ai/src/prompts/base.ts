import { LANGUAGE } from './language.ts';
import { PERSONA } from './persona.ts';
import { SAFETY } from './safety.ts';

/**
 * Version of the common instructions (persona, language, safety). Persistent tutor threads are
 * rebuilt on their next turn when it changes, because instructions are fixed at thread start
 * (docs/design/ai-system.md#프롬프트-버전-관리).
 */
export const BASE_INSTRUCTIONS_VERSION = 1;

/** `baseInstructions` of every ProgInOne thread: replaces Codex's coding-agent instructions. */
export function baseInstructions(): string {
  return [PERSONA, LANGUAGE, SAFETY].join('\n\n');
}
