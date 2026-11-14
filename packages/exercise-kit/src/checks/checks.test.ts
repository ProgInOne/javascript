import { describe, expect, it } from 'vitest';

import { logEntries, makeRun, returned, sv } from '../testing/run.ts';
import { gradeChecks } from './aggregate.ts';
import { compileChecks } from './compile.ts';
import { cssValueMatches, deltaE2000, parseColor, parsePx, toLab } from './css.ts';
import { relationHolds } from './evaluate.ts';
import { checkListSchema, checkSchema, redactCheck, type Check } from './schema.ts';

const checks = (raw: unknown[]): Check[] => checkListSchema.parse(raw);
const one = (raw: unknown, observations: unknown[], extra: Parameters<typeof makeRun>[1] = {}) =>
  gradeChecks({ checks: checks([raw]), run: makeRun(observations, extra), entry: 'f' })
    .checkResults[0];

describe('check schema', () => {
  it('requires exactly one expectation key and valid literals', () => {
    const base = { kind: 'call', id: 'c', args: [1] };
    expect(checkSchema.safeParse({ ...base, expect: { equals: 1 } }).success).toBe(true);
    expect(checkSchema.safeParse({ ...base, expect: { equals: 1, strictEquals: 1 } }).success).toBe(
      false,
    );
    expect(checkSchema.safeParse({ ...base, expect: { equalsLiteral: 'alert(1)' } }).success).toBe(
      false,
    );
    expect(checkSchema.safeParse({ ...base, expect: {} }).success).toBe(false);
    expect(
      checkSchema.safeParse({
        kind: 'call',
        id: 'c',
        argsExpr: '[x]',
        expect: { argsUnchanged: true },
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate check ids, unknown kinds and malformed layout checks', () => {
    const c = { kind: 'call', id: 'a', expect: { equals: 1 } };
    expect(checkListSchema.safeParse([c, c]).success).toBe(false);
    expect(checkSchema.safeParse({ kind: 'eval', id: 'x', code: 'alert(1)' }).success).toBe(false);
    expect(
      checkSchema.safeParse({ kind: 'layout', id: 'l', a: '.a', relation: 'left-of' }).success,
    ).toBe(false);
    expect(
      checkSchema.safeParse({
        kind: 'layout',
        id: 'l',
        a: '.a',
        container: '.c',
        relation: 'fills-width',
      }).success,
    ).toBe(true);
  });

  it('redacts hidden checks to metadata and strips misconceptions from visible ones', () => {
    const [visible, hidden] = checks([
      { kind: 'call', id: 'v', args: [1], expect: { equals: 2 }, misconceptionIfFail: 'js.mc.x' },
      {
        kind: 'css',
        id: 'h',
        selector: '.a',
        description: 'd',
        requirement: 'r',
        weight: 2,
        expect: { computed: { color: { color: 'red' } } },
      },
    ]);
    if (!visible || !hidden) throw new Error('fixture');
    expect(redactCheck(visible)).toEqual({
      kind: 'call',
      id: 'v',
      args: [1],
      expect: { equals: 2 },
      weight: 1,
      visible: true,
      required: true,
    });
    expect(redactCheck(hidden)).toEqual({
      id: 'h',
      kind: 'css',
      description: 'd',
      requirement: 'r',
      weight: 2,
      visible: false,
      required: true,
    });
  });
});

describe('compileChecks', () => {
  const list = checks([
    {
      kind: 'event',
      id: 'ev',
      steps: [
        { action: 'type', selector: '#i', value: 'x' },
        { action: 'click', selector: '#b' },
        { action: 'wait', ms: 500 },
      ],
      expect: [{ selector: 'li', count: 1, parentSelector: 'ul' }],
    },
    { kind: 'call', id: 'c1', args: [[1, 2]], expect: { argsUnchanged: true } },
    {
      kind: 'css',
      id: 'm',
      selector: '.a',
      viewport: 375,
      expect: { computed: { display: { equals: 'block' } } },
    },
    {
      kind: 'dom',
      id: 'd',
      selector: 'ul',
      expect: { order: ['li', 'li'], attr: { name: 'role' } },
    },
    { kind: 'console', id: 'out', promptInputs: ['철수'], expect: { lines: ['a'] } },
    {
      kind: 'program',
      id: 'p',
      expect: { globals: { total: { equals: 1 }, count: { equals: 2 } } },
    },
    { kind: 'static', id: 's', rule: 'forbid-identifier', value: 'var' },
  ]);

  it('orders steps: settle → program state → DOM state by viewport → calls → events', () => {
    const { bundle, stdin } = compileChecks(list, {
      entry: 'f',
      defaultViewport: 1280,
      timers: 'real',
      purpose: 'grading',
    });
    expect(bundle.steps.map((s) => `${s.op}:${s.id}`)).toEqual([
      'waitSettled:settle',
      'consoleOutput:out#0',
      'readGlobal:p#0',
      'readGlobal:p#1',
      'domQuery:d#q',
      'domQuery:d#q.order',
      'setViewport:viewport#375',
      'computedStyle:m#0',
      'setViewport:viewport#1280',
      'callFunction:c1#0',
      'dispatch:ev#s0',
      'dispatch:ev#s1',
      'waitSettled:ev#s2',
      'waitSettled:ev#settle',
      'domQuery:ev#e0',
      'domQuery:ev#e0.parent',
    ]);
    expect(bundle.expose.sort()).toEqual(['count', 'f', 'total']);
    expect(stdin).toEqual(['철수']);
    const call = bundle.steps.find((s) => s.op === 'callFunction');
    expect(call).toMatchObject({ name: 'f', args: [sv([1, 2])], observeArgsAfter: true });
  });

  it('never puts expected values into steps', () => {
    const secretChecks = checks([
      { kind: 'call', id: 'c', args: [1], expect: { equals: 'secret-expected' } },
      { kind: 'console', id: 'o', expect: { lines: ['secret-expected'] } },
      {
        kind: 'css',
        id: 'k',
        selector: '.a',
        expect: { computed: { color: { color: '#secret' } } },
      },
      { kind: 'dom', id: 'd', selector: 'p', expect: { text: { equals: 'secret-expected' } } },
    ]);
    const { bundle } = compileChecks(secretChecks, {
      entry: 'f',
      timers: 'real',
      purpose: 'grading',
    });
    expect(JSON.stringify(bundle)).not.toContain('secret');
  });

  it('keeps only visible checks for interactive runs and uses advance with virtual timers', () => {
    const interactive = compileChecks(list, { entry: 'f', timers: 'real', purpose: 'interactive' });
    expect(interactive.checks.map((c) => c.id)).toEqual(['c1', 'out']);
    const virtual = compileChecks(list, { entry: 'f', timers: 'virtual', purpose: 'grading' });
    expect(virtual.bundle.steps.find((s) => s.id === 'ev#s2')).toEqual({
      op: 'advance',
      id: 'ev#s2',
      ms: 500,
    });
  });
});

describe('check evaluation', () => {
  it('call: deep equality with first-difference detail and failure reasons', () => {
    const check = { kind: 'call', id: 'c', args: [[1]], expect: { equals: [{ price: 300 }] } };
    expect(one(check, [returned('c#0', [{ price: 300 }])])?.passed).toBe(true);
    expect(one(check, [returned('c#0', [{ price: '300' }])])).toMatchObject({
      passed: false,
      reason: 'MISMATCH',
      detail: { path: '[0].price', expected: '300', actual: '"300"' },
    });
    expect(one(check, [{ op: 'callFunction', id: 'c#0', outcome: 'missing' }])?.reason).toBe(
      'MISSING_IDENTIFIER',
    );
    expect(
      one(check, [
        {
          op: 'callFunction',
          id: 'c#0',
          outcome: 'threw',
          thrown: { t: 'error', name: 'TypeError', message: 'x' },
        },
      ])?.reason,
    ).toBe('THREW');
    expect(one(check, [])?.reason).toBe('NOT_OBSERVED');
    expect(one(check, [{ ...returned('c#0', 1), status: 'timeout' }])?.reason).toBe('STEP_TIMEOUT');
    expect(one(check, [{ op: 'domQuery', id: 'c#0', count: 0, items: [] }])?.reason).toBe(
      'NOT_OBSERVED',
    );
  });

  it('call: strictEquals, closeTo, matches, throws, argsUnchanged, returnsNewReference', () => {
    const base = { kind: 'call', id: 'c', args: [[2, 1]] };
    expect(
      one({ ...base, expect: { strictEqualsLiteral: '-0' } }, [
        { op: 'callFunction', id: 'c#0', outcome: 'returned', value: { t: 'number', v: 0 } },
      ])?.passed,
    ).toBe(false);
    expect(
      one({ ...base, expect: { closeTo: { value: 0.3 } } }, [returned('c#0', 0.1 + 0.2)])?.passed,
    ).toBe(true);
    expect(
      one({ ...base, expect: { matches: { type: 'array', length: 2, contains: [1] } } }, [
        returned('c#0', [3, 1]),
      ])?.passed,
    ).toBe(true);
    expect(
      one({ ...base, expect: { matches: { contains: [5] } } }, [returned('c#0', [3, 1])])?.passed,
    ).toBe(false);
    const throwsCheck = {
      ...base,
      expect: { throws: { name: 'TypeError', messageIncludes: 'empty' } },
    };
    expect(
      one(throwsCheck, [
        {
          op: 'callFunction',
          id: 'c#0',
          outcome: 'threw',
          thrown: { t: 'error', name: 'TypeError', message: 'array is empty' },
        },
      ])?.passed,
    ).toBe(true);
    expect(one(throwsCheck, [returned('c#0', 1)])?.reason).toBe('DID_NOT_THROW');
    const unchanged = { ...base, expect: { argsUnchanged: true } };
    expect(one(unchanged, [returned('c#0', [1, 2], { argsAfter: [sv([2, 1])] })])?.passed).toBe(
      true,
    );
    expect(one(unchanged, [returned('c#0', [1, 2], { argsAfter: [sv([1, 2])] })])).toMatchObject({
      passed: false,
      reason: 'MUTATED_ARGS',
    });
    expect(one(unchanged, [returned('c#0', [1, 2])])?.reason).toBe('NOT_OBSERVED');
    const fresh = { ...base, expect: { returnsNewReference: true } };
    expect(one(fresh, [returned('c#0', [1, 2], { returnIsArg: [] })])?.passed).toBe(true);
    expect(one(fresh, [returned('c#0', [1, 2], { returnIsArg: [0] })])?.reason).toBe(
      'SAME_REFERENCE',
    );
  });

  it('console: exact (structural lines), contains, ordered-subset, trailing lines', () => {
    const obs = (...lines: string[]) => [
      { op: 'consoleOutput', id: 'o#0', entries: logEntries(...lines), truncated: false },
    ];
    const check = (expect: object) => ({ kind: 'console', id: 'o', expect });
    expect(one(check({ lines: ['[1, "a"]', 'b'] }), obs("[1,'a']", 'b'))?.passed).toBe(true);
    expect(one(check({ lines: ['a'] }), obs('a', 'extra'))).toMatchObject({
      passed: false,
      detail: { path: '2번째 줄' },
    });
    expect(one(check({ lines: ['a'], allowExtraTrailing: true }), obs('a', 'extra'))?.passed).toBe(
      true,
    );
    expect(one(check({ lines: ['c', 'a'], mode: 'contains' }), obs('a', 'b', 'c'))?.passed).toBe(
      true,
    );
    expect(
      one(check({ lines: ['c', 'a'], mode: 'ordered-subset' }), obs('a', 'b', 'c'))?.passed,
    ).toBe(false);
    expect(
      one(check({ lines: ['a', 'c'], mode: 'ordered-subset' }), obs('a', 'b', 'c'))?.passed,
    ).toBe(true);
  });

  it('program: globals and noError', () => {
    const check = {
      kind: 'program',
      id: 'p',
      expect: { globals: { total: { equals: 6 } }, noError: true },
    };
    const read = (value: number) => [
      { op: 'readGlobal', id: 'p#0', outcome: 'ok', value: sv(value) },
    ];
    expect(one(check, read(6))?.passed).toBe(true);
    expect(one(check, read(5))).toMatchObject({ passed: false, reason: 'MISMATCH' });
    expect(one(check, [{ op: 'readGlobal', id: 'p#0', outcome: 'missing' }])?.reason).toBe(
      'MISSING_IDENTIFIER',
    );
    expect(
      one(check, read(6), { errors: [{ phase: 'runtime', name: 'TypeError', message: 'x' }] })
        ?.reason,
    ).toBe('THREW');
  });

  it('dom: count, text normalization, attributes, tag, parent and order', () => {
    const q = (count: number, items: object[]) => ({ op: 'domQuery', id: 'd#q', count, items });
    const dom = (expect: object) => ({ kind: 'dom', id: 'd', selector: 'li', expect });
    expect(one(dom({ count: 3 }), [q(3, [])])?.passed).toBe(true);
    expect(one(dom({ count: { min: 1, max: 2 } }), [q(3, [])])?.passed).toBe(false);
    expect(
      one(dom({ text: { equals: '우유 사기' } }), [q(1, [{ text: '  우유   사기\n' }])])?.passed,
    ).toBe(true);
    expect(
      one(dom({ text: { includes: 'MILK', caseSensitive: false, all: true } }), [
        q(2, [{ text: 'milk' }, { text: 'bread' }]),
      ])?.passed,
    ).toBe(false);
    expect(
      one(dom({ attr: { name: 'alt', present: true, notEmpty: true } }), [
        q(1, [{ attrs: { alt: ' ' } }]),
      ])?.passed,
    ).toBe(false);
    expect(
      one(dom({ attr: { name: 'alt', present: true } }), [
        q(1, [{ attrs: JSON.parse('{"__proto__": "x"}') as object }]),
      ])?.passed,
    ).toBe(false);
    expect(one(dom({ tag: 'LI' }), [q(1, [{ tagName: 'li' }])])?.passed).toBe(true);
    expect(one(dom({ text: { equals: 'x' } }), [q(0, [])])?.reason).toBe('NOT_FOUND');
    expect(one(dom({ exists: false }), [q(0, [])])?.passed).toBe(true);
    expect(
      one(dom({ parentSelector: 'ul' }), [
        q(2, [{}]),
        { op: 'domQuery', id: 'd#q.parent', count: 1, items: [] },
      ])?.passed,
    ).toBe(false);
    const order = (tags: string[]) => [
      q(1, [{}]),
      {
        op: 'domQuery',
        id: 'd#q.order',
        count: tags.length,
        items: tags.map((tagName) => ({ tagName })),
      },
    ];
    expect(
      one(dom({ order: ['header', 'main', 'footer'] }), order(['HEADER', 'nav', 'MAIN', 'FOOTER']))
        ?.passed,
    ).toBe(true);
    expect(
      one(dom({ order: ['header', 'main', 'footer'] }), order(['main', 'header', 'footer']))
        ?.passed,
    ).toBe(false);
  });

  it('event: dispatch failures and DOM state after the scenario', () => {
    const check = {
      kind: 'event',
      id: 'e',
      steps: [{ action: 'click', selector: '#add' }],
      expect: [{ selector: 'li', count: 1 }],
    };
    const ok = [
      { op: 'dispatch', id: 'e#s0', ok: true },
      { op: 'domQuery', id: 'e#e0', count: 1, items: [{}] },
    ];
    expect(one(check, ok)?.passed).toBe(true);
    expect(
      one(check, [{ op: 'dispatch', id: 'e#s0', ok: false, reason: 'TARGET_NOT_FOUND' }])?.reason,
    ).toBe('NOT_FOUND');
    expect(one(check, [ok[0], { op: 'domQuery', id: 'e#e0', count: 0, items: [] }])?.passed).toBe(
      false,
    );
  });

  it('css: px tolerance, keywords, numeric and colors', () => {
    const css = (computed: object, all = false) => ({
      kind: 'css',
      id: 'k',
      selector: '.card',
      all,
      expect: { computed },
    });
    const styles = (...elements: object[]) => [
      { op: 'computedStyle', id: 'k#0', count: elements.length, elements },
    ];
    expect(
      one(css({ 'padding-top': { px: { min: 12, max: 20 } } }), styles({ 'padding-top': '16px' }))
        ?.passed,
    ).toBe(true);
    expect(
      one(css({ 'padding-top': { px: { value: 16 } } }), styles({ 'padding-top': '16.4px' }))
        ?.passed,
    ).toBe(true);
    expect(
      one(css({ 'padding-top': { px: { value: 16 } } }), styles({ 'padding-top': 'auto' }))?.passed,
    ).toBe(false);
    expect(
      one(css({ display: { oneOf: ['flex', 'grid'] } }), styles({ display: 'GRID' }))?.passed,
    ).toBe(true);
    expect(
      one(css({ 'font-weight': { numeric: { min: 600 } } }), styles({ 'font-weight': '700' }))
        ?.passed,
    ).toBe(true);
    expect(
      one(css({ color: { color: '#1f2937' } }), styles({ color: 'rgb(31, 41, 55)' }))?.passed,
    ).toBe(true);
    expect(
      one(css({ color: { color: '#1f2937' } }), styles({ color: 'rgb(200, 41, 55)' }))?.passed,
    ).toBe(false);
    expect(
      one(
        css({ display: { equals: 'flex' } }, true),
        styles({ display: 'flex' }, { display: 'block' }),
      )?.passed,
    ).toBe(false);
    expect(one(css({ display: { equals: 'flex' } }), styles())?.reason).toBe('NOT_FOUND');
    expect(one(css({ display: { equals: 'flex' } }), styles({ color: 'red' }))?.reason).toBe(
      'NOT_OBSERVED',
    );
  });

  it('layout: relations, gap and missing elements', () => {
    const box = (x: number, y: number, width = 100, height = 50) => ({ x, y, width, height });
    const rects = (...r: [string, object | undefined][]) => [
      {
        op: 'boxRect',
        id: 'l#0',
        rects: r.map(([selector, rect]) => ({
          selector,
          count: rect ? 1 : 0,
          ...(rect ? { rect } : {}),
        })),
      },
    ];
    const layout = (extra: object) => ({ kind: 'layout', id: 'l', a: '.a', b: '.b', ...extra });
    expect(
      one(layout({ relation: 'left-of' }), rects(['.a', box(0, 0)], ['.b', box(101, 0)]))?.passed,
    ).toBe(true);
    expect(
      one(layout({ relation: 'above' }), rects(['.a', box(0, 0)], ['.b', box(101, 0)]))?.passed,
    ).toBe(false);
    expect(
      one(
        layout({ gap: { axis: 'x', min: 12, max: 24 } }),
        rects(['.a', box(0, 0)], ['.b', box(116, 0)]),
      )?.passed,
    ).toBe(true);
    expect(
      one(
        layout({ gap: { axis: 'x', min: 12, max: 24 } }),
        rects(['.a', box(0, 0)], ['.b', box(140, 0)]),
      )?.passed,
    ).toBe(false);
    expect(
      one(layout({ relation: 'left-of' }), rects(['.a', box(0, 0)], ['.b', undefined]))?.reason,
    ).toBe('NOT_FOUND');
    expect(relationHolds('centered-horizontally', box(50, 0, 100), box(0, 0, 200), 2)).toBe(true);
    expect(relationHolds('inside', box(10, 10, 20, 20), box(0, 0, 100, 100), 0)).toBe(true);
    expect(relationHolds('same-row', box(0, 0, 10, 50), box(20, 10, 10, 20), 2)).toBe(true);
  });

  it('a11y: impact threshold and rule filter; server findings for static/html-valid', () => {
    const a11y = { kind: 'a11y', id: 'a', rules: ['image-alt'], impact: 'serious' };
    const obs = (impact: string, ruleId = 'image-alt') => [
      { op: 'a11y', id: 'a#0', violations: [{ ruleId, impact, targets: ['img'] }] },
    ];
    expect(one(a11y, obs('critical'))?.passed).toBe(false);
    expect(one(a11y, obs('moderate'))?.passed).toBe(true);
    expect(one(a11y, obs('critical', 'label'))?.passed).toBe(true);
    const staticCheck = checks([
      { kind: 'static', id: 's', rule: 'forbid-identifier', value: 'var' },
    ]);
    const run = makeRun([]);
    expect(gradeChecks({ checks: staticCheck, run }).checkResults[0]?.reason).toBe('NOT_OBSERVED');
    expect(
      gradeChecks({
        checks: staticCheck,
        run,
        serverFindings: { s: { passed: false, messages: ['var 사용'] } },
      }).checkResults[0],
    ).toMatchObject({ passed: false, reason: 'VIOLATION', required: false });
  });
});

describe('weighted partial score', () => {
  const list = checks([
    {
      kind: 'call',
      id: 'basic',
      args: [[1, 2]],
      expect: { equals: 3 },
      weight: 1,
      requirement: '기본 합계',
    },
    {
      kind: 'call',
      id: 'empty',
      args: [[]],
      expect: { equals: 0 },
      weight: 1,
      requirement: '빈 배열 처리',
    },
    {
      kind: 'call',
      id: 'neg',
      visible: false,
      description: '음수도 더합니다.',
      args: [[-1]],
      expect: { equals: -1 },
      weight: 2,
      requirement: '음수 처리',
      misconceptionIfFail: 'js.mc.neg',
    },
    {
      kind: 'call',
      id: 'bonus',
      required: false,
      args: [[0.1, 0.2]],
      expect: { closeTo: { value: 0.3 } },
      weight: 1,
    },
  ]);
  const obs = (values: Record<string, number>) =>
    Object.entries(values).map(([id, v]) => returned(`${id}#0`, v));

  it('scores passed weight over total weight and groups failures by requirement', () => {
    const grade = gradeChecks({
      checks: list,
      run: makeRun(obs({ basic: 3, empty: 0, neg: 5, bonus: 0.30000000000000004 })),
      entry: 'sum',
    });
    expect(grade.score).toBeCloseTo(3 / 5);
    expect(grade.correct).toBe(false);
    expect(grade.failedRequirements).toEqual(['음수 처리']);
    expect(grade.misconceptionIds).toEqual(['js.mc.neg']);
    expect(grade.feedback.map((f) => f.code)).toEqual(['REQUIREMENT_FAILED', 'CHECK_FAILED']);
    const hidden = grade.checkResults.find((r) => r.id === 'neg');
    expect(hidden).toMatchObject({
      passed: false,
      visible: false,
      description: '음수도 더합니다.',
    });
    expect(hidden?.detail).toBeUndefined();
    expect(JSON.stringify(grade)).not.toContain('-1');
  });

  it('is correct when only optional checks fail', () => {
    const grade = gradeChecks({
      checks: list,
      run: makeRun(obs({ basic: 3, empty: 0, neg: -1, bonus: 1 })),
    });
    expect(grade).toMatchObject({ correct: true, score: 0.8 });
    expect(grade.feedback.map((f) => f.code)).toEqual(['OPTIONAL_CHECK_FAILED']);
  });

  it('tracks milestones and requires all of them', () => {
    const grade = gradeChecks({
      checks: list,
      run: makeRun(obs({ basic: 3, empty: 1, neg: -1, bonus: 0.3 })),
      milestones: [
        { id: 'm1', title: '기본', checks: ['basic', 'bonus'] },
        { id: 'm2', title: '경계', checks: ['empty', 'neg'] },
      ],
    });
    expect(grade.milestones).toEqual([
      { id: 'm1', title: '기본', passed: true },
      { id: 'm2', title: '경계', passed: false },
    ]);
    expect(grade.correct).toBe(false);
  });

  it('ignores duplicated (forged) observation IDs after the first', () => {
    const grade = gradeChecks({
      checks: list.slice(0, 1),
      run: makeRun([returned('basic#0', 4), returned('basic#0', 3)]),
    });
    expect(grade.correct).toBe(false);
  });
});

describe('css helpers', () => {
  it('matches CIEDE2000 reference pairs (Sharma et al.)', () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE2000([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 4);
    expect(deltaE2000([2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514])).toBeCloseTo(0.9082, 4);
  });

  it('parses colors and lengths', () => {
    expect(parseColor('#1F2937')).toEqual({ r: 31, g: 41, b: 55, a: 1 });
    expect(parseColor('#fff8')).toMatchObject({ r: 255, a: 0x88 / 255 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('url(javascript:1)')).toBeNull();
    expect(toLab({ r: 255, g: 255, b: 255, a: 1 })[0]).toBeCloseTo(100, 3);
    expect(parsePx('-2.5px')).toBe(-2.5);
    expect(parsePx('1rem')).toBeNull();
    expect(cssValueMatches({ color: 'transparent', deltaE: 3 }, 'rgba(0, 0, 0, 0)')).toBe(true);
  });
});
