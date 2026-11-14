/**
 * Test fixtures: one fully populated raw spec per implemented type. Every answer-key field holds
 * the sentinel word `secret`, so redaction tests can assert that it never reaches a public spec.
 */
export const SENTINEL = 'secret';

/** Keys that must never appear anywhere in a public spec. */
export const ANSWER_KEY_FIELDS = [
  'correct',
  'rationale',
  'misconception',
  'accept',
  'acceptRegex',
  'misconceptionMap',
  'expected',
  'misconceptionByAnswer',
  'solution',
  'misconceptionIfFail',
  'bugMisconception',
] as const;

export const RAW_SPECS: Record<string, unknown> = {
  mcq_single: {
    options: [
      { id: 'a', text: '`8`', misconception: 'js.mc.secret-a', rationale: 'secret rationale' },
      { id: 'b', text: '`undefined`' },
      { id: 'c', text: '`null`', misconception: 'js.mc.secret-c' },
    ],
    correct: 'b',
  },
  fill_blank: {
    mode: 'text',
    template: 'function f() {\n  {{blank:b1}} 1;\n}',
    blanks: [
      {
        id: 'b1',
        accept: ['secret'],
        acceptRegex: 'secret|return',
        width: 8,
        misconceptionMap: { 'console.log': 'js.mc.secret-log' },
      },
    ],
  },
  predict_output: {
    code: 'console.log(1)',
    answerKind: 'choice',
    choices: [
      { id: 'a', text: '1' },
      { id: 'b', text: '2' },
    ],
    expected: { kind: 'choice', choiceId: 'a' },
    misconceptionByAnswer: { b: 'js.mc.secret-b' },
  },
};

/** Collects every object key in a JSON-like value. */
export function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) collectKeys(item, out);
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      out.add(key);
      collectKeys(child, out);
    }
  }
  return out;
}
