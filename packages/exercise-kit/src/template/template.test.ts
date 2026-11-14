import { describe, expect, it } from 'vitest';

import { createRng } from '../common/prng.ts';
import { ExerciseKitError } from '../core/errors.ts';
import { formatSeed, parseVariantId } from '../core/ids.ts';
import {
  instantiateTemplate,
  instantiateVariant,
  parseTemplate,
  renderString,
  resolveParams,
  sampleSeeds,
} from './engine.ts';
import { evaluate, referencedNames, toLiteral, type TemplateValue } from './expr.ts';
import {
  drawParams,
  fromPattern,
  paramSpaceSize,
  paramsSchema,
  RESERVED_IDENTIFIERS,
  sampleParam,
} from './params.ts';

const scope = (values: Record<string, TemplateValue>) => new Map(Object.entries(values));
const kitCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ExerciseKitError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
};

describe('template expressions', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['-2 * -3', 6],
    ['7 % 3', 1],
    ['"a" + 1 + 2', 'a12'],
    ['1 + 2 + "a"', '3a'],
    ["'x' === 'x' && 2 > 1", true],
    ['0 || "fallback"', 'fallback'],
    ['!0', true],
    ['1 < 2 ? "yes" : "no"', 'yes'],
    ['true ? 1 : false ? 2 : 3', 1],
    ['[1, 2, 3].length', 3],
    ['[1, 2, 3][-1]', 3],
    ['len("abc") + sum([1, 2])', 6],
    ['join([1, 2], " + ")', '1 + 2'],
    ['lit(["a", 1])', '["a", 1]'],
    ['round(2.345, 2)', 2.35],
    ['max(1, 5, 3) - min(4, 2)', 3],
    ['sorted([3, 1, 2])[0]', 1],
    ['includes(["a"], "a")', true],
    ['upper("ab") + lower("CD")', 'ABcd'],
  ])('%s → %j', (src, expected) => {
    expect(evaluate(src, scope({}))).toEqual(expected);
  });

  it('reads params, nested members and the doc example', () => {
    const s = scope({ a: 3, b: 4, wrapA: 'string', obj: { price: 10 }, arr: [5, 6] });
    expect(evaluate("wrapA === 'string' ? '\"' + a + '\"' : a", s)).toBe('"3"');
    expect(evaluate('obj.price * arr[1]', s)).toBe(60);
    expect(evaluate('arr === [5, 6]', s)).toBe(true);
    expect(referencedNames('a + obj.price + max(b, 1)')).toEqual(new Set(['a', 'obj', 'b']));
  });

  it.each([
    'a.constructor',
    'a["__proto__"]',
    'obj.prototype',
    'missing + 1',
    'alert(1)',
    'a(1)',
    '"x" - 1',
    '[1] + 1',
    '1 < "2"',
    'arr[5]',
    'arr[0.5]',
    '1 +',
    '(1',
    '1 2',
    'a = 1',
    '`x`',
    'x'.repeat(501),
    '('.repeat(60) + '1' + ')'.repeat(60),
  ])('rejects %s', (src) => {
    expect(kitCode(() => evaluate(src, scope({ a: 1, obj: { x: 1 }, arr: [1] })))).toBe(
      'TEMPLATE_EXPRESSION',
    );
  });

  it('formats values as JavaScript literals', () => {
    expect(toLiteral({ a: [1, 'x'], 'b-c': null })).toBe('{ a: [1, "x"], "b-c": null }');
    expect(renderString('const {{name}} = {{arr}};', scope({ name: 'total', arr: [1, 2] }))).toBe(
      'const total = [1, 2];',
    );
    expect(renderString('{{blank:b1}} and {{ "{{" }}', scope({}))).toBe('{{blank:b1}} and {{');
  });
});

