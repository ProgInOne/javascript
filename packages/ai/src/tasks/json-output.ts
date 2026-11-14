import type { z } from 'zod';
import type { ParsedOutput } from './define.ts';

/**
 * Syntax and schema validation of a structured-output reply (docs/design/ai-system.md#출력-검증
 * steps 1–2). `prepare` may normalize the parsed JSON first (clip overlong lists and strings).
 */
export function parseJsonOutput<T>(
  text: string,
  schema: z.ZodType<T>,
  prepare: (value: unknown) => unknown = (v) => v,
): ParsedOutput<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { output: null, issues: [{ rule: 'syntax', message: 'JSON이 아닙니다.' }] };
  }
  const parsed = schema.safeParse(prepare(json));
  return parsed.success
    ? { output: parsed.data, issues: [] }
    : {
        output: null,
        issues: parsed.error.issues.slice(0, 5).map((i) => ({
          rule: 'schema',
          message: `${i.path.join('.') || '(root)'}: ${i.message}`,
        })),
      };
}
