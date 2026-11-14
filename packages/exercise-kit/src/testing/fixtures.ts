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
  'missedMisconception',
  'misconceptionIfWrong',
  'answer',
  'distractors',
  'alternatives',
  'replaces',
  'bugLines',
  'acceptLines',
  'symptomCheck',
  'fixedCode',
] as const;

const JS_STARTER = { files: [{ path: 'main.js', content: 'function sum(a) {\n  // 여기에\n}\n' }] };
const JS_SOLUTION = {
  files: [
    {
      path: 'main.js',
      content: 'function sum(a) {\n  return a.reduce((s, n) => s + n, 0); // secret\n}\n',
    },
  ],
};
const CODE_CHECKS = [
  // Visible: expectation is public by design, but misconceptionIfFail must still be removed.
  {
    kind: 'call',
    id: 'basic',
    args: [[1, 2]],
    expect: { equals: 3 },
    misconceptionIfFail: 'js.mc.secret-v',
  },
  // Hidden: inputs and expectation hold the sentinel.
  {
    kind: 'call',
    id: 'hidden',
    visible: false,
    description: '음수도 더합니다.',
    requirement: '음수 처리',
    args: [['secret']],
    expect: { equals: 'secret' },
    misconceptionIfFail: 'js.mc.secret-h',
  },
  {
    kind: 'call',
    id: 'expr',
    visible: false,
    argsExpr: '[new Map([["secret", 1]])]',
    expect: { equalsLiteral: '"secret"' },
  },
  { kind: 'console', id: 'out', visible: false, expect: { lines: ['secret'] } },
  { kind: 'program', id: 'prog', expect: { globals: { secret: { equals: 'secret' } } } },
  { kind: 'static', id: 'no-var', rule: 'forbid-identifier', value: 'secret', message: 'secret' },
];

export const RAW_SPECS: Record<string, unknown> = {
  mcq_single: {
    options: [
      { id: 'a', text: '`8`', misconception: 'js.mc.secret-a', rationale: 'secret rationale' },
      { id: 'b', text: '`undefined`' },
      { id: 'c', text: '`null`', misconception: 'js.mc.secret-c' },
    ],
    correct: 'b',
  },
  mcq_multi: {
    options: [
      { id: 'a', text: '`let`', missedMisconception: 'js.mc.secret-missed' },
      { id: 'b', text: '`var`', misconception: 'js.mc.secret-b', rationale: 'secret rationale' },
      { id: 'c', text: '`const`' },
      { id: 'd', text: '`int`', misconception: 'js.mc.secret-d' },
    ],
    correct: ['a', 'c'],
    minSelect: 2,
  },
  true_false: {
    statement: '`const`로 선언한 배열에는 `push`를 할 수 없다.',
    answer: false,
    misconceptionIfWrong: 'js.mc.secret-wrong',
    requireReason: true,
    reasons: [
      { id: 'r1', text: 'const는 재할당만 막는다', correct: true },
      { id: 'r2', text: 'const는 값 내부 변경도 막는다', misconception: 'js.mc.secret-r2' },
    ],
  },
  parsons: {
    lines: [
      { id: 'secret1', code: 'function sum(arr) {' },
      { id: 'secret2', code: 'let total = 0;', indent: 1 },
      { id: 'secret3', code: 'for (const n of arr) total += n;', indent: 1 },
      { id: 'secret4', code: 'return total;', indent: 1 },
      { id: 'secret5', code: '}' },
    ],
    distractors: [
      { id: 'secret6', code: 'total = n;', misconception: 'js.mc.secret-d', replaces: 'secret3' },
    ],
    alternatives: [],
  },
  find_bug_line: {
    code: 'const prices = [100, 200];\nlet total;\nfor (const p of prices) total += p;\nconsole.log(total);',
    bugLines: [2],
    acceptLines: [3],
    symptom: '출력이 `NaN`입니다.',
    symptomCheck: { console: ['secret'] },
    fixedCode:
      'const prices = [100, 200];\nlet total = 0; // secret\nfor (const p of prices) total += p;\nconsole.log(total);',
    causeOptions: [
      { id: 'c1', text: 'total이 undefined에서 시작한다', correct: true },
      { id: 'c2', text: 'for...of는 배열에 쓸 수 없다', misconception: 'js.mc.secret-c2' },
    ],
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
  implement_function: {
    starter: JS_STARTER,
    entry: 'sum',
    solution: JS_SOLUTION,
    checks: CODE_CHECKS,
    limits: { timeoutMs: 2000 },
  },
  fix_bug: {
    buggy: JS_STARTER,
    entry: 'sum',
    solution: JS_SOLUTION,
    checks: CODE_CHECKS,
    bugDescription: '합이 항상 undefined입니다.',
    maxEditDistance: 30,
    bugMisconception: 'js.mc.secret-bug',
  },
  web_task: {
    focus: 'css',
    starter: { files: [{ path: 'index.html', content: '<ul class="cards"></ul>' }] },
    solution: {
      files: [
        { path: 'index.html', content: '<style>.cards{display:flex}</style><!-- secret -->' },
      ],
    },
    checks: [
      {
        kind: 'dom',
        id: 'has-list',
        visible: true,
        selector: 'ul.cards',
        expect: { exists: true },
      },
      {
        kind: 'css',
        id: 'flex',
        selector: '.secret',
        expect: { computed: { display: { equals: 'secret' } } },
      },
      { kind: 'layout', id: 'row', a: '.secret-a', b: '.secret-b', relation: 'left-of' },
      {
        kind: 'event',
        id: 'add',
        steps: [{ action: 'type', selector: '#secret', value: 'secret' }],
        expect: [{ selector: 'li', text: { equals: 'secret' } }],
      },
      { kind: 'a11y', id: 'alt', rules: ['secret-rule'] },
      { kind: 'html-valid', id: 'valid', rules: ['secret-rule'] },
    ],
    milestones: [{ id: 'm1', title: '목록 만들기', checks: ['has-list', 'flex'] }],
  },
};

/** Additional raw specs for type variants (fill_blank code mode, parsons with checks). */
export const EXTRA_RAW_SPECS: [typeId: string, spec: unknown][] = [
  [
    'parsons',
    {
      lines: [
        { id: 'secret1', code: 'function sum(a) {' },
        { id: 'secret2', code: 'return a.reduce((s, n) => s + n, 0);', indent: 1 },
        { id: 'secret3', code: '}' },
      ],
      distractors: [{ id: 'secret4', code: 'return 0;', misconception: 'js.mc.secret-p' }],
      gradeIndent: false,
      entry: 'sum',
      checks: CODE_CHECKS,
    },
  ],
  [
    'fill_blank',
    {
      mode: 'code',
      template: 'function add(a, b) {\n  return {{blank:b1}};\n}',
      entry: 'add',
      blanks: [{ id: 'b1', accept: ['secret'], misconceptionMap: { 'a - b': 'js.mc.secret-m' } }],
      checks: CODE_CHECKS,
    },
  ],
];

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