describe('parameter sampling', () => {
  const draws = (def: unknown, n = 300) => {
    const parsed = paramsSchema.parse({ p: def });
    const rng = createRng(7n);
    return Array.from({ length: n }, () => sampleParam(parsed['p'] as never, rng));
  };

  it('int respects bounds and exclusions and covers the range', () => {
    const values = draws({ kind: 'int', min: 1, max: 6, exclude: [3, 99] });
    expect(new Set(values)).toEqual(new Set([1, 2, 4, 5, 6]));
  });

  it('float keeps the requested precision', () => {
    for (const v of draws({ kind: 'float', min: 0.5, max: 2, decimals: 1 })) {
      expect(typeof v).toBe('number');
      expect(Math.round((v as number) * 10) / 10).toBe(v);
      expect(v as number).toBeGreaterThanOrEqual(0.5);
      expect(v as number).toBeLessThanOrEqual(2);
    }
  });

  it('identifier never yields reserved words; choice and string pools stay in the pool', () => {
    const ids = draws({ kind: 'identifier', pool: ['x', 'class', 'total', 'let'] });
    expect(new Set(ids)).toEqual(new Set(['x', 'total']));
    expect(RESERVED_IDENTIFIERS.has('class')).toBe(true);
    expect(new Set(draws({ kind: 'choice', values: ['+', '-'] }))).toEqual(new Set(['+', '-']));
    for (const s of draws({ kind: 'string', pattern: '[a-c]{2,3}-\\d' }, 50))
      expect(s).toMatch(/^[a-c]{2,3}-d$/);
    expect(fromPattern('[0-9]{4}', createRng(1n))).toMatch(/^\d{4}$/);
  });

  it('intArray honors length, uniqueness and sorting; objectShape picks distinct names', () => {
    for (const arr of draws(
      { kind: 'intArray', length: { min: 2, max: 4 }, min: 1, max: 5, unique: true, sorted: 'asc' },
      50,
    )) {
      const a = arr as number[];
      expect(a.length).toBeGreaterThanOrEqual(2);
      expect(new Set(a).size).toBe(a.length);
      expect([...a].sort((x, y) => x - y)).toEqual(a);
    }
    for (const obj of draws(
      {
        kind: 'objectShape',
        fields: { names: ['a', 'b', 'c'], count: 2, value: { kind: 'int', min: 0, max: 9 } },
      },
      50,
    )) {
      expect(Object.keys(obj as object)).toHaveLength(2);
    }
  });

  it('evaluates derived params in dependency order and rejects cycles and bad names', () => {
    const params = paramsSchema.parse({
      total: { kind: 'derived', expr: 'half * 2' },
      half: { kind: 'derived', expr: 'n / 2' },
      n: { kind: 'int', min: 4, max: 4 },
    });
    expect(Object.fromEntries(drawParams(params, createRng(1n)))).toEqual({
      n: 4,
      half: 2,
      total: 4,
    });
    expect(
      paramsSchema.safeParse({
        a: { kind: 'derived', expr: 'b' },
        b: { kind: 'derived', expr: 'a' },
      }).success,
    ).toBe(false);
    expect(paramsSchema.safeParse({ a: { kind: 'derived', expr: 'nope + 1' } }).success).toBe(
      false,
    );
    expect(paramsSchema.safeParse({ class: { kind: 'int', min: 1, max: 2 } }).success).toBe(false);
    expect(
      paramsSchema.safeParse({ a: { kind: 'intArray', length: 5, min: 1, max: 3, unique: true } })
        .success,
    ).toBe(false);
  });

  it('computes the parameter space upper bound', () => {
    const params = paramsSchema.parse({
      a: { kind: 'int', min: 1, max: 9 },
      op: { kind: 'choice', values: ['+', '-', '*'] },
      d: { kind: 'derived', expr: 'a * 2' },
    });
    expect(paramSpaceSize(params)).toBe(27);
    expect(paramSpaceSize(paramsSchema.parse({ s: { kind: 'string', pattern: '[a-z]{3}' } }))).toBe(
      Infinity,
    );
  });
});

const PLUS_CONCAT = {
  id: 'js-basics.operators.implicit-coercion.t.plus-concat',
  type: 'predict_output',
  difficulty: 2,
  params: {
    a: { kind: 'int', min: 1, max: 9 },
    b: { kind: 'int', min: 1, max: 9 },
    op: { kind: 'choice', values: ['+', '-', '*'] },
    wrapA: { kind: 'choice', values: ['string', 'number'] },
    name: { kind: 'identifier', pool: ['x', 'y', 'total', 'count', 'value'] },
  },
  constraints: ["wrapA === 'string'", "!(op === '-' && a < b)"],
  render: { prompt: '다음 코드의 출력은 무엇인가요?' },
  spec: {
    code: "const {{name}} = {{wrapA === 'string' ? '\"' + a + '\"' : a}} {{op}} {{b}};\nconsole.log({{name}});",
    answerKind: 'console',
    misconceptionByAnswer: { '{{op === "+" ? a + b : "none-" + name}}': 'js.mc.plus-always-adds' },
  },
  hints: ['`{{op}}` 연산자의 규칙을 떠올려 보세요.'],
  explanation: '`{{op}}`가 `+`일 때 한쪽이 문자열이면 문자열 연결이 일어납니다.',
  variantPolicy: { maxVariants: 200, minDistinctFromRecent: 3 },
};

describe('template engine', () => {
  it('produces the identical variant for the same seed (fresh calls, any order)', () => {
    const seeds = [0n, 1n, 0xa91f2cn, (1n << 64n) - 1n];
    const first = seeds.map((s) => instantiateTemplate(PLUS_CONCAT, s));
    const again = [...seeds]
      .reverse()
      .map((s) => instantiateTemplate(JSON.parse(JSON.stringify(PLUS_CONCAT)) as unknown, s))
      .reverse();
    expect(again).toEqual(first);
  });

  it('produces different variants for different seeds', () => {
    const codes = new Set(
      Array.from(
        { length: 40 },
        (_, i) => (instantiateTemplate(PLUS_CONCAT, BigInt(i)).spec as { code: string }).code,
      ),
    );
    expect(codes.size).toBeGreaterThan(15);
  });

  it('always satisfies constraints and validates the rendered spec with the type schema', () => {
    for (const seed of sampleSeeds(PLUS_CONCAT.id, 50)) {
      const v = instantiateTemplate(PLUS_CONCAT, seed);
      expect(v.params['wrapA']).toBe('string');
      expect(v.params['op'] === '-' && (v.params['a'] as number) < (v.params['b'] as number)).toBe(
        false,
      );
      expect(v.spec).toMatchObject({ lang: 'js', answerKind: 'console' });
      expect(v.variantGroup).toBe(PLUS_CONCAT.id);
      expect(parseVariantId(v.variantId)?.seed).toBe(seed);
    }
  });

  it('matches snapshots for fixed seeds (cross-machine reproducibility)', () => {
    const pick = (seed: bigint) => {
      const v = instantiateTemplate(PLUS_CONCAT, seed);
      return {
        variantId: v.variantId,
        attempt: v.attempt,
        params: v.params,
        spec: v.spec,
        hints: v.hints,
      };
    };
    expect(pick(0xa91f2cn)).toMatchInlineSnapshot(`
      {
        "attempt": 2,
        "hints": [
          "\`+\` 연산자의 규칙을 떠올려 보세요.",
        ],
        "params": {
          "a": 8,
          "b": 2,
          "name": "y",
          "op": "+",
          "wrapA": "string",
        },
        "spec": {
          "answerKind": "console",
          "code": "const y = "8" + 2;
      console.log(y);",
          "lang": "js",
          "misconceptionByAnswer": {
            "10": "js.mc.plus-always-adds",
          },
        },
        "variantId": "js-basics.operators.implicit-coercion.t.plus-concat@a91f2c",
      }
    `);
    expect(pick(0n)).toMatchInlineSnapshot(`
      {
        "attempt": 0,
        "hints": [
          "\`*\` 연산자의 규칙을 떠올려 보세요.",
        ],
        "params": {
          "a": 9,
          "b": 6,
          "name": "y",
          "op": "*",
          "wrapA": "string",
        },
        "spec": {
          "answerKind": "console",
          "code": "const y = "9" * 6;
      console.log(y);",
          "lang": "js",
          "misconceptionByAnswer": {
            "none-y": "js.mc.plus-always-adds",
          },
        },
        "variantId": "js-basics.operators.implicit-coercion.t.plus-concat@0",
      }
    `);
    expect(sampleSeeds(PLUS_CONCAT.id, 3).map(formatSeed)).toMatchInlineSnapshot(`
      [
        "f0a354924276682e",
        "a376dad96eda0abb",
        "75062d58a3880868",
      ]
    `);
  });

  it('retries with derived seeds and fails when constraints cannot be met', () => {
    const always = {
      params: paramsSchema.parse({ a: { kind: 'int', min: 1, max: 100 } }),
      constraints: ['a === 100'],
    };
    const resolved = (() => {
      try {
        return resolveParams(always, 3n);
      } catch {
        return null;
      }
    })();
    if (resolved) expect(resolved.params.get('a')).toBe(100);
    expect(kitCode(() => resolveParams({ ...always, constraints: ['a > 100'] }, 1n))).toBe(
      'TEMPLATE_CONSTRAINTS_UNSATISFIABLE',
    );
    const sometimes = { ...always, constraints: ['a % 2 === 0'] };
    const r = resolveParams(sometimes, 5n);
    expect((r.params.get('a') as number) % 2).toBe(0);
    expect(resolveParams(sometimes, 5n)).toEqual(r);
  });

  it('keeps fill_blank placeholders and renders spec keys', () => {
    const v = instantiateTemplate(
      {
        id: 'js-basics.functions.function-basics.t.fill-return',
        type: 'fill_blank',
        params: { n: { kind: 'int', min: 2, max: 2 } },
        spec: {
          template: 'function f() {\n  {{blank:b1}} {{n}};\n}',
          blanks: [
            {
              id: 'b1',
              accept: ['return'],
              misconceptionMap: { 'console.log({{n}})': 'js.mc.log-is-return' },
            },
          ],
        },
      },
      9n,
    );
    expect(v.spec).toMatchObject({
      template: 'function f() {\n  {{blank:b1}} 2;\n}',
      blanks: [{ misconceptionMap: { 'console.log(2)': 'js.mc.log-is-return' } }],
    });
  });

  it('rejects invalid templates, mismatched variant IDs and invalid rendered specs', () => {
    expect(kitCode(() => parseTemplate({ ...PLUS_CONCAT, id: 'not-a-template' }))).toBe(
      'INVALID_TEMPLATE',
    );
    const protoParams = JSON.parse('{"__proto__": {"kind": "int", "min": 1, "max": 2}}') as unknown;
    expect(kitCode(() => parseTemplate({ ...PLUS_CONCAT, params: protoParams }))).toBe(
      'INVALID_TEMPLATE',
    );
    expect(kitCode(() => parseTemplate({ ...PLUS_CONCAT, constraints: ['a ==='] }))).toBe(
      'INVALID_TEMPLATE',
    );
    expect(kitCode(() => instantiateVariant(PLUS_CONCAT, `${PLUS_CONCAT.id}@0a`))).toBe(
      'INVALID_ID',
    );
    expect(kitCode(() => instantiateVariant(PLUS_CONCAT, 'js-basics.x.y.t.other@1'))).toBe(
      'INVALID_ID',
    );
    expect(instantiateVariant(PLUS_CONCAT, `${PLUS_CONCAT.id}@a91f2c`)).toEqual(
      instantiateTemplate(PLUS_CONCAT, 0xa91f2cn),
    );
    expect(
      kitCode(() => instantiateTemplate({ ...PLUS_CONCAT, spec: { answerKind: 'console' } }, 1n)),
    ).toBe('INVALID_SPEC');
    expect(
      kitCode(() =>
        instantiateTemplate({ ...PLUS_CONCAT, spec: { '{{op}}': 1, '{{"+"}}': 2 } }, 1n),
      ),
    ).not.toBe('NO_ERROR');
  });
});
